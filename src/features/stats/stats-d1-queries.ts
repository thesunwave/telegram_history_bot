import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../core/env';

/**
 * D1 read helpers for the Telegram stats commands. Day bounds are inclusive
 * UTC `YYYY-MM-DD` strings. All reads come from the daily aggregate tables that
 * CountersDO maintains (see d1-aggregate-writer.ts); there is no KV fallback.
 */

export interface UserDayTotals {
  messages: number;
  words: number;
  profanity: number;
  criminal: number;
}

async function all<T>(db: D1Database, sql: string, params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return (res.results as T[] | undefined) ?? [];
}

function requireDb(env: Env): D1Database {
  if (!env.DB) throw new Error('D1 binding DB is not configured');
  return env.DB;
}

export async function queryUserTotals(
  env: Env,
  chatId: number,
  startDay: string,
  endDay: string,
): Promise<Map<string, UserDayTotals>> {
  const rows = await all<{
    user_id: number;
    messages: number;
    words: number;
    profanity: number;
    criminal: number;
  }>(
    requireDb(env),
    `SELECT user_id,
            SUM(message_count) AS messages,
            SUM(word_count) AS words,
            SUM(profanity_count) AS profanity,
            SUM(criminal_count) AS criminal
       FROM stats_daily_user
      WHERE chat_id = ? AND day >= ? AND day <= ?
      GROUP BY user_id`,
    [chatId, startDay, endDay],
  );
  const totals = new Map<string, UserDayTotals>();
  for (const row of rows) {
    totals.set(String(row.user_id), {
      messages: Number(row.messages) || 0,
      words: Number(row.words) || 0,
      profanity: Number(row.profanity) || 0,
      criminal: Number(row.criminal) || 0,
    });
  }
  return totals;
}

/** Display names for users of one chat; chat-scoped profile first, then global. */
export async function queryUsernames(
  env: Env,
  chatId: number,
  userIds: Array<string | number>,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  if (ids.length === 0) return names;
  const db = requireDb(env);
  const placeholders = ids.map(() => '?').join(', ');
  const [chatRows, globalRows] = await Promise.all([
    all<{ user_id: number; username: string }>(
      db,
      `SELECT user_id, username FROM stats_chat_user_profile WHERE chat_id = ? AND user_id IN (${placeholders})`,
      [chatId, ...ids],
    ),
    all<{ user_id: number; username: string }>(
      db,
      `SELECT user_id, username FROM stats_user_profile WHERE user_id IN (${placeholders})`,
      ids,
    ),
  ]);
  for (const row of globalRows) if (row.username) names.set(String(row.user_id), row.username);
  for (const row of chatRows) if (row.username) names.set(String(row.user_id), row.username);
  return names;
}

export async function queryHourTotals(
  env: Env,
  chatId: number,
  startDay: string,
  endDay: string,
): Promise<Map<number, number>> {
  const rows = await all<{ hour: number; messages: number }>(
    requireDb(env),
    `SELECT hour, SUM(message_count) AS messages
       FROM stats_daily_hour
      WHERE chat_id = ? AND day >= ? AND day <= ?
      GROUP BY hour`,
    [chatId, startDay, endDay],
  );
  return new Map(rows.map((row) => [Number(row.hour), Number(row.messages) || 0]));
}

export async function queryProfanityWordTotals(
  env: Env,
  chatId: number,
  startDay: string,
  endDay: string,
  limit: number,
): Promise<Array<{ word: string; count: number }>> {
  const rows = await all<{ word: string; count: number }>(
    requireDb(env),
    `SELECT word, SUM(count) AS count
       FROM stats_daily_profanity_word
      WHERE chat_id = ? AND day >= ? AND day <= ?
      GROUP BY word
      ORDER BY count DESC, word ASC
      LIMIT ?`,
    [chatId, startDay, endDay, limit],
  );
  return rows.map((row) => ({ word: row.word, count: Number(row.count) || 0 }));
}

export async function queryProfanityWordUsers(
  env: Env,
  chatId: number,
  word: string,
  startDay: string,
  endDay: string,
  limit: number,
): Promise<Array<{ userId: string; count: number }>> {
  const rows = await all<{ user_id: number; count: number }>(
    requireDb(env),
    `SELECT user_id, SUM(count) AS count
       FROM stats_daily_profanity_word_user
      WHERE chat_id = ? AND word = ? AND day >= ? AND day <= ?
      GROUP BY user_id
      ORDER BY count DESC, user_id ASC
      LIMIT ?`,
    [chatId, word, startDay, endDay, limit],
  );
  return rows.map((row) => ({ userId: String(row.user_id), count: Number(row.count) || 0 }));
}

/** Per-day chat totals of one stats_daily_user column. */
export async function queryDailyTotals(
  env: Env,
  chatId: number,
  column: 'profanity_count' | 'criminal_count',
  startDay: string,
  endDay: string,
): Promise<Map<string, number>> {
  const rows = await all<{ day: string; total: number }>(
    requireDb(env),
    `SELECT day, SUM(${column}) AS total
       FROM stats_daily_user
      WHERE chat_id = ? AND day >= ? AND day <= ?
      GROUP BY day`,
    [chatId, startDay, endDay],
  );
  return new Map(rows.map((row) => [row.day, Number(row.total) || 0]));
}

/** Per-day totals of one stats_daily_user column for a single user. */
export async function queryUserDailyTotals(
  env: Env,
  chatId: number,
  userId: number,
  column: 'profanity_count' | 'criminal_count',
  startDay: string,
  endDay: string,
): Promise<Map<string, number>> {
  const rows = await all<{ day: string; total: number }>(
    requireDb(env),
    `SELECT day, SUM(${column}) AS total
       FROM stats_daily_user
      WHERE chat_id = ? AND user_id = ? AND day >= ? AND day <= ?
      GROUP BY day`,
    [chatId, userId, startDay, endDay],
  );
  return new Map(rows.map((row) => [row.day, Number(row.total) || 0]));
}

/** Chats that received at least one counted message on `day`. */
export async function queryActiveChats(env: Env, day: string): Promise<number[]> {
  const rows = await all<{ chat_id: number }>(
    requireDb(env),
    'SELECT DISTINCT chat_id FROM activity WHERE day = ? AND count > 0',
    [day],
  );
  return rows.map((row) => Number(row.chat_id));
}

export type StatsResetScope = 'all' | 'profanity' | 'criminal';

/**
 * Erases one chat's aggregate counters. 'all' removes every daily aggregate
 * row; 'profanity'/'criminal' zero that category and drop its word tables.
 */
export async function deleteChatStats(env: Env, chatId: number, scope: StatsResetScope): Promise<void> {
  const db = requireDb(env);
  const statements: string[] = [];
  if (scope === 'all') {
    statements.push(
      'DELETE FROM stats_daily_user WHERE chat_id = ?',
      'DELETE FROM stats_daily_hour WHERE chat_id = ?',
      'DELETE FROM stats_daily_bucket_user WHERE chat_id = ?',
      'DELETE FROM stats_daily_profanity_word WHERE chat_id = ?',
      'DELETE FROM stats_daily_profanity_word_user WHERE chat_id = ?',
      'DELETE FROM activity WHERE chat_id = ?',
    );
  } else if (scope === 'profanity') {
    statements.push(
      'UPDATE stats_daily_user SET profanity_count = 0 WHERE chat_id = ?',
      'DELETE FROM stats_daily_profanity_word WHERE chat_id = ?',
      'DELETE FROM stats_daily_profanity_word_user WHERE chat_id = ?',
    );
  } else {
    statements.push(
      'UPDATE stats_daily_user SET criminal_count = 0, criminal_severity = 0 WHERE chat_id = ?',
    );
  }
  await db.batch(statements.map((sql) => db.prepare(sql).bind(chatId)));
}
