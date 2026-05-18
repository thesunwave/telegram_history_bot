import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../src/core/providers/openrouter-provider';
import type { Env } from '../../src/core/env';

describe('OpenRouterProvider', () => {
  let env: Env;

  beforeEach(() => {
    env = {
      OPENROUTER_API_KEY: 'test-openrouter-key',
      OPENROUTER_MODEL: 'nvidia/nemotron-3-super-120b-a12b:free',
      HISTORY: {} as any,
      COUNTERS: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      } as any,
      COUNTERS_DO: {} as any,
      MESSAGE_FETCHER_DO: {} as any,
      MESSAGE_AGGREGATOR_DO: {} as any,
      CRIMINAL_CODE_ANALYZER_DO: {} as any,
      DAY_BLOCK_MANAGER_DO: {} as any,
      DB: {} as any,
      AI: {} as any,
      TOKEN: 'test-token',
      SECRET: 'test-secret',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'test-prompt',
    } as Env;
    vi.restoreAllMocks();
  });

  it('sends OpenRouter chat completions with JSON mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            hasViolations: false,
            decision: 'no_violation',
            evidence: {
              subject: 'author',
              object: 'stool',
              intent: 'rough metaphor',
              contextSummary: 'furniture repair',
              whyNotBenign: 'benign object',
            },
            violations: [],
            totalSeverity: 0,
            riskLevel: 'low',
            analysisTimestamp: Date.now(),
          }),
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider(env);
    const result = await provider.analyzeCriminalCodeWithContext({
      chatId: 123,
      targetMessageId: 7,
      targetText: 'я ее трахнул',
      targetTimestamp: 1000,
      contextWindow: { before: 1, after: 0, totalMessages: 2 },
      messages: [
        {
          username: 'user',
          text: 'табуретка сломалась',
          ts: 999,
          relativePosition: -1,
          isTarget: false,
        },
        {
          messageId: 7,
          username: 'user',
          text: 'я ее трахнул',
          ts: 1000,
          relativePosition: 0,
          isTarget: true,
        },
      ],
    });

    expect(result.hasViolations).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.model).toBe('nvidia/nemotron-3-super-120b-a12b:free');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(init.headers.Authorization).toBe('Bearer test-openrouter-key');
    expect(result.decision).toBe('no_violation');
  });

  it('returns safe fallback for rate limits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'rate limited' },
    }), { status: 429 })));

    const provider = new OpenRouterProvider(env);
    const result = await provider.analyzeCriminalCode('пора всех их убивать', env);

    expect(result.hasViolations).toBe(false);
    expect(result.decision).toBe('no_violation');
  });

  it('filters malformed JSON to safe fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'not json' }, finish_reason: 'stop' }],
    }), { status: 200 })));

    const provider = new OpenRouterProvider(env);
    const result = await provider.analyzeCriminalCode('пора всех их убивать', env);

    expect(result.hasViolations).toBe(false);
    expect(result.violations).toEqual([]);
  });
});
