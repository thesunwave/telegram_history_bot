import type { Env } from '../core/env';
import { getAdminChatStatsFromD1 } from '../features/stats/admin-stats-d1';
import type { LiveProgressSnapshot } from '../features/stats/d1-coverage';
import { AdminUnavailable } from '../features/stats/admin-stats-errors';

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
  voiceCount: number;
  voiceMinutes: number;
  videoNoteCount: number;
  videoNoteMinutes: number;
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
  /** 'final' for strictly closed ranges; 'provisional' when today is live. */
  status: 'final' | 'provisional';
  /** Truthful compact pipeline progress for a provisional live day. */
  progress?: LiveProgressSnapshot;
  activity: {
    total: number;
    totalWords: number;
    wordsPerMessage: number;
    totalVoiceCount: number;
    totalVoiceMinutes: number;
    totalVideoNoteCount: number;
    totalVideoNoteMinutes: number;
    activeUsers: number;
    averageDailyMessages: number;
    averageDailyActiveUsers: number;
    averageHourlyMessages: number;
    topUsers: AdminUserCount[];
    topTalkers: AdminUserCount[];
    topVoiceUsers: AdminUserCount[];
    topVideoNoteUsers: AdminUserCount[];
    dailyMessages: Array<{ day: string; count: number }>;
    dailyActiveUsers: Array<{ day: string; count: number }>;
    hourlyAverages: Array<{ hour: string; count: number }>;
    participantTimeline: {
      timeZone: 'UTC';
      timeBuckets: Array<{
        bucket: 'night' | 'morning' | 'noon' | 'evening';
        label: string;
      }>;
      participants: Array<{
        username: string;
        dailyLevels: Array<{
          day: string;
          level: 'inactive' | 'active' | 'talkative';
          timeBucketLevels: Array<{
            bucket: 'night' | 'morning' | 'noon' | 'evening';
            level: 'inactive' | 'active' | 'talkative';
          }>;
        }>;
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

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_RANGE_DAYS = 90;

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

/**
 * Builds a rolling UTC-day window for presets that includes the current live
 * day: week = `[today-6, today]`, month = `[today-29, today]`, today =
 * `[today, today]`. Closed days are final; today is provisional live data.
 */
function buildPresetRange(period: Exclude<AdminPeriod, 'custom'>): AdminDateRange {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endOffset = 0;
  const startOffset = endOffset - (PERIOD_DAYS[period] - 1);
  const days = Array.from({ length: PERIOD_DAYS[period] }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() + startOffset + index);
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

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (to.getTime() > today.getTime()) {
    throw new Error('custom period cannot end in the future');
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

export async function getAdminChatStats(
  env: Env,
  chatId: number,
  range: AdminDateRange,
): Promise<AdminChatStats> {
  try {
    // D1 aggregate success is served directly. Missing coverage/progress
    // metadata never makes a successful read not-ready: no aggregate rows mean
    // zero stats for the requested days (KV-equivalent behavior). No KV,
    // CountersDO, or readiness classification is involved on this path.
    return await getAdminChatStatsFromD1(env.DB, chatId, range);
  } catch (error) {
    // D1 is the only admin stats storage: any aggregate read failure surfaces
    // the structured AdminUnavailable (503). Legacy KV is never consulted.
    if (error instanceof AdminUnavailable) {
      throw error;
    }
    throw new AdminUnavailable();
  }
}
