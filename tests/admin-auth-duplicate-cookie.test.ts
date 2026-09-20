import { describe, expect, it } from 'vitest';
import {
  authenticateTelegramSession,
  createTelegramSessionCookie,
  getAdminSessionCookieName,
} from '../src/api/admin-auth';
import { createMockEnv } from './test-utils';

describe('Telegram admin session cookies', () => {
  it('accepts a valid session when an invalid same-name cookie appears first', async () => {
    const env = createMockEnv();
    const cookieName = getAdminSessionCookieName();
    const validCookie = await createTelegramSessionCookie(env, {
      id: 42,
      first_name: 'Admin',
      username: 'admin_user',
      auth_date: Math.floor(Date.now() / 1000),
      hash: 'unused',
    });
    const validCookiePair = validCookie.split(';', 1)[0];
    const request = new Request('https://example.com/admin/api/chats', {
      headers: {
        Cookie: `${cookieName}=attacker-garbage; ${validCookiePair}`,
      },
    });

    await expect(authenticateTelegramSession(request, env)).resolves.toMatchObject({
      type: 'telegram',
      telegramId: 42,
      username: 'admin_user',
    });
  });

  it('rejects duplicate session cookies when none has a valid signature', async () => {
    const env = createMockEnv();
    const cookieName = getAdminSessionCookieName();
    const request = new Request('https://example.com/admin/api/chats', {
      headers: {
        Cookie: `${cookieName}=garbage-one; ${cookieName}=garbage-two`,
      },
    });

    await expect(authenticateTelegramSession(request, env)).resolves.toBeNull();
  });
});
