import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@miniflare/storage-memory';
import type { D1Database } from '@cloudflare/workers-types';
import { CountersDO } from '../src/durable-objects/counters-do';
import { CriminalCodeAnalyzerDO } from '../src/durable-objects/criminal-code-analyzer-do';

/**
 * End-to-end reproduction harness for the chatId: 0 criminal pending-row leak.
 *
 * Mirror of the bug-report's `tests/e2e-falsy-userid-repro.test.ts` harness:
 *  - Real in-memory SQLite D1 (better-sqlite3 via @miniflare/storage-memory) with
 *    ALL migrations 0001-0013 applied (so criminal_violations.user_id NOT NULL
 *    and stats_daily_pipeline_progress both exist).
 *  - The analyzer DO's COUNTERS_DO binding is routed to a real CountersDO.fetch
 *    via `new Request(url, init)`, so a /ack or /criminal POST issued by the
 *    analyzer actually advances the row in the shared D1.
 *  - COUNTERS_DO /ack and /criminal POSTs are tracked in arrays for assertions.
 *  - The AI provider is mocked at the module level so no network calls run.
 *
 * The original bug-report committed test asserted (pre-fix) that for chatId: 0:
 * the criminal row stuck at pending_count=1, completed_seq=0, with zero /ack
 * and zero /criminal POSTs. After the fix, /inc rejects chatId: 0 *before*
 * allocating a sequence, so the row is never created. The REPRO test here is
 * inverted to assert the post-fix contract: no row exists for chat_id=0.
 *
 * SCOPE (userId: 0) and CONTROL (chatId > 0, userId > 0) verify the rest of the
 * criminal pipeline still resolves correctly, exactly as the bug report
 * describes — they MUST NOT be regressed by tightening /inc's chatId guard.
 */

type Sqlite = Awaited<ReturnType<MemoryStorage['getSqliteDatabase']>>;
type SQLInputValue = null | number | bigint | string | Uint8Array;

// Pre-warm the better-sqlite3 runtime so the per-worker cold-install cost never
// stalls the 10s beforeEach hook timeout on a cold CI cache.
{
  const warmup = await new MemoryStorage().getSqliteDatabase();
  warmup.close();
}

// --- Mock the AI provider at the module boundary so no network run. ---------
vi.mock('../src/core/providers/provider-factory', () => ({
  ProviderFactory: {
    createProvider: vi.fn().mockReturnValue({
      getProviderInfo: vi.fn().mockReturnValue({ name: 'mock', model: 'mock' }),
      validateConfig: vi.fn(),
      analyzeCriminalCode: vi.fn().mockResolvedValue({
        hasViolations: true,
        violations: [
          {
            article: '282',
            subarticle: null,
            articleTitle: 'Возбуждение ненависти либо вражды',
            quote: 'Призываю к насилию против определённой группы людей',
            punishment: 'Штраф до 300 000 рублей',
            severity: 5,
            confidence: 0.9,
            decision: 'violation',
            evidence: {
              subject: 'author',
              object: 'group',
              intent: 'incitement',
              contextSummary: 'direct call',
              whyNotBenign: 'not a joke',
            },
          },
        ],
        totalSeverity: 5,
        riskLevel: 'high',
        analysisTimestamp: Date.now(),
      }),
    }),
  },
}));

// --- Real in-memory SQLite D1 harness (mirrors counters-do-d1-aggregates). --

class FakeD1Statement {
  constructor(private readonly owner: FakeD1Database, readonly sql: string, public params: SQLInputValue[] = []) {}

  bind(...values: SQLInputValue[]): this {
    this.params = values;
    return this;
  }

  run(): unknown {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes } };
  }

  all<T = unknown>(): { results: T[]; success: boolean; meta: Record<string, unknown> } {
    const results = this.owner.sqlite.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }

  first<T = unknown>(): T | null {
    const row = this.owner.sqlite.prepare(this.sql).get(...this.params) as T | undefined;
    return row ?? null;
  }
}

class FakeD1Database {
  readonly sqlite: Sqlite;

  constructor(sqlite: Sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    this.sqlite.exec('BEGIN');
    try {
      for (const stmt of statements) {
        stmt.run();
      }
      this.sqlite.exec('COMMIT');
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
    return statements.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
}

const ALL_MIGRATIONS = [
  '0001_init.sql',
  '0002_activity.sql',
  '0003_criminal_code.sql',
  '0004_text_preview.sql',
  '0005_add_article_title.sql',
  '0006_add_subarticle.sql',
  '0007_contextual_criminal_analysis.sql',
  '0008_legal_rag_corpus.sql',
  '0009_stats_daily_aggregates.sql',
  '0010_stats_backfill_state.sql',
  '0011_stats_chat_user_profile.sql',
  '0012_stats_daily_pipeline_progress.sql',
  '0013_criminal_violation_canonical_ts.sql',
];

async function createRealD1(): Promise<{ db: D1Database; harness: FakeD1Database }> {
  const sqlite = await new MemoryStorage().getSqliteDatabase();
  const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const file of ALL_MIGRATIONS) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    // better-sqlite3's exec() parses multi-statement SQL correctly, including
    // trigger/procedure bodies with internal `;` inside BEGIN...END blocks
    // (migration 0003 defines the `update_violation_stats` trigger). Splitting
    // on `;` naively would break those trigger definitions, so we exec the
    // whole migration file as a single batch.
    sqlite.exec(sql);
  }
  const harness = new FakeD1Database(sqlite);
  return { db: harness as unknown as D1Database, harness };
}

function createKv() {
  const map = new Map<string, string>();
  return {
    map,
    kv: {
      get: vi.fn(async (key: string) => map.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        map.delete(key);
      }),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
    } as any,
  };
}

// --- Per-DO serialized storage, mirroring summary-e2e.test.ts's approach. ---

function makeCountersState(storageMap: Map<string, unknown>) {
  return {
    blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()),
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => storageMap.get(key) as T | undefined),
      put: vi.fn(async (key: string, value: unknown) => {
        storageMap.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storageMap.delete(key);
      }),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
    },
  } as any;
}

function makeAnalyzerState(storageMap: Map<string, unknown>) {
  return {
    blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()),
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => storageMap.get(key) as T | undefined),
      put: vi.fn(async (key: string, value: unknown) => {
        storageMap.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storageMap.delete(key);
      }),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
      setAlarm: vi.fn(async (_ts: number) => {}),
      getAlarm: vi.fn(async () => null),
    },
  } as any;
}

interface TrackedPost {
  path: string;
  body: any;
}

/**
 * Build the COUNTERS_DO namespace that forwards to a real CountersDO and
 * records every /ack and /criminal POST. Per-chat DOs are lazily instantiated
 * and serialized via a promise chain.
 */
function createCountersNamespace(countersEnv: any, trackers: { ackCalls: TrackedPost[]; criminalPosts: TrackedPost[] }) {
  const objects = new Map<string, { obj: CountersDO; chain: Promise<any> }>();
  return {
    idFromName(name: string) {
      return name as any;
    },
    get(id: string) {
      let entry = objects.get(id);
      if (!entry) {
        const storageMap = new Map<string, unknown>();
        const state = makeCountersState(storageMap);
        entry = { obj: new CountersDO(state, countersEnv), chain: Promise.resolve() };
        objects.set(id, entry);
      }
      return {
        fetch: (url: string, init?: RequestInit) => {
          const parsed = new URL(url, 'https://do.test');
          const path = parsed.pathname;
          if ((init?.method ?? 'GET') === 'POST') {
            try {
              const body = init?.body ? JSON.parse(init.body as string) : null;
              if (path === '/ack') trackers.ackCalls.push({ path, body });
              if (path === '/criminal') trackers.criminalPosts.push({ path, body });
            } catch {
              /* swallow: malformed body not relevant to this test */
            }
          }
          entry!.chain = entry!.chain.then(() => entry!.obj.fetch(new Request(url, init)));
          return entry!.chain;
        },
      } as any;
    },
  };
}

function baseIncBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chatId: 123,
    userId: 999,
    username: 'alice',
    day: '2026-05-20',
    messageId: 7777,
    hour: 13,
    wordCount: 4,
    voiceCount: 0,
    voiceDurationSeconds: 0,
    videoNoteCount: 0,
    videoNoteDurationSeconds: 0,
    ts: 1779264000,
    ...overrides,
  };
}

function enqueueBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    text: 'Призываю к насилию против определённой группы людей — this is a long enough text',
    chatId: 123,
    userId: 999,
    messageId: 7777,
    username: 'alice',
    day: '2026-05-20',
    ts: 1779264000,
    ...overrides,
  };
}

async function postInc(counters: CountersDO, body: Record<string, unknown>): Promise<Response> {
  return counters.fetch(new Request('https://do.test/inc', { method: 'POST', body: JSON.stringify(body) }));
}

async function postEnqueue(analyzer: CriminalCodeAnalyzerDO, body: Record<string, unknown>): Promise<Response> {
  return analyzer.fetch(new Request('https://do.test/enqueue', { method: 'POST', body: JSON.stringify(body) }));
}

interface HarnessResult {
  incResponse: Response;
  seq: number | undefined;
  enqueueResponse: Response | undefined;
  progressRow: { accepted_seq: number; completed_seq: number; pending_count: number; failed_count: number } | undefined;
  ackCalls: TrackedPost[];
  criminalPosts: TrackedPost[];
  violationInserts: { n: number };
}

describe('e2e chatId:0 stuck criminal pending row repro', () => {
  let harness: FakeD1Database;
  let countersEnv: any;
  let analyzerEnv: any;
  let analyzer: CriminalCodeAnalyzerDO;
  let trackers: { ackCalls: TrackedPost[]; criminalPosts: TrackedPost[] };
  let analyzerStorageMap: Map<string, unknown>;

  beforeEach(async () => {
    const { db, harness: h } = await createRealD1();
    harness = h;
    const kv = createKv();

    trackers = { ackCalls: [], criminalPosts: [] };

    countersEnv = {
      COUNTERS: kv.kv,
      HISTORY: { get: vi.fn(async () => null), put: vi.fn(async () => {}), list: vi.fn(async () => ({ keys: [], list_complete: true })) } as any,
      COUNTERS_DO: {} as any,
      MESSAGE_FETCHER_DO: {} as any,
      MESSAGE_AGGREGATOR_DO: {} as any,
      DAY_BLOCK_MANAGER_DO: {} as any,
      CRIMINAL_CODE_ANALYZER_DO: {} as any,
      DB: db,
      AI: {} as any,
      TOKEN: 'test-token',
      SECRET: 'test-secret',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'test-prompt',
    };

    analyzerEnv = {
      ...countersEnv,
      COUNTERS_DO: createCountersNamespace(countersEnv, trackers),
      // Force-flush every enqueue (batch-size=1) so flushQueue runs inline.
      CRIMINAL_QUEUE_BATCH_SIZE: '1',
      // Disable semantic prefilter AI calls (the mocked analyzeCriminalCode is
      // only invoked by the contextual analysis step in flushQueue).
      CRIMINAL_AI_PREFILTER_ENABLED: 'false',
      ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER: 'false',
      CRIMINAL_STORE_TEXT_PREVIEW: 'false',
      CRIMINAL_FINAL_JUDGE_ENABLED: 'false',
    };

    analyzerStorageMap = new Map<string, unknown>();
    analyzer = new CriminalCodeAnalyzerDO(makeAnalyzerState(analyzerStorageMap), analyzerEnv);
    // Seed the analyzer queue empty so loadQueue returns [] on first call.
    analyzerStorageMap.set('criminalQueue', []);
  });

  afterEach(() => {
    harness.sqlite.close();
  });

  async function runHarness(
    userId: number,
    day: string,
    chatId: number,
    messageId: number,
  ): Promise<HarnessResult> {
    const incBody = baseIncBody({ chatId, userId, day, messageId });
    const incResponse = await postInc(
      // Use a CountersDO on the shared env so the pending row lands in the shared D1.
      new CountersDO(makeCountersState(new Map<string, unknown>()), countersEnv) as any,
      incBody,
    );

    let seq: number | undefined;
    if (incResponse.ok) {
      try {
        const parsed = await incResponse.json();
        if (parsed && typeof parsed === 'object' && Number.isInteger((parsed as any).sequence)) {
          seq = (parsed as any).sequence;
        }
      } catch {
        /* not json — legacy 'ok' body */
      }
    }

    let enqueueResponse: Response | undefined;
    if (seq !== undefined) {
      enqueueResponse = await postEnqueue(analyzer, enqueueBody({ chatId, userId, day, messageId, sequence: seq }));
    } else if (incResponse.ok) {
      // /inc succeeded but no sequence (legacy): still call /enqueue without sequence;
      // analyzer's /enqueue guard rejects chatId: 0 here too.
      enqueueResponse = await postEnqueue(analyzer, enqueueBody({ chatId, userId, day, messageId }));
    }

    const progressRow = harness.sqlite
      .prepare(
        'SELECT accepted_seq, completed_seq, pending_count, failed_count FROM stats_daily_pipeline_progress WHERE chat_id = ? AND day = ? AND category = ?',
      )
      .get(chatId, day, 'criminal') as any;
    const violationInserts = {
      n: (harness.sqlite.prepare('SELECT COUNT(*) AS n FROM criminal_violations WHERE chat_id = ?').get(chatId) as any).n,
    };

    return { incResponse, seq, enqueueResponse, progressRow, ackCalls: trackers.ackCalls, criminalPosts: trackers.criminalPosts, violationInserts };
  }

  it('REPRO: chatId:0,userId:456 - /inc rejects with 400 (fix); no pending row created; no /enqueue or ack path runs', async () => {
    const { incResponse, seq, enqueueResponse, progressRow, ackCalls, criminalPosts, violationInserts } = await runHarness(
      456, '2026-05-20', 0, 7777,
    );

    // FIX: /inc now rejects chatId: 0 with 400 (was 200 before the fix).
    expect(incResponse.status).toBe(400);

    // No sequence is allocated; /enqueue is never sent.
    expect(seq).toBeUndefined();
    expect(enqueueResponse).toBeUndefined();

    // No criminal pending row exists for chat_id=0 — the leak source is closed.
    expect(progressRow).toBeUndefined();

    // No /criminal and no /ack POSTs issued (analyzer never ran).
    expect(criminalPosts).toHaveLength(0);
    expect(ackCalls).toHaveLength(0);

    // No violations INSERTed for chat_id=0.
    expect(violationInserts.n).toBe(0);
  });

  it('SCOPE: userId:0, chatId>0 is NOT a bug - /inc accepts, /enqueue accepts, row resolves as "failed" via NOT NULL rejection', async () => {
    const { incResponse, seq, enqueueResponse, progressRow, ackCalls, violationInserts } = await runHarness(
      0, '2026-05-18', 12345, 2014,
    );

    // /inc accepts userId: 0 (the fix scopes to chatId only; userId path is left
    // alone because it has a downstream discharge that is NOT a leak).
    expect(incResponse.status).toBe(200);
    expect(seq).toBe(1);
    expect(enqueueResponse?.status).toBe(200);

    // audit-INSERT in storeViolations binds user_id = userId || null = null;
    // migration 0003 declares user_id INTEGER NOT NULL, so the INSERT throws;
    // storeViolations rethrows; flushQueue's catch calls ackCriminalOutcome('failed').
    expect(violationInserts.n).toBe(0);

    // Row resolves as 'failed' — NOT a leak.
    expect(progressRow).toEqual({
      accepted_seq: 1,
      completed_seq: 0,
      pending_count: 0,
      failed_count: 1,
    });

    // A criminal ack with outcome 'failed' was POSTed to CountersDO.
    const criminalAck = ackCalls.find((a) => a.body?.category === 'criminal');
    expect(criminalAck?.body?.outcome).toBe('failed');
  });

  it('CONTROL: chatId>0,userId>0 - /criminal POST fires, row resolves as completed', async () => {
    const { incResponse, seq, enqueueResponse, progressRow, criminalPosts } = await runHarness(
      999, '2026-05-19', 67890, 3099,
    );

    expect(incResponse.status).toBe(200);
    expect(seq).toBe(1);
    expect(enqueueResponse?.status).toBe(200);

    // storeViolations POSTs /criminal to CountersDO with the violation batch.
    expect(criminalPosts.length).toBe(1);
    expect(criminalPosts[0].body?.violations?.length).toBeGreaterThan(0);

    // Row resolves via the criminal increment path (completed_seq advances to 1).
    expect(progressRow).toEqual({
      accepted_seq: 1,
      completed_seq: 1,
      pending_count: 0,
      failed_count: 0,
    });
  });
});
