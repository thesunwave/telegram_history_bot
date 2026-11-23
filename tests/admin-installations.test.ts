import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordBotMembership, listBotInstallations } from '../src/api/admin-installations';
import { saveAdminChatMeta } from '../src/api/admin-chats';
import { handleAdminRequest } from '../src/api/admin';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { createMockEnv } from './test-utils';
import worker from '../src/index';
import { createKVBindings, spyableKVBinding } from './helpers/miniflare-kv';
import { renderInstallationsHtml } from '../src/api/admin-installations-html';
import { createRealD1 } from './helpers/real-d1';
import { resetChatSettingsCache, saveChatSettings } from '../src/core/chat-settings';

let env: ReturnType<typeof createMockEnv>;
let bindings: Awaited<ReturnType<typeof createKVBindings>>;
let database: ReturnType<typeof createRealD1>;
beforeEach(async () => {
  vi.restoreAllMocks();
  resetChatSettingsCache();
  bindings = await createKVBindings();
  database = createRealD1();
  env = createMockEnv({ HISTORY: spyableKVBinding(bindings.history as any), DB: database.db,
    ADMIN_BASIC_USER: 'owner', ADMIN_BASIC_PASSWORD: 'password', ADMIN_USER_ID: '42' });
});
afterEach(async () => {
  await bindings.mf.dispose();
  database.sqlite.close();
});
const authorization = 'Basic ' + btoa('owner:password');
async function sessionCookie(id = 42) {
  return createTelegramSessionCookie(env, { id, auth_date: Math.floor(Date.now() / 1000) });
}
const event = (date: number, status = 'member', oldStatus = 'left') => ({
  chat: { id: -100, title: '<Group>', type: 'supergroup' }, date,
  old_chat_member: { status: oldStatus }, new_chat_member: { status },
});
const enablePath = '/admin/api/installations/achievements?chatId=';
const enable = (chatId: number, headers: Record<string, string> = {}) => handleAdminRequest(
  new Request('https://bot' + enablePath + chatId, { method: 'POST', headers }), env,
);

describe('bot installations', () => {
  it('renders executable browser code and both installation tables', () => {
    const html = renderInstallationsHtml();
    expect(html).toContain('id="selfHostedRows"');
    expect(html).toContain('id="installationRows"');
    expect(html).toContain('<th>Достижения</th>');
    expect(() => new Function(html.split('<script>')[1].split('</script>')[0])).not.toThrow();
  });

  it('lets the bot owner activate only the selected installation without granting access to its statistics', async () => {
    env.ENABLE_ACTIVITY_TRACKING = 'true';
    env.RAW_MESSAGE_STORAGE_MODE = 'stats_only';
    await recordBotMembership(env, event(100));
    await recordBotMembership(env, { ...event(100), chat: { id: -200, type: 'group', title: 'Other group' } });
    await saveChatSettings(env, -100, {
      dashboardAccess: 'admins', profanityEnabled: true, criminalEnabled: true, summaryEnabled: false,
    }, 'fixture');
    const telegram = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ ok: true, result: { status: 'member' } }),
    );
    const headers = { Cookie: await sessionCookie(), Origin: 'https://bot' };
    expect((await listBotInstallations(env)).find(row => row.chatId === -100)?.achievementsEnabled).toBe(false);
    expect((await enable(-100, headers)).status).toBe(200);
    const [stored] = database.rows('SELECT chat_id,enabled,start_day,generation FROM achievement_groups');
    expect(stored).toMatchObject({ chat_id: -100, enabled: 1 });
    expect((await enable(-100, headers)).status).toBe(200);
    expect(database.rows('SELECT chat_id,enabled,start_day,generation FROM achievement_groups')).toEqual([stored]);
    expect((await listBotInstallations(env)).find(row => row.chatId === -100)?.achievementsEnabled).toBe(true);
    expect(telegram).not.toHaveBeenCalled();

    const achievements = await handleAdminRequest(new Request('https://bot/admin/api/achievements?chatId=-100', {
      headers,
    }), env);
    expect(achievements.status).toBe(403);
  });

  it('rejects unauthenticated, non-owner, cross-origin, channel and removed-group requests', async () => {
    env.ENABLE_ACTIVITY_TRACKING = 'true';
    env.RAW_MESSAGE_STORAGE_MODE = 'stats_only';
    await recordBotMembership(env, event(100));
    await recordBotMembership(env, { ...event(100), chat: { id: -200, type: 'channel', title: 'Channel' } });
    const owner = await sessionCookie();
    const origin = { Origin: 'https://bot' };
    expect((await enable(-100, { ...origin, Authorization: authorization })).status).toBe(401);
    expect((await enable(-100, { ...origin, Cookie: await sessionCookie(43) })).status).toBe(403);
    expect((await enable(-100, { Origin: 'https://other.test', Cookie: owner })).status).toBe(403);
    expect((await enable(-100, { Cookie: owner })).status).toBe(403);
    expect((await enable(-200, { ...origin, Cookie: owner })).status).toBe(404);
    expect((await enable(-999, { ...origin, Cookie: owner })).status).toBe(404);
    expect((await enable(42, { ...origin, Cookie: owner })).status).toBe(400);
    const get = await handleAdminRequest(new Request('https://bot' + enablePath + '-100', {
      headers: { ...origin, Cookie: owner },
    }), env);
    expect(get.status).toBe(405);
    await recordBotMembership(env, event(120, 'kicked', 'member'));
    expect((await enable(-100, { ...origin, Cookie: owner })).status).toBe(409);
    expect(database.rows('SELECT * FROM achievement_groups')).toEqual([]);
  });

  it('verifies the bot’s own membership for a legacy group and handles a Telegram outage', async () => {
    env.ENABLE_ACTIVITY_TRACKING = 'true';
    env.RAW_MESSAGE_STORAGE_MODE = 'stats_only';
    await saveAdminChatMeta(env, { id: -100, title: 'Legacy group' }, 100);
    const headers = { Cookie: await sessionCookie(), Origin: 'https://bot' };
    const telegram = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Telegram unavailable'));
    expect((await enable(-100, headers)).status).toBe(503);
    expect(database.rows('SELECT * FROM achievement_groups')).toEqual([]);
    telegram.mockImplementation(async (request, init) => {
      const method = String(request).split('/').at(-1);
      if (method === 'getChat') return Response.json({ ok: true, result: { type: 'supergroup' } });
      if (method === 'getMe') return Response.json({ ok: true, result: { id: 12345 } });
      expect(method).toBe('getChatMember');
      expect(JSON.parse(String(init?.body))).toEqual({ chat_id: -100, user_id: 12345 });
      return Response.json({ ok: true, result: { status: 'member' } });
    });
    expect((await enable(-100, headers)).status).toBe(200);
    expect(database.rows('SELECT chat_id,enabled FROM achievement_groups')).toEqual([{ chat_id: -100, enabled: 1 }]);
  });

  it('exposes anonymous deployment totals only to the receiver administrator', async () => {
    const { db, sqlite } = createRealD1();
    env.DB = db;
    env.TELEMETRY_RECEIVER = true;
    try {
      sqlite.exec(`INSERT INTO telemetry_installs VALUES
        ('repeat-id', date('now', '-10 day'), date('now', '-6 day'), '0', '0', 3),
        ('active-id', '2020-01-01', date('now', '-7 day'), '1', '0', 1),
        ('zero-once', date('now'), date('now'), '0', '0', 1)`);
      const response = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
        headers: { Cookie: await sessionCookie() },
      }), env);
      const body = await response.json() as { selfHosted: { total: number; active7d: number; rows: unknown[] } };
      expect(body.selfHosted).toMatchObject({ total: 2, active7d: 1 });
      expect(body.selfHosted.rows).toEqual([
        expect.objectContaining({ install_id: 'repeat-id' }),
        expect.objectContaining({ install_id: 'active-id' }),
      ]);
      const cookie = await sessionCookie(43);
      const member = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
        headers: { Cookie: cookie },
      }), env);
      expect(member.status).toBe(403);
      expect(await member.json()).not.toHaveProperty('selfHosted');
      env.TELEMETRY_RECEIVER = false;
      const disabled = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
        headers: { Cookie: await sessionCookie() },
      }), env);
      expect(await disabled.json()).toMatchObject({ selfHosted: null });
    } finally {
      sqlite.close();
    }
  });
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

  it('keeps the latest status when concurrent deliveries finish in reverse order', async () => {
    let releaseOlder!: () => void;
    let olderReachedWrite!: () => void;
    const gate = new Promise<void>(resolve => { releaseOlder = resolve; });
    const reached = new Promise<void>(resolve => { olderReachedWrite = resolve; });
    const put = env.HISTORY.put.bind(env.HISTORY);
    vi.spyOn(env.HISTORY, 'put').mockImplementation(async (key, value, options) => {
      if (key === 'admin_chat:-100' && String(value).includes('Older title')) {
        olderReachedWrite();
        await gate;
      }
      return put(key, value, options);
    });
    const older = event(100);
    older.chat.title = 'Older title';
    const oldRequest = recordBotMembership(env, older, 1);
    await reached;
    await recordBotMembership(env, event(110, 'kicked', 'member'), 2);
    releaseOlder();
    await oldRequest;
    expect((await listBotInstallations(env))[0].membership).toMatchObject({
      active: false, status: 'kicked', statusChangedAt: 110,
    });
  });

  it('redirects expired member sessions to Telegram login without a Basic challenge', async () => {
    const response = await handleAdminRequest(
      new Request('https://bot/admin/installations?scope=member'), env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin');
    expect(response.headers.has('WWW-Authenticate')).toBe(false);
  });

  it.each(['canonical', 'legacy'])('does not record events from an unauthenticated %s webhook', async (route) => {
    const path = route === 'canonical' ? '/telegram/webhook' : `/tg/${env.TOKEN}/webhook`;
    const response = await worker.fetch(new Request(`https://bot${path}`, {
      method: 'POST',
      body: JSON.stringify({ update_id: 1, my_chat_member: event(100) }),
    }), env, { waitUntil: vi.fn() } as any);
    expect(response.status).toBe(403);
    expect(await listBotInstallations(env)).toEqual([]);
  });

  it('opens the full list through the owner Telegram session without membership lookups', async () => {
    await recordBotMembership(env, event(100));
    await saveAdminChatMeta(env, { id: -200, title: 'Another chat' }, 100);
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unexpected membership lookup'));
    const headers = { Cookie: await sessionCookie() };
    const response = await handleAdminRequest(new Request('https://bot/admin/api/installations', { headers }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json() as { scope: string; installations: unknown[] };
    expect(body.scope).toBe('all');
    expect(body.installations).toHaveLength(2);
    for (const path of ['/admin/installations', '/admin/installations?scope=member']) {
      const page = await handleAdminRequest(new Request('https://bot' + path, { headers }), env);
      expect(page.status).toBe(200);
      expect(page.headers.has('WWW-Authenticate')).toBe(false);
      expect(await page.text()).not.toContain('вход администратора');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['/admin/installations', '/admin/installations?scope=member', '/admin/api/installations'])(
    'denies non-owner Telegram users and Basic credentials at %s', async (path) => {
      await recordBotMembership(env, event(100));
      const headers = { Cookie: await sessionCookie(43), Authorization: authorization };
      const denied = await handleAdminRequest(new Request('https://bot' + path, { headers }), env);
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain('<Group>');
      const basicOnly = await handleAdminRequest(new Request('https://bot' + path, {
        headers: { Authorization: authorization },
      }), env);
      expect(basicOnly.status).toBe(path.includes('/api/') ? 401 : 302);
      expect(basicOnly.headers.has('WWW-Authenticate')).toBe(false);
    },
  );

  it('uses the paired Telegram owner and denies access before pairing', async () => {
    delete env.ADMIN_USER_ID;
    const headers = { Cookie: await sessionCookie() };
    const request = () => new Request('https://bot/admin/api/installations', { headers });
    expect((await handleAdminRequest(request(), env)).status).toBe(403);
    database.sqlite.prepare('INSERT INTO app_settings(scope, settings_json) VALUES (?, ?)')
      .run('telegram_owner', JSON.stringify({ telegramId: '42' }));
    expect((await handleAdminRequest(request(), env)).status).toBe(200);
    env.ADMIN_USER_ID = '43';
    expect((await handleAdminRequest(request(), env)).status).toBe(403);
  });

  it('shows the menu only for the bound owner and hides it on the login page', async () => {
    for (const [id, visible] of [[42, true], [43, false]] as const) {
      const response = await handleAdminRequest(new Request('https://bot/admin', {
        headers: { Cookie: await sessionCookie(id) },
      }), env);
      expect((await response.text()).includes('href="/admin/installations"')).toBe(visible);
    }
    delete env.ADMIN_USER_ID;
    const unpaired = await handleAdminRequest(new Request('https://bot/admin', {
      headers: { Cookie: await sessionCookie() },
    }), env);
    expect(await unpaired.text()).not.toContain('href="/admin/installations"');
    const anonymous = await handleAdminRequest(new Request('https://bot/admin'), env);
    expect(await anonymous.text()).not.toContain('href="/admin/installations"');
  });

  it.each(['canonical', 'legacy'])('records membership through the authenticated %s webhook', async (route) => {
    const path = route === 'canonical' ? '/telegram/webhook' : `/tg/${env.TOKEN}/webhook`;
    const response = await worker.fetch(new Request(`https://bot${path}`, {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.SECRET! },
      body: JSON.stringify({ update_id: 1, my_chat_member: event(100) }),
    }), env, { waitUntil: vi.fn() } as any);
    expect(response.status).toBe(200);
    expect((await listBotInstallations(env))[0].membership?.active).toBe(true);
  });
});
