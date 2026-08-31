import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

/**
 * Rolling live-day pipeline progress model.
 *
 * CountersDO is the per-chat serialized authority: it allocates a day-local
 * monotonic sequence for every accepted message and, in the same D1 batch as
 * the base aggregate write, records base progress as accepted+completed and
 * profanity/criminal as accepted+pending. Async analysis acks each terminal
 * branch back to CountersDO, which advances only the highest contiguous
 * completed sequence and stores out-of-order completion gaps in durable
 * storage. `failed_count > 0` is never represented as zero.
 *
 * Privacy: no message text, usernames, words, or user IDs are stored; only the
 * opaque numeric sequence/counts/outcome and a timestamp.
 */

export type ProgressCategory = 'base' | 'profanity' | 'criminal';

export const PROGRESS_CATEGORIES: readonly ProgressCategory[] = [
  'base',
  'profanity',
  'criminal',
];

/** Terminal async outcome for profanity/criminal (base completes synchronously). */
export type ProgressOutcome = 'completed' | 'zero' | 'skipped' | 'failed';

/** Durable progress bookkeeping kept inside CountersDO storage. */
export interface ProgressState {
  /** Highest contiguous completed sequence (success/zero/skipped). */
  completedPrefix: number;
  /** Completed sequences above the prefix (out-of-order gaps). Sorted ascending. */
  gaps: number[];
  /** Failed sequences. Sorted ascending. */
  failed: number[];
}

export function emptyProgressState(): ProgressState {
  return { completedPrefix: 0, gaps: [], failed: [] };
}

/** Advances the contiguous prefix after a completion, consuming any gaps. */
function advancePrefix(prefix: number, gaps: number[]): { prefix: number; gaps: number[] } {
  let next = prefix;
  const remaining = [...gaps];
  let consumed = true;
  while (consumed) {
    consumed = false;
    const index = remaining.indexOf(next + 1);
    if (index >= 0) {
      remaining.splice(index, 1);
      next += 1;
      consumed = true;
    }
  }
  return { prefix: next, gaps: remaining };
}

/** Records a completed sequence (success/zero/skipped), advancing contiguously. */
export function applyCompletion(state: ProgressState, sequence: number): ProgressState {
  if (!Number.isInteger(sequence) || sequence <= 0) return state;
  // Idempotent for already-completed work below/at the prefix.
  if (sequence <= state.completedPrefix) return state;
  if (state.gaps.includes(sequence)) return state;
  if (state.failed.includes(sequence)) return state;
  if (sequence === state.completedPrefix + 1) {
    const { prefix, gaps } = advancePrefix(sequence, state.gaps);
    return { completedPrefix: prefix, gaps, failed: state.failed };
  }
  const gaps = [...state.gaps, sequence].sort((a, b) => a - b);
  return { completedPrefix: state.completedPrefix, gaps, failed: state.failed };
}

/** Records a tracked permanent failure; never represented as a zero. */
export function applyFailure(state: ProgressState, sequence: number): ProgressState {
  if (!Number.isInteger(sequence) || sequence <= 0) return state;
  if (state.failed.includes(sequence)) return state;
  if (state.gaps.includes(sequence)) {
    return {
      completedPrefix: state.completedPrefix,
      gaps: state.gaps.filter((s) => s !== sequence),
      failed: [...state.failed, sequence].sort((a, b) => a - b),
    };
  }
  if (sequence <= state.completedPrefix) return state;
  return {
    completedPrefix: state.completedPrefix,
    gaps: state.gaps,
    failed: [...state.failed, sequence].sort((a, b) => a - b),
  };
}

export interface ProgressCounts {
  completedSeq: number;
  pendingCount: number;
  failedCount: number;
}

/**
 * Derives truthful compact counts. A completed-but-out-of-order sequence is
 * resolved (not pending); pending only counts accepted work with no outcome yet.
 */
export function computeProgressCounts(state: ProgressState, acceptedSeq: number): ProgressCounts {
  const resolved = state.completedPrefix + state.gaps.length;
  const pending = Math.max(0, acceptedSeq - resolved - state.failed.length);
  return {
    completedSeq: state.completedPrefix,
    pendingCount: pending,
    failedCount: state.failed.length,
  };
}

/**
 * Minimal non-PII per-category pipeline snapshot exposed by CountersDO's
 * internal `/pipeline-snapshot` endpoint. Only opaque numeric counts and the
 * integrity clean flag; never exposes sequences of individual messages, text,
 * payloads, raw errors, or any identity.
 */
export interface PipelineCategorySnapshot {
  accepted: number;
  completed: number;
  pending: number;
  failed: number;
  /** False when a sticky poison or a recovered active attempt blocks trust. */
  clean: boolean;
}

/**
 * Per-day three-category DO snapshot: the common accepted sequence plus exact
 * computed counts and integrity clean status for base/profanity/criminal.
 */
export interface CountersDOPipelineSnapshot {
  day: string;
  /** Day-local accepted watermark shared by all three category streams. */
  accepted: number;
  categories: {
    base: PipelineCategorySnapshot;
    profanity: PipelineCategorySnapshot;
    criminal: PipelineCategorySnapshot;
  };
}

// ---------------------------------------------------------------------------
// Day proof marker (versioned, explicit provenance)
// ---------------------------------------------------------------------------

/**
 * Fixed version of the durable day proof contract. Bumped only by an
 * incompatible future proof contract; readers treat any stored marker with a
 * different version as unproven.
 */
export const PIPELINE_PROOF_VERSION = 1;

/**
 * Durable per-day proof marker kept inside CountersDO storage. Written once
 * when the day's first base sequence is newly allocated (before any D1
 * integrity arm or batch work) and never erased or downgraded. Presence with a
 * matching version proves the day is live-owned by serialized base acceptance;
 * absence (or a malformed marker) never qualifies exactness.
 */
export interface DurableDayProofMarker {
  /** Must equal `PIPELINE_PROOF_VERSION` to count as proven. */
  version: number;
  /** True once the day is initialized by base acceptance. */
  initialized: boolean;
}

/**
 * One day's proof snapshot in the multi-day response: proof version/status
 * plus the same opaque numeric counts as the single-day snapshot. When
 * `initialized` is false the day has no valid marker — it is NOT proven and
 * any zero counts are incidental only, for the later reader to reject.
 */
export interface CountersDODayProofSnapshot {
  day: string;
  /** Proof contract version of this snapshot (fixed `PIPELINE_PROOF_VERSION`). */
  version: number;
  /** True only when a valid stored marker exists for the day. */
  initialized: boolean;
  /** Common day-local accepted watermark (incidental when unproven). */
  accepted: number;
  categories: {
    base: PipelineCategorySnapshot;
    profanity: PipelineCategorySnapshot;
    criminal: PipelineCategorySnapshot;
  };
}

/**
 * Multi-day proof response: fixed contract version plus ordered day snapshots
 * in request order (deduplicated). One serialized logical read.
 */
export interface CountersDOPipelineSnapshots {
  version: number;
  days: CountersDODayProofSnapshot[];
}

/** Row shape read back from `stats_daily_pipeline_progress`. */
export interface ProgressRow {
  chat_id: number;
  day: string;
  category: string;
  accepted_seq: number;
  completed_seq: number;
  pending_count: number;
  failed_count: number;
  completed_through_ts: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// D1 write integrity state (pure; persisted later by CountersDO)
// ---------------------------------------------------------------------------

/**
 * Fixed non-PII reason for a sticky integrity poison. `d1_write_failed` is set
 * by a confirmed failed D1 attempt; `ambiguous_attempt` by restart recovery of
 * an attempt whose D1 outcome was never confirmed. Both are terminal markers:
 * once poisoned, the stream is unreadable until explicit remediation.
 */
export type IntegrityReason = 'd1_write_failed' | 'ambiguous_attempt';

/**
 * Serializable D1-write integrity state for one chat/day/category stream.
 *
 * An armed attempt means the D1 outcome is not durably known; while one is
 * active the stream must not be treated as clean/readable. Any confirmed
 * failure or recovered active attempt sets the sticky poison; poison is never
 * cleared automatically. Contains only opaque sequence numbers and fixed reason
 * codes — no message text, usernames, user IDs, raw errors, SQL, or payload.
 */
export interface IntegrityState {
  /** D1 attempt whose outcome is unknown, or null when none is armed. */
  activeAttemptSeq: number | null;
  /** Sticky poison: true once any attempt failed or was recovered ambiguous. */
  poisoned: boolean;
  /** Minimum known poisoned sequence, or null while clean. */
  firstPoisonedSeq: number | null;
  /** Fixed reason of the first poison; unchanged once set. */
  reason: IntegrityReason | null;
}

/** Fresh clean integrity state: nothing armed, not poisoned. */
export function emptyIntegrityState(): IntegrityState {
  return { activeAttemptSeq: null, poisoned: false, firstPoisonedSeq: null, reason: null };
}

function isValidAttemptSeq(sequence: number): boolean {
  return Number.isInteger(sequence) && sequence > 0;
}

/**
 * Pure poison transition: keeps the earliest poison (minimum sequence, first
 * reason) and only fills defaults when no poison exists yet.
 */
function poisonWith(state: IntegrityState, seq: number, reason: IntegrityReason): IntegrityState {
  return {
    activeAttemptSeq: state.activeAttemptSeq,
    poisoned: true,
    firstPoisonedSeq: state.firstPoisonedSeq === null ? seq : Math.min(state.firstPoisonedSeq, seq),
    reason: state.reason ?? reason,
  };
}

/** True when no attempt is armed and no poison is set; safe to trust D1 rows. */
export function isIntegrityClean(state: IntegrityState): boolean {
  return !state.poisoned && state.activeAttemptSeq === null;
}

/**
 * Arms a new D1 attempt. If another attempt is already active it is first
 * conservatively poisoned as ambiguous (its outcome was never confirmed), then
 * the new sequence is tracked. Re-arming the already-active sequence is a no-op.
 */
export function armIntegrityAttempt(state: IntegrityState, sequence: number): IntegrityState {
  if (!isValidAttemptSeq(sequence)) return state;
  if (state.activeAttemptSeq === sequence) return state;
  if (state.activeAttemptSeq !== null) {
    return {
      ...poisonWith(state, state.activeAttemptSeq, 'ambiguous_attempt'),
      activeAttemptSeq: sequence,
    };
  }
  return { ...state, activeAttemptSeq: sequence };
}

/**
 * Confirms the armed attempt at `sequence` succeeded durably. Only a matching
 * active attempt is cleared; a mismatch (or no active attempt) is a no-op, so a
 * stale confirmation can never clear a newer attempt or reset poison.
 */
export function confirmIntegrityAttempt(state: IntegrityState, sequence: number): IntegrityState {
  if (!isValidAttemptSeq(sequence)) return state;
  if (state.activeAttemptSeq !== sequence) return state;
  return { ...state, activeAttemptSeq: null };
}

/**
 * Marks the matching armed attempt failed: sticky poison with reason
 * `d1_write_failed`. Non-matching sequences are a no-op (never clears a newer
 * active attempt). Once poisoned, the stream never becomes clean automatically.
 */
export function failIntegrityAttempt(state: IntegrityState, sequence: number): IntegrityState {
  if (!isValidAttemptSeq(sequence)) return state;
  if (state.activeAttemptSeq !== sequence) return state;
  return { ...poisonWith(state, sequence, 'd1_write_failed'), activeAttemptSeq: null };
}

/**
 * Restart recovery: any pre-existing armed attempt whose D1 outcome is unknown
 * is sticky-poisoned as `ambiguous_attempt` and the active marker is cleared.
 * A clean state is returned unchanged (idempotent).
 */
export function recoverAmbiguousIntegrityAttempt(state: IntegrityState): IntegrityState {
  if (state.activeAttemptSeq === null) return state;
  return {
    ...poisonWith(state, state.activeAttemptSeq, 'ambiguous_attempt'),
    activeAttemptSeq: null,
  };
}

// ---------------------------------------------------------------------------
// D1 statement builders (called inside existing aggregate mutation batches)
// ---------------------------------------------------------------------------

/**
 * Base accept: absolute accepted/completed, zero pending/failed, monotonic
 * completed_through_ts. Used in the same batch as the base aggregate write.
 */
const PROGRESS_ACCEPT_BASE = `
  INSERT INTO stats_daily_pipeline_progress
    (chat_id, day, category, accepted_seq, completed_seq, pending_count, failed_count, completed_through_ts, updated_at)
  VALUES (?, ?, 'base', ?, ?, 0, 0, ?, ?)
  ON CONFLICT(chat_id, day, category) DO UPDATE SET
    accepted_seq = excluded.accepted_seq,
    completed_seq = excluded.completed_seq,
    completed_through_ts = MAX(stats_daily_pipeline_progress.completed_through_ts, excluded.completed_through_ts),
    updated_at = excluded.updated_at
`;

/** Async accept: absolute accepted, pending +1, completed/failed untouched. */
const PROGRESS_ACCEPT_PENDING = `
  INSERT INTO stats_daily_pipeline_progress
    (chat_id, day, category, accepted_seq, completed_seq, pending_count, failed_count, completed_through_ts, updated_at)
  VALUES (?, ?, ?, ?, 0, 1, 0, 0, ?)
  ON CONFLICT(chat_id, day, category) DO UPDATE SET
    accepted_seq = excluded.accepted_seq,
    pending_count = stats_daily_pipeline_progress.pending_count + 1,
    updated_at = excluded.updated_at
`;

/**
 * Resolve (ack) upsert: absolute values computed by CountersDO. completed_seq
 * only ever advances (never regresses); pending/failed are authoritative.
 */
const PROGRESS_RESOLVE = `
  INSERT INTO stats_daily_pipeline_progress
    (chat_id, day, category, accepted_seq, completed_seq, pending_count, failed_count, completed_through_ts, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(chat_id, day, category) DO UPDATE SET
    completed_seq = CASE
      WHEN excluded.completed_seq > stats_daily_pipeline_progress.completed_seq
        THEN excluded.completed_seq
      ELSE stats_daily_pipeline_progress.completed_seq
    END,
    pending_count = excluded.pending_count,
    failed_count = excluded.failed_count,
    completed_through_ts = MAX(stats_daily_pipeline_progress.completed_through_ts, excluded.completed_through_ts),
    updated_at = excluded.updated_at
`;

export function progressAcceptBaseStatement(
  db: D1Database,
  chatId: number,
  day: string,
  acceptedSeq: number,
  completedSeq: number,
  completedThroughTs: number,
  nowSec: number,
): D1PreparedStatement {
  return db
    .prepare(PROGRESS_ACCEPT_BASE)
    .bind(chatId, day, acceptedSeq, completedSeq, completedThroughTs, nowSec);
}

export function progressAcceptPendingStatement(
  db: D1Database,
  chatId: number,
  day: string,
  category: ProgressCategory,
  acceptedSeq: number,
  nowSec: number,
): D1PreparedStatement {
  return db.prepare(PROGRESS_ACCEPT_PENDING).bind(chatId, day, category, acceptedSeq, nowSec);
}

export function progressResolveStatement(
  db: D1Database,
  chatId: number,
  day: string,
  category: ProgressCategory,
  acceptedSeq: number,
  counts: ProgressCounts,
  completedThroughTs: number,
  nowSec: number,
): D1PreparedStatement {
  return db
    .prepare(PROGRESS_RESOLVE)
    .bind(
      chatId,
      day,
      category,
      acceptedSeq,
      counts.completedSeq,
      counts.pendingCount,
      counts.failedCount,
      completedThroughTs,
      nowSec,
    );
}
