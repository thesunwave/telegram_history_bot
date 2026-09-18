import { afterEach, describe, expect, it, vi } from 'vitest';
import { CriminalCodeAnalyzerDO } from '../src/durable-objects/criminal-code-analyzer-do';

function createHistoryKv() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn(async () => null),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
  };
}

async function drainWaitUntil(pending: Promise<unknown>[]): Promise<void> {
  for (let pass = 0; pass < 10; pass++) {
    const current = pending.splice(0, pending.length);
    if (current.length === 0) return;
    await Promise.all(current);
  }
}

describe('criminal semantic prefilter shadow evaluation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses Qwen as production truth while OpenAI is stored independently', async () => {
    const history = createHistoryKv();
    const pending: Promise<unknown>[] = [];
    const state = {
      waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
      storage: {
        get: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
      },
    } as any;
    const counters = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    const env = {
      HISTORY: history,
      COUNTERS: counters,
      OPENAI_API_KEY: 'openai-test-key',
      CRIMINAL_PREFILTER_MODEL: 'gpt-4.1-nano',
      CRIMINAL_PREFILTER_PROVIDER: 'qwen',
      CRIMINAL_PREFILTER_CACHE_ENABLED: false,
      CRIMINAL_PREFILTER_BATCH_ENABLED: false,
      CRIMINAL_PREFILTER_MIN_CONFIDENCE: 0.7,
      SHADOW_EVAL_ENABLED: true,
      ALIBABA_API_KEY: 'qwen-test-key',
      QWEN_PREFILTER_MODEL: 'qwen3.7-flash',
      QWEN_PREFILTER_BASE_URL: 'https://example.aliyuncs.com/compatible-mode/v1',
      QWEN_PREFILTER_PROMPT_VARIANT: 'hybrid_en_v1',
    } as any;

    const openaiOutput = {
      shouldAnalyze: true,
      reason: 'threat',
      confidence: 0.93,
      explanation: 'direct threat',
      searchQuery: 'угроза убийством адресату',
      semanticFrame: {
        speechAct: 'threat',
        actor: 'author',
        action: 'угрожает убийством',
        targetKind: 'person',
        harmKind: 'death',
        modality: 'promised',
        evidenceSpans: ['я тебя убью'],
      },
      profanity: {
        hasProfanity: true,
        words: [{ word: 'блядь', count: 1, confidence: 0.98 }],
      },
    };
    const qwenOutput = {
      shouldAnalyze: false,
      reason: 'none',
      confidence: 0.82,
      explanation: 'shadow disagrees',
      searchQuery: '',
      semanticFrame: {
        speechAct: 'other',
        actor: 'author',
        action: '',
        targetKind: 'unknown',
        harmKind: 'none',
        modality: 'unknown',
        evidenceSpans: [],
      },
      profanity: {
        hasProfanity: true,
        words: [{ word: 'пизда', count: 1, confidence: 0.99 }],
      },
    };

    const requests: Array<{ url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const output = url.includes('aliyuncs.com') ? qwenOutput : openaiOutput;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const analyzer = new CriminalCodeAnalyzerDO(state, env);
    const targetText = 'я тебя убью, блядь';
    const item = {
      id: '0',
      input: {
        targetMessageId: 55,
        targetUserId: 9,
        targetUsername: 'alice',
        targetText,
        targetTimestamp: Math.floor(Date.now() / 1000),
        chatId: 123,
        contextWindow: { before: 0, after: 0, totalMessages: 1 },
        messages: [{
          messageId: 55,
          username: 'alice',
          userId: 9,
          text: targetText,
          ts: Math.floor(Date.now() / 1000),
          relativePosition: 0,
          isTarget: true,
        }],
      },
      task: {
        text: targetText,
        chatId: 123,
        userId: 9,
        messageId: 55,
        username: 'alice',
        reasons: ['semantic_prefilter'],
        enqueuedAt: Date.now(),
      },
    };

    const result = await (analyzer as any).runSemanticPrefilterBatch([item]);
    await drainWaitUntil(pending);

    expect(result.get('0').shouldAnalyze).toBe(false);
    expect(result.get('0').reason).toBe('none');

    const stored = Array.from(history.values.entries()).map(([key, value]) => [key, JSON.parse(value)] as const);
    const inputRecord = stored.find(([key]) => key.endsWith(':input'))?.[1];
    const openaiRecord = stored.find(([key]) => key.endsWith(':openai'))?.[1];
    const qwenRecord = stored.find(([key]) => key.endsWith(':qwen'))?.[1];

    expect(inputRecord.targetText).toBe(targetText);
    expect(inputRecord.userInput).toContain(targetText);
    expect(inputRecord.systemPrompt).toContain('Classify only the TARGET message.');
    expect(inputRecord.systemPrompt).toContain('write searchQuery in Russian');
    expect(openaiRecord.parsedOutput.shouldAnalyze).toBe(true);
    expect(qwenRecord.parsedOutput.shouldAnalyze).toBe(false);
    expect(qwenRecord.parsedOutput.profanity).toEqual({ hasProfanity: false, words: [] });
    expect(openaiRecord.evaluationId).toBe(inputRecord.evaluationId);
    expect(qwenRecord.evaluationId).toBe(inputRecord.evaluationId);

    const qwenRequest = requests.find(request => request.url.includes('aliyuncs.com'))!;
    const openaiRequest = requests.find(request => !request.url.includes('aliyuncs.com'))!;
    expect(qwenRequest.body.messages[0].content).toContain('You are a fast semantic prefilter');
    expect(qwenRequest.body.messages[0].content).toContain('признание в тайном хищении чужого имущества');
    expect(openaiRequest.body.messages[0].content).toContain('Ты быстрый prefilter для Telegram-чата.');
    expect(qwenRequest.body.max_tokens).toBeUndefined();
    expect(qwenRequest.body.enable_thinking).toBe(false);
    expect(qwenRequest.body.response_format.type).toBe('json_schema');
    expect(qwenRequest.body.response_format.json_schema.strict).toBe(true);
    expect(qwenRequest.body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(qwenRequest.body.response_format.json_schema.schema.required).toContain('profanity');

    const batchFormat = (analyzer as any).buildQwenPrefilterResponseFormat(true);
    expect(batchFormat.type).toBe('json_schema');
    expect(batchFormat.json_schema.strict).toBe(true);
    expect(batchFormat.json_schema.schema.required).toEqual(['items']);
    expect(batchFormat.json_schema.schema.properties.items.items.required).toContain('id');
  });

  it('falls back to an OpenAI single call when production Qwen returns malformed JSON', async () => {
    const history = createHistoryKv();
    const pending: Promise<unknown>[] = [];
    const state = {
      waitUntil: vi.fn((promise: Promise<unknown>) => pending.push(promise)),
      storage: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) },
    } as any;
    const env = {
      HISTORY: history,
      COUNTERS: { get: vi.fn(async () => null), put: vi.fn(async () => undefined) },
      OPENAI_API_KEY: 'openai-test-key',
      CRIMINAL_PREFILTER_MODEL: 'gpt-4.1-nano',
      CRIMINAL_PREFILTER_PROVIDER: 'qwen',
      CRIMINAL_PREFILTER_CACHE_ENABLED: false,
      CRIMINAL_PREFILTER_BATCH_ENABLED: false,
      SHADOW_EVAL_ENABLED: true,
      ALIBABA_API_KEY: 'qwen-test-key',
      QWEN_PREFILTER_BASE_URL: 'https://example.aliyuncs.com/compatible-mode/v1',
    } as any;
    const targetText = 'я тебя убью';
    const openaiOutput = {
      shouldAnalyze: true,
      reason: 'threat',
      confidence: 0.95,
      explanation: 'direct threat',
      searchQuery: 'угроза убийством адресату',
      semanticFrame: {
        speechAct: 'threat', actor: 'author', action: 'угрожает убийством', targetKind: 'person',
        harmKind: 'death', modality: 'promised', evidenceSpans: [targetText],
      },
      profanity: { hasProfanity: false, words: [] },
    };

    const malformedQwen = '{"shouldAnalyze":true,"reason":"threat"';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('aliyuncs.com')) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: malformedQwen }, finish_reason: 'length' }],
          usage: { prompt_tokens: 100, completion_tokens: 512, total_tokens: 612 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(openaiOutput) }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const analyzer = new CriminalCodeAnalyzerDO(state, env);
    const result = await (analyzer as any).runSemanticPrefilterBatch([{
      id: '0',
      input: {
        targetMessageId: 1,
        targetUserId: 2,
        targetUsername: 'alice',
        targetText,
        targetTimestamp: Math.floor(Date.now() / 1000),
        chatId: 123,
        contextWindow: { before: 0, after: 0, totalMessages: 1 },
        messages: [{
          messageId: 1, username: 'alice', userId: 2, text: targetText,
          ts: Math.floor(Date.now() / 1000), relativePosition: 0, isTarget: true,
        }],
      },
      task: {
        text: targetText, chatId: 123, userId: 2, messageId: 1, username: 'alice',
        reasons: ['semantic_prefilter'], enqueuedAt: Date.now(),
      },
    }]);
    await drainWaitUntil(pending);

    expect(result.get('0').shouldAnalyze).toBe(true);
    expect(result.get('0').reason).toBe('threat');
    const qwenRecord = Array.from(history.values.entries())
      .filter(([key]) => key.endsWith(':qwen'))
      .map(([, value]) => JSON.parse(value))[0];
    const openaiRecord = Array.from(history.values.entries())
      .filter(([key]) => key.endsWith(':openai'))
      .map(([, value]) => JSON.parse(value))[0];
    expect(qwenRecord.status).toBe('error');
    expect(qwenRecord.error).toContain('JSON');
    expect(qwenRecord.rawOutput).toBe(malformedQwen);
    expect(qwenRecord.finishReason).toBe('length');
    expect(qwenRecord.usage.totalTokens).toBe(612);
    expect(openaiRecord.status).toBe('ok');
    expect(openaiRecord.parsedOutput.shouldAnalyze).toBe(true);
  });

  it('keeps production Qwen items isolated in single requests even when generic batching is enabled', async () => {
    const state = {
      waitUntil: vi.fn(),
      storage: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) },
    } as any;
    const env = {
      HISTORY: createHistoryKv(),
      COUNTERS: { get: vi.fn(async () => null), put: vi.fn(async () => undefined) },
      CRIMINAL_PREFILTER_PROVIDER: 'qwen',
      CRIMINAL_PREFILTER_CACHE_ENABLED: false,
      CRIMINAL_PREFILTER_BATCH_ENABLED: true,
      QWEN_PREFILTER_BATCH_ENABLED: false,
      SHADOW_EVAL_ENABLED: false,
      ALIBABA_API_KEY: 'qwen-test-key',
      QWEN_PREFILTER_BASE_URL: 'https://example.aliyuncs.com/compatible-mode/v1',
    } as any;
    const now = Math.floor(Date.now() / 1000);
    const makeItem = (id: string, messageId: number, targetText: string) => ({
      id,
      input: {
        targetMessageId: messageId,
        targetUserId: messageId,
        targetUsername: `user${id}`,
        targetText,
        targetTimestamp: now,
        chatId: 123,
        contextWindow: { before: 0, after: 0, totalMessages: 1 },
        messages: [{
          messageId,
          username: `user${id}`,
          userId: messageId,
          text: targetText,
          ts: now,
          relativePosition: 0,
          isTarget: true,
        }],
      },
      task: {
        text: targetText,
        chatId: 123,
        userId: messageId,
        messageId,
        username: `user${id}`,
        reasons: ['semantic_prefilter'],
        enqueuedAt: Date.now(),
      },
    });
    const skipResult = {
      shouldAnalyze: false,
      reason: 'none',
      confidence: 0.95,
      explanation: 'no signal',
      searchQuery: '',
      semanticFrame: {
        speechAct: 'other', actor: 'author', action: '', targetKind: 'unknown',
        harmKind: 'none', modality: 'unknown', evidenceSpans: [],
      },
      profanity: { hasProfanity: false, words: [] },
    };
    const requestBodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(skipResult) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const analyzer = new CriminalCodeAnalyzerDO(state, env);
    await (analyzer as any).runSemanticPrefilterBatch([
      makeItem('0', 1, 'first isolated target'),
      makeItem('1', 2, 'second isolated target'),
    ]);

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies.every(body => body.response_format.json_schema.name === 'criminal_prefilter')).toBe(true);
    const firstRequest = requestBodies.find(body => body.messages[1].content.includes('first isolated target'));
    const secondRequest = requestBodies.find(body => body.messages[1].content.includes('second isolated target'));
    expect(firstRequest).toBeDefined();
    expect(secondRequest).toBeDefined();
    expect(firstRequest!.messages[1].content).not.toContain('second isolated target');
    expect(secondRequest!.messages[1].content).not.toContain('first isolated target');
  });

  it('retries a missing Qwen batch item as a single request before using the result', async () => {
    const history = createHistoryKv();
    const state = {
      waitUntil: vi.fn(),
      storage: { get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) },
    } as any;
    const env = {
      HISTORY: history,
      COUNTERS: { get: vi.fn(async () => null), put: vi.fn(async () => undefined) },
      CRIMINAL_PREFILTER_PROVIDER: 'qwen',
      CRIMINAL_PREFILTER_CACHE_ENABLED: false,
      CRIMINAL_PREFILTER_BATCH_ENABLED: true,
      QWEN_PREFILTER_BATCH_ENABLED: true,
      CRIMINAL_PREFILTER_BATCH_SIZE: 8,
      CRIMINAL_PREFILTER_MIN_CONFIDENCE: 0.7,
      SHADOW_EVAL_ENABLED: false,
      ALIBABA_API_KEY: 'qwen-test-key',
      QWEN_PREFILTER_BASE_URL: 'https://example.aliyuncs.com/compatible-mode/v1',
    } as any;
    const now = Math.floor(Date.now() / 1000);
    const makeItem = (id: string, messageId: number, targetText: string) => ({
      id,
      input: {
        targetMessageId: messageId,
        targetUserId: messageId,
        targetUsername: `user${id}`,
        targetText,
        targetTimestamp: now,
        chatId: 123,
        contextWindow: { before: 0, after: 0, totalMessages: 1 },
        messages: [{
          messageId,
          username: `user${id}`,
          userId: messageId,
          text: targetText,
          ts: now,
          relativePosition: 0,
          isTarget: true,
        }],
      },
      task: {
        text: targetText,
        chatId: 123,
        userId: messageId,
        messageId,
        username: `user${id}`,
        reasons: ['semantic_prefilter'],
        enqueuedAt: Date.now(),
      },
    });
    const skipResult = {
      shouldAnalyze: false,
      reason: 'none',
      confidence: 0.95,
      explanation: 'no signal',
      searchQuery: '',
      semanticFrame: {
        speechAct: 'other', actor: 'author', action: '', targetKind: 'unknown',
        harmKind: 'none', modality: 'unknown', evidenceSpans: [],
      },
      profanity: { hasProfanity: false, words: [] },
    };
    const threatResult = {
      shouldAnalyze: true,
      reason: 'threat',
      confidence: 0.95,
      explanation: 'direct threat',
      searchQuery: 'угроза убийством адресату',
      semanticFrame: {
        speechAct: 'threat', actor: 'author', action: 'угрожает убийством', targetKind: 'person',
        harmKind: 'death', modality: 'promised', evidenceSpans: ['я тебя убью'],
      },
      profanity: { hasProfanity: false, words: [] },
    };
    const requestBodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requestBodies.push(body);
      const isBatch = body.response_format?.json_schema?.name === 'criminal_prefilter_batch';
      const content = isBatch
        ? { items: [{ id: '0', ...skipResult }] }
        : threatResult;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const analyzer = new CriminalCodeAnalyzerDO(state, env);
    const result = await (analyzer as any).runSemanticPrefilterBatch([
      makeItem('0', 1, 'обычная длинная фраза'),
      makeItem('1', 2, 'я тебя убью'),
    ]);

    expect(requestBodies).toHaveLength(2);
    expect(requestBodies[0].response_format.json_schema.name).toBe('criminal_prefilter_batch');
    expect(requestBodies[1].response_format.json_schema.name).toBe('criminal_prefilter');
    expect(result.get('0').shouldAnalyze).toBe(false);
    expect(result.get('1').shouldAnalyze).toBe(true);
    expect(result.get('1').reason).toBe('threat');
  });
});
