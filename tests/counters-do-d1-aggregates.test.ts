import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@miniflare/storage-memory';
import type { D1Database } from '@cloudflare/workers-types';
import { CountersDO } from '../src/durable-objects/counters-do';

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

function makeState() {
  return { blockConcurrencyWhile: vi.fn((fn: () => Promise<unknown>) => fn()) } as any;
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

  it('keeps existing counter return payloads unchanged', async () => {
    const response = await post(counters, '/inc', basePayload());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      userDayCount: 1,
      chatDayActivity: 1,
      userDayWordCount: 4,
      chatDayWords: 4,
    });
  });
});
