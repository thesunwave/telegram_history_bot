import type { Env, CriminalSemanticPrefilterResult } from '../../core/env';

const SHADOW_EVALUATION_PREFIX = 'shadow_eval:v1';
const DEFAULT_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const MAX_COMPARISON_DAYS = 7;
const KV_LIST_LIMIT = 1000;

export type ShadowEvaluationProvider = 'openai' | 'qwen';
export type ShadowEvaluationStatus = 'ok' | 'error';

export interface ShadowEvaluationInputRecord {
  evaluationId: string;
  feature: 'criminal_prefilter';
  createdAt: number;
  chatId: number;
  messageId?: number;
  targetText: string;
  targetUsername?: string;
  systemPrompt: string;
  userInput: string;
  batchItemId: string;
  batchSize: number;
}

export interface ShadowEvaluationUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  scope: 'request';
  batchSize: number;
}

export interface ShadowEvaluationProviderRecord {
  evaluationId: string;
  feature: 'criminal_prefilter';
  chatId: number;
  provider: ShadowEvaluationProvider;
  model: string;
  createdAt: number;
  latencyMs: number;
  status: ShadowEvaluationStatus;
  rawOutput?: string;
  parsedOutput?: CriminalSemanticPrefilterResult;
  finishReason?: string;
  usage?: ShadowEvaluationUsage;
  error?: string;
}

export interface ShadowEvaluationComparison {
  evaluationId: string;
  createdAt: number;
  input: ShadowEvaluationInputRecord;
  openai: ShadowEvaluationProviderRecord | null;
  qwen: ShadowEvaluationProviderRecord | null;
  comparison: {
    complete: boolean;
    crimeDecisionMatch: boolean | null;
    crimeReasonMatch: boolean | null;
    profanityPresenceMatch: boolean | null;
    profanityWordsMatch: boolean | null;
  };
}

export interface ShadowEvaluationSummary {
  totalInputs: number;
  completePairs: number;
  openaiErrors: number;
  qwenErrors: number;
  crimeDecisionMatches: number;
  crimeDecisionCompared: number;
  crimeReasonMatches: number;
  crimeReasonCompared: number;
  profanityPresenceMatches: number;
  profanityPresenceCompared: number;
  profanityWordsMatches: number;
  profanityWordsCompared: number;
  openaiAverageLatencyMs: number | null;
  qwenAverageLatencyMs: number | null;
}

function retentionSeconds(env: Env): number {
  const configured = Number((env as any).SHADOW_EVAL_RETENTION_SECONDS);
  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_RETENTION_SECONDS;
  }
  return Math.min(Math.max(Math.round(configured), 60 * 60), DEFAULT_RETENTION_SECONDS);
}

function utcDay(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function recordKey(
  createdAt: number,
  chatId: number,
  evaluationId: string,
  suffix: 'input' | ShadowEvaluationProvider
): string {
  return `${SHADOW_EVALUATION_PREFIX}:${utcDay(createdAt)}:${chatId}:${evaluationId}:${suffix}`;
}

export function createShadowEvaluationId(): string {
  return crypto.randomUUID();
}

export async function storeShadowEvaluationInput(
  env: Env,
  record: ShadowEvaluationInputRecord
): Promise<void> {
  await env.HISTORY.put(
    recordKey(record.createdAt, record.chatId, record.evaluationId, 'input'),
    JSON.stringify(record),
    { expirationTtl: retentionSeconds(env) }
  );
}

export async function storeShadowEvaluationProviderResult(
  env: Env,
  record: ShadowEvaluationProviderRecord
): Promise<void> {
  await env.HISTORY.put(
    recordKey(record.createdAt, record.chatId, record.evaluationId, record.provider),
    JSON.stringify(record),
    { expirationTtl: retentionSeconds(env) }
  );
}

async function listInputKeysForDay(env: Env, day: string, chatId: number): Promise<string[]> {
  const prefix = `${SHADOW_EVALUATION_PREFIX}:${day}:${chatId}:`;
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.HISTORY.list({ prefix, limit: KV_LIST_LIMIT, cursor });
    for (const key of page.keys) {
      if (key.name.endsWith(':input')) {
        keys.push(key.name);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return keys;
}

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    return await env.HISTORY.get(key, 'json') as T | null;
  } catch {
    return null;
  }
}

function sortedProfanityWords(result?: CriminalSemanticPrefilterResult): string[] {
  const words = result?.profanity?.words || [];
  return words
    .map(word => `${word.word}:${word.count}`)
    .sort((a, b) => a.localeCompare(b));
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function comparePair(
  input: ShadowEvaluationInputRecord,
  openai: ShadowEvaluationProviderRecord | null,
  qwen: ShadowEvaluationProviderRecord | null
): ShadowEvaluationComparison {
  const complete = openai?.status === 'ok' && qwen?.status === 'ok' &&
    Boolean(openai.parsedOutput) && Boolean(qwen.parsedOutput);
  const openaiResult = complete ? openai?.parsedOutput : undefined;
  const qwenResult = complete ? qwen?.parsedOutput : undefined;

  return {
    evaluationId: input.evaluationId,
    createdAt: input.createdAt,
    input,
    openai,
    qwen,
    comparison: {
      complete,
      crimeDecisionMatch: complete
        ? openaiResult!.shouldAnalyze === qwenResult!.shouldAnalyze
        : null,
      crimeReasonMatch: complete
        ? openaiResult!.reason === qwenResult!.reason
        : null,
      profanityPresenceMatch: complete
        ? Boolean(openaiResult!.profanity?.hasProfanity) === Boolean(qwenResult!.profanity?.hasProfanity)
        : null,
      profanityWordsMatch: complete
        ? arraysEqual(sortedProfanityWords(openaiResult), sortedProfanityWords(qwenResult))
        : null,
    },
  };
}

function averageLatency(records: Array<ShadowEvaluationProviderRecord | null>): number | null {
  const values = records
    .filter((record): record is ShadowEvaluationProviderRecord => record?.status === 'ok')
    .map(record => record.latencyMs)
    .filter(value => Number.isFinite(value));
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function summarize(comparisons: ShadowEvaluationComparison[]): ShadowEvaluationSummary {
  const complete = comparisons.filter(item => item.comparison.complete);
  const countMatches = (field: keyof ShadowEvaluationComparison['comparison']) =>
    complete.filter(item => item.comparison[field] === true).length;

  return {
    totalInputs: comparisons.length,
    completePairs: complete.length,
    openaiErrors: comparisons.filter(item => item.openai?.status === 'error').length,
    qwenErrors: comparisons.filter(item => item.qwen?.status === 'error').length,
    crimeDecisionMatches: countMatches('crimeDecisionMatch'),
    crimeDecisionCompared: complete.length,
    crimeReasonMatches: countMatches('crimeReasonMatch'),
    crimeReasonCompared: complete.length,
    profanityPresenceMatches: countMatches('profanityPresenceMatch'),
    profanityPresenceCompared: complete.length,
    profanityWordsMatches: countMatches('profanityWordsMatch'),
    profanityWordsCompared: complete.length,
    openaiAverageLatencyMs: averageLatency(comparisons.map(item => item.openai)),
    qwenAverageLatencyMs: averageLatency(comparisons.map(item => item.qwen)),
  };
}

export async function listShadowEvaluationComparisons(
  env: Env,
  chatId: number,
  days = 3,
  limit = 100
): Promise<{ comparisons: ShadowEvaluationComparison[]; summary: ShadowEvaluationSummary }> {
  const requestedDays = Number.isFinite(days) ? days : 3;
  const requestedLimit = Number.isFinite(limit) ? limit : 100;
  const safeDays = Math.min(Math.max(Math.round(requestedDays), 1), MAX_COMPARISON_DAYS);
  const safeLimit = Math.min(Math.max(Math.round(requestedLimit), 1), 500);
  const now = Date.now();
  const inputKeys: string[] = [];

  for (let offset = 0; offset < safeDays; offset++) {
    const day = utcDay(now - offset * 24 * 60 * 60 * 1000);
    inputKeys.push(...await listInputKeysForDay(env, day, chatId));
  }

  const inputs = (await Promise.all(inputKeys.map(key => readJson<ShadowEvaluationInputRecord>(env, key))))
    .filter((record): record is ShadowEvaluationInputRecord => Boolean(record))
    .filter(record => record.chatId === chatId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, safeLimit);

  const comparisons = await Promise.all(inputs.map(async input => {
    const openaiKey = recordKey(input.createdAt, input.chatId, input.evaluationId, 'openai');
    const qwenKey = recordKey(input.createdAt, input.chatId, input.evaluationId, 'qwen');
    const [openai, qwen] = await Promise.all([
      readJson<ShadowEvaluationProviderRecord>(env, openaiKey),
      readJson<ShadowEvaluationProviderRecord>(env, qwenKey),
    ]);
    return comparePair(input, openai, qwen);
  }));

  return {
    comparisons,
    summary: summarize(comparisons),
  };
}

export const shadowEvaluationInternals = {
  recordKey,
  retentionSeconds,
  comparePair,
  summarize,
};
