import type { D1Database } from '@cloudflare/workers-types';
import { DAY } from '../../core/env';
import type { BadgeProgress } from './rules';
import {
  asProgress, CONVERSATION_BADGES, DUTCH_RUDDER, DUTCH_RUDDER_AWARD_SQL, DUTCH_RUDDER_RESULT, SCORE_SQL,
} from './social-score';

export { CONVERSATION_BADGES } from './social-score';

const RETENTION = 28 * DAY;
const now = () => Math.floor(Date.now() / 1000);
const contentFields = ['text', 'photo', 'video', 'voice', 'video_note', 'audio', 'document',
  'sticker', 'animation', 'poll', 'contact', 'location', 'venue', 'dice', 'game', 'paid_media'];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function identify(value: unknown) {
  const msg = record(value);
  const chat = record(msg.chat);
  const sender = record(msg.from);
  if ((chat.type !== 'group' && chat.type !== 'supergroup') ||
    typeof chat.id !== 'number' || !Number.isSafeInteger(chat.id) || !chat.id ||
    !positive(msg.message_id) || !positive(msg.date) ||
    !positive(sender.id) || sender.is_bot !== false || msg.sender_chat ||
    msg.forward_origin || msg.forward_date || msg.forward_from || msg.forward_from_chat ||
    msg.forward_sender_name || msg.is_automatic_forward || !contentFields.some(k => msg[k] != null)) return null;
  return { chat: chat.id, user: sender.id, id: msg.message_id, date: msg.date };
}

/** Activate or revoke the group's separately administered conversation shelf. */
export async function setConversationGroup(db: D1Database, chat: number, enabled: boolean, ts = now()) {
  if (enabled) {
    await db.prepare(`INSERT OR IGNORE INTO conversation_groups(chat_id,since)
      SELECT chat_id,? FROM achievement_groups WHERE chat_id=? AND enabled=1`).bind(ts, chat).run();
  } else {
    await db.batch(revokeConversationGroup(db, chat));
  }
}

/** Accept or withdraw a participant's reply observation consent for one group. */
export async function setConversationConsent(db: D1Database, chat: number, user: number, enabled: boolean, ts = now()) {
  if (enabled) {
    await db.prepare(`INSERT OR IGNORE INTO conversation_members(chat_id,user_id,since)
      SELECT e.chat_id,e.user_id,? FROM achievement_enrollments e
      JOIN conversation_groups g ON g.chat_id=e.chat_id
      WHERE e.chat_id=? AND e.user_id=? AND e.enabled=1`).bind(ts, chat, user).run();
  } else {
    await db.batch(revokeConversationMember(db, chat, user));
  }
}

/** Purge consent and temporary edges in the same transaction as a group pause. */
export function revokeConversationGroup(db: D1Database, chat: number, generation?: string) {
  const guard = generation === undefined ? '' : ` AND EXISTS (SELECT 1 FROM achievement_groups
    WHERE chat_id=? AND generation=? AND enabled=0)`;
  const params = generation === undefined ? [chat] : [chat, chat, generation];
  return ['conversation_messages', 'conversation_dirty', 'conversation_members', 'conversation_groups']
    .map(table => db.prepare(`DELETE FROM ${table} WHERE chat_id=?` + guard).bind(...params));
}

/** Purge both ends of the participant's edges before deleting or pausing their album. */
export function revokeConversationMember(db: D1Database, chat: number, user: number, generation?: string) {
  const guard = generation === undefined ? '' : ` AND EXISTS (SELECT 1 FROM achievement_enrollments
    WHERE chat_id=? AND user_id=? AND generation=?)`;
  const args = generation === undefined ? [chat, user] : [chat, user, chat, user, generation];
  return [
    'DELETE FROM conversation_messages WHERE chat_id=? AND user_id=?',
    'UPDATE conversation_messages SET parent_id=NULL,parent_user=NULL,parent_sent=NULL,verified=0 WHERE chat_id=? AND parent_user=?',
    'DELETE FROM conversation_dirty WHERE chat_id=? AND user_id=?',
    'DELETE FROM conversation_members WHERE chat_id=? AND user_id=?',
  ].map(sql => db.prepare(sql + guard).bind(...args));
}

/** Read observation start times (Unix seconds) for the group and private album. */
export async function getConversationStatus(db: D1Database, chat: number, user: number) {
  const row = await db.prepare(`SELECT g.since AS groupSince,m.since AS memberSince
    FROM conversation_groups g LEFT JOIN conversation_members m ON m.chat_id=g.chat_id AND m.user_id=?
    WHERE g.chat_id=?`).bind(user, chat).first<{ groupSince: number; memberSince: number | null }>();
  return row ?? { groupSince: null, memberSince: null };
}

/** Read rolling evidence for this member. Permanent unlocks reside in the shared album. */
export async function getConversationProgress(db: D1Database, chat: number, user: number, ts = now()): Promise<BadgeProgress[]> {
  const { results } = await db.prepare(`${SCORE_SQL}
    SELECT id,current,target,result FROM results`).bind(chat, user, ts - RETENTION, ts)
    .all<Omit<BadgeProgress, 'earned'>>();
  return results.map(asProgress);
}

async function flushPending(db: D1Database, chat: number | null, ts: number, limit: number) {
  const dirty = chat === null
    ? db.prepare('SELECT chat_id,user_id FROM conversation_dirty LIMIT ?').bind(limit)
    : db.prepare('SELECT chat_id,user_id FROM conversation_dirty WHERE chat_id=? LIMIT ?').bind(chat, limit);
  const { results } = await dirty.all<{ chat_id: number; user_id: number }>();
  for (const { chat_id, user_id } of results) {
    // Re-read consent and score inside the write transaction. A revoked, erased
    // or re-created album cannot be awarded based on an earlier in-memory read.
    await db.batch([
      db.prepare(`${SCORE_SQL}
        INSERT OR IGNORE INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result,rule_version)
        SELECT chat,owner,id,date(clock,'unixepoch'),result,1 FROM results,scope
        WHERE current>=target AND EXISTS (
          SELECT 1 FROM conversation_members WHERE chat_id=scope.chat AND user_id=scope.owner
        )`).bind(chat_id, user_id, ts - RETENTION, ts),
      db.prepare(DUTCH_RUDDER_AWARD_SQL).bind(chat_id, user_id, ts - RETENTION, ts, DUTCH_RUDDER_RESULT),
      db.prepare('DELETE FROM conversation_dirty WHERE chat_id=? AND user_id=?').bind(chat_id, user_id),
    ]);
  }
}

/** Observe only a new Telegram message delivered by the authenticated webhook. */
export async function observeConversationMessage(db: D1Database, value: unknown, ts = now()): Promise<void> {
  const msg = record(value);
  const child = identify(msg);
  if (!child || child.date < ts - RETENTION || child.date > ts) return;
  const eligible = await db.prepare(`SELECT 1 FROM conversation_members
    WHERE chat_id=? AND user_id=? AND since<=?`).bind(child.chat, child.user, child.date).first();
  if (!eligible) return;
  const candidate = !msg.external_reply && !msg.reply_to_story ? identify(msg.reply_to_message) : null;
  const parent = candidate && candidate.chat === child.chat && candidate.user !== child.user &&
    candidate.id < child.id && candidate.date <= child.date && candidate.date >= ts - RETENTION
    ? candidate : null;

  // Verify both enrollments at ingestion. Retain the child's own identity if
  // only the child consented, so later consenting people can reply to it.
  const insert = db.prepare(`INSERT OR IGNORE INTO conversation_messages
      (chat_id,message_id,user_id,sent_at,parent_id,parent_user,parent_sent)
    SELECT c.chat_id,?,c.user_id,?,
      CASE WHEN p.user_id IS NOT NULL THEN ? END, p.user_id,
      CASE WHEN p.user_id IS NOT NULL THEN ? END
    FROM conversation_members c LEFT JOIN conversation_members p
      ON p.chat_id=c.chat_id AND p.user_id=? AND p.since<=?
    WHERE c.chat_id=? AND c.user_id=? AND c.since<=?`)
    .bind(child.id, child.date, parent?.id ?? null, parent?.date ?? null,
      parent?.user ?? null, parent?.date ?? null, child.chat, child.user, child.date);
  // Validate the new edge or delayed children, then queue both endpoints in the
  // same transaction. Replaying a Telegram update recovers an interrupted flush.
  // A shared "chat AND (id OR parent)" predicate scans every retained row in
  // the chat on SQLite. Enumerate children in the parent index, then use PKs.
  const touched = `chat_id=? AND message_id IN (SELECT ? UNION ALL
    SELECT message_id FROM conversation_messages WHERE chat_id=? AND parent_id=?)`;
  const key = [child.chat, child.id, child.chat, child.id];
  const verify = db.prepare(`UPDATE conversation_messages AS c SET verified=1
    WHERE ${touched} AND verified=0 AND parent_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM conversation_messages p WHERE p.chat_id=c.chat_id
        AND p.message_id=c.parent_id AND p.user_id=c.parent_user AND p.sent_at=c.parent_sent)`).bind(...key);
  const badgeIds = [...CONVERSATION_BADGES.map(badge => badge.id), DUTCH_RUDDER.id];
  // A new outsider reply can finish a pair's branch even when the reply's
  // immediate parent has already earned the secret badge with someone else.
  const enqueue = db.prepare(`WITH updated AS MATERIALIZED (
      SELECT * FROM conversation_messages WHERE ${touched} AND verified=1
    )
    INSERT OR IGNORE INTO conversation_dirty(chat_id,user_id)
    SELECT chat_id,user_id FROM (
      SELECT chat_id,user_id FROM updated
      UNION
      SELECT chat_id,parent_user FROM updated
      UNION
      SELECT u.chat_id,p.parent_user FROM updated u JOIN conversation_messages p
        ON p.chat_id=u.chat_id AND p.message_id=u.parent_id
      WHERE p.verified=1
    ) endpoints WHERE (SELECT COUNT(*) FROM achievement_awards a
      WHERE a.chat_id=endpoints.chat_id AND a.user_id=endpoints.user_id
        AND a.badge_id IN (${badgeIds.map(() => '?').join(',')})) < ?`)
    .bind(...key, ...badgeIds, badgeIds.length);
  const [, links, queued] = await db.batch([insert, verify, enqueue]);
  if (links.meta.changes || queued.meta.changes || parent) await flushPending(db, child.chat, ts, 8);
}

/** Finalize queued scores and sweep expired reply metadata from quiet groups. */
export async function pruneConversationEvidence(db: D1Database, ts = now()) {
  // Cleanup must still succeed when evaluation of a pending award fails.
  await db.prepare('DELETE FROM conversation_messages WHERE sent_at<?').bind(ts - RETENTION).run();
  await flushPending(db, null, ts, 8);
}
