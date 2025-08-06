import { describe, it, expect, beforeEach } from 'vitest';
import { ProfanityAnalyzer } from '../src/profanity';
import { Env } from '../src/env';
import { AIProvider, ProfanityAnalysisResult } from '../src/providers/ai-provider';

// Mock AI Provider that returns empty results
class EmptyResultAIProvider implements AIProvider {
    async analyzeProfanity(text: string, env: Env): Promise<ProfanityAnalysisResult> {
        return {
            hasProfanity: false,
            words: []
        };
    }

    async summarize(request: any, options: any, env?: any): Promise<string> {
        return 'Mock summary';
    }

    validateConfig(): void {
        // Mock validation
    }

    getProviderInfo() {
        return { name: 'empty-mock-provider', model: 'test' };
    }
}

// Mock AI Provider that returns profanity
class ProfanityResultAIProvider implements AIProvider {
    async analyzeProfanity(text: string, env: Env): Promise<ProfanityAnalysisResult> {
        return {
            hasProfanity: true,
            words: [
                { word: 'badword', baseForm: 'badword', confidence: 0.9 }
            ]
        };
    }

    async summarize(request: any, options: any, env?: any): Promise<string> {
        return 'Mock summary';
    }

    validateConfig(): void {
        // Mock validation
    }

    getProviderInfo() {
        return { name: 'profanity-mock-provider', model: 'test' };
    }
}

describe('Profanity Empty Cache Behavior', () => {
    let mockEnv: Env;
    let analyzer: ProfanityAnalyzer;
    let kvStorage: Map<string, string>;

    beforeEach(() => {
        kvStorage = new Map();

        mockEnv = {
            COUNTERS: {
                get: async (key: string) => kvStorage.get(key) || null,
                put: async (key: string, value: string, options?: any) => {
                    kvStorage.set(key, value);
                },
                list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
                delete: async (key: string) => { kvStorage.delete(key); }
            }
        } as any;
    });

    it('should not cache empty profanity results', async () => {
        const emptyProvider = new EmptyResultAIProvider();
        analyzer = new ProfanityAnalyzer(emptyProvider);

        const text = "This is a clean message";

        // First analysis - should not be cached
        const result1 = await analyzer.analyzeMessage(text, mockEnv);

        expect(result1.totalCount).toBe(0);
        expect(result1.words).toHaveLength(0);

        // Check that nothing was stored in KV
        expect(kvStorage.size).toBe(0);

        // Second analysis - should call AI again since nothing was cached
        const result2 = await analyzer.analyzeMessage(text, mockEnv);

        expect(result2.totalCount).toBe(0);
        expect(result2.words).toHaveLength(0);

        // Still nothing in cache
        expect(kvStorage.size).toBe(0);
    });

    it('should cache non-empty profanity results', async () => {
        const profanityProvider = new ProfanityResultAIProvider();
        analyzer = new ProfanityAnalyzer(profanityProvider);

        const text = "This message has badword in it";

        // First analysis - should be cached
        const result1 = await analyzer.analyzeMessage(text, mockEnv);

        expect(result1.totalCount).toBe(1);
        expect(result1.words).toHaveLength(1);
        expect(result1.words[0].original).toBe('badword');

        // Check that result was stored in KV
        expect(kvStorage.size).toBe(1);

        // Verify the cached content
        const cacheKey = Array.from(kvStorage.keys())[0];
        expect(cacheKey).toMatch(/^profanity_cache:/);

        const cachedValue = kvStorage.get(cacheKey);
        const parsedCache = JSON.parse(cachedValue!);
        expect(parsedCache.totalCount).toBe(1);
        expect(parsedCache.words).toHaveLength(1);
    });

    it('should handle mixed empty and non-empty results correctly', async () => {
        // Test empty result first
        const emptyProvider = new EmptyResultAIProvider();
        analyzer = new ProfanityAnalyzer(emptyProvider);

        const cleanText = "Clean message";
        const result1 = await analyzer.analyzeMessage(cleanText, mockEnv);

        expect(result1.totalCount).toBe(0);
        expect(kvStorage.size).toBe(0);

        // Switch to profanity provider
        const profanityProvider = new ProfanityResultAIProvider();
        analyzer = new ProfanityAnalyzer(profanityProvider);

        const dirtyText = "Message with badword";
        const result2 = await analyzer.analyzeMessage(dirtyText, mockEnv);

        expect(result2.totalCount).toBe(1);
        expect(kvStorage.size).toBe(1); // Only the non-empty result is cached
    });
});