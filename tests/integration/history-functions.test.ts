import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { KVNamespace } from '@miniflare/kv';
import { MemoryStorage } from '@miniflare/storage-memory';
import { fetchMessages, fetchLastMessages } from '../../src/history';
import { Env, StoredMessage, DEFAULT_KV_BATCH_SIZE, DEFAULT_KV_BATCH_DELAY } from '../../src/env';

describe('History Functions Integration Tests', () => {
    let env: Env;
    let history: KVNamespace;

    beforeEach(async () => {
        history = new KVNamespace(new MemoryStorage());

        env = {
            HISTORY: history as any,
            COUNTERS: {} as any,
            COUNTERS_DO: {} as any,
            DB: {} as any,
            AI: {} as any,
            TOKEN: "test-token",
            SECRET: "test-secret",
            SUMMARY_MODEL: "test-model",
            SUMMARY_PROMPT: "Test prompt",
            KV_BATCH_SIZE: DEFAULT_KV_BATCH_SIZE,
            KV_BATCH_DELAY: DEFAULT_KV_BATCH_DELAY,
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Helper function to create test messages
    async function createTestMessages(chatId: number, count: number, startTime: number, interval: number = 3600): Promise<StoredMessage[]> {
        const messages: StoredMessage[] = [];

        for (let i = 0; i < count; i++) {
            const message: StoredMessage = {
                chat: chatId,
                user: 100 + i,
                username: `user${i}`,
                text: `Test message ${i + 1}`,
                ts: startTime + (i * interval),
            };

            const key = `msg:${chatId}:${message.ts}:${message.user}`;
            await env.HISTORY.put(key, JSON.stringify(message));
            messages.push(message);
        }

        return messages;
    }

    // Helper function to create command messages (should be filtered out in fetchLastMessages)
    async function createCommandMessages(chatId: number, count: number, startTime: number): Promise<StoredMessage[]> {
        const messages: StoredMessage[] = [];

        for (let i = 0; i < count; i++) {
            const message: StoredMessage = {
                chat: chatId,
                user: 200 + i,
                username: `cmduser${i}`,
                text: `/command${i}`,
                ts: startTime + (i * 1800), // 30 minute intervals
            };

            const key = `msg:${chatId}:${message.ts}:${message.user}`;
            await env.HISTORY.put(key, JSON.stringify(message));
            messages.push(message);
        }

        return messages;
    }

    describe('fetchMessages function', () => {
        it('should fetch messages for 1 day time range', async () => {
            const chatId = 1;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);

            // Create 24 messages over 1 day (1 per hour)
            const testMessages = await createTestMessages(chatId, 24, oneDayAgo, 3600);

            const result = await fetchMessages(env, chatId, oneDayAgo, now);

            expect(result).toHaveLength(24);
            expect(result[0].text).toBe('Test message 1');
            expect(result[23].text).toBe('Test message 24');

            // Verify sorting (ascending by timestamp)
            for (let i = 1; i < result.length; i++) {
                expect(result[i].ts).toBeGreaterThanOrEqual(result[i - 1].ts);
            }
        });

        it('should fetch messages for 7 day time range', async () => {
            const chatId = 2;
            const now = Math.floor(Date.now() / 1000);
            const sevenDaysAgo = now - (7 * 24 * 3600);

            // Create 168 messages over 7 days (1 per hour)
            const testMessages = await createTestMessages(chatId, 168, sevenDaysAgo, 3600);

            const result = await fetchMessages(env, chatId, sevenDaysAgo, now);

            expect(result).toHaveLength(168);
            expect(result[0].text).toBe('Test message 1');
            expect(result[167].text).toBe('Test message 168');

            // Verify all messages are within time range
            result.forEach(msg => {
                expect(msg.ts).toBeGreaterThanOrEqual(sevenDaysAgo);
                expect(msg.ts).toBeLessThanOrEqual(now);
            });
        });

        it('should fetch messages for 30 day time range', async () => {
            const chatId = 3;
            const now = Math.floor(Date.now() / 1000);
            const thirtyDaysAgo = now - (30 * 24 * 3600);

            // Create 720 messages over 30 days (1 per hour)
            const testMessages = await createTestMessages(chatId, 720, thirtyDaysAgo, 3600);

            const result = await fetchMessages(env, chatId, thirtyDaysAgo, now);

            expect(result).toHaveLength(720);
            expect(result[0].text).toBe('Test message 1');
            expect(result[719].text).toBe('Test message 720');

            // Verify time range filtering
            result.forEach(msg => {
                expect(msg.ts).toBeGreaterThanOrEqual(thirtyDaysAgo);
                expect(msg.ts).toBeLessThanOrEqual(now);
            });
        });

        it('should filter messages outside time range', async () => {
            const chatId = 4;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);
            const twoDaysAgo = now - (2 * 24 * 3600);

            // Create messages before, during, and after the target range
            await createTestMessages(chatId, 10, twoDaysAgo, 3600); // Before range
            await createTestMessages(chatId, 20, oneDayAgo, 1800); // In range
            await createTestMessages(chatId, 5, now + 3600, 3600); // After range

            const result = await fetchMessages(env, chatId, oneDayAgo, now);

            // Should only get the 20 messages in range
            expect(result).toHaveLength(20);
            result.forEach(msg => {
                expect(msg.ts).toBeGreaterThanOrEqual(oneDayAgo);
                expect(msg.ts).toBeLessThanOrEqual(now);
            });
        });

        it('should handle empty result set', async () => {
            const chatId = 5;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);

            // Don't create any messages
            const result = await fetchMessages(env, chatId, oneDayAgo, now);

            expect(result).toHaveLength(0);
            expect(Array.isArray(result)).toBe(true);
        });

        it('should maintain sorting behavior after batching', async () => {
            const chatId = 6;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);

            // Create messages with random timestamps within range
            const messages: StoredMessage[] = [];
            const timestamps = [];
            for (let i = 0; i < 50; i++) {
                timestamps.push(oneDayAgo + Math.floor(Math.random() * (24 * 3600)));
            }
            timestamps.sort((a, b) => a - b); // Sort for verification

            for (let i = 0; i < timestamps.length; i++) {
                const message: StoredMessage = {
                    chat: chatId,
                    user: 100 + i,
                    username: `user${i}`,
                    text: `Message ${i}`,
                    ts: timestamps[i],
                };

                const key = `msg:${chatId}:${message.ts}:${message.user}`;
                await env.HISTORY.put(key, JSON.stringify(message));
                messages.push(message);
            }

            const result = await fetchMessages(env, chatId, oneDayAgo, now);

            expect(result).toHaveLength(50);

            // Verify ascending sort order
            for (let i = 1; i < result.length; i++) {
                expect(result[i].ts).toBeGreaterThanOrEqual(result[i - 1].ts);
            }
        });

        it('should handle KV get failures gracefully', async () => {
            const chatId = 7;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);

            // Create some valid messages
            await createTestMessages(chatId, 10, oneDayAgo, 3600);

            // Mock KV get to fail for some requests
            const originalGet = env.HISTORY.get;
            let callCount = 0;
            (vi.spyOn(env.HISTORY, 'get') as any).mockImplementation(async (key: string, options?: any) => {
                callCount++;
                if (callCount % 3 === 0) {
                    // Fail every 3rd request
                    throw new Error('KV get failed');
                }
                return (originalGet as any).call(env.HISTORY, key, options);
            });

            const result = await fetchMessages(env, chatId, oneDayAgo, now);

            // Should get some messages (not all due to failures)
            expect(result.length).toBeGreaterThan(0);
            expect(result.length).toBeLessThan(10);

            // All returned messages should be valid
            result.forEach(msg => {
                expect(msg.text).toBeDefined();
                expect(msg.ts).toBeGreaterThanOrEqual(oneDayAgo);
            });
        });
    });

    describe('fetchLastMessages function', () => {
        it('should fetch last 10 messages', async () => {
            const chatId = 10;
            const now = Math.floor(Date.now() / 1000);

            // Create 20 messages
            await createTestMessages(chatId, 20, now - 20000, 1000);

            const result = await fetchLastMessages(env, chatId, 10);

            expect(result).toHaveLength(10);

            // Should be sorted in ascending order (oldest first)
            for (let i = 1; i < result.length; i++) {
                expect(result[i].ts).toBeGreaterThanOrEqual(result[i - 1].ts);
            }

            // Should be the last 10 messages (messages 11-20)
            expect(result[0].text).toBe('Test message 11');
            expect(result[9].text).toBe('Test message 20');
        });

        it('should fetch last 50 messages', async () => {
            const chatId = 11;
            const now = Math.floor(Date.now() / 1000);

            // Create 100 messages
            await createTestMessages(chatId, 100, now - 100000, 1000);

            const result = await fetchLastMessages(env, chatId, 50);

            expect(result).toHaveLength(50);

            // Should be the last 50 messages (messages 51-100)
            expect(result[0].text).toBe('Test message 51');
            expect(result[49].text).toBe('Test message 100');
        });

        it('should fetch last 100 messages', async () => {
            const chatId = 12;
            const now = Math.floor(Date.now() / 1000);

            // Create 150 messages
            await createTestMessages(chatId, 150, now - 150000, 1000);

            const result = await fetchLastMessages(env, chatId, 100);

            expect(result).toHaveLength(100);

            // Should be the last 100 messages (messages 51-150)
            expect(result[0].text).toBe('Test message 51');
            expect(result[99].text).toBe('Test message 150');
        });

        it('should fetch last 500 messages', async () => {
            const chatId = 13;
            const now = Math.floor(Date.now() / 1000);

            // Create 600 messages
            await createTestMessages(chatId, 600, now - 600000, 1000);

            const result = await fetchLastMessages(env, chatId, 500);

            expect(result).toHaveLength(500);

            // Should be the last 500 messages (messages 101-600)
            expect(result[0].text).toBe('Test message 101');
            expect(result[499].text).toBe('Test message 600');
        });

        it('should filter out command messages', async () => {
            const chatId = 14;
            const now = Math.floor(Date.now() / 1000);

            // Create 20 regular messages and 10 command messages
            await createTestMessages(chatId, 20, now - 30000, 1000);
            await createCommandMessages(chatId, 10, now - 25000);

            const result = await fetchLastMessages(env, chatId, 15);

            // Should only get regular messages, no commands
            // Note: fetchLastMessages fetches the last N non-command messages
            // Since we have 20 regular messages, we should get the last 15 of them
            expect(result.length).toBeLessThanOrEqual(15);
            expect(result.length).toBeGreaterThan(0);
            result.forEach(msg => {
                expect(msg.text).toBeDefined();
                expect(msg.text.startsWith('/')).toBe(false);
            });
        });

        it('should handle case with more commands than regular messages', async () => {
            const chatId = 15;
            const now = Math.floor(Date.now() / 1000);

            // Create 5 regular messages and 20 command messages
            await createTestMessages(chatId, 5, now - 25000, 1000);
            await createCommandMessages(chatId, 20, now - 20000);

            const result = await fetchLastMessages(env, chatId, 10);

            // Should only get the regular messages available (up to 5)
            expect(result.length).toBeLessThanOrEqual(5);
            result.forEach(msg => {
                expect(msg.text.startsWith('/')).toBe(false);
            });
        });

        it('should maintain sorting behavior after batching', async () => {
            const chatId = 16;
            const now = Math.floor(Date.now() / 1000);

            // Create messages with specific timestamps to verify sorting
            const messages: StoredMessage[] = [];
            for (let i = 0; i < 30; i++) {
                const message: StoredMessage = {
                    chat: chatId,
                    user: 100 + i,
                    username: `user${i}`,
                    text: `Message ${i + 1}`,
                    ts: now - (30 - i) * 1000, // Ascending timestamps
                };

                const key = `msg:${chatId}:${message.ts}:${message.user}`;
                await env.HISTORY.put(key, JSON.stringify(message));
                messages.push(message);
            }

            const result = await fetchLastMessages(env, chatId, 20);

            expect(result).toHaveLength(20);

            // Should be sorted in ascending order (oldest first)
            for (let i = 1; i < result.length; i++) {
                expect(result[i].ts).toBeGreaterThanOrEqual(result[i - 1].ts);
            }

            // Should be the last 20 messages
            expect(result[0].text).toBe('Message 11');
            expect(result[19].text).toBe('Message 30');
        });

        it('should handle empty message set', async () => {
            const chatId = 17;

            const result = await fetchLastMessages(env, chatId, 10);

            expect(result).toHaveLength(0);
            expect(Array.isArray(result)).toBe(true);
        });

        it('should handle requesting more messages than available', async () => {
            const chatId = 18;
            const now = Math.floor(Date.now() / 1000);

            // Create only 5 messages
            await createTestMessages(chatId, 5, now - 5000, 1000);

            const result = await fetchLastMessages(env, chatId, 20);

            // Should return all 5 available messages
            expect(result).toHaveLength(5);
            expect(result[0].text).toBe('Test message 1');
            expect(result[4].text).toBe('Test message 5');
        });

        it('should handle KV get failures gracefully', async () => {
            const chatId = 19;
            const now = Math.floor(Date.now() / 1000);

            // Create 20 messages
            await createTestMessages(chatId, 20, now - 20000, 1000);

            // Mock KV get to fail for some requests
            const originalGet = env.HISTORY.get;
            let callCount = 0;
            (vi.spyOn(env.HISTORY, 'get') as any).mockImplementation(async (key: string, options?: any) => {
                callCount++;
                if (callCount % 4 === 0) {
                    // Fail every 4th request
                    throw new Error('KV get failed');
                }
                return (originalGet as any).call(env.HISTORY, key, options);
            });

            const result = await fetchLastMessages(env, chatId, 15);

            // Should get some messages (not all due to failures)
            expect(result.length).toBeGreaterThan(0);
            expect(result.length).toBeLessThanOrEqual(15);

            // All returned messages should be valid
            result.forEach(msg => {
                expect(msg.text).toBeDefined();
                expect(msg.text.startsWith('/')).toBe(false);
            });
        });
    });

    describe('Error scenarios and graceful degradation', () => {
        it('should handle KV list failures in fetchMessages', async () => {
            const chatId = 20;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);

            // Mock KV list to fail
            vi.spyOn(env.HISTORY, 'list').mockRejectedValue(new Error('KV list failed'));

            await expect(fetchMessages(env, chatId, oneDayAgo, now)).rejects.toThrow('KV list failed');
        });

        it('should handle KV list failures in fetchLastMessages', async () => {
            const chatId = 21;

            // Mock KV list to fail
            vi.spyOn(env.HISTORY, 'list').mockRejectedValue(new Error('KV list failed'));

            await expect(fetchLastMessages(env, chatId, 10)).rejects.toThrow('KV list failed');
        });

        it('should handle partial batch failures in fetchMessages', async () => {
            const chatId = 22;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);

            // Create messages
            await createTestMessages(chatId, 20, oneDayAgo, 3600);

            // Mock some KV get calls to fail
            const originalGet = env.HISTORY.get;
            let callCount = 0;
            (vi.spyOn(env.HISTORY, 'get') as any).mockImplementation(async (key: string, options?: any) => {
                callCount++;
                if (callCount % 5 === 0) {
                    return null; // Simulate missing message
                }
                return (originalGet as any).call(env.HISTORY, key, options);
            });

            const result = await fetchMessages(env, chatId, oneDayAgo, now);

            // Should handle null results gracefully
            expect(result.length).toBeLessThan(20);
            expect(result.length).toBeGreaterThan(0);

            // All returned messages should be valid
            result.forEach(msg => {
                expect(msg).not.toBeNull();
                expect(msg.text).toBeDefined();
            });
        });

        it('should handle partial batch failures in fetchLastMessages', async () => {
            const chatId = 23;
            const now = Math.floor(Date.now() / 1000);

            // Create messages
            await createTestMessages(chatId, 15, now - 15000, 1000);

            // Mock some KV get calls to return null
            const originalGet = env.HISTORY.get;
            let callCount = 0;
            (vi.spyOn(env.HISTORY, 'get') as any).mockImplementation(async (key: string, options?: any) => {
                callCount++;
                if (callCount % 3 === 0) {
                    return null; // Simulate missing message
                }
                return (originalGet as any).call(env.HISTORY, key, options);
            });

            const result = await fetchLastMessages(env, chatId, 10);

            // Should handle null results gracefully
            expect(result.length).toBeLessThanOrEqual(10);
            expect(result.length).toBeGreaterThan(0);

            // All returned messages should be valid
            result.forEach(msg => {
                expect(msg).not.toBeNull();
                expect(msg.text).toBeDefined();
            });
        });

        it('should respect custom batch size configuration', async () => {
            const chatId = 24;
            const now = Math.floor(Date.now() / 1000);
            const oneDayAgo = now - (24 * 3600);

            // Set custom batch size
            env.KV_BATCH_SIZE = 5;

            // Create messages
            await createTestMessages(chatId, 20, oneDayAgo, 3600);

            // Spy on processBatchesDetailed to verify batch size is used
            const processBatchesSpy = vi.spyOn(await import('../../src/utils'), 'processBatchesDetailed');

            const result = await fetchMessages(env, chatId, oneDayAgo, now);

            expect(result).toHaveLength(20);

            // Verify processBatchesDetailed was called with custom batch size
            expect(processBatchesSpy).toHaveBeenCalledWith(
                expect.any(Array),
                expect.any(Function),
                expect.objectContaining({
                    batchSize: 5,
                    delayBetweenBatches: 0,
                })
            );
        });

        it('should respect custom batch delay configuration', async () => {
            const chatId = 25;
            const now = Math.floor(Date.now() / 1000);

            // Set custom batch delay
            env.KV_BATCH_DELAY = 100;

            // Create messages
            await createTestMessages(chatId, 10, now - 10000, 1000);

            // Spy on processBatchesDetailed to verify delay is used
            const processBatchesSpy = vi.spyOn(await import('../../src/utils'), 'processBatchesDetailed');

            const result = await fetchLastMessages(env, chatId, 5);

            expect(result).toHaveLength(5);

            // Verify processBatchesDetailed was called with custom delay
            expect(processBatchesSpy).toHaveBeenCalledWith(
                expect.any(Array),
                expect.any(Function),
                expect.objectContaining({
                    batchSize: DEFAULT_KV_BATCH_SIZE,
                    delayBetweenBatches: 100,
                })
            );
        });
    });

    describe('Performance and behavior validation', () => {
        it('should maintain consistent performance across different time ranges', async () => {
            const chatId = 26;
            const now = Math.floor(Date.now() / 1000);

            // Create messages for different time ranges
            const oneDayAgo = now - (24 * 3600);
            const sevenDaysAgo = now - (7 * 24 * 3600);

            // Create 168 messages (1 per hour for 7 days)
            await createTestMessages(chatId, 168, sevenDaysAgo, 3600);

            // Test 1 day range
            const start1Day = performance.now();
            const result1Day = await fetchMessages(env, chatId, oneDayAgo, now);
            const time1Day = performance.now() - start1Day;

            // Test 7 day range
            const start7Days = performance.now();
            const result7Days = await fetchMessages(env, chatId, sevenDaysAgo, now);
            const time7Days = performance.now() - start7Days;

            expect(result1Day).toHaveLength(24);
            expect(result7Days).toHaveLength(168);

            // 7-day query should not be dramatically slower than 1-day query
            // This is a rough performance check - adjust threshold as needed
            expect(time7Days).toBeLessThan(time1Day * 10);
        });

        it('should handle large message counts efficiently', async () => {
            const chatId = 27;
            const now = Math.floor(Date.now() / 1000);

            // Create 1000 messages
            await createTestMessages(chatId, 1000, now - 1000000, 1000);

            const start = performance.now();
            const result = await fetchLastMessages(env, chatId, 500);
            const duration = performance.now() - start;

            expect(result).toHaveLength(500);

            // Should complete within reasonable time (adjust threshold as needed)
            expect(duration).toBeLessThan(5000); // 5 seconds

            // Verify correct messages were returned (last 500)
            expect(result[0].text).toBe('Test message 501');
            expect(result[499].text).toBe('Test message 1000');
        });

        it('should preserve message order consistency across multiple calls', async () => {
            const chatId = 28;
            const now = Math.floor(Date.now() / 1000);

            // Create messages with specific timestamps
            await createTestMessages(chatId, 50, now - 50000, 1000);

            // Call fetchLastMessages multiple times
            const result1 = await fetchLastMessages(env, chatId, 20);
            const result2 = await fetchLastMessages(env, chatId, 20);
            const result3 = await fetchLastMessages(env, chatId, 20);

            // All results should be identical
            expect(result1).toEqual(result2);
            expect(result2).toEqual(result3);

            // Verify consistent ordering
            expect(result1).toHaveLength(20);
            expect(result1[0].text).toBe('Test message 31');
            expect(result1[19].text).toBe('Test message 50');
        });
    });
});