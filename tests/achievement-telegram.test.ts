import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import type { Env } from '../src/core/env';
import { createRealD1 } from './helpers/real-d1';
import { handleAchievementUpdate } from '../src/features/achievements/telegram';
import { setEnrolled, setGroupEnabled } from '../src/features/achievements/repository';
import { weeklyRules } from '../src/features/achievements/rules';
import { sendCard, weeklyCard } from '../src/features/achievements/cards';
import * as badgeArtModule from '../src/features/achievements/badge-art-generated';

describe('Telegram achievement collections', () => {
  let database: ReturnType<typeof createRealD1>;
  let env: Env;
  let role: string;
  let webhookFilters: string[];
  let photoOutcome: 'sent' | 'rejected' | 'unknown';
  let textConfirmed: boolean;
  const sent: Array<Record<string, unknown>> = [];
  const photos: FormData[] = [];
  const methods: string[] = [];
  const owner = 177, group = -223;
  const forward = (data: string, chat: number, who = owner) => ({
    callback_query: { id: 'q', data, from: { id: who }, message: {
      chat: { id: chat, type: chat > 0 ? 'private' : 'supergroup' }, message_id: 45, text: 'Меню',
    } },
  });
  const command = (text: string, chat: number) => ({
    message: { text, from: { id: owner }, chat: { id: chat, type: chat > 0 ? 'private' : 'group' } },
  });
  beforeEach(() => {
    database = createRealD1();
    env = { TOKEN: 'test-token', TELEGRAM_BOT_USERNAME: 'example_bot', DB: database.db,
      HISTORY: { get: async () => ({ title: 'Закрытый тестовый чат' }) } } as unknown as Env;
    sent.length = photos.length = methods.length = 0;
    role = 'member';
    photoOutcome = 'sent';
    textConfirmed = true;
    webhookFilters = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const method = url.split('/').pop()!;
      methods.push(method);
      if (method === 'getChatMember') return Response.json({ ok: true, result: { status: role } });
      if (method === 'getWebhookInfo') return Response.json({ ok: true,
        result: { url: 'https://example.test/webhook', allowed_updates: webhookFilters } });
      if (method === 'sendMessage' || method === 'editMessageText') {
        sent.push(JSON.parse(init.body));
        if (!textConfirmed) return Response.json({ ok: false }, { status: 503 });
      }
      if (method === 'sendPhoto') {
        photos.push(init.body as unknown as FormData);
        if (photoOutcome === 'rejected') return Response.json({ ok: false, error_code: 403 }, { status: 403 });
        if (photoOutcome === 'unknown') throw new Error('disconnected after upload');
      }
      return Response.json({ ok: true, result: { message_id: 45 } });
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); database.sqlite.close(); });

  it('preserves default /start and commands addressed to another bot', async () => {
    expect(await handleAchievementUpdate(env, command('/start', owner))).toBe(false);
    expect(await handleAchievementUpdate(env, command('/badges@other_bot', group))).toBe(false);
    const forwarded = command('/badges', group);
    expect(await handleAchievementUpdate(env, { message: { ...forwarded.message, forward_date: 55 } })).toBe(false);
    expect(methods).toEqual([]);
  });

  it('checks admin privileges on every group switch and offers the scoped private link', async () => {
    await handleAchievementUpdate(env, forward('ach:on:' + group, group));
    expect(database.rows('SELECT * FROM achievement_groups')).toEqual([]);
    role = 'administrator';
    await handleAchievementUpdate(env, forward('ach:on:' + group, group));
    expect(database.rows('SELECT enabled FROM achievement_groups')).toEqual([{ enabled: 1 }]);
    expect(JSON.stringify(sent.at(-1))).toContain('https://t.me/example_bot?start=ach_223');
  });

  it('allows no cross-group, forwarded or foreign-DM access', async () => {
    await handleAchievementUpdate(env, forward('ach:group:' + group, -333));
    const acknowledgment = vi.mocked(fetch).mock.calls[0];
    expect(String(acknowledgment[0])).toMatch(/\/answerCallbackQuery$/);
    expect(JSON.parse(String(acknowledgment[1]?.body))).toEqual({
      callback_query_id: 'q', text: 'Чтобы открыть коллекцию этой группы, отправьте здесь /achievements.', show_alert: true,
    });
    await handleAchievementUpdate(env, forward('ach:join:' + group, owner + 1));
    expect(sent).toEqual([]);
    expect(methods).not.toContain('getChatMember');
    role = 'left';
    await handleAchievementUpdate(env, command('/start ach_223', owner));
    expect(sent.at(-1)?.text).toContain('членство');
    expect(JSON.stringify(sent)).not.toContain('Закрытый тестовый чат');
  });

  it('sends group menus and photos to the originating forum topic only for marked topic messages', async () => {
    const delivery = vi.spyOn(console, 'info').mockImplementation(() => {});
    const topic = { is_topic_message: true, message_thread_id: 312 };
    const menu = command('/achievements', group);
    menu.message.chat.type = 'supergroup';
    await handleAchievementUpdate(env, { message: { ...menu.message, ...topic } });
    expect(sent.at(-1)).toMatchObject({ chat_id: group, message_thread_id: 312 });
    const card = forward('ach:group-card:' + group + ':podcast', group).callback_query;
    await handleAchievementUpdate(env, { callback_query: { ...card, message: { ...card.message, ...topic } } });
    expect(photos[0].get('message_thread_id')).toBe('312');
    expect(photos[0].get('chat_id')).toBe(String(group));
    await handleAchievementUpdate(env, { callback_query: { ...card, message: { ...card.message, message_thread_id: 312 } } });
    expect(photos[1].get('message_thread_id')).toBeNull();
    expect(delivery.mock.calls).toEqual(Array(2).fill([{ event: 'achievement_card_delivery', status: 'sent' }]));
    await handleAchievementUpdate(env, { message: { ...menu.message, is_topic_message: true, message_thread_id: -1 } });
    expect(sent.at(-1)).not.toHaveProperty('message_thread_id');
  });

  it('acknowledges the click immediately and sends the badge details as text when photos are forbidden', async () => {
    photoOutcome = 'rejected';
    const delivery = vi.spyOn(console, 'info').mockImplementation(() => {});
    const cb = forward('ach:group-card:' + group + ':podcast', group).callback_query;
    await handleAchievementUpdate(env, { callback_query: { ...cb, message: {
      ...cb.message, is_topic_message: true, message_thread_id: 42,
    } } });
    expect(methods).toEqual(['answerCallbackQuery', 'getChatMember', 'sendPhoto', 'sendMessage']);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({
      callback_query_id: 'q', text: 'Открываю карточку…',
    });
    expect(photos).toHaveLength(1);
    expect(sent).toMatchObject([{ chat_id: group, message_thread_id: 42, text: 'Подкастерская\n60 минут голосовых за неделю.\nПока закрыто' }]);
    expect(delivery.mock.calls).toEqual([[{ event: 'achievement_card_delivery', status: 'text_fallback' }]]);
  });

  it('avoids duplicate badge content when Telegram might already have delivered the photo', async () => {
    photoOutcome = 'unknown';
    const delivery = vi.spyOn(console, 'info').mockImplementation(() => {});
    await handleAchievementUpdate(env, forward('ach:group-card:' + group + ':podcast', group));
    expect(methods).toEqual(['answerCallbackQuery', 'getChatMember', 'sendPhoto', 'sendMessage']);
    expect(sent).toEqual([{ chat_id: group, text: 'Не удалось подтвердить доставку фотографии.' }]);
    expect(delivery.mock.calls).toEqual([[{ event: 'achievement_card_delivery', status: 'unknown' }]]);
  });

  it('records an unconfirmed text fallback when Telegram also rejects the text reply', async () => {
    photoOutcome = 'rejected';
    textConfirmed = false;
    const delivery = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await handleAchievementUpdate(env, forward('ach:group-card:' + group + ':podcast', group))).toBe(true);
    expect(methods).toEqual(['answerCallbackQuery', 'getChatMember', 'sendPhoto', 'sendMessage']);
    expect(delivery.mock.calls).toEqual([[{ event: 'achievement_card_delivery', status: 'text_fallback_unconfirmed' }]]);
  });

  it('sends an earned private badge as text on rendering failure and keeps the album menu', async () => {
    const art = vi.spyOn(badgeArtModule, 'badgeArt').mockRejectedValue(new Error('unavailable'));
    const delivery = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setGroupEnabled(database.db, group, true);
    await setEnrolled(database.db, group, owner, true);
    database.sqlite.prepare(`INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result)
      VALUES(?,?,'tomorrow','2026-11-23','Два дня подряд')`).run(group, owner);
    await handleAchievementUpdate(env, forward('ach:preview:' + group + ':tomorrow', owner));
    expect(methods).toEqual(['answerCallbackQuery', 'getChatMember', 'sendMessage']);
    expect(sent).toMatchObject([{ chat_id: owner, text: 'До завтра\nНаписать в два дня подряд по UTC.\nОткрыто · 2026-11-23 UTC · Два дня подряд' }]);
    expect(sent[0]).not.toHaveProperty('message_thread_id');
    expect(delivery.mock.calls).toEqual([[{ event: 'achievement_card_delivery', status: 'text_fallback' }]]);
    expect(warning.mock.calls).toEqual([['Achievement card rendering failed']]);
    role = 'left';
    await handleAchievementUpdate(env, forward('ach:preview:' + group + ':tomorrow', owner));
    expect(art).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)?.text).not.toContain('Два дня подряд');
  });

  it('preserves the personal album keyboard on rejected, ambiguous and unrenderable shares', async () => {
    await setGroupEnabled(database.db, group, true);
    await setEnrolled(database.db, group, owner, true);
    database.sqlite.prepare(`INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result)
      VALUES(?,?,'tomorrow','2026-11-23','Два дня подряд')`).run(group, owner);
    const action = forward('ach:share:' + group + ':tomorrow', owner);
    for (const outcome of ['rejected', 'unknown'] as const) {
      photoOutcome = outcome;
      await handleAchievementUpdate(env, action);
    }
    vi.spyOn(badgeArtModule, 'badgeArt').mockRejectedValue(new Error('render failed'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handleAchievementUpdate(env, action);
    expect(photos).toHaveLength(2);
    expect(sent).toHaveLength(3);
    expect(sent.every(message => message.chat_id === owner && String(message.text).includes('Альбом сохранён'))).toBe(true);
    expect(methods).not.toContain('editMessageText');
    expect(warning.mock.calls).toEqual([['Achievement card rendering failed']]);
  });

  it('retries an unavailable membership check without offering to delete the album', async () => {
    await setGroupEnabled(database.db, group, true);
    await setEnrolled(database.db, group, owner, true);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await handleAchievementUpdate(env, command('/badges', owner));
    const markup = sent.at(-1)?.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] };
    expect(markup.inline_keyboard).toEqual([[{
      text: 'Повторить проверку членства', callback_data: 'ach:album:' + group,
    }]]);
    expect(JSON.stringify(sent.at(-1))).not.toContain('Закрытый тестовый чат');
    await handleAchievementUpdate(env, forward(markup.inline_keyboard[0][0].callback_data, owner));
    expect(sent.at(-1)?.text).toContain('Мой альбом · Закрытый тестовый чат');
  });

  it('identifies the full UTC week of a group award', async () => {
    await setGroupEnabled(database.db, group, true);
    database.sqlite.prepare(`INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result)
      VALUES(?,0,'rush-hour','2026-11-22','35 сообщений')`).run(group);
    await handleAchievementUpdate(env, command('/badges', group));
    expect(sent.at(-1)?.text).toContain('Час пик · 2026-11-16 — 2026-11-22 UTC\n35 сообщений');
  });

  it('shows admins an actionable hint when a pre-existing webhook discards callbacks', async () => {
    role = 'administrator';
    webhookFilters = ['message', 'my_chat_member'];
    await handleAchievementUpdate(env, command('/achievements', group));
    expect(sent.at(-1)?.text).toContain('Включить доставку нажатий на кнопки');
    expect(methods).not.toContain('setWebhook');
    webhookFilters.push('callback_query');
    await handleAchievementUpdate(env, command('/achievements', group));
    expect(sent.at(-1)?.text).not.toContain('Включить доставку нажатий на кнопки');
  });

  it('enrolls only after a personal confirmation and requires separate consent for replies', async () => {
    await setGroupEnabled(database.db, group, true);
    await handleAchievementUpdate(env, command('/start ach_223', owner));
    expect(database.rows('SELECT * FROM achievement_enrollments')).toEqual([]);
    expect(JSON.stringify(sent.at(-1))).toContain('Начать коллекцию');
    await handleAchievementUpdate(env, forward('ach:join:' + group, owner));
    expect(database.rows('SELECT user_id, enabled FROM achievement_enrollments')).toEqual([{ user_id: owner, enabled: 1 }]);
    expect(JSON.stringify(sent.at(-1))).toContain('Открыто 0 из 10');
    expect(JSON.stringify(sent.at(-1))).not.toContain('Поделиться');
  });

  it('lets a departed owner erase only their own confirmed album', async () => {
    await setGroupEnabled(database.db, group, true);
    await setEnrolled(database.db, group, owner, true);
    await setEnrolled(database.db, group, owner + 1, true);
    role = 'left';
    await handleAchievementUpdate(env, command('/badges', owner));
    expect(JSON.stringify(sent.at(-1))).not.toContain('Закрытый тестовый чат');
    await handleAchievementUpdate(env, forward('ach:delete:' + group, owner));
    const markup = sent.at(-1)?.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    await handleAchievementUpdate(env, forward(markup.inline_keyboard[0][0].callback_data, owner));
    expect(database.rows('SELECT user_id FROM achievement_enrollments')).toEqual([{ user_id: owner + 1 }]);
  });

  it('renders locked outlines in the private album and discloses only an explicitly shared earned result', async () => {
    vi.spyOn(badgeArtModule, 'badgeArt').mockResolvedValue({
      width: 1, height: 1, palette: Uint8Array.from([0, 0, 0, 199, 44, 25]), pixels: Uint8Array.of(1),
    });
    await setGroupEnabled(database.db, group, true);
    await setEnrolled(database.db, group, owner, true);
    const cb = forward('ach:preview:' + group + ':tomorrow', owner).callback_query;
    await handleAchievementUpdate(env, { callback_query: { ...cb, message: {
      ...cb.message, is_topic_message: true, message_thread_id: 312,
    } } });
    expect(photos[0].get('chat_id')).toBe(String(owner));
    expect(photos[0].get('message_thread_id')).toBeNull();
    expect(photos[0].get('caption')).toContain('Пока закрыто');
    await handleAchievementUpdate(env, forward('ach:share:' + group + ':tomorrow', owner));
    expect(photos).toHaveLength(1);
    database.sqlite.prepare(`INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result)
      VALUES(?,?,'tomorrow','2026-11-23','Два дня подряд')`).run(group, owner);
    await handleAchievementUpdate(env, forward('ach:share:' + group + ':tomorrow', owner));
    expect(photos[1].get('caption')).toBe('До завтра\n2026-11-23 UTC\nДва дня подряд');
    expect(photos[1].get('reply_markup')).toBeNull();
    expect(photos[1].get('photo')).toBeInstanceOf(Blob);
  });

  it('produces a valid, compressed weekly chart and captions that identify the actual peak date', async () => {
    const report = weeklyRules('2026-11-02', [], [{ day:'2026-11-04', hour:22, count:73 }], 5, 0, null);
    report.badges = [];
    const { png, caption } = await weeklyCard(report);
    const bytes = Buffer.from(png);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
    const idat = bytes.indexOf('IDAT');
    expect(inflateSync(bytes.subarray(idat + 4, idat + 4 + bytes.readUInt32BE(idat - 4))).length).toBe(705 * 400);
    expect(caption).toContain('2026-11-04 в 22:00 UTC');
    expect(png.length).toBeLessThan(100_000);
  });

  it('distinguishes a known Telegram rate limit from a lost response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({
      ok: false, error_code: 429, parameters: { retry_after: 7 },
    }, { status: 429 })).mockRejectedValueOnce(new Error('disconnect')));
    expect(await sendCard(env, group, new Uint8Array(), '')).toEqual({ status: 'retry', retryAfter: 7 });
    expect(await sendCard(env, group, new Uint8Array(), '')).toEqual({ status: 'unknown' });
  });
});
