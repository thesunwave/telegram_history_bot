import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CriminalCodeAnalyzerDO } from '../src/durable-objects/criminal-code-analyzer-do';
import { CountersDO } from '../src/durable-objects/counters-do';

vi.mock('../src/core/logger', () => ({
  Logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/core/providers/provider-factory', () => ({
  ProviderFactory: {
    createProvider: vi.fn().mockReturnValue({
      getProviderInfo: vi.fn().mockReturnValue({ name: 'mock', model: 'mock' }),
      validateConfig: vi.fn(),
      analyzeCriminalCode: vi.fn().mockResolvedValue({
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: Date.now(),
      }),
    }),
  },
}));

vi.mock('../src/core/providers/provider-init', () => ({
  ProviderInitializer: {
    initialize: vi.fn().mockResolvedValue({
      analyzeCriminalCode: vi.fn().mockResolvedValue({
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
      }),
    }),
  },
}));

const createMockState = () => ({
  blockConcurrencyWhile: vi.fn((fn: () => Promise<any>) => fn()),
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
});

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
    idFromName: vi.fn().mockReturnValue('test-id'),
    get: vi.fn().mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })),
    }),
  },
  SUMMARY_PROVIDER: 'openai',
  OPENAI_API_KEY: 'test-key',
  DEBUG_LOGS: 'true',
});

function countersDoFetchSpy(): { fetch: ReturnType<typeof vi.fn> } {
  return { fetch: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) };
}

function postedProfanityWords(counterFetch: ReturnType<typeof vi.fn>): Array<Array<{ word: string; count: number }>> {
  return counterFetch.mock.calls.map((call) => {
    const body = JSON.parse((call[1] as RequestInit).body as string);
    return Array.isArray(body.words) ? body.words : [];
  });
}

function postedPayloads(counterFetch: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return counterFetch.mock.calls.map((call) =>
    JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>,
  );
}

describe('criminal prefilter — себе FP must not reach profanity counters', () => {
  let analyzer: CriminalCodeAnalyzerDO;
  let mockState: any;
  let mockEnv: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState = createMockState();
    mockEnv = createMockEnv();
    analyzer = new CriminalCodeAnalyzerDO(mockState as any, mockEnv as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('local-only short-message path does not POST a себе FP', async () => {
    mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
    const countersStub = countersDoFetchSpy();
    mockEnv.COUNTERS_DO = {
      idFromName: vi.fn().mockReturnValue('test-id'),
      get: vi.fn().mockReturnValue(countersStub),
    };
    vi.stubGlobal('fetch', vi.fn());

    const response = await analyzer.fetch(new Request('http://localhost/enqueue', {
      method: 'POST',
      body: JSON.stringify({
        text: 'к себе',
        chatId: 777,
        userId: 888,
        messageId: 5001,
        username: 'testuser',
        day: '2026-05-18',
      }),
      headers: { 'Content-Type': 'application/json' },
    }));
    const result = await response.json() as any;

    expect(result.queued).toBe(false);
    expect(result.reasons).toContain('too_short');

    const sebePayloads = postedPayloads(countersStub.fetch).filter((p) =>
      Array.isArray(p.words) && p.words.some((w: any) => w?.word === 'себе'),
    );
    expect(sebePayloads.length, 'no /profanity POST carrying { word: "себе" }').toBe(0);
  });

  it('counters DO writes the surface token it is handed (wiring pinned)', async () => {
    const kv = new Map<string, string>();
    const putSpy = vi.fn((key: string, value: string) => {
      kv.set(key, value);
      return Promise.resolve();
    });
    const countersEnv = {
      COUNTERS: {
        get: vi.fn((key: string) => Promise.resolve(kv.get(key) || null)),
        put: putSpy,
        delete: vi.fn(),
        list: vi.fn().mockResolvedValue({ keys: [], list_complete: true, cacheStatus: null }),
      } as any,
      DB: null as any,
    };
    const countersState = {
      blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn()),
    };
    const countersDO = new CountersDO(countersState as any, countersEnv as any);

    const response = await countersDO.fetch(new Request('https://do/profanity', {
      method: 'POST',
      body: JSON.stringify({
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 1,
        words: [{ word: 'себе', count: 1 }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(putSpy).toHaveBeenCalledWith('profanity:123:456:2025-01-01', '1');
    expect(putSpy).toHaveBeenCalledWith('profanity_words:123:себе:2025-01-01', '1');
  });

  it('queued (>= 8 chars) path does not submit the себе FP even when AI denies profanity', async () => {
    const storage = new Map<string, any>();
    mockState.storage = {
      get: vi.fn((key: string) => Promise.resolve(storage.get(key))),
      put: vi.fn((key: string, value: any) => {
        storage.set(key, value);
        return Promise.resolve();
      }),
    };
    mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
    mockEnv.CRIMINAL_QUEUE_BATCH_SIZE = 1;
    mockEnv.CRIMINAL_PREFILTER_MODEL = 'gpt-5-nano';
    const countersStub = countersDoFetchSpy();
    mockEnv.COUNTERS_DO = {
      idFromName: vi.fn().mockReturnValue('test-id'),
      get: vi.fn().mockReturnValue(countersStub),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        shouldAnalyze: false,
        reason: 'none',
        confidence: 0.1,
        explanation: 'no legal signal',
        searchQuery: '',
        profanity: {
          hasProfanity: false,
          words: [],
        },
      }),
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    }), { status: 200 })));
    const queuedAnalyzer = new CriminalCodeAnalyzerDO(mockState as any, mockEnv as any);

    await queuedAnalyzer.fetch(new Request('http://localhost/enqueue', {
      method: 'POST',
      body: JSON.stringify({
        text: 'я купил себе кофе',
        chatId: 777,
        userId: 888,
        messageId: 5002,
        username: 'testuser',
        day: '2026-05-18',
      }),
      headers: { 'Content-Type': 'application/json' },
    }));

    const allWords = postedProfanityWords(countersStub.fetch).flat();
    expect(
      allWords.some((w) => w?.word === 'себе'),
      'no queued-path /profanity POST carrying { word: "себе" }',
    ).toBe(false);
  });

  it('full-chain: a себе increment does not reach COUNTERS.put through a real CountersDO', async () => {
    const kv = new Map<string, string>();
    const putSpy = vi.fn((key: string, value: string) => {
      kv.set(key, value);
      return Promise.resolve();
    });
    const countersEnv = {
      COUNTERS: {
        get: vi.fn((key: string) => Promise.resolve(kv.get(key) || null)),
        put: putSpy,
        delete: vi.fn(),
        list: vi.fn().mockResolvedValue({ keys: [], list_complete: true, cacheStatus: null }),
      } as any,
      DB: null as any,
    };
    const countersState = {
      blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn()),
    };
    const realCounters = new CountersDO(countersState as any, countersEnv as any);

    mockEnv.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER = true;
    mockEnv.COUNTERS_DO = {
      idFromName: vi.fn().mockReturnValue('test-id'),
      get: vi.fn().mockReturnValue({
        fetch: (url: string, init: RequestInit) => realCounters.fetch(new Request(url, init)),
      }),
    };
    vi.stubGlobal('fetch', vi.fn());

    await analyzer.fetch(new Request('http://localhost/enqueue', {
      method: 'POST',
      body: JSON.stringify({
        text: 'к себе',
        chatId: 777,
        userId: 888,
        messageId: 5003,
        username: 'testuser',
        day: '2026-05-18',
      }),
      headers: { 'Content-Type': 'application/json' },
    }));

    const sebePuts = putSpy.mock.calls.filter(([key]) =>
      typeof key === 'string' && key.includes('себе'),
    );
    expect(sebePuts.length, 'no COUNTERS.put carrying "себе" at the real CountersDO call site').toBe(0);
  });
});
