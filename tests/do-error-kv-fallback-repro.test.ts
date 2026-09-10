import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredMessage, DayBlock } from '../src/core/env';

import {
  fetchMessagesOptimized,
  fetchMessagesHybrid,
} from '../src/features/history/history-optimized';

// Unix seconds (UTC). The real fetchMessagesOptimized takes seconds and does
// new Date(start * 1000) internally; passing Date objects silently breaks the
// per-date iteration.
const DAY1_START = 1735689600; // 2025-01-01T00:00:00Z
const DAY1_END = 1735775999; //   2025-01-01T23:59:59Z
const DAY2_END = 1735862399; //   2025-01-02T23:59:59Z
const CHAT = 123;
const DAY1_TS = 1735693200; //    2025-01-01T01:00:00Z (inside [DAY1_START, DAY1_END])
const DAY2_TS = 1735779600; //    2025-01-02T01:00:00Z (inside [DAY1_START, DAY2_END])

function mkMessage(ts: number, text: string): StoredMessage {
  return { chat: CHAT, user: 456, username: 'alice', text, ts };
}

/**
 * Map-backed KV that honours `{ type: 'json' }`, matching how the real
 * Cloudflare KVNamespace interprets the get options that loadShardedBlockFromKV
 * and the legacy msg_day: fallback rely on. A naive Map mock that ignores the
 * options argument would hand back raw JSON strings and break shard reading.
 */
function createJsonKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string, options?: any) => {
      const raw = store.get(key) ?? null;
      if (raw === null) return null;
      if (options && options.type === 'json') {
        try { return JSON.parse(raw); } catch { return null; }
      }
      return raw;
    }),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    list: vi.fn(async () => ({ keys: [] as { name: string }[], list_complete: true })),
  };
}

/** Seed exactly what DayBlockManager.backupToKV writes for one day (shardCount=1):
 * msg_day_meta:{chat}:{date} and msg_day_shard:{chat}:{date}:0. */
function seedShardedDayBlock(
  kv: ReturnType<typeof createJsonKV>,
  chatId: number,
  date: string,
  messages: StoredMessage[],
  version = 1,
) {
  const meta = {
    id: `${chatId}:${date}`,
    date,
    chatId,
    messageCount: messages.length,
    lastUpdated: Date.now(),
    version,
    shardCount: 1,
    checksum: '',
  };
  kv.store.set(`msg_day_meta:${chatId}:${date}`, JSON.stringify(meta));
  kv.store.set(`msg_day_shard:${chatId}:${date}:0`, JSON.stringify({ messages }));
}

/**
 * Drives the REAL getDayBlockSafe by providing a DAY_BLOCK_MANAGER_DO namespace
 * whose stub.fetch behaves per-date. This exercises the actual DO read path
 * (the `!response.ok -> throw` and `doStub.fetch` throw branches reported as
 * reachable failure modes) rather than mocking the module, which keeps the
 * test faithful to production and avoids dynamic-import mock pitfalls.
 */
type DOBehavior =
  | { kind: 'throws'; message?: string }              // doStub.fetch throws (gateTimeout)
  | { kind: 'status'; status: number; body?: string }  // !response.ok -> throw (5xx)
  | { kind: 'json'; payload: any };                   // 200 JSON response, payload -> response.json()

function makeDONS(behaviorFor: (date: string) => DOBehavior): any {
  return {
    idFromName: (name: string) => ({ toString: () => name, equals: () => false }),
    get: (id: any) => {
      // id.toString() is `dayblock:${chatId}:${date}`; date is the 3rd segment.
      const date = id.toString().split(':')[2];
      const b: DOBehavior = behaviorFor(date) ?? { kind: 'json', payload: { block: null } };
      return {
        fetch: vi.fn(async () => {
          if (b.kind === 'throws') throw new Error(b.message ?? 'gateTimeout');
          if (b.kind === 'status') return new Response(b.body ?? '', { status: b.status });
          return new Response(JSON.stringify(b.payload), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }),
      };
    },
  };
}

const throwsDO = (msg = 'gateTimeout'): DOBehavior => ({ kind: 'throws', message: msg });
const statusDO = (status: number, body = ''): DOBehavior => ({ kind: 'status', status, body });
const jsonDO = (payload: any): DOBehavior => ({ kind: 'json', payload });

function makeEnv(kv: ReturnType<typeof createJsonKV>, doNs?: any): any {
  const env: any = { HISTORY: kv, DEBUG_LOGS: 'false' };
  if (doNs) env.DAY_BLOCK_MANAGER_DO = doNs;
  return env;
}

describe('fetchMessagesOptimized: DO read failure should fall back to KV backup', () => {
  let kv: ReturnType<typeof createJsonKV>;
  beforeEach(() => {
    kv = createJsonKV();
  });

  it('DO throws (gateTimeout) -> sharded KV backup is recovered (was dropped before fix)', async () => {
    const env = makeEnv(kv, makeDONS(() => throwsDO()));
    seedShardedDayBlock(kv, CHAT, '2025-01-01', [mkMessage(DAY1_TS, 'hi')]);

    const messages = await fetchMessagesOptimized(env, CHAT, DAY1_START, DAY1_END);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hi');
  });

  it('DO returns 503 (!response.ok -> throw) -> sharded KV backup is recovered', async () => {
    const env = makeEnv(kv, makeDONS(() => statusDO(503, 'overloaded')));
    seedShardedDayBlock(kv, CHAT, '2025-01-01', [mkMessage(DAY1_TS, 'hi')]);

    const messages = await fetchMessagesOptimized(env, CHAT, DAY1_START, DAY1_END);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hi');
  });

  it('contrast: DO returns { block: null } -> sharded KV backup is recovered', async () => {
    const env = makeEnv(kv, makeDONS(() => jsonDO({ block: null })));
    seedShardedDayBlock(kv, CHAT, '2025-01-01', [mkMessage(DAY1_TS, 'hi')]);

    const messages = await fetchMessagesOptimized(env, CHAT, DAY1_START, DAY1_END);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hi');
  });

  it('DO throws and KV is empty -> resolves to [] without escaping, and KV IS consulted', async () => {
    const env = makeEnv(kv, makeDONS(() => throwsDO()));

    await expect(fetchMessagesOptimized(env, CHAT, DAY1_START, DAY1_END)).resolves.toEqual([]);
    // Before the fix the per-date catch bypassed KV entirely; after the fix
    // loadShardedBlockFromKV + legacy get run, so kv.get is called.
    expect(kv.get).toHaveBeenCalled();
  });

  it('DO throws -> legacy msg_day: single-block fallback is recovered', async () => {
    const env = makeEnv(kv, makeDONS(() => throwsDO()));
    const legacyBlock: DayBlock = {
      date: '2025-01-01',
      chatId: CHAT,
      messages: [mkMessage(DAY1_TS, 'legacy')],
      messageCount: 1,
      lastUpdated: Date.now(),
      version: 1,
    };
    kv.store.set(`msg_day:${CHAT}:2025-01-01`, JSON.stringify(legacyBlock));

    const messages = await fetchMessagesOptimized(env, CHAT, DAY1_START, DAY1_END);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('legacy');
  });

  it('DO returns the block -> KV is NOT consulted (no regression, DO preferred)', async () => {
    const block: DayBlock = {
      date: '2025-01-01',
      chatId: CHAT,
      messages: [mkMessage(DAY1_TS, 'from-do')],
      messageCount: 1,
      lastUpdated: Date.now(),
      version: 1,
    };
    const env = makeEnv(kv, makeDONS(() => jsonDO({ block })));

    const messages = await fetchMessagesOptimized(env, CHAT, DAY1_START, DAY1_END);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('from-do');
    // DO hit short-circuits before any KV fallback read.
    expect(kv.get).not.toHaveBeenCalled();
  });

  it('multi-day: day1 DO throws+KV seed, day2 DO returns block -> both recovered and sorted', async () => {
    const day2Block: DayBlock = {
      date: '2025-01-02',
      chatId: CHAT,
      messages: [mkMessage(DAY2_TS, 'day2-do')],
      messageCount: 1,
      lastUpdated: Date.now(),
      version: 1,
    };
    const env = makeEnv(
      kv,
      makeDONS((date) =>
        date === '2025-01-01'
          ? throwsDO()
          : date === '2025-01-02'
            ? jsonDO({ block: day2Block })
            : jsonDO({ block: null }),
      ),
    );
    seedShardedDayBlock(kv, CHAT, '2025-01-01', [mkMessage(DAY1_TS, 'day1-kv')]);

    const messages = await fetchMessagesOptimized(env, CHAT, DAY1_START, DAY2_END);
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe('day1-kv'); // earlier ts
    expect(messages[1].text).toBe('day2-do'); // later ts
  });
});

describe('fetchMessagesHybrid: DO read failure must not silently drop a single-day summary', () => {
  it('DO throws, KV backup exists -> hybrid returns optimized result and does NOT fall back to legacy fetchMessages', async () => {
    const kv = createJsonKV();
    const env = makeEnv(kv, makeDONS(() => throwsDO()));
    seedShardedDayBlock(kv, CHAT, '2025-01-01', [mkMessage(DAY1_TS, 'hi')]);

    const messages = await fetchMessagesHybrid(env, CHAT, DAY1_START, DAY1_END);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hi');
    // Before the fix optimized returned 0 and hybrid fell back to the legacy
    // fetchMessages (which lists `msg:${chatId}:` keys). After the fix the
    // optimized path recovers the KV backup and short-circuits, so the legacy
    // listing scan never happens.
    expect(kv.list).not.toHaveBeenCalled();
  });
});
