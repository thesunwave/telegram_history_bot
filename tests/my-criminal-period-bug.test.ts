/**
 * Regression test for the `/my_criminal [period]` bug.
 *
 * Bug: `myCriminalStats` accepted a `period` argument (today|week|month) and the
 * router + debug endpoint forwarded it, but the primary (success) path called
 * `ViolationHandler.getUserStats(userId, chatId)` — which had no `period`
 * parameter and an all-time SQL query — so the period was silently discarded
 * and `/my_criminal today|week|month` all returned identical all-time stats.
 *
 * Fix: thread `period` through ViolationHandler -> StatisticsService ->
 * ViolationRepository.getUserStats and apply a calendar-day predicate
 * `AND violation_day >= ?` (bound to `startStr` from getStatsPeriodRange),
 * matching the KV-path `getUserCriminalStats` semantics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { myCriminalStats } from '../src/features/stats/stats';
import { sendMessage } from '../src/core/telegram';
import type { Env } from '../src/core/env';

vi.mock('../src/core/telegram', () => ({
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
}));

const TEST_CHAT_ID = -1001234567890;
const TEST_USER_ID = 12345;
const FIXED_NOW = new Date('2026-09-07T00:00:00Z');

// today = 2026-09-07; week start = today - WEEK_DAYS(6) = 2026-09-01;
// month start = today - MONTH_DAYS(27) = 2026-08-11.
const TODAY_START = '2026-09-07';
const WEEK_START = '2026-09-01';
const MONTH_START = '2026-08-11';

interface RecordingDb {
  db: any;
  queries: string[];
  bindCalls: any[][];
  stmt: any;
}

// Mock D1 that records every prepared SQL string and every bind() call, and
// returns an aggregate row whose total_violations depends on the period
// start bound (so that different periods produce different user-visible numbers).
function makeRecordingDb(): RecordingDb {
  const queries: string[] = [];
  const bindCalls: any[][] = [];
  const stmt = {
    bind: vi.fn((...args: any[]) => {
      bindCalls.push(args);
      return stmt;
    }),
    first: vi.fn(() => {
      const last = bindCalls[bindCalls.length - 1];
      const startStr = last?.[2] as string | undefined;
      let total: number;
      if (startStr === undefined) total = 999; // no period -> all-time
      else if (startStr === TODAY_START) total = 3;
      else if (startStr === WEEK_START) total = 7;
      else if (startStr === MONTH_START) total = 30;
      else total = 999;
      return Promise.resolve({
        total_violations: total,
        average_severity: 5.0,
        last_violation_date: '2026-09-07T00:00:00Z',
      });
    }),
    all: vi.fn(() => Promise.resolve({ results: [] })),
    run: vi.fn(() => Promise.resolve({ success: true })),
  };
  const db = {
    prepare: vi.fn((sql: string) => {
      queries.push(sql);
      return stmt;
    }),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  };
  return { db, queries, bindCalls, stmt };
}

// Mock D1 whose prepare() always throws — used to prove the DB-error route
// does NOT reach the period-honoring catch fallback (ViolationHandler swallows it).
function makeExplodingDb(): any {
  return {
    prepare: vi.fn(() => {
      throw new Error('D1 exploded');
    }),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  };
}

// Empty KV COUNTERS namespace: list -> no keys; used by the catch-fallback
// getUserCriminalStats (which returns zero counts for all periods).
function makeEmptyCounters(): any {
  return {
    list: vi.fn().mockResolvedValue({ list_complete: true, keys: [] }),
    get: vi.fn().mockResolvedValue(null),
  };
}

function makeEnv(db: any, counters?: any): Env {
  return {
    DB: db,
    COUNTERS: counters ?? makeEmptyCounters(),
  } as unknown as Env;
}

describe('/my_criminal [period] — period argument is honored', () => {
  let mockSendMessage: ReturnType<typeof vi.mocked<typeof sendMessage>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage = vi.mocked(sendMessage);
    mockSendMessage.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a criminal_violations query with a violation_day >= ? date predicate for week', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockSendMessage.mockImplementation((_e: any, _id: any, text: any) => text);

    const { db, queries } = makeRecordingDb();
    const env = makeEnv(db);

    await myCriminalStats(env, TEST_CHAT_ID, TEST_USER_ID, 'week');

    const criminalQueries = queries.filter((q) => q.includes('criminal_violations'));
    expect(criminalQueries.length).toBeGreaterThan(0);

    const dateFiltered = criminalQueries.filter((q) => q.includes('violation_day >= ?'));
    // Both the aggregate query and the GROUP BY article query must be filtered.
    expect(dateFiltered.length).toBe(2);
  });

  it('binds distinct startStr for today / week / month (period no longer dropped)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockSendMessage.mockImplementation((_e: any, _id: any, text: any) => text);

    const periods: Array<[string | undefined, string | undefined]> = [
      ['today', TODAY_START],
      ['week', WEEK_START],
      ['month', MONTH_START],
    ];

    for (const [period, expectedStart] of periods) {
      const { db, bindCalls } = makeRecordingDb();
      const env = makeEnv(db);
      await myCriminalStats(env, TEST_CHAT_ID, TEST_USER_ID, period);

      // Both queries use the same period start for canonical and legacy rows.
      const periodBinds = bindCalls.filter((args) => args[2] === expectedStart);
      expect(periodBinds.length).toBe(2);
    }
  });

  it('does NOT add a date predicate when no period is given (all-time preserved)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockSendMessage.mockImplementation((_e: any, _id: any, text: any) => text);

    const { db, queries, bindCalls } = makeRecordingDb();
    const env = makeEnv(db);

    await myCriminalStats(env, TEST_CHAT_ID, TEST_USER_ID, undefined);

    const dateFiltered = queries.filter(
      (q) => q.includes('criminal_violations') && q.includes('violation_day >= ?'),
    );
    expect(dateFiltered.length).toBe(0);

    // No period -> bind is (userId, chatId) with no start date.
    const twoArgBinds = bindCalls.filter((args) => args.length === 2);
    expect(twoArgBinds.length).toBeGreaterThanOrEqual(2);
  });

  it('produces different user-visible stats for today / week / month / all-time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockSendMessage.mockImplementation((_e: any, _id: any, text: any) => text);

    async function run(period: string | undefined): Promise<string> {
      const { db } = makeRecordingDb();
      const env = makeEnv(db);
      return (await myCriminalStats(env, TEST_CHAT_ID, TEST_USER_ID, period as any)) as string;
    }

    const today = await run('today');
    const week = await run('week');
    const month = await run('month');
    const allTime = await run(undefined);

    expect(today).toContain('<b>Всего нарушений:</b> 3');
    expect(week).toContain('<b>Всего нарушений:</b> 7');
    expect(month).toContain('<b>Всего нарушений:</b> 30');
    expect(allTime).toContain('<b>Всего нарушений:</b> 999');

    // The bug made all four byte-for-byte identical; they must now diverge.
    expect(new Set([today, week, month, allTime]).size).toBe(4);
  });

  it('DB-error route is closed: ViolationHandler.getUserStats does not re-throw (fallback not reached)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    mockSendMessage.mockImplementation((_e: any, _id: any, text: any) => text);

    const env = makeEnv(makeExplodingDb());

    const result = (await myCriminalStats(env, TEST_CHAT_ID, TEST_USER_ID, 'week')) as string;

    // ViolationHandler swallowed the DB error and returned its own empty-stats
    // fallback (honestly labelled, with a warning) instead of throwing, so the
    // period-honoring catch fallback in myCriminalStats is NOT reached.
    expect(result).toContain('Статистика пользователя');
    expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');
    expect(result).not.toContain('за неделю');
    expect(result).not.toContain('Ваша статистика');

    // sendMessage was called exactly once (primary path); the catch fallback
    // would have called it again with period-scoped text.
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('the period-honoring fallback IS reachable via sendMessage failure (live Telegram path)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    const { db } = makeRecordingDb();
    const env = makeEnv(db, makeEmptyCounters());

    // First sendMessage (primary path) throws like a real Telegram API failure;
    // subsequent calls (the catch fallback) succeed and return the text.
    mockSendMessage.mockImplementation((_e: any, _id: any, text: any) => text);
    mockSendMessage.mockImplementationOnce(() => {
      throw new Error('Telegram API error: 503');
    });

    const result = (await myCriminalStats(env, TEST_CHAT_ID, TEST_USER_ID, 'week')) as string;

    // The catch fallback honors period: empty COUNTERS -> 0 -> "чистая речь за неделю".
    expect(result).toContain('за неделю');
    expect(result).toContain('чистая речь');

    // Two sendMessage calls: primary (threw) + fallback (delivered).
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });
});
