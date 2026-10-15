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

  it('does not skip keys when a caller deletes each listed page', async () => {
    const kv = new KVNamespace(new MemoryStorage());
    for (const key of ['msg:a', 'msg:b', 'msg:c', 'msg:d', 'msg:e']) {
      await kv.put(key, 'value');
    }
    await kv.put('other', 'keep');

    let cursor: string | undefined;
    const deleted: string[] = [];
    do {
      const page = await kv.list({ prefix: 'msg:', limit: 2, cursor });
      cursor = page.list_complete ? undefined : page.cursor;
      for (const key of page.keys) {
        deleted.push(key.name);
        await kv.delete(key.name);
      }
    } while (cursor);

    expect(deleted).toEqual(['msg:a', 'msg:b', 'msg:c', 'msg:d', 'msg:e']);
    expect((await kv.list({ prefix: 'msg:' })).keys).toEqual([]);
    expect(await kv.get('other')).toBe('keep');
  });

  it('round-trips invalid UTF-8 bytes through ArrayBuffer and stream reads', async () => {
    const kv = new KVNamespace(new MemoryStorage());
    const bytes = new Uint8Array([0, 0xff, 0x80, 0x42, 0]);
    await kv.put('binary', bytes.buffer);

    expect(new Uint8Array(await kv.get('binary', 'arrayBuffer'))).toEqual(bytes);
    expect(new Uint8Array(await new Response(await kv.get('binary', 'stream')).arrayBuffer())).toEqual(bytes);
  });

  it('preserves the byte range of a typed-array view and copies the input', async () => {
    const kv = new KVNamespace(new MemoryStorage());
    const backing = new Uint8Array([0, 0xfe, 0x00, 0xfd, 0]);
    await kv.put('view', backing.subarray(1, 4));
    backing.fill(0);

    expect(new Uint8Array(await kv.get('view', 'arrayBuffer'))).toEqual(new Uint8Array([0xfe, 0, 0xfd]));
  });

  it('round-trips bytes supplied as a ReadableStream', async () => {
    const kv = new KVNamespace(new MemoryStorage());
    const bytes = new Uint8Array([0xff, 0x00, 0x81]);
    await kv.put('stream', new Blob([bytes]).stream());

    expect(new Uint8Array(await kv.get('stream', 'arrayBuffer'))).toEqual(bytes);
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
