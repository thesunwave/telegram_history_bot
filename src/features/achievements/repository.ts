import type { D1Database } from '@cloudflare/workers-types';
import { BOT_MEMBERSHIP_PREFIX } from '../../core/consts';
import { revokeConversationGroup, revokeConversationMember } from './social';
import { eligibleDay, mondayOf, shiftDay } from './calendar';
import { COMEBACK, type BadgeProgress } from './rules';

export interface GroupState { enabled: number; start_day: string; generation: string }
export interface Enrollment extends GroupState {
  last_day: string | null;
  progress_json: string;
  comeback_replies_since: number | null;
  comeback_muted: number;
  group_pause: number;
}
export interface Award { badge_id: string; earned_day: string; result: string }

// Before paused_by_group existed, only group pauses wrote a 32-character hex
// generation. A personal pause wrote a hyphenated UUID.
function groupPause(prefix = '') {
  const generation = prefix + 'generation';
  return `${prefix}enabled=0 AND (${prefix}paused_by_group=1 OR
    (length(${generation})=32 AND ${generation} NOT GLOB '*[^0-9A-F]*'))`;
}

export function getGroup(db: D1Database, chatId: number) {
  return db.prepare('SELECT enabled,start_day,generation FROM achievement_groups WHERE chat_id=?')
    .bind(chatId).first<GroupState>();
}

/** Clear pending work and consent atomically with the group pause that owns this generation. */
export function pauseGroupDependents(db: D1Database, chatId: number, generation?: string) {
  const guard = generation === undefined ? '' : ` AND EXISTS (SELECT 1 FROM achievement_groups
    WHERE chat_id=? AND generation=? AND enabled=0)`;
  const params = generation === undefined ? [chatId] : [chatId, chatId, generation];
  return [
    ...revokeConversationGroup(db, chatId, generation),
    db.prepare(`UPDATE achievement_enrollments SET enabled=0,paused_by_group=1,progress_json='[]',
      last_day=NULL, comeback_last_message_ts=NULL, comeback_replies_since=NULL,
      generation=hex(randomblob(16)) WHERE chat_id=? AND enabled=1` + guard).bind(...params),
    db.prepare(`UPDATE achievement_awards SET announce_at=NULL
      WHERE chat_id=? AND announce_at IS NOT NULL` + guard).bind(...params),
    db.prepare(`UPDATE achievement_reports SET state='cancelled'
      WHERE chat_id=? AND state IN ('ready','sending')` + guard).bind(...params),
  ];
}

/** Idempotent settings toggle. Each genuine transition invalidates stale in-flight jobs. */
export async function setGroupEnabled(db: D1Database, chatId: number, enabled: boolean, now = new Date()) {
  const start = eligibleDay(now);
  const monday = mondayOf(start);
  const generation = crypto.randomUUID();
  const update = db.prepare(`INSERT INTO achievement_groups(chat_id,enabled,start_day,generation)
    SELECT ?,?,?,? WHERE ?=0 OR NOT EXISTS (
      SELECT 1 FROM app_settings WHERE scope=? AND json_extract(settings_json,'$.active')=0
    ) ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled,
    start_day=excluded.start_day,generation=excluded.generation WHERE enabled<>excluded.enabled`)
    .bind(chatId, Number(enabled), start === monday ? start : shiftDay(monday, 7), generation,
      Number(enabled), BOT_MEMBERSHIP_PREFIX + chatId);
  const changes = [update];
  if (enabled) {
    changes.push(db.prepare(`UPDATE achievement_enrollments SET enabled=1,paused_by_group=0,start_day=?,
      generation=hex(randomblob(16)),next_album_check=0 WHERE chat_id=? AND ${groupPause()}
      AND EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1 AND generation=?)`)
      .bind(start, chatId, chatId, generation));
  } else changes.push(...pauseGroupDependents(db, chatId));
  await db.batch(changes);
  return getGroup(db, chatId);
}
export function getEnrollment(db: D1Database, chatId: number, userId: number) {
  return db.prepare(`SELECT *,(${groupPause()}) AS group_pause FROM achievement_enrollments WHERE chat_id=? AND user_id=?`)
    .bind(chatId, userId).first<Enrollment>();
}

/** Read the sender's participation and comeback award only in enabled groups. */
export function getParticipationForActivity(db: D1Database, chatId: number, userId: number) {
  return db.prepare(`SELECT e.enabled AS enrolled,(${groupPause('e.')}) AS group_pause,
    EXISTS (SELECT 1 FROM achievement_awards WHERE chat_id=g.chat_id AND user_id=? AND badge_id=?) AS earned
    FROM achievement_groups g LEFT JOIN achievement_enrollments e ON e.chat_id=g.chat_id AND e.user_id=?
    WHERE g.chat_id=? AND g.enabled=1`).bind(userId, COMEBACK.id, userId, chatId)
    .first<{ enrolled: number | null; group_pause: number | null; earned: number }>();
}

/** Start daily scoring at the next full UTC day after receipt, even for delayed messages. */
export function autoEnrollParticipant(db: D1Database, chatId: number, userId: number, now = new Date()) {
  return db.prepare(`INSERT INTO achievement_enrollments(chat_id,user_id,enabled,start_day,generation)
    SELECT ?,?,1,?,?
    WHERE EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1)
    ON CONFLICT(chat_id,user_id) DO UPDATE SET enabled=1,paused_by_group=0,start_day=excluded.start_day,
      generation=excluded.generation,next_album_check=0 WHERE ${groupPause('achievement_enrollments.')}`)
    .bind(chatId, userId, eligibleDay(now), crypto.randomUUID(), chatId);
}

/** Resume only an existing collection so an old button cannot recreate an erased album. */
export async function resumeParticipant(db: D1Database, chatId: number, userId: number, now = new Date()) {
  await db.prepare(`UPDATE achievement_enrollments SET enabled=1,paused_by_group=0,start_day=?,
    generation=?,next_album_check=0,last_day=NULL,progress_json='[]' WHERE chat_id=? AND user_id=? AND enabled=0
    AND EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1)`)
    .bind(eligibleDay(now), crypto.randomUUID(), chatId, userId, chatId).run();
}

/** Enrollment requires a currently enabled group. Replayed confirmations retain earned progress. */
export async function setEnrolled(db: D1Database, chatId: number, userId: number, enabled: boolean,
  now = new Date()) {
  if (enabled) {
    await db.prepare(`INSERT INTO achievement_enrollments(chat_id,user_id,enabled,start_day,generation)
      SELECT ?,?,1,?,? WHERE EXISTS(SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1)
      ON CONFLICT(chat_id,user_id) DO UPDATE SET enabled=1,paused_by_group=0,start_day=excluded.start_day,
      generation=excluded.generation,last_day=NULL,progress_json='[]' WHERE enabled=0`)
      .bind(chatId, userId, eligibleDay(now), crypto.randomUUID(), chatId).run();
  } else {
    await db.batch([
      ...revokeConversationMember(db, chatId, userId),
      db.prepare(`UPDATE achievement_enrollments SET enabled=0,paused_by_group=0,last_day=NULL,progress_json='[]',
        comeback_last_message_ts=NULL,comeback_replies_since=NULL,generation=?
        WHERE chat_id=? AND user_id=? AND (enabled=1 OR (${groupPause()}))`)
        .bind(crypto.randomUUID(), chatId, userId),
    ]);
  }
  return getEnrollment(db, chatId, userId);
}

/** Announcements are on by default. Muting also drops a queued reply, so a later unmute cannot revive it. */
export async function setComebackReplies(db: D1Database, chat: number, user: number, enabled: boolean) {
  const statements = [db.prepare(`UPDATE achievement_enrollments SET comeback_muted=?
    WHERE chat_id=? AND user_id=? AND enabled=1
    AND EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1)`)
    .bind(Number(!enabled), chat, user, chat)];
  if (!enabled) statements.push(db.prepare(`UPDATE achievement_awards SET comeback_reply_json=NULL,comeback_reply_at=NULL
    WHERE chat_id=? AND user_id=? AND badge_id=? AND comeback_reply_json IS NOT NULL`).bind(chat, user, COMEBACK.id));
  await db.batch(statements);
}
export async function eraseAlbum(db: D1Database, chatId: number, userId: number, generation?: string) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('invalid album owner');
  const condition = 'chat_id=? AND user_id=? AND (? IS NULL OR generation=?)';
  const params = [chatId, userId, generation ?? null, generation ?? null];
  const results = await db.batch([
    ...revokeConversationMember(db, chatId, userId, generation),
    db.prepare(`DELETE FROM achievement_awards WHERE chat_id=? AND user_id=? AND
      EXISTS (SELECT 1 FROM achievement_enrollments WHERE ${condition})`)
      .bind(chatId, userId, ...params),
    db.prepare(`DELETE FROM achievement_enrollments WHERE ${condition}`).bind(...params),
  ]);
  return results[results.length - 1].meta.changes > 0;
}
export async function listAwards(db: D1Database, chatId: number, userId = 0): Promise<Award[]> {
  const rows = await db.prepare(`SELECT badge_id,earned_day,result FROM achievement_awards
    WHERE chat_id=? AND user_id=? ORDER BY earned_day DESC,badge_id`).bind(chatId, userId).all<Award>();
  return rows.results;
}
export async function getProgress(db: D1Database, chatId: number, userId: number): Promise<BadgeProgress[]> {
  const row = await getEnrollment(db, chatId, userId);
  return row?.enabled ? JSON.parse(row.progress_json) : [];
}
