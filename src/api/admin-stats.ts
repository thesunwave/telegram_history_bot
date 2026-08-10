import type { Env } from '../core/env';
import {
  getTopCriminalUsers,
  getTopCriminalUsersBySentence,
  getTopProfanityRateUsers,
  getTopProfanityUsers,
  getTopProfanityWords,
  PROFANITY_RATE_MIN_WORDS,
} from '../features/stats/stats';

export type AdminPeriod = 'today' | 'week' | 'month' | 'custom';

export interface AdminDateRange {
  period: AdminPeriod;
  from: string;
  to: string;
  days: string[];
}

export interface AdminUserCount {
  userId: string;
  username: string;
  count: number;
  words: number;
  wordsPerMessage: number;
  activeDays: number;
  lastMessageTs: number | null;
}

export interface AdminChatStats {
  chatId: number;
  period: AdminPeriod;
  range: {
    from: string;
    to: string;
    days: number;
  };
  activity: {
    total: number;
    totalWords: number;
    wordsPerMessage: number;
    activeUsers: number;
    averageDailyMessages: number;
    averageDailyActiveUsers: number;
    averageHourlyMessages: number;
    topUsers: AdminUserCount[];
    topTalkers: AdminUserCount[];
    dailyMessages: Array<{ day: string; count: number }>;
    dailyActiveUsers: Array<{ day: string; count: number }>;
    hourlyAverages: Array<{ hour: string; count: number }>;
    participantTimeline: {
      participants: Array<{
        username: string;
        dailyLevels: Array<{ day: string; level: 'inactive' | 'active' | 'talkative' }>;
      }>;
    };
    timeBuckets: Array<{
      bucket: 'morning' | 'noon' | 'evening' | 'night';
      label: string;
      topUsers: AdminUserCount[];
    }>;
  };
  profanity: {
    topUsers: Array<{ userId: number; username: string; count: number }>;
    topRateUsers: Array<{
      userId: number;
      username: string;
      profanityCount: number;
      wordCount: number;
      rate: number;
    }>;
    topWords: Array<{
      word: string;
      count: number;
      contributors: Array<{ userId: number; username: string; count: number }>;
    }>;
  };
  criminal: {
    topUsers: Array<{
      userId: number;
      username: string;
      count: number;
      totalYears?: number;
      lifeSentences?: number;
    }>;
  };
}

const PERIOD_DAYS: Record<AdminPeriod, number> = {
  today: 1,
  week: 7,
  month: 30,
  custom: 1,
};

const HOURS = Array.from({ length: 24 }, (_, index) => index.toString().padStart(2, '0'));
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_RANGE_DAYS = 90;
const TIME_BUCKETS = [
  { bucket: 'morning' as const, label: 'Утро' },
  { bucket: 'noon' as const, label: 'День' },
  { bucket: 'evening' as const, label: 'Вечер' },
  { bucket: 'night' as const, label: 'Ночь' },
];

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatDay(date) !== value) {
    return null;
  }

  return date;
}

function buildPresetRange(period: Exclude<AdminPeriod, 'custom'>): AdminDateRange {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Array.from({ length: PERIOD_DAYS[period] }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - (PERIOD_DAYS[period] - index - 1));
    return formatDay(day);
  });

  return {
    period,
    from: days[0],
    to: days[days.length - 1],
    days,
  };
}

function buildCustomRange(fromValue: string | null, toValue: string | null): AdminDateRange {
  const from = parseDay(fromValue);
  const to = parseDay(toValue);

  if (!from || !to) {
    throw new Error('custom period requires valid from and to dates');
  }
  if (from.getTime() > to.getTime()) {
    throw new Error('custom period from date must be before or equal to to date');
  }

  const dayCount = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
  if (dayCount > MAX_CUSTOM_RANGE_DAYS) {
    throw new Error(`custom period cannot be longer than ${MAX_CUSTOM_RANGE_DAYS} days`);
  }

  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = new Date(from);
    day.setUTCDate(from.getUTCDate() + index);
    return formatDay(day);
  });

  return {
    period: 'custom',
    from: formatDay(from),
    to: formatDay(to),
    days,
  };
}

export function parseAdminPeriod(
  value: string | null,
  fromValue: string | null = null,
  toValue: string | null = null,
): AdminDateRange {
  if (value === 'custom') {
    return buildCustomRange(fromValue, toValue);
  }
  if (value === 'week' || value === 'month') {
    return buildPresetRange(value);
  }

  return buildPresetRange('today');
}

function isInRange(day: string, range: AdminDateRange): boolean {
  return day >= range.from && day <= range.to;
}

async function getActivityStats(env: Env, chatId: number, range: AdminDateRange) {
  const totals: Record<string, { messages: number; words: number }> = {};
  const activeDaysByUser: Record<string, Set<string>> = {};
  const dailyCountsByUser: Record<string, Record<string, number>> = {};
  const dayTotals: Record<string, number> = {};
  const dayActiveUsers: Record<string, number> = {};
  const hourlyTotals: Record<string, number> = Object.fromEntries(HOURS.map((hour) => [hour, 0]));
  const bucketTotals: Record<string, Record<string, number>> = Object.fromEntries(
    TIME_BUCKETS.map(({ bucket }) => [bucket, {}]),
  );
  const days = range.days;

  for (const day of days) {
    const prefix = `stats_v2:${chatId}:${day}:`;
    let cursor: string | undefined;
    const usersForDay = new Set<string>();
    let dayMessageTotal = 0;

    do {
      const list: any = await env.COUNTERS.list({ prefix, cursor });
      cursor = !list.list_complete ? list.cursor : undefined;

      for (let i = 0; i < list.keys.length; i += 10) {
        const batch = list.keys.slice(i, i + 10);
        const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
        const wordValues = await Promise.all(
          batch.map((key: any) => {
            const [, , , userId] = key.name.split(':');
            return env.COUNTERS.get(`word_stats_v2:${chatId}:${day}:${userId}`);
          }),
        );

        for (let j = 0; j < batch.length; j++) {
          const [, , , userId] = batch[j].name.split(':');
          const count = parseInt(values[j] || '0', 10);
          const words = parseInt(wordValues[j] || '0', 10);
          dayMessageTotal += count;
          const current = totals[userId] || { messages: 0, words: 0 };
          totals[userId] = {
            messages: current.messages + count,
            words: current.words + words,
          };
          if (count > 0) {
            usersForDay.add(userId);
            if (!activeDaysByUser[userId]) activeDaysByUser[userId] = new Set();
            activeDaysByUser[userId].add(day);
            if (!dailyCountsByUser[userId]) dailyCountsByUser[userId] = {};
            dailyCountsByUser[userId][day] = count;
          }
        }
      }
    } while (cursor);

    dayTotals[day] = dayMessageTotal;
    dayActiveUsers[day] = usersForDay.size;

    for (let i = 0; i < HOURS.length; i += 12) {
      const batch = HOURS.slice(i, i + 12);
      const values = await Promise.all(
        batch.map((hour) => env.COUNTERS.get(`activity_hour:${chatId}:${day}:${hour}`)),
      );
      for (let j = 0; j < batch.length; j++) {
        hourlyTotals[batch[j]] += parseInt(values[j] || '0', 10);
      }
    }

    for (const { bucket } of TIME_BUCKETS) {
      const bucketPrefix = `activity_time_bucket:${chatId}:${day}:${bucket}:`;
      let bucketCursor: string | undefined;
      do {
        const list: any = await env.COUNTERS.list({ prefix: bucketPrefix, cursor: bucketCursor });
        bucketCursor = !list.list_complete ? list.cursor : undefined;
        for (let i = 0; i < list.keys.length; i += 10) {
          const batch = list.keys.slice(i, i + 10);
          const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
          for (let j = 0; j < batch.length; j++) {
            const userId = batch[j].name.split(':')[4];
            const count = parseInt(values[j] || '0', 10);
            bucketTotals[bucket][userId] = (bucketTotals[bucket][userId] || 0) + count;
          }
        }
      } while (bucketCursor);
    }
  }

  const sortedByMessages = Object.entries(totals)
    .sort((a, b) => b[1].messages - a[1].messages)
    .slice(0, 10);
  const sortedByWords = Object.entries(totals)
    .sort((a, b) => b[1].words - a[1].words || b[1].messages - a[1].messages)
    .slice(0, 10);
  const bucketSorted = TIME_BUCKETS.map(({ bucket }) =>
    Object.entries(bucketTotals[bucket])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  );
  const participantUserIds = Object.entries(totals)
    .filter(([userId]) => (activeDaysByUser[userId]?.size || 0) > 0)
    .sort((a, b) =>
      (activeDaysByUser[b[0]]?.size || 0) - (activeDaysByUser[a[0]]?.size || 0) ||
      b[1].messages - a[1].messages ||
      a[0].localeCompare(b[0]),
    )
    .slice(0, 12)
    .map(([userId]) => userId);
  const leaderboardUserIds = Array.from(new Set([
    ...sortedByMessages,
    ...sortedByWords,
    ...bucketSorted.flat(),
  ].map(([userId]) => userId)));
  const namedUserIds = Array.from(new Set([...leaderboardUserIds, ...participantUserIds]));
  const [usernames, lastMessages] = await Promise.all([
    Promise.all(namedUserIds.map((userId) => env.COUNTERS.get(`user:${userId}`))),
    Promise.all(leaderboardUserIds.map((userId) => env.COUNTERS.get(`last_message:${chatId}:${userId}`))),
  ]);
  const usernameByUserId = new Map(
    namedUserIds.map((userId, index) => [userId, usernames[index] || `id${userId}`]),
  );
  const lastMessageByUserId = new Map(
    leaderboardUserIds.map((userId, index) => [
      userId,
      parseInt(lastMessages[index] || '0', 10) || null,
    ]),
  );

  const mapEntry = ([userId, stats]: [string, { messages: number; words: number }]): AdminUserCount => ({
    userId,
    username: usernameByUserId.get(userId) || `id${userId}`,
    count: stats.messages,
    words: stats.words,
    wordsPerMessage: stats.messages > 0 ? Number((stats.words / stats.messages).toFixed(1)) : 0,
    activeDays: activeDaysByUser[userId]?.size || 0,
    lastMessageTs: lastMessageByUserId.get(userId) || null,
  });

  const total = Object.values(totals).reduce((sum, stats) => sum + stats.messages, 0);
  const totalWords = Object.values(totals).reduce((sum, stats) => sum + stats.words, 0);
  const dayCount = days.length;
  const activeUsers = Object.keys(totals).length;
  const participantTimeline: AdminChatStats['activity']['participantTimeline'] = {
    participants: participantUserIds.map((userId, index) => {
      const totalMessages = totals[userId].messages;
      const activeDays = activeDaysByUser[userId].size;
      const talkativeThreshold = Math.max(2, Math.ceil(totalMessages / activeDays));
      const storedUsername = usernameByUserId.get(userId);

      return {
        username: storedUsername && storedUsername !== `id${userId}`
          ? storedUsername
          : `Участник ${index + 1}`,
        dailyLevels: days.map((day) => {
          const count = dailyCountsByUser[userId]?.[day] || 0;
          const level: 'inactive' | 'active' | 'talkative' =
            count === 0 ? 'inactive' : count >= talkativeThreshold ? 'talkative' : 'active';
          return {
            day,
            level,
          };
        }),
      };
    }),
  };

  return {
    total,
    totalWords,
    wordsPerMessage: total > 0 ? Number((totalWords / total).toFixed(1)) : 0,
    activeUsers,
    averageDailyMessages: Number((total / dayCount).toFixed(1)),
    averageDailyActiveUsers: Number(
      (Object.values(dayActiveUsers).reduce((sum, count) => sum + count, 0) / dayCount).toFixed(1),
    ),
    averageHourlyMessages: Number((total / (dayCount * 24)).toFixed(2)),
    topUsers: sortedByMessages.map(mapEntry),
    topTalkers: sortedByWords.map(mapEntry),
    dailyMessages: days.map((day) => ({ day, count: dayTotals[day] || 0 })),
    dailyActiveUsers: days.map((day) => ({ day, count: dayActiveUsers[day] || 0 })),
    hourlyAverages: HOURS.map((hour) => ({
      hour,
      count: Number((hourlyTotals[hour] / dayCount).toFixed(2)),
    })),
    participantTimeline,
    timeBuckets: TIME_BUCKETS.map(({ bucket, label }, index) => ({
      bucket,
      label,
      topUsers: bucketSorted[index].map(([userId, count]) => mapEntry([
        userId,
        {
          messages: count,
          words: totals[userId]?.words || 0,
        },
      ])),
    })),
  };
}

async function getRangeTopProfanityUsers(env: Env, chatId: number, range: AdminDateRange) {
  const prefix = `profanity:${chatId}:`;
  const totals: Record<string, number> = {};
  let cursor: string | undefined;

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const keysToFetch = list.keys.filter((key: any) => {
      const parts = key.name.split(':');
      return parts.length === 4 && isInRange(parts[3], range);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
      for (let j = 0; j < batch.length; j++) {
        const userId = batch[j].name.split(':')[2];
        totals[userId] = (totals[userId] || 0) + parseInt(values[j] || '0', 10);
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const names = await Promise.all(sorted.map(([userId]) => env.COUNTERS.get(`user:${userId}`)));

  return sorted.map(([userId, count], index) => ({
    userId: parseInt(userId, 10),
    username: names[index] || `id${userId}`,
    count,
  }));
}

async function getRangeTopProfanityRateUsers(env: Env, chatId: number, range: AdminDateRange) {
  const profanityPrefix = `profanity:${chatId}:`;
  const wordPrefix = `word_stats_v2:${chatId}:`;
  const profanityTotals: Record<string, number> = {};
  const wordTotals: Record<string, number> = {};
  let cursor: string | undefined;

  do {
    const list: any = await env.COUNTERS.list({ prefix: profanityPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const keysToFetch = list.keys.filter((key: any) => {
      const parts = key.name.split(':');
      return parts.length === 4 && isInRange(parts[3], range);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
      for (let j = 0; j < batch.length; j++) {
        const userId = batch[j].name.split(':')[2];
        profanityTotals[userId] = (profanityTotals[userId] || 0) + parseInt(values[j] || '0', 10);
      }
    }
  } while (cursor);

  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: wordPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const keysToFetch = list.keys.filter((key: any) => {
      const parts = key.name.split(':');
      return parts.length === 4 && isInRange(parts[2], range);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
      for (let j = 0; j < batch.length; j++) {
        const userId = batch[j].name.split(':')[3];
        wordTotals[userId] = (wordTotals[userId] || 0) + parseInt(values[j] || '0', 10);
      }
    }
  } while (cursor);

  const sorted = Object.entries(profanityTotals)
    .map(([userId, profanityCount]) => {
      const wordCount = wordTotals[userId] || 0;
      return {
        userId,
        profanityCount,
        wordCount,
        rate: wordCount > 0 ? (profanityCount / wordCount) * 100 : 0,
      };
    })
    .filter((stat) => stat.profanityCount > 0 && stat.wordCount >= PROFANITY_RATE_MIN_WORDS)
    .sort((a, b) =>
      b.rate - a.rate ||
      b.profanityCount - a.profanityCount ||
      b.wordCount - a.wordCount,
    )
    .slice(0, 10);
  const names = await Promise.all(sorted.map(({ userId }) => env.COUNTERS.get(`user:${userId}`)));

  return sorted.map((stat, index) => ({
    userId: parseInt(stat.userId, 10),
    username: names[index] || `id${stat.userId}`,
    profanityCount: stat.profanityCount,
    wordCount: stat.wordCount,
    rate: stat.rate,
  }));
}

async function getRangeTopProfanityWordUsers(
  env: Env,
  chatId: number,
  word: string,
  range: AdminDateRange,
) {
  const prefix = `profanity_word_users:${chatId}:${word}:`;
  const totals: Record<string, number> = {};
  let cursor: string | undefined;

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const keysToFetch = list.keys.filter((key: any) => {
      const parts = key.name.split(':');
      return parts.length === 5 && isInRange(parts[3], range);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
      for (let j = 0; j < batch.length; j++) {
        const userId = batch[j].name.split(':')[4];
        totals[userId] = (totals[userId] || 0) + parseInt(values[j] || '0', 10);
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const names = await Promise.all(sorted.map(([userId]) => env.COUNTERS.get(`user:${userId}`)));

  return sorted.map(([userId, count], index) => ({
    userId: parseInt(userId, 10),
    username: names[index] || `id${userId}`,
    count,
  }));
}

async function getRangeTopProfanityWords(env: Env, chatId: number, range: AdminDateRange) {
  const prefix = `profanity_words:${chatId}:`;
  const totals: Record<string, number> = {};
  let cursor: string | undefined;

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const keysToFetch = list.keys.filter((key: any) => {
      const parts = key.name.split(':');
      return parts.length === 4 && isInRange(parts[3], range);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
      for (let j = 0; j < batch.length; j++) {
        const word = batch[j].name.split(':')[2];
        totals[word] = (totals[word] || 0) + parseInt(values[j] || '0', 10);
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const contributors = await Promise.all(
    sorted.map(([word]) => getRangeTopProfanityWordUsers(env, chatId, word, range)),
  );

  return sorted.map(([word, count], index) => ({
    word,
    count,
    contributors: contributors[index],
  }));
}

async function getRangeTopCriminalUsers(env: Env, chatId: number, range: AdminDateRange) {
  const prefix = `criminal:${chatId}:`;
  const totals: Record<string, number> = {};
  let cursor: string | undefined;

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const keysToFetch = list.keys.filter((key: any) => {
      const parts = key.name.split(':');
      return parts.length === 4 && isInRange(parts[3], range);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((key: any) => env.COUNTERS.get(key.name)));
      for (let j = 0; j < batch.length; j++) {
        const userId = batch[j].name.split(':')[2];
        totals[userId] = (totals[userId] || 0) + parseInt(values[j] || '0', 10);
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const names = await Promise.all(sorted.map(([userId]) => env.COUNTERS.get(`user:${userId}`)));

  return sorted.map(([userId, count], index) => ({
    userId: parseInt(userId, 10),
    username: names[index] || `id${userId}`,
    count,
  }));
}

async function getCriminalTopUsers(env: Env, chatId: number, range: AdminDateRange) {
  if (range.period === 'custom') {
    return getRangeTopCriminalUsers(env, chatId, range);
  }

  try {
    return await getTopCriminalUsersBySentence(env, chatId, 10, range.period);
  } catch {
    return await getTopCriminalUsers(env, chatId, 10, range.period);
  }
}

export async function getAdminChatStats(
  env: Env,
  chatId: number,
  range: AdminDateRange,
): Promise<AdminChatStats> {
  const profanityTopUsersPromise = range.period === 'custom'
    ? getRangeTopProfanityUsers(env, chatId, range)
    : getTopProfanityUsers(env, chatId, 10, range.period);
  const profanityTopWordsPromise = range.period === 'custom'
    ? getRangeTopProfanityWords(env, chatId, range)
    : getTopProfanityWords(env, chatId, 10, range.period);
  const profanityTopRateUsersPromise = range.period === 'custom'
    ? getRangeTopProfanityRateUsers(env, chatId, range)
    : getTopProfanityRateUsers(env, chatId, 10, range.period);
  const [
    activity,
    profanityTopUsers,
    profanityTopRateUsers,
    profanityTopWords,
    criminalTopUsers,
  ] = await Promise.all([
    getActivityStats(env, chatId, range),
    profanityTopUsersPromise,
    profanityTopRateUsersPromise,
    profanityTopWordsPromise,
    getCriminalTopUsers(env, chatId, range),
  ]);

  return {
    chatId,
    period: range.period,
    range: {
      from: range.from,
      to: range.to,
      days: range.days.length,
    },
    activity,
    profanity: {
      topUsers: profanityTopUsers,
      topRateUsers: profanityTopRateUsers,
      topWords: profanityTopWords,
    },
    criminal: {
      topUsers: criminalTopUsers,
    },
  };
}
