import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@miniflare/storage-memory';
import type { D1Database } from '@cloudflare/workers-types';
import { CountersDO } from '../src/durable-objects/counters-do';

/**
 * Regression coverage for the chatId: 0 contract gap.
 *
 * CountersDO `/inc` previously accepted chatId: 0 via its loose `p.chatId == null`
 * validate guard, allocated a sequence, and wrote a `category='criminal'`
 * `stats_daily_pipeline_progress` pending row (d1-aggregate-writer.ts:336). The
 * matching analyzer `/enqueue` rejects chatId: 0 (`if (!chatId)` at
 * criminal-code-analyzer-do.ts:274) before flushQueue runs, so no `/ack` or
 * `/criminal` POST was ever issued and the criminal pending row leaked
 * indefinitely at `accepted_seq=1, completed_seq=0, pending_count=1`.
 *
 * The fix tightens `/inc`'s `validate` to reject `chatId === 0`, closing the
 * leak at its origin so `/inc` and `/enqueue` agree on what counts as a valid
 * identity. These tests exercise the fixed `/inc` accept path against a real
 * in-memory SQLite D1 (the same harness pattern as
 * counters-do-d1-aggregates.test.ts) and assert no persisted artifact survives.
 */

type Sqlite = Awaited<ReturnType<MemoryStorage['getSqliteDatabase']>>;
type SQLInputValue = null | number | bigint | string | Uint8Array;

// Pre-warm the better-sqlite3 runtime (fetched lazily by MemoryStorage via
// npx-import) during module load, so the per-worker first-install cost never
// stalls the 10s beforeEach hook timeout on a cold CI cache.
{
  const warmup = await new MemoryStorage().getSqliteDatabase();
  warmup.close();
}

interface PreparedStatementLogEntry {
  sql: string;
  params: unknown[];
}

class FakeD1Statement {
  constructor(
    private readonly owner: FakeD1Database,
    readonly sql: string,
    public params: SQLInputValue[] = [],
  ) {}

  bind(...values: SQLInputValue[]): this {
    this.params = values;
    return this;
  }

  run(): unknown {
    this.owner.logPrepared(this);
    const result = this.owner.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes } };
  }

  all<T = unknown>(): { results: T[]; success: boolean; meta: Record<string, unknown> } {
    this.owner.logPrepared(this);
    const results = this.owner.sqlite.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }
}

class FakeD1Database {
  readonly sqlite: Sqlite;
  batchCalls = 0;
  preparedLog: PreparedStatementLogEntry[] = [];

  constructor(sqlite: Sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql);
  }

  logPrepared(stmt: FakeD1Statement): void {
    this.preparedLog.push({ sql: stmt.sql, params: stmt.params });
  }

  async batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    this.batchCalls += 1;
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

async function createRealD1(): Promise<{ db: D1Database; harness: FakeD1Database }> {
  const sqlite = await new MemoryStorage().getSqliteDatabase();
  const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const file of [
    '0002_activity.sql',
    '0009_stats_daily_aggregates.sql',
    '0010_stats_backfill_state.sql',
    '0011_stats_chat_user_profile.sql',
    '0012_stats_daily_pipeline_progress.sql',
  ]) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const statement of sql.split(';')) {
      if (statement.trim()) {
        sqlite.exec(statement);
      }
    }
  }
  const harness = new FakeD1Database(sqlite);
  return { db: harness as unknown as D1Database, harness };
}

function rows(sqlite: Sqlite, sql: string, params: SQLInputValue[] = []): any[] {
  return sqlite.prepare(sql).all(...params) as any[];
}

function count(sqlite: Sqlite, sql: string, params: SQLInputValue[] = []): number {
  return (sqlite.prepare(sql).get(...params) as any).n;
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

function makeState(storageMap?: Map<string, unknown>) {
  const map = storageMap ?? new Map<string, unknown>();
  return {
    blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()),
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => map.get(key) as T | undefined),
      put: vi.fn(async (key: string, value: unknown) => {
        map.set(key, value);
      }),
    },
  } as any;
}

function makeEnv(db: unknown) {
  const kv = createKv();
  const env = {
    COUNTERS: kv.kv,
    HISTORY: {} as any,
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
  return { env: env as any, kv };
}

function post(counters: CountersDO, path: string, body: unknown): Promise<Response> {
  return counters.fetch(
    new Request(`https://do.test${path}`, { method: 'POST', body: JSON.stringify(body) }),
  );
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chatId: 123,
    userId: 456,
    username: 'alice',
    day: '2026-05-07',
    wordCount: 4,
    voiceCount: 1,
    voiceDurationSeconds: 5,
    videoNoteCount: 0,
    videoNoteDurationSeconds: 0,
    hour: 13,
    ts: 1000,
    ...overrides,
  };
}

describe('CountersDO /inc chatId:0 contract gap regression', () => {
  let harness: FakeD1Database;
  let counters: CountersDO;

  beforeEach(async () => {
    const { db, harness: h } = await createRealD1();
    harness = h;
    const { env } = makeEnv(db);
    counters = new CountersDO(makeState(), env);
  });

  afterEach(() => {
    harness.sqlite.close();
  });

  it('rejects chatId: 0 with 400 before any D1 batch, sequence, or pending row is allocated', async () => {
    const res = await post(counters, '/inc', basePayload({ chatId: 0 }));
    expect(res.status).toBe(400);

    // validate() throws inside the json+validate try/catch, so incrementCounters
    // (and its blockConcurrencyWhile D1 batch) never runs.
    expect(harness.batchCalls).toBe(0);
    expect(harness.preparedLog).toHaveLength(0);

    // No persisted artifact of any kind for chat_id = 0.
    expect(count(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_pipeline_progress WHERE chat_id = 0')).toBe(0);
    expect(count(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user WHERE chat_id = 0')).toBe(0);
    expect(count(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_coverage WHERE chat_id = 0')).toBe(0);
    expect(count(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_chat_user_profile WHERE chat_id = 0')).toBe(0);
    expect(count(harness.sqlite, 'SELECT COUNT(*) AS n FROM activity WHERE chat_id = 0')).toBe(0);
  });

  it('still accepts negative chatId (Telegram group/channel chats) and allocates the sequence', async () => {
    // The fix adds only `p.chatId === 0`, NOT a truthy check, so negative chat
    // ids remain accepted — matching the analyzer's `if (!chatId)` which also
    // accepts negatives (`!-1 === false`). Telegram group chats have negative
    // ids, so this is a hard regression guard.
    const res = await post(counters, '/inc', basePayload({ chatId: -100123456789 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, sequence: 1 });

    const criminalRow = rows(
      harness.sqlite,
      'SELECT pending_count FROM stats_daily_pipeline_progress WHERE chat_id = ? AND day = ? AND category = ?',
      [-100123456789, '2026-05-07', 'criminal'],
    )[0];
    expect(criminalRow).toEqual({ pending_count: 1 });
  });

  it('does not regress userId: 0 — still accepted (scope guard; the report scopes the fix to chatId only)', async () => {
    // The report explicitly leaves userId: 0 alone: that case discharges
    // downstream via the analyzer's `storeViolations` NOT NULL rejection
    // ('failed') or the no-violations branch ('zero'). /inc must keep
    // accepting userId: 0 so that downstream discharge path still runs.
    const res = await post(counters, '/inc', basePayload({ chatId: 999, userId: 0 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, sequence: 1 });

    // userId: 0 still gets a pending criminal row allocated — that is correct,
    // the analyzer is responsible for resolving it (and does, via 'failed').
    const criminalRow = rows(
      harness.sqlite,
      'SELECT pending_count FROM stats_daily_pipeline_progress WHERE chat_id = 999 AND day = ? AND category = ?',
      ['2026-05-07', 'criminal'],
    )[0];
    expect(criminalRow).toEqual({ pending_count: 1 });
  });
});
