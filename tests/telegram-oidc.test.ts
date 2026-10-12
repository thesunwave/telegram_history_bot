import { describe, expect, it } from 'vitest';
import { handleAdminRequest } from '../src/api/admin';
import { telegramLoginClientId, telegramLoginConfig, telegramLoginSession, verifyTelegramIdToken } from '../src/api/telegram-oidc';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { Env } from '../src/core/env';
import { authenticateTelegramSession } from '../src/api/admin-auth';
import { createHmac, createHash } from 'node:crypto';

describe('Telegram OIDC login and admin session', () => {

  it('serves the existing login screen and dashboard markup at /admin', async () => {
    const response = await handleAdminRequest(new Request('https://example.com/admin'), {
      TELEGRAM_BOT_USERNAME: 'history_bot',
    } as Env);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('id="telegramLogin"');
    expect(html).toContain('id="dashboard"');
    expect(html).toContain("script.dataset.authUrl = '/admin/login'");
    expect(html).not.toContain('id="screenshots"');
  });

  it('does not mark unauthenticated visitors as signed in', async () => {
    const response = await handleAdminRequest(new Request('https://example.com/admin/session'), {
      SECRET: 'session-secret',
    } as Env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('accepts a valid legacy Telegram redirect and exposes the admin session status', async () => {
    const env = { TOKEN: 'test-bot-token', SECRET: 'test-session-secret' } as Env;
    const params = new URLSearchParams({
      id: '123456789',
      auth_date: String(Math.floor(Date.now() / 1000)),
      first_name: 'Example',
      username: 'example_user',
    });
    const dataCheck = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const secret = createHash('sha256').update(env.TOKEN).digest();
    const hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
    params.set('hash', hash);
    const response = await handleAdminRequest(
      new Request('https://example.com/admin/login?' + params),
      env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin');
    const sessionCookie = response.headers.get('Set-Cookie')!.split(';')[0];
    const status = await handleAdminRequest(new Request('https://example.com/admin/session', {
      headers: { Cookie: sessionCookie },
    }), env);
    expect(await status.json()).toEqual({ authenticated: true });
    const unauthorized = await handleAdminRequest(new Request('https://example.com/admin/session', {
      headers: { Cookie: 'tg_admin_session=invalid' },
    }), env);
    expect(await unauthorized.json()).toEqual({ authenticated: false });
  });

  it('uses the configured BotFather Login Widget Client ID, never a bot token or placeholder', () => {
    expect(telegramLoginClientId({ TELEGRAM_LOGIN_CLIENT_ID: '7807841637' } as Env)).toBe('7807841637');
    expect(telegramLoginClientId({ TELEGRAM_LOGIN_CLIENT_ID: '1234567', TOKEN: '7654321:secret' } as Env)).toBe('1234567');
    expect(telegramLoginClientId({ TOKEN: '7654321:secret' } as Env)).toBeNull();
    expect(telegramLoginClientId({ TOKEN: 'bad' } as Env)).toBeNull();
  });

  it('issues a short-lived secure nonce bound to browser cookies', async () => {
    const response = telegramLoginConfig({ TELEGRAM_LOGIN_CLIENT_ID: '1234567' } as Env);
    const json = await response.json() as { clientId: number; nonce: string };
    expect(json.clientId).toBe(1234567);
    expect(json.nonce).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly; Secure; SameSite=Strict; Max-Age=300');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects cross-origin login submissions and requests without a nonce cookie', async () => {
    const env = { TELEGRAM_LOGIN_CLIENT_ID: '1234567' } as Env;
    const request = (origin: string, cookie?: string) => new Request('https://site.example/auth/telegram', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify({ id_token: 'invalid' }),
    });
    expect((await telegramLoginSession(request('https://evil.example', 'tg_login_nonce=abc'), env)).status).toBe(403);
    const missingNonce = await telegramLoginSession(request('https://site.example'), env);
    expect(missingNonce.status).toBe(403);
    expect(await missingNonce.json()).toMatchObject({ error: 'browser_nonce_missing' });
  });

  it('verifies Telegram JWT, accepts decimal-string Bot API ID, and rejects invalid identities', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
    const sign = (overrides: Record<string, unknown> = {}, audience = '1234567') =>
      new SignJWT({ id: 42, given_name: 'Test', preferred_username: 'demo', nonce: 'challenge', ...overrides })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://oauth.telegram.org')
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);

    expect(await verifyTelegramIdToken(await sign(), '1234567', 'challenge', keys)).toMatchObject({
      id: 42, username: 'demo', first_name: 'Test',
    });
    expect(await verifyTelegramIdToken(await sign({ id: '987654321' }), '1234567', 'challenge', keys)).toMatchObject({
      id: 987654321, username: 'demo',
    });
    await expect(verifyTelegramIdToken(await sign({}, 'different'), '1234567', 'challenge', keys)).rejects.toThrow();
    await expect(verifyTelegramIdToken(await sign(), '1234567', 'wrong-nonce', keys)).rejects.toThrow();
    await expect(verifyTelegramIdToken(await sign({ id: null }), '1234567', 'challenge', keys)).rejects.toThrow();
    await expect(verifyTelegramIdToken(await sign({ id: null, sub: '1234123412341234123' }), '1234567', 'challenge', keys)).rejects.toThrow();
    await expect(verifyTelegramIdToken(await sign({ id: '9007199254740993' }), '1234567', 'challenge', keys)).rejects.toThrow();
    await expect(verifyTelegramIdToken(await sign({ id: '9e3' }), '1234567', 'challenge', keys)).rejects.toThrow();
    await expect(verifyTelegramIdToken(await sign({ id: '-42' }), '1234567', 'challenge', keys)).rejects.toThrow();
  });

  it('converts a verified OIDC login into the existing admin session cookie', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'demo', alg: 'RS256' }] });
    const config = telegramLoginConfig({ TELEGRAM_LOGIN_CLIENT_ID: '1234567' } as Env);
    const { nonce } = await config.json() as { nonce: string };
    const token = await new SignJWT({
      id: '42', sub: '1234123412341234123', nonce, given_name: 'Demo', preferred_username: 'demo_user',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'demo' })
      .setIssuer('https://oauth.telegram.org')
      .setAudience('1234567')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    const env = { TELEGRAM_LOGIN_CLIENT_ID: '1234567', SECRET: 'test-secret' } as Env;
    const request = (cookie: string) => new Request('https://example.com/auth/telegram', {
      method: 'POST',
      headers: { Origin: 'https://example.com', Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: token }),
    });
    const cookie = config.headers.get('Set-Cookie')!.split(';')[0];
    const response = await telegramLoginSession(request(cookie), env, keys);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const session = response.headers.getSetCookie().find(value => value.startsWith('tg_admin_session='));
    expect(session).toContain('HttpOnly; Secure; SameSite=Lax');
    const principal = await authenticateTelegramSession(new Request('https://example.com/admin', {
      headers: { Cookie: session!.split(';')[0] },
    }), env);
    expect(principal).toMatchObject({ type: 'telegram', telegramId: 42, username: 'demo_user' });

    // Tokens from another browser's challenge cannot create an admin session.
    const rejected = await telegramLoginSession(request('tg_login_nonce=' + crypto.randomUUID()), env, keys);
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toMatchObject({
      error: 'telegram_auth_failed',
      reason: 'nonce_mismatch',
    });
  });
});
