import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import { JOB_VERSION } from './daily-backfill';
import {
  PIPELINE_PROOF_VERSION,
  type CountersDODayProofSnapshot,
  type ProgressRow,
} from './pipeline-progress';

export const BACKFILL_JOB_NAME = 'daily_aggregates_v1';

interface CoverageRow {
  day: string;
  base_status: string;
  profanity_status: string;
  criminal_status: string;
  source: string;
  reason_code: string | null;
}

export interface D1RangeReadinessQueryPlan {
  statements: D1PreparedStatement[];
  /** Index of the multi-day pipeline progress result, present for live ranges. */
  progressResultIndex?: number;
}

/** Compact per-category progress counts surfaced to the admin UI. */
export interface CategoryProgressCounts {
  accepted: number;
  completed: number;
  pending: number;
  failed: number;
}

/** Truthful compact progress metadata for a validated live-owned day. */
export interface LiveProgressSnapshot {
  day: string;
  pendingAnalysis: number;
  failedCount: number;
  categories: {
    base: CategoryProgressCounts;
    profanity: CategoryProgressCounts;
    criminal: CategoryProgressCounts;
  };
}

/**
 * Readiness metadata for every `source='live'` day of a requested range, built
 * from the same D1 batch that supplied the response aggregates. Every listed
 * day already carries a validated progress snapshot; the CountersDO proof is
 * compared against these snapshots by the caller.
 */
export interface D1LiveReadiness {
  /** Ordered live-owned requested days (request order, deduplicated). */
  liveDays: string[];
  /** Per live-owned day progress snapshot, keyed by day. */
  snapshots: Record<string, LiveProgressSnapshot>;
}

/**
 * Interpreted readiness of a rolling range (closed days + live-owned days).
 * `final`/`provisional` carry the validated live-day metadata so the caller can
 * run the exact CountersDO proof; `unknown` and `failed` name the offending
 * live day that rejects the whole range.
 */
export type RollingReadiness =
  | { kind: 'final'; live: D1LiveReadiness }
  | { kind: 'provisional'; live: D1LiveReadiness }
  | { kind: 'not-ready'; containsLiveCoverage: boolean }
  | { kind: 'failed'; day: string; progress: LiveProgressSnapshot }
  | { kind: 'unknown'; day: string };

/** Builds the multi-day pipeline progress statement for the complete requested range. */
function progressStatement(
  db: D1Database,
  chatId: number,
  days: string[],
): D1PreparedStatement {
  return db
    .prepare(
      `SELECT chat_id, day, category, accepted_seq, completed_seq,
              pending_count, failed_count, completed_through_ts, updated_at
       FROM stats_daily_pipeline_progress
       WHERE chat_id = ? AND day >= ? AND day <= ?`,
    )
    .bind(chatId, days[0], days[days.length - 1]);
}

/**
 * Builds all statements required to prove a range can be read from one D1
 * snapshot. When `liveDays` is non-empty, one multi-day pipeline progress
 * statement covering the complete requested range is appended to the same
 * batch, so every `source='live'` day can be validated atomically with the
 * aggregates (coverage classifies which days are actually live-owned).
 */
export function createD1RangeReadinessQueryPlan(
  db: D1Database,
  chatId: number,
  days: string[],
  liveDays: string[] = [],
): D1RangeReadinessQueryPlan {
  const statements: D1PreparedStatement[] = [
    db.prepare(`SELECT day, base_status, profanity_status, criminal_status, source, reason_code
      FROM stats_daily_coverage WHERE chat_id = ? AND day >= ? AND day <= ?`)
      .bind(chatId, days[0], days[days.length - 1]),
    db.prepare('SELECT status, cutoff_day, version FROM stats_backfill_state WHERE job_name = ?')
      .bind(BACKFILL_JOB_NAME),
    db.prepare('SELECT MIN(day) AS day FROM stats_daily_user WHERE chat_id = ?')
      .bind(chatId),
    db.prepare('SELECT day FROM activity WHERE chat_id = ? AND day >= ? AND day <= ?')
      .bind(chatId, days[0], days[days.length - 1]),
    db.prepare('SELECT day FROM stats_daily_user WHERE chat_id = ? AND day >= ? AND day <= ? GROUP BY day')
      .bind(chatId, days[0], days[days.length - 1]),
    db.prepare('SELECT day FROM stats_daily_hour WHERE chat_id = ? AND day >= ? AND day <= ? GROUP BY day')
      .bind(chatId, days[0], days[days.length - 1]),
    db.prepare('SELECT day FROM stats_daily_bucket_user WHERE chat_id = ? AND day >= ? AND day <= ? GROUP BY day')
      .bind(chatId, days[0], days[days.length - 1]),
    db.prepare('SELECT day FROM stats_daily_profanity_word WHERE chat_id = ? AND day >= ? AND day <= ? GROUP BY day')
      .bind(chatId, days[0], days[days.length - 1]),
    db.prepare('SELECT day FROM stats_daily_profanity_word_user WHERE chat_id = ? AND day >= ? AND day <= ? GROUP BY day')
      .bind(chatId, days[0], days[days.length - 1]),
  ];
  let progressResultIndex: number | undefined;
  if (liveDays.length > 0) {
    statements.push(progressStatement(db, chatId, days));
    progressResultIndex = statements.length - 1;
  }
  return { statements, progressResultIndex };
}

/** Parsed base readiness results, shared by closed and rolling interpretation. */
interface ReadinessInputs {
  coverage: Map<string, CoverageRow>;
  state: { status: string; cutoff_day: string; version: number } | undefined;
  firstDay: string | null;
  activity: Set<string>;
  aggregates: Set<string>;
  categoryDays: Set<string>;
  /** Multi-day pipeline progress rows for the complete requested range. */
  progress: ProgressRow[];
}

function parseReadinessInputs(results: readonly D1Result<unknown>[]): ReadinessInputs {
  const coverageResult = results[0] as { results: CoverageRow[] };
  const state = results[1].results[0] as
    | { status: string; cutoff_day: string; version: number }
    | undefined;
  const first = results[2].results[0] as { day: string | null } | undefined;
  const activityResult = results[3] as { results: { day: string }[] };
  const aggregateResult = results[4] as { results: { day: string }[] };
  const hourResult = results[5] as { results: { day: string }[] };
  const bucketResult = results[6] as { results: { day: string }[] };
  const profWordResult = results[7] as { results: { day: string }[] };
  const profWordUserResult = results[8] as { results: { day: string }[] };
  const progressResult = results[9] as { results: ProgressRow[] } | undefined;

  return {
    coverage: new Map((coverageResult.results ?? []).map((row) => [row.day, row])),
    state,
    firstDay: first?.day ?? null,
    activity: new Set((activityResult.results ?? []).map((row) => row.day)),
    aggregates: new Set((aggregateResult.results ?? []).map((row) => row.day)),
    // Category-only tables are backfilled by phases that never create a
    // stats_daily_user row, so an orphan day (category data, no base counter)
    // must never be mistaken for a provable empty day.
    categoryDays: new Set<string>([
      ...(hourResult.results ?? []).map((row) => row.day),
      ...(bucketResult.results ?? []).map((row) => row.day),
      ...(profWordResult.results ?? []).map((row) => row.day),
      ...(profWordUserResult.results ?? []).map((row) => row.day),
    ]),
    progress: (progressResult?.results ?? []) as ProgressRow[],
  };
}

/** Strict per-day readiness for a closed historical day. */
function isClosedDayReady(day: string, inputs: ReadinessInputs): boolean {
  const row = inputs.coverage.get(day);
  // An explicit coverage row is historically final only when it explicitly
  // belongs to backfill: complete in every phase with no reason code. A
  // live-owned day must never pass the closed gate — its CountersDO proof is
  // the only valid source, and a writer bug marking statuses 'complete' must
  // not qualify. Any other source value (unknown, malformed) carries no
  // completion guarantee, so the row rejects the day outright.
  if (row) {
    return (
      row.source === 'backfill' &&
      row.base_status === 'complete' &&
      row.profanity_status === 'complete' &&
      row.criminal_status === 'complete' &&
      row.reason_code === null
    );
  }
  // Empty historical days are provable only once full backfill has finished
  // and the day has neither activity, aggregate, nor any category rows.
  const state = inputs.state;
  if (!state || state.status !== 'done') return false;
  return (
    day < state.cutoff_day &&
    inputs.firstDay !== null &&
    day >= inputs.firstDay &&
    !inputs.activity.has(day) &&
    !inputs.aggregates.has(day) &&
    !inputs.categoryDays.has(day)
  );
}

/** Interprets a completed readiness query plan. It never performs D1 I/O. */
export function isD1RangeReadyFromResults(
  results: readonly D1Result<unknown>[],
  days: string[],
): boolean {
  const inputs = parseReadinessInputs(results);
  // Version gate: coverage from a previous backfill version (e.g. v1 before
  // profile rehydration) must not be served. The backfill resets both the
  // state version and every backfill-owned coverage row atomically when it
  // detects a mismatch, but this guard ensures no stale 'complete' rows are
  // read between a code deploy and the first scheduled backfill run.
  if (!inputs.state || inputs.state.version !== JOB_VERSION) return false;

  // No range may be served while the backfill job is still running, even if
  // individual coverage rows have already been marked complete by an earlier
  // phase. Only a 'done' status signals that every phase finished and the
  // coverage snapshot is globally consistent.
  if (inputs.state.status !== 'done') return false;

  for (const day of days) {
    if (!isClosedDayReady(day, inputs)) return false;
  }
  return true;
}

/** True only when every requested UTC day can be read from one D1 snapshot. */
export async function isD1RangeReady(db: D1Database, chatId: number, days: string[]): Promise<boolean> {
  const plan = createD1RangeReadinessQueryPlan(db, chatId, days);
  const results = await db.batch(plan.statements);
  return isD1RangeReadyFromResults(results, days);
}

// ---------------------------------------------------------------------------
// Rolling readiness: closed days strict + optional live-day progress
// ---------------------------------------------------------------------------

function categoryCounts(row: ProgressRow | undefined): CategoryProgressCounts {
  if (!row) return { accepted: 0, completed: 0, pending: 0, failed: 0 };
  return {
    accepted: Number(row.accepted_seq) || 0,
    completed: Number(row.completed_seq) || 0,
    pending: Number(row.pending_count) || 0,
    failed: Number(row.failed_count) || 0,
  };
}

function buildSnapshot(liveDay: string, rows: ProgressRow[]): LiveProgressSnapshot {
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  const base = categoryCounts(byCategory.get('base'));
  const profanity = categoryCounts(byCategory.get('profanity'));
  const criminal = categoryCounts(byCategory.get('criminal'));
  return {
    day: liveDay,
    pendingAnalysis: base.pending + profanity.pending + criminal.pending,
    failedCount: base.failed + profanity.failed + criminal.failed,
    categories: { base, profanity, criminal },
  };
}

function validateProgressInvariants(snapshot: LiveProgressSnapshot): { ok: boolean } {
  const cats = [snapshot.categories.base, snapshot.categories.profanity, snapshot.categories.criminal] as const;
  const acceptedValues = cats.map((c) => c.accepted);
  const firstAccepted = acceptedValues[0];
  for (const v of acceptedValues.slice(1)) {
    if (v !== firstAccepted) return { ok: false };
  }
  for (const c of cats) {
    if (!Number.isInteger(c.accepted) || !Number.isInteger(c.completed) || !Number.isInteger(c.pending) || !Number.isInteger(c.failed)) return { ok: false };
    if (c.accepted < 0 || c.completed < 0 || c.pending < 0 || c.failed < 0) return { ok: false };
    if (c.completed > c.accepted) return { ok: false };
    if (c.failed > c.accepted) return { ok: false };
    if (c.pending + c.completed + c.failed > c.accepted) return { ok: false };
    // Conservation: pending must not exceed remaining after completed+failed; gaps make it strictly less
    const maxPending = Math.max(0, c.accepted - c.completed - c.failed);
    if (c.pending > maxPending) return { ok: false };
    // If pending is less than max, gaps are present; gaps coherence means completed+failed+pending <= accepted, already checked
  }
  return { ok: true };
}

/**
 * Interprets a rolling readiness batch. Closed (non-live) days keep the
 * existing strict backfill gate; every `source='live'` coverage day is readable
 * only when its base/profanity/criminal progress rows exist in the same batch
 * and satisfy the integrity invariants. The range is provisional only when the
 * current UTC day is a validated live-owned day; otherwise a validated
 * live-owned range is final.
 */
export function interpretRollingReadiness(
  results: readonly D1Result<unknown>[],
  days: string[],
  liveDay: string | null,
): RollingReadiness {
  const inputs = parseReadinessInputs(results);

  const liveDays = days.filter((day) => inputs.coverage.get(day)?.source === 'live');

  // Closed (non-live) days stay strict: current JOB_VERSION, global backfill
  // done, and per-day coverage complete or provably empty. Any gap rejects the
  // whole range before the live proof is consulted (mixed backfill/live
  // requires every day).
  const closedDays = days.filter((day) => !liveDays.includes(day));
  if (closedDays.length > 0) {
    if (!inputs.state || inputs.state.version !== JOB_VERSION) {
      return { kind: 'not-ready', containsLiveCoverage: liveDays.length > 0 };
    }
    if (inputs.state.status !== 'done') {
      return { kind: 'not-ready', containsLiveCoverage: liveDays.length > 0 };
    }
    for (const day of closedDays) {
      if (!isClosedDayReady(day, inputs)) {
        return { kind: 'not-ready', containsLiveCoverage: liveDays.length > 0 };
      }
    }
  }

  // Every live-owned day must carry base/profanity/criminal progress rows from
  // the same batch and satisfy the integrity invariants. Missing categories or
  // an invariant failure make the day unknown; a permanent D1 failure rejects
  // with the truthful snapshot.
  const snapshots: Record<string, LiveProgressSnapshot> = {};
  for (const liveDayName of liveDays) {
    const rows = inputs.progress.filter((row) => row.day === liveDayName);
    const hasAllCategories =
      rows.some((row) => row.category === 'base') &&
      rows.some((row) => row.category === 'profanity') &&
      rows.some((row) => row.category === 'criminal');
    if (!hasAllCategories) return { kind: 'unknown', day: liveDayName };
    const progress = buildSnapshot(liveDayName, rows);
    if (!validateProgressInvariants(progress).ok) return { kind: 'unknown', day: liveDayName };
    if (progress.failedCount > 0) return { kind: 'failed', day: liveDayName, progress };
    snapshots[liveDayName] = progress;
  }

  const live: D1LiveReadiness = { liveDays, snapshots };
  if (liveDays.length === 0) return { kind: 'final', live };
  // Provisional only for the still-open current UTC day; every other validated
  // live-owned day is a closed final day.
  if (liveDay !== null && liveDays.includes(liveDay)) {
    return { kind: 'provisional', live };
  }
  return { kind: 'final', live };
}

/**
 * Pure live-day integrity gate: true only when the D1 snapshot and the
 * serialized CountersDO day proof agree exactly for all three categories, the
 * day proof carries the current contract version, the day is proven
 * initialized, and no stream is pending/failed/poisoned.
 */
export function isLiveProgressExact(
  d1: LiveProgressSnapshot,
  doSnapshot: CountersDODayProofSnapshot,
): boolean {
  if (d1.day !== doSnapshot.day) return false;
  // Defense in depth: a day proof from a previous proof-contract version is
  // stale or malformed and must never validate, even when its counts match.
  if (doSnapshot.version !== PIPELINE_PROOF_VERSION) return false;
  if (doSnapshot.initialized !== true) return false;
  for (const category of ['base', 'profanity', 'criminal'] as const) {
    const left = d1.categories[category];
    const right = doSnapshot.categories[category];
    // Top-level accepted watermark must match each category's accepted.
    if (doSnapshot.accepted !== right.accepted) return false;
    if (left.accepted !== right.accepted) return false;
    if (left.completed !== right.completed) return false;
    if (left.pending !== right.pending) return false;
    if (left.failed !== right.failed) return false;
    // DO must report the stream clean (no sticky poison, no active attempt)
    // and every accepted message must be terminal with zero pending/failed.
    if (right.clean !== true) return false;
    if (right.accepted !== right.completed) return false;
    if (right.pending !== 0 || right.failed !== 0) return false;
  }
  return true;
}
