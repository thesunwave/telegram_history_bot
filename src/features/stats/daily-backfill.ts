import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { Env } from '../../core/env';

/**
 * Phase 3a: bounded, resumable, full-history backfill of the modern counter
 * sources into the Phase-2 D1 aggregate tables (migration 0009), restored to
 * the original contract after the previous 90-day/KV-check checkpoint
 * implementation deviated.
 *
 * Corrected design
 * ---------------
 * - **D1 is the authoritative job checkpoint.** `stats_backfill_state`
 *   (migration 0010) holds version, status, phase, the immutable UTC cutoff
 *   day, the KV list cursor + in-page offset, lease owner/expiry, revision and
 *   a safe error code. Progress is never stored in COUNTERS KV.
 * - **Epoch-fenced short lease with atomic compare-and-set semantics.** Each invocation
 *   acquires the singleton job lease with a single `UPDATE ... WHERE
 *   (lease_owner IS NULL OR lease_expires_at < now)`; a competing two-minute
 *   cron run that overlaps an active run no-ops. The lease is renewed on every
 *   state write and released when the invocation finishes; a crashed run only
 *   stalls until the lease expires. Every data mutation embeds the captured
 *   job/version/revision/owner/expiry fence, so a runner which loses its lease
 *   cannot write data after another runner resets or advances state.
 * - **Full target-relevant modern history, one family per phase.** Deterministic
 *   global phases traverse every parseable modern source family that feeds a
 *   Phase-2 aggregate table: `stats_v2`, `word_stats_v2`, both media families,
 *   `profanity`, `criminal`, `criminal_severity`, `activity_hour`,
 *   `activity_time_bucket`, `profanity_words`, `profanity_word_users`. There is
 *   no 90-day limit and no `stats_v2`-anchored assumption: a family is
 *   recovered even when no `stats_v2` base key exists for that (chat, day).
 *   `word_activity` is deliberately excluded because its chat-day total is
 *   derivable from `stats_daily_user.word_count`; `criminal_article` is
 *   deliberately excluded because no target aggregate table or admin response
 *   consumes article-level counts. Neither requires schema expansion.
 *   Source keys with `day >= cutoffDay` are skipped (live dual-write owns them).
 * - **Column-specific absolute upserts.** Each family writes ONLY its own
 *   columns, so source-family arrival order can never zero or overwrite another
 *   family's values. Signed Telegram chat IDs (`-100...`) and positive user IDs
 *   are accepted; malformed/decimal/non-integer values are rejected.
 * - **Coverage `complete` only after base+activity parity.** An absent discovered
 *   (chat, day) gets coverage `source='backfill'` with `pending` statuses;
 *   existing live coverage keeps live ownership. The finalize phase requires a
 *   base counter (`SUM(stats_daily_user.message_count)
 *   > 0`) and an exact match with the legacy `activity(chat_id, day, count)`
 *   row, and it only atomically completes a day whose coverage still reflects
 *   the expected backfill state (`source='backfill'`, all statuses `pending`).
 *   Missing base counters (`missing_base_counter`), missing activity rows
 *   (`missing_activity_total`) and mismatches (`message_count_mismatch`) keep
 *   non-complete statuses with a safe reason.
 * - **Conservative race handling (no claimed convergence).** The live writer
 *   (`d1-aggregate-writer.ts`) forces any touched category status to `live`
 *   (and `source='live'`) in the same batch as its additive write. Backfill
 *   finalization therefore refuses to complete a day that a live write has
 *   taken over after backfill last wrote it: a raced/late day becomes
 *   unavailable until a subsequent reconciliation, never silently converged.
 * - **Bounded per invocation.** One phase (or page portion) per invocation, at
 *   most 50 inspected source keys (including malformed and cutoff keys), at
 *   most 300 KV gets, and at most **90 D1 statements total across the whole
 *   invocation**. Source batches reserve nine statements for state/lease work,
 *   including error recovery, so they contain at most 81 aggregate statements.
 *   Admission is phase-aware: before processing a valid key the phase reserves
 *   its worst-case statements (base and D1-visible category-user families:
 *   counter + profile upsert; other count families: one upsert) plus a
 *   coverage upsert per new (chat, day) and the KV gets, so a key is only
 *   admitted when the fixed budgets fit. Simple one-statement families (e.g.
 *   profanity words) therefore reach the 50-key cap while profile-bearing
 *   phases and finalize stay at their safe lower counts. The checkpoint
 *   advances only after the D1 batch succeeds; a failed slice keeps its cursor
 *   + offset and is retried.
 *
 * Out of scope
 * ------------
 * - Legacy-only `stats:{chat}:{user}:{day}` history cannot be listed by date
 *   without a full legacy-namespace scan; those days stay unavailable.
 * - Raw message history cannot reconstruct classifications.
 * - The D1 read path / cutover is not enabled by this phase.
 *
 * Privacy
 * -------
 * Error logs carry only error class/code/message (safe strings we construct),
 * phase, and operation. Never raw chat/user ids, dates, words, messages, query
 * data, or SQL. Run summaries are count-based.
 */

/** Distinct temporary cron that runs the backfill. Must match wrangler.jsonc triggers. */
export const BACKFILL_CRON = '*/2 * * * *';

/** Exact daily summary/cleanup cron. Kept unchanged from the pre-Phase-3a behavior. */
export const DAILY_SUMMARY_CRON = '59 23 * * *';

/** Singleton backfill job name. */
export const JOB_NAME = 'daily_aggregates_v1';

/**
 * State model version; bumping invalidates old state rows and forces a full
 * rescan with profile rehydration. Version 2 restarts the backfill from the
 * base phase (cursor null, page_offset 0) and invalidates every
 * `source='backfill'` coverage row to pending so that all days are
 * re-processed with chat-scoped profile data.
 */
export const JOB_VERSION = 2;

/** Lease duration in seconds; renewed on every state write, released on finish. */
export const LEASE_TTL_SECONDS = 600;

/**
 * Maximum source KV list entries inspected per scheduled invocation. The
 * 50-key cap applies to every phase; how many of those inspected keys are
 * actually processed is decided per phase by dynamic resource admission
 * (simple one-statement families reach the cap, expensive base/finalize work
 * stops earlier).
 */
export const MAX_KEYS_PER_RUN = 50;

/** Maximum coverage rows processed by the finalize phase per invocation. */
export const MAX_COVERAGE_ROWS_PER_RUN = 25;

/** Maximum total D1 statements per invocation, including state and parity reads. */
const D1_STATEMENT_BUDGET = 90;

/**
 * A source invocation can attempt nine state statements: initial read, optional
 * init + re-read, lease acquire, re-read under lease, batch admission + terminal
 * checkpoint, plus admission + terminal error checkpoint if the data batch fails.
 * A version-reset path also totals nine: initial read, three reset statements,
 * re-read, source admission + terminal, then failure admission + terminal.
 * Reserve that worst case before building aggregate writes.
 */
const SOURCE_STATE_STATEMENT_RESERVE = 9;
const SOURCE_D1_STATEMENT_BUDGET = D1_STATEMENT_BUDGET - SOURCE_STATE_STATEMENT_RESERVE;

/** Maximum KV get calls per invocation (Cloudflare allows 1,000 subrequests total). */
export const MAX_KV_GETS_PER_RUN = 300;

/** Initial finalize cursor chat id: every real chat id sorts above this. */
const FINALIZE_START_CHAT_ID = -Number.MAX_SAFE_INTEGER;

/** Safe job-level error codes. Never raw exception text or identity. */
type BackfillErrorCode =
  | 'kv_list_failed'
  | 'kv_get_failed'
  | 'd1_write_failed'
  | 'lease_lost'
  | 'internal';

/** Safe coverage reason codes (closed set). */
export type CoverageReasonCode =
  | 'source_key_invalid'
  | 'source_value_invalid'
  | 'missing_base_counter'
  | 'missing_activity_total'
  | 'message_count_mismatch';

/** Deterministic global phase order over the complete modern source families. */
const SOURCE_PHASES = [
  'base',
  'words',
  'media_stats',
  'media_duration',
  'profanity',
  'criminal',
  'criminal_severity',
  'hours',
  'buckets',
  'profanity_words',
  'profanity_word_users',
] as const;

const NEXT_PHASE: Record<string, string | undefined> = {
  base: 'words',
  words: 'media_stats',
  media_stats: 'media_duration',
  media_duration: 'profanity',
  profanity: 'criminal',
  criminal: 'criminal_severity',
  criminal_severity: 'hours',
  hours: 'buckets',
  buckets: 'profanity_words',
  profanity_words: 'profanity_word_users',
  profanity_word_users: 'finalize',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR_RE = /^([01]\d|2[0-3])$/;
const BUCKET_NAMES = new Set(['night', 'morning', 'noon', 'evening']);
const MEDIA_TYPES = new Set(['voice', 'video_note']);

const SELECT_STATE = 'SELECT * FROM stats_backfill_state WHERE job_name = ?';

const INIT_STATE = `
  INSERT INTO stats_backfill_state
    (job_name, version, status, phase, cutoff_day, cursor, page_offset,
     lease_owner, lease_expires_at, revision, error_code, created_at, updated_at)
  VALUES (?, ?, 'running', 'base', ?, NULL, 0, NULL, NULL, 1, NULL, ?, ?)
  ON CONFLICT(job_name) DO NOTHING
`;

/** Atomic lease acquisition: D1 clock treats equality as expired. */
const ACQUIRE_LEASE = `
  UPDATE stats_backfill_state
  SET lease_owner = ?, lease_expires_at = unixepoch('now') + ?, updated_at = ?
  WHERE job_name = ? AND status = 'running'
    AND (lease_owner IS NULL OR lease_expires_at <= unixepoch('now'))
`;

/**
 * First statement of every ordinary mutation batch. D1 admits only the exact
 * captured lease while it remains strictly valid at statement execution time.
 */
const ADMIT_MUTATION_BATCH = `
  UPDATE stats_backfill_state
  SET lease_owner = ?, updated_at = ?
  WHERE job_name = ? AND version = ? AND revision = ? AND lease_owner = ?
    AND status = 'running' AND lease_expires_at > unixepoch('now')
`;

/** Checkpoint and release in the same admitted mutation batch. */
const CHECKPOINT_AND_RELEASE = `
  UPDATE stats_backfill_state
  SET cursor = ?, page_offset = ?, phase = ?, status = ?, error_code = ?,
      revision = revision + 1, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
  WHERE job_name = ? AND version = ? AND revision = ? AND lease_owner = ?
    AND status = 'running'
`;

/** Terminal done transition in the same admitted mutation batch. */
const FINISH_JOB = `
  UPDATE stats_backfill_state
  SET status = 'done', phase = 'done', cursor = NULL, page_offset = 0,
       lease_owner = NULL, lease_expires_at = NULL, error_code = NULL,
       revision = revision + 1, updated_at = ?
  WHERE job_name = ? AND version = ? AND revision = ? AND lease_owner = ?
    AND status = 'running'
`;

/**
 * Version-reset admission. Unlike an ordinary batch, an outdated terminal row
 * may have no active lease, so an exact free-or-expired owner may claim it.
 */
const ADMIT_VERSION_RESET = `
  UPDATE stats_backfill_state
  SET lease_owner = ?, lease_expires_at = unixepoch('now') + ?, updated_at = ?
  WHERE job_name = ? AND version = ? AND revision = ? AND status = ? AND lease_owner IS ?
    AND (lease_owner IS NULL OR lease_expires_at <= unixepoch('now'))
`;

/**
 * Version-reset terminal state. Runs only after ADMIT_VERSION_RESET rotates the
 * captured owner to this batch token in the same D1 transaction. Preserves the
 * immutable cutoff_day and its D1-clock lease from admission.
 */
const VERSION_RESET_STATE = `
  UPDATE stats_backfill_state
  SET version = ?, status = 'running', phase = 'base', cursor = NULL, page_offset = 0,
       error_code = NULL, revision = revision + 1, updated_at = ?
   WHERE job_name = ? AND version = ? AND revision = ? AND status = ? AND lease_owner = ?
`;

/**
 * Invalidate every backfill-owned coverage row: reset all three statuses to
 * 'pending' and clear the reason so reprocessing starts clean. Live-owned rows
 * (source = 'live') are untouched. Must run in the same atomic batch as the
 * state reset to prevent old 'complete' coverage from being read between the
 * version bump and the coverage reset.
 */
const VERSION_INVALIDATE_COVERAGE = `
  UPDATE stats_daily_coverage
  SET base_status = 'pending', profanity_status = 'pending', criminal_status = 'pending',
      reason_code = NULL, updated_at = ?
    WHERE source = 'backfill'
      AND EXISTS (SELECT 1 FROM stats_backfill_state
         WHERE job_name = ? AND version = ? AND revision = ? AND lease_owner = ?
           AND status = 'running')
`;

/** SQL predicate repeated inside every admitted backfill mutation. */
const EPOCH_FENCE = `
  EXISTS (
    SELECT 1 FROM stats_backfill_state
    WHERE job_name = ? AND version = ? AND revision = ? AND lease_owner = ?
      AND status = 'running'
  )
`;

/**
 * Column-specific user upserts: each statement INSERTs only its own column so
 * source-family arrival order cannot zero or overwrite another family's value.
 * `stats_daily_user.last_message_ts` is never touched by backfill (the live
 * writer owns it); profile-bearing source phases instead fill chat-scoped
 * `last_message_ts` from `last_message:{chat}:{user}`.
 */
type UserColumn =
  | 'message_count'
  | 'word_count'
  | 'voice_count'
  | 'voice_duration_seconds'
  | 'video_note_count'
  | 'video_note_duration_seconds'
  | 'profanity_count'
  | 'criminal_count'
  | 'criminal_severity';

function userColumnUpsertSql(column: UserColumn): string {
  return `
    INSERT INTO stats_daily_user (chat_id, day, user_id, ${column})
    SELECT ?, ?, ?, ? WHERE ${EPOCH_FENCE}
    ON CONFLICT(chat_id, day, user_id) DO UPDATE SET ${column} = excluded.${column}
    WHERE ${EPOCH_FENCE}
  `;
}

/** Profile fill: username from user:{id}; last_message_ts from `last_message:{chat}:{user}` never regresses. */
const PROFILE_UPSERT = `
  INSERT INTO stats_chat_user_profile (chat_id, user_id, username, last_message_ts)
  SELECT ?, ?, ?, ? WHERE ${EPOCH_FENCE}
  ON CONFLICT(chat_id, user_id) DO UPDATE SET
    username = excluded.username,
    last_message_ts = MAX(COALESCE(last_message_ts, 0), COALESCE(excluded.last_message_ts, 0))
  WHERE ${EPOCH_FENCE}
`;

const HOUR_ABSOLUTE_UPSERT = `
  INSERT INTO stats_daily_hour (chat_id, day, hour, message_count)
  SELECT ?, ?, ?, ? WHERE ${EPOCH_FENCE}
  ON CONFLICT(chat_id, day, hour) DO UPDATE SET
    message_count = excluded.message_count
  WHERE ${EPOCH_FENCE}
`;

const BUCKET_ABSOLUTE_UPSERT = `
  INSERT INTO stats_daily_bucket_user (chat_id, day, bucket, user_id, message_count)
  SELECT ?, ?, ?, ?, ? WHERE ${EPOCH_FENCE}
  ON CONFLICT(chat_id, day, bucket, user_id) DO UPDATE SET
    message_count = excluded.message_count
  WHERE ${EPOCH_FENCE}
`;

const PROFANITY_WORD_ABSOLUTE_UPSERT = `
  INSERT INTO stats_daily_profanity_word (chat_id, day, word, count)
  SELECT ?, ?, ?, ? WHERE ${EPOCH_FENCE}
  ON CONFLICT(chat_id, day, word) DO UPDATE SET
    count = excluded.count
  WHERE ${EPOCH_FENCE}
`;

const PROFANITY_WORD_USER_ABSOLUTE_UPSERT = `
  INSERT INTO stats_daily_profanity_word_user (chat_id, day, word, user_id, count)
  SELECT ?, ?, ?, ?, ? WHERE ${EPOCH_FENCE}
  ON CONFLICT(chat_id, day, word, user_id) DO UPDATE SET
    count = excluded.count
  WHERE ${EPOCH_FENCE}
`;

/**
 * Backfill coverage upsert: an absent discovered (chat, day) is created
 * `pending` with `source='backfill'`. `pending` is never a servable status;
 * `complete` is written only by the finalize parity check. Existing backfill-owned coverage
 * is refreshed to pending, but existing live-owned coverage retains every
 * ownership/status/reason field. This makes live ownership monotonic without a
 * generation column: a backfill cannot update a row after live wins.
 * The first non-null backfill reason code sticks.
 */
const COVERAGE_BACKFILL_UPSERT = `
  INSERT INTO stats_daily_coverage
    (chat_id, day, base_status, profanity_status, criminal_status, source, reason_code, updated_at)
  SELECT ?, ?, 'pending', 'pending', 'pending', 'backfill', ?, ?
  WHERE ${EPOCH_FENCE}
  ON CONFLICT(chat_id, day) DO UPDATE SET
    base_status = 'pending',
    profanity_status = 'pending',
    criminal_status = 'pending',
    source = 'backfill',
    reason_code = CASE
      WHEN stats_daily_coverage.reason_code IS NULL THEN excluded.reason_code
      ELSE stats_daily_coverage.reason_code
    END,
    updated_at = MAX(stats_daily_coverage.updated_at, excluded.updated_at)
  WHERE stats_daily_coverage.source = 'backfill' AND ${EPOCH_FENCE}
`;

/** Finalize page: non-complete, un-reasoned backfill days strictly before cutoff. */
const FINALIZE_PAGE = `
  SELECT chat_id, day
  FROM stats_daily_coverage
  WHERE source = 'backfill' AND day < ?
    AND reason_code IS NULL
    AND (base_status <> 'complete' OR profanity_status <> 'complete' OR criminal_status <> 'complete')
    AND (chat_id > ? OR (chat_id = ? AND day > ?))
  ORDER BY chat_id, day
  LIMIT ?
`;

const LEGACY_ACTIVITY_READ = 'SELECT count FROM activity WHERE chat_id = ? AND day = ?';
const USER_TOTAL_READ =
  'SELECT COALESCE(SUM(message_count), 0) AS total FROM stats_daily_user WHERE chat_id = ? AND day = ?';

/**
 * Atomic completion: all three statuses complete, reason cleared. Guarded by
 * the expected backfill state so a live write that raced (flipping a status to
 * `live` and `source` to `live`) can never be overwritten to `complete`.
 */
const FINALIZE_COMPLETE = `
  UPDATE stats_daily_coverage
  SET base_status = 'complete', profanity_status = 'complete', criminal_status = 'complete',
      source = 'backfill', reason_code = NULL, updated_at = ?
  WHERE chat_id = ? AND day = ?
    AND source = 'backfill'
    AND base_status = 'pending' AND profanity_status = 'pending' AND criminal_status = 'pending'
    AND ${EPOCH_FENCE}
`;

/** Deferral: keep non-complete statuses, record the safe reason. Only touches backfill-owned days. */
const FINALIZE_DEFER = `
  UPDATE stats_daily_coverage
  SET reason_code = ?, updated_at = ?
  WHERE chat_id = ? AND day = ? AND source = 'backfill'
    AND ${EPOCH_FENCE}
`;

interface BackfillStateRow {
  job_name: string;
  version: number;
  status: 'running' | 'done';
  phase: string;
  cutoff_day: string;
  cursor: string | null;
  page_offset: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  revision: number;
  error_code: string | null;
  created_at: number;
  updated_at: number;
}

/** Immutable state identity captured immediately after acquire or version reset. */
interface BackfillEpoch {
  jobName: string;
  version: number;
  revision: number;
  leaseOwner: string;
}

type D1BindValue = null | number | string;

export interface BackfillRunSummary {
  phase: string;
  done: boolean;
  keysProcessed: number;
  keysSkipped: number;
  statements: number;
  coverageCompleted: number;
  coverageDeferred: number;
  leaseBlocked: boolean;
  errorCode: string | null;
}

class BackfillError extends Error {
  readonly code: BackfillErrorCode;
  constructor(code: BackfillErrorCode, message: string) {
    super(message);
    this.name = 'BackfillError';
    this.code = code;
  }
}

/**
 * Privacy-safe extraction of an unexpected backfill failure for the outer
 * scheduled handler. Surfaces only the error class name and, when the error is
 * one of our own constructed `BackfillError`s, the safe closed-set code. Never
 * raw messages, ids, dates, words, SQL, or payloads.
 */
export function backfillErrorInfo(error: unknown): { name: string; code: BackfillErrorCode | null } {
  if (error instanceof BackfillError) {
    return { name: 'BackfillError', code: error.code };
  }
  if (error instanceof Error) {
    return { name: error.name || 'Error', code: null };
  }
  return { name: 'UnknownError', code: null };
}

/** Tracks KV get/list counts for one invocation slice. */
class KvBudget {
  gets = 0;
  lists = 0;
}

/**
 * Phase-aware admission limits: the worst-case resource cost of one valid
 * source key for the phase, checked before any KV get or statement is built.
 * Profile-bearing phases reserve the profile upsert in addition to their
 * aggregate upsert; other count families reserve exactly one upsert. The
 * distinct-day coverage upsert is accounted separately per (chat, day).
 */
interface PhaseAdmission {
  /** Worst-case aggregate statements a valid key can add to the source batch. */
  maxStatementsPerKey: number;
  /** Worst-case KV gets a valid key needs. */
  maxGetsPerKey: number;
}

/** Base phase: a valid key adds at most a message_count + profile upsert and needs three KV gets. */
const BASE_ADMISSION: PhaseAdmission = { maxStatementsPerKey: 2, maxGetsPerKey: 3 };

/** D1-visible non-base user phases: aggregate + profile, counter + profile KV reads. */
const CATEGORY_PROFILE_ADMISSION: PhaseAdmission = { maxStatementsPerKey: 2, maxGetsPerKey: 3 };

/** Count families: exactly one absolute upsert and one KV get per valid key. */
const COUNT_ADMISSION: PhaseAdmission = { maxStatementsPerKey: 1, maxGetsPerKey: 1 };

type ParseResult =
  | { kind: 'malformed' }
  | { kind: 'invalid'; chatId: number; day: string }
  | { kind: 'valid'; chatId: number; day: string };

interface KeyEntry {
  key: string;
  chatId: number;
  day: string;
}

interface EntryResult {
  statements: D1PreparedStatement[];
  reason: CoverageReasonCode | null;
}

type EntryBuilder = (
  entry: KeyEntry,
  budget: KvBudget,
  epoch: BackfillEpoch,
) => Promise<EntryResult | 'deferred'>;

interface SliceOutcome {
  phaseDone: boolean;
  nextCursor: string | null;
  nextOffset: number;
  keysInspected: number;
  keysSkipped: number;
  statements: number;
}

function unixSeconds(date: Date = new Date()): number {
  return Math.floor(date.getTime() / 1000);
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isValidDay(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Parses a signed Telegram identifier. Accepts signed integers (negative group
 * `-100...` ids and positive user ids); rejects malformed, decimal, exponent,
 * or otherwise non-integer values.
 */
function parseId(value: string): number | null {
  if (!/^-?\d+$/.test(value)) return null;
  const parsed = parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Parses a positive, nonzero Telegram user identifier. */
function parsePositiveUserId(value: string): number | null {
  const parsed = parseId(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Parses a counter value. null (absent key) means 0 and is valid; any non
 * digit-only string is invalid and records a safe anomaly instead of writing a
 * fabricated zero.
 */
function parseCount(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^\d+$/.test(value)) return null;
  return parseInt(value, 10);
}

function epochBinds(epoch: BackfillEpoch): [string, number, number, string] {
  return [epoch.jobName, epoch.version, epoch.revision, epoch.leaseOwner];
}

/** Binds every fence occurrence in an already-fenced data upsert. */
function prepareFencedStatement(
  db: D1Database,
  sql: string,
  values: D1BindValue[],
  epoch: BackfillEpoch,
  fenceCount: 1 | 2 = 2,
): D1PreparedStatement {
  const params = [...values, ...epochBinds(epoch)];
  if (fenceCount === 2) params.push(...epochBinds(epoch));
  return db.prepare(sql).bind(...params);
}

function captureEpoch(
  state: BackfillStateRow,
  owner: string,
): BackfillEpoch | null {
  if (
    state.job_name !== JOB_NAME ||
    state.version !== JOB_VERSION ||
    state.status !== 'running' ||
    state.lease_owner !== owner
  ) {
    return null;
  }
  return {
    jobName: state.job_name,
    version: state.version,
    revision: state.revision,
    leaseOwner: owner,
  };
}

function admitted(result: D1Result | undefined): boolean {
  return Number(result?.meta?.changes ?? 0) === 1;
}

/** Builds a new token-scoped fence for statements after batch admission. */
function withBatchToken(epoch: BackfillEpoch, batchToken: string): BackfillEpoch {
  return { ...epoch, leaseOwner: batchToken };
}

function admissionStatement(
  db: D1Database,
  epoch: BackfillEpoch,
  batchToken: string,
  nowSec: number,
): D1PreparedStatement {
  return db.prepare(ADMIT_MUTATION_BATCH).bind(batchToken, nowSec, ...epochBinds(epoch));
}

async function batchSafely(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  try {
    return (await db.batch(statements)) as D1Result[];
  } catch {
    throw new BackfillError('d1_write_failed', 'd1 batch failed');
  }
}

// ---------------------------------------------------------------------------
// State helpers (all lease-guarded; D1 is the authoritative checkpoint)
// ---------------------------------------------------------------------------

async function readState(db: D1Database, jobName: string): Promise<BackfillStateRow | null> {
  return ((await db.prepare(SELECT_STATE).bind(jobName).first()) as BackfillStateRow | null) ?? null;
}

async function initState(db: D1Database, jobName: string, cutoffDay: string, nowSec: number): Promise<void> {
  await db.prepare(INIT_STATE).bind(jobName, JOB_VERSION, cutoffDay, nowSec, nowSec).run();
}

async function acquireLease(
  db: D1Database,
  jobName: string,
  owner: string,
  nowSec: number,
): Promise<boolean> {
  const result = await db
    .prepare(ACQUIRE_LEASE)
    .bind(owner, LEASE_TTL_SECONDS, nowSec, jobName)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

interface StatePatch {
  cursor: string | null;
  pageOffset: number;
  phase: string;
  status: 'running' | 'done';
  errorCode: string | null;
}

function checkpointStatement(
  db: D1Database,
  epoch: BackfillEpoch,
  nowSec: number,
  patch: StatePatch,
): D1PreparedStatement {
  return db
    .prepare(CHECKPOINT_AND_RELEASE)
    .bind(
      patch.cursor,
      patch.pageOffset,
      patch.phase,
      patch.status,
      patch.errorCode,
      nowSec,
      ...epochBinds(epoch),
    );
}

function finishStatement(
  db: D1Database,
  epoch: BackfillEpoch,
  nowSec: number,
): D1PreparedStatement {
  return db.prepare(FINISH_JOB).bind(nowSec, ...epochBinds(epoch));
}

async function persistFailure(
  db: D1Database,
  epoch: BackfillEpoch,
  nowSec: number,
  state: BackfillStateRow,
  code: BackfillErrorCode,
): Promise<boolean> {
  const batchToken = crypto.randomUUID();
  const batchEpoch = withBatchToken(epoch, batchToken);
  const results = await batchSafely(db, [
    admissionStatement(db, epoch, batchToken, nowSec),
    checkpointStatement(db, batchEpoch, nowSec, {
      cursor: state.cursor,
      pageOffset: state.page_offset,
      phase: state.phase,
      status: 'running',
      errorCode: code,
    }),
  ]);
  return admitted(results[0]) && admitted(results[1]);
}

// ---------------------------------------------------------------------------
// Key parsing
// ---------------------------------------------------------------------------

/** `stats_v2:{chat}:{day}:{user}` and `word_stats_v2:{chat}:{day}:{user}`. */
function parseStatsV2Key(key: string): ParseResult {
  const parts = key.split(':');
  if (parts.length !== 4) return { kind: 'malformed' };
  const chatId = parseId(parts[1]);
  if (chatId === null || !isValidDay(parts[2])) return { kind: 'malformed' };
  if (parsePositiveUserId(parts[3]) === null) return { kind: 'invalid', chatId, day: parts[2] };
  return { kind: 'valid', chatId, day: parts[2] };
}

/** `media_stats_v2:{chat}:{day}:{user}:{type}` / `media_duration_v2:...`. */
function parseMediaKey(key: string): ParseResult {
  const parts = key.split(':');
  if (parts.length !== 5) return { kind: 'malformed' };
  const chatId = parseId(parts[1]);
  if (chatId === null || !isValidDay(parts[2])) return { kind: 'malformed' };
  if (parsePositiveUserId(parts[3]) === null || !MEDIA_TYPES.has(parts[4])) {
    return { kind: 'invalid', chatId, day: parts[2] };
  }
  return { kind: 'valid', chatId, day: parts[2] };
}

/** `{family}:{chat}:{user}:{day}` for profanity/criminal/criminal_severity. */
function parseUserDayKey(key: string): ParseResult {
  const parts = key.split(':');
  if (parts.length !== 4) return { kind: 'malformed' };
  const chatId = parseId(parts[1]);
  const day = parts[3];
  if (chatId === null || !isValidDay(day)) return { kind: 'malformed' };
  if (parsePositiveUserId(parts[2]) === null) return { kind: 'invalid', chatId, day };
  return { kind: 'valid', chatId, day };
}

/** `activity_hour:{chat}:{day}:{hour}`. */
function parseHoursKey(key: string): ParseResult {
  const parts = key.split(':');
  if (parts.length !== 4) return { kind: 'malformed' };
  const chatId = parseId(parts[1]);
  if (chatId === null || !isValidDay(parts[2])) return { kind: 'malformed' };
  if (!HOUR_RE.test(parts[3])) return { kind: 'invalid', chatId, day: parts[2] };
  return { kind: 'valid', chatId, day: parts[2] };
}

/** `activity_time_bucket:{chat}:{day}:{bucket}:{user}`. */
function parseBucketsKey(key: string): ParseResult {
  const parts = key.split(':');
  if (parts.length !== 5) return { kind: 'malformed' };
  const chatId = parseId(parts[1]);
  if (chatId === null || !isValidDay(parts[2])) return { kind: 'malformed' };
  if (!BUCKET_NAMES.has(parts[3]) || parsePositiveUserId(parts[4]) === null) {
    return { kind: 'invalid', chatId, day: parts[2] };
  }
  return { kind: 'valid', chatId, day: parts[2] };
}

/** `profanity_words:{chat}:{word}:{day}` (word may itself contain ':'). */
function parseWordsKey(key: string): ParseResult {
  const parts = key.split(':');
  if (parts.length < 4) return { kind: 'malformed' };
  const chatId = parseId(parts[1]);
  const day = parts[parts.length - 1];
  if (chatId === null || !isValidDay(day)) return { kind: 'malformed' };
  const word = parts.slice(2, parts.length - 1).join(':');
  if (!word) return { kind: 'invalid', chatId, day };
  return { kind: 'valid', chatId, day };
}

/** `profanity_word_users:{chat}:{word}:{day}:{user}`. */
function parseWordUsersKey(key: string): ParseResult {
  const parts = key.split(':');
  if (parts.length < 5) return { kind: 'malformed' };
  const chatId = parseId(parts[1]);
  const day = parts[parts.length - 2];
  if (chatId === null || !isValidDay(day)) return { kind: 'malformed' };
  if (parsePositiveUserId(parts[parts.length - 1]) === null) return { kind: 'invalid', chatId, day };
  const word = parts.slice(2, parts.length - 2).join(':');
  if (!word) return { kind: 'invalid', chatId, day };
  return { kind: 'valid', chatId, day };
}

// ---------------------------------------------------------------------------
// Per-phase entry builders
// ---------------------------------------------------------------------------

interface BackfillProfile {
  username: string;
  lastMessageTs: number;
  written: boolean;
}

/**
 * Reads one chat-scoped profile snapshot at most once per page. A global user
 * can belong to multiple chats, so cache key includes chat id. Missing global
 * usernames retain legacy's `id{userId}` fallback, but never skip the
 * chat-scoped last-message lookup or profile write.
 */
async function readBackfillProfile(
  env: Env,
  budget: KvBudget,
  profileCache: Map<string, BackfillProfile>,
  chatId: number,
  userId: number,
): Promise<BackfillProfile | 'deferred'> {
  const profileTag = `${chatId}:${userId}`;
  const cached = profileCache.get(profileTag);
  if (cached) return cached;
  if (budget.gets + 1 > MAX_KV_GETS_PER_RUN) return 'deferred';

  let username: string | null;
  try {
    username = await env.COUNTERS.get(`user:${userId}`);
  } catch {
    throw new BackfillError('kv_get_failed', 'kv get failed');
  }
  budget.gets += 1;

  if (budget.gets + 1 > MAX_KV_GETS_PER_RUN) return 'deferred';

  let lastMessageValue: string | null;
  try {
    lastMessageValue = await env.COUNTERS.get(`last_message:${chatId}:${userId}`);
  } catch {
    throw new BackfillError('kv_get_failed', 'kv get failed');
  }
  budget.gets += 1;

  // Absent or malformed last_message → 0 ("unknown"): never fabricates a
  // timestamp and PROFILE_UPSERT never regresses a newer persisted value.
  const profile = {
    username: username && username.length > 0 ? username : `id${userId}`,
    lastMessageTs: parseCount(lastMessageValue) ?? 0,
    written: false,
  };
  profileCache.set(profileTag, profile);
  return profile;
}

/** Adds one monotonic profile upsert per (chat, user) page snapshot. */
function appendBackfillProfileUpsert(
  env: Env,
  statements: D1PreparedStatement[],
  epoch: BackfillEpoch,
  chatId: number,
  userId: number,
  profile: BackfillProfile,
): void {
  if (profile.written) return;
  profile.written = true;
  statements.push(
    prepareFencedStatement(
      env.DB,
      PROFILE_UPSERT,
      [chatId, userId, profile.username, profile.lastMessageTs],
      epoch,
    ),
  );
}

/** Base phase: message_count per user + profile snapshot, no PII. */
function makeBaseBuilder(env: Env, profileCache: Map<string, BackfillProfile>): EntryBuilder {
  return async (entry, budget, epoch) => {
    if (budget.gets + 3 > MAX_KV_GETS_PER_RUN) return 'deferred';
    const userId = parseInt(entry.key.split(':')[3], 10);
    let messageValue: string | null;
    try {
      messageValue = await env.COUNTERS.get(entry.key);
    } catch {
      throw new BackfillError('kv_get_failed', 'kv get failed');
    }
    budget.gets += 1;

    const messages = parseCount(messageValue);
    if (messages === null) {
      return { statements: [], reason: 'source_value_invalid' };
    }

    const statements: D1PreparedStatement[] = [
      prepareFencedStatement(
        env.DB,
        userColumnUpsertSql('message_count'),
        [entry.chatId, entry.day, userId, messages],
        epoch,
      ),
    ];
    const profile = await readBackfillProfile(env, budget, profileCache, entry.chatId, userId);
    if (profile === 'deferred') return 'deferred';
    appendBackfillProfileUpsert(env, statements, epoch, entry.chatId, userId, profile);
    return { statements, reason: null };
  };
}

/**
 * D1-visible category rankings need base-equivalent profile snapshots. This is
 * intentionally separate from live category writes: historical KV supplies a
 * real last_message value, while live category events must not invent one.
 */
function makeProfiledUserCountBuilder(
  env: Env,
  makeUpsert: (entry: KeyEntry) => { sql: string; binds: D1BindValue[] },
  userIdForEntry: (entry: KeyEntry) => number,
  profileCache: Map<string, BackfillProfile>,
): EntryBuilder {
  return async (entry, budget, epoch) => {
    if (budget.gets + 3 > MAX_KV_GETS_PER_RUN) return 'deferred';
    let value: string | null;
    try {
      value = await env.COUNTERS.get(entry.key);
    } catch {
      throw new BackfillError('kv_get_failed', 'kv get failed');
    }
    budget.gets += 1;
    const count = parseCount(value);
    if (count === null) {
      return { statements: [], reason: 'source_value_invalid' };
    }

    const userId = userIdForEntry(entry);
    const profile = await readBackfillProfile(env, budget, profileCache, entry.chatId, userId);
    if (profile === 'deferred') return 'deferred';

    const { sql, binds } = makeUpsert(entry);
    const statements: D1PreparedStatement[] = [
      prepareFencedStatement(env.DB, sql, [entry.chatId, entry.day, ...binds, count], epoch),
    ];
    appendBackfillProfileUpsert(env, statements, epoch, entry.chatId, userId, profile);
    return { statements, reason: null };
  };
}

/** Generic count family: one absolute upsert per valid value; no fabricated zeros. */
function makeCountBuilder(
  env: Env,
  makeUpsert: (entry: KeyEntry) => { sql: string; binds: D1BindValue[] },
): EntryBuilder {
  return async (entry, budget, epoch) => {
    if (budget.gets + 1 > MAX_KV_GETS_PER_RUN) return 'deferred';
    let value: string | null;
    try {
      value = await env.COUNTERS.get(entry.key);
    } catch {
      throw new BackfillError('kv_get_failed', 'kv get failed');
    }
    budget.gets += 1;
    const count = parseCount(value);
    if (count === null) {
      return { statements: [], reason: 'source_value_invalid' };
    }
    const { sql, binds } = makeUpsert(entry);
    return {
      statements: [prepareFencedStatement(env.DB, sql, [entry.chatId, entry.day, ...binds, count], epoch)],
      reason: null,
    };
  };
}

// ---------------------------------------------------------------------------
// Phase slice driver (KV-list page + in-page offset + per-run budgets)
// ---------------------------------------------------------------------------

async function runPhaseSlice(
  env: Env,
  state: BackfillStateRow,
  epoch: BackfillEpoch,
  prefix: string,
  parseKey: (key: string) => ParseResult,
  buildEntry: EntryBuilder,
  admission: PhaseAdmission,
  nowSec: number,
): Promise<SliceOutcome> {
  const budget = new KvBudget();
  const batchToken = crypto.randomUUID();
  const batchEpoch = withBatchToken(epoch, batchToken);
  budget.lists += 1;
  let list: any;
  try {
    list = state.cursor
      ? await env.COUNTERS.list({ prefix, cursor: state.cursor })
      : await env.COUNTERS.list({ prefix });
  } catch {
    throw new BackfillError('kv_list_failed', 'kv list failed');
  }

  const pageKeys: string[] = (list.keys ?? []).map((k: any) => String(k.name));
  const listComplete = Boolean(list.list_complete);
  const nextPageCursor: string | null = listComplete ? null : (list.cursor as string | undefined) ?? null;
  if (!listComplete && !list.cursor && pageKeys.length === 0) {
    throw new BackfillError('internal', 'kv list returned an empty page without a cursor');
  }

  const statements: D1PreparedStatement[] = [];
  const coverageByDay = new Map<string, { chatId: number; day: string; reason: CoverageReasonCode | null }>();

  const noteCoverage = (chatId: number, day: string, reason: CoverageReasonCode | null): void => {
    const tag = `${chatId}:${day}`;
    const existing = coverageByDay.get(tag);
    if (!existing) {
      coverageByDay.set(tag, { chatId, day, reason });
    } else if (existing.reason === null && reason !== null) {
      existing.reason = reason;
    }
  };

  let inspected = 0;
  let skipped = 0;
  let i = state.page_offset;
  for (; i < pageKeys.length && inspected < MAX_KEYS_PER_RUN; i += 1) {
    // Every list entry consumes source-key budget, even if it is malformed,
    // outside the immutable cutoff, or otherwise invalid before a KV get.
    inspected += 1;
    const parsed = parseKey(pageKeys[i]);
    if (parsed.kind === 'malformed') {
      skipped += 1;
      continue;
    }
    if (parsed.day >= state.cutoff_day) {
      skipped += 1;
      continue;
    }

    if (parsed.kind === 'invalid') {
      const tag = `${parsed.chatId}:${parsed.day}`;
      const newDay = !coverageByDay.has(tag);
      if (
        newDay &&
        statements.length + coverageByDay.size + 1 > SOURCE_D1_STATEMENT_BUDGET
      ) {
        break;
      }
      noteCoverage(parsed.chatId, parsed.day, 'source_key_invalid');
      skipped += 1;
      continue;
    }

    const entry: KeyEntry = { key: pageKeys[i], chatId: parsed.chatId, day: parsed.day };
    const tag = `${parsed.chatId}:${parsed.day}`;
    const newDay = !coverageByDay.has(tag);
    // Phase-aware admission BEFORE any KV get or statement is built: reserve
    // this phase's worst-case statements for the key (base includes the
    // optional profile upsert, count families exactly one), the coverage
    // upsert for a new (chat, day), and the KV gets. Never start work the
    // fixed whole-invocation budgets could not contain; the checkpoint simply
    // resumes at this key next run.
    if (
      budget.gets + admission.maxGetsPerKey > MAX_KV_GETS_PER_RUN ||
      statements.length + admission.maxStatementsPerKey + coverageByDay.size + (newDay ? 1 : 0) >
        SOURCE_D1_STATEMENT_BUDGET
    ) {
      break;
    }
    const result = await buildEntry(entry, budget, batchEpoch);
    if (result === 'deferred') break;

    // Post-check against actual statements; the phase estimate is a worst
    // case, so this only guards against an estimate that undercounted.
    if (
      statements.length + result.statements.length + coverageByDay.size + (newDay ? 1 : 0) >
      SOURCE_D1_STATEMENT_BUDGET
    ) {
      break;
    }
    for (const statement of result.statements) statements.push(statement);
    noteCoverage(parsed.chatId, parsed.day, result.reason);
  }
  const consumed = i;

  // One coverage upsert per distinct (chat, day) touched by this slice.
  for (const coverage of coverageByDay.values()) {
    statements.push(
      prepareFencedStatement(
        env.DB,
        COVERAGE_BACKFILL_UPSERT,
        [coverage.chatId, coverage.day, coverage.reason, nowSec],
        batchEpoch,
      ),
    );
  }

  let phaseDone = false;
  let nextCursor = state.cursor;
  let nextOffset = consumed;
  if (consumed >= pageKeys.length) {
    if (listComplete) {
      phaseDone = true;
      nextCursor = null;
      nextOffset = 0;
    } else {
      nextCursor = nextPageCursor;
      nextOffset = 0;
    }
  }

  const nextPhase = phaseDone ? NEXT_PHASE[state.phase] : state.phase;
  if (!nextPhase) throw new BackfillError('internal', 'source phase has no successor');

  // One D1 transaction: DB-clock admission, data mutations, then checkpoint/release.
  // The data budget reserves these two state statements and remains ≤90 overall.
  const results = await batchSafely(env.DB, [
    admissionStatement(env.DB, epoch, batchToken, nowSec),
    ...statements,
    checkpointStatement(env.DB, batchEpoch, nowSec, {
      cursor: nextCursor,
      pageOffset: nextOffset,
      phase: nextPhase,
      status: 'running',
      errorCode: null,
    }),
  ]);
  if (!admitted(results[0])) throw new BackfillError('lease_lost', 'mutation batch not admitted');
  if (!admitted(results[results.length - 1])) {
    throw new BackfillError('internal', 'mutation batch checkpoint failed');
  }

  return {
    phaseDone,
    nextCursor,
    nextOffset,
    keysInspected: inspected,
    keysSkipped: skipped,
    statements: statements.length,
  };
}

// ---------------------------------------------------------------------------
// Source phase dispatch
// ---------------------------------------------------------------------------

function runSourceSlice(
  env: Env,
  state: BackfillStateRow,
  epoch: BackfillEpoch,
  phase: string,
  nowSec: number,
): Promise<SliceOutcome> {
  switch (phase) {
    case 'base':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'stats_v2:',
        parseStatsV2Key,
        makeBaseBuilder(env, new Map<string, BackfillProfile>()),
        BASE_ADMISSION,
        nowSec,
      );
    case 'words':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'word_stats_v2:',
        parseStatsV2Key,
        makeCountBuilder(env, (entry) => ({
          sql: userColumnUpsertSql('word_count'),
          binds: [parseInt(entry.key.split(':')[3], 10)],
        })),
        COUNT_ADMISSION,
        nowSec,
      );
    case 'media_stats':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'media_stats_v2:',
        parseMediaKey,
        makeCountBuilder(env, (entry) => {
          const parts = entry.key.split(':');
          const column: UserColumn = parts[4] === 'voice' ? 'voice_count' : 'video_note_count';
          return { sql: userColumnUpsertSql(column), binds: [parseInt(parts[3], 10)] };
        }),
        COUNT_ADMISSION,
        nowSec,
      );
    case 'media_duration':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'media_duration_v2:',
        parseMediaKey,
        makeCountBuilder(env, (entry) => {
          const parts = entry.key.split(':');
          const column: UserColumn = parts[4] === 'voice' ? 'voice_duration_seconds' : 'video_note_duration_seconds';
          return { sql: userColumnUpsertSql(column), binds: [parseInt(parts[3], 10)] };
        }),
        COUNT_ADMISSION,
        nowSec,
      );
    case 'profanity':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'profanity:',
        parseUserDayKey,
        makeProfiledUserCountBuilder(
          env,
          (entry) => ({
            sql: userColumnUpsertSql('profanity_count'),
            binds: [parseInt(entry.key.split(':')[2], 10)],
          }),
          (entry) => parseInt(entry.key.split(':')[2], 10),
          new Map<string, BackfillProfile>(),
        ),
        CATEGORY_PROFILE_ADMISSION,
        nowSec,
      );
    case 'criminal':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'criminal:',
        parseUserDayKey,
        makeProfiledUserCountBuilder(
          env,
          (entry) => ({
            sql: userColumnUpsertSql('criminal_count'),
            binds: [parseInt(entry.key.split(':')[2], 10)],
          }),
          (entry) => parseInt(entry.key.split(':')[2], 10),
          new Map<string, BackfillProfile>(),
        ),
        CATEGORY_PROFILE_ADMISSION,
        nowSec,
      );
    case 'criminal_severity':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'criminal_severity:',
        parseUserDayKey,
        makeCountBuilder(env, (entry) => ({
          sql: userColumnUpsertSql('criminal_severity'),
          binds: [parseInt(entry.key.split(':')[2], 10)],
        })),
        COUNT_ADMISSION,
        nowSec,
      );
    case 'hours':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'activity_hour:',
        parseHoursKey,
        makeCountBuilder(env, (entry) => ({
          sql: HOUR_ABSOLUTE_UPSERT,
          binds: [parseInt(entry.key.split(':')[3], 10)],
        })),
        COUNT_ADMISSION,
        nowSec,
      );
    case 'buckets':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'activity_time_bucket:',
        parseBucketsKey,
        makeProfiledUserCountBuilder(
          env,
          (entry) => {
            const parts = entry.key.split(':');
            return { sql: BUCKET_ABSOLUTE_UPSERT, binds: [parts[3], parseInt(parts[4], 10)] };
          },
          (entry) => parseInt(entry.key.split(':')[4], 10),
          new Map<string, BackfillProfile>(),
        ),
        CATEGORY_PROFILE_ADMISSION,
        nowSec,
      );
    case 'profanity_words':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'profanity_words:',
        parseWordsKey,
        makeCountBuilder(env, (entry) => {
          const parts = entry.key.split(':');
          return { sql: PROFANITY_WORD_ABSOLUTE_UPSERT, binds: [parts.slice(2, parts.length - 1).join(':')] };
        }),
        COUNT_ADMISSION,
        nowSec,
      );
    case 'profanity_word_users':
      return runPhaseSlice(
        env,
        state,
        epoch,
        'profanity_word_users:',
        parseWordUsersKey,
        makeProfiledUserCountBuilder(
          env,
          (entry) => {
            const parts = entry.key.split(':');
            return {
              sql: PROFANITY_WORD_USER_ABSOLUTE_UPSERT,
              binds: [parts.slice(2, parts.length - 2).join(':'), parseInt(parts[parts.length - 1], 10)],
            };
          },
          (entry) => {
            const parts = entry.key.split(':');
            return parseInt(parts[parts.length - 1], 10);
          },
          new Map<string, BackfillProfile>(),
        ),
        CATEGORY_PROFILE_ADMISSION,
        nowSec,
      );
    default:
      throw new BackfillError('internal', 'unknown backfill phase');
  }
}

// ---------------------------------------------------------------------------
// Finalize phase: parity-gated coverage completion
// ---------------------------------------------------------------------------

function parseFinalizeCursor(cursor: string | null): [number, string] {
  if (!cursor) return [FINALIZE_START_CHAT_ID, ''];
  const sep = cursor.indexOf(':');
  if (sep <= 0) return [FINALIZE_START_CHAT_ID, ''];
  const chatId = parseInt(cursor.slice(0, sep), 10);
  if (!Number.isInteger(chatId)) return [FINALIZE_START_CHAT_ID, ''];
  return [chatId, cursor.slice(sep + 1)];
}

async function runFinalizeSlice(
  db: D1Database,
  state: BackfillStateRow,
  epoch: BackfillEpoch,
  summary: BackfillRunSummary,
  nowSec: number,
): Promise<BackfillRunSummary> {
  const [startChatId, startDay] = parseFinalizeCursor(state.cursor);
  let page: any;
  try {
    page = await db
      .prepare(FINALIZE_PAGE)
      .bind(state.cutoff_day, startChatId, startChatId, startDay, MAX_COVERAGE_ROWS_PER_RUN)
      .all();
  } catch {
    throw new BackfillError('d1_write_failed', 'finalize coverage page read failed');
  }
  const rows: Array<{ chat_id: number; day: string }> = (page.results ?? []) as any;

  const batchToken = crypto.randomUUID();
  const batchEpoch = withBatchToken(epoch, batchToken);
  const updates: D1PreparedStatement[] = [];
  let coverageCompleted = 0;
  let coverageDeferred = 0;
  for (const row of rows) {
    let total: { total: number } | null = null;
    try {
      total = (await db.prepare(USER_TOTAL_READ).bind(row.chat_id, row.day).first()) as
        | { total: number }
        | null;
    } catch {
      throw new BackfillError('d1_write_failed', 'finalize parity read failed');
    }
    const sum = total ? Number(total.total) : 0;

    // No base counter for this day (orphan source families only): can never be served.
    if (sum === 0) {
      updates.push(
        prepareFencedStatement(
          db,
          FINALIZE_DEFER,
          ['missing_base_counter', nowSec, row.chat_id, row.day],
          batchEpoch,
          1,
        ),
      );
      coverageDeferred += 1;
      continue;
    }

    let activity: { count: number } | null = null;
    try {
      activity = (await db.prepare(LEGACY_ACTIVITY_READ).bind(row.chat_id, row.day).first()) as
        | { count: number }
        | null;
    } catch {
      throw new BackfillError('d1_write_failed', 'finalize parity read failed');
    }

    if (!activity) {
      updates.push(
        prepareFencedStatement(
          db,
          FINALIZE_DEFER,
          ['missing_activity_total', nowSec, row.chat_id, row.day],
          batchEpoch,
          1,
        ),
      );
      coverageDeferred += 1;
    } else if (Number(activity.count) !== sum) {
      updates.push(
        prepareFencedStatement(
          db,
          FINALIZE_DEFER,
          ['message_count_mismatch', nowSec, row.chat_id, row.day],
          batchEpoch,
          1,
        ),
      );
      coverageDeferred += 1;
    } else {
      updates.push(
        prepareFencedStatement(db, FINALIZE_COMPLETE, [nowSec, row.chat_id, row.day], batchEpoch, 1),
      );
      coverageCompleted += 1;
    }
  }

  let terminal: D1PreparedStatement;
  if (rows.length < MAX_COVERAGE_ROWS_PER_RUN) {
    terminal = finishStatement(db, batchEpoch, nowSec);
  } else {
    const lastRow = rows[rows.length - 1];
    terminal = checkpointStatement(db, batchEpoch, nowSec, {
      cursor: `${lastRow.chat_id}:${lastRow.day}`,
      pageOffset: 0,
      phase: 'finalize',
      status: 'running',
      errorCode: null,
    });
  }

  const results = await batchSafely(db, [
    admissionStatement(db, epoch, batchToken, nowSec),
    ...updates,
    terminal,
  ]);
  if (!admitted(results[0])) throw new BackfillError('lease_lost', 'mutation batch not admitted');
  if (!admitted(results[results.length - 1])) {
    throw new BackfillError('internal', 'mutation batch terminal state failed');
  }

  summary.coverageCompleted += coverageCompleted;
  summary.coverageDeferred += coverageDeferred;
  if (rows.length < MAX_COVERAGE_ROWS_PER_RUN) summary.done = true;
  return summary;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Runs one bounded backfill slice for the singleton `daily_aggregates_v1` job.
 * One phase (or page portion) per invocation: at most `MAX_KEYS_PER_RUN` (50)
 * inspected source keys, admitted per phase within at most 300 KV gets and at
 * most 90 D1 statements total. `now` is injectable for tests.
 */
export async function runDailyAggregateBackfill(
  env: Env,
  now: Date = new Date(),
): Promise<BackfillRunSummary> {
  const summary: BackfillRunSummary = {
    phase: '',
    done: false,
    keysProcessed: 0,
    keysSkipped: 0,
    statements: 0,
    coverageCompleted: 0,
    coverageDeferred: 0,
    leaseBlocked: false,
    errorCode: null,
  };

  if (!env.DB || !env.COUNTERS) {
    console.warn('Daily aggregate backfill skipped: DB or COUNTERS binding unavailable');
    return summary;
  }

  const db = env.DB;
  const nowSec = unixSeconds(now);
  const today = utcDay(now);

  let state = await readState(db, JOB_NAME);
  if (!state) {
    await initState(db, JOB_NAME, today, nowSec);
    state = await readState(db, JOB_NAME);
    if (!state) {
      summary.errorCode = 'internal';
      return summary;
    }
  }

  // Version mismatch: state from a previous JOB_VERSION (e.g. v1) is unsafe
  // because it may mark coverage complete before chat-scoped profiles were
  // populated. Atomically reset the state to the current version and
  // invalidate every backfill-owned coverage row in a single D1 batch so
  // old 'complete' coverage can never be read between the version bump and
  // the coverage reset.
  let resetOwned = false;
  if (state.version !== JOB_VERSION) {
    const resetOwner = crypto.randomUUID();
    const resetRevision = state.revision + 1;
    let resetBatch: D1Result[];
    try {
      resetBatch = await db.batch([
        db.prepare(ADMIT_VERSION_RESET).bind(
          resetOwner,
          LEASE_TTL_SECONDS,
          nowSec,
          JOB_NAME,
          state.version,
          state.revision,
          state.status,
          state.lease_owner,
        ),
        db.prepare(VERSION_RESET_STATE).bind(
          JOB_VERSION,
          nowSec,
          JOB_NAME,
          state.version,
          state.revision,
          state.status,
          resetOwner,
        ),
        db.prepare(VERSION_INVALIDATE_COVERAGE).bind(
          nowSec,
          JOB_NAME,
          JOB_VERSION,
          resetRevision,
          resetOwner,
        ),
      ]) as D1Result[];
    } catch {
      summary.errorCode = 'd1_write_failed';
      return summary;
    }
    if (!admitted(resetBatch[0])) {
      summary.leaseBlocked = true;
      return summary;
    }
    state = await readState(db, JOB_NAME);
    if (!state) {
      summary.errorCode = 'internal';
      return summary;
    }
    resetOwned =
      state.version === JOB_VERSION &&
      state.revision === resetRevision &&
      state.status === 'running' &&
      state.lease_owner === resetOwner;
    if (!resetOwned) {
      summary.errorCode = 'lease_lost';
      return summary;
    }
  }

  if (state.status === 'done') {
    // Terminal: cheap read, no writes (Phase 3b removes the temporary cron
    // after status verification; see docs/features/admin-stats-d1-optimization.md).
    summary.phase = 'done';
    summary.done = true;
    return summary;
  }
  summary.phase = state.phase;

  const owner = resetOwned ? state.lease_owner! : crypto.randomUUID();
  if (!resetOwned && !(await acquireLease(db, JOB_NAME, owner, nowSec))) {
    summary.leaseBlocked = true;
    return summary;
  }
  // Re-read under our lease: another run may have advanced the checkpoint
  // between our first read and acquisition; reprocessing stale slices is safe
  // (absolute idempotent writes) but avoidable.
  state = await readState(db, JOB_NAME);
  if (!state) {
    summary.errorCode = 'lease_lost';
    return summary;
  }
  const epoch = captureEpoch(state, owner);
  if (!epoch) {
    summary.errorCode = 'lease_lost';
    return summary;
  }
  summary.phase = state.phase;

  try {
    if (state.phase === 'finalize') {
      return await runFinalizeSlice(db, state, epoch, summary, nowSec);
    }
    if (!SOURCE_PHASES.includes(state.phase as (typeof SOURCE_PHASES)[number])) {
      summary.errorCode = 'internal';
      if (!(await persistFailure(db, epoch, nowSec, state, 'internal'))) summary.errorCode = 'lease_lost';
      return summary;
    }

    const outcome = await runSourceSlice(env, state, epoch, state.phase, nowSec);
    summary.keysProcessed = outcome.keysInspected;
    summary.keysSkipped = outcome.keysSkipped;
    summary.statements = outcome.statements;

    if (outcome.phaseDone) {
      const nextPhase = NEXT_PHASE[state.phase];
      if (!nextPhase) throw new BackfillError('internal', 'source phase has no successor');
      summary.phase = nextPhase;
      return summary;
    }
    return summary;
  } catch (error) {
    const code = error instanceof BackfillError ? error.code : 'internal';
    summary.errorCode = code;
    if (code === 'lease_lost') return summary;
    console.error('daily aggregate backfill phase error', {
      phase: state.phase,
      errName: error instanceof Error ? error.name : 'UnknownError',
      errCode: code,
      errMsg: error instanceof BackfillError ? error.message : undefined,
    });
    try {
      if (!(await persistFailure(db, epoch, nowSec, state, code))) summary.errorCode = 'lease_lost';
    } catch {
      summary.errorCode = 'd1_write_failed';
    }
    return summary;
  }
}
