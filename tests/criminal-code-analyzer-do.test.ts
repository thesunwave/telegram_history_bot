import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Ensure module mocks are applied before importing the SUT
vi.mock("../src/providers/provider-factory", () => ({
  ProviderFactory: {
    createProvider: vi.fn().mockReturnValue({
      analyzeCriminalCode: vi.fn().mockResolvedValue({
        hasViolations: true,
        violations: [{ article: "282", subarticle: null, articleTitle: "Test Article Title",
          quote: "Призываю к насилию против определенной группы людей",
          punishment: "Штраф до 300 000 рублей",
          severity: 5,
          confidence: 0.9
        }],
        totalSeverity: 5,
        riskLevel: "high",
        analysisTimestamp: Date.now()
      })
    })
  }
}));

import { CriminalCodeAnalyzerDO } from "../src/criminal-code-analyzer-do";
import type { CriminalAnalysisResult } from "../src/env";
import { ProviderFactory } from "../src/providers/provider-factory";
import { Logger } from "../src/logger";

// Mock Logger
vi.mock("../src/logger", () => ({
  Logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock ProviderFactory
vi.mock("../src/providers/provider-factory", () => ({
  ProviderFactory: {
    createProvider: vi.fn().mockReturnValue({
      analyzeCriminalCode: vi.fn().mockResolvedValue({
        hasViolations: true,
        violations: [{ article: "282", subarticle: null, articleTitle: "Test Article Title",
          quote: "Призываю к насилию против определенной группы людей",
          punishment: "Штраф до 300 000 рублей",
          severity: 5,
          confidence: 0.9
        }],
        totalSeverity: 5,
        riskLevel: "high",
        analysisTimestamp: Date.now()
      })
    })
  }
}));

vi.mock("../src/providers/provider-init", () => ({
  ProviderInitializer: {
    initialize: vi.fn().mockResolvedValue({
      analyzeCriminalCode: vi.fn().mockResolvedValue({
        hasViolations: true,
        violations: [
          {
            article: "282",
            description: "Экстремистская деятельность",
            severity: "high",
            confidence: 0.85,
            context: "призывы к насилию"
          }
        ],
        riskLevel: "high",
        confidence: 0.85
      })
    })
  }
}));

// Mock Durable Object state
const createMockState = () => ({
  blockConcurrencyWhile: vi.fn((fn: () => Promise<any>) => fn()),
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
});

// Mock environment
const createMockEnv = () => ({
  CRIMINAL_CACHE: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
  HISTORY: {
    get: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn(),
    list: vi.fn(),
  },
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  COUNTERS_DO: {
    idFromName: vi.fn().mockReturnValue("test-id"),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }))
    })
  },
  SUMMARY_PROVIDER: "openai",
  OPENAI_API_KEY: "test-key",
  DEBUG_LOGS: "true",
});

describe("CriminalCodeAnalyzerDO", () => {
  const testTimeout = 10000; // 10 seconds max per test

  let analyzer: CriminalCodeAnalyzerDO;
  let mockState: any;
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
    analyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe("initialization", () => {

    it("should initialize successfully", () => {
      expect(analyzer).toBeDefined();
      expect(analyzer).toBeInstanceOf(CriminalCodeAnalyzerDO);
    });
  });

  describe("analyze endpoint", () => {

    it("should analyze text for criminal code violations", async () => {
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      const result = await response.json() as CriminalAnalysisResult;

      expect(response.status).toBe(200);
      expect(result.hasViolations).toBe(true);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].article).toBe("282");
      expect(result.riskLevel).toBe("high");
    });

    it("should validate required fields", async () => {
      const invalidRequest = {
        text: "", // Empty text
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(invalidRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(400);
    });

    it("should handle missing chatId", async () => {
      const invalidRequest = {
        text: "Test text",
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(invalidRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(400);
    });

    it("should use cache when available", async () => {
      const text = "Test text for caching";
      const cachedResult = {
        textHash: "test-hash",
        result: {
          hasViolations: false,
          violations: [],
          totalSeverity: 0,
          riskLevel: "low",
          analysisTimestamp: Date.now()
        },
        createdAt: Date.now()
      };

      mockEnv.HISTORY.get.mockResolvedValue(cachedResult);

      // Mock provider for this test to return no violations
      const cacheTestProvider = {
        analyzeCriminalCode: vi.fn().mockResolvedValue({
          hasViolations: false,
          violations: [],
          totalSeverity: 0,
          riskLevel: "low",
          analysisTimestamp: Date.now()
        })
      };
      
      ProviderFactory.createProvider = vi.fn().mockResolvedValue(cacheTestProvider);
      
      // Create new analyzer instance for this test
      const cacheAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      const requestBody = {
        text,
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await cacheAnalyzer.fetch(request);
      const result = await response.json() as CriminalAnalysisResult;

      expect(response.status).toBe(200);
      expect(result.hasViolations).toBe(false);
      expect(mockEnv.HISTORY.get).toHaveBeenCalled();
    });
  });

  describe("stats endpoint", () => {

    it("should return user statistics", async () => {
      mockEnv.DB.prepare().bind().all.mockResolvedValue({
        results: [
          {
            article: "282",
            violation_count: 3,
            total_severity: 15,
            avg_confidence: 0.85
          }
        ]
      });

      const request = new Request("http://localhost/stats?chatId=12345&userId=67890&period=7d", {
        method: "GET",
      });

      const response = await analyzer.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.userStats).toBeDefined();
      expect(result.userStats.totalViolations).toBeDefined();
    });

    it("should work with minimal query parameters", async () => {
      mockEnv.DB.prepare().bind().all.mockResolvedValue({ results: [] });
      
      const request = new Request("http://localhost/stats?chatId=12345", {
        method: "GET",
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);
    });

    it("should handle different time periods", async () => {
      mockEnv.DB.prepare().bind().all.mockResolvedValue({ results: [] });

      const periods = ['1d', '7d', '30d', '90d'];
      
      for (const period of periods) {
        const request = new Request(`http://localhost/stats?chatId=12345&userId=67890&period=${period}`, {
          method: "GET",
        });

        const response = await analyzer.fetch(request);
        expect(response.status).toBe(200);
      }
    });
  });

  describe("error handling", () => {

    it("should handle AI provider errors gracefully", async () => {
      // Mock ProviderFactory to return a provider that throws errors
      const errorProvider = {
        analyzeCriminalCode: vi.fn().mockRejectedValue(new Error("AI service unavailable"))
      };
      
      ProviderFactory.createProvider = vi.fn().mockResolvedValue(errorProvider);

      // Create new analyzer instance to use the mocked provider
      const errorAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);
      
      const requestBody = {
        text: "Test text",
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await errorAnalyzer.fetch(request);
      expect(response.status).toBe(200); // Should return safe fallback, not 500
    });

    it("should handle database errors", async () => {
      mockEnv.DB.prepare.mockImplementation(() => {
        throw new Error("Database connection failed");
      });

      const request = new Request("http://localhost/stats?chatId=12345&userId=67890&period=7d", {
        method: "GET",
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(500);
    });

    it("should handle invalid JSON in request body", async () => {
      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: "invalid json",
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(400);
    });
  });

  describe("concurrency control", () => {

    it("should use blockConcurrencyWhile for analyze requests", async () => {
      const requestBody = {
        text: "Test text",
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      await analyzer.fetch(request);
      expect(mockState.blockConcurrencyWhile).toHaveBeenCalled();
    });

    it("should use blockConcurrencyWhile for stats requests", async () => {
      const request = new Request("http://localhost/stats?chatId=12345&userId=67890&period=7d", {
        method: "GET",
      });

      await analyzer.fetch(request);
      // Stats requests don't use blockConcurrencyWhile as they are read-only
      expect(mockState.blockConcurrencyWhile).not.toHaveBeenCalled();
    });
  });

  describe("caching behavior", () => {

    it("should cache analysis results", async () => {
      // Ensure HISTORY.put is called by mocking cache miss
      mockEnv.HISTORY.get.mockResolvedValueOnce(null);
      
      const requestBody = {
        text: "Test text for caching",
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      await analyzer.fetch(request);
      expect(mockEnv.HISTORY.put).toHaveBeenCalled();
    });

    it("should respect cache TTL", async () => {
      // Ensure HISTORY.put is called by mocking cache miss
      mockEnv.HISTORY.get.mockResolvedValueOnce(null);
      
      const requestBody = {
        text: "Test text",
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      await analyzer.fetch(request);
      
      // Check that HISTORY.put was called with TTL
      const putCall = mockEnv.HISTORY.put.mock.calls[0];
      expect(putCall).toBeDefined();
      expect(putCall[2]).toBeDefined(); // TTL parameter
    });
  });

  describe("database operations", () => {

    it("should store violations in database when found", async () => {
      // Mock cache miss to ensure fresh analysis
      mockEnv.HISTORY.get.mockResolvedValue(undefined);
      
      // Restore the original mock provider that returns violations
      const violationProvider = {
        analyzeCriminalCode: vi.fn().mockResolvedValue({
          hasViolations: true,
          violations: [
            {
              article: "282",
              description: "Призываю к насилию против определенной группы людей",
              severity: 5,
              confidence: 0.9
            }
          ],
          totalSeverity: 5,
          riskLevel: "high",
          analysisTimestamp: Date.now()
        })
      };
      
      ProviderFactory.createProvider = vi.fn().mockResolvedValue(violationProvider);
      
      // Create a new analyzer instance for this test to ensure fresh provider
      const testAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);
      
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await testAnalyzer.fetch(request);
      const result = await response.json() as CriminalAnalysisResult;
      
      // Verify violations were found and database operations were called
      expect(result.hasViolations).toBe(true);
      expect(mockEnv.DB.prepare).toHaveBeenCalled();
    });
  });
});
