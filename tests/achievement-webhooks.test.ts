import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@cloudflare/workers-types';
import { DAY, type Env } from '../src/core/env';
import worker from '../src/index';
import { retryComebackReplies } from '../src/features/achievements/comeback';
import { setEnrolled, setGroupEnabled } from '../src/features/achievements/repository';
import { setConversationConsent, setConversationGroup } from '../src/features/achievements/social';
import { createRealD1 } from './helpers/real-d1';

const group = -135;
const actor = { id: 42, is_bot: false };
const groupChat = { id: group, type: 'supergroup' };

function fixture(path: string) {
  const store = createRealD1();
  const historyPut = vi.fn();
  const counterFetch = vi.fn(async () => Response.json({ ok: true }));
  const env = {
    TOKEN: 'test-token', SECRET: 'test-secret', RAW_MESSAGE_STORAGE_MODE: 'stats_only',
    TELEGRAM_BOT_USERNAME: 'test_bot', DB: store.db, HISTORY: { put: historyPut, get: vi.fn() },
    SUMMARY_PROVIDER: 'mock', AI: { run: vi.fn() },
    COUNTERS_DO: { idFromName: vi.fn(), get: () => ({ fetch: counterFetch }) },
    ENABLE_CONVERSATION_ACHIEVEMENTS: 'true', ENABLE_ACTIVITY_TRACKING: 'true',
    ENABLE_CRIMINAL_ANALYSIS: 'false', ENABLE_PROFANITY_ANALYSIS: 'false',
  } as unknown as Env;
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const method = new URL(url).pathname.split('/').pop()!;
    const payload = init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(String(init.body));
    calls.push({ method, payload });
    const result = method === 'getChatMember' ? { status: 'administrator' }
      : method === 'sendPhoto' ? { message_id: 350 }
      : method === 'getMyCommands' ? [{ command: 'dashboard' }] : true;
    return Response.json({ ok: true, result });
  }));
  async function send(update: object, secret = 'test-secret') {
    const tasks: Promise<unknown>[] = [];
    const ctx = { waitUntil(p: Promise<unknown>) { tasks.push(p); } } as ExecutionContext;
    const response = await worker.fetch(new Request('https://bot.example' + path, {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify(update),
    }), env, ctx);
    await Promise.all(tasks);
    return response.status;
  }
  return { store, env, calls, send, historyPut, counterFetch };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('comeback badge', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const gap = 30 * DAY;
  const text = (message_id: number, date: number) => ({ message_id, date, chat: groupChat, from: actor, text: 'Привет!' });
  const callback = (action: string) => ({ callback_query: { id: action, data: `ach:${action}:${group}`, from: actor,
    message: { chat: { id: actor.id, type: 'private' }, message_id: 1, text: 'Альбом' } } });
  const seedProfile = (store: ReturnType<typeof createRealD1>, date: number, chat = group) => store.sqlite.prepare(
    "INSERT INTO stats_chat_user_profile(chat_id,user_id,username,last_message_ts) VALUES (?,?,'test',?)",
  ).run(chat, actor.id, date);

  async function setup(enrolled = true) {
    const result = fixture('/telegram/webhook');
    const past = new Date((now() - 100 * DAY) * 1000);
    await setGroupEnabled(result.store.db, group, true, past);
    if (enrolled) await setEnrolled(result.store.db, group, actor.id, true, past);
    return result;
  }

  it('requires earlier group activity, advances after media and awards at exactly 30 days', async () => {
    const { store, send, calls } = await setup(false);
    const start = now() - 65 * DAY;
    seedProfile(store, start - gap, group - 1);
    expect(await send({ message: text(1, start) })).toBe(200);
    expect(store.rows('SELECT user_id,enabled FROM achievement_enrollments')).toEqual([{ user_id: actor.id, enabled: 1 }]);
    expect(store.rows('SELECT * FROM achievement_awards')).toEqual([]);
    const mediaDate = start + gap - 1;
    expect(await send({ message: { ...text(2, mediaDate), text: undefined, sticker: { file_id: 'dummy' } } })).toBe(200);
    expect(store.rows('SELECT * FROM achievement_awards')).toEqual([]);
    expect(await send({ message: text(1, start) })).toBe(200);
    expect(await send({ message: text(3, mediaDate + gap) })).toBe(200);
    expect(store.rows('SELECT badge_id,result FROM achievement_awards'))
      .toEqual([{ badge_id: 'comeback', result: '30 дн. тишины' }]);
    expect(calls.filter(call => call.method === 'sendPhoto')).toHaveLength(1);
  });

  it('uses existing stats and replies once in the same topic by default', async () => {
    const { store, send, calls } = await setup();
    seedProfile(store, now() - 32 * DAY);
    expect(await send(callback('album'))).toBe(200);
    expect(JSON.stringify(calls.at(-1)?.payload)).toContain(`ach:comeback-off:${group}`);
    const returning = { ...text(54, now() + 1), text: undefined, photo: [{ file_id: 'dummy' }],
      is_topic_message: true, message_thread_id: 300 };
    const batch = store.db.batch.bind(store.db);
    let arrivals = 0;
    let release!: () => void;
    const bothPending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(store.db, 'batch').mockImplementation(async statements => {
      if (++arrivals === 2) release();
      await bothPending;
      return batch(statements);
    });
    expect(await Promise.all([send({ message: returning }), send({ message: returning })])).toEqual([200, 200]);
    expect(arrivals).toBe(2);
    expect(await send({ message: text(55, now()) })).toBe(200);
    expect(store.rows('SELECT badge_id,user_id FROM achievement_awards')).toEqual([{ badge_id: 'comeback', user_id: actor.id }]);
    const photos = calls.filter(call => call.method === 'sendPhoto');
    expect(photos).toHaveLength(1);
    expect(photos[0].payload).toMatchObject({
      chat_id: String(group), message_thread_id: '300', caption: 'Восстание из ридонли\nМесяц тишины. И тут — тыдыщ.',
      reply_parameters: JSON.stringify({ message_id: 54, allow_sending_without_reply: false }),
      photo: expect.objectContaining({ type: 'image/png' }),
    });
  });

  it('keeps recording messages after a comeback batch failure and skips the batch for inactive groups', async () => {
    const { store, send, counterFetch } = await setup();
    seedProfile(store, now() - 32 * DAY);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const batch = vi.spyOn(store.db, 'batch').mockRejectedValueOnce(new Error('unavailable'));
    const inactive = { ...text(1, now()), chat: { ...groupChat, id: group - 1 } };
    expect(await send({ message: inactive })).toBe(200);
    expect(batch).not.toHaveBeenCalled();
    expect(await send({ message: text(2, now()) })).toBe(200);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(counterFetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('Achievement activity unavailable', { op: 'observeAchievementActivity' });
    expect(store.rows('SELECT * FROM achievement_awards')).toEqual([]);
  });

  it('keeps the badge private after the member turns the announcement off', async () => {
    const { store, send, calls } = await setup();
    const time = now();
    seedProfile(store, time - 32 * DAY);
    await send(callback('comeback-off'));
    await send(callback('album'));
    expect(JSON.stringify(calls.at(-1)?.payload)).toContain(`ach:comeback-on:${group}`);
    expect(await send({ message: text(71, time) })).toBe(200);
    expect(store.rows('SELECT badge_id,comeback_reply_at FROM achievement_awards'))
      .toEqual([{ badge_id: 'comeback', comeback_reply_at: null }]);
    expect(calls.filter(call => call.method === 'sendPhoto')).toEqual([]);
  });

  it('uses historical group activity after an album pause and keeps a muted announcement off', async () => {
    const { store, send, calls } = await setup();
    const time = now();
    seedProfile(store, time - 63 * DAY);
    await send(callback('comeback-off'));
    await send(callback('pause'));
    await send(callback('comeback-on'));
    await setEnrolled(store.db, group, actor.id, true, new Date((time - 32 * DAY) * 1000));
    expect(await send({ message: text(61, time) })).toBe(200);
    expect(store.rows('SELECT badge_id,comeback_reply_at FROM achievement_awards'))
      .toEqual([{ badge_id: 'comeback', comeback_reply_at: null }]);
    expect(store.rows('SELECT comeback_muted FROM achievement_enrollments')).toEqual([{ comeback_muted: 1 }]);
    expect(calls.filter(call => call.method === 'sendPhoto')).toEqual([]);
  });

  it('automatically awards a return using historical stats before any album has been opened', async () => {
    const { store, send, calls } = await setup(false);
    const time = now();
    seedProfile(store, time - 36 * DAY);
    expect(await send({ message: text(62, time) })).toBe(200);
    expect(store.rows('SELECT user_id,badge_id,result FROM achievement_awards'))
      .toEqual([{ user_id: actor.id, badge_id: 'comeback', result: '36 дн. тишины' }]);
    expect(calls.filter(call => call.method === 'sendPhoto')).toHaveLength(1);
  });

  it('starts daily scoring at the next UTC midnight when an earlier message is delivered late', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T13:00:00Z'));
    const { store, send } = fixture('/telegram/webhook');
    await setGroupEnabled(store.db, group, true, new Date('2026-11-25T12:00:00Z'));
    expect(await send({ message: text(63, now() - 2 * 3600) })).toBe(200);
    expect(store.rows('SELECT user_id,start_day FROM achievement_enrollments'))
      .toEqual([{ user_id: actor.id, start_day: '2026-11-26' }]);
    expect(store.rows('SELECT * FROM achievement_awards')).toEqual([]);
  });

  it('resumes members after a group reactivation and keeps personal pauses', async () => {
    const { store, send } = await setup(false);
    const secondAuthor = { ...actor, id: actor.id + 1 };
    await send({ message: text(64, now()) });
    await send({ message: { ...text(65, now()), from: secondAuthor } });
    await setEnrolled(store.db, group, secondAuthor.id, false);
    await setGroupEnabled(store.db, group, false);
    await setGroupEnabled(store.db, group, true);
    expect(store.rows('SELECT user_id,enabled FROM achievement_enrollments ORDER BY user_id'))
      .toEqual([{ user_id: actor.id, enabled: 1 }, { user_id: secondAuthor.id, enabled: 0 }]);
  });

  it('keeps a personal pause requested while the group is disabled', async () => {
    const { store, send, calls } = await setup();
    await setGroupEnabled(store.db, group, false);
    await send(callback('album'));
    expect(JSON.stringify(calls.at(-1)?.payload)).toContain('Оставить на паузе');
    await send(callback('pause'));
    await setGroupEnabled(store.db, group, true);
    expect(store.rows('SELECT enabled,paused_by_group FROM achievement_enrollments'))
      .toEqual([{ enabled: 0, paused_by_group: 0 }]);
  });

  it.each(['on group reactivation', 'on new activity'])('recognizes legacy group pauses %s', async trigger => {
    const { store, send } = await setup();
    const other = actor.id + 1;
    await setEnrolled(store.db, group, other, true);
    await setEnrolled(store.db, group, other, false);
    store.sqlite.prepare(`UPDATE achievement_enrollments SET enabled=0,paused_by_group=0,
      generation=hex(randomblob(16)),last_day=NULL,progress_json='[]' WHERE chat_id=? AND user_id=?`).run(group, actor.id);
    if (trigger === 'on group reactivation') {
      store.sqlite.prepare('UPDATE achievement_groups SET enabled=0 WHERE chat_id=?').run(group);
      await setGroupEnabled(store.db, group, true);
    } else {
      expect(await send({ message: text(66, now()) })).toBe(200);
      expect(await send({ message: { ...text(67, now()), from: { ...actor, id: other } } })).toBe(200);
    }
    expect(store.rows('SELECT user_id,enabled FROM achievement_enrollments ORDER BY user_id'))
      .toEqual([{ user_id: actor.id, enabled: 1 }, { user_id: other, enabled: 0 }]);
  });

  it('ignores commands in media captions', async () => {
    const { store, send } = await setup();
    seedProfile(store, now() - 32 * DAY);
    const media = { ...text(72, now()), text: undefined, caption: '/help', photo: [{ file_id: 'dummy' }] };
    expect(await send({ message: media })).toBe(200);
    expect(store.rows('SELECT * FROM achievement_awards')).toEqual([]);
  });

  it('hides the announcement switch and rejects a stale re-enable when activity tracking is off', async () => {
    const { env, store, send, calls } = await setup();
    await send(callback('comeback-off'));
    env.ENABLE_ACTIVITY_TRACKING = 'false';
    for (const action of ['album', 'comeback-consent', 'comeback-on']) {
      expect(await send(callback(action))).toBe(200);
      expect(JSON.stringify(calls.at(-1)?.payload)).not.toMatch(/comeback-/);
    }
    expect(store.rows('SELECT comeback_muted FROM achievement_enrollments')).toEqual([{ comeback_muted: 1 }]);
  });

  it('retries a confirmed rate limit only when due and does not replay an ambiguous response', async () => {
    const { env, store, send } = await setup();
    seedProfile(store, now() - 32 * DAY);
    await send(callback('comeback-on'));
    const telegram = vi.mocked(fetch);
    telegram.mockClear().mockResolvedValueOnce(Response.json({ ok: false, error_code: 429,
      parameters: { retry_after: 60 } }, { status: 429 }));
    expect(await send({ message: text(91, now()) })).toBe(200);
    const [{ comeback_reply_at: due }] = store.rows<{ comeback_reply_at: number }>(
      'SELECT comeback_reply_at FROM achievement_awards',
    );
    expect(due).toBeGreaterThan(now());
    await retryComebackReplies(env, due - 1);
    expect(telegram).toHaveBeenCalledTimes(1);
    telegram.mockRejectedValueOnce(new Error('response lost'));
    await Promise.all([retryComebackReplies(env, due), retryComebackReplies(env, due)]);
    await retryComebackReplies(env, due + 60);
    expect(telegram).toHaveBeenCalledTimes(2);
    expect(store.rows('SELECT comeback_reply_at,comeback_reply_json FROM achievement_awards'))
      .toEqual([{ comeback_reply_at: null, comeback_reply_json: null }]);
  });

  it('cancels a pending retry when the winner turns off announcements', async () => {
    const { env, store, send, calls } = await setup();
    seedProfile(store, now() - 32 * DAY);
    await send(callback('comeback-on'));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: false, error_code: 429 }, { status: 429 }));
    expect(await send({ message: text(92, now()) })).toBe(200);
    const [{ comeback_reply_at: due }] = store.rows<{ comeback_reply_at: number }>(
      'SELECT comeback_reply_at FROM achievement_awards',
    );
    expect(due).toBeGreaterThan(now());
    await send(callback('album'));
    expect(JSON.stringify(calls.at(-1)?.payload)).toContain(`ach:comeback-off:${group}`);
    await send(callback('comeback-off'));
    await send(callback('comeback-on'));
    await retryComebackReplies(env, due);
    expect(calls.filter(call => call.method === 'sendPhoto')).toEqual([]);
    expect(store.rows('SELECT badge_id,comeback_reply_at FROM achievement_awards'))
      .toEqual([{ badge_id: 'comeback', comeback_reply_at: null }]);
  });
});

describe.each(['/telegram/webhook', '/tg/test-token/webhook'])('achievement dispatch on %s', path => {
  it('authenticates before executing an admin button and produces one Telegram reply', async () => {
    const { store, calls, send, historyPut } = fixture(path);
    const update = { callback_query: { id: 'callback', data: 'ach:on:' + group, from: actor,
      message: { chat: groupChat, message_id: 3, text: 'Коллекция чата', is_topic_message: true, message_thread_id: 312 } } };
    expect(await send(update, 'wrong')).toBe(403);
    expect(calls).toHaveLength(0);
    expect(await send(update)).toBe(200);
    expect(store.rows('SELECT enabled FROM achievement_groups WHERE chat_id=?', [group])).toEqual([{ enabled: 1 }]);
    expect(calls.filter(c => c.method === 'answerCallbackQuery')).toHaveLength(1);
    expect(calls.filter(c => c.method === 'sendMessage')).toHaveLength(1);
    expect(calls.find(c => c.method === 'sendMessage')?.payload.message_thread_id).toBe(312);
    expect(historyPut).not.toHaveBeenCalled();
  });

  it('processes photo-only direct replies before text filtering and deduplicates a replay', async () => {
    const { store, calls, send, counterFetch, historyPut } = fixture(path);
    const start = Math.floor(Date.now() / 1000) - 100;
    await setGroupEnabled(store.db, group, true);
    await setConversationGroup(store.db, group, true, start);
    for (const user of [1, 2, 3, 4]) {
      await setEnrolled(store.db, group, user, true);
      await setConversationConsent(store.db, group, user, true, start);
    }
    function photo(id: number) {
      return { message_id: id, date: start + id, chat: groupChat, from: { id, is_bot: false },
        photo: [{ file_id: 'dummy', width: 10, height: 10 }] };
    }
    const root = photo(1);
    expect(await send({ message: root })).toBe(200);
    for (const id of [2, 3, 4, 4]) {
      expect(await send({ message: { ...photo(id), reply_to_message: root } })).toBe(200);
    }
    expect(store.rows('SELECT COUNT(*) n, SUM(verified) edges FROM conversation_messages'))
      .toEqual([{ n: 4, edges: 3 }]);
    expect(store.rows('SELECT user_id,badge_id FROM achievement_awards')).toEqual([{ user_id: 1, badge_id: 'spark' }]);
    expect(counterFetch).not.toHaveBeenCalled();
    expect(historyPut).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('keeps ordinary private /start on the existing dashboard route', async () => {
    const { env, calls, send } = fixture(path);
    env.ENABLE_ACTIVITY_TRACKING = 'false';
    expect(await send({ message: { text: '/start', chat: { id: actor.id, type: 'private' },
      from: actor, message_id: 1, date: Math.floor(Date.now() / 1000) } })).toBe(200);
    const messages = calls.filter(c => c.method === 'sendMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0].payload).toMatchObject({ chat_id: actor.id, reply_markup: {
      inline_keyboard: [[{ url: 'https://bot.example/admin' }]],
    } });
  });

  it('requests redelivery before downstream processing when reply observation fails', async () => {
    const { store, send, counterFetch } = fixture(path);
    const prepare = store.db.prepare.bind(store.db);
    const spy = vi.spyOn(store.db, 'prepare').mockImplementation(sql => {
      if (sql.includes('FROM conversation_members')) throw new Error('temporary D1 failure');
      return prepare(sql);
    });
    const event = { message: { message_id: 71, chat: groupChat, from: actor,
      date: Math.floor(Date.now() / 1000), photo: [{ file_id: 'dummy' }] } };
    expect(await send(event)).toBe(503);
    expect(counterFetch).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(await send(event)).toBe(200);
  });

  it('pauses albums and removes consent atomically on removal, with ordered replay after reinstall', async () => {
    const { store, send } = fixture(path);
    const membership = (date: number, update_id: number, status: 'member' | 'kicked', chat = group) => ({
      update_id, my_chat_member: { date, chat: { ...groupChat, id: chat },
        new_chat_member: { status }, old_chat_member: { status: status === 'member' ? 'left' : 'member' } },
    });
    expect(await send(membership(1, 1, 'kicked', -987))).toBe(200);
    expect(store.rows('SELECT * FROM achievement_groups')).toEqual([]);
    await send(membership(100, 2, 'member'));
    await setGroupEnabled(store.db, group, true);
    await setEnrolled(store.db, group, actor.id, true);
    await setConversationGroup(store.db, group, true);
    await setConversationConsent(store.db, group, actor.id, true);
    store.sqlite.prepare(`INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result)
      VALUES (?,?,'tomorrow','2026-01-01','2 дня')`).run(group, actor.id);
    store.sqlite.prepare(`INSERT INTO achievement_reports(chat_id,week,report_json)
      VALUES (?,'2026-01-05','{}')`).run(group);

    // Simulate an interrupted cleanup. The membership write must also roll
    // back, allowing Telegram's same update_id to complete the revocation.
    store.sqlite.exec(`CREATE TRIGGER test_fail_revoke BEFORE DELETE ON conversation_members
      BEGIN SELECT RAISE(ABORT, 'interrupted'); END`);
    await expect(send(membership(200, 3, 'kicked'))).rejects.toThrow('interrupted');
    expect(store.rows('SELECT enabled FROM achievement_groups')).toEqual([{ enabled: 1 }]);
    store.sqlite.exec('DROP TRIGGER test_fail_revoke');
    expect(await send(membership(200, 3, 'kicked'))).toBe(200);
    await setGroupEnabled(store.db, group, true); // stale admin interaction cannot reopen it
    expect(store.rows('SELECT enabled FROM achievement_groups')).toEqual([{ enabled: 0 }]);
    expect(store.rows('SELECT enabled FROM achievement_enrollments')).toEqual([{ enabled: 0 }]);
    expect(store.rows('SELECT * FROM conversation_members')).toEqual([]);
    expect(store.rows('SELECT badge_id FROM achievement_awards')).toEqual([{ badge_id: 'tomorrow' }]);
    expect(store.rows('SELECT state FROM achievement_reports')).toEqual([{ state: 'cancelled' }]);

    expect(await send(membership(200, 4, 'member'))).toBe(200);
    expect(store.rows('SELECT enabled FROM achievement_groups')).toEqual([{ enabled: 0 }]);
    await setGroupEnabled(store.db, group, true);
    await setEnrolled(store.db, group, actor.id, true);
    await setConversationGroup(store.db, group, true);
    await setConversationConsent(store.db, group, actor.id, true);
    expect(await send(membership(200, 3, 'kicked'))).toBe(200);
    expect(store.rows('SELECT enabled FROM achievement_groups')).toEqual([{ enabled: 1 }]);
    expect(store.rows('SELECT user_id FROM conversation_members')).toEqual([{ user_id: actor.id }]);
  });
});
