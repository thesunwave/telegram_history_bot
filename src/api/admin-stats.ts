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
}

export interface AdminChatStats {
  chatId: number;
  period: AdminPeriod;
  activity: {
    total: number;
    totalWords: number;
    wordsPerMessage: number;
    topUsers: AdminUserCount[];
    topTalkers: AdminUserCount[];
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

  for (const day of listDays(period)) {
    const prefix = `stats_v2:${chatId}:${day}:`;
    let cursor: string | undefined;

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
          const current = totals[userId] || { messages: 0, words: 0 };
          totals[userId] = {
            messages: current.messages + count,
            words: current.words + words,
          };
        }
      }
    } while (cursor);
  }

  const sortedByMessages = Object.entries(totals)
    .sort((a, b) => b[1].messages - a[1].messages)
    .slice(0, 10);
  const sortedByWords = Object.entries(totals)
    .sort((a, b) => b[1].words - a[1].words || b[1].messages - a[1].messages)
    .slice(0, 10);
  const users = Array.from(new Set([...sortedByMessages, ...sortedByWords].map(([userId]) => userId)));
  const usernames = await Promise.all(users.map((userId) => env.COUNTERS.get(`user:${userId}`)));
  const usernameByUserId = new Map(
    users.map((userId, index) => [userId, usernames[index] || `id${userId}`]),
  );

  const mapEntry = ([userId, stats]: [string, { messages: number; words: number }]) => ({
    userId,
    username: usernameByUserId.get(userId) || `id${userId}`,
    count: stats.messages,
    words: stats.words,
    wordsPerMessage: stats.messages > 0 ? Number((stats.words / stats.messages).toFixed(1)) : 0,
  });

  const total = Object.values(totals).reduce((sum, stats) => sum + stats.messages, 0);
  const totalWords = Object.values(totals).reduce((sum, stats) => sum + stats.words, 0);

  return {
    total,
    totalWords,
    wordsPerMessage: total > 0 ? Number((totalWords / total).toFixed(1)) : 0,
    topUsers: sortedByMessages.map(mapEntry),
    topTalkers: sortedByWords.map(mapEntry),
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
