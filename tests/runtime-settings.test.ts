import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import {
  resetRuntimeSettingsCache,
  resolveRuntimeSettings,
  runsSeparateProfanityAnalysis,
  saveSummaryRuntimeSettings,
  saveRuntimeSettings,
  withRuntimeSettings,
} from '../src/core/runtime-settings';

function makeSettingsDb(initialJson: string | null = null) {
  let settingsJson = initialJson;
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () =>
          sql.includes('SELECT settings_json') && settingsJson
            ? { settings_json: settingsJson }
            : null,
        ),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO app_settings')) {
            settingsJson = String(args[1]);
          }
          return { success: true };
        }),
      })),
    })),
    read: () => settingsJson,
  };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    TOKEN: 'token',
    HISTORY: {} as any,
    COUNTERS: {} as any,
    COUNTERS_DO: {} as any,
    MESSAGE_FETCHER_DO: {} as any,
    MESSAGE_AGGREGATOR_DO: {} as any,
    DAY_BLOCK_MANAGER_DO: {} as any,
    CRIMINAL_CODE_ANALYZER_DO: {} as any,
    DB: undefined as any,
    AI: { run: vi.fn() },
    SUMMARY_MODEL: '',
    SUMMARY_PROMPT: '',
    ...overrides,
  } as Env;
}

describe('runtime settings', () => {
  beforeEach(() => resetRuntimeSettingsCache());

  it('defaults a fresh install to Basic mode without AI analysis', async () => {
    const settings = await resolveRuntimeSettings(makeEnv());

    expect(settings).toMatchObject({
      summary: { enabled: false, provider: 'cloudflare' },
      profanityEnabled: false,
      criminalEnabled: false,
      activityTrackingEnabled: true,
    });
    expect(settings.summary.model).toContain('@cf/');
  });

  it('preserves explicit production environment configuration', async () => {
    const settings = await resolveRuntimeSettings(makeEnv({
      ENABLE_SUMMARY: true,
      SUMMARY_PROVIDER: 'openai',
      OPENAI_MODEL: 'gpt-5-nano',
      ENABLE_CRIMINAL_ANALYSIS: true,
    }));

    expect(settings.summary).toEqual({ enabled: true, provider: 'openai', model: 'gpt-5-nano' });
    expect(settings.criminalEnabled).toBe(true);
  });

  it('treats profanity counted by the criminal prefilter as enabled without a separate AI analysis', async () => {
    const production = makeEnv({
      ENABLE_PROFANITY_ANALYSIS: false,
      ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER: true,
      ENABLE_CRIMINAL_ANALYSIS: true,
    });
    const runtimeEnv = await withRuntimeSettings(production);
    expect(runtimeEnv.ENABLE_PROFANITY_ANALYSIS).toBe(true);
    expect(runsSeparateProfanityAnalysis(runtimeEnv)).toBe(false);

    const withoutCriminal = await withRuntimeSettings(makeEnv({
      ENABLE_PROFANITY_ANALYSIS: true, ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER: true,
    }));
    expect(runsSeparateProfanityAnalysis(withoutCriminal)).toBe(true);
  });

  it('keeps the deployment profanity switch for old settings rows without the toggle', async () => {
    const db = makeSettingsDb(JSON.stringify({ version: 1, summary: { enabled: false } }));
    const settings = await resolveRuntimeSettings(makeEnv({
      DB: db as any, ENABLE_PROFANITY_ANALYSIS: false,
      ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER: true, ENABLE_CRIMINAL_ANALYSIS: true,
    }));
    expect(settings.profanityEnabled).toBe(false);
  });

  it('lets persisted wizard settings override deploy-time summary settings', async () => {
    const db = makeSettingsDb(JSON.stringify({
      version: 1,
      summary: { enabled: true, provider: 'cloudflare', model: '@cf/test/model' },
    }));
    const env = makeEnv({
      DB: db as any,
      ENABLE_SUMMARY: false,
      SUMMARY_PROVIDER: 'openai',
      OPENAI_MODEL: 'gpt-old',
    });

    const runtimeEnv = await withRuntimeSettings(env);

    expect(runtimeEnv.ENABLE_SUMMARY).toBe(true);
    expect(runtimeEnv.SUMMARY_PROVIDER).toBe('cloudflare');
    expect(runtimeEnv.CLOUDFLARE_MODEL).toBe('@cf/test/model');
    expect(runtimeEnv.ENABLE_PROFANITY_ANALYSIS).toBe(false);
    expect(runtimeEnv.ENABLE_CRIMINAL_ANALYSIS).toBe(false);
    expect(runtimeEnv.SUMMARY_SYSTEM).toBeTruthy();
    expect(runtimeEnv.SUMMARY_PROMPT).toBeTruthy();
  });

  it('persists Cloudflare summary settings without requiring another secret', async () => {
    const db = makeSettingsDb();
    const env = makeEnv({ DB: db as any });

    const saved = await saveSummaryRuntimeSettings(env, {
      enabled: true,
      provider: 'cloudflare',
      model: '@cf/test/model',
    });

    expect(saved).toEqual({ enabled: true, provider: 'cloudflare', model: '@cf/test/model' });
    expect(JSON.parse(db.read() || '{}')).toEqual({ version: 1, summary: saved });
  });

  it('refuses to enable OpenAI until the Cloudflare secret exists', async () => {
    const db = makeSettingsDb();
    const env = makeEnv({ DB: db as any, OPENAI_API_KEY: undefined });

    await expect(saveSummaryRuntimeSettings(env, {
      enabled: true,
      provider: 'openai',
      model: 'gpt-5-nano',
    })).rejects.toThrow('OPENAI_API_KEY');
  });

  it('requires an explicit choice on portable fresh installs', async () => {
    const settings = await resolveRuntimeSettings(makeEnv({ REQUIRE_EXPLICIT_STORAGE_CHOICE: true }));
    expect(settings.storageMode).toBe('unconfigured');
    expect((await resolveRuntimeSettings(makeEnv({ REQUIRE_EXPLICIT_STORAGE_CHOICE: 'true' }))).storageMode)
      .toBe('unconfigured');
  });

  it('persists the explicit mode and feature toggles and passes them to processing', async () => {
    const db = makeSettingsDb();
    const env = makeEnv({ DB: db as any, REQUIRE_EXPLICIT_STORAGE_CHOICE: true });
    const saved = await saveRuntimeSettings(env, {
      storageMode: 'stats_only', activityTrackingEnabled: true,
      profanityEnabled: true, criminalEnabled: false,
      summary: { enabled: false, provider: 'cloudflare', model: '@cf/test/model' },
    });
    expect(saved.storageMode).toBe('stats_only');
    expect(saved.profanityEnabled).toBe(true);
    expect((await withRuntimeSettings(env)).RAW_MESSAGE_STORAGE_MODE).toBe('stats_only');
    expect((await withRuntimeSettings(env)).ENABLE_PROFANITY_ANALYSIS).toBe(true);
    expect(JSON.parse(db.read() || '{}')).toMatchObject({
      storageMode: 'stats_only', profanityEnabled: true, activityTrackingEnabled: true,
    });
    // Old summary-only updates must keep the selected mode and other features.
    await saveSummaryRuntimeSettings(env, { enabled: false, model: '@cf/other/model' });
    expect(JSON.parse(db.read() || '{}')).toMatchObject({
      storageMode: 'stats_only', profanityEnabled: true, summary: { enabled: false },
    });
    await expect(saveSummaryRuntimeSettings(env, { enabled: true })).rejects.toThrow('require message history');
  });

  it('refuses configurations that require raw history when none is saved', async () => {
    const db = makeSettingsDb();
    const env = makeEnv({ DB: db as any });
    await expect(saveRuntimeSettings(env, {
      storageMode: 'stats_only', activityTrackingEnabled: true,
      profanityEnabled: false, criminalEnabled: true,
      summary: { enabled: false, provider: 'cloudflare', model: '@cf/model' },
    })).rejects.toThrow('require message history');
    await expect(saveRuntimeSettings(env, {
      storageMode: 'stats_only', activityTrackingEnabled: true,
      profanityEnabled: false, criminalEnabled: false,
      summary: { enabled: true, provider: 'cloudflare', model: '@cf/model' },
    })).rejects.toThrow('require message history');
    expect(db.read()).toBeNull();
  });

  it('applies persisted toggles over enabled production environment flags', async () => {
    const db = makeSettingsDb(JSON.stringify({ version: 1, storageMode: 'stats_only',
      activityTrackingEnabled: false, criminalEnabled: true, profanityEnabled: false,
      summary: { enabled: true, provider: 'cloudflare' } }));
    const env = makeEnv({ DB: db as any, ENABLE_SUMMARY: true, ENABLE_CRIMINAL_ANALYSIS: true,
      ENABLE_ACTIVITY_TRACKING: true, ENABLE_PROFANITY_ANALYSIS: true });
    const runtimeEnv = await withRuntimeSettings(env);
    expect(runtimeEnv.ENABLE_SUMMARY).toBe(false);
    expect(runtimeEnv.ENABLE_CRIMINAL_ANALYSIS).toBe(false);
    expect(runtimeEnv.ENABLE_ACTIVITY_TRACKING).toBe(false);
    expect(runtimeEnv.ENABLE_PROFANITY_ANALYSIS).toBe(false);
  });

  it('requires the Vectorize binding before enabling legal-rag criminal analysis', async () => {
    const db = makeSettingsDb();
    const env = makeEnv({ DB: db as any, CRIMINAL_PROVIDER: 'legal-rag' });
    await expect(saveRuntimeSettings(env, {
      storageMode: 'history', activityTrackingEnabled: true,
      profanityEnabled: false, criminalEnabled: true,
      summary: { enabled: false, provider: 'cloudflare', model: '@cf/model' },
    })).rejects.toThrow('LEGAL_RAG_INDEX');
    expect(db.read()).toBeNull();
  });

  it('reads privacy policy fresh for ingestion even when a cached policy is stale', async () => {
    const db = makeSettingsDb(JSON.stringify({ version: 1, storageMode: 'history' }));
    const env = makeEnv({ DB: db as any });
    expect((await withRuntimeSettings(env)).RAW_MESSAGE_STORAGE_MODE).toBe('history');
    await db.prepare('INSERT INTO app_settings').bind('global', JSON.stringify({
      version: 1, storageMode: 'stats_only', activityTrackingEnabled: true,
      criminalEnabled: false,
    })).run();
    expect((await withRuntimeSettings(env)).RAW_MESSAGE_STORAGE_MODE).toBe('history');
    expect((await withRuntimeSettings(env, true)).RAW_MESSAGE_STORAGE_MODE).toBe('stats_only');
  });

  it('does not fall back to history when D1 policy lookup fails during ingestion', async () => {
    const env = makeEnv({ DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ first: vi.fn().mockRejectedValue(new Error('D1 unavailable')) })),
      })),
    } as any });
    await expect(withRuntimeSettings(env, true)).rejects.toThrow('settings temporarily unavailable');
  });

  it('validates AI provider settings regardless of the case used in Wrangler', async () => {
    const db = makeSettingsDb();
    const env = makeEnv({ DB: db as any, PROFANITY_PROVIDER: 'OPENAI' as ProviderType, OPENAI_API_KEY: undefined });
    await expect(saveRuntimeSettings(env, {
      storageMode: 'stats_only', activityTrackingEnabled: true,
      profanityEnabled: true, criminalEnabled: false,
      summary: { enabled: false, provider: 'cloudflare', model: '@cf/model' },
    })).rejects.toThrow('OPENAI_API_KEY');
    expect(db.read()).toBeNull();
  });
});
