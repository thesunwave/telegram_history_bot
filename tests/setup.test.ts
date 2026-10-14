import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import { handleSetupRequest } from '../src/api/setup';
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
});
