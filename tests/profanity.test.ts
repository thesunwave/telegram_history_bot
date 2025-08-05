import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfanityAnalyzer, generateCacheKey, ProfanityResult, ProfanityAnalysisResult } from '../src/profanity';
import { hashText } from '../src/utils';
import { AIProvider } from '../src/providers/ai-provider';
import { Env } from '../src/env';

// Mock AI Provider
class MockAIProvider implements AIProvider {
  async summarize(): Promise<string> {
    return 'mock summary';
  }
  
  validateConfig(): void {}
  
  getProviderInfo() {
    return { name: 'mock', model: 'mock-model' };
  }
}

// Mock environment
const createMockEnv = (): Env => ({
  COUNTERS: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  } as any,
  HISTORY: {} as any,
  COUNTERS_DO: {} as any,
  DB: {} as any,
  AI: {} as any,
  TOKEN: 'test-token',
  SECRET: 'test-secret',
  SUMMARY_MODEL: 'test-model',
  SUMMARY_PROMPT: 'test-prompt',
});

describe('Profanity Analysis Infrastructure', () => {
  let mockEnv: Env;
  let mockAIProvider: MockAIProvider;
  let profanityAnalyzer: ProfanityAnalyzer;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockAIProvider = new MockAIProvider();
    profanityAnalyzer = new ProfanityAnalyzer(mockAIProvider);
    vi.clearAllMocks();
  });

  describe('hashText', () => {
    it('should generate consistent hash for same text', () => {
      const text = 'test message';
      const hash1 = hashText(text);
      const hash2 = hashText(text);
      
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
      expect(hash1.length).toBeGreaterThan(0);
    });

    it('should generate different hashes for different texts', () => {
      const text1 = 'test message 1';
      const text2 = 'test message 2';
      
      const hash1 = hashText(text1);
      const hash2 = hashText(text2);
      
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = hashText('');
      expect(hash).toBe('0');
    });

    it('should handle unicode characters', () => {
      const text = 'тест сообщение 🤬';
      const hash = hashText(text);
      
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe('generateCacheKey', () => {
    it('should generate cache key with correct prefix', () => {
      const text = 'test message';
      const cacheKey = generateCacheKey(text);
      
      expect(cacheKey).toMatch(/^profanity_cache:/);
    });

    it('should generate consistent cache keys for same text', () => {
      const text = 'test message';
      const key1 = generateCacheKey(text);
      const key2 = generateCacheKey(text);
      
      expect(key1).toBe(key2);
    });

    it('should generate different cache keys for different texts', () => {
      const text1 = 'test message 1';
      const text2 = 'test message 2';
      
      const key1 = generateCacheKey(text1);
      const key2 = generateCacheKey(text2);
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('ProfanityAnalyzer', () => {
    it('should be instantiated with AI provider', () => {
      expect(profanityAnalyzer).toBeInstanceOf(ProfanityAnalyzer);
    });

    it('should limit text length to 1000 characters', async () => {
      const longText = 'a'.repeat(2000);
      
      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
      
      try {
        await profanityAnalyzer.analyzeMessage(longText, mockEnv);
      } catch (error) {
        // Expected to fail since AI provider is not implemented yet
        expect(error).toBeDefined();
      }
      
      // Verify cache was checked with limited text
      const cacheKey = generateCacheKey(longText.substring(0, 1000));
      expect(mockEnv.COUNTERS.get).toHaveBeenCalledWith(cacheKey);
    });

    it('should return cached result when available', async () => {
      const text = 'test message';
      const cachedResult: ProfanityResult = {
        words: [
          {
            original: 'test',
            baseForm: 'test',
            positions: [0]
          }
        ],
        totalCount: 1
      };
      
      // Mock cache hit
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(JSON.stringify(cachedResult) as any);
      
      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);
      
      expect(result).toEqual(cachedResult);
      expect(mockEnv.COUNTERS.get).toHaveBeenCalledWith(generateCacheKey(text));
    });

    it('should return empty result on error', async () => {
      const text = 'test message';
      
      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
      
      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);
      
      expect(result).toEqual({
        words: [],
        totalCount: 0
      });
    });

    it('should handle cache retrieval errors gracefully', async () => {
      const text = 'test message';
      
      // Mock cache error
      vi.mocked(mockEnv.COUNTERS.get).mockRejectedValue(new Error('Cache error'));
      
      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);
      
      expect(result).toEqual({
        words: [],
        totalCount: 0
      });
    });

    it('should handle cache storage errors gracefully', async () => {
      const text = 'test message';
      
      // Mock cache miss and storage error
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
      vi.mocked(mockEnv.COUNTERS.put).mockRejectedValue(new Error('Storage error'));
      
      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);
      
      expect(result).toEqual({
        words: [],
        totalCount: 0
      });
    });
  });

  describe('Text Processing', () => {
    it('should handle empty text', async () => {
      const text = '';
      
      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
      
      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);
      
      expect(result).toEqual({
        words: [],
        totalCount: 0
      });
    });

    it('should handle whitespace-only text', async () => {
      const text = '   \n\t  ';
      
      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
      
      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);
      
      expect(result).toEqual({
        words: [],
        totalCount: 0
      });
    });

    it('should handle unicode text', async () => {
      const text = 'тест сообщение с эмодзи 🤬';
      
      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
      
      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);
      
      expect(result).toEqual({
        words: [],
        totalCount: 0
      });
    });
  });
});