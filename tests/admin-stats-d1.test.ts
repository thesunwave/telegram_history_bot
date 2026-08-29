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
import { AdminUnavailable, HistoricalStatsNotReady } from '../src/features/stats/admin-stats-errors';

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
      const results = statements.map((stmt) => {
        this.guard(stmt.sql);
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
       subarticle TEXT
     )`,
  );
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

function seedCoverage(sqlite: Sqlite, chatId: number, day: string, status: string, reason: string | null = null): void {
  sqlite
    .prepare(
      `INSERT INTO stats_daily_coverage
         (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
       VALUES (?, ?, ?, ?, ?, 'backfill', ?, ?)
       ON CONFLICT(chat_id, day) DO UPDATE SET
         base_status = excluded.base_status,
         profanity_status = excluded.profanity_status,
         criminal_status = excluded.criminal_status,
         reason_code = excluded.reason_code`,
    )
    .run(chatId, day, status, status, status, reason, 1);
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
  return {
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

  it('rejects a live coverage day (dual-write never marks complete)', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-26'];
    seedCoverage(sqlite, 1, '2026-08-26', 'live');
    await expect(isD1RangeReady(db, 1, days)).resolves.toBe(false);
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

  it('throws HistoricalStatsNotReady for a not-ready week/month/long-custom range (never legacy)', async () => {
    // No coverage rows → not ready. >3 days must never fall back to legacy KV.
    const week = Array.from({ length: 7 }, (_, i) => dayAt(-6 + i));
    await expect(getAdminChatStats(env, 1, range('week', week))).rejects.toThrow(HistoricalStatsNotReady);

    const month = Array.from({ length: 30 }, (_, i) => dayAt(-29 + i));
    await expect(getAdminChatStats(env, 1, range('month', month))).rejects.toThrow(HistoricalStatsNotReady);

    const custom = Array.from({ length: 4 }, (_, i) => dayAt(-3 + i));
    await expect(getAdminChatStats(env, 1, range('custom', custom))).rejects.toThrow(HistoricalStatsNotReady);
  });

  it('falls back to legacy KV only for at-most-three-day not-ready ranges', async () => {
    const custom = ['2026-08-25', '2026-08-26', '2026-08-27'];
    const result = await getAdminChatStats(env, 1, range('custom', custom));
    expect(result.period).toBe('custom');
    expect(result.range.days).toBe(3);
  });

  it('raises AdminUnavailable when a ready long range fails to read D1', async () => {
    const sqlite = harness.sqlite;
    const days = Array.from({ length: 30 }, (_, i) => dayAt(-29 + i));
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    harness.failPattern = /GROUP BY u\.user_id/;

    await expect(getAdminChatStats(env, 1, range('month', days))).rejects.toThrow(AdminUnavailable);
  });

  it('falls back to legacy KV when a ready short range fails to read D1', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-26'];
    seedCoverage(sqlite, 1, '2026-08-26', 'complete');
    harness.failPattern = /GROUP BY u\.user_id/;

    const result = await getAdminChatStats(env, 1, range('today', days));
    expect(result.period).toBe('today');
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

  it('rejects a stale state/data batch before mapping it to an admin response', async () => {
    const sqlite = harness.sqlite;
    const days = ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26'];
    for (const day of days) seedCoverage(sqlite, 1, day, 'complete');
    seedBackfillDone(sqlite);
    sqlite.prepare('UPDATE stats_backfill_state SET version = ? WHERE job_name = ?').run(
      JOB_VERSION - 1,
      BACKFILL_JOB_NAME,
    );
    insertUser(sqlite, { day: days[0], user_id: 100, message_count: 99, word_count: 999 });

    await expect(getAdminChatStats(env, 1, range('custom', days))).rejects.toThrow(
      HistoricalStatsNotReady,
    );
    expect(harness.batchCalls).toBe(1);
    expect(env.COUNTERS.list).not.toHaveBeenCalled();
  });

  it('parseAdminPeriod still enforces the 90-day custom cap and defaults to today', () => {
    expect(parseAdminPeriod('week').days).toHaveLength(7);
    expect(parseAdminPeriod('month').days).toHaveLength(30);
    expect(parseAdminPeriod('today').days).toHaveLength(1);
    expect(() =>
      parseAdminPeriod('custom', dayAt(-95), dayAt(0)),
    ).toThrow(/90/);
  });
});
