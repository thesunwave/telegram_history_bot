import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activityByUser } from '../src/features/stats/stats';
import { Env } from '../src/core/env';

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

describe('activityByUser KV scan limits', () => {
  const listCalls: string[] = [];

  const createMockKV = (data: Map<string, string>) => ({
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
      const prefix = options?.prefix ?? '';
      listCalls.push(prefix);
      const keys = Array.from(data.keys()).filter((k) => k.startsWith(prefix));
      return { keys: keys.map((name) => ({ name })), list_complete: true };
    }),
  });

  let env: Env;
  let kvData: Map<string, string>;

  beforeEach(() => {
    kvData = new Map();
    listCalls.length = 0;
    mocks.sendPhoto.mockClear();
    env = { COUNTERS: createMockKV(kvData) as any } as Env;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-19T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('only lists prefixes for days inside the period', async () => {
    const chatId = 555;
    // Add data for 10 days before today, but week range should include only last 7 days
    for (let offset = -10; offset <= 0; offset++) {
      const day = buildDate('2025-11-19T00:00:00Z', offset);
      kvData.set(`stats_v2:${chatId}:${day}:1`, '2');
    }
    kvData.set('user:1', 'alice');

    await activityByUser(env, chatId, 'week');

    const uniquePrefixes = new Set(listCalls);
    expect(uniquePrefixes.size).toBe(7);
    expect([...uniquePrefixes]).toContain(`stats_v2:${chatId}:2025-11-19:`);
    expect([...uniquePrefixes]).not.toContain(`stats_v2:${chatId}:2025-11-09:`);
  });
});
