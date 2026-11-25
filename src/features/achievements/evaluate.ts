import { GROUP_DAY_SQL } from './queries';
import type { D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { Env } from '../../core/env';
import { Logger } from '../../core/logger';
import {
  createD1RangeReadinessQueryPlan, interpretIndividualReadiness, isLiveProgressExact,
  type LiveProgressSnapshot
} from '../stats/d1-coverage';
import { PIPELINE_PROOF_VERSION, type CountersDODayProofSnapshot } from '../stats/pipeline-progress';
import { daysBetween, mondayOf, shiftDay } from './calendar';
import { getEnrollment, getGroup } from './repository';
import {
  personalRules, weeklyRules, type Bucket, type ForwardSummary, type GroupDay,
  type Hour, type PersonalDay, type WeeklyReport
} from './rules';
export type { WeeklyReport } from './rules';

/** Read evidence and coverage in one D1 snapshot, then compare live watermarks with CountersDO. */
async function snapshot(env: Env, chat: number, days: string[], statements: D1PreparedStatement[],
  observedFrom: string, personal = false, openDay?: string) {
  const plan = createD1RangeReadinessQueryPlan(env.DB, chat, days, days, true);
  const results = await env.DB.batch([...plan.statements, ...statements]);
  const evidence = results.slice(0, plan.statements.length);
  const data = results.slice(plan.statements.length);
  // Only dates with this participant's evidence can influence a positive unlock.
  // Also certify the evaluation date so a silent day can safely advance the cursor.
  const needed = personal ? [...new Set([
    days[days.length - 1], ...typedRows<PersonalDay>(data[0]).map(r => r.day),
    ...typedRows<Bucket>(data[1]).map(r => r.day),
  ])] : days;
  const verified = new Set<string>();
  const live = new Map<string, LiveProgressSnapshot>();
  const readinessByDay = interpretIndividualReadiness(evidence, needed, openDay);
  for (const [day, readiness] of readinessByDay) {
    if (readiness.kind !== 'final' && readiness.kind !== 'provisional') continue;
    if (readiness.live.liveDays.length) live.set(day, readiness.live.snapshots[day]);
    else verified.add(day);
  }
  // Backfill-only databases already verify empty historical days. On fresh installations
  // require explicit DO confirmation plus absence in every activity/coverage stream.
  const tracedDates = new Set<string>();
  for (const index of [0, 3, 4, 5, 6, 7, 8, 9]) {
    for (const row of typedRows<{ day: string }>(evidence[index])) tracedDates.add(row.day);
  }
  const quiet = new Set(needed.filter(d => d >= observedFrom && !verified.has(d) && !tracedDates.has(d)));
  const requested = [...live.keys(), ...quiet];
  if (requested.length) {
    const stub = env.COUNTERS_DO.get(env.COUNTERS_DO.idFromName(String(chat)));
    for (let i = 0; i < requested.length; i += 30) {
      const chunk = requested.slice(i, i + 30);
      const proof = await readProof(stub, chunk, chunk.some(d => quiet.has(d))).catch(error => {
        if (!openDay) throw error;
        Logger.warn('Achievement progress coverage proof unavailable', {
          error: error instanceof Error ? error.message : 'Unknown coverage proof error',
        });
        return null;
      });
      if (!proof) continue;
      if (proof.version !== PIPELINE_PROOF_VERSION || !Array.isArray(proof.days)) continue;
      const empty = new Set(proof.emptyDays);
      for (const entry of proof.days) {
        if (quiet.has(entry.day) && chunk.includes(entry.day) && !entry.initialized && entry.accepted === 0 &&
          entry.version === PIPELINE_PROOF_VERSION && empty.has(entry.day)) verified.add(entry.day);
        const recorded = live.get(entry.day);
        if (recorded && entry.categories && isLiveProgressExact(recorded, entry, entry.day === openDay)) verified.add(entry.day);
      }
    }
  }
  return { verified, data };
}

async function readProof(stub: ReturnType<Env['COUNTERS_DO']['get']>, days: string[], verifyEmpty: boolean) {
  const response = await stub.fetch('https://do/pipeline-snapshots', {
    method: 'POST', body: JSON.stringify({ days, verifyEmpty }),
  });
  if (!response.ok) throw new Error(`Achievement coverage proof unavailable (HTTP ${response.status})`);
  return response.json<{ version: number; days: CountersDODayProofSnapshot[]; emptyDays?: string[] }>();
}

function typedRows<T>(result: D1Result<unknown>): T[] {
  return result.results as T[];
}

function closed(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < new Date().toISOString().slice(0, 10);
}

/** Read the owner's evidence for both closed-day scoring and the current-day preview. */
export async function readPersonalEvidence(env: Env, chat: number, owner: number, startDay: string,
  day: string, preview = false) {
  const start = [startDay, shiftDay(day, -41)].sort()[1];
  const since = [start, shiftDay(day, -27)].sort()[1];
  const { verified, data } = await snapshot(env, chat, daysBetween(start, day), [
    env.DB.prepare(`SELECT day,message_count AS messages,word_count AS words,voice_count AS voices,
      video_note_count AS videos FROM stats_daily_user WHERE chat_id=? AND user_id=? AND day BETWEEN ? AND ?`)
      .bind(chat, owner, start, day),
    env.DB.prepare(`SELECT day,bucket FROM stats_daily_bucket_user WHERE chat_id=? AND user_id=? AND day BETWEEN ? AND ?
      AND message_count>0`).bind(chat, owner, since, day),
    env.DB.prepare(`SELECT COUNT(DISTINCT day) AS days,COUNT(DISTINCT channel_id) AS channels
      FROM stats_forwards WHERE chat_id=? AND user_id=? AND day BETWEEN ? AND ? AND source_type='channel'`)
      .bind(chat, owner, since, day),
  ], day, true, preview ? day : undefined);
  const rows = typedRows<PersonalDay>(data[0]);
  const buckets = typedRows<Bucket>(data[1]);
  return {
    dayVerified: verified.has(day),
    rows: rows.filter(row => verified.has(row.day)),
    buckets: buckets.filter(row => verified.has(row.day)),
    // Reposts have their own deduplicated ledger and need no base coverage.
    forwards: typedRows<ForwardSummary>(data[2])[0],
  };
}

/** Evaluates a closed date, while excluding unknown activity days and pre-consent evidence. */
export async function evaluatePersonal(env: Env, chat: number, owner: number, day: string): Promise<void> {
  if (!closed(day) || owner <= 0) return;
  const [group, album] = await Promise.all([getGroup(env.DB, chat), getEnrollment(env.DB, chat, owner)]);
  if (!group?.enabled || !album?.enabled || day < album.start_day || (album.last_day && album.last_day >= day)) return;
  const { dayVerified, rows, buckets, forwards } = await readPersonalEvidence(env, chat, owner, album.start_day, day);
  // Hold the cursor while this date can still settle. A single permanently poisoned
  // date must not strand an album; after a week only independently verified facts count.
  if (!dayVerified && day >= shiftDay(new Date().toISOString().slice(0, 10), -7)) return;
  const scores = personalRules(rows, buckets, forwards, album.start_day, day);
  const guard = `EXISTS (SELECT 1 FROM achievement_enrollments e JOIN achievement_groups g USING(chat_id)
    WHERE e.chat_id=? AND e.user_id=? AND e.enabled=1 AND e.generation=? AND g.enabled=1 AND g.generation=?
    AND (e.last_day IS NULL OR e.last_day<?))`;
  const params = [chat, owner, album.generation, group.generation, day];
  const statements = scores.filter(s => s.earned).map(s => env.DB.prepare(`INSERT OR IGNORE INTO
    achievement_awards(chat_id,user_id,badge_id,earned_day,result) SELECT ?,?,?,?,? WHERE ${guard}`)
    .bind(chat, owner, s.id, day, s.result, ...params));
  statements.push(env.DB.prepare(`UPDATE achievement_enrollments SET last_day=?, progress_json=?
    WHERE chat_id=? AND user_id=? AND ${guard}`).bind(day, JSON.stringify(scores), chat, owner, ...params));
  await env.DB.batch(statements);
}

function weeklyBaseline(monday: string, hours: Hour[], verified: Set<string>): number | null {
  return daysBetween(shiftDay(monday, -28), shiftDay(monday, -1)).every(day => verified.has(day))
    ? Math.max(0, ...hours.filter(hour => hour.day < monday).map(hour => hour.count)) : null;
}

function weeklyEvidenceStatements(env: Env, chat: number, monday: string, end: string) {
  return [env.DB.prepare(GROUP_DAY_SQL).bind(chat, monday, end),
    env.DB.prepare(`SELECT day,hour,message_count AS count FROM stats_daily_hour
      WHERE chat_id=? AND day BETWEEN ? AND ?`).bind(chat, shiftDay(monday, -28), end)];
}

/** Score the verified prefix of the open week without publishing a report or persisting awards. */
export async function readWeeklyProgress(env: Env, chat: number, startDay: string, today: string) {
  const monday = mondayOf(today);
  const { verified, data } = await snapshot(env, chat, daysBetween(shiftDay(monday, -28), today), [
    ...weeklyEvidenceStatements(env, chat, monday, today),
    env.DB.prepare(`SELECT MIN(day) AS day FROM stats_daily_user
      WHERE chat_id=? AND day BETWEEN ? AND ? AND user_id>0 AND message_count>0 AND voice_count>0
      GROUP BY user_id`).bind(chat, monday, today),
  ], startDay, false, today);
  const week = daysBetween(monday, today);
  const gap = week.findIndex(day => !verified.has(day));
  const throughDay = gap === 0 ? null : gap === -1 ? today : week[gap - 1];
  const hours = typedRows<Hour>(data[1]);
  const baseline = weeklyBaseline(monday, hours, verified);
  if (!throughDay) return { throughDay, baselineKnown: baseline !== null, scores: [] };
  const rows = typedRows<GroupDay>(data[0]).filter(row => row.day <= throughDay);
  const singers = typedRows<{ day: string }>(data[2]).filter(row => row.day <= throughDay).length;
  const report = weeklyRules(monday, rows, hours.filter(row => row.day >= monday && row.day <= throughDay),
    0, singers, baseline);
  return { throughDay, baselineKnown: baseline !== null, scores: report.badges };
}

/** Creates an immutable weekly report and first unlocks together. Replays read the winning transaction. */
export async function evaluateWeek(env: Env, chat: number, monday: string): Promise<WeeklyReport | null> {
  if (!closed(monday) || mondayOf(monday) !== monday) return null;
  const end = shiftDay(monday, 6);
  if (!closed(end)) return null;
  const group = await getGroup(env.DB, chat);
  if (!group?.enabled || monday < group.start_day) return null;
  const stored = () => env.DB.prepare(`SELECT report_json FROM achievement_reports r JOIN achievement_groups g
    USING(chat_id) WHERE r.chat_id=? AND r.week=? AND g.enabled=1 AND g.generation=? AND state<>'cancelled'`)
    .bind(chat, monday, group.generation).first<string>('report_json');
  const existing = await stored();
  if (existing) return JSON.parse(existing);
  const start = shiftDay(monday, -28);
  const { verified, data } = await snapshot(env, chat, daysBetween(start, end), [
    ...weeklyEvidenceStatements(env, chat, monday, end),
    env.DB.prepare(`SELECT COUNT(DISTINCT user_id) AS authors,
      COUNT(DISTINCT CASE WHEN voice_count>0 THEN user_id END) AS singers FROM stats_daily_user
      WHERE chat_id=? AND user_id>0 AND message_count>0 AND day BETWEEN ? AND ?`).bind(chat, monday, end),
  ], group.start_day);
  if (daysBetween(monday, end).some(d => !verified.has(d))) return null;
  const hours = typedRows<Hour>(data[1]);
  const baseline = weeklyBaseline(monday, hours, verified);
  const { authors, singers } = typedRows<{ authors: number; singers: number }>(data[2])[0];
  const report = weeklyRules(monday, typedRows<GroupDay>(data[0]), hours.filter(h => h.day >= monday), authors, singers, baseline);
  report.badges = report.badges.filter(s => s.earned);
  const guard = 'EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1 AND generation=?)';
  const statements = report.badges.map(s => env.DB.prepare(`INSERT OR IGNORE INTO achievement_awards
    (chat_id,user_id,badge_id,earned_day,result) SELECT ?,0,?,?,? WHERE ${guard}`).bind(chat, s.id, end, s.result, chat, group.generation));
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO achievement_reports(chat_id,week,state,report_json)
    SELECT ?,?,?,json_set(?, '$.badges', json(COALESCE((
      SELECT json_group_array(json(value)) FROM (
      SELECT b.value FROM json_each(?) b JOIN achievement_awards a
      ON a.chat_id=? AND a.user_id=0 AND a.earned_day=? AND a.badge_id=json_extract(b.value,'$.id')
      ORDER BY b.key)
    ),'[]'))) WHERE ${guard}`).bind(chat, monday, report.messages ? 'ready' : 'silent', JSON.stringify(report), JSON.stringify(report.badges), chat, end, chat, group.generation));
  await env.DB.batch(statements);
  const saved = await stored();
  return saved ? JSON.parse(saved) : null;
}
