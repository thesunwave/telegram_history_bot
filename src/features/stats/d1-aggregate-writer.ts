import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';

/**
 * Best-effort dual-write of daily D1 aggregates from serialized CountersDO
 * mutation paths. All functions are pure write helpers: each emits exactly one
 * `D1Database.batch(...)` (a single SQL transaction per the D1 docs) and must be
 * called inside a try/catch by the caller, because aggregate failures must never
 * reverse or throw after legacy KV mutations have completed.
 *
 * Privacy: no raw message text, usernames, profanity words, user IDs, or raw day
 * values ever appear in logs. Errors are logged with the base36 chat identity
 * and the operation category only.
 */

/** Coverage status written by live events. Never 'complete'; Phase 3 reads require backfill + parity. */
export const COVERAGE_STATUS_LIVE = 'live' as const;
/** Default status for categories a live event did not touch (also the DDL default). */
export const COVERAGE_STATUS_NONE = 'none' as const;

export interface ActivityAggregateWrite {
  chatId: number;
  day: string;
  userId: number;
  username: string;
  /** Valid 0-23 integer; anything else suppresses hour/bucket rows. */
  hour?: number;
  /** Derived activity time bucket (night/morning/noon/evening) for the valid hour. */
  bucket?: string;
  wordCount?: number;
  voiceCount?: number;
  voiceDurationSeconds?: number;
  videoNoteCount?: number;
  videoNoteDurationSeconds?: number;
  /** Message timestamp (epoch seconds); absent → last_message_ts stays untouched/0. */
  ts?: number;
}

export interface ProfanityAggregateWrite {
  chatId: number;
  day: string;
  userId: number;
  username: string;
  /** Total normalized profanity count (sum of word counts), validated by caller. */
  count: number;
  /** Already-normalized, aggregated words with per-word counts. */
  words: Array<{ word: string; count: number }>;
}

export interface CriminalAggregateWrite {
  chatId: number;
  day: string;
  userId: number;
  username: string;
  /** Number of violations (may be 0). */
  violationCount: number;
  /** Total severity coming from the payload. */
  totalSeverity: number;
}

/**
 * Upsert a user's daily base totals: message +1, exact word/media deltas, and
 * last_message_ts = max(existing, incoming). Zero deltas add nothing (payload
 * deltas are used exactly). Also carries the legacy `activity` table upsert so a
 * normal base write performs exactly one D1 batch.
 */
const USER_DAILY_UPSERT_ACTIVITY = `
  INSERT INTO stats_daily_user
    (chat_id, day, user_id, message_count, word_count, voice_count, voice_duration_seconds,
     video_note_count, video_note_duration_seconds, profanity_count, criminal_count, criminal_severity, last_message_ts)
  VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 0, 0, 0, ?)
  ON CONFLICT(chat_id, day, user_id) DO UPDATE SET
    message_count = message_count + 1,
    word_count = word_count + ?,
    voice_count = voice_count + ?,
    voice_duration_seconds = voice_duration_seconds + ?,
    video_note_count = video_note_count + ?,
    video_note_duration_seconds = video_note_duration_seconds + ?,
    last_message_ts = MAX(COALESCE(last_message_ts, ?), ?)
`;

const USER_DAILY_UPSERT_PROFANITY = `
  INSERT INTO stats_daily_user (chat_id, day, user_id, profanity_count)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(chat_id, day, user_id) DO UPDATE SET
    profanity_count = profanity_count + excluded.profanity_count
`;

const USER_DAILY_UPSERT_CRIMINAL = `
  INSERT INTO stats_daily_user (chat_id, day, user_id, criminal_count, criminal_severity)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(chat_id, day, user_id) DO UPDATE SET
    criminal_count = criminal_count + excluded.criminal_count,
    criminal_severity = criminal_severity + excluded.criminal_severity
`;

const USER_PROFILE_UPSERT = `
  INSERT INTO stats_chat_user_profile (chat_id, user_id, username, last_message_ts)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(chat_id, user_id) DO UPDATE SET
    username = CASE
      WHEN excluded.last_message_ts >= COALESCE(stats_chat_user_profile.last_message_ts, 0)
        THEN excluded.username
      ELSE stats_chat_user_profile.username
    END,
    last_message_ts = MAX(COALESCE(stats_chat_user_profile.last_message_ts, 0), COALESCE(excluded.last_message_ts, 0))
`;

/**
 * Category-only profile fill for profanity/criminal writes. These events carry a
 * username but no message timestamp, so they must never invent `now` as a
 * timestamp nor regress an existing username. They only insert a missing
 * profile conservatively (username present, last_message_ts unknown) and leave
 * any existing profile untouched.
 */
const USER_PROFILE_INSERT_IF_MISSING = `
  INSERT INTO stats_chat_user_profile (chat_id, user_id, username, last_message_ts)
  VALUES (?, ?, ?, NULL)
  ON CONFLICT(chat_id, user_id) DO NOTHING
`;

const HOUR_UPSERT = `
  INSERT INTO stats_daily_hour (chat_id, day, hour, message_count)
  VALUES (?, ?, ?, 1)
  ON CONFLICT(chat_id, day, hour) DO UPDATE SET
    message_count = message_count + 1
`;

const BUCKET_USER_UPSERT = `
  INSERT INTO stats_daily_bucket_user (chat_id, day, bucket, user_id, message_count)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT(chat_id, day, bucket, user_id) DO UPDATE SET
    message_count = message_count + 1
`;

const PROFANITY_WORD_UPSERT = `
  INSERT INTO stats_daily_profanity_word (chat_id, day, word, count)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(chat_id, day, word) DO UPDATE SET
    count = count + excluded.count
`;

const PROFANITY_WORD_USER_UPSERT = `
  INSERT INTO stats_daily_profanity_word_user (chat_id, day, word, user_id, count)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(chat_id, day, word, user_id) DO UPDATE SET
    count = count + excluded.count
`;

/**
 * Live coverage upsert. Statuses only ever upgrade to 'live' (never reset to
 * 'none' for a category already live-written). Source is always 'live'; no fake
 * 'complete' status is ever written, so historical days stay ineligible for the
 * Phase 3 D1 read path until backfill + parity mark them complete.
 */
const COVERAGE_UPSERT = `
  INSERT INTO stats_daily_coverage
    (chat_id, day, base_status, profanity_status, criminal_status, source, updated_at)
  VALUES (?, ?, ?, ?, ?, 'live', ?)
  ON CONFLICT(chat_id, day) DO UPDATE SET
    base_status = CASE WHEN excluded.base_status = 'live' THEN 'live' ELSE base_status END,
    profanity_status = CASE WHEN excluded.profanity_status = 'live' THEN 'live' ELSE profanity_status END,
    criminal_status = CASE WHEN excluded.criminal_status = 'live' THEN 'live' ELSE criminal_status END,
    source = 'live',
    updated_at = excluded.updated_at
`;

/** Legacy chat/day total upsert, kept identical to the pre-Phase-2 behavior. */
const ACTIVITY_LEGACY_UPSERT = `
  INSERT INTO activity (chat_id, day, count) VALUES (?, ?, 1)
  ON CONFLICT(chat_id, day) DO UPDATE SET count = count + 1
`;

function isUsableHour(hour: number | undefined): hour is number {
  return (
    typeof hour === 'number' &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour <= 23
  );
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function profileStatement(
  db: D1Database,
  chatId: number,
  userId: number,
  username: string,
  lastSeenTs: number,
): D1PreparedStatement {
  return db.prepare(USER_PROFILE_UPSERT).bind(chatId, userId, username, lastSeenTs);
}

function profileInsertIfMissing(
  db: D1Database,
  chatId: number,
  userId: number,
  username: string,
): D1PreparedStatement {
  return db.prepare(USER_PROFILE_INSERT_IF_MISSING).bind(chatId, userId, username);
}

function coverageStatement(
  db: D1Database,
  chatId: number,
  day: string,
  baseStatus: typeof COVERAGE_STATUS_LIVE | typeof COVERAGE_STATUS_NONE,
  profanityStatus: typeof COVERAGE_STATUS_LIVE | typeof COVERAGE_STATUS_NONE,
  criminalStatus: typeof COVERAGE_STATUS_LIVE | typeof COVERAGE_STATUS_NONE,
  nowSec: number,
): D1PreparedStatement {
  return db.prepare(COVERAGE_UPSERT).bind(chatId, day, baseStatus, profanityStatus, criminalStatus, nowSec);
}

/** Base message aggregate batch: exactly one D1 batch invocation per call. */
export function writeActivityAggregates(
  db: D1Database,
  input: ActivityAggregateWrite,
): Promise<D1Result<unknown>[]> {
  const { chatId, day, userId, username, ts } = input;
  const statements: D1PreparedStatement[] = [];

  const wordCount = input.wordCount ?? 0;
  const voiceCount = input.voiceCount ?? 0;
  const voiceDurationSeconds = input.voiceDurationSeconds ?? 0;
  const videoNoteCount = input.videoNoteCount ?? 0;
  const videoNoteDurationSeconds = input.videoNoteDurationSeconds ?? 0;
  // Absent ts binds 0: max() never regresses an existing timestamp and a fresh
  // row stores 0 as "unknown" instead of clobbering anything.
  const lastMessageTs = ts ?? 0;

  statements.push(
    db
      .prepare(USER_DAILY_UPSERT_ACTIVITY)
      .bind(
        chatId,
        day,
        userId,
        wordCount,
        voiceCount,
        voiceDurationSeconds,
        videoNoteCount,
        videoNoteDurationSeconds,
        lastMessageTs,
        wordCount,
        voiceCount,
        voiceDurationSeconds,
        videoNoteCount,
        videoNoteDurationSeconds,
        lastMessageTs,
        lastMessageTs,
      ),
  );

  statements.push(profileStatement(db, chatId, userId, username, lastMessageTs));

  if (isUsableHour(input.hour)) {
    statements.push(db.prepare(HOUR_UPSERT).bind(chatId, day, input.hour));
    if (typeof input.bucket === 'string' && input.bucket.length > 0) {
      statements.push(db.prepare(BUCKET_USER_UPSERT).bind(chatId, day, input.bucket, userId));
    }
  }

  statements.push(
    coverageStatement(db, chatId, day, COVERAGE_STATUS_LIVE, COVERAGE_STATUS_NONE, COVERAGE_STATUS_NONE, unixSeconds()),
  );
  // Legacy activity total rides the same transaction so a normal base message
  // performs exactly one D1 batch invocation in total.
  statements.push(db.prepare(ACTIVITY_LEGACY_UPSERT).bind(chatId, day));

  return db.batch(statements);
}

/** Profanity aggregate batch: user total + per-word and per-word-user counts. */
export function writeProfanityAggregates(
  db: D1Database,
  input: ProfanityAggregateWrite,
): Promise<D1Result<unknown>[]> {
  const { chatId, day, userId, username, count, words } = input;
  const statements: D1PreparedStatement[] = [];

  statements.push(db.prepare(USER_DAILY_UPSERT_PROFANITY).bind(chatId, day, userId, count));
  statements.push(profileInsertIfMissing(db, chatId, userId, username));

  // Words are already normalized/aggregated by the caller; guard against
  // degenerate entries without ever persisting raw text.
  for (const word of words) {
    if (!word || typeof word.word !== 'string' || word.word.length === 0) continue;
    if (!Number.isInteger(word.count) || word.count <= 0) continue;
    statements.push(db.prepare(PROFANITY_WORD_UPSERT).bind(chatId, day, word.word, word.count));
    statements.push(db.prepare(PROFANITY_WORD_USER_UPSERT).bind(chatId, day, word.word, userId, word.count));
  }

  statements.push(
    coverageStatement(db, chatId, day, COVERAGE_STATUS_NONE, COVERAGE_STATUS_LIVE, COVERAGE_STATUS_NONE, unixSeconds()),
  );

  return db.batch(statements);
}

/** Criminal aggregate batch: violation count and total severity deltas. */
export function writeCriminalAggregates(
  db: D1Database,
  input: CriminalAggregateWrite,
): Promise<D1Result<unknown>[]> {
  const { chatId, day, userId, username, violationCount, totalSeverity } = input;
  const statements: D1PreparedStatement[] = [];

  statements.push(
    db.prepare(USER_DAILY_UPSERT_CRIMINAL).bind(chatId, day, userId, violationCount, totalSeverity),
  );
  statements.push(profileInsertIfMissing(db, chatId, userId, username));
  statements.push(
    coverageStatement(db, chatId, day, COVERAGE_STATUS_NONE, COVERAGE_STATUS_NONE, COVERAGE_STATUS_LIVE, unixSeconds()),
  );

  return db.batch(statements);
}

/**
 * Privacy-safe aggregate write failure logging: base36 chat identity, operation
 * category, and error class name only. Never the raw error message, user IDs,
 * usernames, words, message text, raw day, or SQL — a D1 error message can
 * contain fragments of the failed statement and must not be emitted.
 */
export function logD1AggregateWriteError(operation: string, chatId: number, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error === 'string' ? 'Error' : 'UnknownError';
  console.error('d1 aggregate write error', {
    op: operation,
    errName: name,
  });
}
