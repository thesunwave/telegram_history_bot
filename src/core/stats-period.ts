import { WEEK_DAYS, MONTH_DAYS } from './env';

export const VALID_STATS_PERIODS = ['today', 'week', 'month'] as const;
export type StatsPeriod = (typeof VALID_STATS_PERIODS)[number];

export function isValidStatsPeriod(period: string | undefined): period is StatsPeriod {
  return typeof period === 'string' && (VALID_STATS_PERIODS as readonly string[]).includes(period);
}

export interface StatsPeriodRange {
  startStr: string;
  endStr: string;
}

export function getStatsPeriodRange(period: string, now: Date = new Date()): StatsPeriodRange {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const endStr = today.toISOString().slice(0, 10);

  let startStr: string;
  switch (period) {
    case 'week': {
      const weekStart = new Date(today);
      weekStart.setUTCDate(weekStart.getUTCDate() - WEEK_DAYS);
      startStr = weekStart.toISOString().slice(0, 10);
      break;
    }
    case 'month': {
      const monthStart = new Date(today);
      monthStart.setUTCDate(monthStart.getUTCDate() - MONTH_DAYS);
      startStr = monthStart.toISOString().slice(0, 10);
      break;
    }
    case 'today':
    default: {
      startStr = endStr;
      break;
    }
  }

  return { startStr, endStr };
}
