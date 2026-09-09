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
      getProviderInfo: vi.fn().mockReturnValue({ name: "mock", model: "mock" }),
      validateConfig: vi.fn(),
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
    (ProviderFactory.createProvider as any).mockReturnValue({
      getProviderInfo: vi.fn().mockReturnValue({ name: "mock", model: "mock" }),
      validateConfig: vi.fn(),
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
    });
    mockState = createMockState();
    mockEnv = createMockEnv();
    analyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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
        getProviderInfo: vi.fn().mockReturnValue({ name: "mock", model: "mock" }),
        validateConfig: vi.fn(),
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

    it("should heal cached analysis results that are missing analysisTimestamp (KV branch)", async () => {
      const text = "Test text for cache healing (KV)";
      const cachedResult = {
        textHash: "test-hash",
        result: {
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
          }],
          totalSeverity: 5,
          riskLevel: "high",
          // analysisTimestamp intentionally omitted: simulates a pre-fix malformed cached entry
        },
        createdAt: Date.now(),
      };

      mockEnv.HISTORY.get.mockResolvedValue(cachedResult);

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({ text, chatId: 12345, userId: 67890, messageId: 111 }),
        headers: { "Content-Type": "application/json" },
      });

      const before = Date.now();
      const response = await analyzer.fetch(request);
      const result = await response.json() as CriminalAnalysisResult;

      expect(response.status).toBe(200);
      expect(result.hasViolations).toBe(true);
      expect(typeof result.analysisTimestamp).toBe("number");
      expect(Number.isFinite(result.analysisTimestamp)).toBe(true);
      expect(result.analysisTimestamp).toBeGreaterThanOrEqual(before);
      expect(result.analysisTimestamp).toBeLessThanOrEqual(Date.now());
      expect(mockEnv.HISTORY.get).toHaveBeenCalled();
    });

    it("should heal cached analysis results that are missing analysisTimestamp (D1 branch)", async () => {
      const text = "Test text for cache healing (D1)";
      const malformedStoredResult: CriminalAnalysisResult = {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: "low",
        // analysisTimestamp intentionally omitted: simulates a pre-fix malformed cached row
      } as any;

      // KV miss, so the D1 fallback branch is exercised
      mockEnv.HISTORY.get.mockResolvedValue(null);
      const insertSpy = vi.fn().mockResolvedValue({ success: true });
      const allSpy = vi.fn().mockResolvedValue({ results: [] });
      const cacheRow = { analysis_result: JSON.stringify(malformedStoredResult) };
      mockEnv.DB.prepare = vi.fn().mockImplementation((query: string) => ({
        bind: vi.fn().mockReturnValue({
          run: insertSpy,
          all: allSpy,
          first: vi.fn().mockResolvedValue(
            query.includes("SELECT analysis_result FROM criminal_analysis_cache") ? cacheRow : null
          ),
        }),
      }));

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({ text, chatId: 12345, userId: 67890, messageId: 111 }),
        headers: { "Content-Type": "application/json" },
      });

      const before = Date.now();
      const response = await analyzer.fetch(request);
      const result = await response.json() as CriminalAnalysisResult;

      expect(response.status).toBe(200);
      expect(typeof result.analysisTimestamp).toBe("number");
      expect(Number.isFinite(result.analysisTimestamp)).toBe(true);
      expect(result.analysisTimestamp).toBeGreaterThanOrEqual(before);
      expect(result.analysisTimestamp).toBeLessThanOrEqual(Date.now());

      // The healed entry is written back to KV (so the malformed shape does not survive the read).
      const kvPutCall = mockEnv.HISTORY.put.mock.calls.find((call: any[]) =>
        typeof call[0] === "string" && call[0].startsWith("criminal_cache:")
      );
      expect(kvPutCall).toBeDefined();
      const written = JSON.parse(kvPutCall[1]);
      expect(typeof written.result.analysisTimestamp).toBe("number");
      expect(Number.isFinite(written.result.analysisTimestamp)).toBe(true);
    });

    it("should normalize analysisTimestamp when the provider omits it on the success path", async () => {
      const text = "Призываю к насилию против определенной группы людей";
      (ProviderFactory.createProvider as any).mockReturnValue({
        getProviderInfo: vi.fn().mockReturnValue({ name: "mock", model: "mock" }),
        validateConfig: vi.fn(),
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
          }],
          totalSeverity: 5,
          riskLevel: "high",
          // analysisTimestamp intentionally omitted: simulates an OpenAI/Cloudflare provider
          // success path that did not set the field
        }),
      });
      // Fresh analyzer so its lazy initialize() picks up the malformed provider mock
      const healAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);
      mockEnv.HISTORY.get.mockResolvedValue(null);

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({ text, chatId: 12345, userId: 67890, messageId: 111, forceRefresh: true }),
        headers: { "Content-Type": "application/json" },
      });

      const before = Date.now();
      const response = await healAnalyzer.fetch(request);
      const result = await response.json() as CriminalAnalysisResult;

      expect(response.status).toBe(200);
      expect(result.hasViolations).toBe(true);
      expect(typeof result.analysisTimestamp).toBe("number");
      expect(Number.isFinite(result.analysisTimestamp)).toBe(true);
      expect(result.analysisTimestamp).toBeGreaterThanOrEqual(before);
      expect(result.analysisTimestamp).toBeLessThanOrEqual(Date.now());

      // The normalized result (with analysisTimestamp) is persisted into the cache, not the malformed shape.
      const kvPutCall = mockEnv.HISTORY.put.mock.calls.find((call: any[]) =>
        typeof call[0] === "string" && call[0].startsWith("criminal_cache:")
      );
      expect(kvPutCall).toBeDefined();
      const written = JSON.parse(kvPutCall[1]);
      expect(typeof written.result.analysisTimestamp).toBe("number");
      expect(Number.isFinite(written.result.analysisTimestamp)).toBe(true);
    });

    it("should persist caller-provided source timestamp for violations", async () => {
      const sourceTs = 1700000000;
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111,
        username: "testuser",
        day: "2023-11-14",
        ts: sourceTs,
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      // Find the INSERT INTO criminal_violations bind call (20 args) — skip
      // earlier cache lookup/insert calls which have fewer arguments.
      const insertCall = bindSpy.mock.calls.find((call: any[]) => call.length > 10);
      const violation_ts = insertCall[insertCall.length - 1];
      const violation_day = insertCall[insertCall.length - 2];
      expect(violation_ts).toBe(sourceTs);
      expect(violation_day).toBe("2023-11-14");
    });

    it("should derive violation day from valid ts when caller day mismatches", async () => {
      // 1700000000 == 2023-11-14T22:13:20Z; the mismatched caller day must not win.
      const sourceTs = 1700000000;
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111,
        username: "testuser",
        day: "2024-01-01",
        ts: sourceTs,
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      const insertCall = bindSpy.mock.calls.find((call: any[]) => call.length > 10);
      const violation_ts = insertCall[insertCall.length - 1];
      const violation_day = insertCall[insertCall.length - 2];
      expect(violation_ts).toBe(sourceTs);
      expect(violation_day).toBe("2023-11-14");

      const countersFetch = mockEnv.COUNTERS_DO.get.mock.results[0].value.fetch;
      const countersPayload = JSON.parse(countersFetch.mock.calls[0][1].body as string);
      expect(countersPayload.day).toBe("2023-11-14");
    });

    it("should fall back to processing time when analyze request has no timestamp", async () => {
      const before = Math.floor(Date.now() / 1000);
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111,
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      const insertCall = bindSpy.mock.calls.find((call: any[]) => call.length > 10);
      const violation_ts = insertCall[insertCall.length - 1];
      expect(violation_ts).toBeGreaterThanOrEqual(before);
    });

    it("should keep caller day when ts is missing or invalid", async () => {
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111,
        username: "testuser",
        day: "2024-01-01",
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      const insertCall = bindSpy.mock.calls.find((call: any[]) => call.length > 10);
      const violation_day = insertCall[insertCall.length - 2];
      expect(violation_day).toBe("2024-01-01");
    });

    it("should persist ts=0 as epoch zero with day 1970-01-01", async () => {
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111,
        username: "testuser",
        day: "2024-06-15",
        ts: 0,
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      const insertCall = bindSpy.mock.calls.find((call: any[]) => call.length > 10);
      const violation_ts = insertCall[insertCall.length - 1];
      const violation_day = insertCall[insertCall.length - 2];
      expect(violation_ts).toBe(0);
      expect(violation_day).toBe("1970-01-01");
    });

    it("should normalize millisecond-scale ts to seconds, not store a far-future date", async () => {
      // `Date.now()` is the natural JS millisecond value an operator might pass at the
      // `/analyze-test` boundary; without normalization `storeViolations` would store it
      // as Unix seconds -> datetime(?, 'unixepoch') = year ~58000, polluting end-user
      // stats (/criminal, /mycriminal, /criminaltop) indefinitely.
      const msTs = Date.now();
      const requestBody = {
        text: "Призываю к насилию против определенной группы людей",
        chatId: 12345,
        userId: 67890,
        messageId: 111,
        username: "testuser",
        day: "2023-11-14",
        ts: msTs,
      };

      const request = new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      const insertCall = bindSpy.mock.calls.find((call: any[]) => call.length > 10);
      const violation_ts = insertCall[insertCall.length - 1];
      const violation_day = insertCall[insertCall.length - 2];
      // Ms-scale value is rescaled to seconds, not stored verbatim.
      expect(violation_ts).toBe(Math.floor(msTs / 1000));
      expect(violation_ts).toBeLessThan(msTs);
      // Day is derived from the normalized seconds -> present day, never year ~58000.
      expect(violation_day).toBe(new Date(Math.floor(msTs / 1000) * 1000).toISOString().slice(0, 10));
      const storedYear = Number(violation_day.slice(0, 4));
      expect(storedYear).toBeGreaterThanOrEqual(2024);
      expect(storedYear).toBeLessThan(2100);
    });

    it("should enqueue short no-signal messages for semantic prefilter", async () => {
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
      expect(result.queued).toBe(true);
      expect(result.reasons).toContain("semantic_prefilter");
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
        expect.stringContaining('criminal_prefilter_daily:'),
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

    it("should not continue to RAG when semantic prefilter rejects the target", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const legalRagProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "legal-rag", model: "@cf/baai/bge-m3" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn(),
        analyzeCriminalCode: vi.fn(),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(legalRagProvider);
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS = {
        get: vi.fn().mockResolvedValue("0"),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.12,
          explanation: "target is a complaint, risky content is only in neighboring messages",
          searchQuery: ""
        }),
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "Ппп херня полная где моя административка",
          chatId: 12345,
          userId: 67890,
          messageId: 115,
          username: "testuser",
          day: "2026-05-18"
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(legalRagProvider.analyzeCriminalCodeWithContext).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("should reuse cached semantic prefilter results for repeated normalized text", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const kv = new Map<string, string>();
      mockEnv.HISTORY = {
        get: vi.fn((key: string) => Promise.resolve(kv.has(key) ? JSON.parse(kv.get(key)!) : null)),
        put: vi.fn((key: string, value: string) => {
          kv.set(key, value);
          return Promise.resolve();
        }),
      };
      const legalRagProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "legal-rag", model: "@cf/baai/bge-m3" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn(),
        analyzeCriminalCode: vi.fn(),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(legalRagProvider);
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS = {
        get: vi.fn().mockResolvedValue("0"),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.2,
          explanation: "no legal signal",
          searchQuery: ""
        }),
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 }
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      for (const messageId of [1161, 1162]) {
        await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
          method: "POST",
          body: JSON.stringify({
            text: "  Просто херня полная  ",
            chatId: 12345,
            userId: 67890,
            messageId,
            username: "testuser",
            day: "2026-05-18"
          }),
          headers: { "Content-Type": "application/json" },
        }));
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(legalRagProvider.analyzeCriminalCodeWithContext).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("should batch semantic prefilter requests for queued messages", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
        getAlarm: vi.fn().mockResolvedValue(null),
      };
      mockEnv.HISTORY = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const legalRagProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "legal-rag", model: "@cf/baai/bge-m3" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn(),
        analyzeCriminalCode: vi.fn(),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(legalRagProvider);
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 2;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.CRIMINAL_PREFILTER_BATCH_ENABLED = true;
      mockEnv.CRIMINAL_PREFILTER_BATCH_SIZE = 8;
      mockEnv.COUNTERS = {
        get: vi.fn().mockResolvedValue("0"),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          items: [
            { id: "0", shouldAnalyze: false, reason: "none", confidence: 0.1, explanation: "benign", searchQuery: "" },
            { id: "1", shouldAnalyze: false, reason: "none", confidence: 0.1, explanation: "benign", searchQuery: "" }
          ]
        }),
        usage: { input_tokens: 150, output_tokens: 40, total_tokens: 190 }
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      for (const [messageId, text] of [[1163, "первая обычная фраза"], [1164, "вторая обычная фраза"]] as const) {
        await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
          method: "POST",
          body: JSON.stringify({
            text,
            chatId: 12345,
            userId: 67890,
            messageId,
            username: "testuser",
            day: "2026-05-18"
          }),
          headers: { "Content-Type": "application/json" },
        }));
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.instructions).toContain('"items"');
      expect(body.input[0].content).toContain('"items"');
      expect(legalRagProvider.analyzeCriminalCodeWithContext).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("should skip semantic prefilter when the daily cap is exhausted", async () => {
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
      mockEnv.CRIMINAL_PREFILTER_DAILY_CAP = 1;
      mockEnv.COUNTERS = {
        get: vi.fn((key: string) => Promise.resolve(
          key.startsWith("criminal_prefilter_daily:") ? "1" : "0"
        )),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "угрожаю причинить вред людям, это сообщение достаточно длинное для проверки лимита",
          chatId: 12345,
          userId: 67890,
          messageId: 117,
          username: "testuser",
          day: "2026-05-18"
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        expect.stringContaining("criminal_prefilter_skipped_daily:"),
        "1",
        expect.any(Object)
      );
      vi.unstubAllGlobals();
    });

    it("should skip legal-rag final analysis when the daily cap is exhausted", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const legalRagProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "legal-rag", model: "@cf/baai/bge-m3" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: false,
          decision: "uncertain",
          violations: [],
          totalSeverity: 0,
          riskLevel: "low",
          analysisTimestamp: Date.now(),
          legalReferences: [],
        }),
        analyzeCriminalCode: vi.fn(),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(legalRagProvider);
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.LEGAL_RAG_DAILY_QUERY_CAP = 1;
      mockEnv.COUNTERS = {
        get: vi.fn((key: string) => Promise.resolve(
          key.startsWith("legal_rag_daily:") ? "1" : "0"
        )),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "пора всех их убивать",
          chatId: 12345,
          userId: 67890,
          messageId: 118,
          username: "testuser",
          day: "2026-05-18"
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(legalRagProvider.analyzeCriminalCodeWithContext).not.toHaveBeenCalled();
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        expect.stringContaining("legal_rag_skipped_daily:"),
        "1",
        expect.any(Object)
      );
    });

    it("should use gpt-5-nano final judge after legal-rag references and store confirmed violations", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const legalRagProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "legal-rag", model: "@cf/baai/bge-m3" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: false,
          decision: "uncertain",
          violations: [],
          totalSeverity: 0,
          riskLevel: "low",
          analysisTimestamp: Date.now(),
          legalReferences: [{
            article: "119",
            subarticle: "1",
            articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
            quote: "Статья 119. Угроза убийством или причинением тяжкого вреда здоровью 1. Угроза убийством или причинением тяжкого вреда здоровью, если имелись основания опасаться осуществления этой угрозы, - наказывается обязательными работами на срок до четырехсот восьмидесяти часов, либо лишением свободы на срок до двух лет.",
            sourceUrl: "https://uk-rf.ru/",
            lawCode: "uk-rf",
            score: 0.88,
            vectorId: "uk-rf:119:main:0",
          }],
        }),
        analyzeCriminalCode: vi.fn(),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(legalRagProvider);
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_MODEL = "gpt-5-nano";
      mockEnv.CRIMINAL_FINAL_JUDGE_MIN_CONFIDENCE = 0.75;
      mockEnv.COUNTERS = {
        get: vi.fn().mockResolvedValue("0"),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          decision: "violation",
          confidence: 0.91,
          evidence: {
            subject: "author",
            object: "victim",
            intent: "threat",
            contextSummary: "direct threat",
            whyNotBenign: "literal threat"
          },
          violations: [{
            article: "119",
            subarticle: null,
            articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
            quote: "я тебя убью",
            punishment: "обязательные работы",
            severity: 7,
            confidence: 0.91
          }]
        }),
        usage: { input_tokens: 900, output_tokens: 120, total_tokens: 1020 }
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "я тебя убью",
          chatId: 12345,
          userId: 67890,
          messageId: 119,
          username: "testuser",
          day: "2026-05-18"
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.openai.com/v1/responses",
        expect.objectContaining({
          body: expect.stringContaining("Classify this JSON payload and return JSON only")
        })
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining("openrouter.ai"),
        expect.anything()
      );
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO criminal_violations"));
      const insertStatement = mockEnv.DB.prepare.mock.results
        .map((result: any) => result.value)
        .find((statement: any) =>
          statement.bind.mock.calls.some((call: any[]) => call.includes("119"))
        );
      const insertCall = insertStatement.bind.mock.calls.find((call: any[]) => call.includes("119"));
      expect(insertCall[4]).toBe("1");
      expect(insertCall[7]).toContain("лишением свободы на срок до двух лет");
      vi.unstubAllGlobals();
    });

    it("should reject final judge violations quoted from neighboring context", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const legalRagProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "legal-rag", model: "@cf/baai/bge-m3" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: false,
          decision: "uncertain",
          violations: [],
          totalSeverity: 0,
          riskLevel: "low",
          analysisTimestamp: Date.now(),
          legalReferences: [{
            article: "280",
            subarticle: null,
            articleTitle: "Публичные призывы к осуществлению экстремистской деятельности",
            quote: "Статья 280. Публичные призывы к осуществлению экстремистской деятельности...",
            sourceUrl: "https://uk-rf.ru/",
            lawCode: "uk-rf",
            score: 0.88,
            vectorId: "uk-rf:280:main:0",
          }],
        }),
        analyzeCriminalCode: vi.fn(),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(legalRagProvider);
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_MODEL = "gpt-5-nano";
      mockEnv.CRIMINAL_FINAL_JUDGE_MIN_CONFIDENCE = 0.7;
      mockEnv.COUNTERS = {
        get: vi.fn().mockResolvedValue("0"),
        put: vi.fn().mockResolvedValue(undefined),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          decision: "violation",
          confidence: 0.92,
          evidence: {
            subject: "testuser",
            object: "neighboring user",
            intent: "threat",
            contextSummary: "neighboring message contains a threat",
            whyNotBenign: "context contains threat"
          },
          violations: [{
            article: "280",
            subarticle: null,
            articleTitle: "Публичные призывы к осуществлению экстремистской деятельности",
            quote: "Я тебе ебало набью",
            punishment: "до четырех лет лишения свободы",
            severity: 4,
            confidence: 0.92
          }]
        }),
        usage: { input_tokens: 900, output_tokens: 120, total_tokens: 1020 }
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "Ппп херня полная где моя административка",
          chatId: 12345,
          userId: 67890,
          messageId: 120,
          username: "testuser",
          day: "2026-05-18"
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.openai.com/v1/responses",
        expect.anything()
      );
      expect(mockEnv.DB.prepare.mock.calls.some(([query]: [string]) =>
        query.includes("INSERT INTO criminal_violations")
      )).toBe(false);
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

  describe("batch analyze endpoint", () => {
    it("should persist per-message source timestamps for violations", async () => {
      const sourceTs = 1700000000;
      const requestBody = {
        messages: [
          {
            text: "Призываю к насилию против определенной группы людей",
            chatId: 12345,
            userId: 67890,
            messageId: 111,
            username: "testuser",
            day: "2023-11-14",
            ts: sourceTs,
          },
        ],
      };

      const request = new Request("http://localhost/batch-analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      // Find the INSERT INTO criminal_violations bind calls (20 args each) — skip
      // earlier cache lookup/insert calls which have fewer arguments.
      const insertCalls = bindSpy.mock.calls.filter((call: any[]) => call.length > 10);
      const violation_ts = insertCalls[0][insertCalls[0].length - 1];
      const violation_day = insertCalls[0][insertCalls[0].length - 2];
      expect(violation_ts).toBe(sourceTs);
      expect(violation_day).toBe("2023-11-14");
    });

    it("should persist per-message source timestamps for multiple messages", async () => {
      const requestBody = {
        messages: [
          {
            text: "Призываю к насилию против определенной группы людей",
            chatId: 12345,
            userId: 67890,
            messageId: 111,
            username: "testuser",
            day: "2023-11-14",
            ts: 1700000000,
          },
          {
            text: "Призываю к насилию против определенной группы людей",
            chatId: 12346,
            userId: 67891,
            messageId: 112,
            username: "testuser2",
            day: "2023-11-15",
            ts: 1700086400,
          },
        ],
      };

      const request = new Request("http://localhost/batch-analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      const insertCalls = bindSpy.mock.calls.filter((call: any[]) => call.length > 10);
      expect(insertCalls[0][insertCalls[0].length - 1]).toBe(1700000000);
      expect(insertCalls[0][insertCalls[0].length - 2]).toBe("2023-11-14");
      expect(insertCalls[1][insertCalls[1].length - 1]).toBe(1700086400);
      expect(insertCalls[1][insertCalls[1].length - 2]).toBe("2023-11-15");
    });

    it("should fall back to processing time when batch message has no timestamp", async () => {
      const requestBody = {
        messages: [
          {
            text: "Призываю к насилию против определенной группы людей",
            chatId: 12345,
            userId: 67890,
            messageId: 111,
            username: "testuser",
          },
        ],
      };

      const before = Math.floor(Date.now() / 1000);
      const request = new Request("http://localhost/batch-analyze", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await analyzer.fetch(request);
      expect(response.status).toBe(200);

      const bindSpy = mockEnv.DB.prepare.mock.results[0].value.bind;
      const insertCall = bindSpy.mock.calls.find((call: any[]) => call.length > 10);
      const violation_ts = insertCall[insertCall.length - 1];
      expect(violation_ts).toBeGreaterThanOrEqual(before);
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

  describe("profanity counters from criminal prefilter", () => {
    it("updates profanity counters for short local profanity without OpenAI fetch", async () => {
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const response = await analyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "хуй",
          chatId: 12345,
          userId: 67890,
          messageId: 2001,
          username: "testuser",
          day: "2026-05-18",
        }),
        headers: { "Content-Type": "application/json" },
      }));
      const result = await response.json() as any;

      expect(result.queued).toBe(false);
      expect(result.reasons).toContain("too_short");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(counterFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse((counterFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(payload).toMatchObject({
        chatId: 12345,
        userId: 67890,
        username: "testuser",
        day: "2026-05-18",
        count: 1,
        words: [{ word: "хуй", count: 1 }],
      });
    });

    it("parses semantic prefilter profanity and updates counters", async () => {
      const storage = new Map<string, any>();
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
      };
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.1,
          explanation: "no legal signal",
          searchQuery: "",
          profanity: {
            hasProfanity: true,
            words: [{ word: "заебал", count: 2, confidence: 0.91 }],
          },
        }),
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "заебал заебал обычная достаточно длинная фраза для модельной проверки",
          chatId: 12345,
          userId: 67890,
          messageId: 2002,
          username: "testuser",
          day: "2026-05-18",
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(counterFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse((counterFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(payload.count).toBe(2);
      expect(payload.words).toEqual([{ word: "заебал", count: 2 }]);
    });

    it("acks profanity failed when the counter request fails for a sequenced task", async () => {
      const storage = new Map<string, any>();
      // Counter transport failure: non-OK response from CountersDO.
      const counterFetch = vi.fn()
        .mockResolvedValueOnce(new Response("boom", { status: 500 }))
        .mockResolvedValue(new Response("ok", { status: 200 }));
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
      };
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.1,
          explanation: "no legal signal",
          searchQuery: "",
          profanity: {
            hasProfanity: true,
            words: [{ word: "заебал", count: 2, confidence: 0.91 }],
          },
        }),
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "заебал заебал обычная достаточно длинная фраза для модельной проверки",
          chatId: 12345,
          userId: 67890,
          messageId: 2010,
          username: "testuser",
          day: "2026-05-18",
          sequence: 42,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // Profanity increment failed exactly once; not re-attempted (no double ack).
      const incrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && !(call[0] as string).includes("/ack")
      );
      expect(incrementCalls).toHaveLength(1);
      const incrementPayload = JSON.parse((incrementCalls[0][1] as RequestInit).body as string);
      expect(incrementPayload.sequence).toBe(42);
      // Exactly one profanity ack: category profanity, sequence preserved, outcome failed.
      const profanityAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "profanity";
      });
      expect(profanityAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((profanityAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "profanity",
        messageId: 2010,
        sequence: 42,
        outcome: "failed",
      });
    });

    it("acks profanity failed for a sequenced task with missing user identity instead of false zero", async () => {
      const storage = new Map<string, any>();
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
      };
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.1,
          explanation: "no legal signal",
          searchQuery: "",
          profanity: {
            hasProfanity: true,
            words: [{ word: "заебал", count: 2, confidence: 0.91 }],
          },
        }),
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "заебал заебал обычная достаточно длинная фраза для модельной проверки",
          chatId: 12345,
          // userId intentionally omitted: incomplete identity must not be
          // treated as zero profanity.
          messageId: 2013,
          username: "testuser",
          day: "2026-05-18",
          sequence: 43,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // No profanity increment attempted for incomplete identity.
      const incrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && (call[0] as string).includes("/profanity")
      );
      expect(incrementCalls).toHaveLength(0);
      // Exactly one profanity ack: category profanity, sequence preserved, outcome failed, never zero.
      const profanityAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "profanity";
      });
      expect(profanityAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((profanityAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "profanity",
        messageId: 2013,
        sequence: 43,
        outcome: "failed",
      });
      expect(ackPayload.outcome).not.toBe("zero");
    });

    it("acks profanity failed for a sequenced no-word task with missing user identity instead of false zero", async () => {
      const storage = new Map<string, any>();
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
      };
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          // Short clean text: prefilter reasons too_short, no profanity words detected.
          text: "привет",
          chatId: 12345,
          // userId intentionally omitted: missing identity must not be
          // treated as zero profanity even when no words were detected.
          messageId: 2014,
          username: "testuser",
          day: "2026-05-18",
          sequence: 44,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // No profanity increment attempted for incomplete identity.
      const incrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && (call[0] as string).includes("/profanity")
      );
      expect(incrementCalls).toHaveLength(0);
      // Exactly one profanity ack: category profanity, sequence preserved, outcome failed, never zero.
      const profanityAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "profanity";
      });
      expect(profanityAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((profanityAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "profanity",
        messageId: 2014,
        sequence: 44,
        outcome: "failed",
      });
      expect(ackPayload.outcome).not.toBe("zero");
    });

    it("merges local and model profanity without double-counting the same word form", async () => {
      const storage = new Map<string, any>();
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
      };
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.1,
          explanation: "no legal signal",
          searchQuery: "",
          profanity: {
            hasProfanity: true,
            words: [{ word: "пиздец", count: 1, confidence: 0.9 }],
          },
        }),
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "пиздец какая достаточно длинная фраза для модельной проверки",
          chatId: 12345,
          userId: 67890,
          messageId: 2003,
          username: "testuser",
          day: "2026-05-18",
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(counterFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse((counterFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(payload.count).toBe(1);
      expect(payload.words).toEqual([{ word: "пиздец", count: 1 }]);
    });

    it("keeps distinct model profanity word forms when updating counters", async () => {
      const storage = new Map<string, any>();
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
      };
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.1,
          explanation: "no legal signal",
          searchQuery: "",
          profanity: {
            hasProfanity: true,
            words: [
              { word: "заебал", count: 1, confidence: 0.9 },
              { word: "ебаный", count: 1, confidence: 0.9 },
            ],
          },
        }),
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "заебал этот ебаный достаточно длинный тест",
          chatId: 12345,
          userId: 67890,
          messageId: 2006,
          username: "testuser",
          day: "2026-05-18",
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(counterFetch).toHaveBeenCalledTimes(1);
      const payload = JSON.parse((counterFetch.mock.calls[0][1] as RequestInit).body as string);
      expect(payload.count).toBe(2);
      expect(payload.words).toEqual([
        { word: "заебал", count: 1 },
        { word: "ебаный", count: 1 },
      ]);
    });

    it("does not update profanity counters when the new flag is disabled", async () => {
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = false;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };

      await analyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "хуй",
          chatId: 12345,
          userId: 67890,
          messageId: 2004,
          username: "testuser",
          day: "2026-05-18",
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(counterFetch).not.toHaveBeenCalled();
    });

    it("updates counters when the old profanity flag is disabled but the new path is enabled", async () => {
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockEnv.ENABLE_PROFANITY_ANALYSIS = false;
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };

      await analyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "хуй",
          chatId: 12345,
          userId: 67890,
          messageId: 2005,
          username: "testuser",
          day: "2026-05-18",
        }),
        headers: { "Content-Type": "application/json" },
      }));

      expect(counterFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("criminal ack outcomes from queued flush", () => {
    it("acks criminal failed when contextual provider errors for a sequenced queued task", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_ENABLED = false;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const errorProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "openrouter", model: "mock" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockRejectedValue(new Error("AI service unavailable")),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(errorProvider);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "угрожаю причинить вред людям, это сообщение достаточно длинное для обхода локального детектора",
          chatId: 12345,
          userId: 67890,
          messageId: 2011,
          username: "testuser",
          day: "2026-05-18",
          sequence: 77,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // Exactly one criminal ack: category criminal, original sequence, outcome failed.
      const criminalAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "criminal";
      });
      expect(criminalAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((criminalAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "criminal",
        messageId: 2011,
        sequence: 77,
        outcome: "failed",
      });
      expect(ackPayload.outcome).not.toBe("zero");
    });

    it("acks criminal failed when violation persistence rejects for a sequenced queued task", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_ENABLED = false;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      // Persistence failure: the DB insert rejects, which storeViolations rethrows
      // so flushQueue's failed-ack branch runs instead of implicit completion.
      mockEnv.DB.prepare = vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockRejectedValue(new Error("DB write failed")),
          all: vi.fn().mockResolvedValue({ results: [] }),
          first: vi.fn().mockResolvedValue(null),
        }),
      });
      const confirmedProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "openrouter", model: "mock" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: true,
          violations: [{
            article: "119",
            subarticle: null,
            articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
            quote: "я тебя убью",
            punishment: "обязательные работы",
            severity: 7,
            confidence: 0.91,
            decision: "violation",
            evidence: {
              subject: "author",
              object: "victim",
              intent: "threat",
              contextSummary: "direct threat",
              whyNotBenign: "literal threat"
            }
          }],
          totalSeverity: 7,
          riskLevel: "high",
          analysisTimestamp: Date.now()
        }),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(confirmedProvider);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "я тебя убью, это сообщение достаточно длинное для обхода локального детектора",
          chatId: 12345,
          userId: 67890,
          messageId: 2012,
          username: "testuser",
          day: "2026-05-18",
          sequence: 78,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // Persistence failed, so the criminal completed increment must NOT happen:
      // no /criminal POST and exactly one /ack with category criminal + failed.
      const criminalIncrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && (call[0] as string).includes("/criminal")
      );
      expect(criminalIncrementCalls).toHaveLength(0);
      const criminalAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "criminal";
      });
      expect(criminalAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((criminalAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "criminal",
        messageId: 2012,
        sequence: 78,
        outcome: "failed",
      });
      expect(ackPayload.outcome).not.toBe("zero");
      expect(ackPayload.outcome).not.toBe("completed");
    });

    it("acks criminal failed when the CountersDO /criminal increment rejects with a non-OK response for a sequenced queued task", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      // DB insert succeeds; the CountersDO /criminal increment then rejects
      // with a non-OK HTTP response (simulating aggregate/progress resolution
      // being absent). storeViolations must propagate that as an error so
      // flushQueue's failed-ack branch runs instead of implicit completion.
      const counterFetch = vi.fn()
        .mockResolvedValueOnce(new Response("ok", { status: 200 })) // unused /ack or other
        .mockImplementation(async (url: string, init?: RequestInit) => {
          if (String(url).includes("/criminal")) {
            return new Response("Internal Server Error", { status: 500 });
          }
          return new Response("ok", { status: 200 });
        });
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_ENABLED = false;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const confirmedProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "openrouter", model: "mock" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: true,
          violations: [{
            article: "119",
            subarticle: null,
            articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
            quote: "я тебя убью",
            punishment: "обязательные работы",
            severity: 7,
            confidence: 0.91,
            decision: "violation",
            evidence: {
              subject: "author",
              object: "victim",
              intent: "threat",
              contextSummary: "direct threat",
              whyNotBenign: "literal threat"
            }
          }],
          totalSeverity: 7,
          riskLevel: "high",
          analysisTimestamp: Date.now()
        }),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(confirmedProvider);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "я тебя убью, это сообщение достаточно длинное для обхода локального детектора",
          chatId: 12345,
          userId: 67890,
          messageId: 2013,
          username: "testuser",
          day: "2026-05-18",
          sequence: 79,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // The non-OK /criminal increment was attempted once, and the failed
      // terminal must be acked exactly once with the original sequence: never
      // zero/completed, never implicit completion.
      const criminalIncrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && (call[0] as string).includes("/criminal")
      );
      expect(criminalIncrementCalls).toHaveLength(1);
      const criminalAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "criminal";
      });
      expect(criminalAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((criminalAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "criminal",
        messageId: 2013,
        sequence: 79,
        outcome: "failed",
      });
      expect(ackPayload.outcome).not.toBe("zero");
      expect(ackPayload.outcome).not.toBe("completed");
    });

    it("detects a non-OK /ack response and logs only safe metadata for profanity ack", async () => {
      const storage = new Map<string, any>();
      // /ack returns 500: the helper must detect it (not silently succeed),
      // log safe metadata only, and keep the best-effort pipeline semantics.
      const counterFetch = vi.fn().mockResolvedValue(new Response("error", { status: 500 }));
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
      };
      mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_PREFILTER_MODEL = "gpt-5-nano";
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldAnalyze: false,
          reason: "none",
          confidence: 0.1,
          explanation: "no legal signal",
          searchQuery: "",
          profanity: {
            hasProfanity: true,
            words: [{ word: "заебал", count: 1, confidence: 0.9 }],
          },
        }),
        usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
      }), { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "заебал заебал обычная достаточно длинная фраза для модельной проверки",
          chatId: 12345,
          userId: 67890,
          messageId: 2015,
          username: "testuser",
          day: "2026-05-18",
          sequence: 45,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // Non-OK /ack was detected exactly once for profanity category.
      const profanityAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "profanity";
      });
      expect(profanityAckCalls.length).toBeGreaterThan(0);
      // Pipeline kept running: criminal zero ack still issued after non-OK profanity ack.
      const criminalAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "criminal";
      });
      expect(criminalAckCalls.length).toBeGreaterThan(0);

      // Safe metadata only: op/category/outcome/status; never response body.
      const warnCalls = consoleWarnSpy.mock.calls.filter((call) => {
        const data = call[1] as Record<string, unknown>;
        return data?.op === 'ack' && data.category === 'profanity';
      });
      expect(warnCalls.length).toBeGreaterThan(0);
      for (const call of warnCalls) {
        const data = call[1] as Record<string, unknown>;
        expect(data.op).toBe("ack");
        expect(data.category).toBe("profanity");
        expect(["failed", "zero", "skipped"]).toContain(data.outcome);
        expect(data.status).toBe(500);
        // No raw response body / payload leakage.
        expect(JSON.stringify(call)).not.toMatch(/error|Internal Server Error/i);
      }
    });

    it("detects a non-OK /ack response for criminal ack and still finishes the batch", async () => {
      const storage = new Map<string, any>();
      const counterFetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/criminal")) {
          return new Response("Internal Server Error", { status: 500 });
        }
        // Any /ack (profanity or criminal) returns 500: both must be detected.
        return new Response("error", { status: 500 });
      });
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_ENABLED = false;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const confirmedProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "openrouter", model: "mock" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: true,
          violations: [{
            article: "119",
            subarticle: null,
            articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
            quote: "я тебя убью",
            punishment: "обязательные работы",
            severity: 7,
            confidence: 0.91,
            decision: "violation",
            evidence: {
              subject: "author",
              object: "victim",
              intent: "threat",
              contextSummary: "direct threat",
              whyNotBenign: "literal threat"
            }
          }],
          totalSeverity: 7,
          riskLevel: "high",
          analysisTimestamp: Date.now()
        }),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(confirmedProvider);
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "я тебя убью, это сообщение достаточно длинное для обхода локального детектора",
          chatId: 12345,
          userId: 67890,
          messageId: 2016,
          username: "testuser",
          day: "2026-05-18",
          sequence: 80,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // /criminal increment failed exactly once → criminal failed ack attempted.
      const criminalIncrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && (call[0] as string).includes("/criminal")
      );
      expect(criminalIncrementCalls).toHaveLength(1);
      // Criminal ack was attempted and its non-OK response detected.
      const criminalAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "criminal";
      });
      expect(criminalAckCalls).toHaveLength(1);

      // Safe metadata logged for the criminal ack, no raw response content.
      const criminalWarnCalls = consoleWarnSpy.mock.calls.filter((call) =>
        (call[1] as Record<string, unknown>)?.category === "criminal"
      );
      expect(criminalWarnCalls.length).toBeGreaterThan(0);
      for (const call of criminalWarnCalls) {
        const data = call[1] as Record<string, unknown>;
        expect(data.op).toBe("ack");
        expect(data.status).toBe(500);
        expect(["completed", "zero", "skipped", "failed"]).toContain(data.outcome);
        expect(JSON.stringify(call)).not.toMatch(/error|Internal Server Error/i);
      }
    });

    it("acks criminal completed for a known-user violation alongside the implicit /criminal increment", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_ENABLED = false;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const confirmedProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "openrouter", model: "mock" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: true,
          violations: [{
            article: "119",
            subarticle: null,
            articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
            quote: "я тебя убью",
            punishment: "обязательные работы",
            severity: 7,
            confidence: 0.91,
            decision: "violation",
            evidence: {
              subject: "author",
              object: "victim",
              intent: "threat",
              contextSummary: "direct threat",
              whyNotBenign: "literal threat"
            }
          }],
          totalSeverity: 7,
          riskLevel: "high",
          analysisTimestamp: Date.now()
        }),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(confirmedProvider);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "я тебя убью, это сообщение достаточно длинное для обхода локального детектора",
          chatId: 12345,
          userId: 67890,
          messageId: 2101,
          username: "testuser",
          day: "2026-05-18",
          sequence: 81,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // Known user: the implicit /criminal completed increment still fires
      // exactly once (per-user/per-article aggregates are written).
      const criminalIncrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && (call[0] as string).includes("/criminal")
      );
      expect(criminalIncrementCalls).toHaveLength(1);

      // The explicit completed ack now also fires for the known-user path;
      // CountersDO treats it as an idempotent no-op. Exactly one criminal ack.
      const criminalAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "criminal";
      });
      expect(criminalAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((criminalAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "criminal",
        messageId: 2101,
        sequence: 81,
        outcome: "completed",
      });
      expect(ackPayload.outcome).not.toBe("failed");
      expect(ackPayload.outcome).not.toBe("zero");
    });

    it("acks criminal completed for an anonymous (userId 0) violation so the sequence resolves", async () => {
      const storage = new Map<string, any>();
      mockState.storage = {
        get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
        put: vi.fn((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        setAlarm: vi.fn().mockResolvedValue(undefined),
      };
      const counterFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
      mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
      mockEnv.CRIMINAL_AI_PREFILTER_ENABLED = false;
      mockEnv.CRIMINAL_FINAL_JUDGE_ENABLED = false;
      mockEnv.COUNTERS_DO = {
        idFromName: vi.fn().mockReturnValue("test-id"),
        get: vi.fn().mockReturnValue({ fetch: counterFetch }),
      };
      const confirmedProvider = {
        getProviderInfo: vi.fn().mockReturnValue({ name: "openrouter", model: "mock" }),
        validateConfig: vi.fn(),
        analyzeCriminalCodeWithContext: vi.fn().mockResolvedValue({
          hasViolations: true,
          violations: [{
            article: "119",
            subarticle: null,
            articleTitle: "Угроза убийством или причинением тяжкого вреда здоровью",
            quote: "я тебя убью",
            punishment: "обязательные работы",
            severity: 7,
            confidence: 0.91,
            decision: "violation",
            evidence: {
              subject: "author",
              object: "victim",
              intent: "threat",
              contextSummary: "direct threat",
              whyNotBenign: "literal threat"
            }
          }],
          totalSeverity: 7,
          riskLevel: "high",
          analysisTimestamp: Date.now()
        }),
      };
      ProviderFactory.createProvider = vi.fn().mockReturnValue(confirmedProvider);
      const queueAnalyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);

      await queueAnalyzer.fetch(new Request("http://localhost/enqueue", {
        method: "POST",
        body: JSON.stringify({
          text: "я тебя убью, это сообщение достаточно длинное для обхода локального детектора",
          chatId: 12345,
          userId: 0,
          messageId: 2102,
          username: "anonymous-admin",
          day: "2026-05-18",
          sequence: 82,
        }),
        headers: { "Content-Type": "application/json" },
      }));

      // Anonymous author (userId 0): storeViolations' per-user guard
      // (chatId && userId && violations.length) is false, so the implicit
      // /criminal increment is suppressed — per-user/per-article aggregate
      // writes stay absent (not corrupted) for the anonymous case.
      const criminalIncrementCalls = counterFetch.mock.calls.filter((call) =>
        (call[1] as RequestInit).method === "POST" && (call[0] as string).includes("/criminal")
      );
      expect(criminalIncrementCalls).toHaveLength(0);

      // The criminal_violations D1 row is still inserted for the anonymous message.
      expect(mockEnv.DB.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO criminal_violations")
      );

      // THE FIX: exactly one criminal completed ack resolves the otherwise-hung
      // sequence. /ack requires only chatId/day/sequence/category/outcome — no
      // userId dependency — so progress closes even when /criminal could not.
      const criminalAckCalls = counterFetch.mock.calls.filter((call) => {
        const requestInit = call[1] as RequestInit;
        if (requestInit.method !== "POST" || !(call[0] as string).includes("/ack")) {
          return false;
        }
        return (JSON.parse(requestInit.body as string) as any).category === "criminal";
      });
      expect(criminalAckCalls).toHaveLength(1);
      const ackPayload = JSON.parse((criminalAckCalls[0][1] as RequestInit).body as string);
      expect(ackPayload).toMatchObject({
        chatId: 12345,
        day: "2026-05-18",
        category: "criminal",
        messageId: 2102,
        sequence: 82,
        outcome: "completed",
      });
      expect(ackPayload.outcome).not.toBe("failed");
      expect(ackPayload.outcome).not.toBe("zero");
      expect(ackPayload.userId).toBeUndefined();
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

  describe("privacy-safe error logging", () => {
    it("never logs raw error message containing simulated telegram text", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // Force initialization failure with an error whose message mimics user text.
      ProviderFactory.createProvider = vi.fn().mockRejectedValue(
        new Error("simulated telegram text: я тебя убью")
      );
      mockState.blockConcurrencyWhile = vi.fn((fn: () => Promise<any>) => fn());

      const analyzer = new CriminalCodeAnalyzerDO(mockState, mockEnv);
      await analyzer.fetch(new Request("http://localhost/analyze", {
        method: "POST",
        body: JSON.stringify({ text: "длинная проверяемая фраза", chatId: 1, userId: 2, messageId: 3 }),
        headers: { "Content-Type": "application/json" },
      }));

      const calls = consoleErrorSpy.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        // No raw error object, message, or stack may reach the logger.
        expect(call[0]).not.toContain("я тебя убью");
        expect(JSON.stringify(call)).not.toContain("simulated telegram text");
        // Safe metadata retained.
        if (call[1] && typeof call[1] === "object") {
          const data = call[1] as Record<string, unknown>;
          expect(data.errorClass).toBe("Error");
        }
      }
    });
  });
});
