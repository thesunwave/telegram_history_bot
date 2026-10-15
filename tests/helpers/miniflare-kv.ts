import { Miniflare } from 'miniflare';
import type { KVNamespace } from '@cloudflare/workers-types';

/** Starts real workerd KV bindings; callers must dispose the Miniflare instance. */
export async function createKVBindings() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    kvNamespaces: ['HISTORY', 'COUNTERS'],
  });
  try {
    const [history, counters] = await Promise.all([
      mf.getKVNamespace('HISTORY'),
      mf.getKVNamespace('COUNTERS'),
    ]);
    return { mf, history, counters };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

/** For tests that spy on methods: forwards calls to real KV without emulating it. */
export function spyableKVBinding(kv: KVNamespace): KVNamespace {
  const forward = (method: 'get' | 'put' | 'delete' | 'list' | 'getWithMetadata') =>
    (...args: any[]) => (kv[method] as (...args: any[]) => any)(...args);
  return {
    get: forward('get'),
    put: forward('put'),
    delete: forward('delete'),
    list: forward('list'),
    getWithMetadata: forward('getWithMetadata'),
  } as unknown as KVNamespace;
}
