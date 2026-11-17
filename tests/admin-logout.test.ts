import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { handleAdminRequest } from '../src/api/admin';
import { createMockEnv } from './test-utils';
import { createKVBindings, spyableKVBinding } from './helpers/miniflare-kv';

describe('admin logout', () => {
  let bindings: Awaited<ReturnType<typeof createKVBindings>>;

  beforeEach(async () => {
    bindings = await createKVBindings();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await bindings.mf.dispose();
  });

  function createEnv() {
    return createMockEnv({
      HISTORY: spyableKVBinding(bindings.history as any),
      COUNTERS: bindings.counters as any,
    });
  }

  it('clears the browser session and returns to the login page', async () => {
    const env = createEnv();
    const cookie = await createTelegramSessionCookie(env, {
      id: 42,
      first_name: 'Admin',
      username: 'admin_user',
      auth_date: Math.floor(Date.now() / 1000),
    });
    const cookiePair = cookie.split(';', 1)[0];
    const sessionUrl = 'https://example.com/admin/session';

    const before = await handleAdminRequest(new Request(sessionUrl, {
      headers: { Cookie: cookiePair },
    }), env);
    expect(await before.json()).toEqual({ authenticated: true });

    const response = await handleAdminRequest(new Request('https://example.com/admin/logout', {
      method: 'POST',
      headers: { Cookie: cookiePair, Origin: 'https://example.com' },
    }), env);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toMatch(
      /^tg_admin_session=; Path=\/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/,
    );

    // Replaying the original signed cookie must not restore the logged-out session.
    const after = await handleAdminRequest(new Request(sessionUrl, {
      headers: { Cookie: cookiePair },
    }), env);
    expect(await after.json()).toEqual({ authenticated: false });

    const protectedResponse = await handleAdminRequest(new Request('https://example.com/admin/api/chats', {
      headers: { Cookie: cookiePair },
    }), env);
    expect(protectedResponse.status).toBe(401);
  });

  it('does not allow GET to log out a session', async () => {
    const env = createEnv();
    const cookie = await createTelegramSessionCookie(env, {
      id: 42,
      auth_date: Math.floor(Date.now() / 1000),
    });
    const cookiePair = cookie.split(';', 1)[0];
    const response = await handleAdminRequest(new Request('https://example.com/admin/logout', {
      headers: { Cookie: cookiePair },
    }), env);

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(response.headers.has('Set-Cookie')).toBe(false);
    const session = await handleAdminRequest(new Request('https://example.com/admin/session', {
      headers: { Cookie: cookiePair },
    }), env);
    expect(await session.json()).toEqual({ authenticated: true });
  });

  it.each([
    { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://example.com', 'Sec-Fetch-Site': 'cross-site' },
    { Origin: 'https://sub.example.com', 'Sec-Fetch-Site': 'same-site' },
    {},
  ])('does not clear the cookie for untrusted POST headers %o', async headers => {
    const env = createEnv();
    const cookie = await createTelegramSessionCookie(env, {
      id: 42,
      auth_date: Math.floor(Date.now() / 1000),
    });
    const cookiePair = cookie.split(';', 1)[0];
    const response = await handleAdminRequest(new Request('https://example.com/admin/logout', {
      method: 'POST',
      headers: { Cookie: cookiePair, ...headers } as Record<string, string>,
    }), env);

    expect(response.status).toBe(403);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const session = await handleAdminRequest(new Request('https://example.com/admin/session', {
      headers: { Cookie: cookiePair },
    }), env);
    expect(await session.json()).toEqual({ authenticated: true });
  });

  it('rejects a cross-origin form POST even when the browser sends no session cookie', async () => {
    const response = await handleAdminRequest(new Request('https://example.com/admin/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
    }), createEnv());

    expect(response.status).toBe(403);
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  it('accepts same-origin Sec-Fetch-Site when Origin is absent', async () => {
    const env = createEnv();
    const cookie = await createTelegramSessionCookie(env, {
      id: 42,
      auth_date: Math.floor(Date.now() / 1000),
    });
    const response = await handleAdminRequest(new Request('https://example.com/admin/logout', {
      method: 'POST',
      headers: { Cookie: cookie.split(';', 1)[0], 'Sec-Fetch-Site': 'same-origin' },
    }), env);

    expect(response.status).toBe(302);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('keeps a separate session alive when another one is logged out', async () => {
    const env = createEnv();
    const user = { id: 42, auth_date: Math.floor(Date.now() / 1000) };
    const first = (await createTelegramSessionCookie(env, user)).split(';', 1)[0];
    const second = (await createTelegramSessionCookie(env, user)).split(';', 1)[0];
    expect(second).not.toBe(first);

    await handleAdminRequest(new Request('https://example.com/admin/logout', {
      method: 'POST',
      headers: { Cookie: first, Origin: 'https://example.com' },
    }), env);
    const firstSession = await handleAdminRequest(new Request('https://example.com/admin/session', {
      headers: { Cookie: first },
    }), env);
    const secondSession = await handleAdminRequest(new Request('https://example.com/admin/session', {
      headers: { Cookie: second },
    }), env);
    expect(await firstSession.json()).toEqual({ authenticated: false });
    expect(await secondSession.json()).toEqual({ authenticated: true });
  });

  it('revokes every valid same-name cookie included in the logout request', async () => {
    const env = createEnv();
    const user = { id: 42, auth_date: Math.floor(Date.now() / 1000) };
    const first = (await createTelegramSessionCookie(env, user)).split(';', 1)[0];
    const second = (await createTelegramSessionCookie(env, user)).split(';', 1)[0];
    const response = await handleAdminRequest(new Request('https://example.com/admin/logout', {
      method: 'POST',
      headers: { Cookie: `${first}; ${second}`, Origin: 'https://example.com' },
    }), env);

    expect(response.status).toBe(302);
    for (const cookie of [first, second]) {
      const status = await handleAdminRequest(new Request('https://example.com/admin/session', {
        headers: { Cookie: cookie },
      }), env);
      expect(await status.json()).toEqual({ authenticated: false });
    }
  });

  it('does not finish logout if revocation cannot be persisted', async () => {
    const env = createEnv();
    const cookie = (await createTelegramSessionCookie(env, {
      id: 42,
      auth_date: Math.floor(Date.now() / 1000),
    })).split(';', 1)[0];
    vi.spyOn(env.HISTORY, 'put').mockRejectedValueOnce(new Error('KV unavailable'));
    await expect(handleAdminRequest(new Request('https://example.com/admin/logout', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://example.com' },
    }), env)).rejects.toThrow('KV unavailable');
  });

  it('does not authenticate if revocation status cannot be checked', async () => {
    const env = createEnv();
    const cookie = (await createTelegramSessionCookie(env, {
      id: 42,
      auth_date: Math.floor(Date.now() / 1000),
    })).split(';', 1)[0];
    vi.spyOn(env.HISTORY, 'get').mockRejectedValueOnce(new Error('KV unavailable'));
    await expect(handleAdminRequest(new Request('https://example.com/admin/session', {
      headers: { Cookie: cookie },
    }), env)).rejects.toThrow('KV unavailable');
  });
});
