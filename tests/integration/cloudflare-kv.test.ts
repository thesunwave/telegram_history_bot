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
    } finally {
      await mf.dispose();
    }
  });
});
