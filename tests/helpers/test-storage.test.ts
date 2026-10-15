import { describe, expect, it } from 'vitest';
import { KVNamespace, MemoryStorage } from './test-storage';

describe('in-memory KV fixture', () => {
  it('expires values on the supplied clock', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    const clock = () => now;
    const kv = new KVNamespace(new MemoryStorage(new Map(), clock), { clock });

    await kv.put('item', 'value', { expirationTtl: 60 });
    expect(await kv.get('item')).toBe('value');

    now += 60_000;
    expect(await kv.get('item')).toBeNull();
    expect((await kv.list()).keys).toEqual([]);
  });

  it('lists sorted keys in cursor pages with prefix filtering', async () => {
    const kv = new KVNamespace(new MemoryStorage());
    await kv.put('msg:z', 'z');
    await kv.put('other', 'ignore');
    await kv.put('msg:a', 'a');
    await kv.put('msg:b', 'b');

    const first = await kv.list({ prefix: 'msg:', limit: 2 });
    expect(first.keys.map((entry: { name: string }) => entry.name)).toEqual(['msg:a', 'msg:b']);
    expect(first.list_complete).toBe(false);

    const second = await kv.list({ prefix: 'msg:', limit: 2, cursor: first.cursor });
    expect(second.keys.map((entry: { name: string }) => entry.name)).toEqual(['msg:z']);
    expect(second.list_complete).toBe(true);
  });

  it('supports JSON values and metadata', async () => {
    const kv = new KVNamespace(new MemoryStorage());
    await kv.put('item', JSON.stringify({ count: 3 }), { metadata: { source: 'test' } });

    expect(await kv.get('item', 'json')).toEqual({ count: 3 });
    expect(await kv.getWithMetadata('item', { type: 'json' })).toEqual({
      value: { count: 3 },
      metadata: { source: 'test' },
    });
  });
});
