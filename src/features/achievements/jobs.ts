import type { Env } from '../../core/env';
import { Logger } from '../../core/logger';
import { mondayOf, shiftDay } from './calendar';
import { sendWeeklyPhoto } from './cards';
import { evaluatePersonal, evaluateWeek } from './evaluate';
import { listAwards } from './repository';

export const ACHIEVEMENT_CRON = '*/5 * * * *';
const HOUR = 3600;
const SHORT_LEASE = 5 * 60;

function midnight(day: string): number {
  return Date.parse(day + 'T00:00:00Z') / 1000;
}

async function processGroup(env: Env, chat: number, generation: string, week: string, now: number): Promise<number> {
  const nextWeek = midnight(shiftDay(week, 14));
  const report = await evaluateWeek(env, chat, week);
  if (!report) return now + 6 * HOUR;
  if (!report.messages) return nextWeek;
  const count = (await listAwards(env.DB, chat)).length;
  // A persisted reservation represents an ambiguous delivery after a crash.
  // Only an explicit transport refusal can safely return it to the ready state.
  const groupGuard = `EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=achievement_reports.chat_id
    AND enabled=1 AND generation=? AND start_day<=achievement_reports.week)`;
  const claim = await env.DB.prepare(`UPDATE achievement_reports SET state='sending'
    WHERE chat_id=? AND week=? AND state='ready' AND next_send_at<=? AND ${groupGuard}`)
    .bind(chat, week, now, generation).run();
  if (!claim.meta.changes) {
    const row = await env.DB.prepare('SELECT state,next_send_at FROM achievement_reports WHERE chat_id=? AND week=?')
      .bind(chat, week).first<{ state: string; next_send_at: number }>();
    // A slow sender can still receive a definitive rate limit. Check its state
    // later without resending a photo while the original request is unresolved.
    if (row?.state === 'sending') return now + HOUR;
    return row?.state === 'ready' ? Math.max(now + SHORT_LEASE, row.next_send_at) : nextWeek;
  }
  const stillReserved = async () => Boolean(await env.DB.prepare(`SELECT 1 FROM achievement_reports
    WHERE chat_id=? AND week=? AND state='sending' AND ${groupGuard}`).bind(chat, week, generation).first());
  const result = await sendWeeklyPhoto(env, chat, report, count, stillReserved);
  const state = result.status === 'retry' ? 'ready' : result.status;
  const next = result.status === 'retry' ? now + Math.max(SHORT_LEASE, result.retryAfter) : nextWeek;
  await env.DB.prepare(`UPDATE achievement_reports SET state=?,telegram_message_id=?,next_send_at=?
    WHERE chat_id=? AND week=? AND state='sending' AND ${groupGuard}`)
    .bind(state, result.status === 'sent' ? result.messageId : null, next, chat, week, generation).run();
  return next;
}

async function weeklyStep(env: Env, today: string, now: number) {
  const week = shiftDay(mondayOf(today), -7);
  const row = await env.DB.prepare(`UPDATE achievement_groups SET next_report_check=? WHERE chat_id=(
    SELECT chat_id FROM achievement_groups WHERE enabled=1 AND next_report_check<=? AND start_day<=?
    ORDER BY next_report_check, chat_id LIMIT 1) RETURNING chat_id,generation`)
    .bind(now + SHORT_LEASE, now, week).first<{chat_id: number; generation: string}>();
  if (!row) return;
  const next = await processGroup(env, row.chat_id, row.generation, week, now);
  await env.DB.prepare(`UPDATE achievement_groups SET next_report_check=?
    WHERE chat_id=? AND generation=? AND next_report_check=?`)
    .bind(next, row.chat_id, row.generation, now + SHORT_LEASE).run();
}

async function personalStep(env: Env, today: string, now: number) {
  const yesterday = shiftDay(today, -1);
  const due = await env.DB.prepare(`UPDATE achievement_enrollments SET next_album_check=?
    WHERE (chat_id,user_id) IN (SELECT e.chat_id,e.user_id FROM achievement_enrollments e
      JOIN achievement_groups g USING(chat_id) WHERE g.enabled=1 AND e.enabled=1 AND e.start_day<=?
      AND e.next_album_check<=? AND (e.last_day IS NULL OR e.last_day<?)
      ORDER BY e.next_album_check,e.chat_id,e.user_id LIMIT 3)
    RETURNING chat_id,user_id,start_day,last_day`)
    .bind(now + SHORT_LEASE, yesterday, now, yesterday)
    .all<{ chat_id: number; user_id: number; start_day: string; last_day: string | null }>();
  for (const album of due.results) {
    const day = album.last_day ? shiftDay(album.last_day, 1) : album.start_day;
    try {
      await evaluatePersonal(env, album.chat_id, album.user_id, day);
    } catch (error) {
      const errorClass = error instanceof Error
        ? [TypeError, RangeError, SyntaxError, ReferenceError].find(type => error instanceof type)?.name ?? 'Error'
        : 'UnknownError';
      Logger.warn('Album evaluation deferred', { op: 'achievementAlbum', errorClass });
    }
  }
}

/** Process bounded batches independently. Terminal or ambiguous sends are never replayed. */
export async function runAchievementJobs(env: Env, time: Date) {
  const today = time.toISOString().slice(0, 10);
  const now = Math.floor(time.getTime() / 1000);
  try {
    await weeklyStep(env, today, now);
  } finally {
    await personalStep(env, today, now);
  }
}
