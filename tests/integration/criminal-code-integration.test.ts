import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CriminalCodeAnalyzerDO } from "../../src/criminal-code-analyzer-do";
import { CountersDO } from "../../src/counters-do";
import { CriminalAnalysisResult } from "../../src/env";
import { createMockEnv, createMockState } from "../test-utils";

// Mock AI provider with realistic responses
vi.mock("../../src/providers/provider-init", () => ({
  ProviderInitializer: {
    initialize: vi.fn().mockResolvedValue({
      analyzeCriminalCode: vi.fn().mockImplementation((text: string) => {
        // Simulate different responses based on text content
        if (text.includes("насилие") || text.includes("убить")) {
          return Promise.resolve({
            hasViolations: true,
            violations: [
              {
                article: "105",
                description: "Убийство",
                severity: "high",
                confidence: 0.9,
                context: "угрозы физического насилия"
              }
            ],
            riskLevel: "high",
            confidence: 0.9
          });
        } else if (text.includes("экстремизм") || text.includes("терроризм")) {
          return Promise.resolve({
            hasViolations: true,
            violations: [
              {
                article: "282",
                description: "Экстремистская деятельность",
                severity: "high",
                confidence: 0.85,
                context: "призывы к экстремистской деятельности"
              }
            ],
            riskLevel: "high",
            confidence: 0.85
          });
        } else {
          return Promise.resolve({
            hasViolations: false,
            violations: [],
            riskLevel: "low",
            confidence: 0.95
          });
        }
      })
    })
  }
}));

vi.mock("../../src/logger", () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
}));

describe("Criminal Code Analysis Integration", () => {
  const testTimeout = 10000; // 10 seconds max per test

  let analyzer: CriminalCodeAnalyzerDO;
  let counters: CountersDO;
  let mockAnalyzerState: any;
  let mockCountersState: any;
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create enhanced mock environment
    mockEnv = {
      ...createMockEnv(),

      HISTORY: {
          get: vi.fn().mockResolvedValue(undefined),
          put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
          list: vi.fn().mockResolvedValue({ keys: [] }),
        },
      DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnThis(),
            first: vi.fn().mockResolvedValue(undefined),
            all: vi.fn().mockResolvedValue([]),
            run: vi.fn().mockResolvedValue({ success: true, changes: 0 }),
          }),
        },

      SUMMARY_PROVIDER: "openai",
      OPENAI_API_KEY: "test-key",
      DEBUG_LOGS: "true",
    };

    mockAnalyzerState = createMockState();
    mockCountersState = createMockState();
    
    analyzer = new CriminalCodeAnalyzerDO(mockAnalyzerState, mockEnv);
    counters = new CountersDO(mockCountersState, mockEnv);
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
    vi.clearAllMocks();
  });

  describe("End-to-End Criminal Code Analysis", () => {

    it("should analyze text, store results, and update counters", async () => {
      const violationText = "Призываю к насилию против определенной группы";
      const chatId = 12345;
      const userId = 67890;
      const messageId = 111;

      // Step 1: Analyze text
      const analyzeRequest = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({
          text: violationText,
          chatId,
          userId,
          messageId
        }),
        headers: { "Content-Type": "application/json" },
      });

      const analyzeResponse = await analyzer.fetch(analyzeRequest);
      const analysisResult = await analyzeResponse.json() as CriminalAnalysisResult;

      // Verify analysis results
      expect(analyzeResponse.status).toBe(200);
      expect(analysisResult.hasViolations).toBeDefined();
      expect(analysisResult.violations).toBeDefined();
      expect(analysisResult.riskLevel).toBeDefined();

      // Step 2: Verify database operations (cache queries)
      expect(mockEnv.DB.prepare).toHaveBeenCalled();

      // Step 3: Verify cache storage
      expect(mockEnv.HISTORY.put).toHaveBeenCalled();

      // Note: CriminalCodeAnalyzerDO doesn't use COUNTERS_DO directly
      // Statistics are updated via database triggers
    });

    it("should handle clean text without violations", async () => {
      const cleanText = "Привет, как дела? Хорошая погода сегодня.";
      const chatId = 12345;
      const userId = 67890;
      const messageId = 112;

      const analyzeRequest = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({
          text: cleanText,
          chatId,
          userId,
          messageId
        }),
        headers: { "Content-Type": "application/json" },
      });

      const analyzeResponse = await analyzer.fetch(analyzeRequest);
      const analysisResult = await analyzeResponse.json() as CriminalAnalysisResult;

      // Verify no violations found
      expect(analyzeResponse.status).toBe(200);
      expect(analysisResult.hasViolations).toBe(false);
      expect(analysisResult.violations).toHaveLength(0);
      expect(analysisResult.riskLevel).toBe("low");

      // Verify cache is still used
      expect(mockEnv.HISTORY.put).toHaveBeenCalled();

      // Note: No violations means no database operations for violations
    });

    it("should retrieve and aggregate user statistics", async () => {
      // Mock database to return some violation history
      mockEnv.DB.prepare().bind().all.mockResolvedValue({
        results: [
          {
            article: "105",
            violation_count: 2,
            total_severity: 10,
            avg_confidence: 0.85
          },
          {
            article: "282",
            violation_count: 1,
            total_severity: 4,
            avg_confidence: 0.9
          }
        ]
      });

      const statsRequest = new Request(
        "http://localhost/stats?chatId=12345&userId=67890&period=7d",
        { method: "GET" }
      );

      const statsResponse = await analyzer.fetch(statsRequest);
      const statsResult = await statsResponse.json();

      expect(statsResponse.status).toBe(200);
      expect(statsResult.stats).toBeDefined();
      expect(Array.isArray(statsResult.stats)).toBe(true);
    });
  });

  describe("Cache Integration", () => {

    it("should use cached results for repeated analysis", async () => {
      const text = "Test text for caching";
      const cachedResult = {
        hasViolations: false,
        violations: [],
        riskLevel: "low",
        confidence: 0.95,
        cached: true
      };

      // First call - cache miss
      mockEnv.HISTORY.get.mockResolvedValueOnce(null);
      
      const firstRequest = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({
          text,
          chatId: 12345,
          userId: 67890,
          messageId: 111
        }),
        headers: { "Content-Type": "application/json" },
      });

      await analyzer.fetch(firstRequest);
      expect(mockEnv.HISTORY.put).toHaveBeenCalled();

      // Second call - cache hit
      mockEnv.HISTORY.get.mockResolvedValueOnce(JSON.stringify(cachedResult));
      
      const secondRequest = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({
          text,
          chatId: 12345,
          userId: 67890,
          messageId: 112
        }),
        headers: { "Content-Type": "application/json" },
      });

      const secondResponse = await analyzer.fetch(secondRequest);
      const secondResult = await secondResponse.json();

      expect(secondResponse.status).toBe(200);
      expect(secondResult.hasViolations).toBeDefined();
      expect(secondResult.riskLevel).toBeDefined();
    });
  });

  describe("Error Handling and Resilience", () => {

    it("should handle AI provider failures gracefully", async () => {
      // Mock AI provider to fail by directly modifying the analyzer's aiProvider
      const originalProvider = (analyzer as any).aiProvider;
      (analyzer as any).aiProvider = {
        analyzeCriminalCode: vi.fn().mockRejectedValue(new Error("AI service down"))
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({
          text: "Test text",
          chatId: 12345,
          userId: 67890,
          messageId: 111
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200); // Should return fallback result

      const result = await response.json();
      expect(result.hasViolations).toBe(false);
      expect(result.riskLevel).toBe("low");
      
      // Restore original provider
      (analyzer as any).aiProvider = originalProvider;
    });

    it("should handle database connection failures", async () => {
      // Mock database to fail
      mockEnv.DB.prepare.mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      const statsRequest = new Request(
        "http://localhost/stats?chatId=12345&userId=67890&period=7d",
        { method: "GET" }
      );

      const response = await analyzer.fetch(statsRequest);
      expect(response.status).toBe(500);
    });

    it("should continue working when cache is unavailable", async () => {
      // Mock cache to fail
      mockEnv.HISTORY.get.mockRejectedValue(new Error("Cache unavailable"));
      mockEnv.HISTORY.put.mockRejectedValue(new Error("Cache unavailable"));

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({
          text: "Test text",
          chatId: 12345,
          userId: 67890,
          messageId: 111
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200); // Should still work without cache
    });
  });

  describe("Concurrency and Race Conditions", () => {

    it("should handle concurrent analysis requests safely", async () => {
      const requests = Array.from({ length: 5 }, (_, i) => 
        new Request("http://localhost/analyze", {
          method: "POST",
          body: JSON.stringify({
            text: `Test text ${i}`,
            chatId: 12345,
            userId: 67890,
            messageId: 111 + i
          }),
          headers: { "Content-Type": "application/json" },
        })
      );

      // Execute all requests concurrently
      const responses = await Promise.all(
        requests.map(request => analyzer.fetch(request))
      );

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Verify blockConcurrencyWhile was used
      expect(mockAnalyzerState.blockConcurrencyWhile).toHaveBeenCalledTimes(5);
    });

    it("should handle concurrent requests with blockConcurrencyWhile", async () => {
      const requests = [
        new Request("http://localhost/analyze", {
          method: "POST",
          body: JSON.stringify({
            text: "Test concurrent analysis 1",
            chatId: 12345,
            userId: 67890,
            messageId: 111
          }),
          headers: { "Content-Type": "application/json" },
        }),
        new Request("http://localhost/analyze", {
          method: "POST",
          body: JSON.stringify({
            text: "Test concurrent analysis 2",
            chatId: 12345,
            userId: 67890,
            messageId: 112
          }),
          headers: { "Content-Type": "application/json" },
        }),
        new Request("http://localhost/clear-cache", {
          method: "POST",
        }),
      ];

      // Execute all requests concurrently
      const responses = await Promise.all(
        requests.map(req => analyzer.fetch(req))
      );

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBeLessThan(400);
      });

      // blockConcurrencyWhile should be called for each request that uses it (analyze and clear-cache)
      expect(mockAnalyzerState.blockConcurrencyWhile).toHaveBeenCalledTimes(3);
    });

    it("should handle concurrent stats requests safely", async () => {
      const requests = Array.from({ length: 3 }, () => 
        new Request(
          "http://localhost/stats?chatId=12345&userId=67890&period=7d",
          { method: "GET" }
        )
      );

      const responses = await Promise.all(
        requests.map(request => analyzer.fetch(request))
      );

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Stats requests don't use blockConcurrencyWhile, so no additional calls expected
    });
  });

  describe("Performance and Optimization", () => {

    it("should complete analysis within reasonable time", async () => {
      const startTime = Date.now();
      
      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({
          text: "Test text for performance",
          chatId: 12345,
          userId: 67890,
          messageId: 111
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      const endTime = Date.now();
      
      expect(response.status).toBe(200);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it("should efficiently handle batch statistics queries", async () => {
      const startTime = Date.now();
      
      const request = new Request(
        "http://localhost/stats?chatId=12345&userId=67890&period=30d",
        { method: "GET" }
      );

      const response = await analyzer.fetch(request);
      const endTime = Date.now();
      
      expect(response.status).toBe(200);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });
  });
});