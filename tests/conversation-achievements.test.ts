import { beforeEach, describe, expect, it } from 'vitest';
import { createRealD1 } from './helpers/real-d1';
import { setEnrolled, setGroupEnabled } from '../src/features/achievements/repository';
import {
  getConversationProgress, getConversationStatus, observeConversationMessage, pruneConversationEvidence,
  setConversationConsent, setConversationGroup,
} from '../src/features/achievements/social';

const chat = -123;
const start = 1_800_000_000;
const day = 86_400;
let store: ReturnType<typeof createRealD1>;

function message(id: number, user: number, when: number, parent?: ReturnType<typeof basic>) {
  return { ...basic(id, user, when), reply_to_message: parent };
}
function basic(message_id: number, user: number, delay: number) {
  return {
    chat: { id: chat, type: 'supergroup' }, message_id, date: start + delay,
    from: { id: user, is_bot: false }, voice: { duration: 2 }
  };
}
async function observe(value: ReturnType<typeof basic>, time = value.date) {
  await observeConversationMessage(store.db, value, time);
}
function winners(badge: string) {
  return store.rows<{ user_id: number }>('SELECT user_id FROM achievement_awards WHERE badge_id=? ORDER BY user_id', [badge])
    .map(row => row.user_id);
}

beforeEach(async () => {
  store = createRealD1();
  store.sqlite.prepare('INSERT INTO achievement_groups(chat_id,enabled,start_day,generation) VALUES (?,1,?,?)').run(chat, '2026-01-01', 'g');
  await setConversationGroup(store.db, chat, true, start);
  for (const user of [1, 2, 3, 4, 5]) {
    store.sqlite.prepare(`INSERT INTO achievement_enrollments(chat_id,user_id,enabled,start_day,generation)
      VALUES (?,?,1,'2026-01-01','e')`).run(chat, user);
    await setConversationConsent(store.db, chat, user, true, start);
  }
});

describe('conversation achievements', () => {
  it('awards both players on a four-message chain, including reordered and replayed updates', async () => {
    const a = message(1, 1, 0), b = message(2, 2, 1, a);
    const c = message(3, 1, 2, b), d = message(4, 2, day, c);
    for (const m of [d, c, b]) await observe(m, d.date);
    expect(winners('ping-pong')).toEqual([]);
    await observe(a, d.date);
    await observe(d, d.date);
    expect(winners('ping-pong')).toEqual([1, 2]);
    expect((await getConversationProgress(store.db, chat, 1, d.date))[0].current).toBe(4);
  });

  it('excludes chains longer than 24 hours and chains through an unrelated third person', async () => {
    const a = message(1, 1, 0), b = message(2, 2, 2, a), c = message(3, 1, 3, b);
    for (const m of [a, b, c, message(4, 3, 4, c), message(5, 2, day + 1, c)]) await observe(m);
    expect(winners('ping-pong')).toEqual([]);
  });

  it('awards the author for three distinct direct responders at the 48h boundary', async () => {
    const a = message(1, 1, 0);
    for (const m of [a, message(2, 2, 1, a), message(3, 2, 2, a), message(4, 3, 3, a),
      message(5, 1, 4, a), message(6, 4, 2 * day + 1, a)]) await observe(m);
    expect(winners('spark')).toEqual([]);
    await observe(message(7, 4, 2 * day, a), start + 2 * day + 1);
    expect(winners('spark')).toEqual([1]);
  });

  it('counts distinct counterparts who directly answered the owner, including a closed 28-day window', async () => {
    let last: ReturnType<typeof basic> | undefined;
    for (const [idx, partner, time] of [[0, 2, 0], [1, 3, day], [2, 2, day * 2], [3, 4, 28 * day - 2]]) {
      const root = message(idx * 3 + 1, partner, time), mid = message(idx * 3 + 2, 1, time, root);
      const answer = message(idx * 3 + 3, partner, time + 2, mid);
      for (const m of [root, mid, answer]) await observe(m);
      last = answer;
    }
    expect(winners('connector')).toEqual([1]);
    expect((await getConversationProgress(store.db, chat, 1, last!.date)).find(x => x.id === 'connector')?.current).toBe(3);
  });

  it('resumes a thread exactly seven days later and acknowledges within a day', async () => {
    const a = message(1, 1, 0), b = message(2, 2, day * 7, a), c = message(3, 1, day * 8, b);
    for (const m of [a, b, c]) await observe(m);
    expect(winners('to-be-continued')).toEqual([1, 2]);
  });

  it('does not attribute foreign, anonymous, self or bot replies to an author', async () => {
    const a = message(1, 1, 0), b = message(2, 2, 1, a);
    await observe(a);
    for (const bad of [
      { ...b, sender_chat: { id: chat } }, { ...b, from: { id: 2, is_bot: true } },
      { ...b, external_reply: {} }, { ...b, reply_to_message: { ...a, chat: { id: -444, type: 'group' } } },
      { ...b, forward_origin: {} },
    ]) await observeConversationMessage(store.db, bad, b.date);
    expect(store.rows('SELECT * FROM conversation_messages WHERE verified=1')).toHaveLength(0);
  });

  it('discards pre-consent activity and purges outgoing and incoming evidence on revocation', async () => {
    const a = message(1, 1, 0), b = message(2, 2, 1, a);
    await observe(a); await observe(b);
    await setConversationConsent(store.db, chat, 1, false, start + 2);
    expect(store.rows('SELECT * FROM conversation_messages WHERE user_id=1 OR parent_user=1')).toHaveLength(0);
    await setConversationConsent(store.db, chat, 1, true, start + 3);
    await observe(a, start + 3);
    expect(store.rows('SELECT * FROM conversation_messages WHERE user_id=1')).toHaveLength(0);
    await setEnrolled(store.db, chat, 2, false);
    expect((await getConversationStatus(store.db, chat, 2)).memberSince).toBeNull();
    await setGroupEnabled(store.db, chat, false);
    expect(await getConversationStatus(store.db, chat, 1)).toEqual({ groupSince: null, memberSince: null });
    expect(store.rows('SELECT * FROM conversation_messages')).toHaveLength(0);
  });

  it('sweeps retained messages after 28 days and only keeps aggregate unlock results', async () => {
    const root = message(1, 1, 0);
    await observe(root);
    for (let u = 2; u <= 4; u++) await observe(message(u, u, 1, root));
    await pruneConversationEvidence(store.db, start + 28 * day + 2);
    expect(store.rows('SELECT * FROM conversation_messages')).toHaveLength(0);
    expect(winners('spark')).toEqual([1]);
  });
});
