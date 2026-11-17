import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordBotMembership, listBotInstallations } from '../src/api/admin-installations';
import { saveAdminChatMeta } from '../src/api/admin-chats';
import { handleAdminRequest } from '../src/api/admin';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { createMockEnv } from './test-utils';
import worker from '../src/index';

let env: ReturnType<typeof createMockEnv>;
beforeEach(() => {
  vi.restoreAllMocks();
  env = createMockEnv({ ADMIN_BASIC_USER: 'owner', ADMIN_BASIC_PASSWORD: 'password' });
});
const authorization = 'Basic ' + btoa('owner:password');
const event = (date: number, status = 'member', oldStatus = 'left') => ({
  chat: { id: -100, title: '<Group>', type: 'supergroup' }, date,
  old_chat_member: { status: oldStatus }, new_chat_member: { status },
});

describe('bot installations', () => {
  it('discovers a quiet installation and preserves activity across removal and reinstallation', async () => {
    await recordBotMembership(env, event(100));
    let [chat] = await listBotInstallations(env);
    expect(chat.lastSeenAt).toBe(0);
    expect(chat.membership).toMatchObject({ active: true, installedAt: 100 });
    await saveAdminChatMeta(env, event(100).chat, 110);
    await recordBotMembership(env, event(120, 'kicked', 'member'));
    [chat] = await listBotInstallations(env);
    expect(chat.lastSeenAt).toBe(110);
    expect(chat.membership).toMatchObject({ active: false, status: 'kicked', installedAt: 100 });
    await recordBotMembership(env, event(130));
    await recordBotMembership(env, event(120, 'kicked', 'member'));
    [chat] = await listBotInstallations(env);
    expect(chat.membership).toMatchObject({ active: true, installedAt: 130 });
  });

  it('retains install date when promoted and handles restricted membership', async () => {
    await recordBotMembership(env, event(100));
    await recordBotMembership(env, event(110, 'administrator', 'member'));
    expect((await listBotInstallations(env))[0].membership?.installedAt).toBe(100);
    const restricted = event(120, 'restricted', 'administrator');
    await recordBotMembership(env, restricted);
    expect((await listBotInstallations(env))[0].membership?.active).toBe(false);
    await recordBotMembership(env, { ...restricted, date: 130,
      new_chat_member: { status: 'restricted', is_member: true } });
    expect((await listBotInstallations(env))[0].membership?.active).toBe(true);
  });

  it('shows legacy chats with unknown membership', async () => {
    await saveAdminChatMeta(env, event(100).chat, 100);
    expect((await listBotInstallations(env))[0].membership).toBeNull();
  });

  it('orders membership changes within the same second by update ID', async () => {
    await recordBotMembership(env, event(100), 1);
    await recordBotMembership(env, event(100, 'administrator', 'member'), 2);
    await recordBotMembership(env, event(100), 1);
    expect((await listBotInstallations(env))[0].membership?.status).toBe('administrator');
  });

  it('does not record membership events from an unauthenticated webhook', async () => {
    const response = await worker.fetch(new Request(`https://bot/tg/${env.TOKEN}/webhook`, {
      method: 'POST',
      body: JSON.stringify({ update_id: 1, my_chat_member: event(100) }),
    }), env, { waitUntil: vi.fn() } as any);
    expect(response.status).toBe(403);
    expect(await listBotInstallations(env)).toEqual([]);
  });

  it('requires owner authentication for the full list and challenges on the owner page', async () => {
    const anonymous = await handleAdminRequest(new Request('https://bot/admin/api/installations'), env);
    expect(anonymous.status).toBe(401);
    const challenge = await handleAdminRequest(new Request('https://bot/admin/installations'), env);
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('WWW-Authenticate')).toContain('Basic');
    await recordBotMembership(env, event(100));
    const response = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
      headers: { Authorization: authorization },
    }), env);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ scope: 'all', installations: [{ chatId: -100 }] });
    const page = await handleAdminRequest(new Request('https://bot/admin/installations', {
      headers: { Authorization: authorization },
    }), env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Установки бота');
  });

  it('limits Telegram sessions to accessible chats', async () => {
    await recordBotMembership(env, event(100));
    await saveAdminChatMeta(env, { id: -200, title: 'Other' }, 100);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const { chat_id } = JSON.parse(String(init?.body));
      return Response.json({ ok: true, result: { status: chat_id === -100 ? 'member' : 'left' } });
    });
    const cookie = await createTelegramSessionCookie(env, { id: 42, auth_date: 100 });
    const response = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
      headers: { Cookie: cookie },
    }), env);
    expect(await response.json()).toMatchObject({ scope: 'member', installations: [{ chatId: -100 }] });
    const body = await (await handleAdminRequest(new Request('https://bot/admin/api/installations', {
      headers: { Cookie: cookie },
    }), env)).json() as { installations: unknown[] };
    expect(body.installations).toHaveLength(1);
  });

  it('records my_chat_member through the authenticated webhook without a message', async () => {
    const response = await worker.fetch(new Request(`https://bot/tg/${env.TOKEN}/webhook`, {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.SECRET },
      body: JSON.stringify({ update_id: 1, my_chat_member: event(100) }),
    }), env, { waitUntil: vi.fn() } as any);
    expect(response.status).toBe(200);
    expect((await listBotInstallations(env))[0].membership?.active).toBe(true);
  });
});
