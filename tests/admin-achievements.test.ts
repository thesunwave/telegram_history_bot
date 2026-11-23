import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAdminRequest } from '../src/api/admin';
import type { AdminAchievementBadge } from '../src/api/admin-achievements';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { resetChatSettingsCache } from '../src/core/chat-settings';
import type { Env } from '../src/core/env';
import { Logger } from '../src/core/logger';
import { createRealD1 } from './helpers/real-d1';

const chat = -101;
const viewer = 12683;
const other = 24591;
const day = '2026-01-11';

async function fixture() {
  const { db, sqlite } = createRealD1();
  const env = {
    DB: db, HISTORY: { get: async () => null }, TOKEN: 'test', SECRET: 'test-secret', TELEGRAM_BOT_USERNAME: 'MyTestBot',
    ADMIN_BASIC_USER: 'operator', ADMIN_BASIC_PASSWORD: 'test-password', ENABLE_CONVERSATION_ACHIEVEMENTS: 'true',
  } as unknown as Env;
  const cookie = (await createTelegramSessionCookie(env, { id: viewer, auth_date: 0 })).split(';')[0];
  const request = (query: string, headers: Record<string, string> = { Cookie: cookie }, method = 'GET') =>
    handleAdminRequest(new Request('https://example.test/admin/api/achievements?' + query, { method, headers }), env);
  sqlite.prepare('INSERT INTO achievement_groups(chat_id,enabled,start_day,generation) VALUES (?,1,?,?)')
    .run(chat, day, 'private-group-generation');
  const enroll = sqlite.prepare(`INSERT INTO achievement_enrollments
    (chat_id,user_id,enabled,start_day,generation,progress_json) VALUES (?,?,1,?,'private-album-generation',?)`);
  const progress = JSON.stringify([{ id: 'radio-diary', current: 2, target: 3, result: 'progress-internals' }]);
  enroll.run(chat, viewer, day, progress);
  enroll.run(chat, other, day, '[]');
  const award = sqlite.prepare('INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result) VALUES (?,?,?,?,?)');
  award.run(chat, 0, 'podcast', day, '61 мин 1 с, записей: 7');
  award.run(chat, viewer, 'columnist', day, 'Дней со 100 словами: 3');
  award.run(chat, other, 'regular', day, 'another-private-album');
  award.run(-102, viewer, 'regular', day, 'other-private-group');
  return { env, sqlite, request, cookie };
}

function membership(status: string, getMe?: () => Response) {
  const fetchMember = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/getMe') && getMe) return getMe();
    expect(url).toMatch(/\/getChatMember$/);
    expect(JSON.parse(String(init.body))).toEqual({ chat_id: chat, user_id: viewer });
    return Response.json({ ok: true, result: { status } });
  });
  vi.stubGlobal('fetch', fetchMember);
  return fetchMember;
}

beforeEach(resetChatSettingsCache);
afterEach(() => vi.unstubAllGlobals());

describe('dashboard achievements access', () => {
  it('reads only group awards and the signed-in member’s own album from a read-only database', async () => {
    const { request, sqlite } = await fixture();
    sqlite.pragma('query_only = ON');
    membership('member');
    const response = await request('chatId=' + chat);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const text = await response.text();
    const data = JSON.parse(text);
    expect(data.group.enabled).toBe(true);
    expect(data.group.badges).toHaveLength(6);
    expect(data.group.badges.filter((b: AdminAchievementBadge) => b.earnedDay)).toMatchObject([
      { id: 'podcast', earnedDay: day, result: '61 мин 1 с, записей: 7' },
    ]);
    expect(data.personal.state).toBe('available');
    expect(data.personal.badges).toHaveLength(10);
    expect(data.personal.badges.find((b: AdminAchievementBadge) => b.id === 'radio-diary'))
      .toMatchObject({ current: 2, target: 3, earnedDay: null, result: null });
    expect(data.personal.badges.find((b: AdminAchievementBadge) => b.id === 'columnist')).toMatchObject({ earnedDay: day });
    for (const internal of ['another-private-album', 'other-private-group', 'generation', 'progress-internals', String(other)]) {
      expect(text).not.toContain(internal);
    }
  });

  it('denies anonymous visitors, shared URLs and Basic operators without Telegram identity', async () => {
    const { request } = await fixture();
    const check = membership('administrator');
    const attempts: Record<string, string>[] = [{}, { Authorization: 'Basic ' + btoa('operator:test-password') }];
    for (const headers of attempts) {
      expect((await request('chatId=' + chat + '&share=shared-link', headers)).status).toBe(401);
    }
    expect(check).not.toHaveBeenCalled();
  });

  it('enforces membership and the admins-only dashboard setting and gives admins only their own album', async () => {
    const { env, request, sqlite } = await fixture();
    sqlite.prepare('INSERT INTO app_settings(scope,settings_json) VALUES (?,?)').run('chat:' + chat,
      JSON.stringify({ version: 1, dashboardAccess: 'admins' }));
    membership('left');
    const queries = vi.spyOn(env.DB, 'prepare');
    expect((await request('chatId=' + chat)).status).toBe(403);
    membership('member');
    expect((await request('chatId=' + chat)).status).toBe(403);
    expect(queries.mock.calls.flat().join(' ')).not.toMatch(/achievement_|conversation_/);
    membership('administrator');
    const allowed = await request('chatId=' + chat);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).not.toContain('another-private-album');
    expect((await request('chatId=' + chat + '&userId=' + other)).status).toBe(400);
    expect((await request('chatId=' + chat + '&user_id=' + other)).status).toBe(400);
  });

  it('rejects mutation methods and private or invalid chat IDs', async () => {
    const { request, cookie } = await fixture();
    const check = membership('member');
    for (const query of ['', 'chatId=n/a', 'chatId=0', 'chatId=' + viewer]) {
      expect((await request(query)).status).toBe(400);
    }
    expect((await request('chatId=' + chat, { Cookie: cookie }, 'POST')).status).toBe(405);
    expect(check).not.toHaveBeenCalled();
  });

  it('returns saved awards on pause and group awards without auto-enrolling a first-time visitor', async () => {
    const { sqlite, request } = await fixture();
    membership('member');
    sqlite.prepare('UPDATE achievement_enrollments SET enabled=0 WHERE user_id=?').run(viewer);
    sqlite.prepare('INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result) VALUES (?,?,?,?,?)')
      .run(chat, viewer, 'spark', day, 'Ответов: 3');
    const paused = await (await request('chatId=' + chat)).json() as { personal: { state: string; badges: AdminAchievementBadge[] } };
    expect(paused.personal.state).toBe('paused');
    expect(paused.personal.badges.find(b => b.id === 'spark')?.earnedDay).toBe(day);
    expect(paused.personal.badges.every(b => b.current === null)).toBe(true);
    sqlite.prepare('DELETE FROM achievement_enrollments WHERE user_id=?').run(viewer);
    sqlite.pragma('query_only = ON');
    const unseen = await (await request('chatId=' + chat)).json() as { personal: { badges: AdminAchievementBadge[] } };
    expect(unseen).toMatchObject({ group: { enabled: true }, personal: { state: 'not-enrolled', albumUrl: 'https://t.me/MyTestBot?start=ach_101' } });
    expect(unseen.personal.badges).toHaveLength(10);
    expect(unseen.personal.badges.every(b => b.earnedDay === null && b.current === null)).toBe(true);
  });

  it('localizes the preview and uses a valid configured bot name without a lookup', async () => {
    const { env, sqlite, request, cookie } = await fixture();
    const check = membership('member');
    sqlite.prepare('DELETE FROM achievement_enrollments WHERE user_id=?').run(viewer);
    sqlite.prepare('INSERT INTO conversation_groups VALUES (?,1)').run(chat);
    sqlite.pragma('query_only = ON');
    env.TELEGRAM_BOT_USERNAME = '@MyTestBot';
    const read = async () => await (await request('chatId=' + chat, { Cookie: cookie, 'Accept-Language': 'en' })).json() as {
      group: { badges: AdminAchievementBadge[] }; personal: { badges: AdminAchievementBadge[]; albumUrl: string | null };
    };
    const data = await read();
    expect(data.personal.albumUrl).toBe('https://t.me/MyTestBot?start=ach_101');
    expect(data.personal.badges).toHaveLength(14);
    expect(data.personal.badges.find(b => b.id === 'spark')).toMatchObject({ title: 'Spark', earnedDay: null, current: null });
    expect(data.group.badges.find(b => b.id === 'podcast')?.result).toBe('61 min 1 s, recordings: 7');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('uses the Telegram bot identity when the configured username is malformed', async () => {
    const { env, request } = await fixture();
    env.TELEGRAM_BOT_USERNAME = 'wrong.example/path';
    const getMe = vi.fn(() => Response.json({ ok: true, result: { username: 'SelfHostedBot' } }));
    membership('member', getMe);
    const response = await request('chatId=' + chat);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      personal: { albumUrl: 'https://t.me/SelfHostedBot?start=ach_101' },
    });
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it('resolves self-hosted links for active and paused albums and skips lookup for a disabled group with no album', async () => {
    const { env, request, sqlite } = await fixture();
    delete env.TELEGRAM_BOT_USERNAME;
    const getMe = vi.fn(() => Response.json({ ok: true, result: { username: 'SelfHostedBot' } }));
    membership('member', getMe);
    expect(await (await request('chatId=' + chat)).json()).toMatchObject({
      personal: { albumUrl: 'https://t.me/SelfHostedBot?start=ach_101' },
    });
    sqlite.prepare('UPDATE achievement_groups SET enabled=0 WHERE chat_id=?').run(chat);
    expect(await (await request('chatId=' + chat)).json()).toMatchObject({
      personal: { state: 'paused', albumUrl: 'https://t.me/SelfHostedBot?start=ach_101' },
    });
    sqlite.prepare('DELETE FROM achievement_enrollments WHERE chat_id=? AND user_id=?').run(chat, viewer);
    expect(await (await request('chatId=' + chat)).json()).toMatchObject({ personal: { albumUrl: null } });
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it('preserves the album when getMe is unavailable or returns no usable username', async () => {
    const { env, request } = await fixture();
    delete env.TELEGRAM_BOT_USERNAME;
    const warning = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    try {
      for (const reply of [() => new Response('', { status: 503 }), () => Response.json({ ok: true, result: {} })]) {
        membership('member', reply);
        const response = await request('chatId=' + chat);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ group: { enabled: true }, personal: { state: 'available', albumUrl: null } });
      }
      expect(warning.mock.calls).toEqual(Array(2).fill(['Telegram bot name unavailable for dashboard album link']));
    } finally { warning.mockRestore(); }
  });

  it('reads conversation progress only after the album owner gives consent', async () => {
    const { env, sqlite, request } = await fixture();
    membership('member');
    sqlite.prepare('INSERT INTO conversation_groups VALUES (?,1)').run(chat);
    const readSpark = async () => {
      const data = await (await request('chatId=' + chat)).json() as { personal: { badges: AdminAchievementBadge[] } };
      return data.personal.badges.find(b => b.id === 'spark');
    };
    expect(await readSpark()).toMatchObject({ current: null, target: null });
    sqlite.prepare('INSERT INTO conversation_members VALUES (?,?,1)').run(chat, viewer);
    sqlite.pragma('query_only = ON');
    expect(await readSpark()).toMatchObject({ current: 0, target: 3 });
    env.ENABLE_CONVERSATION_ACHIEVEMENTS = 'false';
    expect(await readSpark()).toBeUndefined();
  });
});
