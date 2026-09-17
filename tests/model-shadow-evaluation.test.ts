import { describe, expect, it, vi } from 'vitest';
import {
  listShadowEvaluationComparisons,
  shadowEvaluationInternals,
  storeShadowEvaluationInput,
  storeShadowEvaluationProviderResult,
  type ShadowEvaluationInputRecord,
  type ShadowEvaluationProviderRecord,
} from '../src/features/model-shadow/evaluation-store';

function createHistoryKv() {
  const values = new Map<string, string>();
  const put = vi.fn(async (
    key: string,
    value: string,
    _options?: { expirationTtl?: number },
  ) => {
    values.set(key, value);
  });
  const get = vi.fn(async (key: string, type?: string) => {
    const value = values.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  });
  const list = vi.fn(async ({ prefix }: { prefix: string }) => ({
    keys: Array.from(values.keys())
      .filter(key => key.startsWith(prefix))
      .map(name => ({ name })),
    list_complete: true,
    cacheStatus: null,
  }));
  return { values, put, get, list };
}

function inputRecord(createdAt: number): ShadowEvaluationInputRecord {
  return {
    evaluationId: 'eval-1',
    feature: 'criminal_prefilter',
    createdAt,
    chatId: 123,
    messageId: 456,
    targetText: 'example target text',
    targetUsername: 'alice',
    systemPrompt: 'system prompt',
    userInput: 'exact user input',
    batchItemId: '0',
    batchSize: 1,
  };
}

function providerRecord(
  createdAt: number,
  provider: 'openai' | 'qwen',
  overrides: Partial<ShadowEvaluationProviderRecord> = {}
): ShadowEvaluationProviderRecord {
  return {
    evaluationId: 'eval-1',
    feature: 'criminal_prefilter',
    chatId: 123,
    provider,
    model: provider === 'openai' ? 'gpt-5-nano' : 'qwen3.7-flash',
    createdAt,
    latencyMs: provider === 'openai' ? 120 : 80,
    status: 'ok',
    parsedOutput: {
      shouldAnalyze: true,
      reason: 'threat',
      confidence: 0.9,
      explanation: 'example',
      searchQuery: 'угроза убийством адресату',
      semanticFrame: {
        speechAct: 'threat',
        actor: 'author',
        action: 'threatens harm',
        targetKind: 'person',
        harmKind: 'bodily_harm',
        modality: 'promised',
        evidenceSpans: ['example target text'],
      },
      profanity: {
        hasProfanity: true,
        words: [{ word: 'хуй', count: 1, confidence: 0.9 }],
      },
    },
    ...overrides,
  };
}

describe('model shadow evaluation store', () => {
  it('stores input and provider outputs under separate correlated KV keys with bounded TTL', async () => {
    const history = createHistoryKv();
    const env = { HISTORY: history, SHADOW_EVAL_RETENTION_SECONDS: 9999999 } as any;
    const createdAt = Date.now();

    await storeShadowEvaluationInput(env, inputRecord(createdAt));
    await storeShadowEvaluationProviderResult(env, providerRecord(createdAt, 'openai'));
    await storeShadowEvaluationProviderResult(env, providerRecord(createdAt, 'qwen'));

    expect(history.values.size).toBe(3);
    expect(Array.from(history.values.keys()).some(key => key.endsWith(':input'))).toBe(true);
    expect(Array.from(history.values.keys()).some(key => key.endsWith(':openai'))).toBe(true);
    expect(Array.from(history.values.keys()).some(key => key.endsWith(':qwen'))).toBe(true);
    for (const call of history.put.mock.calls) {
      expect(call[2]?.expirationTtl).toBeLessThanOrEqual(7 * 24 * 60 * 60);
    }
    expect(shadowEvaluationInternals.retentionSeconds(env)).toBe(7 * 24 * 60 * 60);
  });

  it('builds side-by-side comparisons without treating either provider as ground truth', async () => {
    const history = createHistoryKv();
    const env = { HISTORY: history } as any;
    const createdAt = Date.now();

    await storeShadowEvaluationInput(env, inputRecord(createdAt));
    await storeShadowEvaluationProviderResult(env, providerRecord(createdAt, 'openai'));
    await storeShadowEvaluationProviderResult(env, providerRecord(createdAt, 'qwen', {
      parsedOutput: {
        ...providerRecord(createdAt, 'qwen').parsedOutput!,
        reason: 'violent_expression',
        profanity: { hasProfanity: false, words: [] },
      },
    }));

    const result = await listShadowEvaluationComparisons(env, 123, 3, 100);

    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0].comparison).toEqual({
      complete: true,
      crimeDecisionMatch: true,
      crimeReasonMatch: false,
      profanityPresenceMatch: false,
      profanityWordsMatch: false,
    });
    expect(result.summary.completePairs).toBe(1);
    expect(result.summary.crimeDecisionMatches).toBe(1);
    expect(result.summary.crimeReasonMatches).toBe(0);
    expect(result.summary.profanityPresenceMatches).toBe(0);
    expect(result.summary.openaiAverageLatencyMs).toBe(120);
    expect(result.summary.qwenAverageLatencyMs).toBe(80);
    expect(Object.keys(result.summary)).not.toContain('winner');
  });

  it('keeps provider failures visible without fabricating a comparison', async () => {
    const history = createHistoryKv();
    const env = { HISTORY: history } as any;
    const createdAt = Date.now();

    await storeShadowEvaluationInput(env, inputRecord(createdAt));
    await storeShadowEvaluationProviderResult(env, providerRecord(createdAt, 'openai'));
    await storeShadowEvaluationProviderResult(env, providerRecord(createdAt, 'qwen', {
      status: 'error',
      parsedOutput: undefined,
      error: 'provider unavailable',
    }));

    const result = await listShadowEvaluationComparisons(env, 123, 1, 100);

    expect(result.comparisons[0].comparison.complete).toBe(false);
    expect(result.comparisons[0].comparison.crimeDecisionMatch).toBeNull();
    expect(result.summary.qwenErrors).toBe(1);
    expect(result.summary.completePairs).toBe(0);
  });
});
