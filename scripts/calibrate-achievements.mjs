/**
 * Usage: node --experimental-strip-types scripts/calibrate-achievements.mjs SNAPSHOT.sqlite FROM TO
 * Opens a local, migrated D1 SQLite snapshot read-only. Reports only anonymous cohorts.
 */
import Database from 'better-sqlite3';
import { JOB_VERSION } from '../src/features/stats/daily-backfill.ts';
import { GROUP_DAY_SQL } from '../src/features/achievements/queries.ts';
import {
  PERSONAL_BADGES, GROUP_BADGES, personalRules, weeklyRules, daysBetween, shiftDay,
  mondayOf
} from '../src/features/achievements/rules.ts';

const [path, first, last] = process.argv.slice(2);
const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && shiftDay(value, 0) === value;
if (!path || !isDay(first) || !isDay(last) || first > last || last > shiftDay(first, 179)
  || last >= new Date().toISOString().slice(0, 10)) {
  throw new Error('Usage: node --experimental-strip-types scripts/calibrate-achievements.mjs SNAPSHOT.sqlite FROM TO (1–180 closed UTC days)');
}
const db = new Database(path, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

function counts() {
  return new Map([...PERSONAL_BADGES, ...GROUP_BADGES].map(b => [b.id, { eligible: 0, unlocked: 0, delays: [] }]));
}
function cohort(size) {
  return size < 6 ? '1–5' : size < 21 ? '6–20' : '21+';
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize() {
  const state = db.prepare("SELECT version,status,cutoff_day FROM stats_backfill_state WHERE job_name='daily_aggregates_v1'").get();
  const result = {
    observationStart: first, observationEnd: last, groupCount: 0, skippedUnverifiedGroups: 0,
    unavailableGroupWeeks: 0, excludedPartialPersonalGroups: 0, cohorts: {}
  };
  const samples = new Map();
  const historyStart = shiftDay(first, -28);
  const firstActivity = db.prepare('SELECT MIN(day) AS day FROM stats_daily_user WHERE chat_id=?');
  const traceTables = [
    'stats_daily_coverage', 'stats_daily_pipeline_progress', 'activity', 'stats_daily_user',
    'stats_daily_hour', 'stats_daily_bucket_user', 'stats_daily_profanity_word', 'stats_daily_profanity_word_user',
  ];
  const traceQueries = traceTables.map(table => db.prepare(
    'SELECT DISTINCT day FROM ' + table + ' WHERE chat_id=? AND day BETWEEN ? AND ?'
  ));
  const candidates = db.prepare('SELECT DISTINCT chat_id FROM stats_daily_user WHERE chat_id<0 AND day BETWEEN ? AND ?');
  const ready = db.prepare(`SELECT day FROM stats_daily_coverage WHERE chat_id=? AND day BETWEEN ? AND ?
    AND source='backfill' AND base_status='complete' AND profanity_status='complete' AND criminal_status='complete'
    AND reason_code IS NULL`);
  const allRows = db.prepare(`SELECT user_id,day,message_count AS messages,word_count AS words,voice_count AS voices,
    video_note_count AS videos FROM stats_daily_user WHERE chat_id=? AND day BETWEEN ? AND ? AND user_id>0`);
  const groupDays = db.prepare(GROUP_DAY_SQL);
  const groupHours = db.prepare('SELECT day,hour,message_count AS count FROM stats_daily_hour WHERE chat_id=? AND day BETWEEN ? AND ?');
  const userBuckets = db.prepare('SELECT day,bucket FROM stats_daily_bucket_user WHERE chat_id=? AND user_id=? AND day BETWEEN ? AND ? AND message_count>0');
  const userForwards = db.prepare(`SELECT COUNT(DISTINCT day) days,COUNT(DISTINCT channel_id) channels FROM stats_forwards
    WHERE chat_id=? AND user_id=? AND day BETWEEN ? AND ? AND source_type='channel'`);
  for (const { chat_id: chat } of candidates.all(first, last)) {
    const verified = new Set(state?.version === JOB_VERSION && state.status === 'done'
      ? ready.all(chat, historyStart, last).map(r => r.day) : []);
    // Match the Worker's historical empty-day guarantee. Live dates require a
    // contemporaneous DO proof unavailable to an offline snapshot.
    if (state?.version === JOB_VERSION && state.status === 'done') {
      const traces = new Set(traceQueries.flatMap(query => query.all(chat, historyStart, last).map(r => r.day)));
      const earliest = firstActivity.get(chat)?.day;
      for (const day of daysBetween(historyStart, last)) {
        if (earliest && day >= earliest && day < state.cutoff_day && !traces.has(day)) verified.add(day);
      }
    }
    const rows = allRows.all(chat, first, last).filter(r => verified.has(r.day));
    if (!rows.length) { result.skippedUnverifiedGroups++; continue; }
    result.groupCount++;
    const authors = new Set(rows.filter(r => r.messages > 0).map(r => r.user_id));
    const key = cohort(authors.size);
    if (!samples.has(key)) samples.set(key, { metrics: counts(), groups: 0, participants: 0, firstUnlock: [], quietParticipants: 0, quietWithUnlock: 0, multiShelf: 0 });
    const sample = samples.get(key);
    sample.groups++;
    const days = daysBetween(first, last);
    // A missing day could hide a qualifying action. Exclude the personal cohort
    // rather than turning uncertain observation into an apparent low unlock rate.
    const completeObservation = days.every(date => verified.has(date));
    if (!completeObservation) result.excludedPartialPersonalGroups++;
    for (const owner of completeObservation ? authors : []) {
      sample.participants++;
      const own = rows.filter(r => r.user_id === owner);
      const buckets = userBuckets.all(chat, owner, first, last).filter(r => verified.has(r.day));
      const unlocked = new Set();
      for (const b of PERSONAL_BADGES) sample.metrics.get(b.id).eligible++;
      for (const [i, day] of days.entries()) {
        const from = shiftDay(day, -41);
        const scores = personalRules(own.filter(r => r.day >= from && r.day <= day),
          buckets.filter(r => r.day <= day), userForwards.get(chat, owner, first > shiftDay(day, -27) ? first : shiftDay(day, -27), day), first, day);
        for (const s of scores) if (s.earned && !unlocked.has(s.id)) {
          if (!unlocked.size) sample.firstUnlock.push(i + 1);
          unlocked.add(s.id);
          const metric = sample.metrics.get(s.id);
          metric.unlocked++;
          metric.delays.push(i + 1);
        }
      }
      const shelf = id => ['tomorrow', 'regular', 'calendar'].includes(id) ? 'rhythm' :
        ['columnist', 'night-shift', 'three-shifts'].includes(id) ? 'style' : 'formats';
      if (new Set([...unlocked].map(shelf)).size >= 2) sample.multiShelf++;
      if (own.filter(r => r.messages > 0).length * 7 / days.length <= 2) {
        sample.quietParticipants++;
        if (unlocked.size) sample.quietWithUnlock++;
      }
    }
    const weeksEligible = new Set(), weeksAwarded = new Set();
    for (const start of days.filter(d => mondayOf(d) === d && shiftDay(d, 6) <= last)) {
      const end = shiftDay(start, 6), earlier = shiftDay(start, -28);
      if (!daysBetween(start, end).every(d => verified.has(d))) { result.unavailableGroupWeeks++; continue; }
      const hours = groupHours.all(chat, earlier, end);
      const baseline = daysBetween(earlier, shiftDay(start, -1)).every(d => verified.has(d))
        ? Math.max(0, ...hours.filter(h => h.day < start).map(h => h.count)) : null;
      const week = rows.filter(r => r.day >= start && r.day <= end);
      const report = weeklyRules(start, groupDays.all(chat, start, end), hours.filter(h => h.day >= start),
        new Set(week.filter(r => r.messages > 0).map(r => r.user_id)).size, new Set(week.filter(r => r.voices > 0).map(r => r.user_id)).size, baseline);
      for (const s of report.badges) {
        if (s.id === 'rush-hour' && baseline === null) continue;
        weeksEligible.add(s.id);
        if (s.earned && !weeksAwarded.has(s.id)) {
          weeksAwarded.add(s.id);
          const metric = sample.metrics.get(s.id);
          metric.unlocked++;
          metric.delays.push(days.indexOf(end) + 1);
        }
      }
    }
    for (const id of weeksEligible) sample.metrics.get(id).eligible++;
  }
  for (const [key, s] of samples) {
    result.cohorts[key] = {
      groups: s.groups, participants: s.participants, medianDaysToFirstPersonalUnlock: median(s.firstUnlock),
      quietParticipants: s.quietParticipants, quietWithUnlock: s.quietWithUnlock, participantsWithTwoShelves: s.multiShelf,
      badges: Object.fromEntries([...s.metrics].map(([id, m]) => [id, {
        eligible: m.eligible, unlocked: m.unlocked,
        fraction: m.eligible ? m.unlocked / m.eligible : null, medianDaysToUnlock: median(m.delays)
      }]))
    };
  }
  return result;
}
try {
  console.info(JSON.stringify(db.transaction(summarize)(), null, 2));
} finally {
  db.close();
}
