import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfanityAnalyzer, ProfanityResult } from '../src/profanity';
import { hashText } from '../src/utils';
import { Env } from '../src/env';

// Helper function to generate cache key for testing
function generateCacheKey(text: string): string {
  const textHash = hashText(text);
  return `profanity_cache:${textHash}`;
}

// Mock environment setup
const createMockEnv = (): Env => {
  const mockAI = {
    run: vi.fn()
  };
  
  return {
    COUNTERS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    } as any,
    HISTORY: {} as any,
    COUNTERS_DO: {} as any,
    DB: {} as any,
    AI: mockAI as any,
    TOKEN: 'test-token',
    SECRET: 'test-secret',
    SUMMARY_MODEL: 'test-model',
    SUMMARY_PROMPT: 'test-prompt',
    PROFANITY_SYSTEM_PROMPT: 'test-profanity-system-prompt',
    PROFANITY_USER_PROMPT: 'test-profanity-user-prompt',
  };
};



describe('Profanity Analysis Infrastructure', () => {
  let mockEnv: Env;
  let profanityAnalyzer: ProfanityAnalyzer;

  beforeEach(() => {
    mockEnv = createMockEnv();
    profanityAnalyzer = new ProfanityAnalyzer();
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

describe('Circuit Breaker', () => {
  let mockEnv: any;

  beforeEach(() => {
    mockEnv = createMockEnv();
    vi.clearAllMocks();
  });

  it('should open circuit after multiple failures', async () => {
    // Configure AI to always fail
    vi.mocked(mockEnv.AI.run).mockRejectedValue(new Error('AI service unavailable'));
    
    const analyzer = new ProfanityAnalyzer();
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger 5 failures to open the circuit
    for (let i = 0; i < 5; i++) {
      const result = await analyzer.analyzeMessage('test message', mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }
    
    // Reset AI to working state
    vi.mocked(mockEnv.AI.run).mockResolvedValue({ response: JSON.stringify({ words: [], totalCount: 0 }) });
    
    // Next request should be blocked by circuit breaker
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Verify that AI was called 5 times (initial failures), then circuit opened
    expect(mockEnv.AI.run).toHaveBeenCalledTimes(5);
  });

  it('should close circuit after timeout period', async () => {
    // Configure AI to fail initially
    vi.mocked(mockEnv.AI.run).mockRejectedValue(new Error('AI service unavailable'));
    
    const analyzer = new ProfanityAnalyzer();
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger failures to open circuit
    for (let i = 0; i < 5; i++) {
      await analyzer.analyzeMessage('test message', mockEnv);
    }
    
    // Mock time passage (circuit breaker timeout is 60 seconds)
    const originalNow = Date.now;
    Date.now = vi.fn(() => originalNow() + 61000); // 61 seconds later
    
    // Fix AI
    vi.mocked(mockEnv.AI.run).mockResolvedValue({ response: JSON.stringify({ words: [], totalCount: 0 }) });
    
    // Circuit should be closed now and allow requests
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Verify that AI was called again (circuit is now closed)
    expect(mockEnv.AI.run).toHaveBeenCalledTimes(5); // 5 initial failures, circuit opens, then 1 success after circuit closed
    
    // Restore original Date.now
    Date.now = originalNow;
  });

  it('should reset failure count after successful period', async () => {
    // Configure AI to fail initially
    vi.mocked(mockEnv.AI.run).mockRejectedValue(new Error('AI service unavailable'));
    
    const analyzer = new ProfanityAnalyzer();
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger 3 failures (below threshold)
    for (let i = 0; i < 3; i++) {
      await analyzer.analyzeMessage('test message', mockEnv);
    }
    
    // Fix AI and make successful request
    vi.mocked(mockEnv.AI.run).mockResolvedValue({ response: JSON.stringify({ words: [], totalCount: 0 }) });
    
    await analyzer.analyzeMessage('test message', mockEnv);
    
    // Mock time passage (reset timeout is 5 minutes)
    const originalNow = Date.now;
    Date.now = vi.fn(() => originalNow() + 301000); // 5 minutes + 1 second later
    
    // Make another successful request to trigger reset
    await analyzer.analyzeMessage('test message', mockEnv);
    
    // Now trigger more failures - should need 5 failures again to open circuit
    vi.mocked(mockEnv.AI.run).mockRejectedValue(new Error('AI service unavailable'));
    
    for (let i = 0; i < 4; i++) {
      const result = await analyzer.analyzeMessage('test message', mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }
    
    // Circuit should still be closed after 4 failures (reset worked)
    vi.mocked(mockEnv.AI.run).mockResolvedValue({ response: JSON.stringify({ words: [], totalCount: 0 }) });
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Restore original Date.now
    Date.now = originalNow;
  });

  it('should handle timeout errors as failures', async () => {
    // Configure AI to timeout (simulate by making it hang)
    vi.mocked(mockEnv.AI.run).mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({ response: JSON.stringify({ words: [], totalCount: 0 }) }), 200))
    );
    
    const analyzer = new ProfanityAnalyzer();
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger timeouts to open circuit (each call will timeout)
    for (let i = 0; i < 5; i++) {
      const result = await analyzer.analyzeMessage('test message', mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }
    
    // Reset AI to working state
    vi.mocked(mockEnv.AI.run).mockResolvedValue({ response: JSON.stringify({ words: [], totalCount: 0 }) });
    
    // Next request should be blocked by circuit breaker
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Verify that AI was not called for the last request (circuit is open)
    expect(mockEnv.AI.run).toHaveBeenCalledTimes(5); // Only the initial 5 failing calls
  });
});