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
import { resetChatSettingsCache } from '../src/core/chat-settings';

let env: ReturnType<typeof createMockEnv>;
let bindings: Awaited<ReturnType<typeof createKVBindings>>;
let database: ReturnType<typeof createRealD1>;
beforeEach(async () => {
  vi.restoreAllMocks();
  resetChatSettingsCache();
  bindings = await createKVBindings();
  database = createRealD1();
  env = createMockEnv({ HISTORY: spyableKVBinding(bindings.history as any), DB: database.db,
    ADMIN_BASIC_USER: 'owner', ADMIN_BASIC_PASSWORD: 'password' });
});
afterEach(async () => {
  await bindings.mf.dispose();
  database.sqlite.close();
});
const authorization = 'Basic ' + btoa('owner:password');
const event = (date: number, status = 'member', oldStatus = 'left') => ({
  chat: { id: -100, title: '<Group>', type: 'supergroup' }, date,
  old_chat_member: { status: oldStatus }, new_chat_member: { status },
});

describe('bot installations', () => {
  it('renders executable browser code and both installation tables', () => {
    const html = renderInstallationsHtml();
    expect(html).toContain('id="selfHostedRows"');
    expect(html).toContain('id="installationRows"');
    expect(() => new Function(html.split('<script>')[1].split('</script>')[0])).not.toThrow();
  });

  it('exposes anonymous deployment totals only to the receiver administrator', async () => {
    const { db, sqlite } = createRealD1();
    env.DB = db;
    env.TELEMETRY_RECEIVER = true;
    try {
      sqlite.exec(`INSERT INTO telemetry_installs VALUES
        ('new-install', date('now', '-10 day'), date('now', '-6 day'), '2-5', '1', 3),
        ('old-install', '2020-01-01', date('now', '-7 day'), '1', '0', 1)`);
      const response = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
        headers: { Authorization: authorization },
      }), env);
      const body = await response.json() as { selfHosted: { total: number; active7d: number; rows: unknown[] } };
      expect(body.selfHosted).toMatchObject({ total: 2, active7d: 1 });
      expect(body.selfHosted.rows).toHaveLength(2);
      const cookie = await createTelegramSessionCookie(env, { id: 42, auth_date: 100 });
      const member = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
        headers: { Cookie: cookie },
      }), env);
      expect(await member.json()).toMatchObject({ scope: 'member', selfHosted: null });
      env.TELEMETRY_RECEIVER = false;
      const disabled = await handleAdminRequest(new Request('https://bot/admin/api/installations', {
        headers: { Authorization: authorization },
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

  it('honours administrators-only dashboard policy for installation metadata', async () => {
    await recordBotMembership(env, event(100));
    database.sqlite.prepare('INSERT INTO app_settings(scope, settings_json) VALUES (?, ?)')
      .run('chat:-100', JSON.stringify({ version: 1, dashboardAccess: 'admins' }));
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ ok: true, result: { status: 'member' } }),
    );
    expect(await listBotInstallations(env, 42)).toEqual([]);
    fetch.mockResolvedValue(Response.json({ ok: true, result: { status: 'administrator' } }));
    expect(await listBotInstallations(env, 42)).toHaveLength(1);
    expect(await listBotInstallations(env)).toHaveLength(1);
  });

  it('redirects expired member sessions to Telegram login without a Basic challenge', async () => {
    const response = await handleAdminRequest(
      new Request('https://bot/admin/installations?scope=member'), env,
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/admin');
    expect(response.headers.has('WWW-Authenticate')).toBe(false);
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
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.SECRET! },
      body: JSON.stringify({ update_id: 1, my_chat_member: event(100) }),
    }), env, { waitUntil: vi.fn() } as any);
    expect(response.status).toBe(200);
    expect((await listBotInstallations(env))[0].membership?.active).toBe(true);
  });
});
