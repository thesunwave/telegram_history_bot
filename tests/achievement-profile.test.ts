import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import { createRealD1 } from './helpers/real-d1';
import { handleAchievementUpdate } from '../src/features/achievements/telegram';
import { setEnrolled, setGroupEnabled } from '../src/features/achievements/repository';
import { DUTCH_RUDDER, DUTCH_RUDDER_RESULT } from '../src/features/achievements/social-score';
import { setConversationGroup } from '../src/features/achievements/social';
import { handleAdminRequest } from '../src/api/admin';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { resetChatSettingsCache } from '../src/core/chat-settings';

describe('member achievement profiles', () => {
  let database: ReturnType<typeof createRealD1>;
  let env: Env;
  let role: string;
  let roles: Record<number, string>;
  const sent: Array<Record<string, unknown>> = [];
  const viewer = 177, friend = 288, group = -223;
  const profile = (extra: Record<string, unknown> = {}, text = '/profile') => ({
    message: { text, message_id: 9, from: { id: viewer, first_name: 'Артур' },
      chat: { id: group, type: 'supergroup' }, ...extra },
  });
  const award = (user: number, badge: string, day: string, result: string) => database.sqlite.prepare(
    'INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result) VALUES (?,?,?,?,?)',
  ).run(group, user, badge, day, result);

  beforeEach(async () => {
    resetChatSettingsCache();
    database = createRealD1();
    env = { TOKEN: 'test-token', SECRET: 'test-secret', TELEGRAM_BOT_USERNAME: 'example_bot', DB: database.db,
      ENABLE_CONVERSATION_ACHIEVEMENTS: 'true',
      HISTORY: { get: async () => null } } as unknown as Env;
    sent.length = 0;
    role = 'member';
    roles = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const method = url.split('/').pop()!;
      if (method === 'getChatMember') {
        const user = JSON.parse(init.body).user_id as number;
        if (roles[user] === 'outage') return Response.json({ ok: false }, { status: 502 });
        return Response.json({ ok: true, result: { status: roles[user] ?? role } });
      }
      if (method === 'sendMessage') sent.push(JSON.parse(init.body));
      return Response.json({ ok: true, result: { message_id: 45 } });
    }));
    await setGroupEnabled(database.db, group, true);
    await setEnrolled(database.db, group, viewer, true);
    await setEnrolled(database.db, group, friend, true);
    await setConversationGroup(database.db, group, true);
    award(friend, 'tomorrow', '2026-11-20', 'Два дня подряд');
    award(friend, 'regular', '2026-11-24', 'Четыре недели подряд');
    award(friend, DUTCH_RUDDER.id, '2026-11-25', DUTCH_RUDDER_RESULT);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); database.sqlite.close(); });

  it('shows the caller their own profile with a link to the private album', async () => {
    award(viewer, 'calendar', '2026-11-22', 'Все семь дней');
    award(viewer, DUTCH_RUDDER.id, '2026-11-23', DUTCH_RUDDER_RESULT);
    expect(await handleAchievementUpdate(env, profile())).toBe(true);
    const reply = sent.at(-1)!;
    expect(reply.chat_id).toBe(group);
    expect(reply.text).toContain('Профиль · Артур');
    expect(reply.text).toContain('Бейджи: 2 из');
    expect(reply.text).toContain(DUTCH_RUDDER.title);
    expect(reply.text).toContain('Весь календарь · 2026-11-22');
    expect(JSON.stringify(reply.reply_markup)).toContain('https://t.me/example_bot?start=ach_223');
  });

  it('opens another member profile by replying, without progress or the secret badge', async () => {
    const reply = { reply_to_message: { message_id: 3, from: { id: friend, first_name: 'Лена', is_bot: false } } };
    await handleAchievementUpdate(env, profile(reply, '/profile@example_bot'));
    const text = String(sent.at(-1)!.text);
    expect(text).toContain('Профиль · Лена');
    expect(text).toContain('Бейджи: 2 из');
    expect(text.indexOf('Завсегдатай')).toBeLessThan(text.indexOf('До завтра'));
    expect(text).not.toContain(DUTCH_RUDDER.title);
    expect(text).not.toContain('Прогресс');
    expect(sent.at(-1)!.reply_markup).toEqual({ inline_keyboard: [] });
  });

  it('treats an implicit topic reply as a request for the caller profile', async () => {
    const topic = { is_topic_message: true, message_thread_id: 5,
      reply_to_message: { message_id: 5, from: { id: friend }, forum_topic_created: { name: 'Тема' } } };
    await handleAchievementUpdate(env, profile(topic));
    expect(sent.at(-1)!.text).toContain('Профиль · Артур');
    expect(sent.at(-1)!.message_thread_id).toBe(5);
  });

  it('explains that everyone takes part automatically before their first message', async () => {
    const reply = { reply_to_message: { message_id: 3, from: { id: 999, username: 'newbie' } } };
    await handleAchievementUpdate(env, profile(reply));
    expect(sent.at(-1)!.text).toContain('Профиль · @newbie');
    expect(sent.at(-1)!.text).toContain('Участие автоматическое');
  });

  it('keeps earned badges with a note when the album is paused or achievements are off', async () => {
    const reply = { reply_to_message: { message_id: 3, from: { id: friend, first_name: 'Лена' } } };
    await setEnrolled(database.db, group, friend, false);
    await handleAchievementUpdate(env, profile(reply));
    expect(sent.at(-1)!.text).toContain('Альбом на паузе. Открытые бейджи сохранены.');
    expect(sent.at(-1)!.text).toContain('Завсегдатай · 2026-11-24');
    await setGroupEnabled(database.db, group, false);
    await handleAchievementUpdate(env, profile(reply));
    expect(sent.at(-1)!.text).toContain('Достижения в этой группе сейчас выключены');
    expect(sent.at(-1)!.text).toContain('До завтра · 2026-11-20');
  });

  it('hides the profile of someone who left the group', async () => {
    roles[friend] = 'left';
    const reply = { reply_to_message: { message_id: 3, from: { id: friend, first_name: 'Лена' } } };
    await handleAchievementUpdate(env, profile(reply));
    expect(sent.at(-1)!.text).toBe('Профиль виден, только пока человек состоит в группе.');
  });

  it('refuses bots and people outside the group', async () => {
    await handleAchievementUpdate(env, profile({ reply_to_message: { message_id: 3, from: { id: 55, is_bot: true } } }));
    expect(sent.at(-1)!.text).toContain('Профиль есть только у участников группы');
    role = 'left';
    await handleAchievementUpdate(env, profile());
    expect(sent.at(-1)!.text).toBe('Коллекция доступна участникам этой группы.');
  });

  it('shows the dashboard member card badges to other members of the group', async () => {
    const cookie = (await createTelegramSessionCookie(env, { id: viewer, auth_date: 0 })).split(';')[0];
    const read = (query: string, language = 'ru') => handleAdminRequest(new Request(
      'https://example.test/admin/api/member-achievements?' + query,
      { headers: { Cookie: cookie, 'Accept-Language': language } }), env);
    const response = await read('chatId=' + group + '&userId=' + friend, 'en');
    expect(response.status).toBe(200);
    const body = await response.json() as { state: string; total: number; badges: Array<Record<string, unknown>> };
    expect(body.state).toBe('active');
    expect(body.badges.map(badge => badge.id)).toEqual(['regular', 'tomorrow']);
    expect(body.badges[0]).toMatchObject({ earnedDay: '2026-11-24' });
    expect(body.badges[0]).not.toHaveProperty('progress');
    expect(body.total).toBeGreaterThan(body.badges.length);

    roles[friend] = 'kicked';
    expect((await read('chatId=' + group + '&userId=' + friend)).status).toBe(404);
    roles[friend] = 'outage';
    expect((await read('chatId=' + group + '&userId=' + friend)).status).toBe(503);
    delete roles[friend];
    role = 'left';
    expect((await read('chatId=' + group + '&userId=' + friend)).status).toBe(403);
    role = 'member';
    expect((await read('chatId=' + group)).status).toBe(400);
    expect((await read('chatId=5&userId=' + friend)).status).toBe(400);
  });
});
