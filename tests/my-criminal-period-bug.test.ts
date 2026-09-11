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
const TODAY_START = '2026-09-07';
const WEEK_START = '2026-09-01';
const MONTH_START = '2026-08-09';

interface RecordingDb {
  db: any;
  queries: string[];
  bindCalls: any[][];
}

function countForStart(start: unknown): number {
  if (start === TODAY_START) return 3;
  if (start === WEEK_START) return 7;
  if (start === MONTH_START) return 30;
  return 999;
}

function makeRecordingDb(): RecordingDb {
  const queries: string[] = [];
  const bindCalls: any[][] = [];
  const db = {
    prepare: vi.fn((sql: string) => {
      queries.push(sql);
      let args: any[] = [];
      const stmt = {
        bind: vi.fn((...values: any[]) => {
          args = values;
          bindCalls.push(values);
          return stmt;
        }),
        all: vi.fn(async () => {
          if (sql.includes('GROUP BY article') && sql.includes('user_id = ?')) {
            return {
              results: [{
                article: '119',
                subarticle: null,
                article_title: 'Угроза убийством',
                punishment: 'лишение свободы до 2 лет',
                count: countForStart(args[2]),
                average_severity: 5,
              }],
            };
          }
          if (sql.includes('SELECT id') && sql.includes('user_id = ?')) {
            return {
              results: [{
                id: 1,
                article: '119',
                subarticle: null,
                article_title: 'Угроза убийством',
                quote: 'тестовая угроза',
                text_preview: 'тестовая угроза',
                punishment: 'лишение свободы до 2 лет',
                severity: 5,
                confidence: 0.9,
                event_ts: 1788739200,
              }],
            };
          }
          return { results: [] };
        }),
      };
      return stmt;
    }),
  };
  return { db, queries, bindCalls };
}

function makeExplodingDb(): any {
  return {
    prepare: vi.fn(() => {
      throw new Error('D1 exploded');
    }),
  };
}

function makeEnv(db: any): Env {
  return {
    DB: db,
    COUNTERS: {
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ list_complete: true, keys: [] }),
    },
  } as unknown as Env;
}

describe('/my_criminal [period] — period argument is honored', () => {
  let mockSendMessage: ReturnType<typeof vi.mocked<typeof sendMessage>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage = vi.mocked(sendMessage);
    mockSendMessage.mockImplementation((_env: any, _chatId: any, text: any) => text);
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses canonical violation_day filtering for week', async () => {
    const { db, queries } = makeRecordingDb();
    await myCriminalStats(makeEnv(db), TEST_CHAT_ID, TEST_USER_ID, 'week');

    const dateFiltered = queries.filter(
      query => query.includes('criminal_violations') && query.includes('violation_day >= ?'),
    );
    expect(dateFiltered).toHaveLength(2);
  });

  it('binds distinct calendar ranges for today / week / month', async () => {
    const periods: Array<[string, string]> = [
      ['today', TODAY_START],
      ['week', WEEK_START],
      ['month', MONTH_START],
    ];

    for (const [period, expectedStart] of periods) {
      const { db, bindCalls } = makeRecordingDb();
      await myCriminalStats(makeEnv(db), TEST_CHAT_ID, TEST_USER_ID, period);
      expect(bindCalls.filter(args => args[2] === expectedStart)).toHaveLength(2);
    }
  });

  it('preserves all-time behavior when no period is given', async () => {
    const { db, queries, bindCalls } = makeRecordingDb();
    const result = await myCriminalStats(makeEnv(db), TEST_CHAT_ID, TEST_USER_ID, undefined);

    const dateFiltered = queries.filter(
      query => query.includes('criminal_violations') && query.includes('violation_day >= ?'),
    );
    expect(dateFiltered).toHaveLength(0);
    expect(bindCalls.some(args => args.length === 2)).toBe(true);
    expect(result).toContain('Твоё уголовное дело · за всё время');
    expect(result).toContain('Нарушений: <b>999</b>');
  });

  it('produces different user-visible reports for today / week / month / all-time', async () => {
    async function run(period?: string): Promise<string> {
      const { db } = makeRecordingDb();
      return (await myCriminalStats(makeEnv(db), TEST_CHAT_ID, TEST_USER_ID, period)) as string;
    }

    const today = await run('today');
    const week = await run('week');
    const month = await run('month');
    const allTime = await run();

    expect(today).toContain('Нарушений: <b>3</b>');
    expect(week).toContain('Нарушений: <b>7</b>');
    expect(month).toContain('Нарушений: <b>30</b>');
    expect(allTime).toContain('Нарушений: <b>999</b>');
    expect(new Set([today, week, month, allTime]).size).toBe(4);
  });

  it('returns the command error message when D1 loading fails', async () => {
    const result = await myCriminalStats(makeEnv(makeExplodingDb()), TEST_CHAT_ID, TEST_USER_ID, 'week');

    expect(result).toBe('Ошибка при получении вашей статистики');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('reports a send failure through the existing command error path', async () => {
    const { db } = makeRecordingDb();
    mockSendMessage.mockImplementationOnce(() => {
      throw new Error('Telegram API error: 503');
    });

    const result = await myCriminalStats(makeEnv(db), TEST_CHAT_ID, TEST_USER_ID, 'week');

    expect(result).toBe('Ошибка при получении вашей статистики');
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });
});
