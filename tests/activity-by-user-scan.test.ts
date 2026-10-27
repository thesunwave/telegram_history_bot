import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activityByUser } from '../src/features/stats/stats';
import { Env } from '../src/core/env';
import { createRealD1, seedUserDay, seedUsername, type RealD1 } from './helpers/real-d1';

const mocks = vi.hoisted(() => ({
  sendPhoto: vi.fn(),
}));

vi.mock('../src/core/telegram', () => ({
  sendPhoto: mocks.sendPhoto,
  sendMessage: vi.fn(),
}));

const buildDate = (base: string, diff: number) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
};

describe('activityByUser period bounds', () => {
  let env: Env;
  let d1: RealD1;

  beforeEach(() => {
    d1 = createRealD1();
    mocks.sendPhoto.mockClear();
    env = { DB: d1.db } as Env;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-19T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('only counts days inside the period', async () => {
    const chatId = 555;
    // 11 days of data, but the week range includes only the last 7 days.
    for (let offset = -10; offset <= 0; offset++) {
      seedUserDay(d1, { chatId, userId: 1, day: buildDate('2025-11-19T00:00:00Z', offset), messages: 2 });
    }
    seedUsername(d1, chatId, 1, 'alice');

    await activityByUser(env, chatId, 'week');

    const url = decodeURIComponent(mocks.sendPhoto.mock.calls[0][2]);
    const chart = JSON.parse(url.replace('https://quickchart.io/chart?c=', ''));
    expect(chart.data.labels).toEqual(['alice']);
    expect(chart.data.datasets[0].data).toEqual([14]);
  });
});
