import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import { JOB_VERSION } from './daily-backfill';

export const BACKFILL_JOB_NAME = 'daily_aggregates_v1';

interface CoverageRow {
  day: string;
  base_status: string;
  profanity_status: string;
  criminal_status: string;
  reason_code: string | null;
}

export interface D1RangeReadinessQueryPlan {
  statements: D1PreparedStatement[];
}

/** Builds all statements required to prove a range can be read from one D1 snapshot. */
export function createD1RangeReadinessQueryPlan(
  db: D1Database,
  chatId: number,
  days: string[],
): D1RangeReadinessQueryPlan {
  return {
    statements: [
    db.prepare(`SELECT day, base_status, profanity_status, criminal_status, reason_code
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
    ],
  };
}

/** Interprets a completed readiness query plan. It never performs D1 I/O. */
export function isD1RangeReadyFromResults(
  results: readonly D1Result<unknown>[],
  days: string[],
): boolean {
  const coverageResult = results[0] as { results: CoverageRow[] };
  const state = results[1].results[0] as { status: string; cutoff_day: string; version: number } | undefined;
  const first = results[2].results[0] as { day: string | null } | undefined;
  const activityResult = results[3] as { results: { day: string }[] };
  const aggregateResult = results[4] as { results: { day: string }[] };
  const hourResult = results[5] as { results: { day: string }[] };
  const bucketResult = results[6] as { results: { day: string }[] };
  const profWordResult = results[7] as { results: { day: string }[] };
  const profWordUserResult = results[8] as { results: { day: string }[] };

  // Version gate: coverage from a previous backfill version (e.g. v1 before
  // profile rehydration) must not be served. The backfill resets both the
  // state version and every backfill-owned coverage row atomically when it
  // detects a mismatch, but this guard ensures no stale 'complete' rows are
  // read between a code deploy and the first scheduled backfill run.
  if (!state || state.version !== JOB_VERSION) return false;

  // No range may be served while the backfill job is still running, even if
  // individual coverage rows have already been marked complete by an earlier
  // phase. Only a 'done' status signals that every phase finished and the
  // coverage snapshot is globally consistent.
  if (state.status !== 'done') return false;

  const coverage = new Map((coverageResult.results ?? []).map((row) => [row.day, row]));
  const activity = new Set((activityResult.results ?? []).map((row) => row.day));
  const aggregates = new Set((aggregateResult.results ?? []).map((row) => row.day));
  // Category-only tables are backfilled by phases that never create a
  // stats_daily_user row, so an orphan day (category data, no base counter)
  // must never be mistaken for a provable empty day.
  const categoryDays = new Set<string>([
    ...(hourResult.results ?? []).map((row) => row.day),
    ...(bucketResult.results ?? []).map((row) => row.day),
    ...(profWordResult.results ?? []).map((row) => row.day),
    ...(profWordUserResult.results ?? []).map((row) => row.day),
  ]);
  for (const day of days) {
    const row = coverage.get(day);
    if (row && row.base_status === 'complete' && row.profanity_status === 'complete' &&
      row.criminal_status === 'complete' && row.reason_code === null) continue;
    // Empty historical days are provable only once full backfill has finished
    // and the day has neither activity, aggregate, nor any category rows.
    const historicalZero = state.status === 'done' && day < state.cutoff_day &&
      first?.day !== null && first?.day !== undefined && day >= first.day &&
      !activity.has(day) && !aggregates.has(day) && !categoryDays.has(day);
    if (!historicalZero) return false;
  }
  return true;
}

/** True only when every requested UTC day can be read from one D1 snapshot. */
export async function isD1RangeReady(db: D1Database, chatId: number, days: string[]): Promise<boolean> {
  const plan = createD1RangeReadinessQueryPlan(db, chatId, days);
  const results = await db.batch(plan.statements);
  return isD1RangeReadyFromResults(results, days);
}
