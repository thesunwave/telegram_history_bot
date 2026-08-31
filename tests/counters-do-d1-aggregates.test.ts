import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@miniflare/storage-memory';
import type { D1Database } from '@cloudflare/workers-types';
import { CountersDO } from '../src/durable-objects/counters-do';
import { isIntegrityClean } from '../src/features/stats/pipeline-progress';

/**
 * Phase 2 dual-write tests. Uses a real in-memory SQLite database (via
 * @miniflare/storage-memory MemoryStorage.getSqliteDatabase, backed by
 * better-sqlite3) with the actual migration DDL applied, so upsert/MAX/CHECK
 * semantics are the real ones. CountersDO is exercised through its public
 * fetch() endpoints with Map-backed KV mocks, mirroring the existing counters
 * test patterns.
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

function makeEnv(db: unknown, stateMap?: Map<string, unknown>) {
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
  return { env: env as any, kv, stateMap };
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

describe('CountersDO D1 aggregate dual-write', () => {
  let harness: FakeD1Database;
  let counters: CountersDO;
  let kv: { map: Map<string, string>; kv: any };

  beforeEach(async () => {
    const { db, harness: h } = await createRealD1();
    harness = h;
    const { env, kv: kvMock } = makeEnv(db);
    kv = kvMock;
    counters = new CountersDO(makeState(), env);
  });

  afterEach(() => {
    harness.sqlite.close();
  });

  it('base events write additive aggregates, valid hour/bucket, monotonic last_message_ts and profile', async () => {
    await post(counters, '/inc', basePayload());
    await post(counters, '/inc', basePayload({ wordCount: 2, voiceCount: 0, voiceDurationSeconds: 0, ts: 2000 }));

    // One D1 batch per base event, legacy activity upsert included in the batch.
    expect(harness.batchCalls).toBe(2);
    expect(
      harness.preparedLog.some((entry) => entry.sql.includes('INSERT INTO activity')),
    ).toBe(true);

    const user = rows(
      harness.sqlite,
      'SELECT * FROM stats_daily_user WHERE chat_id = 123 AND day = ? AND user_id = 456',
      ['2026-05-07'],
    )[0];
    expect(user.message_count).toBe(2);
    expect(user.word_count).toBe(6);
    expect(user.voice_count).toBe(1);
    expect(user.voice_duration_seconds).toBe(5);
    expect(user.video_note_count).toBe(0);
    expect(user.video_note_duration_seconds).toBe(0);
    expect(user.last_message_ts).toBe(2000);

    const hour = rows(
      harness.sqlite,
      'SELECT * FROM stats_daily_hour WHERE chat_id = 123 AND day = ? AND hour = 13',
      ['2026-05-07'],
    )[0];
    expect(hour.message_count).toBe(2);

    const bucket = rows(
      harness.sqlite,
      'SELECT * FROM stats_daily_bucket_user WHERE chat_id = 123 AND day = ? AND bucket = ? AND user_id = 456',
      ['2026-05-07', 'noon'],
    )[0];
    expect(bucket.message_count).toBe(2);

    const profile = rows(harness.sqlite, 'SELECT * FROM stats_chat_user_profile WHERE chat_id = 123 AND user_id = 456')[0];
    expect(profile.username).toBe('alice');
    expect(profile.last_message_ts).toBe(2000);

    const activity = rows(harness.sqlite, 'SELECT * FROM activity WHERE chat_id = 123 AND day = ?', [
      '2026-05-07',
    ])[0];
    expect(activity.count).toBe(2);

    const coverage = rows(
      harness.sqlite,
      'SELECT * FROM stats_daily_coverage WHERE chat_id = 123 AND day = ?',
      ['2026-05-07'],
    )[0];
    expect(coverage.base_status).toBe('live');
    expect(coverage.profanity_status).toBe('none');
    expect(coverage.criminal_status).toBe('none');
    expect(coverage.source).toBe('live');

    // KV legacy path still intact.
    expect(kv.map.get('stats_v2:123:2026-05-07:456')).toBe('2');
    expect(kv.map.get('activity_hour:123:2026-05-07:13')).toBe('2');
  });

  it('never regresses persisted timestamps and ignores absent ts', async () => {
    await post(counters, '/inc', basePayload({ ts: 5000 }));
    // Older ts must not regress last_message_ts / profile last_seen_ts.
    await post(counters, '/inc', basePayload({ ts: 1000 }));
    // Absent ts must not clobber either.
    await post(counters, '/inc', basePayload({ ts: undefined }));

    const user = rows(
      harness.sqlite,
      'SELECT last_message_ts FROM stats_daily_user WHERE chat_id = 123 AND day = ? AND user_id = 456',
      ['2026-05-07'],
    )[0];
    expect(user.last_message_ts).toBe(5000);

    const profile = rows(harness.sqlite, 'SELECT last_message_ts FROM stats_chat_user_profile WHERE chat_id = 123 AND user_id = 456')[0];
    expect(profile.last_message_ts).toBe(5000);
  });

  it('profile username follows the newest message timestamp and category events never regress it', async () => {
    await post(counters, '/inc', basePayload({ ts: 5000, username: 'newer' }));
    // Out-of-order older base event must not regress username or timestamp.
    await post(counters, '/inc', basePayload({ ts: 1000, username: 'older' }));
    // Category-only event (no ts) must not regress username either.
    await post(counters, '/profanity', {
      chatId: 123,
      userId: 456,
      username: 'older',
      day: '2026-05-07',
      count: 1,
      words: [{ baseForm: 'хуй', count: 1 }],
    });

    const profile = rows(
      harness.sqlite,
      'SELECT username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 123 AND user_id = 456',
    )[0];
    expect(profile.username).toBe('newer');
    expect(profile.last_message_ts).toBe(5000);
  });

  it('category-only events insert a profile conservatively without inventing a timestamp', async () => {
    await post(counters, '/profanity', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      count: 1,
      words: [{ baseForm: 'хуй', count: 1 }],
    });

    const profile = rows(
      harness.sqlite,
      'SELECT username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 123 AND user_id = 456',
    )[0];
    expect(profile.username).toBe('testuser');
    expect(profile.last_message_ts).toBeNull();
  });

  it('omits hour/bucket aggregate rows for missing or invalid hour', async () => {
    await post(counters, '/inc', basePayload({ hour: undefined }));
    await post(counters, '/inc', basePayload({ hour: 24 }));
    await post(counters, '/inc', basePayload({ hour: -1 }));
    await post(counters, '/inc', basePayload({ hour: 13.5 }));

    expect(
      rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_hour WHERE chat_id = 123 AND day = ?', [
        '2026-05-07',
      ])[0].n,
    ).toBe(0);
    expect(
      rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_bucket_user WHERE chat_id = 123 AND day = ?', [
        '2026-05-07',
      ])[0].n,
    ).toBe(0);

    const user = rows(
      harness.sqlite,
      'SELECT message_count FROM stats_daily_user WHERE chat_id = 123 AND day = ? AND user_id = 456',
      ['2026-05-07'],
    )[0];
    expect(user.message_count).toBe(4);
  });

  it('profanity writes normalized word and user totals without raw text', async () => {
    await post(counters, '/profanity', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      count: 3,
      words: [
        { word: 'ЗаЁбал', count: 2 },
        { baseForm: 'пиздец', count: 1 },
      ],
    });
    await post(counters, '/profanity', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      count: 1,
      words: [{ baseForm: 'заебал', count: 1 }],
    });

    expect(harness.batchCalls).toBe(2);

    const user = rows(
      harness.sqlite,
      'SELECT profanity_count FROM stats_daily_user WHERE chat_id = 123 AND day = ? AND user_id = 456',
      ['2026-05-07'],
    )[0];
    expect(user.profanity_count).toBe(4);

    const words = rows(
      harness.sqlite,
      'SELECT word, count FROM stats_daily_profanity_word WHERE chat_id = 123 AND day = ? ORDER BY word',
      ['2026-05-07'],
    );
    expect(words).toEqual([
      { word: 'заебал', count: 3 },
      { word: 'пиздец', count: 1 },
    ]);

    const wordUsers = rows(
      harness.sqlite,
      'SELECT word, user_id, count FROM stats_daily_profanity_word_user WHERE chat_id = 123 AND day = ? ORDER BY word',
      ['2026-05-07'],
    );
    expect(wordUsers).toEqual([
      { word: 'заебал', user_id: 456, count: 3 },
      { word: 'пиздец', user_id: 456, count: 1 },
    ]);

    const profile = rows(harness.sqlite, 'SELECT username FROM stats_chat_user_profile WHERE chat_id = 123 AND user_id = 456')[0];
    expect(profile.username).toBe('testuser');

    const coverage = rows(
      harness.sqlite,
      'SELECT base_status, profanity_status, criminal_status, source, reason_code FROM stats_daily_coverage WHERE chat_id = 123 AND day = ?',
      ['2026-05-07'],
    )[0];
    expect(coverage).toEqual({
      base_status: 'none',
      profanity_status: 'live',
      criminal_status: 'none',
      source: 'live',
      reason_code: null,
    });

    expect(kv.map.get('profanity:123:456:2026-05-07')).toBe('4');
  });

  it('criminal writes exact violations length and total severity; empty violations are a zero delta', async () => {
    await post(counters, '/criminal', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      violations: [
        { article: '282', severity: 5, count: 1 },
        { article: '319', severity: 2, count: 1 },
      ],
      totalSeverity: 7,
    });
    await post(counters, '/criminal', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      violations: [],
      totalSeverity: 0,
    });

    expect(harness.batchCalls).toBe(2);

    const user = rows(
      harness.sqlite,
      'SELECT criminal_count, criminal_severity FROM stats_daily_user WHERE chat_id = 123 AND day = ? AND user_id = 456',
      ['2026-05-07'],
    )[0];
    expect(user.criminal_count).toBe(2);
    expect(user.criminal_severity).toBe(7);

    const coverage = rows(
      harness.sqlite,
      'SELECT criminal_status FROM stats_daily_coverage WHERE chat_id = 123 AND day = ?',
      ['2026-05-07'],
    )[0];
    expect(coverage.criminal_status).toBe('live');

    expect(kv.map.get('criminal:123:456:2026-05-07')).toBe('2');
    expect(kv.map.get('criminal_severity:123:456:2026-05-07')).toBe('7');
  });

  it('keeps KV writes and request success when D1 batch rejects', async () => {
    const { env, kv: failingKv } = makeEnv({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async () => {
        throw new Error('d1 unavailable');
      }),
    });
    const failingCounters = new CountersDO(makeState(), env);

    const inc = await post(failingCounters, '/inc', basePayload());
    expect(inc.status).toBe(200);
    const profanity = await post(failingCounters, '/profanity', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      count: 1,
      words: [{ baseForm: 'хуй', count: 1 }],
    });
    expect(profanity.status).toBe(200);
    const criminal = await post(failingCounters, '/criminal', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      violations: [{ article: '282', severity: 5, count: 1 }],
      totalSeverity: 5,
    });
    expect(criminal.status).toBe(200);

    // Legacy KV writes happened despite D1 failure.
    expect(failingKv.map.get('stats_v2:123:2026-05-07:456')).toBe('1');
    expect(failingKv.map.get('word_stats_v2:123:2026-05-07:456')).toBe('4');
    expect(failingKv.map.get('profanity:123:456:2026-05-07')).toBe('1');
    expect(failingKv.map.get('criminal:123:456:2026-05-07')).toBe('1');
  });

  it('treats a resolving D1 batch with a per-statement error as a failed write: integrity poisoned, KV kept, progress unconfirmed', async () => {
    const stateMap = new Map<string, unknown>();
    const resolvingD1 = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async (statements: unknown[]) =>
        statements.map((_, i) =>
          i === 0
            ? { success: false, results: [], meta: {}, error: 'constraint failed' }
            : { success: true, results: [], meta: {} },
        ),
      ),
    };
    const { env, kv: resolvingKv } = makeEnv(resolvingD1, stateMap);
    const resolvingCounters = new CountersDO(makeState(stateMap), env);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await post(resolvingCounters, '/inc', basePayload());
      expect(response.status).toBe(200);
      // The batch resolved (no rejection) and still reached the writer's guard.
      expect(resolvingD1.batch).toHaveBeenCalledTimes(1);

      // Result-level error poisons every category stream at the armed sequence;
      // the resolving-but-failed batch never confirmed progress.
      for (const category of ['base', 'profanity', 'criminal']) {
        const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
        expect(state.poisoned).toBe(true);
        expect(state.firstPoisonedSeq).toBe(1);
        expect(state.reason).toBe('d1_write_failed');
      }

      // Legacy KV writes kept despite the result-level D1 failure.
      expect(resolvingKv.map.get('stats_v2:123:2026-05-07:456')).toBe('1');
      expect(resolvingKv.map.get('activity_hour:123:2026-05-07:13')).toBe('1');

      // The failed write is never represented as confirmed progress.
      const snapshot = await post(resolvingCounters, '/pipeline-snapshot', { day: '2026-05-07' });
      expect(snapshot.status).toBe(200);
      const body = await snapshot.json() as {
        categories: { base: { clean: boolean }; profanity: { clean: boolean }; criminal: { clean: boolean } };
      };
      expect(body.categories.base.clean).toBe(false);
      expect(body.categories.profanity.clean).toBe(false);
      expect(body.categories.criminal.clean).toBe(false);

      // Raw D1 error details never leave the writer's generic failure.
      const allOutput = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(allOutput).not.toContain('constraint failed');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('treats a resolving D1 batch with success:false and no error as a failed write: integrity poisoned, KV kept, progress unconfirmed', async () => {
    const stateMap = new Map<string, unknown>();
    const resolvingD1 = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async (statements: unknown[]) =>
        statements.map((_, i) =>
          i === 0
            ? { success: false, results: [], meta: {} }
            : { success: true, results: [], meta: {} },
        ),
      ),
    };
    const { env, kv: resolvingKv } = makeEnv(resolvingD1, stateMap);
    const resolvingCounters = new CountersDO(makeState(stateMap), env);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await post(resolvingCounters, '/inc', basePayload());
      expect(response.status).toBe(200);
      // The batch resolved (no rejection) and still reached the writer's guard.
      expect(resolvingD1.batch).toHaveBeenCalledTimes(1);

      // Result-level `success: false` (no error field) poisons every category
      // stream at the armed sequence; progress was never confirmed.
      for (const category of ['base', 'profanity', 'criminal']) {
        const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
        expect(state.poisoned).toBe(true);
        expect(state.firstPoisonedSeq).toBe(1);
        expect(state.reason).toBe('d1_write_failed');
      }

      // Legacy KV writes kept despite the result-level D1 failure.
      expect(resolvingKv.map.get('stats_v2:123:2026-05-07:456')).toBe('1');
      expect(resolvingKv.map.get('activity_hour:123:2026-05-07:13')).toBe('1');

      // The failed write is never represented as confirmed progress.
      const snapshot = await post(resolvingCounters, '/pipeline-snapshot', { day: '2026-05-07' });
      expect(snapshot.status).toBe(200);
      const body = await snapshot.json() as {
        categories: { base: { clean: boolean }; profanity: { clean: boolean }; criminal: { clean: boolean } };
      };
      expect(body.categories.base.clean).toBe(false);
      expect(body.categories.profanity.clean).toBe(false);
      expect(body.categories.criminal.clean).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('treats a resolving criminal D1 batch with a per-statement error as a failed write: criminal integrity poisoned, KV kept, progress unconfirmed', async () => {
    const stateMap = new Map<string, unknown>();
    const resolvingD1 = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async (statements: unknown[]) =>
        statements.map((_, i) =>
          i === 0
            ? { success: false, results: [], meta: {}, error: 'constraint failed' }
            : { success: true, results: [], meta: {} },
        ),
      ),
    };
    const { env, kv: resolvingKv } = makeEnv(resolvingD1, stateMap);
    const resolvingCounters = new CountersDO(makeState(stateMap), env);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await post(resolvingCounters, '/criminal', {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2026-05-07',
        violations: [{ article: '282', severity: 5, count: 1 }],
        totalSeverity: 5,
        sequence: 1,
        messageId: 83,
      });
      // A resolved per-statement failure is a failed write: the route surfaces
      // it as non-2xx so the async caller never treats it as completion.
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('error');
      // The batch resolved (no rejection) and still reached the writer's guard.
      expect(resolvingD1.batch).toHaveBeenCalledTimes(1);

      // Result-level error poisons the criminal stream at the armed sequence;
      // the resolving-but-failed batch never confirmed progress.
      const criminal = stateMap.get('integrity:2026-05-07:criminal') as Record<string, unknown>;
      expect(criminal.poisoned).toBe(true);
      expect(criminal.firstPoisonedSeq).toBe(1);
      expect(criminal.reason).toBe('d1_write_failed');

      // Unrelated categories are not newly poisoned by the criminal-only failure.
      for (const category of ['base', 'profanity']) {
        const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
        expect(state).toBeUndefined();
      }

      // Legacy KV writes kept despite the result-level D1 failure.
      expect(resolvingKv.map.get('criminal:123:456:2026-05-07')).toBe('1');
      expect(resolvingKv.map.get('criminal_severity:123:456:2026-05-07')).toBe('5');

      // The failed write is never represented as confirmed progress: sequence 1
      // is absent (the failed write), no completedPrefix advance is saved.
      const progress = stateMap.get('progress:2026-05-07:criminal') as Record<string, unknown>;
      expect(progress).toBeUndefined();

      // Raw D1 error details never leave the writer's generic failure.
      const allOutput = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(allOutput).not.toContain('constraint failed');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not throw on arbitrary non-Error D1 failure', async () => {
    const { env, kv: failingKv } = makeEnv({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'unexpected failure';
      }),
    });
    const failingCounters = new CountersDO(makeState(), env);

    const response = await post(failingCounters, '/inc', basePayload());
    expect(response.status).toBe(200);
    expect(failingKv.map.get('stats_v2:123:2026-05-07:456')).toBe('1');
  });

  it('excludes PII embedded in counter errors from console output', async () => {
    const pii = 'alice@example.test telegram-user-456';
    const { env } = makeEnv(harness as unknown as D1Database);
    const failingState = {
      blockConcurrencyWhile: vi.fn(async () => {
        throw new Error(`counter failure for ${pii}`);
      }),
    } as any;
    const failingCounters = new CountersDO(failingState, env);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await post(failingCounters, '/inc', basePayload({ username: pii }));

      expect(response.status).toBe(500);
      expect(consoleErrorSpy).toHaveBeenCalledWith('counter operation error', {
        operation: 'increment',
        errorClass: 'Error',
        errorCode: 'COUNTER_OPERATION_FAILED',
      });
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(pii);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('logs exclude numeric and base36-encoded chat/user IDs on error', async () => {
    const chatId = 999888777;
    const userId = 111222333;
    const base36Chat = chatId.toString(36);
    const base36User = userId.toString(36);
    const { env } = makeEnv(harness as unknown as D1Database);
    const failingState = {
      blockConcurrencyWhile: vi.fn(async () => {
        throw new Error('forced');
      }),
    } as any;
    const failingCounters = new CountersDO(failingState, env);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await post(failingCounters, '/inc', { ...basePayload(), chatId, userId });

      const allOutput = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(allOutput).not.toContain(String(chatId));
      expect(allOutput).not.toContain(String(userId));
      expect(allOutput).not.toContain(base36Chat);
      expect(allOutput).not.toContain(base36User);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('logs exclude numeric and base36-encoded IDs on D1 failure', async () => {
    const chatId = 999888777;
    const userId = 111222333;
    const base36Chat = chatId.toString(36);
    const base36User = userId.toString(36);
    const { env } = makeEnv({
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async () => { throw new Error('d1 down'); }),
    });
    const failingCounters = new CountersDO(makeState(), env);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await post(failingCounters, '/inc', { ...basePayload(), chatId, userId });

      const allOutput = JSON.stringify(consoleErrorSpy.mock.calls);
      expect(allOutput).not.toContain(String(chatId));
      expect(allOutput).not.toContain(String(userId));
      expect(allOutput).not.toContain(base36Chat);
      expect(allOutput).not.toContain(base36User);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('keeps existing counter return payloads plus the allocated day/sequence', async () => {
    const response = await post(counters, '/inc', basePayload());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      userDayCount: 1,
      chatDayActivity: 1,
      userDayWordCount: 4,
      chatDayWords: 4,
      day: '2026-05-07',
      sequence: 1,
    });
  });

  it('records base complete and async pending progress in the same D1 batch as base aggregates', async () => {
    await post(counters, '/inc', basePayload({ messageId: 11 }));

    const progress = rows(
      harness.sqlite,
      'SELECT category, accepted_seq, completed_seq, pending_count, failed_count FROM stats_daily_pipeline_progress WHERE chat_id = 123 AND day = ? ORDER BY category',
      ['2026-05-07'],
    );
    expect(progress).toEqual([
      { category: 'base', accepted_seq: 1, completed_seq: 1, pending_count: 0, failed_count: 0 },
      { category: 'criminal', accepted_seq: 1, completed_seq: 0, pending_count: 1, failed_count: 0 },
      { category: 'profanity', accepted_seq: 1, completed_seq: 0, pending_count: 1, failed_count: 0 },
    ]);
    // Base aggregate write and progress share one atomic batch.
    expect(harness.batchCalls).toBe(1);
  });

  it('allocates day-local monotonic sequences and is idempotent by messageId', async () => {
    const first = await post(counters, '/inc', basePayload({ messageId: 21 }));
    const second = await post(counters, '/inc', basePayload({ messageId: 22 }));
    expect((await first.json() as any).sequence).toBe(1);
    expect((await second.json() as any).sequence).toBe(2);

    // Retry of messageId 21 returns the same sequence and never double-counts.
    const retry = await post(counters, '/inc', basePayload({ messageId: 21 }));
    expect((await retry.json() as any).sequence).toBe(1);

    const user = rows(
      harness.sqlite,
      'SELECT message_count FROM stats_daily_user WHERE chat_id = 123 AND day = ? AND user_id = 456',
      ['2026-05-07'],
    )[0];
    expect(user.message_count).toBe(2);

    const base = rows(
      harness.sqlite,
      'SELECT accepted_seq, completed_seq FROM stats_daily_pipeline_progress WHERE chat_id = 123 AND day = ? AND category = ?',
      ['2026-05-07', 'base'],
    )[0];
    expect(base.accepted_seq).toBe(2);
    expect(base.completed_seq).toBe(2);
  });

  it('/ack advances contiguous completion for zero and skipped outcomes', async () => {
    await post(counters, '/inc', basePayload({ messageId: 31 }));
    await post(counters, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'profanity',
      messageId: 31,
      sequence: 1,
      outcome: 'zero',
    });
    await post(counters, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'criminal',
      messageId: 31,
      sequence: 1,
      outcome: 'skipped',
    });

    const profanity = rows(
      harness.sqlite,
      'SELECT completed_seq, pending_count, failed_count FROM stats_daily_pipeline_progress WHERE chat_id = 123 AND day = ? AND category = ?',
      ['2026-05-07', 'profanity'],
    )[0];
    expect(profanity).toEqual({ completed_seq: 1, pending_count: 0, failed_count: 0 });

    const criminal = rows(
      harness.sqlite,
      'SELECT completed_seq, pending_count, failed_count FROM stats_daily_pipeline_progress WHERE chat_id = 123 AND day = ? AND category = ?',
      ['2026-05-07', 'criminal'],
    )[0];
    expect(criminal).toEqual({ completed_seq: 1, pending_count: 0, failed_count: 0 });
  });

  it('/ack failed never represents a permanent failure as zero', async () => {
    await post(counters, '/inc', basePayload({ messageId: 41 }));
    await post(counters, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'profanity',
      messageId: 41,
      sequence: 1,
      outcome: 'failed',
    });

    const profanity = rows(
      harness.sqlite,
      'SELECT completed_seq, pending_count, failed_count FROM stats_daily_pipeline_progress WHERE chat_id = 123 AND day = ? AND category = ?',
      ['2026-05-07', 'profanity'],
    )[0];
    expect(profanity.failed_count).toBe(1);
    expect(profanity.pending_count).toBe(0);
    expect(profanity.completed_seq).toBe(0);
  });

  it('poisons all three category integrity streams when a base D1 batch fails and a later success cannot unpoison them', async () => {
    // Sequence 1 fails the base D1 batch; sequence 2 succeeds.
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const failingCounters = new CountersDO(makeState(stateMap), env);
    let batchCall = 0;
    const origBatch = harness.batch.bind(harness);
    harness.batch = vi.fn(async (statements: FakeD1Statement[]) => {
      batchCall += 1;
      if (batchCall === 1) {
        throw new Error('d1 unavailable');
      }
      return origBatch(statements);
    });

    const first = await post(failingCounters, '/inc', basePayload({ messageId: 51 }));
    expect(first.status).toBe(200);
    const second = await post(failingCounters, '/inc', basePayload({ messageId: 52 }));
    expect(second.status).toBe(200);
    expect((await second.json() as any).sequence).toBe(2);
    // Both the armed attempt at 1 and the successful attempt at 2 hit D1.
    expect(batchCall).toBe(2);

    for (const category of ['base', 'profanity', 'criminal']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(state.poisoned).toBe(true);
      expect(state.firstPoisonedSeq).toBe(1);
      expect(state.reason).toBe('d1_write_failed');
    }
  });

  it('recovers a stale active attempt as ambiguous poison before the next base write and keeps it after success', async () => {
    const stateMap = new Map<string, unknown>();
    for (const category of ['base', 'profanity', 'criminal']) {
      // Pre-existing active attempt from a prior request whose D1 outcome is unknown.
      stateMap.set(`integrity:2026-05-07:${category}`, {
        activeAttemptSeq: 1,
        poisoned: false,
        firstPoisonedSeq: null,
        reason: null,
      });
    }
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const countersWithStale = new CountersDO(makeState(stateMap), env);

    const response = await post(countersWithStale, '/inc', basePayload({ messageId: 61 }));
    expect(response.status).toBe(200);

    for (const category of ['base', 'profanity', 'criminal']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      // Stale attempt recovered as ambiguous poison, then the new sequence armed;
      // the later successful D1 batch confirms only the new attempt and can
      // never clear the ambiguous poison.
      expect(state.poisoned).toBe(true);
      expect(state.firstPoisonedSeq).toBe(1);
      expect(state.reason).toBe('ambiguous_attempt');
      expect(state.activeAttemptSeq).toBeNull();
    }
  });

  it('recovers a crash between integrity arm and sequence persistence as ambiguous poison; later D1 success cannot clean any category', async () => {
    const stateMap = new Map<string, unknown>();
    const seqKey = 'seq:2026-05-07';
    let seqPuts = 0;
    const crashingState = {
      blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()),
      storage: {
        get: vi.fn(async <T>(key: string): Promise<T | undefined> => stateMap.get(key) as T | undefined),
        put: vi.fn(async (key: string, value: unknown) => {
          // Simulate a process crash: the all-category arm was persisted before
          // the sequence write, which fails exactly once.
          if (key === seqKey) {
            seqPuts += 1;
            if (seqPuts === 1) {
              throw new Error('durable storage fault');
            }
          }
          stateMap.set(key, value);
        }),
      },
    } as any;
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const crashedCounters = new CountersDO(crashingState, env);

    // Crash: the fence is armed (active attempt at 1) but the sequence was
    // never persisted, so no acceptance exists yet.
    const first = await post(crashedCounters, '/inc', basePayload({ messageId: 111 }));
    expect(first.status).toBe(500);
    expect(stateMap.has(seqKey)).toBe(false);
    for (const category of ['base', 'profanity', 'criminal']) {
      const integrity = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(integrity).toEqual({ activeAttemptSeq: 1, poisoned: false, firstPoisonedSeq: null, reason: null });
    }

    // Next /inc: recovers the stale active attempt as sticky ambiguous poison
    // before re-allocating the never-accepted sequence 1, and the successful D1
    // batch confirms only the new attempt — it can never make any category clean.
    const second = await post(crashedCounters, '/inc', basePayload({ messageId: 112 }));
    expect(second.status).toBe(200);
    expect((await second.json() as any).sequence).toBe(1);
    for (const category of ['base', 'profanity', 'criminal']) {
      const integrity = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(integrity.poisoned).toBe(true);
      expect(integrity.firstPoisonedSeq).toBe(1);
      expect(integrity.reason).toBe('ambiguous_attempt');
      expect(integrity.activeAttemptSeq).toBeNull();
      expect(isIntegrityClean(integrity as any)).toBe(false);
    }

    // The later D1 success and snapshot still report every category not clean.
    const snapshot = await post(crashedCounters, '/pipeline-snapshot', { day: '2026-05-07' });
    expect(snapshot.status).toBe(200);
    const body = await snapshot.json() as {
      accepted: number;
      categories: { base: { clean: boolean }; profanity: { clean: boolean }; criminal: { clean: boolean } };
    };
    expect(body.accepted).toBe(1);
    expect(body.categories.base.clean).toBe(false);
    expect(body.categories.profanity.clean).toBe(false);
    expect(body.categories.criminal.clean).toBe(false);
  });

  it('poisons only the profanity stream when its aggregate batch fails, even after a later successful profanity write', async () => {
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const failingCounters = new CountersDO(makeState(stateMap), env);
    let batchCall = 0;
    const origBatch = harness.batch.bind(harness);
    harness.batch = vi.fn(async (statements: FakeD1Statement[]) => {
      batchCall += 1;
      // The first profanity aggregate batch (sequence 1) fails; the second (sequence 2) succeeds.
      if (batchCall === 1) {
        throw new Error('d1 unavailable');
      }
      return origBatch(statements);
    });

    const first = await post(failingCounters, '/profanity', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      count: 1,
      words: [{ baseForm: 'хуй', count: 1 }],
      sequence: 1,
      messageId: 71,
    });
    // Failed sequence-bearing aggregate write surfaces as non-2xx.
    expect(first.status).toBe(500);
    const second = await post(failingCounters, '/profanity', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      count: 1,
      words: [{ baseForm: 'хуй', count: 1 }],
      sequence: 2,
      messageId: 72,
    });
    expect(second.status).toBe(200);

    // Only the profanity stream is poisoned at the failed sequence 1.
    const profanity = stateMap.get('integrity:2026-05-07:profanity') as Record<string, unknown>;
    expect(profanity.poisoned).toBe(true);
    expect(profanity.firstPoisonedSeq).toBe(1);
    expect(profanity.reason).toBe('d1_write_failed');
    // Unrelated categories are not newly poisoned by the category-only failure.
    for (const category of ['base', 'criminal']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(state).toBeUndefined();
    }
    // The failed D1 write never advanced saved profanity progress to completed:
    // sequence 1 is absent (the failed write), only the later successful
    // sequence 2 is tracked as an out-of-order gap.
    const progress = stateMap.get('progress:2026-05-07:profanity') as Record<string, unknown>;
    expect(progress).toEqual({ completedPrefix: 0, gaps: [2], failed: [] });
  });

  it('poisons only the criminal stream when its aggregate batch fails, even after a later successful criminal write', async () => {
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const failingCounters = new CountersDO(makeState(stateMap), env);
    let batchCall = 0;
    const origBatch = harness.batch.bind(harness);
    harness.batch = vi.fn(async (statements: FakeD1Statement[]) => {
      batchCall += 1;
      // The first criminal aggregate batch (sequence 1) fails; the second (sequence 2) succeeds.
      if (batchCall === 1) {
        throw new Error('d1 unavailable');
      }
      return origBatch(statements);
    });

    const first = await post(failingCounters, '/criminal', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      violations: [{ article: '282', severity: 5, count: 1 }],
      totalSeverity: 5,
      sequence: 1,
      messageId: 81,
    });
    // Failed sequence-bearing aggregate write surfaces as non-2xx.
    expect(first.status).toBe(500);
    const second = await post(failingCounters, '/criminal', {
      chatId: 123,
      userId: 456,
      username: 'testuser',
      day: '2026-05-07',
      violations: [{ article: '282', severity: 5, count: 1 }],
      totalSeverity: 5,
      sequence: 2,
      messageId: 82,
    });
    expect(second.status).toBe(200);

    const criminal = stateMap.get('integrity:2026-05-07:criminal') as Record<string, unknown>;
    expect(criminal.poisoned).toBe(true);
    expect(criminal.firstPoisonedSeq).toBe(1);
    expect(criminal.reason).toBe('d1_write_failed');
    // Unrelated categories are not newly poisoned by the category-only failure.
    for (const category of ['base', 'profanity']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(state).toBeUndefined();
    }
    // The failed D1 write never advanced saved criminal progress to completed:
    // sequence 1 is absent (the failed write), only the later successful
    // sequence 2 is tracked as an out-of-order gap.
    const progress = stateMap.get('progress:2026-05-07:criminal') as Record<string, unknown>;
    expect(progress).toEqual({ completedPrefix: 0, gaps: [2], failed: [] });
  });

  it('poisons only the acked category stream when its ack-only progress batch fails, even after a later successful ack', async () => {
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const countersWithFailures = new CountersDO(makeState(stateMap), env);

    // A base message allocates sequence 1 (one D1 batch).
    await post(countersWithFailures, '/inc', basePayload({ messageId: 91 }));

    let batchCall = 0;
    const origBatch = harness.batch.bind(harness);
    harness.batch = vi.fn(async (statements: FakeD1Statement[]) => {
      batchCall += 1;
      // The first ack-only progress batch (sequence 1) fails; the second (sequence 2) succeeds.
      if (batchCall === 1) {
        throw new Error('d1 unavailable');
      }
      return origBatch(statements);
    });

    const firstAck = await post(countersWithFailures, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'profanity',
      messageId: 91,
      sequence: 1,
      outcome: 'zero',
    });
    // Failed ack-only progress batch surfaces as non-2xx.
    expect(firstAck.status).toBe(500);
    // A second base message allocates sequence 2 before its ack.
    await post(countersWithFailures, '/inc', basePayload({ messageId: 92 }));
    const secondAck = await post(countersWithFailures, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'profanity',
      messageId: 92,
      sequence: 2,
      outcome: 'zero',
    });
    expect(secondAck.status).toBe(200);

    const profanity = stateMap.get('integrity:2026-05-07:profanity') as Record<string, unknown>;
    expect(profanity.poisoned).toBe(true);
    expect(profanity.firstPoisonedSeq).toBe(1);
    expect(profanity.reason).toBe('d1_write_failed');
    // Unrelated categories are not newly poisoned by the ack-only failure: the
    // base marker from the initial /inc was armed and confirmed cleanly.
    for (const category of ['base', 'criminal']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(state).toEqual({ activeAttemptSeq: null, poisoned: false, firstPoisonedSeq: null, reason: null });
    }
    // The failed ack never advanced saved profanity progress to completed:
    // sequence 1 is absent (the failed write), only the later successful
    // sequence 2 is tracked as an out-of-order gap.
    const progress = stateMap.get('progress:2026-05-07:profanity') as Record<string, unknown>;
    expect(progress).toEqual({ completedPrefix: 0, gaps: [2], failed: [] });
  });

  it('a successful failed-terminal ack updates existing failed counters; only D1 I/O failure sets integrity poison', async () => {
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const countersWithFailures = new CountersDO(makeState(stateMap), env);

    // A base message allocates sequence 1 (one D1 batch).
    await post(countersWithFailures, '/inc', basePayload({ messageId: 101 }));

    let batchCall = 0;
    const origBatch = harness.batch.bind(harness);
    harness.batch = vi.fn(async (statements: FakeD1Statement[]) => {
      batchCall += 1;
      if (batchCall === 1) {
        throw new Error('d1 unavailable');
      }
      return origBatch(statements);
    });

    const failedAck = await post(countersWithFailures, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'profanity',
      messageId: 101,
      sequence: 1,
      outcome: 'failed',
    });
    // Failed D1 write surfaces as non-2xx, not terminal success.
    expect(failedAck.status).toBe(500);
    // Failed D1 write: no local progress was persisted.
    expect(stateMap.get('progress:2026-05-07:profanity')).toBeUndefined();

    const successfulAck = await post(countersWithFailures, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'profanity',
      messageId: 102,
      sequence: 2,
      outcome: 'failed',
    });
    expect(successfulAck.status).toBe(200);

    // Successful failed-terminal ack: poison stays from the earlier D1 I/O
    // failure and the failed count is recorded in local progress.
    const profanityIntegrity = stateMap.get('integrity:2026-05-07:profanity') as Record<string, unknown>;
    expect(profanityIntegrity.poisoned).toBe(true);
    expect(profanityIntegrity.firstPoisonedSeq).toBe(1);
    expect(profanityIntegrity.reason).toBe('d1_write_failed');
    const progress = stateMap.get('progress:2026-05-07:profanity') as Record<string, unknown>;
    expect(progress).toEqual({ completedPrefix: 0, gaps: [], failed: [2] });
  });

  it('/pipeline-snapshot reports clean all-complete state for a fully acked day', async () => {
    await post(counters, '/inc', basePayload({ messageId: 11 }));
    await post(counters, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'profanity',
      messageId: 11,
      sequence: 1,
      outcome: 'zero',
    });
    await post(counters, '/ack', {
      chatId: 123,
      day: '2026-05-07',
      category: 'criminal',
      messageId: 11,
      sequence: 1,
      outcome: 'skipped',
    });

    const response = await post(counters, '/pipeline-snapshot', { day: '2026-05-07' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      day: '2026-05-07',
      accepted: 1,
      categories: {
        base: { accepted: 1, completed: 1, pending: 0, failed: 0, clean: true },
        profanity: { accepted: 1, completed: 1, pending: 0, failed: 0, clean: true },
        criminal: { accepted: 1, completed: 1, pending: 0, failed: 0, clean: true },
      },
    });
  });

  it('/pipeline-snapshot reports pending analysis while async work is outstanding', async () => {
    await post(counters, '/inc', basePayload({ messageId: 12 }));

    const response = await post(counters, '/pipeline-snapshot', { day: '2026-05-07' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      day: '2026-05-07',
      accepted: 1,
      categories: {
        base: { accepted: 1, completed: 1, pending: 0, failed: 0, clean: true },
        profanity: { accepted: 1, completed: 0, pending: 1, failed: 0, clean: true },
        criminal: { accepted: 1, completed: 0, pending: 1, failed: 0, clean: true },
      },
    });
  });

  it('recovers a stale active integrity attempt before snapshotting and reports not clean', async () => {
    const stateMap = new Map<string, unknown>();
    for (const category of ['base', 'profanity', 'criminal']) {
      stateMap.set(`integrity:2026-05-07:${category}`, {
        activeAttemptSeq: 1,
        poisoned: false,
        firstPoisonedSeq: null,
        reason: null,
      });
    }
    const { env: snapshotEnv } = makeEnv(harness as unknown as D1Database, stateMap);
    const snapshotCounters = new CountersDO(makeState(stateMap), snapshotEnv);

    const response = await post(snapshotCounters, '/pipeline-snapshot', { day: '2026-05-07' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      day: '2026-05-07',
      accepted: 0,
      categories: {
        base: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
        profanity: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
        criminal: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
      },
    });

    // Recovery was persisted: every stream is now sticky-poisoned ambiguous
    // with no active attempt, so a later snapshot stays not clean.
    for (const category of ['base', 'profanity', 'criminal']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(state.poisoned).toBe(true);
      expect(state.firstPoisonedSeq).toBe(1);
      expect(state.reason).toBe('ambiguous_attempt');
      expect(isIntegrityClean(state as any)).toBe(false);
    }
  });

  it('/pipeline-snapshot returns 400 for an invalid or missing day', async () => {
    expect((await post(counters, '/pipeline-snapshot', {})).status).toBe(400);
    expect((await post(counters, '/pipeline-snapshot', { day: 'yesterday' })).status).toBe(400);
    expect((await post(counters, '/pipeline-snapshot', { day: 42 })).status).toBe(400);
  });

  it('persists the day proof marker before a failing base D1 batch and a later success never erases it', async () => {
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const failingCounters = new CountersDO(makeState(stateMap), env);
    const failingD1 = {
      prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
      batch: vi.fn(async () => {
        throw new Error('d1 unavailable');
      }),
    };
    const { env: failingEnv, kv: failingKv } = makeEnv(failingD1, stateMap);
    const proofCounters = new CountersDO(makeState(stateMap), failingEnv);

    // Failing base D1 batch: marker must exist, integrity streams poisoned.
    const first = await post(proofCounters, '/inc', basePayload({ messageId: 51 }));
    expect(first.status).toBe(200);
    expect(stateMap.get('dayproof:2026-05-07')).toEqual({ version: 1, initialized: true });
    for (const category of ['base', 'profanity', 'criminal']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(state.poisoned).toBe(true);
      expect(state.reason).toBe('d1_write_failed');
    }
    expect(failingKv.map.get('stats_v2:123:2026-05-07:456')).toBe('1');

    // Later successful base write on the healthy D1: marker kept, not rewritten.
    const second = await post(failingCounters, '/inc', basePayload({ messageId: 52 }));
    expect(second.status).toBe(200);
    expect(stateMap.get('dayproof:2026-05-07')).toEqual({ version: 1, initialized: true });
  });

  it('/pipeline-snapshots returns ordered deduplicated marked day snapshots', async () => {
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const proofCounters = new CountersDO(makeState(stateMap), env);

    await post(proofCounters, '/inc', basePayload({ day: '2026-05-07', messageId: 11 }));
    await post(proofCounters, '/inc', basePayload({ day: '2026-05-08', messageId: 12 }));

    const response = await post(proofCounters, '/pipeline-snapshots', {
      days: ['2026-05-08', '2026-05-07', '2026-05-08'],
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      version: number;
      days: Array<{
        day: string;
        version: number;
        initialized: boolean;
        accepted: number;
        categories: { base: { clean: boolean } };
      }>;
    };
    expect(body.version).toBe(1);
    // Deduplicated while preserving request order.
    expect(body.days.map((d) => d.day)).toEqual(['2026-05-08', '2026-05-07']);
    for (const snapshot of body.days) {
      expect(snapshot.initialized).toBe(true);
      expect(snapshot.version).toBe(1);
      expect(snapshot.accepted).toBe(1);
      expect(snapshot.categories.base.clean).toBe(true);
    }
  });

  it('/pipeline-snapshots reports explicit initialized:false for a missing or malformed marker day', async () => {
    const stateMap = new Map<string, unknown>();
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const proofCounters = new CountersDO(makeState(stateMap), env);

    // Wrong-version stored marker: malformed, must be reported unproven.
    stateMap.set('dayproof:2026-05-08', { version: 999, initialized: true });

    const response = await post(proofCounters, '/pipeline-snapshots', {
      days: ['2026-05-07', '2026-05-08'],
    });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      version: number;
      days: Array<{
        day: string;
        version: number;
        initialized: boolean;
        accepted: number;
        categories: { base: { accepted: number; completed: number; pending: number; failed: number; clean: boolean } };
      }>;
    };
    expect(body.version).toBe(1);
    expect(body.days).toEqual([
      {
        day: '2026-05-07',
        version: 1,
        initialized: false,
        accepted: 0,
        categories: {
          base: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
          profanity: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
          criminal: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
        },
      },
      {
        day: '2026-05-08',
        version: 1,
        initialized: false,
        accepted: 0,
        categories: {
          base: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
          profanity: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
          criminal: { accepted: 0, completed: 0, pending: 0, failed: 0, clean: false },
        },
      },
    ]);
  });

  it('/pipeline-snapshots recovers a stale active attempt before snapshotting a marked day and reports poisoned', async () => {
    const stateMap = new Map<string, unknown>();
    stateMap.set('dayproof:2026-05-07', { version: 1, initialized: true });
    for (const category of ['base', 'profanity', 'criminal']) {
      stateMap.set(`integrity:2026-05-07:${category}`, {
        activeAttemptSeq: 1,
        poisoned: false,
        firstPoisonedSeq: null,
        reason: null,
      });
    }
    const { env } = makeEnv(harness as unknown as D1Database, stateMap);
    const proofCounters = new CountersDO(makeState(stateMap), env);

    const response = await post(proofCounters, '/pipeline-snapshots', { days: ['2026-05-07'] });
    expect(response.status).toBe(200);
    const body = await response.json() as {
      days: Array<{
        initialized: boolean;
        accepted: number;
        categories: { base: { clean: boolean } };
      }>;
    };
    expect(body.days[0].initialized).toBe(true);
    expect(body.days[0].accepted).toBe(0);
    expect(body.days[0].categories.base.clean).toBe(false);

    // Recovery persisted: every stream sticky-poisoned ambiguous, no active attempt.
    for (const category of ['base', 'profanity', 'criminal']) {
      const state = stateMap.get(`integrity:2026-05-07:${category}`) as Record<string, unknown>;
      expect(state.poisoned).toBe(true);
      expect(state.firstPoisonedSeq).toBe(1);
      expect(state.reason).toBe('ambiguous_attempt');
      expect(state.activeAttemptSeq).toBeNull();
    }
  });

  it('/pipeline-snapshots returns 400 for invalid or over-30 days input', async () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
    );
    expect((await post(counters, '/pipeline-snapshots', {})).status).toBe(400);
    expect((await post(counters, '/pipeline-snapshots', { days: [] })).status).toBe(400);
    expect((await post(counters, '/pipeline-snapshots', { days: ['yesterday'] })).status).toBe(400);
    expect((await post(counters, '/pipeline-snapshots', { days: [42] })).status).toBe(400);
    expect((await post(counters, '/pipeline-snapshots', { days: many })).status).toBe(400);
    expect((await post(counters, '/pipeline-snapshots', { days: ['not-a-date'] })).status).toBe(400);
  });
});
