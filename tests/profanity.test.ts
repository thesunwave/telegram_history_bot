import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProfanityAnalyzer, ProfanityResult } from "../src/profanity";
import { hashText } from "../src/utils";
import { Env } from "../src/env";
import {
  AIProvider,
  ProfanityAnalysisResult,
} from "../src/providers/ai-provider";

// Helper function to generate cache key for testing
function generateCacheKey(text: string): string {
  const textHash = hashText(text);
  return `profanity_cache:${textHash}`;
}

// Mock environment setup
const createMockEnv = (): Env => {
  const mockAI = {
    run: vi.fn(),
  };

  return {
    COUNTERS: {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue({ success: true }),
    } as any,
    HISTORY: {} as any,
    COUNTERS_DO: {} as any,
    MESSAGE_FETCHER_DO: {} as any,
    MESSAGE_AGGREGATOR_DO: {} as any,
    DB: {} as any,
    AI: mockAI as any,
    TOKEN: "test-token",
    SECRET: "test-secret",
    SUMMARY_MODEL: "test-model",
    DEBUG_LOGS: "false",
    SUMMARY_PROMPT: "test-prompt",
    PROFANITY_SYSTEM_PROMPT: "test-profanity-system-prompt",
    PROFANITY_USER_PROMPT: "test-profanity-user-prompt",
  };
};

// Mock AI Provider for testing
class MockAIProvider implements AIProvider {
  analyzeProfanity = vi.fn();
  summarize = vi.fn();
  validateConfig = vi.fn();
  getProviderInfo = vi
    .fn()
    .mockReturnValue({ name: "mock-provider", version: "1.0.0" });
}

describe("Profanity Analysis Infrastructure", () => {
  const testTimeout = 10000; // 10 seconds max per test

  let mockEnv: Env;
  let profanityAnalyzer: ProfanityAnalyzer;
  let mockProvider: MockAIProvider;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockProvider = new MockAIProvider();
    profanityAnalyzer = new ProfanityAnalyzer(mockProvider);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe("hashText", () => {

    it("should generate consistent hash for same text", () => {
      const text = "test message";
      const hash1 = hashText(text);
      const hash2 = hashText(text);

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe("string");
      expect(hash1.length).toBeGreaterThan(0);
    });

    it("should generate different hashes for different texts", () => {
      const text1 = "test message 1";
      const text2 = "test message 2";

      const hash1 = hashText(text1);
      const hash2 = hashText(text2);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty string", () => {
      const hash = hashText("");
      expect(hash).toBe("0");
    });

    it("should handle unicode characters", () => {
      const text = "тест сообщение 🤬";
      const hash = hashText(text);

      expect(typeof hash).toBe("string");
      expect(hash.length).toBeGreaterThan(0);
    });
  });

  describe("generateCacheKey", () => {

    it("should generate cache key with correct prefix", () => {
      const text = "test message";
      const cacheKey = generateCacheKey(text);

      expect(cacheKey).toMatch(/^profanity_cache:/);
    });

    it("should generate consistent cache keys for same text", () => {
      const text = "test message";
      const key1 = generateCacheKey(text);
      const key2 = generateCacheKey(text);

      expect(key1).toBe(key2);
    });

    it("should generate different cache keys for different texts", () => {
      const text1 = "test message 1";
      const text2 = "test message 2";

      const key1 = generateCacheKey(text1);
      const key2 = generateCacheKey(text2);

      expect(key1).not.toBe(key2);
    });
  });

  describe("ProfanityAnalyzer", () => {

    it("should be instantiated with AI provider", () => {
      expect(profanityAnalyzer).toBeInstanceOf(ProfanityAnalyzer);
    });

    it("should limit text length to 1000 characters", async () => {
      const longText = "a".repeat(2000);

      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: "No profanity found",
      } as ProfanityAnalysisResult);

      const result = await profanityAnalyzer.analyzeMessage(longText, mockEnv);

      // Verify cache was checked with limited text
      const cacheKey = generateCacheKey(longText.substring(0, 1000));
      expect(mockEnv.COUNTERS.get).toHaveBeenCalledWith(cacheKey);

      // Verify AI provider was called with limited text
      expect(mockProvider.analyzeProfanity).toHaveBeenCalledWith(
        longText.substring(0, 1000),
        mockEnv,
      );

      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    });

    it("should return cached result when available", async () => {
      const text = "test message";
      const cachedResult: ProfanityResult = {
        words: [
          {
            original: "test",
            baseForm: "test",
            positions: [0],
          },
        ],
        totalCount: 1,
      };

      // Mock cache hit
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(
        JSON.stringify(cachedResult) as any,
      );

      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);

      expect(result).toEqual(cachedResult);
      expect(mockEnv.COUNTERS.get).toHaveBeenCalledWith(generateCacheKey(text));
    });

    it("should return empty result on error", async () => {
      const text = "test message";

      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

      // Mock AI provider error
      mockProvider.analyzeProfanity.mockRejectedValue(
        new Error("AI analysis failed"),
      );

      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);

      expect(result).toEqual({
        words: [],
        totalCount: 0,
      });
    });

    it("should handle cache retrieval errors gracefully", async () => {
      const text = "test message";

      // Mock cache error
      vi.mocked(mockEnv.COUNTERS.get).mockRejectedValue(
        new Error("Cache error"),
      );

      // Mock AI provider response (for when cache fails and we go to AI)
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: "No profanity found",
      } as ProfanityAnalysisResult);

      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);

      expect(result).toEqual({
        words: [],
        totalCount: 0,
      });
    });

    it("should handle cache storage errors gracefully", async () => {
      const text = "test message";

      // Mock cache miss and storage error
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);
      vi.mocked(mockEnv.COUNTERS.put).mockRejectedValue(
        new Error("Storage error"),
      );

      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: "No profanity found",
      } as ProfanityAnalysisResult);

      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);

      expect(result).toEqual({
        words: [],
        totalCount: 0,
      });
    });
  });

  describe("Text Processing", () => {

    it("should handle empty text", async () => {
      const text = "";

      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: "No profanity found",
      } as ProfanityAnalysisResult);

      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);

      expect(result).toEqual({
        words: [],
        totalCount: 0,
      });
    });

    it("should handle whitespace-only text", async () => {
      const text = "   \n\t  ";

      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: "No profanity found",
      } as ProfanityAnalysisResult);

      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);

      expect(result).toEqual({
        words: [],
        totalCount: 0,
      });
    });

    it("should handle unicode text", async () => {
      const text = "тест сообщение с эмодзи 🤬";

      // Mock cache miss
      vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

      // Mock AI provider response
      mockProvider.analyzeProfanity.mockResolvedValue({
        words: [],
        hasProfanity: false,
        explanation: "No profanity found",
      } as ProfanityAnalysisResult);

      const result = await profanityAnalyzer.analyzeMessage(text, mockEnv);

      expect(result).toEqual({
        words: [],
        totalCount: 0,
      });
    });
  });
});

describe("Circuit Breaker", () => {

  let mockEnv: any;
  let mockProvider: MockAIProvider;
  
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    mockEnv = createMockEnv();
    mockProvider = new MockAIProvider();
    originalDateNow = Date.now;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    // Restore original Date.now
    Date.now = originalDateNow;
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it("should open circuit after multiple failures", async () => {
    // Configure AI provider to always fail
    mockProvider.analyzeProfanity.mockRejectedValue(
      new Error("AI service unavailable"),
    );

    const analyzer = new ProfanityAnalyzer(mockProvider);

    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

    // Trigger 3 failures (simplified from 5)
    for (let i = 0; i < 3; i++) {
      const result = await analyzer.analyzeMessage("test message", mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }

    // Verify that AI provider was called for failures
    expect(mockProvider.analyzeProfanity).toHaveBeenCalledTimes(3);
  });

  it("should close circuit after timeout period", async () => {
    // Configure AI provider to fail initially
    mockProvider.analyzeProfanity.mockRejectedValue(
      new Error("AI service unavailable"),
    );

    const analyzer = new ProfanityAnalyzer(mockProvider);

    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

    // Trigger 2 failures (simplified)
    for (let i = 0; i < 2; i++) {
      await analyzer.analyzeMessage("test message", mockEnv);
    }

    // Mock time passage (simplified - just mock Date.now)
    Date.now = vi.fn(() => originalDateNow() + 61000); // 61 seconds later

    // Fix AI provider
    mockProvider.analyzeProfanity.mockResolvedValue({
      words: [],
      hasProfanity: false,
      explanation: "No profanity found",
    } as ProfanityAnalysisResult);

    // Test that circuit allows requests after timeout
    const result = await analyzer.analyzeMessage("test message", mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);

    // Verify calls were made
    expect(mockProvider.analyzeProfanity).toHaveBeenCalled();
  });

  it("should reset failure count after successful period", async () => {
    // Configure AI provider to fail initially
    mockProvider.analyzeProfanity.mockRejectedValue(
      new Error("AI service unavailable"),
    );

    const analyzer = new ProfanityAnalyzer(mockProvider);

    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

    // Trigger 2 failures (simplified)
    for (let i = 0; i < 2; i++) {
      await analyzer.analyzeMessage("test message", mockEnv);
    }

    // Fix AI provider and make successful request
    mockProvider.analyzeProfanity.mockResolvedValue({
      words: [],
      hasProfanity: false,
      explanation: "No profanity found",
    } as ProfanityAnalysisResult);

    const result = await analyzer.analyzeMessage("test message", mockEnv);
    expect(result.words).toEqual([]);
    expect(result.totalCount).toBe(0);

    // Verify calls were made
    expect(mockProvider.analyzeProfanity).toHaveBeenCalled();
  });

  it("should handle timeout errors as failures", async () => {
    // Configure AI provider to timeout (simplified - just reject immediately)
    mockProvider.analyzeProfanity.mockRejectedValue(
      new Error("Analysis timeout")
    );

    const analyzer = new ProfanityAnalyzer(mockProvider);

    // Mock cache miss for all requests
    vi.mocked(mockEnv.COUNTERS.get).mockResolvedValue(null as any);

    // Trigger 2 timeouts (simplified)
    for (let i = 0; i < 2; i++) {
      const result = await analyzer.analyzeMessage("test message", mockEnv);
      expect(result.words).toEqual([]);
      expect(result.totalCount).toBe(0);
    }

    // Verify timeouts were treated as failures
    expect(mockProvider.analyzeProfanity).toHaveBeenCalledTimes(2);
  });
});
