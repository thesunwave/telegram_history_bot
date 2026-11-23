import type { D1Database } from '@cloudflare/workers-types';
import { BOT_MEMBERSHIP_PREFIX } from '../../core/consts';
import { revokeConversationGroup, revokeConversationMember } from './social';
import { eligibleDay, mondayOf, shiftDay } from './calendar';
import type { BadgeProgress } from './rules';

export interface GroupState { enabled: number; start_day: string; generation: string }
export interface Enrollment extends GroupState { last_day: string | null; progress_json: string }
export interface Award { badge_id: string; earned_day: string; result: string }

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
    db.prepare(`UPDATE achievement_enrollments SET enabled=0,progress_json='[]',
      last_day=NULL, generation=hex(randomblob(16)) WHERE chat_id=? AND enabled=1` + guard).bind(...params),
    db.prepare(`UPDATE achievement_reports SET state='cancelled'
      WHERE chat_id=? AND state='ready'` + guard).bind(...params),
  ];
}

/** Idempotent settings toggle. Each genuine transition invalidates stale in-flight jobs. */
export async function setGroupEnabled(db: D1Database, chatId: number, enabled: boolean, now = new Date()) {
  const start = eligibleDay(now);
  const monday = mondayOf(start);
  const update = db.prepare(`INSERT INTO achievement_groups(chat_id,enabled,start_day,generation)
    SELECT ?,?,?,? WHERE ?=0 OR NOT EXISTS (
      SELECT 1 FROM app_settings WHERE scope=? AND json_extract(settings_json,'$.active')=0
    ) ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled,
    start_day=excluded.start_day,generation=excluded.generation WHERE enabled<>excluded.enabled`)
    .bind(chatId, Number(enabled), start === monday ? start : shiftDay(monday, 7), crypto.randomUUID(),
      Number(enabled), BOT_MEMBERSHIP_PREFIX + chatId);
  const changes = [update];
  if (!enabled) changes.push(...pauseGroupDependents(db, chatId));
  await db.batch(changes);
  return getGroup(db, chatId);
}
export function getEnrollment(db: D1Database, chatId: number, userId: number) {
  return db.prepare('SELECT * FROM achievement_enrollments WHERE chat_id=? AND user_id=?')
    .bind(chatId, userId).first<Enrollment>();
}

/** Enrollment requires a currently enabled group. Replayed confirmations retain earned progress. */
export async function setEnrolled(db: D1Database, chatId: number, userId: number, enabled: boolean,
  now = new Date()) {
  if (enabled) {
    await db.prepare(`INSERT INTO achievement_enrollments(chat_id,user_id,enabled,start_day,generation)
      SELECT ?,?,1,?,? WHERE EXISTS(SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1)
      ON CONFLICT(chat_id,user_id) DO UPDATE SET enabled=1,start_day=excluded.start_day,
      generation=excluded.generation,last_day=NULL,progress_json='[]' WHERE enabled=0`)
      .bind(chatId, userId, eligibleDay(now), crypto.randomUUID(), chatId).run();
  } else {
    await db.batch([
      ...revokeConversationMember(db, chatId, userId),
      db.prepare(`UPDATE achievement_enrollments SET enabled=0,last_day=NULL,progress_json='[]',
        generation=? WHERE chat_id=? AND user_id=? AND enabled=1`)
        .bind(crypto.randomUUID(), chatId, userId),
    ]);
  }
  return getEnrollment(db, chatId, userId);
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
