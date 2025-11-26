
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { topChat } from '../src/stats';
import { Env } from '../src/env';
import { migrateStatsBatch } from '../src/migrate';

// Mock KVNamespace
const createMockKV = (data: Map<string, string>) => ({
    get: vi.fn(async (key: string) => data.get(key) || null),
    put: vi.fn(async (key: string, value: string) => data.set(key, value)),
    delete: vi.fn(async (key: string) => data.delete(key)),
    list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
        const prefix = options?.prefix || '';
        const keys = Array.from(data.keys())
            .filter(k => k.startsWith(prefix))
            .sort(); // KV returns sorted keys

        // Simple pagination simulation
        const limit = 1000;
        const cursor = options?.cursor ? parseInt(options.cursor) : 0;
        const slicedKeys = keys.slice(cursor, cursor + limit);
        const nextCursor = cursor + limit < keys.length ? (cursor + limit).toString() : undefined;

        return {
            keys: slicedKeys.map(name => ({ name })),
            list_complete: !nextCursor,
            cursor: nextCursor,
        };
    }),
});

describe('Stats Performance Repro', () => {
    let env: Env;
    let kvData: Map<string, string>;

    beforeEach(() => {
        kvData = new Map();
        env = {
            COUNTERS: createMockKV(kvData) as any,
            // Mock other env vars as needed
        } as Env;

        // Mock sendMessage to capture output
        vi.mock('../src/telegram', () => ({
            sendMessage: vi.fn(),
            sendPhoto: vi.fn(),
        }));
    });

    it('should be fast when finding top users for today with extensive history using v2 keys', async () => {
        const chatId = 123;
        const today = '2025-11-19';
        const numUsers = 50;
        const numDays = 365; // 1 year of history

        // Populate KV with extensive history using OLD keys
        const populateStart = performance.now();
        for (let u = 1; u <= numUsers; u++) {
            for (let d = 0; d < numDays; d++) {
                const date = new Date(2025, 0, 1 + d).toISOString().slice(0, 10);
                const key = `stats:${chatId}:${u}:${date}`;
                kvData.set(key, Math.floor(Math.random() * 100).toString());
                kvData.set(`user:${u}`, `User${u}`);
            }
        }
        console.log(`Populate KV (Old): ${(performance.now() - populateStart).toFixed(3)}ms`);
        console.log(`Total keys (Old): ${kvData.size}`);

        // Run migration using the new batch function
        const startMigration = performance.now();
        let cursor: string | undefined = undefined;
        do {
            const result: any = await migrateStatsBatch(env, cursor);
            cursor = result.nextCursor;
        } while (cursor);
        const endMigration = performance.now();
        console.log(`Migration: ${(endMigration - startMigration).toFixed(3)}ms`);

        // Reset mock calls
        vi.clearAllMocks();

        // Measure time to get top chat for today using NEW logic
        const topChatStart = performance.now();
        await topChat(env, chatId, 5, today);
        console.log(`topChat V2: ${(performance.now() - topChatStart).toFixed(3)}ms`);

        // With v2 keys, we expect to only list keys for the specific day
        // The prefix is `stats_v2:${chatId}:${day}:`
        // In our mock, this should result in very few keys being processed (only numUsers keys)
        // compared to scanning everything.

        // Verify that we called list with the new prefix
        expect(env.COUNTERS.list).toHaveBeenCalledWith(expect.objectContaining({
            prefix: `stats_v2:${chatId}:${today}:`
        }));
    });
});
