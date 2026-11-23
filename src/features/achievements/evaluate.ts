import { GROUP_DAY_SQL } from './queries';
import type { D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type { Env } from '../../core/env';
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
  observedFrom: string, personal = false) {
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
  for (const [day, readiness] of interpretIndividualReadiness(evidence, needed)) {
    if (readiness.kind !== 'final') continue;
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
      const response = await stub.fetch('https://do/pipeline-snapshots', {
        method: 'POST', body: JSON.stringify({ days: chunk, verifyEmpty: chunk.some(d => quiet.has(d)) }),
      });
      if (!response.ok) throw new Error('Achievement coverage proof unavailable');
      const proof = await response.json<{ version: number; days: CountersDODayProofSnapshot[]; emptyDays?: string[] }>();
      if (proof.version !== PIPELINE_PROOF_VERSION || !Array.isArray(proof.days)) continue;
      const empty = new Set(proof.emptyDays);
      for (const entry of proof.days) {
        if (quiet.has(entry.day) && chunk.includes(entry.day) && !entry.initialized && entry.accepted === 0 &&
          entry.version === PIPELINE_PROOF_VERSION && empty.has(entry.day)) verified.add(entry.day);
        const recorded = live.get(entry.day);
        if (recorded && entry.categories && isLiveProgressExact(recorded, entry)) verified.add(entry.day);
      }
    }
  }
  return { verified, data };
}

function typedRows<T>(result: D1Result<unknown>): T[] {
  return result.results as T[];
}

function closed(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < new Date().toISOString().slice(0, 10);
}

/** Evaluates a closed date, while excluding unknown activity days and pre-consent evidence. */
export async function evaluatePersonal(env: Env, chat: number, owner: number, day: string): Promise<void> {
  if (!closed(day) || owner <= 0) return;
  const [group, album] = await Promise.all([getGroup(env.DB, chat), getEnrollment(env.DB, chat, owner)]);
  if (!group?.enabled || !album?.enabled || day < album.start_day || (album.last_day && album.last_day >= day)) return;
  const start = [album.start_day, shiftDay(day, -41)].sort()[1];
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
  ], day, true);
  // Hold the cursor while this date can still settle. A single permanently poisoned
  // date must not strand an album; after a week only independently verified facts count.
  if (!verified.has(day) && day >= shiftDay(new Date().toISOString().slice(0, 10), -7)) return;
  // Reposts have their own deduplicated message ledger; a forward-only date need not have base coverage.
  const scores = personalRules(typedRows<PersonalDay>(data[0]).filter(r => verified.has(r.day)),
    typedRows<Bucket>(data[1]).filter(r => verified.has(r.day)), typedRows<ForwardSummary>(data[2])[0],
    album.start_day, day);
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
    env.DB.prepare(GROUP_DAY_SQL).bind(chat, monday, end),
    env.DB.prepare(`SELECT day,hour,message_count AS count FROM stats_daily_hour
      WHERE chat_id=? AND day BETWEEN ? AND ?`).bind(chat, start, end),
    env.DB.prepare(`SELECT COUNT(DISTINCT user_id) AS authors,
      COUNT(DISTINCT CASE WHEN voice_count>0 THEN user_id END) AS singers FROM stats_daily_user
      WHERE chat_id=? AND user_id>0 AND message_count>0 AND day BETWEEN ? AND ?`).bind(chat, monday, end),
  ], group.start_day);
  if (daysBetween(monday, end).some(d => !verified.has(d))) return null;
  const hours = typedRows<Hour>(data[1]);
  const baseline = daysBetween(start, shiftDay(monday, -1)).every(d => verified.has(d))
    ? Math.max(0, ...hours.filter(h => h.day < monday).map(h => h.count)) : null;
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
