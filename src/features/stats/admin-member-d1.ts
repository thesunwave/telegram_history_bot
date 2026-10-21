import type { D1Database, D1Result } from '@cloudflare/workers-types';
import type { AdminDateRange } from '../../api/admin-stats';
import { PROFANITY_RATE_MIN_WORDS } from './stats';
import { AdminUnavailable } from './admin-stats-errors';

/**
 * D1 reader for `/admin/api/member`: one participant's numbers next to the
 * whole chat for the same window. Reads only bounded daily aggregates (one
 * batch, six statements), never raw messages or KV.
 */

const BUCKETS = [
  { bucket: 'morning', label: 'Утро' },
  { bucket: 'noon', label: 'День' },
  { bucket: 'evening', label: 'Вечер' },
  { bucket: 'night', label: 'Ночь' },
] as const;

const TOP_WORDS_LIMIT = 10;

export interface AdminMemberTotals {
  messages: number;
  words: number;
  wordsPerMessage: number;
  voiceCount: number;
  voiceMinutes: number;
  videoNoteCount: number;
  videoNoteMinutes: number;
  profanity: number;
  /** Percent of words; null below the minimum word count for a rate. */
  profanityRate: number | null;
  criminal: number;
  activeDays: number;
}

export interface AdminMemberStats {
  ok: true;
  chatId: number;
  userId: number;
  username: string;
  range: { from: string; to: string; days: number };
  /** First UTC day with a message from this user in any retained aggregate. */
  firstSeenDay: string | null;
  lastMessageTs: number | null;
  totals: AdminMemberTotals;
  /** Same-length window right before `range`; null when the user was silent there. */
  previous: { messages: number; words: number; profanity: number } | null;
  chat: {
    messages: number;
    words: number;
    activeUsers: number;
    wordsPerMessage: number;
    profanityRate: number | null;
    /** 1-based place by messages among active users; null when the user has no messages. */
    rank: number | null;
    /** Percent of the chat's messages written by this user. */
    share: number;
  };
  daily: Array<{ day: string; messages: number; words: number; profanity: number }>;
  buckets: Array<{ bucket: string; label: string; count: number; chatCount: number }>;
  topWords: Array<{ word: string; count: number }>;
}

interface ChatUserRow {
  user_id: number;
  message_count: number;
  word_count: number;
  profanity_count: number;
}

interface UserDayRow {
  day: string;
  message_count: number;
  word_count: number;
  voice_count: number;
  voice_duration_seconds: number;
  video_note_count: number;
  video_note_duration_seconds: number;
  profanity_count: number;
  criminal_count: number;
}

interface BucketRow {
  bucket: string;
  chat_count: number;
  user_count: number;
}

interface WordRow {
  word: string;
  count: number;
}

interface PreviousRow {
  message_count: number | null;
  word_count: number | null;
  profanity_count: number | null;
}

interface ProfileRow {
  username: string | null;
  last_message_ts: number | null;
  first_day: string | null;
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function profanityRate(profanity: number, words: number): number | null {
  return words >= PROFANITY_RATE_MIN_WORDS ? (profanity / words) * 100 : null;
}

function rowsOf<T>(results: readonly D1Result<unknown>[], index: number): T[] {
  const result = results[index];
  if (!result || result.error || (result as unknown as { success?: boolean }).success === false) {
    throw new AdminUnavailable();
  }
  return (result as D1Result<T>).results;
}

function sumDays(days: UserDayRow[]): AdminMemberTotals {
  const sum = (key: keyof Omit<UserDayRow, 'day'>) =>
    days.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const messages = sum('message_count');
  const words = sum('word_count');
  const profanity = sum('profanity_count');
  return {
    messages,
    words,
    wordsPerMessage: messages > 0 ? round1(words / messages) : 0,
    voiceCount: sum('voice_count'),
    voiceMinutes: round1(sum('voice_duration_seconds') / 60),
    videoNoteCount: sum('video_note_count'),
    videoNoteMinutes: round1(sum('video_note_duration_seconds') / 60),
    profanity,
    profanityRate: profanityRate(profanity, words),
    criminal: sum('criminal_count'),
    activeDays: days.filter((row) => Number(row.message_count) > 0).length,
  };
}

function summarizeChat(users: ChatUserRow[], userId: number): AdminMemberStats['chat'] {
  const active = users
    .filter((row) => Number(row.message_count) > 0)
    .sort((a, b) => b.message_count - a.message_count || a.user_id - b.user_id);
  const messages = active.reduce((total, row) => total + row.message_count, 0);
  const words = active.reduce((total, row) => total + row.word_count, 0);
  const profanity = users.reduce((total, row) => total + row.profanity_count, 0);
  const place = active.findIndex((row) => row.user_id === userId);
  const own = place >= 0 ? active[place].message_count : 0;
  return {
    messages,
    words,
    activeUsers: active.length,
    wordsPerMessage: messages > 0 ? round1(words / messages) : 0,
    profanityRate: profanityRate(profanity, words),
    rank: place >= 0 ? place + 1 : null,
    share: messages > 0 ? round1((own / messages) * 100) : 0,
  };
}

/** One participant's profile for the admin dashboard; never reads COUNTERS. */
export async function getAdminMemberStatsFromD1(
  db: D1Database,
  chatId: number,
  userId: number,
  range: AdminDateRange,
): Promise<AdminMemberStats> {
  const previousFrom = shiftDay(range.from, -range.days.length);
  const previousTo = shiftDay(range.from, -1);
  const statements = [
    db.prepare(
      `SELECT user_id, SUM(message_count) AS message_count, SUM(word_count) AS word_count,
              SUM(profanity_count) AS profanity_count
       FROM stats_daily_user
       WHERE chat_id = ? AND day >= ? AND day <= ?
       GROUP BY user_id`,
    ).bind(chatId, range.from, range.to),
    db.prepare(
      `SELECT day, message_count, word_count, voice_count, voice_duration_seconds,
              video_note_count, video_note_duration_seconds, profanity_count, criminal_count
       FROM stats_daily_user
       WHERE chat_id = ? AND user_id = ? AND day >= ? AND day <= ?`,
    ).bind(chatId, userId, range.from, range.to),
    db.prepare(
      `SELECT bucket, SUM(message_count) AS chat_count,
              SUM(CASE WHEN user_id = ? THEN message_count ELSE 0 END) AS user_count
       FROM stats_daily_bucket_user
       WHERE chat_id = ? AND day >= ? AND day <= ?
       GROUP BY bucket`,
    ).bind(userId, chatId, range.from, range.to),
    db.prepare(
      `SELECT word, SUM(count) AS count
       FROM stats_daily_profanity_word_user
       WHERE chat_id = ? AND user_id = ? AND day >= ? AND day <= ?
       GROUP BY word
       ORDER BY count DESC, word ASC
       LIMIT ${TOP_WORDS_LIMIT}`,
    ).bind(chatId, userId, range.from, range.to),
    db.prepare(
      `SELECT SUM(message_count) AS message_count, SUM(word_count) AS word_count,
              SUM(profanity_count) AS profanity_count
       FROM stats_daily_user
       WHERE chat_id = ? AND user_id = ? AND day >= ? AND day <= ?`,
    ).bind(chatId, userId, previousFrom, previousTo),
    db.prepare(
      `SELECT p.username, p.last_message_ts,
              (SELECT MIN(day) FROM stats_daily_user
               WHERE chat_id = ? AND user_id = ? AND message_count > 0) AS first_day
       FROM (SELECT 1) AS one
       LEFT JOIN stats_chat_user_profile p ON p.chat_id = ? AND p.user_id = ?`,
    ).bind(chatId, userId, chatId, userId),
  ];

  let results: D1Result<unknown>[];
  try {
    results = await db.batch(statements);
  } catch {
    throw new AdminUnavailable();
  }

  const chatUsers = rowsOf<ChatUserRow>(results, 0);
  const days = rowsOf<UserDayRow>(results, 1);
  const buckets = new Map(rowsOf<BucketRow>(results, 2).map((row) => [row.bucket, row]));
  const words = rowsOf<WordRow>(results, 3);
  const previous = rowsOf<PreviousRow>(results, 4)[0];
  const profile = rowsOf<ProfileRow>(results, 5)[0];
  const byDay = new Map(days.map((row) => [row.day, row]));
  const previousMessages = Number(previous?.message_count) || 0;

  return {
    ok: true,
    chatId,
    userId,
    username: profile?.username || `id${userId}`,
    range: { from: range.from, to: range.to, days: range.days.length },
    firstSeenDay: profile?.first_day || null,
    lastMessageTs: profile?.last_message_ts || null,
    totals: sumDays(days),
    previous: previousMessages > 0
      ? {
        messages: previousMessages,
        words: Number(previous?.word_count) || 0,
        profanity: Number(previous?.profanity_count) || 0,
      }
      : null,
    chat: summarizeChat(chatUsers, userId),
    daily: range.days.map((day) => ({
      day,
      messages: Number(byDay.get(day)?.message_count) || 0,
      words: Number(byDay.get(day)?.word_count) || 0,
      profanity: Number(byDay.get(day)?.profanity_count) || 0,
    })),
    buckets: BUCKETS.map(({ bucket, label }) => ({
      bucket,
      label,
      count: Number(buckets.get(bucket)?.user_count) || 0,
      chatCount: Number(buckets.get(bucket)?.chat_count) || 0,
    })),
    topWords: words.map((row) => ({ word: row.word, count: Number(row.count) || 0 })),
  };
}
