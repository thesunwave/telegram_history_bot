import type { Env, ProviderType } from './env';

const SETTINGS_SCOPE = 'global';
const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_CLOUDFLARE_MODEL = '@cf/meta/llama-3.2-3b-instruct';
const DEFAULT_SUMMARY_SYSTEM =
  'Ты составляешь краткую и фактическую сводку переписки на русском языке. Упоминай реальные username участников и не выдумывай события.';
const DEFAULT_SUMMARY_PROMPT =
  'Составь компактную сводку главных тем и событий из сообщений чата. Покажи, кто что сказал или сделал.';

export type StorageMode = 'stats_only' | 'history' | 'unconfigured';

type ConfigurableSummaryProvider = Extract<ProviderType, 'cloudflare' | 'openai' | 'openrouter'>;

export interface SummaryRuntimeSettings {
  enabled: boolean;
  provider: ConfigurableSummaryProvider;
  model: string;
}

export interface RuntimeSettings {
  storageMode: StorageMode;
  summary: SummaryRuntimeSettings;
  profanityEnabled: boolean;
  criminalEnabled: boolean;
  activityTrackingEnabled: boolean;
}

interface PersistedRuntimeSettingsV1 {
  version: 1;
  summary?: Partial<SummaryRuntimeSettings>;
  storageMode?: 'stats_only' | 'history';
  profanityEnabled?: boolean;
  criminalEnabled?: boolean;
  activityTrackingEnabled?: boolean;
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
    // Existing installations keep their previous behaviour. Portable fresh
    // installs explicitly require a storage decision before webhook setup.
    storageMode: env.RAW_MESSAGE_STORAGE_MODE === 'stats_only' || env.RAW_MESSAGE_STORAGE_MODE === 'history'
      ? env.RAW_MESSAGE_STORAGE_MODE
      : (env.REQUIRE_EXPLICIT_STORAGE_CHOICE === true || env.REQUIRE_EXPLICIT_STORAGE_CHOICE === 'true')
        ? 'unconfigured' : 'history',
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

  const sanitized: PersistedRuntimeSettingsV1 = { version: 1 };
  if (candidate.storageMode === 'history' || candidate.storageMode === 'stats_only') {
    sanitized.storageMode = candidate.storageMode;
  }
  for (const key of ['profanityEnabled', 'criminalEnabled', 'activityTrackingEnabled'] as const) {
    if (typeof candidate[key] === 'boolean') sanitized[key] = candidate[key] as boolean;
  }
  if (candidate.summary && typeof candidate.summary === 'object') {
    const raw = candidate.summary as Record<string, unknown>;
    const summary: Partial<SummaryRuntimeSettings> = {};
    if (typeof raw.enabled === 'boolean') summary.enabled = raw.enabled;
    if (typeof raw.provider === 'string') summary.provider = normalizeProvider(raw.provider);
    if (typeof raw.model === 'string' && raw.model.trim()) summary.model = raw.model.trim();
    sanitized.summary = summary;
  }
  return sanitized;
}

async function readPersistedSettings(env: Env, fresh = false): Promise<PersistedRuntimeSettingsV1 | null> {
  const now = Date.now();
  if (!fresh && persistedCache && persistedCache.expiresAt > now) {
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
    // Incoming webhooks must never fall back to history when an explicitly
    // selected Stats Only policy cannot be read. Retry Telegram delivery later.
    if (fresh) throw new Error('Bot runtime settings temporarily unavailable');
    // Non-ingestion paths preserve compatibility during initial migrations.
    persistedCache = { expiresAt: now + SETTINGS_CACHE_TTL_MS, value: null };
    return null;
  }
}

export function resetRuntimeSettingsCache(): void {
  persistedCache = null;
}

export async function resolveRuntimeSettings(env: Env, fresh = false): Promise<RuntimeSettings> {
  const base = baseSettingsFromEnv(env);
  const persisted = await readPersistedSettings(env, fresh);
  if (!persisted) return base;
  const provider = persisted.summary?.provider ?? base.summary.provider;
  const storageMode = persisted.storageMode ?? base.storageMode;
  // Invalid legacy combinations must never process text outside the chosen mode.
  const history = storageMode === 'history';
  return {
    storageMode,
    activityTrackingEnabled: persisted.activityTrackingEnabled ?? base.activityTrackingEnabled,
    profanityEnabled: persisted.profanityEnabled ?? base.profanityEnabled,
    criminalEnabled: history && (persisted.criminalEnabled ?? base.criminalEnabled),
    summary: {
      enabled: history && (persisted.summary?.enabled ?? base.summary.enabled),
      provider,
      model: persisted.summary?.model || modelForProvider(env, provider),
    },
  };
}

export async function withRuntimeSettings(env: Env, fresh = false): Promise<Env> {
  const settings = await resolveRuntimeSettings(env, fresh);
  const runtimeEnv: Env = {
    ...env,
    RAW_MESSAGE_STORAGE_MODE: settings.storageMode,
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
  if (enabled && current.storageMode !== 'history') {
    throw new Error('AI summaries require message history');
  }
  const model = (input.model?.trim() ||
    (provider === current.summary.provider ? current.summary.model : modelForProvider(env, provider))).trim();
  if (model.length > 150) throw new Error('Invalid model name');

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
  const payload: PersistedRuntimeSettingsV1 = {
    ...(await readPersistedSettings(env) ?? { version: 1 }), summary,
  };
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

/** Save a complete instance-level policy in one D1 update. */
export async function saveRuntimeSettings(
  env: Env,
  input: Pick<RuntimeSettings, 'storageMode' | 'activityTrackingEnabled' | 'profanityEnabled' | 'criminalEnabled' | 'summary'>,
): Promise<RuntimeSettings> {
  if (!env.DB?.prepare) throw new Error('D1 database is not available');
  if (input.storageMode !== 'history' && input.storageMode !== 'stats_only') {
    throw new Error('Choose a message storage mode');
  }
  for (const key of ['activityTrackingEnabled', 'profanityEnabled', 'criminalEnabled'] as const) {
    if (typeof input[key] !== 'boolean') throw new Error(`Invalid ${key} setting`);
  }
  if (!input.summary || typeof input.summary.enabled !== 'boolean' ||
      !['cloudflare', 'openai', 'openrouter'].includes(input.summary.provider) ||
      typeof input.summary.model !== 'string') throw new Error('Invalid summary settings');
  if (input.storageMode !== 'history' && (input.summary.enabled || input.criminalEnabled)) {
    throw new Error('AI summaries and contextual criminal analysis require message history');
  }
  const provider = normalizeProvider(input.summary.provider);
  const model = (input.summary.model.trim() || modelForProvider(env, provider));
  if (model.length > 150) throw new Error('Invalid model name');
  if (input.summary.enabled && provider === 'openai' && !env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY secret is required before enabling OpenAI summaries');
  }
  if (input.summary.enabled && provider === 'openrouter' && !env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY secret is required before enabling OpenRouter summaries');
  }
  if (input.summary.enabled && provider === 'cloudflare' && !env.AI) {
    throw new Error('Workers AI binding is required before enabling Cloudflare summaries');
  }
  // A feature can use its own provider; otherwise it inherits SUMMARY_PROVIDER.
  // Validate even if summaries are disabled, to avoid silently broken toggles.
  for (const [enabled, capability, configuredProvider] of [
    [input.profanityEnabled, 'profanity', env.PROFANITY_PROVIDER],
    [input.criminalEnabled, 'criminal', env.CRIMINAL_PROVIDER],
  ] as const) {
    if (!enabled) continue;
    const featureProvider = String(configuredProvider || provider).toLowerCase();
    if ((featureProvider === 'openai' || featureProvider === 'openai-premium') && !env.OPENAI_API_KEY) {
      throw new Error(`OPENAI_API_KEY is required to enable ${capability} analysis`);
    }
    if (featureProvider === 'openrouter' && !env.OPENROUTER_API_KEY) {
      throw new Error(`OPENROUTER_API_KEY is required to enable ${capability} analysis`);
    }
    if (featureProvider === 'legal-rag' && !env.LEGAL_RAG_INDEX?.query) {
      throw new Error(`LEGAL_RAG_INDEX Vectorize binding is required to enable ${capability} analysis`);
    }
    if ((featureProvider === 'cloudflare' || featureProvider === 'legal-rag') && !env.AI) {
      throw new Error(`Workers AI binding is required to enable ${capability} analysis`);
    }
  }
  const payload: PersistedRuntimeSettingsV1 = {
    version: 1,
    storageMode: input.storageMode,
    activityTrackingEnabled: input.activityTrackingEnabled,
    profanityEnabled: input.profanityEnabled,
    criminalEnabled: input.criminalEnabled,
    summary: { enabled: input.summary.enabled, provider, model },
  };
  await env.DB.prepare(
    `INSERT INTO app_settings(scope, settings_json, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(scope) DO UPDATE SET settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP`,
  ).bind(SETTINGS_SCOPE, JSON.stringify(payload)).run();
  resetRuntimeSettingsCache();
  return resolveRuntimeSettings(env);
}
