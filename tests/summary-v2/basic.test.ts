/**
 * Summary V2 Basic Tests
 * 
 * Tests for ADR-002 Summary V2 pipeline components.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    DEFAULT_V2_CONFIG,
    createBatches,
    mergeAndCompactEvents,
    getCacheKey,
    getCacheKeyFromPeriod,
    loadV2Config,
    isV2Enabled,
    EventEntry,
    EventLog,
} from '../../src/summary-v2';
import { TelegramMessage } from '../../src/providers/ai-provider';

describe('Summary V2 Types and Config', () => {
    describe('DEFAULT_V2_CONFIG', () => {
        it('should have sensible defaults', () => {
            expect(DEFAULT_V2_CONFIG.enabled).toBe(false);
            expect(DEFAULT_V2_CONFIG.maxMessagesPerBatch).toBe(75);
            expect(DEFAULT_V2_CONFIG.nanoMaxTokens).toBe(2000);
            expect(DEFAULT_V2_CONFIG.miniMaxTokens).toBe(4000);
            expect(DEFAULT_V2_CONFIG.cacheTTL).toBe(7 * 24 * 60 * 60);
            expect(DEFAULT_V2_CONFIG.version).toBe('v2.0');
            expect(DEFAULT_V2_CONFIG.maxNanoCalls).toBe(5);
        });
    });

    describe('loadV2Config', () => {
        it('should load defaults when no env vars set', () => {
            const mockEnv = {} as any;
            const config = loadV2Config(mockEnv);

            expect(config.enabled).toBe(false);
            expect(config.maxMessagesPerBatch).toBe(75);
        });

        it('should load values from env', () => {
            const mockEnv = {
                SUMMARY_V2_ENABLED: 'true',
                SUMMARY_V2_MAX_MESSAGES_PER_BATCH: '100',
                SUMMARY_V2_NANO_MAX_TOKENS: '3000',
            } as any;

            const config = loadV2Config(mockEnv);

            expect(config.enabled).toBe(true);
            expect(config.maxMessagesPerBatch).toBe(100);
            expect(config.nanoMaxTokens).toBe(3000);
        });
    });

    describe('isV2Enabled', () => {
        it('should return false when not set', () => {
            const mockEnv = {} as any;
            expect(isV2Enabled(mockEnv)).toBe(false);
        });

        it('should return true when set to true', () => {
            const mockEnv = { SUMMARY_V2_ENABLED: 'true' } as any;
            expect(isV2Enabled(mockEnv)).toBe(true);
        });

        it('should return true when set to 1', () => {
            const mockEnv = { SUMMARY_V2_ENABLED: '1' } as any;
            expect(isV2Enabled(mockEnv)).toBe(true);
        });
    });
});

describe('Summary Cache', () => {
    describe('getCacheKey', () => {
        it('should generate correct cache key format', () => {
            const key = getCacheKey(12345, 999999, 'v2.0');
            expect(key).toBe('summary_v2:9ix:999999:v2.0');
        });

        it('should use default version', () => {
            const key = getCacheKey(12345, 999999);
            expect(key).toContain('v2.0');
        });
    });

    describe('getCacheKeyFromPeriod', () => {
        it('should generate key from period', () => {
            const key = getCacheKeyFromPeriod(12345, 1000, 2000, 100);
            expect(key).toMatch(/^summary_v2:9ix:p[a-z0-9]+:v2\.0$/);
        });

        it('should generate different keys for different periods', () => {
            const key1 = getCacheKeyFromPeriod(12345, 1000, 2000, 100);
            const key2 = getCacheKeyFromPeriod(12345, 1000, 3000, 100);
            expect(key1).not.toBe(key2);
        });
    });
});

describe('Event Log Builder Helpers', () => {
    describe('createBatches', () => {
        const createMessages = (count: number): TelegramMessage[] => {
            return Array.from({ length: count }, (_, i) => ({
                username: `user${i % 3}`,
                text: `Message ${i}`,
                ts: 1000000 + i * 60,
            }));
        };

        it('should create single batch for small message count', () => {
            const messages = createMessages(10);
            const batches = createBatches(messages, 75);

            expect(batches.length).toBe(1);
            expect(batches[0].messages.length).toBe(10);
            expect(batches[0].index).toBe(0);
        });

        it('should create multiple batches for large message count', () => {
            const messages = createMessages(200);
            const batches = createBatches(messages, 75);

            expect(batches.length).toBe(3);
            expect(batches[0].messages.length).toBe(75);
            expect(batches[1].messages.length).toBe(75);
            expect(batches[2].messages.length).toBe(50);
        });

        it('should set correct timestamps for batches', () => {
            const messages = createMessages(100);
            const batches = createBatches(messages, 75);

            expect(batches[0].startTs).toBe(messages[0].ts);
            expect(batches[0].endTs).toBe(messages[74].ts);
            expect(batches[1].startTs).toBe(messages[75].ts);
        });
    });

    describe('mergeAndCompactEvents', () => {
        it('should filter out low-importance events', () => {
            const events: EventEntry[] = [
                { topic: 'test', speaker: 'user1', summary: 'High importance', importance: 0.8 },
                { topic: 'test', speaker: 'user2', summary: 'Low importance', importance: 0.1 },
                { topic: 'test', speaker: 'user3', summary: 'Medium importance', importance: 0.5 },
            ];

            const merged = mergeAndCompactEvents(events, 0.3);

            expect(merged.length).toBe(2);
            expect(merged.map(e => e.speaker)).toEqual(['user1', 'user3']);
        });

        it('should merge adjacent events from same speaker on same topic', () => {
            const events: EventEntry[] = [
                { topic: 'coffee', speaker: 'user1', summary: 'I want coffee', importance: 0.5 },
                { topic: 'coffee', speaker: 'user1', summary: 'Need it now', importance: 0.4 },
                { topic: 'work', speaker: 'user1', summary: 'Let us start', importance: 0.5 },
            ];

            const merged = mergeAndCompactEvents(events, 0.3);

            expect(merged.length).toBe(2);
            expect(merged[0].summary).toBe('I want coffee; Need it now');
            expect(merged[1].summary).toBe('Let us start');
        });

        it('should not merge high-importance events', () => {
            const events: EventEntry[] = [
                { topic: 'urgent', speaker: 'user1', summary: 'Critical issue', importance: 0.9 },
                { topic: 'urgent', speaker: 'user1', summary: 'Very important', importance: 0.85 },
            ];

            const merged = mergeAndCompactEvents(events, 0.3);

            expect(merged.length).toBe(2);
        });
    });
});
