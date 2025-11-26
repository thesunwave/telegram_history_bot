import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { migrateStatsBatch, resetActivityBatch } from '../src/migrate';
import { activityChart } from '../src/stats';
import { Env } from '../src/env';

const createMockKV = (data: Map<string, string>) => ({
  get: vi.fn(async (key: string) => data.get(key) ?? null),
  put: vi.fn(async (key: string, value: string) => {
    data.set(key, value);
  }),
  delete: vi.fn(async (key: string) => {
    data.delete(key);
  }),
  list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
    const prefix = options?.prefix ?? '';
    const keys = Array.from(data.keys())
      .filter((k) => k.startsWith(prefix))
      .sort();

    return {
      keys: keys.map((name) => ({ name })),
      list_complete: true,
      cursor: undefined,
    };
  }),
});

const createMockDB = () => {
  const rows = new Map<string, number>();

  return {
    rows,
    prepare: vi.fn((query: string) => {
      const bindHandler = (...params: any[]) => ({
        all: vi.fn(async () => {
          if (query.startsWith('SELECT day, count FROM activity')) {
            const [chatId, start] = params as [number, string];
            const results = Array.from(rows.entries())
              .map(([key, count]) => {
                const [chat, day] = key.split(':');
                return { chatId: Number(chat), day, count };
              })
              .filter((row) => row.chatId === chatId && row.day >= start)
              .sort((a, b) => a.day.localeCompare(b.day));

            return { results };
          }

          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (query.startsWith('INSERT INTO activity')) {
            const [chatId, day, , delta] = params;
            const key = `${chatId}:${day}`;
            const current = rows.get(key) || 0;
            rows.set(key, current + Number(delta));
          } else if (query.startsWith('DELETE FROM activity')) {
            rows.clear();
          }

          return { success: true };
        }),
      });

      const defaultBindings = bindHandler();

      return {
        bind: vi.fn((...params: any[]) => bindHandler(...params)),
        all: defaultBindings.all,
        run: defaultBindings.run,
      };
    }),
  };
};

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
}));

vi.mock('../src/telegram', () => ({
  sendMessage: mocks.sendMessage,
  sendPhoto: mocks.sendPhoto,
}));

describe('Activity migration and fallbacks', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('migrates stats to v2 keys and rebuilds activity counters', async () => {
    const kvData = new Map<string, string>([
      ['stats:42:101:2025-01-01', '2'],
      ['stats:42:102:2025-01-01', '3'],
      ['activity:42:2025-01-01', '5'],
    ]);
    const db = createMockDB();

    const env = {
      COUNTERS: createMockKV(kvData),
      DB: db,
    } as unknown as Env;

    const result = await migrateStatsBatch(env);

    expect(result.error).toBeUndefined();
    expect(result.processed).toBe(2);
    expect(kvData.get('stats_v2:42:2025-01-01:101')).toBe('2');
    expect(kvData.get('stats_v2:42:2025-01-01:102')).toBe('3');
    expect(Array.from(kvData.keys()).some((k) => k.endsWith(' '))).toBe(false);
    expect(kvData.get('activity:42:2025-01-01')).toBe('10');
    expect(db.rows.get('42:2025-01-01')).toBe(5);
  });

  it('resets activity data in both KV and DB', async () => {
    const kvData = new Map<string, string>([
      ['activity:1:2025-11-18', '1'],
      ['activity:1:2025-11-19', '2'],
      ['stats:1:200:2025-11-19', '7'],
    ]);
    const db = createMockDB();
    db.rows.set('1:2025-11-18', 4);

    const env = {
      COUNTERS: createMockKV(kvData),
      DB: db,
    } as unknown as Env;

    const result = await resetActivityBatch(env);

    expect(result.error).toBeUndefined();
    expect(result.processed).toBe(2);
    expect(Array.from(kvData.keys()).filter((k) => k.startsWith('activity:')).length).toBe(0);
    expect(kvData.has('stats:1:200:2025-11-19')).toBe(true);
    expect(db.rows.size).toBe(0);
  });

  it('falls back to KV activity data when DB is empty', async () => {
    const kvData = new Map<string, string>();
    const chatId = 123;

    kvData.set(`activity:${chatId}:2025-11-13`, '1');
    kvData.set(`activity:${chatId}:2025-11-14`, '1');
    kvData.set(`activity:${chatId}:2025-11-15`, '1');
    kvData.set(`activity:${chatId}:2025-11-16`, '1');
    kvData.set(`activity:${chatId}:2025-11-17`, '1');
    kvData.set(`activity:${chatId}:2025-11-18`, '1');
    kvData.set(`activity:${chatId}:2025-11-19`, '1');

    const env = {
      COUNTERS: createMockKV(kvData),
      DB: createMockDB(),
    } as unknown as Env;

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-19T12:00:00Z'));

    await activityChart(env, chatId, 'week');

    expect(mocks.sendMessage).toHaveBeenCalled();
    const text = mocks.sendMessage.mock.calls[0][2];
    expect(text).toContain('Total: 7');
  });
});
