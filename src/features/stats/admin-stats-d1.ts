import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';
import type {
  AdminChatStats,
  AdminDateRange,
  AdminPeriod,
  AdminUserCount,
} from '../../api/admin-stats';
import { PROFANITY_RATE_MIN_WORDS } from './stats';
import { AdminUnavailable } from './admin-stats-errors';
import {
  addSentenceTotals,
  calculateSentenceFromViolationCount,
} from '../criminal/sentence-calculator';
import {
  createD1RangeReadinessQueryPlan,
  isD1RangeReadyFromResults,
} from './d1-coverage';

/**
 * D1 aggregate reader for `/admin/api/chat`. Reads only `DB`; never touches
 * `COUNTERS` (KV). Query shape is constant: one bounded aggregate query per
 * source table plus, for preset periods only, a single bounded
 * `criminal_violations` sentence query. No per-day/per-user operations, no raw
 * messages, no KV scan/prefix.
 */

const BUCKETS = [
  { bucket: 'morning', label: 'Утро' },
  { bucket: 'noon', label: 'День' },
  { bucket: 'evening', label: 'Вечер' },
  { bucket: 'night', label: 'Ночь' },
] as const;

type BucketName = (typeof BUCKETS)[number]['bucket'];

/** Participant timeline renders night first; activity timeBuckets render morning first. */
const TIMELINE_BUCKETS: Array<{ bucket: BucketName; label: string }> = [
  { bucket: 'night', label: 'Ночь' },
  { bucket: 'morning', label: 'Утро' },
  { bucket: 'noon', label: 'День' },
  { bucket: 'evening', label: 'Вечер' },
];

type TimelineLevel = 'inactive' | 'active' | 'talkative';

const MAX_PARTICIPANTS = 12;
const TOP_LIMIT = 10;
const BUCKET_TOP_LIMIT = 5;
const HOURS_PER_DAY = 24;

interface User {
  user_id: number;
  message_count: number;
  word_count: number;
  voice_count: number;
  voice_duration_seconds: number;
  video_note_count: number;
  video_note_duration_seconds: number;
  profanity_count: number;
  criminal_count: number;
  active_days: number;
  last_message_ts: number | null;
  username: string | null;
}

interface DayRow {
  day: string;
  count: number;
  active: number;
}

interface HourRow {
  hour: number;
  count: number;
}

interface DayUserRow {
  day: string;
  user_id: number;
  count: number;
}

interface BucketUserRow {
  day: string;
  bucket: string;
  user_id: number;
  count: number;
  username: string | null;
  last_message_ts: number | null;
}

interface WordRow {
  word: string;
  count: number;
}

interface WordUserRow {
  word: string;
  user_id: number;
  count: number;
  username: string | null;
}

interface CriminalSentenceRow {
  user_id: number;
  article: string;
  subarticle: string | null;
  article_title: string | null;
  punishment: string | null;
  count: number;
  average_severity: number;
}

interface AdminStatsD1ResultIndexes {
  users: number;
  daily: number;
  hours: number;
  dailyUser: number;
  bucket: number;
  word: number;
  wordUser: number;
  criminalSentence?: number;
}

interface AdminStatsD1QueryPlan {
  statements: D1PreparedStatement[];
  indexes: AdminStatsD1ResultIndexes;
}

interface ReadyAdminStatsD1QueryPlan extends AdminStatsD1QueryPlan {
  readinessResultCount: number;
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** Mirrors the legacy preset sentence window (`criminalPeriodToDays`). */
function criminalPeriodToDays(period: AdminPeriod): number {
  if (period === 'week') return 7;
  if (period === 'month') return 30;
  return 1;
}

/**
 * Preset-only sentence top users from `criminal_violations`, matching the
 * legacy `getTopCriminalUsersBySentence` repository semantics (period window,
 * article-group sentence aggregation, life/totalYears sort). Never reads KV.
 */
function mapCriminalSentenceUsers(
  rows: CriminalSentenceRow[],
): Array<{ userId: number; count: number; totalYears: number; lifeSentences: number }> {
  const perUser = new Map<
    number,
    { userId: number; count: number; totalYears: number; lifeSentences: number }
  >();
  for (const row of rows) {
    const count = Number(row.count) || 0;
    const sentence = calculateSentenceFromViolationCount({
      article: row.article,
      subarticle: row.subarticle,
      articleTitle: row.article_title || '',
      punishment: row.punishment || '',
      count,
      averageSeverity: Number(row.average_severity) || 0,
    });
    const existing = perUser.get(row.user_id) ?? {
      userId: row.user_id,
      count: 0,
      totalYears: 0,
      lifeSentences: 0,
    };
    perUser.set(row.user_id, {
      userId: row.user_id,
      count: existing.count + count,
      ...addSentenceTotals(
        { totalYears: existing.totalYears, lifeSentences: existing.lifeSentences },
        sentence,
      ),
    });
  }

  return [...perUser.values()]
    .sort(
      (a, b) =>
        b.lifeSentences - a.lifeSentences || b.totalYears - a.totalYears || b.count - a.count,
    )
    .slice(0, TOP_LIMIT);
}

/** Builds all bounded aggregate/profile/criminal statements for an admin response. */
function createAdminStatsD1QueryPlan(
  db: D1Database,
  chatId: number,
  range: AdminDateRange,
): AdminStatsD1QueryPlan {
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `SELECT u.user_id,
                SUM(u.message_count) AS message_count,
                SUM(u.word_count) AS word_count,
                SUM(u.voice_count) AS voice_count,
                SUM(u.voice_duration_seconds) AS voice_duration_seconds,
                SUM(u.video_note_count) AS video_note_count,
                SUM(u.video_note_duration_seconds) AS video_note_duration_seconds,
                SUM(u.profanity_count) AS profanity_count,
                SUM(u.criminal_count) AS criminal_count,
                 COUNT(CASE WHEN u.message_count > 0 THEN 1 END) AS active_days,
                 MAX(p.last_message_ts) AS last_message_ts,
                 p.username
         FROM stats_daily_user u
         LEFT JOIN stats_chat_user_profile p
           ON p.chat_id = u.chat_id AND p.user_id = u.user_id
         WHERE u.chat_id = ? AND u.day >= ? AND u.day <= ?
         GROUP BY u.user_id, p.username`,
      )
      .bind(chatId, range.from, range.to),
    db
      .prepare(
        `SELECT day, SUM(message_count) AS count,
                COUNT(CASE WHEN message_count > 0 THEN 1 END) AS active
         FROM stats_daily_user
         WHERE chat_id = ? AND day >= ? AND day <= ?
         GROUP BY day`,
      )
      .bind(chatId, range.from, range.to),
    db
      .prepare(
        `SELECT hour, SUM(message_count) AS count
         FROM stats_daily_hour
         WHERE chat_id = ? AND day >= ? AND day <= ?
         GROUP BY hour`,
      )
      .bind(chatId, range.from, range.to),
    db
      .prepare(
        `SELECT day, user_id, SUM(message_count) AS count
         FROM stats_daily_user
         WHERE chat_id = ? AND day >= ? AND day <= ?
         GROUP BY day, user_id`,
      )
      .bind(chatId, range.from, range.to),
    db
      .prepare(
        `SELECT b.day, b.bucket, b.user_id, SUM(b.message_count) AS count,
                p.username, p.last_message_ts
         FROM stats_daily_bucket_user b
         LEFT JOIN stats_chat_user_profile p
           ON p.chat_id = b.chat_id AND p.user_id = b.user_id
         WHERE b.chat_id = ? AND b.day >= ? AND b.day <= ?
         GROUP BY b.day, b.bucket, b.user_id, p.username, p.last_message_ts`,
      )
      .bind(chatId, range.from, range.to),
    db
      .prepare(
        `SELECT word, SUM(count) AS count
         FROM stats_daily_profanity_word
         WHERE chat_id = ? AND day >= ? AND day <= ?
         GROUP BY word`,
      )
      .bind(chatId, range.from, range.to),
    db
      .prepare(
        `SELECT w.word, w.user_id, SUM(w.count) AS count, p.username
         FROM stats_daily_profanity_word_user w
         LEFT JOIN stats_chat_user_profile p
           ON p.chat_id = w.chat_id AND p.user_id = w.user_id
         WHERE w.chat_id = ? AND w.day >= ? AND w.day <= ?
         GROUP BY w.word, w.user_id, p.username`,
      )
      .bind(chatId, range.from, range.to),
  ];
  const indexes: AdminStatsD1ResultIndexes = {
    users: 0,
    daily: 1,
    hours: 2,
    dailyUser: 3,
    bucket: 4,
    word: 5,
    wordUser: 6,
  };

  if (range.period !== 'custom') {
    indexes.criminalSentence = statements.length;
    statements.push(
      db
        .prepare(
          `SELECT user_id, article, subarticle, article_title, punishment,
                  COUNT(*) AS count, AVG(severity) AS average_severity
           FROM criminal_violations
           WHERE chat_id = ? AND created_at >= datetime('now', ?)
           GROUP BY user_id, article, subarticle, article_title, punishment`,
        )
        .bind(chatId, `-${criminalPeriodToDays(range.period)} days`),
    );
  }

  return { statements, indexes };
}

/** Builds all readiness and response statements for one atomic candidate read. */
function createReadyAdminStatsD1QueryPlan(
  db: D1Database,
  chatId: number,
  range: AdminDateRange,
): ReadyAdminStatsD1QueryPlan {
  const readiness = createD1RangeReadinessQueryPlan(db, chatId, range.days);
  const stats = createAdminStatsD1QueryPlan(db, chatId, range);
  const offset = readiness.statements.length;
  return {
    statements: [...readiness.statements, ...stats.statements],
    readinessResultCount: offset,
    indexes: {
      users: stats.indexes.users + offset,
      daily: stats.indexes.daily + offset,
      hours: stats.indexes.hours + offset,
      dailyUser: stats.indexes.dailyUser + offset,
      bucket: stats.indexes.bucket + offset,
      word: stats.indexes.word + offset,
      wordUser: stats.indexes.wordUser + offset,
      ...(stats.indexes.criminalSentence === undefined
        ? {}
        : { criminalSentence: stats.indexes.criminalSentence + offset }),
    },
  };
}

/** Bounded aggregate reader. It deliberately never reads COUNTERS. */
export async function getAdminChatStatsFromD1(
  db: D1Database,
  chatId: number,
  range: AdminDateRange,
): Promise<AdminChatStats> {
  const plan = createAdminStatsD1QueryPlan(db, chatId, range);
  const results = await db.batch(plan.statements);
  return mapAdminChatStatsFromD1Results(chatId, range, results, plan.indexes);
}

/**
 * Reads readiness and every response input from one D1 batch snapshot. A false
 * result means callers must use their existing not-ready handling, never data
 * from this candidate batch.
 */
export async function getReadyAdminChatStatsFromD1(
  db: D1Database,
  chatId: number,
  range: AdminDateRange,
): Promise<AdminChatStats | null> {
  const plan = createReadyAdminStatsD1QueryPlan(db, chatId, range);
  const results = await db.batch(plan.statements);
  if (!isD1RangeReadyFromResults(results.slice(0, plan.readinessResultCount), range.days)) {
    return null;
  }
  return mapAdminChatStatsFromD1Results(chatId, range, results, plan.indexes);
}

function resultRows<T>(results: readonly D1Result<unknown>[], index: number): T[] {
  return ((results[index] as D1Result<T> | undefined)?.results ?? []);
}

/** Maps completed D1 results. It never performs D1 I/O. */
function mapAdminChatStatsFromD1Results(
  chatId: number,
  range: AdminDateRange,
  results: readonly D1Result<unknown>[],
  indexes: AdminStatsD1ResultIndexes,
): AdminChatStats {
  const users = resultRows<User>(results, indexes.users);
  const dailyRows = resultRows<DayRow>(results, indexes.daily);
  const hours = resultRows<HourRow>(results, indexes.hours);
  const dailyUsers = resultRows<DayUserRow>(results, indexes.dailyUser);
  const buckets = resultRows<BucketUserRow>(results, indexes.bucket);
  const words = resultRows<WordRow>(results, indexes.word);
  const wordUsers = resultRows<WordUserRow>(results, indexes.wordUser);
  const criminalSentenceRows = indexes.criminalSentence === undefined
    ? []
    : resultRows<CriminalSentenceRow>(results, indexes.criminalSentence);
  const byId = new Map<number, User>(users.map((user) => [user.user_id, user]));
  const wordUsernames = new Map<number, string>();
  for (const contributor of wordUsers) {
    if (contributor.username) wordUsernames.set(contributor.user_id, contributor.username);
  }

  // Legacy activity counts come only from `stats_v2` (message activity). A
  // zero-message category/orphan daily row (profanity/criminal only) must not
  // become an activity user, participant, or activity leaderboard entry, but it
  // must still surface in the independent profanity/criminal rankings below.
  const activityUsers = users.filter((user) => user.message_count > 0);

  const nameOf = (id: number): string =>
    byId.get(id)?.username ?? wordUsernames.get(id) ?? `id${id}`;

  const mapUser = (user: User, count = user.message_count): AdminUserCount => ({
    userId: String(user.user_id),
    username: user.username ?? `id${user.user_id}`,
    count,
    words: user.word_count,
    wordsPerMessage: user.message_count > 0 ? round1(user.word_count / user.message_count) : 0,
    voiceCount: user.voice_count,
    voiceMinutes: round1(user.voice_duration_seconds / 60),
    videoNoteCount: user.video_note_count,
    videoNoteMinutes: round1(user.video_note_duration_seconds / 60),
    activeDays: user.active_days,
    lastMessageTs: user.last_message_ts || null,
  });

  const bucketProfiles = new Map<number, Pick<BucketUserRow, 'username' | 'last_message_ts'>>();
  for (const row of buckets) {
    bucketProfiles.set(row.user_id, row);
  }

  const mapBucketUser = (id: number, count: number): AdminUserCount => {
    const user = byId.get(id);
    if (user) return mapUser(user, count);

    const profile = bucketProfiles.get(id);
    return {
      userId: String(id),
      username: profile?.username ?? `id${id}`,
      count,
      words: 0,
      wordsPerMessage: 0,
      voiceCount: 0,
      voiceMinutes: 0,
      videoNoteCount: 0,
      videoNoteMinutes: 0,
      activeDays: 0,
      lastMessageTs: profile?.last_message_ts || null,
    };
  };

  const dayRows = new Map<string, DayRow>(dailyRows.map((row) => [row.day, row]));
  const hourRows = new Map<number, number>(
    hours.map((row) => [row.hour, row.count]),
  );

  // Participant timeline inputs: per-day-per-user and per-day-per-bucket-per-user.
  const dayUserCounts = new Map<string, number>();
  for (const row of dailyUsers) {
    dayUserCounts.set(`${row.day}|${row.user_id}`, row.count);
  }
  const bucketUserCounts = new Map<string, number>();
  const bucketTotals = new Map<string, Map<number, number>>();
  for (const row of buckets) {
    bucketUserCounts.set(`${row.day}|${row.bucket}|${row.user_id}`, row.count);
    let totals = bucketTotals.get(row.bucket);
    if (!totals) {
      totals = new Map();
      bucketTotals.set(row.bucket, totals);
    }
    totals.set(row.user_id, (totals.get(row.user_id) ?? 0) + row.count);
  }

  const total = activityUsers.reduce((sum, user) => sum + user.message_count, 0);
  const totalWords = activityUsers.reduce((sum, user) => sum + user.word_count, 0);
  const totalVoiceCount = activityUsers.reduce((sum, user) => sum + user.voice_count, 0);
  const totalVoiceSeconds = activityUsers.reduce((sum, user) => sum + user.voice_duration_seconds, 0);
  const totalVideoNoteCount = activityUsers.reduce((sum, user) => sum + user.video_note_count, 0);
  const totalVideoNoteSeconds = activityUsers.reduce(
    (sum, user) => sum + user.video_note_duration_seconds,
    0,
  );
  const dayCount = range.days.length;

  const byIdAsc = (a: User, b: User): number => a.user_id - b.user_id;

  const topUsers = [...activityUsers]
    .sort((a, b) => b.message_count - a.message_count || byIdAsc(a, b))
    .slice(0, TOP_LIMIT);
  const topTalkers = [...activityUsers]
    .sort(
      (a, b) => b.word_count - a.word_count || b.message_count - a.message_count || byIdAsc(a, b),
    )
    .slice(0, TOP_LIMIT);
  const topVoiceUsers = activityUsers
    .filter((user) => user.voice_count > 0)
    .sort(
      (a, b) =>
        b.voice_duration_seconds - a.voice_duration_seconds ||
        b.voice_count - a.voice_count ||
        byIdAsc(a, b),
    )
    .slice(0, TOP_LIMIT);
  const topVideoNoteUsers = activityUsers
    .filter((user) => user.video_note_count > 0)
    .sort(
      (a, b) =>
        b.video_note_duration_seconds - a.video_note_duration_seconds ||
        b.video_note_count - a.video_note_count ||
        byIdAsc(a, b),
    )
    .slice(0, TOP_LIMIT);

  const participants = activityUsers
    .filter((user) => user.active_days > 0)
    .sort(
      (a, b) =>
        b.active_days - a.active_days ||
        b.message_count - a.message_count ||
        String(a.user_id).localeCompare(String(b.user_id)),
    )
    .slice(0, MAX_PARTICIPANTS);

  const participantTimeline: AdminChatStats['activity']['participantTimeline'] = {
    timeZone: 'UTC',
    timeBuckets: TIMELINE_BUCKETS,
    participants: participants.map((user, index) => {
      const talkativeThreshold = Math.max(2, Math.ceil(user.message_count / user.active_days));
      const username =
        user.username && user.username !== `id${user.user_id}`
          ? user.username
          : `Участник ${index + 1}`;

      return {
        username,
        dailyLevels: range.days.map((day) => {
          const count = dayUserCounts.get(`${day}|${user.user_id}`) ?? 0;
          const level: TimelineLevel =
            count === 0 ? 'inactive' : count >= talkativeThreshold ? 'talkative' : 'active';
          return {
            day,
            level,
            timeBucketLevels: TIMELINE_BUCKETS.map(({ bucket }) => {
              const bucketCount = bucketUserCounts.get(`${day}|${bucket}|${user.user_id}`) ?? 0;
              return {
                bucket,
                level:
                  bucketCount === 0
                    ? 'inactive'
                    : bucketCount >= talkativeThreshold
                      ? 'talkative'
                      : 'active',
              };
            }),
          };
        }),
      };
    }),
  };

  const timeBuckets = BUCKETS.map(({ bucket, label }) => ({
    bucket,
    label,
    topUsers: [...(bucketTotals.get(bucket) ?? new Map<number, number>())]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, BUCKET_TOP_LIMIT)
      .map(([id, count]) => mapBucketUser(id, count)),
  }));

  const profanityTopUsers = users
    .filter((user) => user.profanity_count > 0)
    .sort((a, b) => b.profanity_count - a.profanity_count || byIdAsc(a, b))
    .slice(0, TOP_LIMIT)
    .map((user) => ({ userId: user.user_id, username: nameOf(user.user_id), count: user.profanity_count }));

  const topRateUsers = users
    .filter((user) => user.profanity_count > 0 && user.word_count >= PROFANITY_RATE_MIN_WORDS)
    .map((user) => ({
      userId: user.user_id,
      username: nameOf(user.user_id),
      profanityCount: user.profanity_count,
      wordCount: user.word_count,
      rate: (user.profanity_count / user.word_count) * 100,
    }))
    .sort(
      (a, b) =>
        b.rate - a.rate || b.profanityCount - a.profanityCount || b.wordCount - a.wordCount,
    )
    .slice(0, TOP_LIMIT);

  const topWords = [...words]
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, TOP_LIMIT)
    .map((word) => ({
      word: word.word,
      count: word.count,
      contributors: wordUsers
        .filter((contributor) => contributor.word === word.word)
        .sort((a, b) => b.count - a.count || a.user_id - b.user_id)
        .slice(0, TOP_LIMIT)
        .map((contributor) => ({
          userId: contributor.user_id,
          username: nameOf(contributor.user_id),
          count: contributor.count,
        })),
    }));

  let criminalTopUsers: AdminChatStats['criminal']['topUsers'];
  if (range.period === 'custom') {
    criminalTopUsers = users
      .filter((user) => user.criminal_count > 0)
      .sort((a, b) => b.criminal_count - a.criminal_count || byIdAsc(a, b))
      .slice(0, TOP_LIMIT)
      .map((user) => ({
        userId: user.user_id,
        username: nameOf(user.user_id),
        count: user.criminal_count,
      }));
  } else {
    const sentenceUsers = mapCriminalSentenceUsers(criminalSentenceRows);
    if (sentenceUsers.length > 0) {
      criminalTopUsers = sentenceUsers.map((user) => ({
        userId: user.userId,
        username: nameOf(user.userId),
        count: user.count,
        totalYears: user.totalYears,
        lifeSentences: user.lifeSentences,
      }));
    } else {
      const totalCriminal = users.reduce((sum, user) => sum + user.criminal_count, 0);
      if (totalCriminal > 0) {
        // Legacy would fall back to KV count-only here; D1 must not, so surface a
        // safe unavailable instead of silently changing the sentence schema.
        throw new AdminUnavailable();
      }
      criminalTopUsers = [];
    }
  }

  return {
    chatId,
    period: range.period,
    range: { from: range.from, to: range.to, days: dayCount },
    activity: {
      total,
      totalWords,
      wordsPerMessage: total > 0 ? round1(totalWords / total) : 0,
      totalVoiceCount,
      totalVoiceMinutes: round1(totalVoiceSeconds / 60),
      totalVideoNoteCount,
      totalVideoNoteMinutes: round1(totalVideoNoteSeconds / 60),
      activeUsers: activityUsers.length,
      averageDailyMessages: round1(total / dayCount),
      averageDailyActiveUsers: round1(
        range.days.reduce((sum, day) => sum + (dayRows.get(day)?.active ?? 0), 0) / dayCount,
      ),
      averageHourlyMessages: round2(total / (dayCount * HOURS_PER_DAY)),
      topUsers: topUsers.map(mapUser),
      topTalkers: topTalkers.map(mapUser),
      topVoiceUsers: topVoiceUsers.map(mapUser),
      topVideoNoteUsers: topVideoNoteUsers.map(mapUser),
      dailyMessages: range.days.map((day) => ({ day, count: dayRows.get(day)?.count ?? 0 })),
      dailyActiveUsers: range.days.map((day) => ({ day, count: dayRows.get(day)?.active ?? 0 })),
      hourlyAverages: Array.from({ length: HOURS_PER_DAY }, (_, hour) => ({
        hour: String(hour).padStart(2, '0'),
        count: round2((hourRows.get(hour) ?? 0) / dayCount),
      })),
      participantTimeline,
      timeBuckets,
    },
    profanity: {
      topUsers: profanityTopUsers,
      topRateUsers,
      topWords,
    },
    criminal: {
      topUsers: criminalTopUsers,
    },
  };
}
