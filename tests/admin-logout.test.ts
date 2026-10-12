import { describe, expect, it } from 'vitest';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { handleAdminRequest } from '../src/api/admin';
import { createMockEnv } from './test-utils';

describe('admin logout', () => {
  it('clears the browser session and returns to the login page', async () => {
    const env = createMockEnv();
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
      headers: { Cookie: cookiePair },
    }), env);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toMatch(
      /^tg_admin_session=; Path=\/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0$/,
    );

    // The browser applies Set-Cookie before following the redirect.
    const clearedCookie = response.headers.get('Set-Cookie')!.split(';', 1)[0];
    const after = await handleAdminRequest(new Request(sessionUrl, {
      headers: { Cookie: clearedCookie },
    }), env);
    expect(await after.json()).toEqual({ authenticated: false });

    const protectedResponse = await handleAdminRequest(new Request('https://example.com/admin/api/chats', {
      headers: { Cookie: clearedCookie },
    }), env);
    expect(protectedResponse.status).toBe(401);
  });

  it('does not allow GET to log out a session', async () => {
    const response = await handleAdminRequest(new Request('https://example.com/admin/logout'), createMockEnv());

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });
});
