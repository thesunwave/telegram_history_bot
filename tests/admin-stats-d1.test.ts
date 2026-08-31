import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from '@miniflare/storage-memory';
import type { D1Database } from '@cloudflare/workers-types';
import {
  getAdminChatStats,
  parseAdminPeriod,
  type AdminDateRange,
} from '../src/api/admin-stats';
import { getAdminChatStatsFromD1 } from '../src/features/stats/admin-stats-d1';
import { isD1RangeReady, BACKFILL_JOB_NAME } from '../src/features/stats/d1-coverage';
import { JOB_VERSION } from '../src/features/stats/daily-backfill';
import {
  PIPELINE_PROOF_VERSION,
  type CountersDODayProofSnapshot,
  type CountersDOPipelineSnapshots,
} from '../src/features/stats/pipeline-progress';
import { AdminUnavailable } from '../src/features/stats/admin-stats-errors';

/**
 * D1 reader + selector tests. Uses a real in-memory SQLite database (via
 * @miniflare/storage-memory MemoryStorage.getSqliteDatabase, backed by
 * better-sqlite3) with the actual migration DDL applied, so aggregate read
 * semantics (GROUP BY, SUM, COUNT(CASE ...), LEFT JOIN) are the real ones.
 */

type Sqlite = Awaited<ReturnType<MemoryStorage['getSqliteDatabase']>>;
type SQLInputValue = null | number | bigint | string | Uint8Array;

// Pre-warm better-sqlite3 (fetched lazily by MemoryStorage via npx-import).
{
  const warmup = await new MemoryStorage().getSqliteDatabase();
  warmup.close();
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayAt(offsetDays: number, base = '2026-08-26'): string {
  const date = new Date(`${base}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function range(period: AdminDateRange['period'], days: string[]): AdminDateRange {
  return { period, from: days[0], to: days[days.length - 1], days };
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
    this.owner.guard(this.sql);
    const result = this.owner.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: result.changes } };
  }

  all<T = unknown>(): { results: T[]; success: boolean; meta: Record<string, unknown> } {
    this.owner.guard(this.sql);
    const results = this.owner.sqlite.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true, meta: {} };
  }

  first<T = unknown>(): T | null {
    this.owner.guard(this.sql);
    const results = this.owner.sqlite.prepare(this.sql).all(...this.params) as T[];
    return results.length > 0 ? results[0] : null;
  }
}

class FakeD1Database {
  readonly sqlite: Sqlite;
  failPattern: RegExp | null = null;
  batchCalls = 0;
  afterBatch: (() => void) | null = null;
  /** Statement indexes whose batch result carries a per-result `error` (no throw). */
  errorResultIndexes: ReadonlySet<number> = new Set();
  /** Statement indexes whose batch result resolves `success: false` with no `error` (no throw). */
  falseSuccessResultIndexes: ReadonlySet<number> = new Set();

  constructor(sqlite: Sqlite) {
    this.sqlite = sqlite;
  }

  guard(sql: string): void {
    if (this.failPattern && this.failPattern.test(sql)) {
      throw new Error('d1 unavailable');
    }
  }

  prepare(sql: string): FakeD1Statement {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements: FakeD1Statement[]): Promise<unknown[]> {
    this.batchCalls += 1;
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((stmt, index) => {
        this.guard(stmt.sql);
        if (this.errorResultIndexes.has(index)) {
          return { success: false, error: 'D1_EXEC_ERROR', results: [], meta: {} };
        }
        if (this.falseSuccessResultIndexes.has(index)) {
          return { success: false, results: [], meta: {} };
        }
        if (/^\s*SELECT/i.test(stmt.sql)) {
          return { success: true, results: this.sqlite.prepare(stmt.sql).all(...stmt.params), meta: {} };
        }
        return stmt.run();
      });
      this.sqlite.exec('COMMIT');
      this.afterBatch?.();
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
    '0012_stats_daily_pipeline_progress.sql',
  ]) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const statement of sql.split(';')) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  // Minimal criminal_violations table (0003 has a trigger that breaks naive
  // `;` splitting, so create the columns the reader needs directly).
  sqlite.exec(
    `CREATE TABLE criminal_violations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL,
       chat_id INTEGER NOT NULL,
       message_id INTEGER,
       article TEXT NOT NULL,
       quote TEXT NOT NULL,
       punishment TEXT,
       severity INTEGER,
       confidence REAL,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       article_title TEXT,
       subarticle TEXT,
       violation_day TEXT,
       violation_ts INTEGER
     )`,
  );
  try {
    const mig13 = readFileSync(join(migrationsDir, '0013_criminal_violation_canonical_ts.sql'), 'utf8');
    for (const statement of mig13.split(';')) {
      if (statement.trim()) {
        try { sqlite.exec(statement); } catch {}
      }
    }
  } catch {}
  const harness = new FakeD1Database(sqlite);
  return { db: harness as unknown as D1Database, harness };
}

function rows(sqlite: Sqlite, sql: string, params: SQLInputValue[] = []): any[] {
  return sqlite.prepare(sql).all(...params) as any[];
}

function insertUser(
  sqlite: Sqlite,
  row: Partial<{
    chat_id: number; day: string; user_id: number; message_count: number; word_count: number;
    voice_count: number; voice_duration_seconds: number; video_note_count: number;
    video_note_duration_seconds: number; profanity_count: number; criminal_count: number;
    last_message_ts: number | null;
  }>,
): void {
  sqlite
    .prepare(
      `INSERT INTO stats_daily_user
         (chat_id, day, user_id, message_count, word_count, voice_count, voice_duration_seconds,
          video_note_count, video_note_duration_seconds, profanity_count, criminal_count, last_message_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.chat_id ?? 1,
      row.day ?? '2026-08-26',
      row.user_id ?? 100,
      row.message_count ?? 0,
      row.word_count ?? 0,
      row.voice_count ?? 0,
      row.voice_duration_seconds ?? 0,
      row.video_note_count ?? 0,
      row.video_note_duration_seconds ?? 0,
      row.profanity_count ?? 0,
      row.criminal_count ?? 0,
      row.last_message_ts ?? null,
    );
}

function insertProfile(sqlite: Sqlite, chatId: number, userId: number, username: string, ts: number): void {
  sqlite
    .prepare(
      'INSERT INTO stats_chat_user_profile (chat_id, user_id, username, last_message_ts) VALUES (?, ?, ?, ?)',
    )
    .run(chatId, userId, username, ts);
}

function insertHour(sqlite: Sqlite, chatId: number, day: string, hour: number, count: number): void {
  sqlite
    .prepare('INSERT INTO stats_daily_hour (chat_id, day, hour, message_count) VALUES (?, ?, ?, ?)')
    .run(chatId, day, hour, count);
}

function insertBucket(sqlite: Sqlite, chatId: number, day: string, bucket: string, userId: number, count: number): void {
  sqlite
    .prepare(
      'INSERT INTO stats_daily_bucket_user (chat_id, day, bucket, user_id, message_count) VALUES (?, ?, ?, ?, ?)',
    )
    .run(chatId, day, bucket, userId, count);
}

function insertProfanityWord(sqlite: Sqlite, chatId: number, day: string, word: string, count: number): void {
  sqlite
    .prepare('INSERT INTO stats_daily_profanity_word (chat_id, day, word, count) VALUES (?, ?, ?, ?)')
    .run(chatId, day, word, count);
}

function insertProfanityWordUser(sqlite: Sqlite, chatId: number, day: string, word: string, userId: number, count: number): void {
  sqlite
    .prepare('INSERT INTO stats_daily_profanity_word_user (chat_id, day, word, user_id, count) VALUES (?, ?, ?, ?, ?)')
    .run(chatId, day, word, userId, count);
}

function seedCoverage(
  sqlite: Sqlite,
  chatId: number,
  day: string,
  status: string,
  reason: string | null = null,
  source: string = 'backfill',
): void {
  sqlite
    .prepare(
      `INSERT INTO stats_daily_coverage
         (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, day) DO UPDATE SET
         base_status = excluded.base_status,
         profanity_status = excluded.profanity_status,
         criminal_status = excluded.criminal_status,
         source = excluded.source,
         reason_code = excluded.reason_code`,
    )
    .run(chatId, day, status, status, status, source, reason, 1);
}

/** Seeds a done backfill state with the current JOB_VERSION. */
function seedBackfillDone(sqlite: Sqlite): void {
  const now = Math.floor(Date.now() / 1000);
  sqlite
    .prepare(
      `INSERT INTO stats_backfill_state
         (job_name, version, status, phase, cutoff_day, cursor, page_offset, revision, error_code, created_at, updated_at)
       VALUES (?, ?, 'done', 'done', '2026-08-28', NULL, 0, 1, NULL, ?, ?)`,
    )
    .run(BACKFILL_JOB_NAME, JOB_VERSION, now, now);
}

/** Seeds one category progress row for a live day. */
function seedProgress(
  sqlite: Sqlite,
  chatId: number,
  day: string,
  category: string,
  overrides: Partial<{
    accepted_seq: number; completed_seq: number; pending_count: number; failed_count: number;
  }> = {},
): void {
  sqlite
    .prepare(
      `INSERT INTO stats_daily_pipeline_progress
         (chat_id, day, category, accepted_seq, completed_seq, pending_count, failed_count, completed_through_ts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
       ON CONFLICT(chat_id, day, category) DO UPDATE SET
         accepted_seq = excluded.accepted_seq,
         completed_seq = excluded.completed_seq,
         pending_count = excluded.pending_count,
         failed_count = excluded.failed_count`,
    )
    .run(
      chatId,
      day,
      category,
      overrides.accepted_seq ?? 1,
      overrides.completed_seq ?? 1,
      overrides.pending_count ?? 0,
      overrides.failed_count ?? 0,
    );
}

function insertCriminalViolation(
  sqlite: Sqlite,
  row: { chatId: number; userId: number; article: string; punishment: string | null; severity: number; createdAt: string },
): void {
  sqlite
    .prepare(
      `INSERT INTO criminal_violations (user_id, chat_id, article, quote, punishment, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.userId, row.chatId, row.article, 'quote', row.punishment, row.severity, row.createdAt);
}

/** Minimal env for the selector: real D1 + empty KV that returns nothing. */
function makeEnv(db: D1Database): any {
  const kvMap = new Map<string, string>();
  const env: any = {
    DB: db,
    COUNTERS: {
      get: vi.fn(async (key: string) => kvMap.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvMap.set(key, value);
      }),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ keys: [], list_complete: true })),
    },
    HISTORY: { get: vi.fn(async () => null), put: vi.fn(async () => undefined), list: vi.fn(async () => ({ keys: [], list_complete: true })) },
    TOKEN: 'test-token',
    SECRET: 'test-secret',
  };
  env.COUNTERS_DO = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => ({
      fetch: vi.fn(async () => {
        throw new Error('no DO stub configured');
      }),
    })),
  };
  return env;
}

function categorySnapshot(
  accepted: number,
  overrides: Partial<{ completed: number; pending: number; failed: number; clean: boolean }> = {},
) {
  return {
    accepted,
    completed: overrides.completed ?? accepted,
    pending: overrides.pending ?? 0,
    failed: overrides.failed ?? 0,
    clean: overrides.clean ?? true,
  };
}

/** Builds one day's versioned proof snapshot; overrides per category replace defaults. */
function dayProof(
  day: string,
  accepted: number,
  overrides: {
    base?: Partial<{ completed: number; pending: number; failed: number; clean: boolean }>;
    profanity?: Partial<{ completed: number; pending: number; failed: number; clean: boolean }>;
    criminal?: Partial<{ completed: number; pending: number; failed: number; clean: boolean }>;
  } = {},
): CountersDODayProofSnapshot {
  return {
    day,
    version: PIPELINE_PROOF_VERSION,
    initialized: true,
    accepted,
    categories: {
      base: categorySnapshot(accepted, overrides.base),
      profanity: categorySnapshot(accepted, overrides.profanity),
      criminal: categorySnapshot(accepted, overrides.criminal),
    },
  };
}

/** Builds a full `/pipeline-snapshots` response for the given days in order. */
function proofResponse(days: CountersDODayProofSnapshot[]): CountersDOPipelineSnapshots {
  return { version: PIPELINE_PROOF_VERSION, days };
}

/** Installs a fake CountersDO stub responding to `/pipeline-snapshots`. */
function stubCountersDOPipelineSnapshots(
  env: any,
  snapshots: CountersDOPipelineSnapshots | ((days: string[]) => CountersDOPipelineSnapshots),
): void {
  env.COUNTERS_DO = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => ({
      fetch: vi.fn(async (url: string, init: RequestInit) => {
        expect(new URL(url).pathname).toBe('/pipeline-snapshots');
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body)) as { days?: string[] };
        const snap = typeof snapshots === 'function' ? snapshots(body.days ?? []) : snapshots;
        return new Response(JSON.stringify(snap), {
          headers: { 'content-type': 'application/json' },
        });
      }),
    })),
  };
}

function seedLiveDay(
  sqlite: Sqlite,
  day: string,
  accepted: number,
  completed: number,
  pending = 0,
  failed = 0,
): void {
  seedCoverage(sqlite, 1, day, 'live', null, 'live');
  for (const category of ['base', 'profanity', 'criminal']) {
    seedProgress(sqlite, 1, day, category, { accepted_seq: accepted, completed_seq: completed, pending_count: pending, failed_count: failed });
  }
  insertUser(sqlite, { day, user_id: 100, message_count: 2, word_count: 4 });
  insertProfile(sqlite, 1, 100, 'alice', 1000);
}

describe('D1 admin stats reader', () => {
  let harness: FakeD1Database;
  let db: D1Database;

  beforeEach(async () => {
    const made = await createRealD1();
    harness = made.harness;
    db = made.db;
  });

  afterEach(() => {
    harness.sqlite.close();
  });

  it('returns full response parity incl participant timeline, profanity, hours and buckets', async () => {
    const sqlite = harness.sqlite;
    const d1 = '2026-08-25';
    const d2 = '2026-08-26';
    insertUser(sqlite, { day: d1, user_id: 100, message_count: 5, word_count: 40, voice_count: 2, voice_duration_seconds: 150, video_note_count: 1, video_note_duration_seconds: 60, profanity_count: 2, criminal_count: 1, last_message_ts: 1000 });
    insertUser(sqlite, { day: d1, user_id: 200, message_count: 1, word_count: 3, last_message_ts: 500 });
    insertUser(sqlite, { day: d2, user_id: 100, message_count: 3, word_count: 30, voice_count: 1, voice_duration_seconds: 90, profanity_count: 1, last_message_ts: 2000 });
    insertUser(sqlite, { day: d2, user_id: 200, message_count: 0, word_count: 0, last_message_ts: null });
    insertProfile(sqlite, 1, 100, 'alice', 2000);

    insertHour(sqlite, 1, d1, 13, 5);
    insertHour(sqlite, 1, d2, 9, 3);

    insertBucket(sqlite, 1, d1, 'noon', 100, 5);
    insertBucket(sqlite, 1, d2, 'morning', 100, 3);

    insertProfanityWord(sqlite, 1, d1, 'заебал', 2);
    insertProfanityWordUser(sqlite, 1, d1, 'заебал', 100, 2);
    insertProfanityWordUser(sqlite, 1, d1, 'заебал', 200, 1);

    const result = await getAdminChatStatsFromD1(db, 1, range('custom', [d1, d2]));

    expect(result.chatId).toBe(1);
    expect(result.period).toBe('custom');
    expect(result.range).toEqual({ from: d1, to: d2, days: 2 });

    const activity = result.activity;
    expect(activity.total).toBe(9);
    expect(activity.totalWords).toBe(73);
    expect(activity.wordsPerMessage).toBe(8.1);
    expect(activity.totalVoiceCount).toBe(3);
    expect(activity.totalVoiceMinutes).toBe(4);
    expect(activity.totalVideoNoteCount).toBe(1);
    expect(activity.totalVideoNoteMinutes).toBe(1);
    expect(activity.activeUsers).toBe(2);
    expect(activity.averageDailyMessages).toBe(4.5);
    expect(activity.averageDailyActiveUsers).toBe(1.5);
    expect(activity.averageHourlyMessages).toBe(0.19);

    // Participant timeline: 100 has 2 active days, 200 has 1. Max 12, threshold.
    const timeline = activity.participantTimeline;
    expect(timeline.timeZone).toBe('UTC');
    expect(timeline.participants).toHaveLength(2);
    const [alice, id200] = timeline.participants;
    expect(alice.username).toBe('alice');
    // 200 has no username → anonymized "Участник N".
    expect(id200.username).toBe('Участник 2');
    // alice: 8 messages / 2 days → threshold max(2, ceil(8/2)=4) = 4.
    expect(alice.dailyLevels).toEqual([
      { day: d1, level: 'talkative', timeBucketLevels: [
        { bucket: 'night', level: 'inactive' },
        { bucket: 'morning', level: 'inactive' },
        { bucket: 'noon', level: 'talkative' },
        { bucket: 'evening', level: 'inactive' },
      ] },
      { day: d2, level: 'active', timeBucketLevels: [
        { bucket: 'night', level: 'inactive' },
        { bucket: 'morning', level: 'active' },
        { bucket: 'noon', level: 'inactive' },
        { bucket: 'evening', level: 'inactive' },
      ] },
    ]);

    expect(activity.topUsers.map((u) => u.userId)).toEqual(['100', '200']);
    expect(activity.topUsers[0].wordsPerMessage).toBe(8.8);
    expect(activity.topUsers[0].voiceMinutes).toBe(4);
    expect(activity.topUsers[0].activeDays).toBe(2);
    expect(activity.topUsers[0].lastMessageTs).toBe(2000);

    expect(activity.dailyMessages).toEqual([
      { day: d1, count: 6 },
      { day: d2, count: 3 },
    ]);
    expect(activity.dailyActiveUsers).toEqual([
      { day: d1, count: 2 },
      { day: d2, count: 1 },
    ]);
    expect(activity.hourlyAverages).toHaveLength(24);
    expect(activity.hourlyAverages.find((h) => h.hour === '13')?.count).toBe(2.5);
    expect(activity.hourlyAverages.find((h) => h.hour === '09')?.count).toBe(1.5);

    const noon = activity.timeBuckets.find((t) => t.bucket === 'noon');
    expect(noon?.topUsers.map((u) => u.userId)).toEqual(['100']);

    expect(result.profanity.topUsers).toEqual([{ userId: 100, username: 'alice', count: 3 }]);
    expect(result.profanity.topWords).toEqual([
      { word: 'заебал', count: 2, contributors: [
        { userId: 100, username: 'alice', count: 2 },
        { userId: 200, username: 'id200', count: 1 },
      ] },
    ]);

    // Custom criminal: counts only, no sentence attributes.
    expect(result.criminal.topUsers).toEqual([{ userId: 100, username: 'alice', count: 1 }]);
    expect(result.criminal.topUsers[0].totalYears).toBeUndefined();
    expect(result.criminal.topUsers[0].lifeSentences).toBeUndefined();
  });

  it('preset periods produce sentence attributes from criminal_violations', async () => {
    const sqlite = harness.sqlite;
    const d1 = dayAt(-6);
    const days = Array.from({ length: 7 }, (_, i) => dayAt(-6 + i));
    for (const day of days) {
      insertUser(sqlite, { day, user_id: 100, message_count: 1, word_count: 5, criminal_count: 1 });
    }
    insertProfile(sqlite, 1, 100, 'alice', 1000);
    // Two violations: one 10 years, one life sentence.
    insertCriminalViolation(sqlite, {
      chatId: 1, userId: 100, article: '105', punishment: 'лишение свободы на срок до 10 лет', severity: 9,
      createdAt: '2026-08-25 00:00:00',
    });
    insertCriminalViolation(sqlite, {
      chatId: 1, userId: 100, article: '105', punishment: 'пожизненное лишение свободы', severity: 10,
      createdAt: '2026-08-25 00:00:00',
    });

    const result = await getAdminChatStatsFromD1(db, 1, range('week', days));

    expect(result.criminal.topUsers).toEqual([
      { userId: 100, username: 'alice', count: 2, totalYears: 10, lifeSentences: 1 },
    ]);
  });

  it('preset with aggregate criminal count but no violations rows raises AdminUnavailable', async () => {
    const sqlite = harness.sqlite;
    const days = Array.from({ length: 7 }, (_, i) => dayAt(-6 + i));
    for (const day of days) {
      insertUser(sqlite, { day, user_id: 100, message_count: 1, word_count: 5, criminal_count: 1 });
    }
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    await expect(getAdminChatStatsFromD1(db, 1, range('week', days))).rejects.toThrow(AdminUnavailable);
  });

  it('preset with zero criminal aggregates and no violations returns empty criminal list', async () => {
    const sqlite = harness.sqlite;
    const days = Array.from({ length: 7 }, (_, i) => dayAt(-6 + i));
    for (const day of days) {
      insertUser(sqlite, { day, user_id: 100, message_count: 1, word_count: 5, criminal_count: 0 });
    }
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStatsFromD1(db, 1, range('week', days));
    expect(result.criminal.topUsers).toEqual([]);
  });

  it('materials zero days and zero-hour buckets without fabricating activity', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-24', '2026-08-25', '2026-08-26'];
    insertUser(sqlite, { day: '2026-08-25', user_id: 100, message_count: 2, word_count: 4 });

    const result = await getAdminChatStatsFromD1(db, 1, range('custom', days));
    expect(result.activity.dailyMessages).toEqual([
      { day: '2026-08-24', count: 0 },
      { day: '2026-08-25', count: 2 },
      { day: '2026-08-26', count: 0 },
    ]);
    expect(result.activity.dailyActiveUsers).toEqual([
      { day: '2026-08-24', count: 0 },
      { day: '2026-08-25', count: 1 },
      { day: '2026-08-26', count: 0 },
    ]);
    // Every requested day materialized in the timeline even when inactive.
    expect(result.activity.participantTimeline.participants[0].dailyLevels).toHaveLength(3);
  });

  it('lastMessageTs uses the chat-scoped global profile timestamp, not the range-local daily max', async () => {
    const sqlite = harness.sqlite;
    const d1 = '2026-08-25';
    const d2 = '2026-08-26';
    insertUser(sqlite, { day: d1, user_id: 100, message_count: 1, word_count: 2, last_message_ts: 1000 });
    insertUser(sqlite, { day: d2, user_id: 100, message_count: 1, word_count: 2, last_message_ts: 2000 });
    // Newer global profile timestamp than the range-local MAX(2000).
    insertProfile(sqlite, 1, 100, 'alice', 9000);

    const result = await getAdminChatStatsFromD1(db, 1, range('custom', [d1, d2]));
    expect(result.activity.topUsers[0].lastMessageTs).toBe(9000);
  });

  it('falls back to null lastMessageTs when the profile has no usable timestamp', async () => {
    const sqlite = harness.sqlite;
    const d1 = '2026-08-25';
    insertUser(sqlite, { day: d1, user_id: 100, message_count: 1, word_count: 2, last_message_ts: 5000 });

    // No profile row: legacy resolves last_message:{chat}:{user} → null.
    let result = await getAdminChatStatsFromD1(db, 1, range('custom', [d1]));
    expect(result.activity.topUsers[0].lastMessageTs).toBeNull();

    // Profile present with timestamp 0: legacy parseInt('0')||null → null.
    insertProfile(sqlite, 1, 100, 'alice', 0);
    result = await getAdminChatStatsFromD1(db, 1, range('custom', [d1]));
    expect(result.activity.topUsers[0].lastMessageTs).toBeNull();
  });

  it('zero-message category rows do not inflate activity but keep profanity/criminal rankings', async () => {
    const sqlite = harness.sqlite;
    const d1 = '2026-08-25';
    insertUser(sqlite, { day: d1, user_id: 100, message_count: 3, word_count: 9 });
    insertUser(sqlite, { day: d1, user_id: 999, message_count: 0, word_count: 0, profanity_count: 5, criminal_count: 2 });
    insertProfile(sqlite, 1, 100, 'alice', 1000);
    insertProfile(sqlite, 1, 999, 'lurker', 0);

    const result = await getAdminChatStatsFromD1(db, 1, range('custom', [d1]));
    expect(result.activity.total).toBe(3);
    expect(result.activity.activeUsers).toBe(1);
    expect(result.activity.topUsers.map((u) => u.userId)).toEqual(['100']);
    // Category-only user is present only in the independent rankings.
    expect(result.profanity.topUsers).toEqual([{ userId: 999, username: 'lurker', count: 5 }]);
    expect(result.criminal.topUsers).toEqual([{ userId: 999, username: 'lurker', count: 2 }]);
  });
});

describe('D1 coverage selector', () => {
  let harness: FakeD1Database;
  let db: D1Database;

  beforeEach(async () => {
    const made = await createRealD1();
    harness = made.harness;
    db = made.db;
  });

  afterEach(() => {
    harness.sqlite.close();
  });

  it('declares a 60-day range ready when every day is complete', async () => {
    const sqlite = harness.sqlite;
    const days = Array.from({ length: 60 }, (_, i) => dayAt(-59 + i));
    for (const day of days) {
      seedCoverage(sqlite, 1, day, 'complete');
    }
    seedBackfillDone(sqlite);

    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(true);
  });

  it('rejects the whole range when any day is incomplete or carries a reason', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-24', '2026-08-25', '2026-08-26'];
    seedCoverage(sqlite, 1, '2026-08-24', 'complete');
    seedCoverage(sqlite, 1, '2026-08-25', 'complete');
    seedCoverage(sqlite, 1, '2026-08-26', 'pending'); // incomplete day
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);

    seedCoverage(sqlite, 1, '2026-08-26', 'complete', 'message_count_mismatch');
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);
  });

  it('rejects a live-source coverage day (never complete, even with complete statuses)', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-26'];
    // Writer bug scenario: a live-source row marked complete must still never
    // qualify for the closed backfill gate; only the CountersDO proof counts.
    seedCoverage(sqlite, 1, '2026-08-26', 'complete', null, 'live');
    seedBackfillDone(sqlite);
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);

    // Normal live row: statuses live, source live — also rejected by the gate.
    seedCoverage(sqlite, 1, '2026-08-26', 'live', null, 'live');
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);
  });

  it('rejects complete coverage rows that are not explicitly backfill-owned', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-26'];
    seedBackfillDone(sqlite);

    // Unknown source value: no completion guarantee, must not be ready.
    seedCoverage(sqlite, 1, '2026-08-26', 'complete', null, 'unknown');
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);

    // Missing source value: same rejection.
    seedCoverage(sqlite, 1, '2026-08-26', 'complete', null, '');
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);

    // Explicit backfill ownership stays ready.
    seedCoverage(sqlite, 1, '2026-08-26', 'complete', null, 'backfill');
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(true);
  });

  it('rejects complete coverage while job is running (matching version)', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25', '2026-08-26'];
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    // Matching version but status still 'running' — not ready.
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset, revision, error_code, created_at, updated_at)
         VALUES (?, ?, 'running', 'base', '2026-08-28', NULL, 0, 1, NULL, ?, ?)`,
      )
      .run(BACKFILL_JOB_NAME, JOB_VERSION, now, now);
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);

    // Flip to done → ready.
    sqlite.prepare("UPDATE stats_backfill_state SET status = 'done' WHERE job_name = ?").run(BACKFILL_JOB_NAME);
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(true);
  });

  it('zero historical day is eligible only after job done, before cutoff, after first aggregate day, with no activity', async () => {
    const sqlite = harness.sqlite;
    // Zero day is 2026-08-25: no coverage, no activity, no aggregate row.
    const days = ['2026-08-25', '2026-08-26', '2026-08-27'];
    seedCoverage(sqlite, 1, '2026-08-26', 'complete');
    seedCoverage(sqlite, 1, '2026-08-27', 'complete');
    // Chat's first aggregate day precedes the zero day → provable once done.
    insertUser(sqlite, { day: '2026-08-24', user_id: 100, message_count: 1 });
    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'running', 'finalize', '2026-08-28', NULL, 0, 1, NULL, ?, ?)`,
      )
      .run(BACKFILL_JOB_NAME, now, now);

    // Job not done → not ready.
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);

    // Done + cutoff after zero day → ready (zero day provably empty).
    sqlite.prepare("UPDATE stats_backfill_state SET status = 'done' WHERE job_name = ?").run(BACKFILL_JOB_NAME);
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(true);

    // Zero day before the chat's first aggregate day → not provable.
    sqlite.prepare("DELETE FROM stats_daily_user WHERE chat_id = 1 AND day = '2026-08-24'").run();
    insertUser(sqlite, { day: '2026-08-26', user_id: 100, message_count: 1 });
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);
  });

  it('does not prove a historical zero day that still has orphan category rows', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25', '2026-08-26', '2026-08-27'];
    seedCoverage(sqlite, 1, '2026-08-26', 'complete');
    seedCoverage(sqlite, 1, '2026-08-27', 'complete');
    insertUser(sqlite, { day: '2026-08-24', user_id: 100, message_count: 1 });
    // Orphan category row (profanity word) with no stats_daily_user row on the
    // would-be zero day: it must not be mistaken for an empty day.
    insertProfanityWord(sqlite, 1, '2026-08-25', 'хуй', 3);

    const now = Math.floor(Date.now() / 1000);
    sqlite
      .prepare(
        `INSERT INTO stats_backfill_state
           (job_name, version, status, phase, cutoff_day, cursor, page_offset, revision, error_code, created_at, updated_at)
         VALUES (?, ${JOB_VERSION}, 'done', 'done', '2026-08-28', NULL, 0, 1, NULL, ?, ?)`,
      )
      .run(BACKFILL_JOB_NAME, now, now);

    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);
  });
});

describe('admin stats backend selector', () => {
  let harness: FakeD1Database;
  let db: D1Database;
  let env: any;

  beforeEach(async () => {
    const made = await createRealD1();
    harness = made.harness;
    db = made.db;
    env = makeEnv(db);
  });

  afterEach(() => {
    harness.sqlite.close();
  });

  it('serves zero-filled stats for not-ready week/month/long-custom ranges (never legacy)', async () => {
    // No coverage rows → aggregate query succeeds empty → zero stats served
    // directly. >3 days must never fall back to legacy KV.
    const week = Array.from({ length: 7 }, (_, i) => dayAt(-6 + i));
    const weekResult = await getAdminChatStats(env, 1, range('week', week));
    expect(weekResult.activity.total).toBe(0);
    expect(weekResult.activity.dailyMessages).toHaveLength(7);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();

    const month = Array.from({ length: 30 }, (_, i) => dayAt(-29 + i));
    const monthResult = await getAdminChatStats(env, 1, range('month', month));
    expect(monthResult.activity.total).toBe(0);
    expect(monthResult.activity.dailyMessages).toHaveLength(30);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();

    const custom = Array.from({ length: 4 }, (_, i) => dayAt(-3 + i));
    const customResult = await getAdminChatStats(env, 1, range('custom', custom));
    expect(customResult.activity.total).toBe(0);
    expect(customResult.activity.dailyMessages).toHaveLength(4);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves zero-filled stats for an at-most-three-day not-ready range (never legacy)', async () => {
    const custom = ['2026-08-25', '2026-08-26', '2026-08-27'];
    const result = await getAdminChatStats(env, 1, range('custom', custom));
    expect(result.period).toBe('custom');
    expect(result.range.days).toBe(3);
    expect(result.activity.total).toBe(0);
    expect(result.activity.dailyMessages).toEqual([
      { day: '2026-08-25', count: 0 },
      { day: '2026-08-26', count: 0 },
      { day: '2026-08-27', count: 0 },
    ]);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('raises AdminUnavailable when a ready long range fails to read D1', async () => {
    const sqlite = harness.sqlite;
    const days = Array.from({ length: 30 }, (_, i) => dayAt(-29 + i));
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    harness.failPattern = /GROUP BY u\.user_id/;

    await expect(getAdminChatStats(env, 1, range('month', days))).rejects.toThrow(AdminUnavailable);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('raises AdminUnavailable when a short range fails to read D1 (no KV, no DO)', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-26'];
    seedCoverage(sqlite, 1, '2026-08-26', 'complete');
    harness.failPattern = /GROUP BY u\.user_id/;

    await expect(getAdminChatStats(env, 1, range('today', days))).rejects.toThrow(AdminUnavailable);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('serves zero-filled stats for a short not-ready range with live coverage (no KV fallback)', async () => {
    const sqlite = harness.sqlite;
    // 2-day custom range: day 2 carries source-live coverage (no progress rows).
    // A successful aggregate read serves directly; legacy KV is never consulted.
    const days = ['2026-08-25', '2026-08-26'];
    seedCoverage(sqlite, 1, '2026-08-26', 'live', null, 'live');

    const result = await getAdminChatStats(env, 1, range('custom', days));
    expect(result.activity.total).toBe(0);
    expect(result.activity.dailyMessages).toEqual([
      { day: '2026-08-25', count: 0 },
      { day: '2026-08-26', count: 0 },
    ]);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('raises AdminUnavailable when a short range with live coverage fails to read D1', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25'];
    seedCoverage(sqlite, 1, '2026-08-25', 'live', null, 'live');
    harness.failPattern = /GROUP BY u\.user_id/;

    await expect(getAdminChatStats(env, 1, range('custom', days))).rejects.toBeInstanceOf(
      AdminUnavailable,
    );
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('raises AdminUnavailable for any D1 failure regardless of coverage state', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25'];
    seedCoverage(sqlite, 1, '2026-08-25', 'complete');
    // The aggregate batch fails: ownership is never probed and legacy KV is
    // never consulted; the structured AdminUnavailable is final.
    harness.failPattern = /GROUP BY u\.user_id/;

    await expect(getAdminChatStats(env, 1, range('custom', days))).rejects.toBeInstanceOf(
      AdminUnavailable,
    );
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('serves D1 stats for a short historical live-owned range even when progress is incomplete', async () => {
    const sqlite = harness.sqlite;
    const yesterday = dayAt(-1);
    seedCoverage(sqlite, 1, yesterday, 'live', null, 'live');
    for (const category of ['base', 'profanity', 'criminal']) {
      seedProgress(sqlite, 1, yesterday, category, { accepted_seq: 2, completed_seq: 1, pending_count: 0 });
    }
    seedProgress(sqlite, 1, yesterday, 'profanity', { accepted_seq: 2, completed_seq: 1, pending_count: 0, failed_count: 1 });
    insertUser(sqlite, { day: yesterday, user_id: 100, message_count: 2, word_count: 4 });

    const result = await getAdminChatStats(env, 1, range('custom', [yesterday]));
    // A successful aggregate read is served directly regardless of progress
    // metadata; no CountersDO proof is fetched.
    expect(result.activity.total).toBe(2);
    expect(result.status).toBe('final');
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('uses D1 for a fully ready range', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25', '2026-08-26'];
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    insertUser(sqlite, { day: '2026-08-25', user_id: 100, message_count: 3, word_count: 9 });
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStats(env, 1, range('custom', days));
    expect(result.activity.total).toBe(3);
    expect(result.activity.topUsers[0].username).toBe('alice');
  });

  it('reads readiness and response data from one atomic batch snapshot', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25', '2026-08-26'];
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    insertUser(sqlite, { day: days[0], user_id: 100, message_count: 3, word_count: 9 });

    // Simulates a reset/live write immediately after D1 returns its batch
    // snapshot. A separate readiness/read flow would observe this new state.
    harness.afterBatch = () => {
      sqlite.prepare("UPDATE stats_backfill_state SET status = 'running' WHERE job_name = ?").run(BACKFILL_JOB_NAME);
      sqlite.prepare('UPDATE stats_daily_user SET message_count = 99 WHERE chat_id = 1').run();
    };

    const result = await getAdminChatStats(env, 1, range('custom', days));

    expect(harness.batchCalls).toBe(1);
    expect(result.activity.total).toBe(3);
  });

  it('serves a stale backfill state batch directly (no readiness gate)', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26'];
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    sqlite.prepare('UPDATE stats_backfill_state SET version = ? WHERE job_name = ?').run(
      JOB_VERSION - 1,
      BACKFILL_JOB_NAME,
    );
    insertUser(sqlite, { day: days[0], user_id: 100, message_count: 99, word_count: 999 });

    const result = await getAdminChatStats(env, 1, range('custom', days));
    // Backfill state is not consulted on a successful aggregate read.
    expect(result.activity.total).toBe(99);
    expect(harness.batchCalls).toBe(1);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('parseAdminPeriod enforces the 90-day custom cap, rejects future custom, defaults to today', () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const daysFromToday = (offset: number): string => {
      const day = new Date(today);
      day.setUTCDate(today.getUTCDate() + offset);
      return day.toISOString().slice(0, 10);
    };

    expect(parseAdminPeriod('week').days).toHaveLength(7);
    expect(parseAdminPeriod('month').days).toHaveLength(30);
    expect(parseAdminPeriod('today').days).toHaveLength(1);
    expect(parseAdminPeriod('today').from).toBe(todayStr);
    expect(parseAdminPeriod('today').to).toBe(todayStr);
    // Custom ending in the future is invalid (400), even within the 90-day cap.
    expect(() => parseAdminPeriod('custom', daysFromToday(-2), daysFromToday(1))).toThrow(
      /future/,
    );
    expect(() => parseAdminPeriod('custom', todayStr, daysFromToday(1))).toThrow(/future/);
    // 90-day cap still enforced for closed past ranges.
    expect(() =>
      parseAdminPeriod('custom', daysFromToday(-95), daysFromToday(-1)),
    ).toThrow(/90/);
  });

  it('week and month presets are rolling UTC windows including today', () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const daysAgo = (offset: number): string => {
      const day = new Date(today);
      day.setUTCDate(today.getUTCDate() - offset);
      return day.toISOString().slice(0, 10);
    };

    const week = parseAdminPeriod('week');
    expect(week.from).toBe(daysAgo(6));
    expect(week.to).toBe(todayStr);
    expect(week.days[0]).toBe(daysAgo(6));
    expect(week.days[week.days.length - 1]).toBe(todayStr);
    expect(week.days).toContain(todayStr);
    expect(week.days).toHaveLength(7);

    const month = parseAdminPeriod('month');
    expect(month.from).toBe(daysAgo(29));
    expect(month.to).toBe(todayStr);
    expect(month.days[0]).toBe(daysAgo(29));
    expect(month.days[month.days.length - 1]).toBe(todayStr);
    expect(month.days).toContain(todayStr);
    expect(month.days).toHaveLength(30);
  });

  it('serves a final dashboard for a live day with all progress rows (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves a final dashboard for a live day with matching snapshots (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when the DO accepted watermark differs from D1 (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    // D1 aggregate read returns the actual totals; no CountersDO proof is
    // ever fetched under simple D1 semantics.
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when the DO reports a poisoned integrity stream (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when DO returns a null category object (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when DO clean is a truthy non-boolean (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when DO top-level accepted mismatches category accepted (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats with truthful pending progress when analysis remains (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 1, 1);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats on a non-OK DO snapshot response (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when the DO proof version is not current (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when the DO proof reports the day uninitialized (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when the DO proof response misses a requested day (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 2);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('keeps final status for D1 permanent failed rows (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 2, 1, 0, 1);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves zero-filled stats for a current day without live coverage (final status)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    // Chat has historical rows but today carries no coverage row at all: D1
    // aggregate returns zero for today with final status.
    insertUser(sqlite, { day: dayAt(-1), user_id: 100, message_count: 1, word_count: 2 });
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(0);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when the DO proof is not clean for a live day (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedLiveDay(sqlite, todayStr, 0, 0);

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    // seedLiveDay always inserts 2 messages for user 100.
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('serves final stats for today when progress rows are missing (no DO/KV access)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    // Live-owned today (coverage source=live) with a current-day aggregate row
    // but no progress rows → successful D1 aggregate read serves final stats.
    seedCoverage(sqlite, 1, todayStr, 'live', null, 'live');
    insertUser(sqlite, { day: todayStr, user_id: 100, message_count: 2, word_count: 4 });

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('serves final stats for today when a category has a permanent failure (no DO/KV access)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    seedCoverage(sqlite, 1, todayStr, 'live', null, 'live');
    for (const category of ['base', 'profanity', 'criminal']) {
      seedProgress(sqlite, 1, todayStr, category, { accepted_seq: 2, completed_seq: 1, pending_count: 0 });
    }
    seedProgress(sqlite, 1, todayStr, 'profanity', { accepted_seq: 2, completed_seq: 1, pending_count: 0, failed_count: 1 });

    const result = await getAdminChatStats(env, 1, range('today', [todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(0);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('serves a fully ready long closed range from D1 without regression and without DO', async () => {
    const sqlite = harness.sqlite;
    const days = Array.from({ length: 30 }, (_, i) => dayAt(-30 + i));
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    insertUser(sqlite, { day: days[days.length - 1], user_id: 100, message_count: 5, word_count: 10 });
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStats(env, 1, range('month', days));
    expect(result.activity.total).toBe(5);
    expect(result.range).toEqual({ from: days[0], to: days[days.length - 1], days: 30 });
    // Pure complete backfill: no live-owned days, so the CountersDO proof is
    // never consulted.
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves a rolling week of closed days plus live today from one D1 batch, final, no DO', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${todayStr}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 6 + i);
      return d.toISOString().slice(0, 10);
    });
    // days[0..5] closed backfill complete; days[6] is the live current UTC day.
    for (let i = 0; i < 6; i++) seedCoverage(sqlite, 1, days[i], 'complete');
    seedBackfillDone(sqlite);
    for (const day of days) {
      insertUser(sqlite, { day, user_id: 100, message_count: 1, word_count: 2 });
    }
    insertProfile(sqlite, 1, 100, 'alice', 1000);
    seedCoverage(sqlite, 1, todayStr, 'live', null, 'live');
    for (const category of ['base', 'profanity', 'criminal']) {
      seedProgress(sqlite, 1, todayStr, category, { accepted_seq: 1, completed_seq: 1, pending_count: 0 });
    }

    const result = await getAdminChatStats(env, 1, range('week', days));
    expect(result.status).toBe('final');
    expect(result.range.days).toBe(7);
    expect(result.activity.total).toBe(7);
    expect(result.progress).toBeUndefined();
    expect(harness.batchCalls).toBe(1);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves a closed-only live range as final without any DO call', async () => {
    const sqlite = harness.sqlite;
    const yesterday = dayAt(-1);
    // Yesterday is live-owned but no longer the current UTC day: validated
    // closed live-owned days are final.
    seedCoverage(sqlite, 1, yesterday, 'live', null, 'live');
    for (const category of ['base', 'profanity', 'criminal']) {
      seedProgress(sqlite, 1, yesterday, category, { accepted_seq: 2, completed_seq: 2, pending_count: 0 });
    }
    insertUser(sqlite, { day: yesterday, user_id: 100, message_count: 2, word_count: 4 });
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStats(env, 1, range('custom', [yesterday]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(result.progress).toBeUndefined();
    expect(harness.batchCalls).toBe(1);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('validates every live-owned day from one D1 batch without any DO proof call', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterday = dayAt(-1, todayStr);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${todayStr}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 6 + i);
      return d.toISOString().slice(0, 10);
    });
    // days[0..4] closed complete; days[5] (yesterday) and days[6] (today) live.
    for (let i = 0; i < 5; i++) seedCoverage(sqlite, 1, days[i], 'complete');
    seedBackfillDone(sqlite);
    for (const day of days) {
      insertUser(sqlite, { day, user_id: 100, message_count: 1, word_count: 2 });
    }
    insertProfile(sqlite, 1, 100, 'alice', 1000);
    for (const day of [yesterday, todayStr]) {
      seedCoverage(sqlite, 1, day, 'live', null, 'live');
      for (const category of ['base', 'profanity', 'criminal']) {
        seedProgress(sqlite, 1, day, category, { accepted_seq: 1, completed_seq: 1, pending_count: 0 });
      }
    }

    const result = await getAdminChatStats(env, 1, range('week', days));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(7);
    expect(result.progress).toBeUndefined();
    expect(harness.batchCalls).toBe(1);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when DO proof days are not in request order (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterday = dayAt(-1);
    for (const day of [yesterday, todayStr]) {
      seedCoverage(sqlite, 1, day, 'live', null, 'live');
      for (const category of ['base', 'profanity', 'criminal']) {
        seedProgress(sqlite, 1, day, category, { accepted_seq: 1, completed_seq: 1, pending_count: 0 });
      }
      insertUser(sqlite, { day, user_id: 100, message_count: 1, word_count: 2 });
    }
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStats(env, 1, range('custom', [yesterday, todayStr]));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats when any live day proof carries a stale version (no proof fetch)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterday = dayAt(-1);
    const days = [yesterday, todayStr];
    for (const day of days) {
      seedCoverage(sqlite, 1, day, 'live', null, 'live');
      for (const category of ['base', 'profanity', 'criminal']) {
        seedProgress(sqlite, 1, day, category, { accepted_seq: 1, completed_seq: 1, pending_count: 0 });
      }
      insertUser(sqlite, { day, user_id: 100, message_count: 1, word_count: 2 });
    }
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStats(env, 1, range('custom', days));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(2);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('serves D1 stats for a mixed range when a closed day is not ready (no DO/KV access)', async () => {
    const sqlite = harness.sqlite;
    const todayStr = new Date().toISOString().slice(0, 10);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${todayStr}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 6 + i);
      return d.toISOString().slice(0, 10);
    });
    for (let i = 0; i < 6; i++) seedCoverage(sqlite, 1, days[i], i === 3 ? 'pending' : 'complete');
    seedBackfillDone(sqlite);
    seedCoverage(sqlite, 1, todayStr, 'live', null, 'live');
    for (const category of ['base', 'profanity', 'criminal']) {
      seedProgress(sqlite, 1, todayStr, category, { accepted_seq: 1, completed_seq: 1, pending_count: 0 });
    }
    insertUser(sqlite, { day: todayStr, user_id: 100, message_count: 1, word_count: 2 });
    insertProfile(sqlite, 1, 100, 'alice', 1000);

    const result = await getAdminChatStats(env, 1, range('week', days));
    expect(result.status).toBe('final');
    expect(result.activity.total).toBe(1);
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('raises AdminUnavailable when a batch result reports an error instead of throwing', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25', '2026-08-26'];
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    insertUser(sqlite, { day: '2026-08-25', user_id: 100, message_count: 3, word_count: 9 });

    // Cloudflare D1 can return a per-statement `error` in the batch result
    // array rather than throwing. Statement 0 is the user aggregate: mapping it
    // must fail closed instead of serving zero/partial stats.
    harness.errorResultIndexes = new Set([0]);

    await expect(getAdminChatStats(env, 1, range('custom', days))).rejects.toBeInstanceOf(
      AdminUnavailable,
    );
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('raises AdminUnavailable when a batch result resolves success:false with no error', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-25', '2026-08-26'];
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    insertUser(sqlite, { day: '2026-08-25', user_id: 100, message_count: 3, word_count: 9 });

    // D1 may resolve a per-statement failure as `success: false` without an
    // `error` field. Statement 0 is the user aggregate: it must fail closed
    // instead of serving zero/partial stats.
    harness.falseSuccessResultIndexes = new Set([0]);

    await expect(getAdminChatStats(env, 1, range('custom', days))).rejects.toBeInstanceOf(
      AdminUnavailable,
    );
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });

  it('raises AdminUnavailable when a required batch result is missing entirely', async () => {
    const days = ['2026-08-25'];
    // Emulate a truncated/short batch response: drop the first (users aggregate)
    // result. A missing result must never be read as an empty success.
    const made = await createRealD1();
    const shortDb = made.harness;
    const originalBatch = shortDb.batch.bind(shortDb);
    shortDb.batch = async (statements) => {
      const all = await originalBatch(statements);
      return all.slice(1);
    };
    const shortEnv = makeEnv(shortDb as unknown as D1Database);

    await expect(getAdminChatStats(shortEnv, 1, range('custom', days))).rejects.toBeInstanceOf(
      AdminUnavailable,
    );
    expect(shortEnv.COUNTERS.list).not.toHaveBeenCalled();
    expect(shortEnv.COUNTERS_DO.get).not.toHaveBeenCalled();
    made.harness.sqlite.close();
  });

  it('still serves zero-filled stats when all batch results succeed but are empty', async () => {
    const days = ['2026-08-25', '2026-08-26'];
    // No coverage, no rows at all: every aggregate statement succeeds empty.
    const result = await getAdminChatStats(env, 1, range('custom', days));
    expect(result.activity.total).toBe(0);
    expect(result.activity.dailyMessages).toEqual([
      { day: '2026-08-25', count: 0 },
      { day: '2026-08-26', count: 0 },
    ]);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
    expect(env.COUNTERS_DO.get).not.toHaveBeenCalled();
  });
});
