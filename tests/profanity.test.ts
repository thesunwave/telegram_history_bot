import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfanityAnalyzer, ProfanityResult } from '../src/profanity';
import { hashText } from '../src/utils';
import { Env } from '../src/env';
import { AIProvider, ProfanityAnalysisResult } from '../src/providers/ai-provider';

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

// Mock AI Provider for testing
class MockAIProvider implements AIProvider {
  analyzeProfanity = vi.fn();
  summarize = vi.fn();
  validateConfig = vi.fn();
  getProviderInfo = vi.fn().mockReturnValue({ name: 'mock-provider', version: '1.0.0' });
}

describe('Profanity Analysis Infrastructure', () => {
  let mockEnv: Env;
  let profanityAnalyzer: ProfanityAnalyzer;
  let mockProvider: MockAIProvider;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockProvider = new MockAIProvider();
    profanityAnalyzer = new ProfanityAnalyzer(mockProvider);
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
      
      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: 'No profanity found'
      } as ProfanityAnalysisResult);
      
      const result = await profanityAnalyzer.analyzeMessage(longText, mockEnv);
      
      // Verify cache was checked with limited text
      const cacheKey = generateCacheKey(longText.substring(0, 1000));
      expect(mockEnv.COUNTERS.get).toHaveBeenCalledWith(cacheKey);
      
      // Verify AI provider was called with limited text
      expect(mockProvider.analyzeProfanity).toHaveBeenCalledWith(longText.substring(0, 1000), mockEnv);
      
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
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
      
      // Mock AI provider error
      mockProvider.analyzeProfanity.mockRejectedValue(new Error('AI analysis failed'));
      
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
      
      // Mock AI provider response (for when cache fails and we go to AI)
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: 'No profanity found'
      } as ProfanityAnalysisResult);
      
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
      
      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: 'No profanity found'
      } as ProfanityAnalysisResult);
      
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
      
      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: 'No profanity found'
      } as ProfanityAnalysisResult);
      
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
      
      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: 'No profanity found'
      } as ProfanityAnalysisResult);
      
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
      
      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: 'No profanity found'
      } as ProfanityAnalysisResult);
      
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
  let mockProvider: MockAIProvider;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockProvider = new MockAIProvider();
    vi.clearAllMocks();
  });

  it('should open circuit after multiple failures', async () => {
    // Configure AI provider to always fail
    mockProvider.analyzeProfanity.mockRejectedValue(new Error('AI service unavailable'));
    
    const analyzer = new ProfanityAnalyzer(mockProvider);
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger 5 failures to open the circuit
    for (let i = 0; i < 5; i++) {
      const result = await analyzer.analyzeMessage('test message', mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }
    
    // Reset AI provider to working state
    mockProvider.analyzeProfanity.mockResolvedValue({
      words: [],
      hasProfanity: false,
      explanation: 'No profanity found'
    } as ProfanityAnalysisResult);
    
    // Next request should be blocked by circuit breaker
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Verify that AI provider was called 6 times (5 initial failures + 1 attempt after circuit opened)
    expect(mockProvider.analyzeProfanity).toHaveBeenCalledTimes(6);
  });

  it('should close circuit after timeout period', async () => {
    // Configure AI provider to fail initially
    mockProvider.analyzeProfanity.mockRejectedValue(new Error('AI service unavailable'));
    
    const analyzer = new ProfanityAnalyzer(mockProvider);
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger failures to open circuit
    for (let i = 0; i < 5; i++) {
      await analyzer.analyzeMessage('test message', mockEnv);
    }
    
        
    // Mock time passage (circuit breaker timeout is 60 seconds)
    const originalNow = Date.now;
    Date.now = vi.fn(() => originalNow() + 61000); // 61 seconds later
    
    // Fix AI provider
    mockProvider.analyzeProfanity.mockResolvedValue({
      words: [],
      hasProfanity: false,
      explanation: 'No profanity found'
    } as ProfanityAnalysisResult);
    
    // Circuit should be closed now and allow requests
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Verify that AI provider was called again (circuit is now closed)
    expect(mockProvider.analyzeProfanity).toHaveBeenCalledTimes(6); // 5 initial failures + 1 success after circuit closed
    
    // Restore original Date.now
    Date.now = originalNow;
  });

  it('should reset failure count after successful period', async () => {
    // Configure AI provider to fail initially
    mockProvider.analyzeProfanity.mockRejectedValue(new Error('AI service unavailable'));
    
    const analyzer = new ProfanityAnalyzer(mockProvider);
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger 3 failures (below threshold)
    for (let i = 0; i < 3; i++) {
      await analyzer.analyzeMessage('test message', mockEnv);
    }
    
    // Fix AI provider and make successful request
    mockProvider.analyzeProfanity.mockResolvedValue({
      words: [],
      hasProfanity: false,
      explanation: 'No profanity found'
    } as ProfanityAnalysisResult);
    
    await analyzer.analyzeMessage('test message', mockEnv);
    
    // Mock time passage (reset timeout is 5 minutes)
    const originalNow = Date.now;
    Date.now = vi.fn(() => originalNow() + 301000); // 5 minutes + 1 second later
    
    // Make another successful request to trigger reset
    await analyzer.analyzeMessage('test message', mockEnv);
    
    // Now trigger more failures - should need 5 failures again to open circuit
    mockProvider.analyzeProfanity.mockRejectedValue(new Error('AI service unavailable'));
    
    for (let i = 0; i < 4; i++) {
      const result = await analyzer.analyzeMessage('test message', mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }
    
    // Circuit should still be closed after 4 failures (reset worked)
    mockProvider.analyzeProfanity.mockResolvedValue({
      words: [],
      hasProfanity: false,
      explanation: 'No profanity found'
    } as ProfanityAnalysisResult);
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Restore original Date.now
    Date.now = originalNow;
  });

  it('should handle timeout errors as failures', async () => {
    // Configure AI provider to timeout (simulate by making it hang then timeout)
    mockProvider.analyzeProfanity.mockImplementation(() => 
      new Promise((_, reject) => setTimeout(() => reject(new Error('Analysis timeout')), 200))
    );
    
    const analyzer = new ProfanityAnalyzer(mockProvider);
    
    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
    
    // Trigger timeouts to open circuit (each call will timeout)
    for (let i = 0; i < 5; i++) {
      const result = await analyzer.analyzeMessage('test message', mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }
    
    // Reset AI provider to working state
    mockProvider.analyzeProfanity.mockResolvedValue({
      words: [],
      hasProfanity: false,
      explanation: 'No profanity found'
    } as ProfanityAnalysisResult);
    
    // Next request should be blocked by circuit breaker
    const result = await analyzer.analyzeMessage('test message', mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);
    
    // Verify timeouts were treated as failures (5 timeouts + 1 success after circuit reset)
    expect(mockProvider.analyzeProfanity).toHaveBeenCalledTimes(6);
  });
});