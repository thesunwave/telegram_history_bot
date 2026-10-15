import { describe, expect, it } from 'vitest';
import { resetCounters } from '../../src/features/stats/stats';
import { createMockEnv } from '../test-utils';
import { KVNamespace, MemoryStorage } from '../helpers/test-storage';

describe('resetCounters — paginated KV deletion', () => {
  it('removes every matching key across pages while preserving other chats', async () => {
    const counters = new KVNamespace(new MemoryStorage());
    const env = createMockEnv({ COUNTERS: counters as any });

    for (let index = 0; index < 1005; index++) {
      await counters.put(`stats:42:${String(index).padStart(4, '0')}`, '1');
    }
    await counters.put('stats_v2:42:2026-10-15:7', '1');
    await counters.put('stats:99:0000', 'keep');

    await resetCounters(env, 42);

    expect((await counters.list({ prefix: 'stats:42:' })).keys).toEqual([]);
    expect((await counters.list({ prefix: 'stats_v2:42:' })).keys).toEqual([]);
    expect(await counters.get('stats:99:0000')).toBe('keep');
  });
});
