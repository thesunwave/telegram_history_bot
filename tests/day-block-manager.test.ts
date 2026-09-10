import { describe, it, expect } from 'vitest';
import { DayBlockManager } from '../src/durable-objects/day-block-manager';
import type { DurableObjectState, DurableObjectStorage } from '@cloudflare/workers-types';
import type { StoredMessage } from '../src/core/env';

// Map-backed in-memory DurableObjectStorage. Drives the DO directly via fetch()
// (mirrors tests/message-aggregator-do.test.ts) so the sharding/overflow logic
// is exercised against a real key/value backing store.
function makeStorage(): { storage: DurableObjectStorage; map: Map<string, any> } {
  const map = new Map<string, any>();
  const storage = {
    get: async (k: string) => map.get(k),
    put: async (k: string, v: any) => { map.set(k, v); },
    delete: async (k: string) => { map.delete(k); },
    deleteAll: async () => { map.clear(); },
    list: async () => ({ keys: [], list_complete: true, cursor: '' }),
    setAlarm: async () => {},
    getAlarm: async () => null,
  } as unknown as DurableObjectStorage;
  return { storage, map };
}

function makeState(storage: DurableObjectStorage): DurableObjectState {
  return {
    storage,
    id: { toString: () => 'test-do', equals: () => false },
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
  } as unknown as DurableObjectState;
}

function makeManager() {
  const env: any = {
    HISTORY: { put: async () => {}, get: async () => null },
    RAW_MESSAGE_RETENTION_DAYS: 7,
  };
  const { storage, map } = makeStorage();
  const mgr = new DayBlockManager(makeState(storage), env);
  return { mgr, map };
}

const BASE = 1788721200; // 2026-09-06T19:00:00Z

function dateFor(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

async function add(mgr: DayBlockManager, chatId: number, ts: number, text: string, user = 1) {
  const message: StoredMessage = { chat: chatId, user, username: 'u', text, ts, messageId: ts };
  const res = await mgr.fetch(new Request('https://do/add-message', {
    method: 'POST',
    body: JSON.stringify({ message }),
  }));
  expect(res.ok).toBe(true);
  return res.json() as Promise<{ success: boolean; messageCount: number; version: number; duplicate?: boolean }>;
}

async function getBlock(mgr: DayBlockManager, chatId: number, date: string) {
  const res = await mgr.fetch(new Request(`https://do/get-block?chatId=${chatId}&date=${date}`));
  expect(res.ok).toBe(true);
  const body = await res.json() as { block: { messages: StoredMessage[]; messageCount: number } | null };
  return body.block;
}

// ~5KB payloads so ~21 messages sit just under TARGET_MAX_BYTES (110000) and a
// 22nd crosses the boundary, exercising the overflow branch.
const BIG = 'x'.repeat(5000);

describe('DayBlockManager shard overflow', () => {
  it('preserves every previously-stored message when an out-of-order (older-ts) message overflows the shard', async () => {
    const { mgr } = makeManager();
    const chatId = 1;
    const date = dateFor(BASE);

    // Fill shard 0 to the ~110KB boundary with strictly ascending ts.
    const ascendingTs: number[] = [];
    for (let i = 0; i < 21; i++) {
      const ts = BASE + i;
      ascendingTs.push(ts);
      await add(mgr, chatId, ts, `${BIG}#${i}`);
    }
    const newestStoredTs = ascendingTs[ascendingTs.length - 1]; // BASE + 20

    const before = await getBlock(mgr, chatId, date);
    const beforeTs = before!.messages.map(m => m.ts).sort((a, b) => a - b);

    // Out-of-order message: smaller ts than the newest stored, same UTC day,
    // and large enough to cross TARGET_MAX_BYTES (triggers the overflow branch).
    await add(mgr, chatId, BASE - 600, `${BIG}#OOO`);

    const after = await getBlock(mgr, chatId, date);
    const afterTs = after!.messages.map(m => m.ts).sort((a, b) => a - b);

    // Regression guard: removing the just-added message by position (pop() after
    // an ascending-ts sort) silently evicts the max-ts stored message instead.
    // Every previously-stored ts must still be present, and the out-of-order
    // message must also be persisted (not dropped or duplicated).
    expect(beforeTs.filter(t => !afterTs.includes(t))).toEqual([]);
    expect(afterTs.includes(BASE - 600)).toBe(true);
    expect(afterTs.includes(newestStoredTs)).toBe(true);
    expect(afterTs.length).toBe(beforeTs.length + 1);
  });
});
