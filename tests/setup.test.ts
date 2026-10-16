import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import { handleSetupRequest } from '../src/api/setup';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { getWebhookSecret } from '../src/core/webhook-secret';
import { resetRuntimeSettingsCache } from '../src/core/runtime-settings';

const origin = 'https://bot.example';
const env = {
  TOKEN: '123456:botfather-secret-token',
  SECRET: undefined,
  AI: { run: vi.fn() },
  HISTORY: {},
  COUNTERS: {},
} as unknown as Env;

function request(path: string, method = 'GET', body?: unknown, cookie?: string, requestOrigin = origin) {
  return new Request(origin + path, {
    method,
    headers: {
      Origin: requestOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ownerCookie(): Promise<string> {
  const login = await handleSetupRequest(request('/admin/api/setup/login', 'POST', {
    token: env.TOKEN,
  }), env);
  expect(login.status).toBe(200);
  const setCookie = login.headers.get('Set-Cookie') || '';
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('Secure');
  expect(setCookie).toContain('SameSite=Strict');
  expect(setCookie).not.toContain(env.TOKEN);
  return setCookie.split(';')[0];
}

describe('owner setup', () => {
  beforeEach(() => resetRuntimeSettingsCache());
  afterEach(() => vi.unstubAllGlobals());

  it('exposes only the login page until the owner authenticates', async () => {
    const page = await handleSetupRequest(request('/admin/setup'), env);
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain(env.TOKEN);
    const status = await handleSetupRequest(request('/admin/api/setup/status'), env);
    expect(status.status).toBe(401);
    const update = await handleSetupRequest(request('/admin/api/setup/summary', 'PATCH', {
      enabled: true, provider: 'cloudflare', model: 'test',
    }), env);
    expect(update.status).toBe(401);
  });

  it('pairs one verified Telegram account with the bot only after BotFather proof', async () => {
    const rows = new Map<string, string>();
    const database = { prepare: vi.fn((sql: string) => ({
      bind: vi.fn((scope: string, json?: string) => ({
        first: vi.fn(async () => rows.has(scope) ? { settings_json: rows.get(scope) } : null),
        run: vi.fn(async () => {
          if (sql.startsWith('INSERT INTO app_settings') && !rows.has(scope)) {
            rows.set(scope, json!);
          }
          return { success: true };
        }),
      })),
      first: vi.fn(async () => null),
    })) };
    const linkedEnv = { ...env, DB: database, HISTORY: { get: vi.fn(async () => null) } } as unknown as Env;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, result: {} })));
    const cookie = (id: number) => createTelegramSessionCookie(linkedEnv, {
      id, auth_date: Math.floor(Date.now() / 1000),
    }).then(value => value.split(';')[0]);
    const ownerCookie = await cookie(42);
    const impostorCookie = await cookie(43);

    const identity = await handleSetupRequest(request('/admin/api/setup/identity', 'GET',
      undefined, ownerCookie), linkedEnv);
    expect(await identity.json()).toEqual({ telegramAuthenticated: true, canClaimOwner: true });
    expect((await handleSetupRequest(request('/admin/api/setup/status', 'GET',
      undefined, ownerCookie), linkedEnv)).status).toBe(401);
    expect((await handleSetupRequest(request('/admin/api/setup/claim-owner', 'POST',
      { token: env.TOKEN }, undefined), linkedEnv)).status).toBe(401);
    expect((await handleSetupRequest(request('/admin/api/setup/claim-owner', 'POST',
      { token: 'wrong' }, ownerCookie), linkedEnv)).status).toBe(403);
    expect(rows.size).toBe(0);
    expect((await handleSetupRequest(request('/admin/api/setup/claim-owner', 'POST',
      { token: env.TOKEN }, ownerCookie, 'https://evil.example'), linkedEnv)).status).toBe(403);
    expect(rows.size).toBe(0);

    const claim = await handleSetupRequest(request('/admin/api/setup/claim-owner', 'POST',
      { token: env.TOKEN }, ownerCookie), linkedEnv);
    expect(claim.status).toBe(200);
    expect(rows.has('telegram_owner')).toBe(true);
    expect((await handleSetupRequest(request('/admin/api/setup/status', 'GET',
      undefined, ownerCookie), linkedEnv)).status).toBe(200);
    expect((await handleSetupRequest(request('/admin/api/setup/status', 'GET',
      undefined, impostorCookie), linkedEnv)).status).toBe(401);
    expect((await handleSetupRequest(request('/admin/api/setup/claim-owner', 'POST',
      { token: env.TOKEN }, impostorCookie), linkedEnv)).status).toBe(409);
    const bound = JSON.parse(rows.get('telegram_owner')!);
    expect(bound.telegramId).toBe('42');
    expect(await (await handleSetupRequest(request('/admin/api/setup/identity', 'GET',
      undefined, impostorCookie), linkedEnv)).json()).toEqual({
      telegramAuthenticated: true, canClaimOwner: false,
    });
  });

  it('never exposes Telegram ownership to Basic Auth or unconfigured group admins', async () => {
    const basicEnv = { ...env, ADMIN_BASIC_USER: 'admin', ADMIN_BASIC_PASSWORD: 'password' };
    const authorization = 'Basic ' + btoa('admin:password');
    const status = await handleSetupRequest(new Request(origin + '/admin/api/setup/status', {
      headers: { Authorization: authorization },
    }), basicEnv);
    expect(status.status).toBe(401);
    const page = await handleSetupRequest(request('/admin/setup'), basicEnv);
    expect(await page.text()).not.toContain('/admin/setup?auth=basic');
  });

  it('reuses the designated Telegram owner session, never a group admin session', async () => {
    const ownerEnv = { ...env, ADMIN_USER_ID: '42', HISTORY: {
      get: vi.fn(async () => null),
    } } as unknown as Env;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, result: {} })));
    const cookie = (await createTelegramSessionCookie(ownerEnv, {
      id: 42, auth_date: Math.floor(Date.now() / 1000),
    })).split(';')[0];
    const ownerStatus = await handleSetupRequest(request('/admin/api/setup/status', 'GET',
      undefined, cookie), ownerEnv);
    expect(ownerStatus.status).toBe(200);
    expect((await ownerStatus.json() as { authMethod: string }).authMethod).toBe('telegram');
    const groupAdminCookie = (await createTelegramSessionCookie(ownerEnv, {
      id: 43, auth_date: Math.floor(Date.now() / 1000),
    })).split(';')[0];
    expect((await handleSetupRequest(request('/admin/api/setup/status', 'GET',
      undefined, groupAdminCookie), ownerEnv)).status).toBe(401);
    expect((await handleSetupRequest(request('/admin/api/setup/status', 'GET',
      undefined, cookie), { ...ownerEnv, ADMIN_USER_ID: undefined })).status).toBe(401);
  });

  it('never accepts the wrong token or a cross-origin login', async () => {
    expect((await handleSetupRequest(request('/admin/api/setup/login', 'POST', {
      token: 'incorrect',
    }), env)).status).toBe(403);
    expect((await handleSetupRequest(request('/admin/api/setup/login', 'POST', {
      token: env.TOKEN,
    }, undefined, 'https://evil.example'), env)).status).toBe(403);
  });

  it('generates a separate webhook secret while preserving the legacy one', async () => {
    const derived = await getWebhookSecret(env);
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
    expect(derived).not.toContain(env.TOKEN);
    expect(await getWebhookSecret({ TOKEN: env.TOKEN, SECRET: 'existing-secret' }))
      .toBe('existing-secret');
  });

  it('registers a tokenless URL using the Telegram secret header', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, body: JSON.parse(options.body as string) });
      return Response.json({ ok: true, result: true });
    }));
    const cookie = await ownerCookie();
    const response = await handleSetupRequest(
      request('/admin/api/setup/webhook', 'POST', undefined, cookie), env,
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/setWebhook');
    expect(calls[0].body.url).toBe(origin + '/telegram/webhook');
    expect(calls[0].body.secret_token).toBe(await getWebhookSecret(env));
  });

  it('rejects invalid provider configuration before writing to D1', async () => {
    const cookie = await ownerCookie();
    const response = await handleSetupRequest(request('/admin/api/setup/summary', 'PATCH', {
      enabled: true, provider: 'unknown-provider', model: 'model',
    }, cookie), env);
    expect(response.status).toBe(400);
  });

  it('reports an uninitialized D1 even when its binding exists', async () => {
    const cookie = await ownerCookie();
    const database = { prepare: vi.fn(() => ({
      first: vi.fn().mockRejectedValue(new Error('no such table: app_settings')),
    })) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: {} })));
    const response = await handleSetupRequest(
      request('/admin/api/setup/status', 'GET', undefined, cookie),
      { ...env, DB: database } as unknown as Env,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { databaseReady: boolean; bindings: { database: boolean } };
    expect(body.bindings.database).toBe(true);
    expect(body.databaseReady).toBe(false);
  });

  it('confirms database readiness when the settings table is queryable', async () => {
    const cookie = await ownerCookie();
    const database = { prepare: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(null),
    })) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, result: {} })));
    const response = await handleSetupRequest(
      request('/admin/api/setup/status', 'GET', undefined, cookie),
      { ...env, DB: database } as unknown as Env,
    );
    expect(response.status).toBe(200);
    expect((await response.json() as { databaseReady: boolean }).databaseReady).toBe(true);
  });

  it('requires an explicit storage decision for a fresh public install', async () => {
    let value: string | null = null;
    const database = { prepare: vi.fn((sql: string) => ({
      first: vi.fn(async () => sql.includes('settings_json') && value ? { settings_json: value } : null),
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => sql.includes('settings_json') && value ? { settings_json: value } : null),
        run: vi.fn(async () => { value = String(args[1]); return { success: true }; }),
      })),
    })) };
    const portable = { ...env, DB: database, REQUIRE_EXPLICIT_STORAGE_CHOICE: true } as unknown as Env;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, result: {} })));
    const cookie = await ownerCookie();

    const status = await handleSetupRequest(request('/admin/api/setup/status', 'GET', undefined, cookie), portable);
    expect((await status.json() as any).storageMode).toBe('unconfigured');
    expect((await handleSetupRequest(request('/admin/api/setup/webhook', 'POST', undefined, cookie), portable)).status)
      .toBe(409);
    expect((await handleSetupRequest(request('/admin/api/setup/settings', 'PATCH', {
      storageMode: 'stats_only', activityTrackingEnabled: true,
      profanityEnabled: false, criminalEnabled: false,
      summary: { enabled: false, provider: 'cloudflare', model: '@cf/model' },
    }), portable)).status).toBe(401);

    const payload = { storageMode: 'stats_only', activityTrackingEnabled: true,
      profanityEnabled: false, criminalEnabled: false,
      summary: { enabled: false, provider: 'cloudflare', model: '@cf/model' } };
    expect((await handleSetupRequest(request('/admin/api/setup/settings', 'PATCH', payload,
      cookie, 'https://evil.example'), portable)).status).toBe(403);
    expect((await handleSetupRequest(request('/admin/api/setup/settings', 'PATCH', {
      ...payload, criminalEnabled: true,
    }, cookie), portable)).status).toBe(400);
    expect(value).toBeNull();
    expect((await handleSetupRequest(request('/admin/api/setup/settings', 'PATCH', payload, cookie), portable)).status)
      .toBe(200);
    const updated = await handleSetupRequest(request('/admin/api/setup/status', 'GET', undefined, cookie), portable);
    expect((await updated.json() as any).storageMode).toBe('stats_only');
    expect((await handleSetupRequest(request('/admin/api/setup/webhook', 'POST', undefined, cookie), portable)).status)
      .toBe(200);
    expect(value).toContain('stats_only');
  });
});
