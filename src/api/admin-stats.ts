import type { Env } from '../core/env';
import {
  getTopCriminalUsers,
  getTopCriminalUsersBySentence,
  getTopProfanityUsers,
  getTopProfanityWords,
} from '../features/stats/stats';

export type AdminPeriod = 'today' | 'week' | 'month';

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
    timeBuckets: Array<{
      bucket: 'morning' | 'noon' | 'evening' | 'night';
      label: string;
      topUsers: AdminUserCount[];
    }>;
  };
  profanity: {
    topUsers: Array<{ userId: number; username: string; count: number }>;
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
};

const HOURS = Array.from({ length: 24 }, (_, index) => index.toString().padStart(2, '0'));
const TIME_BUCKETS = [
  { bucket: 'morning' as const, label: 'Утро' },
  { bucket: 'noon' as const, label: 'День' },
  { bucket: 'evening' as const, label: 'Вечер' },
  { bucket: 'night' as const, label: 'Ночь' },
];

export function parseAdminPeriod(value: string | null): AdminPeriod {
  if (value === 'week' || value === 'month') {
    return value;
  }

  return 'today';
}

function listDays(period: AdminPeriod): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: PERIOD_DAYS[period] }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - (PERIOD_DAYS[period] - index - 1));
    return day.toISOString().slice(0, 10);
  });
}

async function getActivityStats(env: Env, chatId: number, period: AdminPeriod) {
  const totals: Record<string, { messages: number; words: number }> = {};
  const activeDaysByUser: Record<string, Set<string>> = {};
  const dayTotals: Record<string, number> = {};
  const dayActiveUsers: Record<string, number> = {};
  const hourlyTotals: Record<string, number> = Object.fromEntries(HOURS.map((hour) => [hour, 0]));
  const bucketTotals: Record<string, Record<string, number>> = Object.fromEntries(
    TIME_BUCKETS.map(({ bucket }) => [bucket, {}]),
  );
  const days = listDays(period);

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
  const users = Array.from(new Set([
    ...sortedByMessages,
    ...sortedByWords,
    ...bucketSorted.flat(),
  ].map(([userId]) => userId)));
  const [usernames, lastMessages] = await Promise.all([
    Promise.all(users.map((userId) => env.COUNTERS.get(`user:${userId}`))),
    Promise.all(users.map((userId) => env.COUNTERS.get(`last_message:${chatId}:${userId}`))),
  ]);
  const usernameByUserId = new Map(
    users.map((userId, index) => [userId, usernames[index] || `id${userId}`]),
  );
  const lastMessageByUserId = new Map(
    users.map((userId, index) => [userId, parseInt(lastMessages[index] || '0', 10) || null]),
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
  const dayCount = PERIOD_DAYS[period];
  const activeUsers = Object.keys(totals).length;

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

async function getCriminalTopUsers(env: Env, chatId: number, period: AdminPeriod) {
  try {
    return await getTopCriminalUsersBySentence(env, chatId, 10, period);
  } catch {
    return await getTopCriminalUsers(env, chatId, 10, period);
  }
}

export async function getAdminChatStats(
  env: Env,
  chatId: number,
  period: AdminPeriod,
): Promise<AdminChatStats> {
  const [activity, profanityTopUsers, profanityTopWords, criminalTopUsers] = await Promise.all([
    getActivityStats(env, chatId, period),
    getTopProfanityUsers(env, chatId, 10, period),
    getTopProfanityWords(env, chatId, 10, period),
    getCriminalTopUsers(env, chatId, period),
  ]);

  return {
    chatId,
    period,
    activity,
    profanity: {
      topUsers: profanityTopUsers,
      topWords: profanityTopWords,
    },
    criminal: {
      topUsers: criminalTopUsers,
    },
  };
}
