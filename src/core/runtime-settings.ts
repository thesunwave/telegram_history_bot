import type { Env, ProviderType } from './env';

const SETTINGS_SCOPE = 'global';
const SETTINGS_CACHE_TTL_MS = 30_000;
const DEFAULT_CLOUDFLARE_MODEL = '@cf/meta/llama-3.2-3b-instruct';
const DEFAULT_SUMMARY_SYSTEM =
  'Ты составляешь краткую и фактическую сводку переписки на русском языке. Упоминай реальные username участников и не выдумывай события.';
const DEFAULT_SUMMARY_PROMPT =
  'Составь компактную сводку главных тем и событий из сообщений чата. Покажи, кто что сказал или сделал.';

type ConfigurableSummaryProvider = Extract<ProviderType, 'cloudflare' | 'openai' | 'openrouter'>;

export interface SummaryRuntimeSettings {
  enabled: boolean;
  provider: ConfigurableSummaryProvider;
  model: string;
}

export interface RuntimeSettings {
  summary: SummaryRuntimeSettings;
  profanityEnabled: boolean;
  criminalEnabled: boolean;
  activityTrackingEnabled: boolean;
}

interface PersistedRuntimeSettingsV1 {
  version: 1;
  summary?: Partial<SummaryRuntimeSettings>;
}

interface SettingsRow {
  settings_json?: string;
}

let persistedCache: { expiresAt: number; value: PersistedRuntimeSettingsV1 | null } | null = null;

function parseBoolean(value: string | boolean | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value !== false && value !== 'false';
}

function normalizeProvider(value: unknown): ConfigurableSummaryProvider {
  return value === 'openai' || value === 'openrouter' ? value : 'cloudflare';
}

function modelForProvider(env: Env, provider: ConfigurableSummaryProvider): string {
  switch (provider) {
    case 'openai':
      return env.OPENAI_MODEL || 'gpt-3.5-turbo';
    case 'openrouter':
      return env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
    default:
      return env.CLOUDFLARE_MODEL || env.SUMMARY_MODEL || DEFAULT_CLOUDFLARE_MODEL;
  }
}

function baseSettingsFromEnv(env: Env): RuntimeSettings {
  const provider = normalizeProvider(env.SUMMARY_PROVIDER);
  return {
    summary: {
      enabled: parseBoolean(env.ENABLE_SUMMARY, false),
      provider,
      model: modelForProvider(env, provider),
    },
    profanityEnabled: parseBoolean(env.ENABLE_PROFANITY_ANALYSIS, false),
    criminalEnabled: parseBoolean(env.ENABLE_CRIMINAL_ANALYSIS, false),
    activityTrackingEnabled: parseBoolean(env.ENABLE_ACTIVITY_TRACKING, true),
  };
}

function sanitizePersistedSettings(value: unknown): PersistedRuntimeSettingsV1 | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;

  const rawSummary = candidate.summary;
  if (!rawSummary || typeof rawSummary !== 'object') {
    return { version: 1 };
  }

  const summary = rawSummary as Record<string, unknown>;
  const sanitized: Partial<SummaryRuntimeSettings> = {};
  if (typeof summary.enabled === 'boolean') sanitized.enabled = summary.enabled;
  if (typeof summary.provider === 'string') sanitized.provider = normalizeProvider(summary.provider);
  if (typeof summary.model === 'string' && summary.model.trim()) sanitized.model = summary.model.trim();
  return { version: 1, summary: sanitized };
}

async function readPersistedSettings(env: Env): Promise<PersistedRuntimeSettingsV1 | null> {
  const now = Date.now();
  if (persistedCache && persistedCache.expiresAt > now) {
    return persistedCache.value;
  }

  if (!env.DB?.prepare) {
    persistedCache = { expiresAt: now + SETTINGS_CACHE_TTL_MS, value: null };
    return null;
  }

  try {
    const row = (await env.DB
      .prepare('SELECT settings_json FROM app_settings WHERE scope = ?')
      .bind(SETTINGS_SCOPE)
      .first()) as SettingsRow | null;
    const parsed = row?.settings_json ? JSON.parse(row.settings_json) : null;
    const value = sanitizePersistedSettings(parsed);
    persistedCache = { expiresAt: now + SETTINGS_CACHE_TTL_MS, value };
    return value;
  } catch {
    // During the first deploy the Worker can briefly start before postdeploy
    // migrations finish. Falling back to safe Basic defaults keeps it usable.
    persistedCache = { expiresAt: now + 5_000, value: null };
    return null;
  }
}

export function resetRuntimeSettingsCache(): void {
  persistedCache = null;
}

export async function resolveRuntimeSettings(env: Env): Promise<RuntimeSettings> {
  const base = baseSettingsFromEnv(env);
  const persisted = await readPersistedSettings(env);
  if (!persisted?.summary) return base;

  const provider = persisted.summary.provider ?? base.summary.provider;
  return {
    ...base,
    summary: {
      enabled: persisted.summary.enabled ?? base.summary.enabled,
      provider,
      model: persisted.summary.model || modelForProvider(env, provider),
    },
  };
}

export async function withRuntimeSettings(env: Env): Promise<Env> {
  const settings = await resolveRuntimeSettings(env);
  const runtimeEnv: Env = {
    ...env,
    ENABLE_ACTIVITY_TRACKING: settings.activityTrackingEnabled,
    ENABLE_SUMMARY: settings.summary.enabled,
    ENABLE_PROFANITY_ANALYSIS: settings.profanityEnabled,
    ENABLE_CRIMINAL_ANALYSIS: settings.criminalEnabled,
    ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER:
      env.ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER ?? false,
    SUMMARY_OPT_ENABLED: env.SUMMARY_OPT_ENABLED ?? false,
    SUMMARY_PROVIDER: settings.summary.provider,
    SUMMARY_SYSTEM: env.SUMMARY_SYSTEM || DEFAULT_SUMMARY_SYSTEM,
    SUMMARY_PROMPT: env.SUMMARY_PROMPT || DEFAULT_SUMMARY_PROMPT,
    SUMMARY_MAX_TOKENS: env.SUMMARY_MAX_TOKENS ?? 1000,
    SUMMARY_TEMPERATURE: env.SUMMARY_TEMPERATURE ?? 0.1,
    SUMMARY_TOP_P: env.SUMMARY_TOP_P ?? 0.9,
  };

  if (settings.summary.provider === 'cloudflare') runtimeEnv.CLOUDFLARE_MODEL = settings.summary.model;
  if (settings.summary.provider === 'openai') runtimeEnv.OPENAI_MODEL = settings.summary.model;
  if (settings.summary.provider === 'openrouter') runtimeEnv.OPENROUTER_MODEL = settings.summary.model;
  return runtimeEnv;
}

export async function saveSummaryRuntimeSettings(
  env: Env,
  input: Partial<SummaryRuntimeSettings>,
): Promise<SummaryRuntimeSettings> {
  if (!env.DB?.prepare) throw new Error('D1 database is not available');

  const current = await resolveRuntimeSettings(env);
  const provider = input.provider === undefined ? current.summary.provider : normalizeProvider(input.provider);
  const enabled = input.enabled ?? current.summary.enabled;
  const model = (input.model?.trim() || current.summary.model || modelForProvider(env, provider)).trim();

  if (enabled && provider === 'openai' && !env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY secret is required before enabling OpenAI summaries');
  }
  if (enabled && provider === 'openrouter' && !env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY secret is required before enabling OpenRouter summaries');
  }
  if (enabled && provider === 'cloudflare' && !env.AI) {
    throw new Error('Workers AI binding is required before enabling Cloudflare summaries');
  }

  const summary: SummaryRuntimeSettings = { enabled, provider, model };
  const payload: PersistedRuntimeSettingsV1 = { version: 1, summary };
  await env.DB
    .prepare(
      `INSERT INTO app_settings(scope, settings_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(scope) DO UPDATE SET settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(SETTINGS_SCOPE, JSON.stringify(payload))
    .run();
  resetRuntimeSettingsCache();
  return summary;
}
