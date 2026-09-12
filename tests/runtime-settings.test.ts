import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import {
  resetRuntimeSettingsCache,
  resolveRuntimeSettings,
  saveSummaryRuntimeSettings,
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
});
