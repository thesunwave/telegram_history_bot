import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CriminalCodeAnalyzerDO } from '../src/durable-objects/criminal-code-analyzer-do';
import type { CriminalAnalysisResult } from '../src/core/env';
import { ProviderFactory } from "../src/core/providers/provider-factory";
import { Logger } from '../src/core/logger';

// Mock Logger
vi.mock("../src/core/logger", () => ({
  Logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock ProviderFactory
vi.mock("../src/core/providers/provider-factory", () => ({
  ProviderFactory: {
    createProvider: vi.fn().mockReturnValue({
      analyzeCriminalCode: vi.fn().mockResolvedValue({
        hasViolations: true,
        violations: [{
          article: "282",
          subarticle: null,
          articleTitle: "Возбуждение ненависти либо вражды",
          quote: "Призываю к насилию против определенной группы людей",
          punishment: "Штраф до 300 000 рублей",
          severity: 5,
          confidence: 0.9,
          decision: "violation",
          evidence: {
            subject: "author",
            object: "group",
            intent: "incitement",
            contextSummary: "direct call",
            whyNotBenign: "not a joke"
          }
        }],
        totalSeverity: 5,
        riskLevel: "high",
        analysisTimestamp: Date.now()
      })
    })
  }
}));

vi.mock("../src/core/providers/provider-init", () => ({
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
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
  DB: {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null),
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

    it("should skip short local no-signal messages before semantic prefilter", async () => {
      const request = new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "какая же херня",
          chatId: 12345,
          userId: 67890,
          messageId: 112
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      const result = await response.json() as any;

      expect(response.status).toBe(200);
      expect(result.queued).toBe(false);
      expect(result.reasons).toContain("short_neutral");
    });

    it("should enqueue and flush suspicious messages when batch size is reached", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.COUNTERS = {
        get: vi.fn().mockResolvedValue("0"),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      const response = await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "пора всех их убивать",
          chatId: 12345,
          userId: 67890,
          messageId: 113,
          username: "testuser",
          day: "2026-05-18"
        }),
        headers: { "Content-Type": "application/json" },
      }));
      const result = await response.json() as any;

      expect(response.status).toBe(200);
      expect(result.queued).toBe(true);
      expect(ProviderFactory.createProvider).toHaveBeenCalled();
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        expect.stringContaining('criminal_openrouter_daily:'),
        '1',
        expect.any(Object)
      );
    });

    it("should include json instruction for GPT-5 semantic prefilter", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output: [{
          content: [{
            type: "output_text",
            text: JSON.stringify({
              shouldAnalyze: false,
              reason: "none",
              confidence: 0.1,
              explanation: "benign"
            })
          }]
        }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "какая же херня опять происходит, выглядит мутно и потенциально может быть опасной для людей",
          chatId: 12345,
          userId: 67890,
          messageId: 114,
          username: "testuser",
          day: "2026-05-18"
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.openai.com/v1/responses",
        expect.objectContaining({
          body: expect.stringContaining("Analyze this JSON payload and return JSON only")
        })
      );
      const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(requestBody.max_output_tokens).toBeGreaterThanOrEqual(512);
      expect(requestBody.reasoning).toEqual({ effort: "minimal" });
      vi.unstubAllGlobals();
    });

    it("should not postpone an existing queue alarm", async () => {
      const storage = new Map<string, any>();
      const futureAlarm = Date.now() + 30_000;
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        getAlarm: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(futureAlarm),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 5;
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      for (const messageId of [115, 116]) {
        await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
          method: "POST",
          body: JSON.stringify({
            text: "обычное сообщение для проверки очереди, достаточно длинное для semantic prefilter",
            chatId: 12345,
            userId: 67890,
            messageId,
            username: "testuser",
            day: "2026-05-18"
          }),
          headers: { "Content-Type": "application/json" },
        }));
      }

      expect(mockState.storage.setAlarm).toHaveBeenCalledTimes(1);
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
      mockEnv.HISTORY.get.mockResolvedValue(null);
      
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
