import { describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';

describe('Cloudflare KV runtime integration', () => {
  it('supports put, get, metadata, prefix list and delete', async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      kvNamespaces: ['HISTORY'],
    });

    try {
      const kv = await mf.getKVNamespace('HISTORY');
      await kv.put('msg:1', JSON.stringify({ text: 'hello' }), {
        metadata: { source: 'telegram' },
      });

      expect(await kv.get('msg:1', 'json')).toEqual({ text: 'hello' });
      expect(await kv.getWithMetadata('msg:1')).toMatchObject({
        value: JSON.stringify({ text: 'hello' }),
        metadata: { source: 'telegram' },
      });
      expect((await kv.list({ prefix: 'msg:' })).keys.map((item) => item.name)).toEqual(['msg:1']);

      await kv.delete('msg:1');
      expect(await kv.get('msg:1')).toBeNull();

      const raw = new Uint8Array([0x00, 0xff, 0x80, 0x42]);
      await kv.put('bytes', raw.buffer);
      expect(new Uint8Array((await kv.get('bytes', 'arrayBuffer'))!)).toEqual(raw);
      expect(new Uint8Array(await new Response((await kv.get('bytes', 'stream'))!).arrayBuffer())).toEqual(raw);
    } finally {
      await mf.dispose();
    }
  });

  it('paginates correctly when the listed page is deleted', async () => {
    const mf = new Miniflare({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } };",
      kvNamespaces: ['HISTORY'],
    });
    try {
      const kv = await mf.getKVNamespace('HISTORY');
      for (const key of ['msg:a', 'msg:b', 'msg:c', 'msg:d', 'msg:e']) {
        await kv.put(key, 'value');
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await kv.list({ prefix: 'msg:', limit: 2, cursor });
        cursor = page.list_complete ? undefined : page.cursor;
        for (const key of page.keys) {
          seen.push(key.name);
          await kv.delete(key.name);
        }
      } while (cursor);
      expect(seen).toEqual(['msg:a', 'msg:b', 'msg:c', 'msg:d', 'msg:e']);
    } finally {
      await mf.dispose();
    }
  });
});
