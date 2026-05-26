import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  activityByUser,
  activityChart,
  activityHours,
  parseActivityCommand,
  parseActivityPeriod,
  topTalkers,
} from '../src/features/stats/stats';
import { CountersDO } from '../src/durable-objects/counters-do';
import { Env } from '../src/core/env';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
}));

vi.mock('../src/core/telegram', () => ({
  sendMessage: mocks.sendMessage,
  sendPhoto: mocks.sendPhoto,
}));

const createMockKV = (data: Map<string, string>, listCalls: string[] = []) => ({
  get: vi.fn(async (key: string) => data.get(key) ?? null),
  put: vi.fn(async (key: string, value: string) => {
    data.set(key, value);
  }),
  delete: vi.fn(async (key: string) => {
    data.delete(key);
  }),
  list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
    const prefix = options?.prefix ?? '';
    listCalls.push(prefix);
    const keys = Array.from(data.keys())
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }),
});

const chartConfigFromUrl = (url: string) => JSON.parse(decodeURIComponent(url.split('c=')[1]));

describe('activity flexible periods', () => {
  let kvData: Map<string, string>;
  let listCalls: string[];
  let env: Env;

  beforeEach(() => {
    kvData = new Map();
    listCalls = [];
    env = {
      COUNTERS: createMockKV(kvData, listCalls) as any,
      DB: null as any,
    } as Env;
    mocks.sendMessage.mockClear();
    mocks.sendPhoto.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('parses supported activity periods', () => {
    expect(parseActivityPeriod(['week']).startDate).toBe('2026-05-01');
    expect(parseActivityPeriod(['month']).startDate).toBe('2026-04-08');
    expect(parseActivityPeriod(['2m']).dayCount).toBe(60);
    expect(parseActivityPeriod(['14d']).dayCount).toBe(14);
    expect(parseActivityPeriod(['8w']).dayCount).toBe(56);
    expect(parseActivityPeriod(['prev_month'])).toMatchObject({
      startDate: '2026-04-01',
      endDate: '2026-04-30',
    });
    expect(parseActivityPeriod(['2026-03-01', '2026-04-30'])).toMatchObject({
      startDate: '2026-03-01',
      endDate: '2026-04-30',
      dayCount: 61,
    });
  });

  it('rejects invalid and too-large periods', () => {
    expect(() => parseActivityPeriod(['2026-02-30'])).toThrow();
    expect(() => parseActivityPeriod(['2026-05-02', '2026-05-01'])).toThrow();
    expect(() => parseActivityPeriod(['181d'])).toThrow();
  });

  it('normalizes Telegram command suffixes', () => {
    expect(parseActivityCommand('/activity@stat_history_bot users 2m')).toEqual({
      name: '/activity',
      args: ['users', '2m'],
    });
  });

  it('renders activity chart with explicit period title and 30-day month', async () => {
    kvData.set('activity:123:2026-04-08', '5');
    kvData.set('activity:123:2026-04-07', '100');
    kvData.set('activity:123:2026-05-07', '3');

    await activityChart(env, 123, 'month');

    expect(mocks.sendMessage).toHaveBeenCalled();
    const text = mocks.sendMessage.mock.calls[0][2];
    expect(text).toContain('Активность: 2026-04-08 - 2026-05-07');
    expect(text).toContain('Total: 8');
  });

  it('uses D1 as primary source and bounds the activity query by end date', async () => {
    const all = vi.fn(async () => ({ results: [{ day: '2026-05-07', count: 7 }] }));
    const bind = vi.fn(() => ({ all }));
    env.DB = { prepare: vi.fn(() => ({ bind })) } as any;
    kvData.set('activity:123:2026-05-07', '99');

    await activityChart(env, 123, ['week']);

    expect(bind).toHaveBeenCalledWith(123, '2026-05-01', '2026-05-07');
    const text = mocks.sendMessage.mock.calls[0][2];
    expect(text).toContain('Total: 7');
  });

  it('aggregates users for 2m without scanning outside the requested days', async () => {
    kvData.set('stats_v2:123:2026-03-09:1', '5');
    kvData.set('stats_v2:123:2026-03-08:1', '100');
    kvData.set('stats_v2:123:2026-05-07:1', '4');
    kvData.set('user:1', 'alice');

    await activityByUser(env, 123, ['2m']);

    expect(listCalls).toContain('stats_v2:123:2026-03-09:');
    expect(listCalls).not.toContain('stats_v2:123:2026-03-08:');
    const config = chartConfigFromUrl(mocks.sendPhoto.mock.calls[0][2]);
    expect(config.options.plugins.title.text).toBe('Активность пользователей: 2026-03-09 - 2026-05-07');
    expect(config.options.title.text).toBe('Активность пользователей: 2026-03-09 - 2026-05-07');
    expect(config.options.legend.display).toBe(false);
    expect(config.data.datasets[0].data).toEqual([9]);
  });

  it('does not include current month for prev_month user activity', async () => {
    kvData.set('stats_v2:123:2026-04-10:1', '5');
    kvData.set('stats_v2:123:2026-05-01:1', '100');
    kvData.set('user:1', 'alice');

    await activityByUser(env, 123, ['prev_month']);

    expect(listCalls).toContain('stats_v2:123:2026-04-01:');
    expect(listCalls).toContain('stats_v2:123:2026-04-30:');
    expect(listCalls).not.toContain('stats_v2:123:2026-05-01:');
    const config = chartConfigFromUrl(mocks.sendPhoto.mock.calls[0][2]);
    expect(config.data.datasets[0].data).toEqual([5]);
  });

  it('increments hourly activity counters from /inc payloads', async () => {
    const state = { blockConcurrencyWhile: vi.fn((fn: () => Promise<any>) => fn()) };
    const counters = new CountersDO(state as any, env);

    const response = await counters.fetch(new Request('https://do/inc', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 123,
        userId: 456,
        username: 'alice',
        day: '2026-05-07',
        hour: 13,
        wordCount: 4,
        ts: 1778158800,
      }),
    }));

    expect(response.status).toBe(200);
    expect(kvData.get('activity_hour:123:2026-05-07:13')).toBe('1');
    expect(kvData.get('activity_time_bucket:123:2026-05-07:noon:456')).toBe('1');
    expect(kvData.get('last_message:123:456')).toBe('1778158800');
    expect(kvData.get('word_stats:123:456:2026-05-07')).toBe('4');
    expect(kvData.get('word_stats_v2:123:2026-05-07:456')).toBe('4');
    expect(kvData.get('word_activity:123:2026-05-07')).toBe('4');
  });

  it('renders talkers sorted by total words with words per message rate', async () => {
    kvData.set('stats_v2:123:2026-05-06:1', '5');
    kvData.set('word_stats_v2:123:2026-05-06:1', '20');
    kvData.set('stats_v2:123:2026-05-07:2', '2');
    kvData.set('word_stats_v2:123:2026-05-07:2', '50');
    kvData.set('user:1', 'shorty');
    kvData.set('user:2', 'speaker');

    await topTalkers(env, 123, 2, ['week']);

    expect(mocks.sendMessage).toHaveBeenCalled();
    const text = mocks.sendMessage.mock.calls[0][2];
    expect(text).toContain('Топ болтунов: 2026-05-01 - 2026-05-07');
    expect(text).toContain('1. speaker: 50 слов, 2 сообщений, 25 слов/сообщение');
    expect(text).toContain('2. shorty: 20 слов, 5 сообщений, 4 слов/сообщение');
  });

  it('renders hourly average chart over selected period', async () => {
    kvData.set('activity_hour:123:2026-05-01:13', '2');
    kvData.set('activity_hour:123:2026-05-02:13', '5');

    await activityHours(env, 123, ['week']);

    const config = chartConfigFromUrl(mocks.sendPhoto.mock.calls[0][2]);
    expect(config.options.plugins.title.text).toBe('Почасовая активность: 2026-05-01 - 2026-05-07');
    expect(config.options.title.text).toBe('Почасовая активность: 2026-05-01 - 2026-05-07');
    expect(config.data.labels[13]).toBe('13');
    expect(config.data.datasets[0].data[13]).toBe(1);
  });

  it('sends a readable message when hourly data is missing', async () => {
    await activityHours(env, 123, ['week']);

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      env,
      123,
      expect.stringContaining('Нет почасовых данных за выбранный период'),
    );
  });
});
