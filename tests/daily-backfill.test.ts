import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@miniflare/storage-memory';
import type { D1Database } from '@cloudflare/workers-types';
import {
  BACKFILL_CRON,
  DAILY_SUMMARY_CRON,
  JOB_NAME,
  JOB_VERSION,
  LEASE_TTL_SECONDS,
  MAX_COVERAGE_ROWS_PER_RUN,
  MAX_KEYS_PER_RUN,
  runDailyAggregateBackfill,
} from '../src/features/stats/daily-backfill';
import { writeActivityAggregates } from '../src/features/stats/d1-aggregate-writer';
import { isD1RangeReady } from '../src/features/stats/d1-coverage';
import { getAdminChatStatsFromD1 } from '../src/features/stats/admin-stats-d1';

/**
 * Phase 3a (corrected) backfill tests. Uses a real in-memory SQLite database
 * (via @miniflare/storage-memory MemoryStorage.getSqliteDatabase, backed by
 * better-sqlite3) with the actual migration DDL applied (0002, 0009, 0010),
 * and a cursor-capable Map-backed KV mock with prefix listing so page
 * traversal, in-page resume, absolute upserts, the D1 lease, and parity-gated
 * coverage all run against realistic primitives.
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

const NOW = new Date('2026-08-28T10:00:00.000Z');
const CUTOFF_DAY = '2026-08-28';

interface PreparedStatementLogEntry {
  sql: string;
  params: unknown[];
  operation: 'run' | 'all' | 'first';
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
    this.owner.logPrepared(this, 'run');
    const result = this.owner.sqlite.prepare(this.owner.atD1Clock(this.sql)).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes } };
  }

  all<T = unknown>(): { results: T[]; success: boolean; meta: Record<string, unknown> } {
    this.owner.logPrepared(this, 'all');
    const results = this.owner.sqlite.prepare(this.owner.atD1Clock(this.sql)).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }

  first<T = unknown>(): T | null {
    this.owner.logPrepared(this, 'first');
    const results = this.owner.sqlite.prepare(this.owner.atD1Clock(this.sql)).all(...this.params) as T[];
    return results.length > 0 ? results[0] : null;
  }
}

class FakeD1Database {
  readonly sqlite: Sqlite;
  batchCalls = 0;
  prepareCalls = 0;
  statementExecutions = 0;
  preparedLog: PreparedStatementLogEntry[] = [];
  clockSec = Math.floor(NOW.getTime() / 1000);
  advanceClockAfterBatchAdmission: number | null = null;

  constructor(sqlite: Sqlite) {
    this.sqlite = sqlite;
  }

  prepare(sql: string): FakeD1Statement {
    this.prepareCalls += 1;
    return new FakeD1Statement(this, sql);
  }

  logPrepared(stmt: FakeD1Statement, operation: PreparedStatementLogEntry['operation']): void {
    this.statementExecutions += 1;
    this.preparedLog.push({ sql: stmt.sql, params: stmt.params, operation });
  }

  atD1Clock(sql: string): string {
    return sql.replaceAll("unixepoch('now')", String(this.clockSec));
  }

  async batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    this.batchCalls += 1;
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((stmt, index) => {
        this.logPrepared(stmt, 'run');
        const sql = this.atD1Clock(stmt.sql);
        if (/^\s*SELECT/i.test(stmt.sql)) {
          return { success: true, results: this.sqlite.prepare(sql).all(...stmt.params), meta: {} };
        }
        const result = this.sqlite.prepare(sql).run(...stmt.params);
        if (index === 0 && this.advanceClockAfterBatchAdmission !== null) {
          this.clockSec += this.advanceClockAfterBatchAdmission;
          this.advanceClockAfterBatchAdmission = null;
        }
        return { success: true, results: [], meta: { changes: result.changes } };
      });
      this.sqlite.exec('COMMIT');
      return results;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
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

/** Cursor-capable KV mock: cursor is a stable page-start index. */
function createKv(pageSize = 1000) {
  const map = new Map<string, string>();
  const kv = {
    map,
    get: vi.fn(async (key: string) => map.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      map.delete(key);
    }),
    list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
      const prefix = options?.prefix ?? '';
      const keys = Array.from(map.keys())
        .filter((key) => key.startsWith(prefix))
        .sort();
      const start = options?.cursor ? parseInt(options.cursor, 10) : 0;
      const slice = keys.slice(start, start + pageSize);
      const next = start + pageSize;
      return {
        keys: slice.map((name) => ({ name })),
        list_complete: next >= keys.length,
        cursor: next < keys.length ? String(next) : undefined,
      };
    }),
  };
  return { map, kv: kv as any };
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

/** Runs the backfill to completion (resumable by design), bounding the loop. */
async function runToCompletion(env: any, maxRuns = 60): Promise<any> {
  let summary;
  for (let i = 0; i < maxRuns; i += 1) {
    summary = await runDailyAggregateBackfill(env, NOW);
    if (summary.done) return summary;
  }
  throw new Error(`backfill did not complete within ${maxRuns} runs`);
}

/** Runs until the given phase is next (i.e. the phase has been entered). */
async function runUntilPhase(env: any, phase: string, maxRuns = 60): Promise<any> {
  let summary;
  for (let i = 0; i < maxRuns; i += 1) {
    summary = await runDailyAggregateBackfill(env, NOW);
    if (summary.done || summary.phase === phase) return summary;
  }
  throw new Error(`backfill did not reach phase ${phase} within ${maxRuns} runs`);
}

function coverageRow(sqlite: Sqlite, chatId: number, day: string): any {
  return rows(
    sqlite,
    'SELECT base_status, profanity_status, criminal_status, source, reason_code FROM stats_daily_coverage WHERE chat_id = ? AND day = ?',
    [chatId, day],
  )[0];
}

function replay(sqlite: Sqlite, statement: PreparedStatementLogEntry): { changes: number } {
  return sqlite.prepare(statement.sql).run(...(statement.params as SQLInputValue[])) as { changes: number };
}

function loggedStatement(harness: FakeD1Database, prefix: string): PreparedStatementLogEntry {
  const statement = harness.preparedLog.find((entry) => entry.sql.includes(prefix));
  if (!statement) throw new Error(`missing prepared statement: ${prefix}`);
  return { ...statement, params: [...statement.params] };
}

function seedActivity(sqlite: Sqlite, chatId: number, day: string, count: number): void {
  sqlite
    .prepare('INSERT INTO activity (chat_id, day, count) VALUES (?, ?, ?)')
    .run(chatId, day, count);
}

/** Seeds the standard cross-phase fixture (see the main pipeline test). */
function seedStandardCounters(map: Map<string, string>, sqlite: Sqlite): void {
  // Chat 1, day 2026-08-27: complete base + profanity + hours + buckets + words.
  map.set('stats_v2:1:2026-08-27:100', '5');
  map.set('word_stats_v2:1:2026-08-27:100', '40');
  map.set('media_stats_v2:1:2026-08-27:100:voice', '2');
  map.set('media_duration_v2:1:2026-08-27:100:voice', '15');
  map.set('media_stats_v2:1:2026-08-27:100:video_note', '1');
  map.set('media_duration_v2:1:2026-08-27:100:video_note', '4');
  map.set('stats_v2:1:2026-08-27:200', '3');
  map.set('word_stats_v2:1:2026-08-27:200', '10');
  map.set('user:100', 'alice');
  map.set('user:200', 'bob');
  map.set('activity_hour:1:2026-08-27:09', '4');
  map.set('activity_hour:1:2026-08-27:10', '4');
  map.set('activity_time_bucket:1:2026-08-27:morning:100', '4');
  map.set('activity_time_bucket:1:2026-08-27:noon:100', '1');
  map.set('profanity:1:100:2026-08-27', '2');
  map.set('profanity:1:200:2026-08-27', '1');
  map.set('profanity_words:1:заебал:2026-08-27', '2');
  map.set('profanity_word_users:1:заебал:2026-08-27:100', '2');
  map.set('criminal:1:100:2026-08-27', '1');
  map.set('criminal_severity:1:100:2026-08-27', '6');
  seedActivity(sqlite, 1, '2026-08-27', 8);

  // Chat 1, day far older than 90 days: must still be backfilled (full history).
  map.set('stats_v2:1:2024-01-15:500', '7');
  map.set('word_stats_v2:1:2024-01-15:500', '21');
  map.set('user:500', 'dora');
  seedActivity(sqlite, 1, '2024-01-15', 7);

  // Chat 2, day 2026-08-26: legacy activity row missing → stays incomplete.
  map.set('stats_v2:2:2026-08-26:300', '2');
  map.set('word_stats_v2:2:2026-08-26:300', '4');
  map.set('user:300', 'carol');

  // Chat 3, day 2026-08-25: legacy activity total mismatches → stays incomplete.
  map.set('stats_v2:3:2026-08-25:400', '4');
  map.set('word_stats_v2:3:2026-08-25:400', '9');
  map.set('user:400', 'erin');
  seedActivity(sqlite, 3, '2026-08-25', 3);

  // Cutoff day and a future day: never backfilled, never completed.
  map.set('stats_v2:1:2026-08-28:100', '1');
  map.set('stats_v2:1:2026-08-29:100', '1');
}

describe('daily aggregate backfill (corrected Phase 3a)', () => {
  let harness: FakeD1Database;
  let kv: { map: Map<string, string>; kv: any };
  let env: any;

  beforeEach(async () => {
    const { db, harness: h } = await createRealD1();
    harness = h;
    const made = makeEnv(db);
    env = made.env;
    kv = made.kv;
  });

  afterEach(() => {
    harness.sqlite.close();
  });

  it('exposes the exact temporary one-minute cron and the daily cron', () => {
    expect(BACKFILL_CRON).toBe('* * * * *');
    expect(DAILY_SUMMARY_CRON).toBe('59 23 * * *');
  });

  it('backfills the full available modern history (including days older than 90 days)', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    const summary = await runToCompletion(env);

    expect(summary.done).toBe(true);
    expect(summary.errorCode).toBeNull();
    expect(summary.leaseBlocked).toBe(false);

    // Base absolute per-user values (all source-backed columns).
    const user100 = rows(
      harness.sqlite,
      'SELECT * FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 100',
      ['2026-08-27'],
    )[0];
    expect(user100.message_count).toBe(5);
    expect(user100.word_count).toBe(40);
    expect(user100.voice_count).toBe(2);
    expect(user100.voice_duration_seconds).toBe(15);
    expect(user100.video_note_count).toBe(1);
    expect(user100.video_note_duration_seconds).toBe(4);
    expect(user100.profanity_count).toBe(2);
    expect(user100.criminal_count).toBe(1);
    expect(user100.criminal_severity).toBe(6);

    const user200 = rows(
      harness.sqlite,
      'SELECT message_count, profanity_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 200',
      ['2026-08-27'],
    )[0];
    expect(user200.message_count).toBe(3);
    expect(user200.profanity_count).toBe(1);

    // Day more than 90 days before the cutoff is processed (no 90-day window).
    const oldDay = rows(
      harness.sqlite,
      'SELECT message_count, word_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 500',
      ['2024-01-15'],
    )[0];
    expect(oldDay.message_count).toBe(7);
    expect(oldDay.word_count).toBe(21);

    // Hours, buckets, profanity words and word-user rows are absolute.
    const hours = rows(
      harness.sqlite,
      'SELECT hour, message_count FROM stats_daily_hour WHERE chat_id = 1 AND day = ? ORDER BY hour',
      ['2026-08-27'],
    );
    expect(hours).toEqual([
      { hour: 9, message_count: 4 },
      { hour: 10, message_count: 4 },
    ]);
    const buckets = rows(
      harness.sqlite,
      'SELECT bucket, user_id, message_count FROM stats_daily_bucket_user WHERE chat_id = 1 AND day = ? ORDER BY bucket',
      ['2026-08-27'],
    );
    expect(buckets).toEqual([
      { bucket: 'morning', user_id: 100, message_count: 4 },
      { bucket: 'noon', user_id: 100, message_count: 1 },
    ]);
    expect(
      rows(
        harness.sqlite,
        'SELECT word, count FROM stats_daily_profanity_word WHERE chat_id = 1 AND day = ?',
        ['2026-08-27'],
      ),
    ).toEqual([{ word: 'заебал', count: 2 }]);
    expect(
      rows(
        harness.sqlite,
        'SELECT word, user_id, count FROM stats_daily_profanity_word_user WHERE chat_id = 1 AND day = ?',
        ['2026-08-27'],
      ),
    ).toEqual([{ word: 'заебал', user_id: 100, count: 2 }]);

    // Profile filled from KV username.
    const profile = rows(harness.sqlite, 'SELECT username FROM stats_chat_user_profile WHERE chat_id = 1 AND user_id = 100')[0];
    expect(profile.username).toBe('alice');

    // Coverage is parity-gated: matching legacy totals are complete, missing or
    // mismatched totals stay incomplete with a safe reason.
    expect(coverageRow(harness.sqlite, 1, '2026-08-27')).toEqual({
      base_status: 'complete',
      profanity_status: 'complete',
      criminal_status: 'complete',
      source: 'backfill',
      reason_code: null,
    });
    expect(coverageRow(harness.sqlite, 1, '2024-01-15')).toEqual({
      base_status: 'complete',
      profanity_status: 'complete',
      criminal_status: 'complete',
      source: 'backfill',
      reason_code: null,
    });

    const missingTotal = coverageRow(harness.sqlite, 2, '2026-08-26');
    expect(missingTotal.base_status).not.toBe('complete');
    expect(missingTotal.reason_code).toBe('missing_activity_total');

    const mismatchedTotal = coverageRow(harness.sqlite, 3, '2026-08-25');
    expect(mismatchedTotal.base_status).not.toBe('complete');
    expect(mismatchedTotal.reason_code).toBe('message_count_mismatch');

    // Cutoff-day and future keys are skipped: no rows, no coverage.
    expect(
      rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user WHERE day = ?', ['2026-08-28'])[0]
        .n,
    ).toBe(0);
    expect(
      rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user WHERE day = ?', ['2026-08-29'])[0]
        .n,
    ).toBe(0);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_coverage WHERE day = ?', ['2026-08-28'])[0].n).toBe(0);
  });

  it('has no hardcoded 90-day scope anywhere in the module', async () => {
    const module = await import('../src/features/stats/daily-backfill');
    expect((module as any).BACKFILL_WINDOW_DAYS).toBeUndefined();
    expect((module as any).STATE_KEY).toBeUndefined();
  });

  it('blocks a competing run holding an unexpired lease and proceeds after expiry', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    const nowSec = Math.floor(NOW.getTime() / 1000);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'base', ?, NULL, 0, 'other-runner', ?, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec + 300, nowSec, nowSec);

    // Competing run holds an unexpired lease → this run must no-op.
    const blocked = await runDailyAggregateBackfill(env, NOW);
    expect(blocked.leaseBlocked).toBe(true);
    expect(blocked.keysProcessed).toBe(0);
    expect(kv.kv.get.mock.calls.length).toBe(0);

    // Expired lease is re-acquired and the job proceeds.
    harness.sqlite
      .prepare('UPDATE stats_backfill_state SET lease_expires_at = ? WHERE job_name = ?')
      .run(nowSec - 10, JOB_NAME);
    const resumed = await runDailyAggregateBackfill(env, NOW);
    expect(resumed.leaseBlocked).toBe(false);
    expect(resumed.keysProcessed).toBeGreaterThan(0);

    // A finished invocation releases the lease.
    const stateAfter = rows(harness.sqlite, 'SELECT lease_owner FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0];
    expect(stateAfter.lease_owner).toBeNull();
  });

  it('rejects a paused runner after D1-clock lease expiry without data or checkpoint mutation', async () => {
    const day = '2026-08-27';
    kv.map.set(`stats_v2:1:${day}:100`, '5');
    kv.map.set('user:100', 'alice');

    let paused = false;
    kv.kv.get.mockImplementation(async (key: string) => {
      if (!paused && key.startsWith('stats_v2:')) {
        paused = true;
        harness.clockSec += LEASE_TTL_SECONDS + 1;
      }
      return kv.map.get(key) ?? null;
    });

    const summary = await runDailyAggregateBackfill(env, NOW);

    expect(summary.errorCode).toBe('lease_lost');
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user')[0].n).toBe(0);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_coverage')[0].n).toBe(0);
    expect(
      rows(
        harness.sqlite,
        'SELECT revision, page_offset, error_code FROM stats_backfill_state WHERE job_name = ?',
        [JOB_NAME],
      )[0],
    ).toEqual({ revision: 1, page_offset: 0, error_code: null });
  });

  it('treats a lease expiring exactly at D1-clock admission as expired', async () => {
    const day = '2026-08-27';
    kv.map.set(`stats_v2:1:${day}:100`, '5');
    kv.map.set('user:100', 'alice');

    let paused = false;
    kv.kv.get.mockImplementation(async (key: string) => {
      if (!paused && key.startsWith('stats_v2:')) {
        paused = true;
        harness.clockSec += LEASE_TTL_SECONDS;
      }
      return kv.map.get(key) ?? null;
    });

    const summary = await runDailyAggregateBackfill(env, NOW);

    expect(summary.errorCode).toBe('lease_lost');
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user')[0].n).toBe(0);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_coverage')[0].n).toBe(0);
    expect(
      rows(harness.sqlite, 'SELECT page_offset FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0]
        .page_offset,
    ).toBe(0);
  });

  it('finishes an admitted finalize batch after D1 clock passes lease expiry', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    const day = '2026-08-27';
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'finalize', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_daily_coverage
           (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
         VALUES (?, ?, 'pending', 'pending', 'pending', 'backfill', NULL, ?)`,
      )
      .run(1, day, nowSec);
    harness.sqlite
      .prepare('INSERT INTO stats_daily_user (chat_id, day, user_id, message_count) VALUES (?, ?, ?, ?)')
      .run(1, day, 100, 5);
    seedActivity(harness.sqlite, 1, day, 5);
    harness.advanceClockAfterBatchAdmission = LEASE_TTL_SECONDS + 1;

    const summary = await runDailyAggregateBackfill(env, NOW);

    expect(summary.done).toBe(true);
    expect(summary.coverageCompleted).toBe(1);
    expect(coverageRow(harness.sqlite, 1, day).base_status).toBe('complete');
    expect(
      rows(harness.sqlite, 'SELECT status, revision, lease_owner FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0],
    ).toEqual({ status: 'done', revision: 2, lease_owner: null });
  });

  it('uses fresh batch tokens and rejects a completed batch token when replayed', async () => {
    const day = '2026-08-27';
    kv.map.set(`stats_v2:1:${day}:100`, '5');
    kv.map.set(`word_stats_v2:1:${day}:100`, '20');
    kv.map.set('user:100', 'alice');

    await runDailyAggregateBackfill(env, NOW);
    const firstData = loggedStatement(harness, 'INSERT INTO stats_daily_user');
    const firstAdmission = loggedStatement(harness, "lease_expires_at > unixepoch('now')");
    await runDailyAggregateBackfill(env, NOW);

    const admissions = harness.preparedLog.filter(
      (entry) => entry.sql.includes("lease_expires_at > unixepoch('now')") && entry.operation === 'run',
    );
    const tokens = admissions.map((entry) => entry.params[0]);
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size).toBe(2);

    expect(replay(harness.sqlite, firstAdmission).changes).toBe(0);
    expect(replay(harness.sqlite, firstData).changes).toBe(0);
  });

  it('leaves data and coverage intact when a version-reset contender loses an active lease', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    const day = '2026-08-27';
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, 1, 'running', 'base', ?, NULL, 0, 'active-runner', ?, 7, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec + LEASE_TTL_SECONDS, nowSec, nowSec);
    harness.sqlite
      .prepare('INSERT INTO stats_daily_user (chat_id, day, user_id, message_count) VALUES (?, ?, ?, ?)')
      .run(1, day, 100, 99);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_daily_coverage
           (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
         VALUES (?, ?, 'complete', 'complete', 'complete', 'backfill', NULL, ?)`,
      )
      .run(1, day, nowSec);

    const summary = await runDailyAggregateBackfill(env, NOW);

    expect(summary.leaseBlocked).toBe(true);
    expect(rows(harness.sqlite, 'SELECT message_count FROM stats_daily_user WHERE chat_id = 1 AND day = ?', [day])[0])
      .toEqual({ message_count: 99 });
    expect(coverageRow(harness.sqlite, 1, day).base_status).toBe('complete');
    expect(
      rows(
        harness.sqlite,
        'SELECT version, revision, lease_owner FROM stats_backfill_state WHERE job_name = ?',
        [JOB_NAME],
      )[0],
    ).toEqual({ version: 1, revision: 7, lease_owner: 'active-runner' });
  });

  it('resumes across pages and mid-page without skipping or duplicating keys', async () => {
    kv = createKv(7); // small pages force page-boundary + in-page resume
    env.COUNTERS = kv.kv;
    const total = 30;
    let sum = 0;
    for (let userId = 1; userId <= total; userId += 1) {
      kv.map.set(`stats_v2:1:2026-08-27:${userId}`, String(userId));
      sum += userId;
    }
    seedActivity(harness.sqlite, 1, '2026-08-27', sum);

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);
    expect(summary.errorCode).toBeNull();

    const allUsers = rows(
      harness.sqlite,
      'SELECT user_id, message_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? ORDER BY user_id',
      ['2026-08-27'],
    );
    expect(allUsers.length).toBe(total);
    for (const row of allUsers) {
      expect(row.message_count).toBe(row.user_id); // exact absolute value, written once
    }
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('complete');
  });

  it('respects per-run budgets: ≤50 inspected keys, ≤300 KV gets, ≤90 total D1 statements', async () => {
    kv = createKv(1000);
    env.COUNTERS = kv.kv;
    const total = 30;
    let sum = 0;
    for (let userId = 1; userId <= total; userId += 1) {
      kv.map.set(`stats_v2:1:2026-08-27:${userId}`, String(userId));
      kv.map.set(`profanity:1:${userId}:2026-08-27`, '1');
      kv.map.set(`user:${userId}`, `u${userId}`);
      sum += userId;
    }
    seedActivity(harness.sqlite, 1, '2026-08-27', sum);

    const batchSpy = vi.spyOn(harness, 'batch');
    const executionsBefore = harness.statementExecutions;
    const preparesBefore = harness.prepareCalls;
    const firstRun = await runDailyAggregateBackfill(env, NOW);
    const statementsThisRun = batchSpy.mock.calls.reduce((acc, call) => acc + call[0].length, 0);
    batchSpy.mockRestore();

    // Base is an expensive phase (message_count + profile upsert + coverage per
    // new day), so it admits all 30 seeded keys but stays below the 50 cap;
    // its data statements stay within the 81-statement source budget.
    expect(firstRun.keysProcessed).toBe(total);
    expect(firstRun.keysProcessed).toBeLessThanOrEqual(MAX_KEYS_PER_RUN);
    expect(kv.kv.get.mock.calls.length).toBeLessThanOrEqual(300);
    expect(statementsThisRun).toBeLessThanOrEqual(83);
    // Fake D1 records prepare plus every run/all/first, including state init,
    // lease acquire, batch admission, and terminal checkpoint.
    expect(harness.statementExecutions - executionsBefore).toBeLessThanOrEqual(90);
    expect(harness.prepareCalls - preparesBefore).toBe(harness.statementExecutions - executionsBefore);
    expect(harness.statementExecutions - executionsBefore).toBeGreaterThan(statementsThisRun);

    // The aggregate across all invocations still respects the per-invocation cap.
    const everyRunSpy = vi.spyOn(harness, 'batch');
    await runToCompletion(env);
    const totalStatementsAllRuns = everyRunSpy.mock.calls.reduce((acc, call) => acc + call[0].length, 0);
    everyRunSpy.mockRestore();
    expect(totalStatementsAllRuns).toBeGreaterThan(0);

    const allUsers = rows(
      harness.sqlite,
      'SELECT COUNT(*) AS n FROM stats_daily_user WHERE chat_id = 1 AND day = ?',
      ['2026-08-27'],
    )[0];
    expect(allUsers.n).toBe(total);
  });

  it('keeps aggregate and state statements within the 90-statement whole-invocation budget', async () => {
    kv = createKv(1000);
    env.COUNTERS = kv.kv;
    // 25 keys, each on a distinct (day, user): rows + profiles + coverage
    // upserts are produced in a single ≤90-statement batch.
    for (let i = 1; i <= 25; i += 1) {
      const day = `2024-01-${String(i).padStart(2, '0')}`;
      const userId = 100 + i;
      kv.map.set(`stats_v2:1:${day}:${userId}`, '1');
      kv.map.set(`profanity:1:${userId}:${day}`, '1');
      kv.map.set(`user:${userId}`, `u${userId}`);
    }

    const batchSpy = vi.spyOn(harness, 'batch');
    const executionsBefore = harness.statementExecutions;
    const preparesBefore = harness.prepareCalls;
    const firstRun = await runDailyAggregateBackfill(env, NOW);

    expect(firstRun.keysProcessed).toBe(25);
    // One invocation → one source batch: 81 data statements plus admission and terminal state.
    const statementsThisRun = batchSpy.mock.calls.reduce((acc, call) => acc + call[0].length, 0);
    expect(statementsThisRun).toBeLessThanOrEqual(83);
    for (const call of batchSpy.mock.calls) {
      expect(call[0].length).toBeLessThanOrEqual(83);
    }
    batchSpy.mockRestore();
    // This includes first-state initialization, lease operations, checkpoint,
    // release, and every data statement. Source batches reserve nine of 90.
    expect(harness.statementExecutions - executionsBefore).toBeLessThanOrEqual(90);
    expect(harness.prepareCalls - preparesBefore).toBe(harness.statementExecutions - executionsBefore);
    expect(harness.statementExecutions - executionsBefore).toBeGreaterThan(statementsThisRun);
    // All 25 distinct-day rows landed.
    expect(
      rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user WHERE chat_id = 1', [])[0].n,
    ).toBe(25);
  });

  it('counts malformed, invalid, and cutoff list entries against the 50-key budget', async () => {
    kv = createKv(1000);
    env.COUNTERS = kv.kv;
    // These sort in this order: 20 invalid historical keys, 20 cutoff keys,
    // then 20 malformed keys. None may bypass the source-key cap or require a get.
    for (let i = 0; i < 20; i += 1) {
      const suffix = String(i).padStart(2, '0');
      kv.map.set(`stats_v2:1:2026-08-27:not-a-user-${suffix}`, '1');
      kv.map.set(`stats_v2:1:2026-08-28:${100 + i}`, '1');
      kv.map.set(`stats_v2:malformed-${suffix}`, '1');
    }

    const executionsBefore = harness.statementExecutions;
    const preparesBefore = harness.prepareCalls;
    const batchSpy = vi.spyOn(harness, 'batch');
    const firstRun = await runDailyAggregateBackfill(env, NOW);
    const batchStatements = batchSpy.mock.calls.reduce((total, call) => total + call[0].length, 0);
    batchSpy.mockRestore();

    expect(firstRun.keysProcessed).toBe(MAX_KEYS_PER_RUN);
    expect(firstRun.keysSkipped).toBe(MAX_KEYS_PER_RUN);
    expect(kv.kv.get).not.toHaveBeenCalled();
    // Checkpoint advances exactly 50 entries, leaving ten malformed entries for
    // later resumable invocation.
    expect(
      rows(harness.sqlite, 'SELECT page_offset FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0]
        .page_offset,
    ).toBe(MAX_KEYS_PER_RUN);
    // The 20 invalid historical days share one (chat, day): a single coverage
    // write. Whole-invocation count additionally includes initial state
    // read/init/re-read, lease, batch admission, and terminal checkpoint.
    expect(batchStatements).toBe(3);
    expect(harness.statementExecutions - executionsBefore).toBeLessThanOrEqual(90);
    expect(harness.prepareCalls - preparesBefore).toBe(harness.statementExecutions - executionsBefore);
    expect(harness.statementExecutions - executionsBefore).toBeGreaterThan(batchStatements);
  });

  it('simple source phase processes exactly 50 valid keys in one run within global budgets', async () => {
    // A single-statement family (profanity_words) must reach the 50-key cap:
    // one KV get + one absolute upsert per key, plus one coverage upsert for
    // the single (chat, day). Start the job directly in the profanity_words
    // phase so one invocation measures exactly that slice.
    const nowSec = Math.floor(NOW.getTime() / 1000);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'profanity_words', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    kv = createKv(1000);
    env.COUNTERS = kv.kv;
    const total = 55;
    for (let i = 0; i < total; i += 1) {
      kv.map.set(`profanity_words:1:word${String(i).padStart(2, '0')}:2026-08-27`, '1');
    }

    const batchSpy = vi.spyOn(harness, 'batch');
    const executionsBefore = harness.statementExecutions;
    const preparesBefore = harness.prepareCalls;
    const firstRun = await runDailyAggregateBackfill(env, NOW);
    const statementsThisRun = batchSpy.mock.calls.reduce((acc, call) => acc + call[0].length, 0);
    batchSpy.mockRestore();

    expect(firstRun.keysProcessed).toBe(MAX_KEYS_PER_RUN); // 50 of 55 inspected
    expect(firstRun.keysSkipped).toBe(0);
    expect(kv.kv.get.mock.calls.length).toBe(50); // one get per valid key
    expect(statementsThisRun).toBe(53); // 50 upserts + coverage + admission + terminal checkpoint
    expect(statementsThisRun).toBeLessThanOrEqual(83);
    // Includes state read, lease acquire, re-read, batch admission, and checkpoint.
    expect(harness.statementExecutions - executionsBefore).toBeLessThanOrEqual(90);
    expect(harness.prepareCalls - preparesBefore).toBe(harness.statementExecutions - executionsBefore);

    // Checkpoint advanced exactly 50 entries; the remaining five resume next run.
    const stateAfter = rows(
      harness.sqlite,
      'SELECT phase, page_offset FROM stats_backfill_state WHERE job_name = ?',
      [JOB_NAME],
    )[0];
    expect(stateAfter.phase).toBe('profanity_words');
    expect(stateAfter.page_offset).toBe(MAX_KEYS_PER_RUN);

    const batchSpy2 = vi.spyOn(harness, 'batch');
    const secondRun = await runDailyAggregateBackfill(env, NOW);
    batchSpy2.mockRestore();
    expect(secondRun.keysProcessed).toBe(5); // remainder, then phase advances
    expect(
      rows(
        harness.sqlite,
        'SELECT COUNT(*) AS n FROM stats_daily_profanity_word WHERE chat_id = 1 AND day = ?',
        ['2026-08-27'],
      )[0].n,
    ).toBe(total);
  });

  it('base phase stops safely below 50 when profile/coverage statements would exceed the budget', async () => {
    kv = createKv(1000);
    env.COUNTERS = kv.kv;
    // 50 base keys across distinct (chat, day), each with a username profile:
    // worst case three statements per key (message_count upsert + profile
    // upsert + coverage upsert), so only 27 of the 50 keys fit the 81-statement
    // source budget. The remaining keys resume in later invocations.
    for (let i = 1; i <= 50; i += 1) {
      kv.map.set(`stats_v2:${i}:2024-01-15:${100 + i}`, '1');
      kv.map.set(`user:${100 + i}`, `u${100 + i}`);
    }

    const batchSpy = vi.spyOn(harness, 'batch');
    const executionsBefore = harness.statementExecutions;
    const preparesBefore = harness.prepareCalls;
    const firstRun = await runDailyAggregateBackfill(env, NOW);
    const statementsThisRun = batchSpy.mock.calls.reduce((acc, call) => acc + call[0].length, 0);
    batchSpy.mockRestore();

    // 27 keys are admitted (27 × 3 = 81 = source budget exactly); the 28th key
    // is inspected and then denied by admission, so the inspected count is 28.
    expect(firstRun.keysProcessed).toBe(28);
    expect(firstRun.keysProcessed).toBeLessThan(MAX_KEYS_PER_RUN);
    expect(kv.kv.get.mock.calls.length).toBe(81); // three gets per admitted key only
    expect(statementsThisRun).toBe(83);
    expect(statementsThisRun).toBeLessThanOrEqual(83);
    expect(harness.statementExecutions - executionsBefore).toBeLessThanOrEqual(90);
    expect(harness.prepareCalls - preparesBefore).toBe(harness.statementExecutions - executionsBefore);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user', [])[0].n).toBe(27);

    // Resumable: the remaining 23 keys complete in later invocations.
    await runToCompletion(env);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user', [])[0].n).toBe(50);
  });

  it('bounds profile-bearing category phases and requeues their first unadmitted key', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'profanity', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    kv = createKv(1000);
    env.COUNTERS = kv.kv;
    for (let chatId = 1; chatId <= 50; chatId += 1) {
      const userId = 100 + chatId;
      kv.map.set(`profanity:${chatId}:${userId}:2024-01-15`, '1');
      kv.map.set(`user:${userId}`, `u${userId}`);
      kv.map.set(`last_message:${chatId}:${userId}`, String(userId));
    }

    const executionsBefore = harness.statementExecutions;
    const batchSpy = vi.spyOn(harness, 'batch');
    const summary = await runDailyAggregateBackfill(env, NOW);
    const batchStatements = batchSpy.mock.calls.reduce((total, call) => total + call[0].length, 0);
    batchSpy.mockRestore();

    // 27 × (category upsert + profile upsert + unique-day coverage) = 81.
    // Entry 28 is inspected but not consumed, so its cursor position requeues.
    expect(summary.keysProcessed).toBe(28);
    expect(kv.kv.get.mock.calls.length).toBe(81);
    expect(batchStatements).toBe(83);
    expect(harness.statementExecutions - executionsBefore).toBeLessThanOrEqual(90);
    expect(
      rows(harness.sqlite, 'SELECT page_offset FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0]
        .page_offset,
    ).toBe(27);
  });

  it('bounds profile-bearing bucket backfill exactly like other D1-visible user sources', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'buckets', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    kv = createKv(1000);
    env.COUNTERS = kv.kv;
    for (let chatId = 1; chatId <= 50; chatId += 1) {
      const userId = 100 + chatId;
      kv.map.set(`activity_time_bucket:${chatId}:2024-01-15:morning:${userId}`, '1');
      kv.map.set(`user:${userId}`, `u${userId}`);
      kv.map.set(`last_message:${chatId}:${userId}`, String(userId));
    }

    const executionsBefore = harness.statementExecutions;
    const batchSpy = vi.spyOn(harness, 'batch');
    const summary = await runDailyAggregateBackfill(env, NOW);
    const batchStatements = batchSpy.mock.calls.reduce((total, call) => total + call[0].length, 0);
    batchSpy.mockRestore();

    // 27 × (bucket upsert + profile upsert + unique-day coverage) = 81.
    // Entry 28 remains at the checkpoint for the next invocation.
    expect(summary.keysProcessed).toBe(28);
    expect(kv.kv.get.mock.calls.length).toBe(81);
    expect(batchStatements).toBe(83);
    expect(harness.statementExecutions - executionsBefore).toBeLessThanOrEqual(90);
    expect(
      rows(harness.sqlite, 'SELECT page_offset FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0]
        .page_offset,
    ).toBe(27);
  });

  it('deduplicates category profiles by chat and user without suppressing another chat', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'profanity', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    kv.map.set('profanity:1:999:2026-08-26', '1');
    kv.map.set('profanity:1:999:2026-08-27', '2');
    kv.map.set('profanity:2:999:2026-08-27', '3');
    kv.map.set('user:999', 'lurker');
    kv.map.set('last_message:1:999', '111');
    kv.map.set('last_message:2:999', '222');

    await runDailyAggregateBackfill(env, NOW);

    const reads = kv.kv.get.mock.calls.map(([key]: [string]) => key);
    expect(reads.filter((key: string) => key === 'user:999')).toHaveLength(2);
    expect(reads.filter((key: string) => key === 'last_message:1:999')).toHaveLength(1);
    expect(reads.filter((key: string) => key === 'last_message:2:999')).toHaveLength(1);
    expect(
      rows(
        harness.sqlite,
        'SELECT chat_id, username, last_message_ts FROM stats_chat_user_profile WHERE user_id = 999 ORDER BY chat_id',
      ),
    ).toEqual([
      { chat_id: 1, username: 'lurker', last_message_ts: 111 },
      { chat_id: 2, username: 'lurker', last_message_ts: 222 },
    ]);
    expect(
      harness.preparedLog.filter((entry) => entry.sql.includes('INSERT INTO stats_chat_user_profile')),
    ).toHaveLength(2);
  });

  it('keeps a 25-row finalize page within total D1 budget including state and parity reads', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'finalize', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    for (let chatId = 1; chatId <= MAX_COVERAGE_ROWS_PER_RUN; chatId += 1) {
      const day = '2026-08-27';
      harness.sqlite
        .prepare(
          `INSERT INTO stats_daily_coverage
             (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
           VALUES (?, ?, 'pending', 'pending', 'pending', 'backfill', NULL, ?)`,
        )
        .run(chatId, day, nowSec);
      harness.sqlite
        .prepare('INSERT INTO stats_daily_user (chat_id, day, user_id, message_count) VALUES (?, ?, 1, 1)')
        .run(chatId, day);
      seedActivity(harness.sqlite, chatId, day, 1);
    }

    const executionsBefore = harness.statementExecutions;
    const preparesBefore = harness.prepareCalls;
    const batchSpy = vi.spyOn(harness, 'batch');
    const summary = await runDailyAggregateBackfill(env, NOW);
    const batchStatements = batchSpy.mock.calls.reduce((total, call) => total + call[0].length, 0);
    batchSpy.mockRestore();

    expect(summary.coverageCompleted).toBe(MAX_COVERAGE_ROWS_PER_RUN);
    expect(batchStatements).toBe(MAX_COVERAGE_ROWS_PER_RUN + 2);
    // Existing state costs 3 (read/acquire/re-read), then final page (1), two
    // parity reads per row (50), then admission, 25 updates, and terminal checkpoint = 81.
    expect(harness.statementExecutions - executionsBefore).toBe(81);
    expect(harness.prepareCalls - preparesBefore).toBe(harness.statementExecutions - executionsBefore);
    expect(harness.statementExecutions - executionsBefore).toBeGreaterThan(batchStatements);
  });

  it('retries a failed slice without advancing the checkpoint and converges absolute values', async () => {
    kv.map.set('stats_v2:1:2026-08-27:100', '5');
    kv.map.set('word_stats_v2:1:2026-08-27:100', '40');
    kv.map.set('stats_v2:1:2026-08-27:200', '3');
    kv.map.set('word_stats_v2:1:2026-08-27:200', '10');
    kv.map.set('user:100', 'alice');
    kv.map.set('user:200', 'bob');
    // Partial live dual-write that backfill must correct with absolute values.
    harness.sqlite
      .prepare(
        'INSERT INTO stats_daily_user (chat_id, day, user_id, message_count, word_count) VALUES (?, ?, ?, ?, ?)',
      )
      .run(1, '2026-08-27', 100, 99, 0);
    seedActivity(harness.sqlite, 1, '2026-08-27', 8);

    const batchSpy = vi.spyOn(harness, 'batch').mockRejectedValueOnce(new Error('d1 unavailable'));
    const failedRun = await runDailyAggregateBackfill(env, NOW);
    batchSpy.mockRestore();

    expect(failedRun.errorCode).toBe('d1_write_failed');
    expect(failedRun.keysProcessed).toBe(0);
    const stateAfterFailure = rows(harness.sqlite, 'SELECT page_offset FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0];
    expect(stateAfterFailure.page_offset).toBe(0); // checkpoint did not advance

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);
    const user100 = rows(
      harness.sqlite,
      'SELECT message_count, word_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 100',
      ['2026-08-27'],
    )[0];
    expect(user100.message_count).toBe(5); // absolute from source, never 99+5
    expect(user100.word_count).toBe(40);
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('complete');
  });

  it('never marks coverage complete before the finalize phase', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    await runUntilPhase(env, 'finalize');

    const incomplete = rows(
      harness.sqlite,
      `SELECT COUNT(*) AS n FROM stats_daily_coverage
       WHERE base_status = 'complete' OR profanity_status = 'complete' OR criminal_status = 'complete'`,
    )[0];
    expect(incomplete.n).toBe(0);

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('complete');
  });

  it('records invalid source values as a safe reason and never fabricates rows', async () => {
    kv.map.set('stats_v2:1:2026-08-27:999', 'not-a-number');
    kv.map.set('stats_v2:garbage', '1');

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    // No fabricated row for the invalid user.
    expect(
      rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user WHERE chat_id = 1 AND day = ?', ['2026-08-27'])[0]
        .n,
    ).toBe(0);
    const coverage = coverageRow(harness.sqlite, 1, '2026-08-27');
    expect(coverage.base_status).not.toBe('complete');
    expect(coverage.reason_code).toBe('source_value_invalid');
  });

  it('records invalid hour keys as a safe reason without writing bad rows', async () => {
    kv.map.set('activity_hour:1:2026-08-27:99', '4');

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    expect(
      rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_hour WHERE chat_id = 1 AND day = ?', ['2026-08-27'])[0]
        .n,
    ).toBe(0);
    const coverage = coverageRow(harness.sqlite, 1, '2026-08-27');
    expect(coverage.base_status).not.toBe('complete');
    expect(coverage.reason_code).toBe('source_key_invalid');
  });

  it('reconciles score columns from their exact sources and never regresses profile timestamps', async () => {
    kv.map.set('stats_v2:1:2026-08-27:100', '5');
    kv.map.set('word_stats_v2:1:2026-08-27:100', '40');
    kv.map.set('profanity:1:100:2026-08-27', '2');
    kv.map.set('criminal:1:100:2026-08-27', '1');
    kv.map.set('criminal_severity:1:100:2026-08-27', '6');
    kv.map.set('user:100', 'alice');
    seedActivity(harness.sqlite, 1, '2026-08-27', 5);
    // Existing live row (higher scores are artificial; KV is authoritative) and
    // an existing profile with a newer last_seen_ts that must not regress.
    harness.sqlite
      .prepare(
        `INSERT INTO stats_daily_user
           (chat_id, day, user_id, message_count, profanity_count, criminal_count, criminal_severity)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(1, '2026-08-27', 100, 2, 7, 3, 9);
    harness.sqlite
      .prepare('INSERT INTO stats_chat_user_profile (chat_id, user_id, username, last_message_ts) VALUES (?, ?, ?, ?)')
      .run(1, 100, 'old_alice', 5000);

    await runToCompletion(env);

    const user = rows(
      harness.sqlite,
      'SELECT message_count, profanity_count, criminal_count, criminal_severity FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 100',
      ['2026-08-27'],
    )[0];
    expect(user.message_count).toBe(5); // base column converged from source
    expect(user.profanity_count).toBe(2); // exact source value
    expect(user.criminal_count).toBe(1);
    expect(user.criminal_severity).toBe(6);

    const profile = rows(harness.sqlite, 'SELECT username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 1 AND user_id = 100')[0];
    expect(profile.username).toBe('alice');
    expect(profile.last_message_ts).toBe(5000); // never regressed
  });

  it('is idempotent: re-running from a fresh state converges without double-counting', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    await runToCompletion(env);

    const before = rows(
      harness.sqlite,
      'SELECT message_count, profanity_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 100',
      ['2026-08-27'],
    )[0];

    // Simulate an operator re-running the job: delete the D1 state row.
    harness.sqlite.prepare('DELETE FROM stats_backfill_state WHERE job_name = ?').run(JOB_NAME);
    await runToCompletion(env);

    const after = rows(
      harness.sqlite,
      'SELECT message_count, profanity_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 100',
      ['2026-08-27'],
    )[0];
    expect(after).toEqual(before);
    expect(after.message_count).toBe(5);
    // Days completed in the first pass stay complete.
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('complete');
  });

  it('terminal done state performs a cheap read with no writes', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    await runToCompletion(env);

    const batchCallsAfterFinish = harness.batchCalls;
    const getsAfterFinish = kv.kv.get.mock.calls.length;

    const summary = await runDailyAggregateBackfill(env, NOW);
    expect(summary.done).toBe(true);
    expect(harness.batchCalls).toBe(batchCallsAfterFinish); // no D1 writes
    expect(kv.kv.get.mock.calls.length).toBe(getsAfterFinish); // no KV reads either
  });

  it('guards against a missing DB binding', async () => {
    const { env: envWithoutDb } = makeEnv(null);
    const summary = await runDailyAggregateBackfill(envWithoutDb, NOW);
    expect(summary.done).toBe(false);
    expect(summary.keysProcessed).toBe(0);
    expect(summary.errorCode).toBeNull();
  });

  it('backfills signed negative supergroup chat ids across base/hour/bucket/profanity/criminal paths', async () => {
    const chat = -1001234567890;
    kv.map.set(`stats_v2:${chat}:2026-08-27:100`, '5');
    kv.map.set(`word_stats_v2:${chat}:2026-08-27:100`, '40');
    kv.map.set(`media_stats_v2:${chat}:2026-08-27:100:voice`, '2');
    kv.map.set(`media_duration_v2:${chat}:2026-08-27:100:voice`, '15');
    kv.map.set(`media_stats_v2:${chat}:2026-08-27:100:video_note`, '1');
    kv.map.set(`media_duration_v2:${chat}:2026-08-27:100:video_note`, '4');
    kv.map.set(`activity_hour:${chat}:2026-08-27:09`, '4');
    kv.map.set(`activity_time_bucket:${chat}:2026-08-27:morning:100`, '4');
    kv.map.set(`profanity:${chat}:100:2026-08-27`, '2');
    kv.map.set(`criminal:${chat}:100:2026-08-27`, '1');
    kv.map.set(`criminal_severity:${chat}:100:2026-08-27`, '6');
    kv.map.set('user:100', 'alice');
    seedActivity(harness.sqlite, chat, '2026-08-27', 5);

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    const user = rows(
      harness.sqlite,
      'SELECT * FROM stats_daily_user WHERE chat_id = ? AND day = ? AND user_id = 100',
      [chat, '2026-08-27'],
    )[0];
    expect(user.message_count).toBe(5);
    expect(user.word_count).toBe(40);
    expect(user.voice_count).toBe(2);
    expect(user.voice_duration_seconds).toBe(15);
    expect(user.video_note_count).toBe(1);
    expect(user.video_note_duration_seconds).toBe(4);
    expect(user.profanity_count).toBe(2);
    expect(user.criminal_count).toBe(1);
    expect(user.criminal_severity).toBe(6);

    const hour = rows(
      harness.sqlite,
      'SELECT message_count FROM stats_daily_hour WHERE chat_id = ? AND day = ? AND hour = 9',
      [chat, '2026-08-27'],
    )[0];
    expect(hour.message_count).toBe(4);

    const bucket = rows(
      harness.sqlite,
      'SELECT message_count FROM stats_daily_bucket_user WHERE chat_id = ? AND day = ? AND bucket = ? AND user_id = 100',
      [chat, '2026-08-27', 'morning'],
    )[0];
    expect(bucket.message_count).toBe(4);

    // Negative chat is fully covered: finalize parity (5 == 5) completes it.
    expect(coverageRow(harness.sqlite, chat, '2026-08-27')).toEqual({
      base_status: 'complete',
      profanity_status: 'complete',
      criminal_status: 'complete',
      source: 'backfill',
      reason_code: null,
    });
  });

  it('rejects non-positive user ids without writing rows or completing coverage', async () => {
    const chat = -1001234567890;
    kv.map.set(`stats_v2:${chat}:2026-08-27:-100`, '5');
    kv.map.set(`stats_v2:${chat}:2026-08-27:0`, '5');
    kv.map.set(`stats_v2:${chat}:2026-08-27:100`, '5');
    seedActivity(harness.sqlite, chat, '2026-08-27', 5);

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    expect(
      rows(
        harness.sqlite,
        'SELECT user_id FROM stats_daily_user WHERE chat_id = ? AND day = ? ORDER BY user_id',
        [chat, '2026-08-27'],
      ),
    ).toEqual([{ user_id: 100 }]);
    expect(coverageRow(harness.sqlite, chat, '2026-08-27')).toMatchObject({
      source: 'backfill',
      reason_code: 'source_key_invalid',
    });
    expect(coverageRow(harness.sqlite, chat, '2026-08-27').base_status).not.toBe('complete');
  });

  it('recovers orphan modern source-family days and stores their values without a base counter', async () => {
    // A (chat, day) with profanity_words + criminal_severity but NO stats_v2 base.
    kv.map.set('profanity_words:7:хуй:2026-08-20', '3');
    kv.map.set('criminal_severity:7:100:2026-08-20', '9');

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    // Orphan family values are stored (never silently discarded).
    const words = rows(
      harness.sqlite,
      'SELECT word, count FROM stats_daily_profanity_word WHERE chat_id = 7 AND day = ?',
      ['2026-08-20'],
    );
    expect(words).toEqual([{ word: 'хуй', count: 3 }]);
    const severity = rows(
      harness.sqlite,
      'SELECT criminal_severity FROM stats_daily_user WHERE chat_id = 7 AND day = ? AND user_id = 100',
      ['2026-08-20'],
    )[0];
    expect(severity.criminal_severity).toBe(9);

    // No base counter → day can never be served.
    const coverage = coverageRow(harness.sqlite, 7, '2026-08-20');
    expect(coverage.base_status).not.toBe('complete');
    expect(coverage.reason_code).toBe('missing_base_counter');
    expect(coverage.source).toBe('backfill');
  });

  it('records a word_stats_v2 orphan day as missing_base_counter when no stats_v2 exists', async () => {
    kv.map.set('word_stats_v2:8:2026-08-20:100', '12');

    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    const row = rows(
      harness.sqlite,
      'SELECT word_count, message_count FROM stats_daily_user WHERE chat_id = 8 AND day = ? AND user_id = 100',
      ['2026-08-20'],
    )[0];
    expect(row.word_count).toBe(12);
    expect(row.message_count).toBe(0);

    const coverage = coverageRow(harness.sqlite, 8, '2026-08-20');
    expect(coverage.base_status).not.toBe('complete');
    expect(coverage.reason_code).toBe('missing_base_counter');
  });

  it('preserves live-first coverage ownership when backfill later scans the same day', async () => {
    kv.map.set('stats_v2:1:2026-08-27:100', '6');
    kv.map.set('word_stats_v2:1:2026-08-27:100', '40');
    kv.map.set('user:100', 'alice');
    seedActivity(harness.sqlite, 1, '2026-08-27', 5);

    // Live writer commits first. Its activity increment makes parity exact (6),
    // so ownership preservation—not an incidental mismatch—blocks readiness.
    await writeActivityAggregates(harness as unknown as D1Database, {
      chatId: 1,
      userId: 100,
      username: 'alice',
      day: '2026-08-27',
      hour: 9,
      bucket: 'morning',
      wordCount: 0,
      voiceCount: 0,
      voiceDurationSeconds: 0,
      videoNoteCount: 0,
      videoNoteDurationSeconds: 0,
      ts: 1234,
    });
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').source).toBe('live');

    await runToCompletion(env);

    const coverage = coverageRow(harness.sqlite, 1, '2026-08-27');
    expect(coverage).toEqual({
      base_status: 'live',
      profanity_status: 'none',
      criminal_status: 'none',
      source: 'live',
      reason_code: null,
    });
    expect(coverage.base_status).not.toBe('complete');
  });

  it('invalidates backfill-first coverage when a live write arrives before finalize', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    // Run every source phase so backfill writes its absolute snapshot and
    // pending coverage, then stop right before finalize.
    await runUntilPhase(env, 'finalize');

    // Live writer interleaving: KV increment precedes the additive D1 write.
    kv.map.set('stats_v2:1:2026-08-27:100', '6');
    await writeActivityAggregates(harness as unknown as D1Database, {
      chatId: 1,
      userId: 100,
      username: 'alice',
      day: '2026-08-27',
      hour: 9,
      bucket: 'morning',
      wordCount: 1,
      voiceCount: 0,
      voiceDurationSeconds: 0,
      videoNoteCount: 0,
      videoNoteDurationSeconds: 0,
      ts: 1234,
    });

    // The live write takes ownership of the day.
    const afterLive = coverageRow(harness.sqlite, 1, '2026-08-27');
    expect(afterLive.base_status).toBe('live');
    expect(afterLive.source).toBe('live');

    // Finalize must not promote the raced day back to complete.
    await runToCompletion(env);
    const final = coverageRow(harness.sqlite, 1, '2026-08-27');
    expect(final.base_status).not.toBe('complete');
    expect(final.source).toBe('live');
  });

  it('preserves live ownership when a live KV increment straddles base snapshot', async () => {
    // Historical day with 5 messages and matching legacy activity, plus a word
    // family that will scan after the live write. Its backfill UPSERT must not
    // reassert backfill ownership.
    kv.map.set('stats_v2:1:2026-08-27:100', '5');
    kv.map.set('word_stats_v2:1:2026-08-27:100', '40');
    kv.map.set('user:100', 'alice');
    seedActivity(harness.sqlite, 1, '2026-08-27', 5);

    // 1. Live KV increment lands BEFORE backfill reads the snapshot.
    kv.map.set('stats_v2:1:2026-08-27:100', '6');

    // 2. Backfill base phase writes the absolute snapshot (message_count = 6)
    //    and advances past the base phase.
    const baseRun = await runDailyAggregateBackfill(env, NOW);
    expect(baseRun.keysProcessed).toBe(1);

    // 3. Live additive D1 write lands AFTER the absolute snapshot (+1 → 7, activity → 6).
    await writeActivityAggregates(harness as unknown as D1Database, {
      chatId: 1,
      userId: 100,
      username: 'alice',
      day: '2026-08-27',
      hour: 9,
      bucket: 'morning',
      wordCount: 0,
      voiceCount: 0,
      voiceDurationSeconds: 0,
      videoNoteCount: 0,
      videoNoteDurationSeconds: 0,
      ts: 1234,
    });

    await runToCompletion(env);

    // The live source remains authoritative even though a later source phase
    // touches the day; finalize cannot select or complete it.
    const coverage = coverageRow(harness.sqlite, 1, '2026-08-27');
    expect(coverage.base_status).not.toBe('complete');
    expect(coverage.base_status).toBe('live');
    expect(coverage.source).toBe('live');
    expect(coverage.reason_code).toBeNull();
  });

  it('clears stale backfill reason_code when a live write takes ownership', async () => {
    const day = '2026-08-27';
    const nowSec = Math.floor(NOW.getTime() / 1000);
    // Backfill reasoned the day (parity mismatch) and left its provenance code.
    harness.sqlite
      .prepare(
        `INSERT INTO stats_daily_coverage
           (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
         VALUES (?, ?, 'pending', 'pending', 'pending', 'backfill', 'message_count_mismatch', ?)`,
      )
      .run(1, day, nowSec);
    expect(coverageRow(harness.sqlite, 1, day).reason_code).toBe('message_count_mismatch');

    // Live writer takes ownership of the day.
    await writeActivityAggregates(harness as unknown as D1Database, {
      chatId: 1,
      userId: 100,
      username: 'alice',
      day,
      hour: 9,
      bucket: 'morning',
      wordCount: 1,
      voiceCount: 0,
      voiceDurationSeconds: 0,
      videoNoteCount: 0,
      videoNoteDurationSeconds: 0,
      ts: 1234,
    });

    const coverage = coverageRow(harness.sqlite, 1, day);
    expect(coverage.source).toBe('live');
    expect(coverage.base_status).toBe('live');
    expect(coverage.reason_code).toBeNull();
  });

  it('writes a chat-scoped profile per chat for the same user within one page', async () => {
    kv.map.set('stats_v2:1:2026-08-27:100', '5');
    kv.map.set('stats_v2:2:2026-08-27:100', '3');
    kv.map.set('user:100', 'alice');
    kv.map.set('last_message:1:100', '111');
    kv.map.set('last_message:2:100', '222');
    seedActivity(harness.sqlite, 1, '2026-08-27', 5);
    seedActivity(harness.sqlite, 2, '2026-08-27', 3);

    await runToCompletion(env);

    // Same user id in two chats must produce two chat-scoped profiles (the old
    // Set<number> dedupe would have dropped the second chat).
    const p1 = rows(
      harness.sqlite,
      'SELECT username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 1 AND user_id = 100',
    )[0];
    const p2 = rows(
      harness.sqlite,
      'SELECT username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 2 AND user_id = 100',
    )[0];
    expect(p1).toEqual({ username: 'alice', last_message_ts: 111 });
    expect(p2).toEqual({ username: 'alice', last_message_ts: 222 });
  });

  it('backfills profiles for category-only users and preserves D1 reader name/timestamp parity', async () => {
    const day = '2026-08-27';
    // Base activity makes coverage complete. These users appear only in their
    // category sources, so base must not be responsible for their profiles.
    kv.map.set(`stats_v2:1:${day}:100`, '1');
    kv.map.set(`profanity:1:999:${day}`, '5');
    kv.map.set(`criminal:1:998:${day}`, '2');
    kv.map.set(`activity_time_bucket:1:${day}:morning:999`, '1');
    kv.map.set(`profanity_words:1:ругательство:${day}`, '3');
    kv.map.set(`profanity_word_users:1:ругательство:${day}:997`, '3');
    kv.map.set('user:100', 'alice');
    kv.map.set('user:999', 'lurker');
    kv.map.set('user:998', 'offender');
    kv.map.set('user:997', 'contributor');
    kv.map.set('last_message:1:100', '100');
    kv.map.set('last_message:1:999', '999');
    kv.map.set('last_message:1:998', '998');
    kv.map.set('last_message:1:997', '997');
    seedActivity(harness.sqlite, 1, day, 1);

    await runToCompletion(env);

    expect(
      rows(
        harness.sqlite,
        'SELECT user_id, username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 1 ORDER BY user_id',
      ),
    ).toEqual([
      { user_id: 100, username: 'alice', last_message_ts: 100 },
      { user_id: 997, username: 'contributor', last_message_ts: 997 },
      { user_id: 998, username: 'offender', last_message_ts: 998 },
      { user_id: 999, username: 'lurker', last_message_ts: 999 },
    ]);

    const result = await getAdminChatStatsFromD1(
      harness as unknown as D1Database,
      1,
      { period: 'custom', from: day, to: day, days: [day] },
    );
    expect(result.activity.topUsers[0]).toMatchObject({ username: 'alice', lastMessageTs: 100 });
    expect(result.activity.timeBuckets.find((bucket) => bucket.bucket === 'morning')?.topUsers).toEqual([
      expect.objectContaining({ userId: '999', username: 'lurker', lastMessageTs: 999 }),
    ]);
    expect(result.profanity.topUsers).toEqual([{ userId: 999, username: 'lurker', count: 5 }]);
    expect(result.criminal.topUsers).toEqual([{ userId: 998, username: 'offender', count: 2 }]);
    expect(result.profanity.topWords).toEqual([
      {
        word: 'ругательство',
        count: 3,
        contributors: [{ userId: 997, username: 'contributor', count: 3 }],
      },
    ]);
  });

  it('hydrates bucket-only profiles for D1 bucket users without inflating activity users', async () => {
    const day = '2026-08-27';
    kv.map.set(`activity_time_bucket:1:${day}:morning:996`, '4');
    kv.map.set('user:996', 'bucket-user');
    kv.map.set('last_message:1:996', '9960');

    await runToCompletion(env);

    expect(
      rows(
        harness.sqlite,
        'SELECT username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 1 AND user_id = 996',
      )[0],
    ).toEqual({ username: 'bucket-user', last_message_ts: 9960 });

    const result = await getAdminChatStatsFromD1(
      harness as unknown as D1Database,
      1,
      { period: 'custom', from: day, to: day, days: [day] },
    );
    expect(result.activity.activeUsers).toBe(0);
    expect(result.activity.topUsers).toEqual([]);
    expect(result.activity.timeBuckets.find((bucket) => bucket.bucket === 'morning')?.topUsers).toEqual([
      expect.objectContaining({ userId: '996', username: 'bucket-user', lastMessageTs: 9960, count: 4 }),
    ]);
  });

  it('writes fallback category profiles with their available last-message timestamp', async () => {
    const day = '2026-08-27';
    kv.map.set(`profanity:1:997:${day}`, '3');
    kv.map.set('last_message:1:997', '9970');

    await runToCompletion(env);

    expect(
      rows(
        harness.sqlite,
        'SELECT username, last_message_ts FROM stats_chat_user_profile WHERE chat_id = 1 AND user_id = 997',
      )[0],
    ).toEqual({ username: 'id997', last_message_ts: 9970 });

    const result = await getAdminChatStatsFromD1(
      harness as unknown as D1Database,
      1,
      { period: 'custom', from: day, to: day, days: [day] },
    );
    expect(result.activity.activeUsers).toBe(0);
    expect(result.profanity.topUsers).toEqual([{ userId: 997, username: 'id997', count: 3 }]);
  });

  it('exports the current JOB_VERSION constant', () => {
    expect(JOB_VERSION).toBeGreaterThanOrEqual(3);
  });

  it('blocks isD1RangeReady when backfill state version is outdated (v2)', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    // Simulate an old v2 completed backfill: downgrade the version column.
    harness.sqlite
      .prepare('UPDATE stats_backfill_state SET version = 2 WHERE job_name = ?')
      .run(JOB_NAME);

    const day = '2026-08-27';
    const ready = await isD1RangeReady(harness as unknown as D1Database, 1, [day]);
    expect(ready).toBe(false);
  });

  it('blocks isD1RangeReady when no backfill state exists', async () => {
    const ready = await isD1RangeReady(harness as unknown as D1Database, 1, ['2026-08-27']);
    expect(ready).toBe(false);
  });

  it('allows isD1RangeReady when state version matches current JOB_VERSION', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    const summary = await runToCompletion(env);
    expect(summary.done).toBe(true);

    const day = '2026-08-27';
    const ready = await isD1RangeReady(harness as unknown as D1Database, 1, [day]);
    expect(ready).toBe(true);
  });

  it('resets v2 state to v3 and invalidates backfill coverage on first backfill run', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    // Complete a full v2 backfill first.
    const v2 = await runToCompletion(env);
    expect(v2.done).toBe(true);
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('complete');

    // Downgrade to v2 (simulate pre-deploy state).
    harness.sqlite
      .prepare(`UPDATE stats_backfill_state SET version = 2, status = 'done', phase = 'done' WHERE job_name = ?`)
      .run(JOB_NAME);
    expect(rows(harness.sqlite, 'SELECT version FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0].version).toBe(2);

    // First run after version bump must detect mismatch, atomically reset
    // state to v3, and invalidate every backfill-owned coverage row.
    const firstRun = await runDailyAggregateBackfill(env, NOW);

    // State is now v2 and running (the run continued processing after reset).
    const stateRow = rows(harness.sqlite, 'SELECT version, status FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0];
    expect(stateRow.version).toBe(JOB_VERSION);
    expect(stateRow.status).toBe('running');

    // Backfill-owned coverage rows are invalidated to pending.
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('pending');
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').reason_code).toBeNull();
    expect(coverageRow(harness.sqlite, 1, '2024-01-15').base_status).toBe('pending');

    // Live-owned coverage is untouched — simulate a live write first.
    kv.map.set('stats_v2:99:2026-08-27:100', '1');
    kv.map.set('user:100', 'live_user');
    seedActivity(harness.sqlite, 99, '2026-08-27', 1);
    await writeActivityAggregates(harness as unknown as D1Database, {
      chatId: 99,
      userId: 100,
      username: 'live_user',
      day: '2026-08-27',
      hour: 9,
      bucket: 'morning',
      wordCount: 0,
      voiceCount: 0,
      voiceDurationSeconds: 0,
      videoNoteCount: 0,
      videoNoteDurationSeconds: 0,
      ts: 1000,
    });
    expect(coverageRow(harness.sqlite, 99, '2026-08-27').source).toBe('live');
    expect(coverageRow(harness.sqlite, 99, '2026-08-27').base_status).toBe('live');

    // Run backfill again — it picks up from base phase but the version reset
    // already happened so this run processes normally.
    const secondRun = await runDailyAggregateBackfill(env, NOW);
    expect(secondRun.leaseBlocked).toBe(false);

    // Live coverage still live.
    expect(coverageRow(harness.sqlite, 99, '2026-08-27').source).toBe('live');
  });

  it('no range can be D1-ready between version mismatch and reprocessed completion', async () => {
    seedStandardCounters(kv.map, harness.sqlite);
    // Complete a v2 backfill.
    await runToCompletion(env);
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('complete');

    // Downgrade to v2.
    harness.sqlite
      .prepare('UPDATE stats_backfill_state SET version = 2 WHERE job_name = ?')
      .run(JOB_NAME);

    // Not ready because version is stale.
    const day = '2026-08-27';
    expect(await isD1RangeReady(harness as unknown as D1Database, 1, [day])).toBe(false);

    // Run one backfill invocation — this resets state + coverage but does not
    // complete all phases.
    const r1 = await runDailyAggregateBackfill(env, NOW);
    expect(r1.done).toBe(false);

    // Still not ready: coverage is pending, not complete.
    expect(await isD1RangeReady(harness as unknown as D1Database, 1, [day])).toBe(false);

    // Complete the rescan.
    const final = await runToCompletion(env);
    expect(final.done).toBe(true);

    // Now ready again.
    expect(await isD1RangeReady(harness as unknown as D1Database, 1, [day])).toBe(true);
  });

  it('blocks every source data mutation from a token captured before a version reset', async () => {
    const day = '2026-08-27';
    kv.map.set(`stats_v2:1:${day}:100`, '5');
    kv.map.set('user:100', 'alice');

    await runDailyAggregateBackfill(env, NOW);
    const oldAggregate = loggedStatement(harness, 'INSERT INTO stats_daily_user');
    const oldProfile = loggedStatement(harness, 'INSERT INTO stats_chat_user_profile');
    const oldCoverage = loggedStatement(harness, 'INSERT INTO stats_daily_coverage');

    // Execute the actual version-reset path. Its successor epoch invalidates all
    // three statements captured by the first invocation.
    harness.sqlite
      .prepare(
        `UPDATE stats_backfill_state
         SET version = 1, status = 'done', phase = 'done', lease_owner = NULL, lease_expires_at = NULL
         WHERE job_name = ?`,
    )
      .run(JOB_NAME);
    const resetRun = await runDailyAggregateBackfill(env, NOW);
    expect(resetRun.errorCode).toBeNull();

    harness.sqlite.prepare('DELETE FROM stats_daily_user WHERE chat_id = ? AND day = ?').run(1, day);
    harness.sqlite.prepare('DELETE FROM stats_chat_user_profile WHERE chat_id = ? AND user_id = ?').run(1, 100);
    harness.sqlite.prepare('DELETE FROM stats_daily_coverage WHERE chat_id = ? AND day = ?').run(1, day);

    // Absent aggregate/profile/coverage rows cannot be inserted by old epoch.
    expect(replay(harness.sqlite, oldAggregate).changes).toBe(0);
    expect(replay(harness.sqlite, oldProfile).changes).toBe(0);
    expect(replay(harness.sqlite, oldCoverage).changes).toBe(0);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user WHERE chat_id = 1 AND day = ?', [day])[0].n).toBe(0);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_chat_user_profile WHERE chat_id = 1 AND user_id = 100')[0].n).toBe(0);
    expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_coverage WHERE chat_id = 1 AND day = ?', [day])[0].n).toBe(0);

    // An existing aggregate row cannot be overwritten by that old epoch either.
    harness.sqlite
      .prepare('INSERT INTO stats_daily_user (chat_id, day, user_id, message_count) VALUES (?, ?, ?, ?)')
      .run(1, day, 100, 99);
    expect(replay(harness.sqlite, oldAggregate).changes).toBe(0);
    expect(
      rows(harness.sqlite, 'SELECT message_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 100', [day])[0]
        .message_count,
    ).toBe(99);
  });

  it('blocks pre-reset finalize complete and defer mutations', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    const day = '2026-08-27';
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'finalize', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    for (const chatId of [1, 2]) {
      harness.sqlite
        .prepare(
          `INSERT INTO stats_daily_coverage
             (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
           VALUES (?, ?, 'pending', 'pending', 'pending', 'backfill', NULL, ?)`,
        )
        .run(chatId, day, nowSec);
    }
    harness.sqlite
      .prepare('INSERT INTO stats_daily_user (chat_id, day, user_id, message_count) VALUES (?, ?, ?, ?)')
      .run(1, day, 100, 1);
    seedActivity(harness.sqlite, 1, day, 1);

    await runDailyAggregateBackfill(env, NOW);
    const oldComplete = loggedStatement(harness, "base_status = 'complete'");
    const oldDefer = loggedStatement(harness, 'SET reason_code = ?');

    harness.sqlite.prepare('UPDATE stats_backfill_state SET version = 1 WHERE job_name = ?').run(JOB_NAME);
    await runDailyAggregateBackfill(env, NOW);
    expect(coverageRow(harness.sqlite, 1, day).base_status).toBe('pending');
    expect(coverageRow(harness.sqlite, 2, day).reason_code).toBeNull();

    expect(replay(harness.sqlite, oldComplete).changes).toBe(0);
    expect(replay(harness.sqlite, oldDefer).changes).toBe(0);
    expect(coverageRow(harness.sqlite, 1, day).base_status).toBe('pending');
    expect(coverageRow(harness.sqlite, 2, day).reason_code).toBeNull();
  });

  it.each(['revision', 'owner', 'expiry'] as const)(
    'blocks source data and checkpoint when %s changes after acquire',
    async (change) => {
      const day = '2026-08-27';
      const nowSec = Math.floor(NOW.getTime() / 1000);
      kv.map.set(`stats_v2:1:${day}:100`, '5');
      kv.map.set('user:100', 'alice');
      let changed = false;
      kv.kv.get.mockImplementation(async (key: string) => {
        if (!changed) {
          changed = true;
          if (change === 'revision') {
            harness.sqlite
              .prepare('UPDATE stats_backfill_state SET revision = revision + 1 WHERE job_name = ?')
              .run(JOB_NAME);
          } else if (change === 'owner') {
            harness.sqlite
              .prepare('UPDATE stats_backfill_state SET lease_owner = ?, lease_expires_at = ? WHERE job_name = ?')
              .run('replacement-runner', nowSec + 600, JOB_NAME);
          } else {
            harness.sqlite
              .prepare('UPDATE stats_backfill_state SET lease_expires_at = ? WHERE job_name = ?')
              .run(nowSec - 1, JOB_NAME);
          }
        }
        return kv.map.get(key) ?? null;
      });

      const summary = await runDailyAggregateBackfill(env, NOW);
      expect(summary.errorCode).toBe('lease_lost');
      expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_user', [])[0].n).toBe(0);
      expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_chat_user_profile', [])[0].n).toBe(0);
      expect(rows(harness.sqlite, 'SELECT COUNT(*) AS n FROM stats_daily_coverage', [])[0].n).toBe(0);
      const state = rows(
        harness.sqlite,
        'SELECT phase, page_offset FROM stats_backfill_state WHERE job_name = ?',
        [JOB_NAME],
      )[0];
      expect(state.phase).toBe('base');
      expect(state.page_offset).toBe(0);
    },
  );

  it('permits current-epoch data writes while preserving live coverage ownership', async () => {
    const day = '2026-08-27';
    const nowSec = Math.floor(NOW.getTime() / 1000);
    kv.map.set(`stats_v2:1:${day}:100`, '5');
    kv.map.set('user:100', 'alice');
    harness.sqlite
      .prepare(
        `INSERT INTO stats_daily_coverage
           (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
         VALUES (?, ?, 'live', 'none', 'none', 'live', NULL, ?)`,
      )
      .run(1, day, nowSec);

    const summary = await runDailyAggregateBackfill(env, NOW);
    expect(summary.errorCode).toBeNull();
    expect(
      rows(harness.sqlite, 'SELECT message_count FROM stats_daily_user WHERE chat_id = 1 AND day = ? AND user_id = 100', [day])[0]
        .message_count,
    ).toBe(5);
    expect(rows(harness.sqlite, 'SELECT username FROM stats_chat_user_profile WHERE chat_id = 1 AND user_id = 100')[0].username).toBe('alice');
    expect(coverageRow(harness.sqlite, 1, day)).toEqual({
      base_status: 'live',
      profanity_status: 'none',
      criminal_status: 'none',
      source: 'live',
      reason_code: null,
    });
  });

  it('does not invalidate coverage when a version-reset CAS loses its observed revision', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, 1, 'done', 'done', ?, NULL, 0, NULL, NULL, 7, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_daily_coverage
           (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
         VALUES (1, '2026-08-27', 'complete', 'complete', 'complete', 'backfill', NULL, ?)`,
      )
      .run(nowSec);

    const originalBatch = harness.batch.bind(harness);
    const batchSpy = vi.spyOn(harness, 'batch').mockImplementationOnce(async (statements) => {
      harness.sqlite
        .prepare('UPDATE stats_backfill_state SET revision = revision + 1 WHERE job_name = ?')
        .run(JOB_NAME);
      return originalBatch(statements);
    });
    const summary = await runDailyAggregateBackfill(env, NOW);
    batchSpy.mockRestore();

    expect(summary.leaseBlocked).toBe(true);
    expect(coverageRow(harness.sqlite, 1, '2026-08-27').base_status).toBe('complete');
    expect(rows(harness.sqlite, 'SELECT version, revision FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0]).toEqual({
      version: 1,
      revision: 8,
    });
  });

  it('finishes atomically when its finalizer state changes only after the admitted batch commits', async () => {
    const nowSec = Math.floor(NOW.getTime() / 1000);
    const day = '2026-08-27';
    harness.sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset,
            lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'finalize', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)`,
      )
      .run(JOB_NAME, CUTOFF_DAY, nowSec, nowSec);
    harness.sqlite
      .prepare(
        `INSERT INTO stats_daily_coverage
           (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
         VALUES (1, ?, 'pending', 'pending', 'pending', 'backfill', NULL, ?)`,
      )
      .run(day, nowSec);
    harness.sqlite
      .prepare('INSERT INTO stats_daily_user (chat_id, day, user_id, message_count) VALUES (1, ?, 100, 1)')
      .run(day);
    seedActivity(harness.sqlite, 1, day, 1);

    const originalBatch = harness.batch.bind(harness);
    const batchSpy = vi.spyOn(harness, 'batch').mockImplementationOnce(async (statements) => {
      const results = await originalBatch(statements);
      harness.sqlite
        .prepare('UPDATE stats_backfill_state SET revision = revision + 1 WHERE job_name = ?')
        .run(JOB_NAME);
      return results;
    });
    const summary = await runDailyAggregateBackfill(env, NOW);
    batchSpy.mockRestore();

    expect(summary.errorCode).toBeNull();
    expect(summary.done).toBe(true);
    expect(
      rows(harness.sqlite, 'SELECT status, phase FROM stats_backfill_state WHERE job_name = ?', [JOB_NAME])[0],
    ).toEqual({ status: 'done', phase: 'done' });
  });
});
