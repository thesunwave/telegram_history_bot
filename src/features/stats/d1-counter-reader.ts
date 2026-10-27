import type { D1Database } from '@cloudflare/workers-types';

/**
 * Current aggregate totals read back from D1 by the serialized CountersDO
 * writer. D1 is the only counter store: CountersDO reads the current value,
 * adds the delta and writes the exact new total through the aggregate writer.
 * Every caller runs inside `blockConcurrencyWhile`, so read-then-write cannot
 * interleave for one chat.
 */

export interface BaseCounterTotals {
  messageCount: number;
  wordCount: number;
  voiceCount: number;
  voiceDurationSeconds: number;
  videoNoteCount: number;
  videoNoteDurationSeconds: number;
  activityCount: number;
  chatDayWords: number;
  hourCount: number;
  bucketCount: number;
}

export interface ProfanityCounterTotals {
  userCount: number;
  words: Map<string, { count: number; userCount: number }>;
}

export interface CriminalCounterTotals {
  count: number;
  severity: number;
}

function toInt(value: unknown): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

async function firstRow<T>(db: D1Database, sql: string, params: unknown[]): Promise<T | undefined> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return (res.results as T[] | undefined)?.[0];
}

export async function readBaseCounterTotals(
  db: D1Database,
  input: { chatId: number; userId: number; day: string; hour?: number; bucket?: string },
): Promise<BaseCounterTotals> {
  const { chatId, userId, day, hour, bucket } = input;
  const [user, activity, chatWords, hourRow, bucketRow] = await Promise.all([
    firstRow<Record<string, unknown>>(
      db,
      `SELECT message_count, word_count, voice_count, voice_duration_seconds,
              video_note_count, video_note_duration_seconds
         FROM stats_daily_user WHERE chat_id = ? AND day = ? AND user_id = ?`,
      [chatId, day, userId],
    ),
    firstRow<{ count: number }>(db, 'SELECT count FROM activity WHERE chat_id = ? AND day = ?', [chatId, day]),
    firstRow<{ words: number }>(
      db,
      'SELECT COALESCE(SUM(word_count), 0) AS words FROM stats_daily_user WHERE chat_id = ? AND day = ?',
      [chatId, day],
    ),
    hour === undefined
      ? Promise.resolve(undefined)
      : firstRow<{ message_count: number }>(
          db,
          'SELECT message_count FROM stats_daily_hour WHERE chat_id = ? AND day = ? AND hour = ?',
          [chatId, day, hour],
        ),
    bucket === undefined
      ? Promise.resolve(undefined)
      : firstRow<{ message_count: number }>(
          db,
          'SELECT message_count FROM stats_daily_bucket_user WHERE chat_id = ? AND day = ? AND bucket = ? AND user_id = ?',
          [chatId, day, bucket, userId],
        ),
  ]);

  return {
    messageCount: toInt(user?.message_count),
    wordCount: toInt(user?.word_count),
    voiceCount: toInt(user?.voice_count),
    voiceDurationSeconds: toInt(user?.voice_duration_seconds),
    videoNoteCount: toInt(user?.video_note_count),
    videoNoteDurationSeconds: toInt(user?.video_note_duration_seconds),
    activityCount: toInt(activity?.count),
    chatDayWords: toInt(chatWords?.words),
    hourCount: toInt(hourRow?.message_count),
    bucketCount: toInt(bucketRow?.message_count),
  };
}

export async function readProfanityCounterTotals(
  db: D1Database,
  input: { chatId: number; userId: number; day: string; words: string[] },
): Promise<ProfanityCounterTotals> {
  const { chatId, userId, day, words } = input;
  const [user, ...wordRows] = await Promise.all([
    firstRow<{ profanity_count: number }>(
      db,
      'SELECT profanity_count FROM stats_daily_user WHERE chat_id = ? AND day = ? AND user_id = ?',
      [chatId, day, userId],
    ),
    ...words.map((word) =>
      Promise.all([
        firstRow<{ count: number }>(
          db,
          'SELECT count FROM stats_daily_profanity_word WHERE chat_id = ? AND day = ? AND word = ?',
          [chatId, day, word],
        ),
        firstRow<{ count: number }>(
          db,
          'SELECT count FROM stats_daily_profanity_word_user WHERE chat_id = ? AND day = ? AND word = ? AND user_id = ?',
          [chatId, day, word, userId],
        ),
      ]),
    ),
  ]);

  const totals = new Map<string, { count: number; userCount: number }>();
  words.forEach((word, i) => {
    const [wordRow, wordUserRow] = wordRows[i];
    totals.set(word, { count: toInt(wordRow?.count), userCount: toInt(wordUserRow?.count) });
  });
  return { userCount: toInt(user?.profanity_count), words: totals };
}

export async function readCriminalCounterTotals(
  db: D1Database,
  input: { chatId: number; userId: number; day: string },
): Promise<CriminalCounterTotals> {
  const row = await firstRow<{ criminal_count: number; criminal_severity: number }>(
    db,
    'SELECT criminal_count, criminal_severity FROM stats_daily_user WHERE chat_id = ? AND day = ? AND user_id = ?',
    [input.chatId, input.day, input.userId],
  );
  return { count: toInt(row?.criminal_count), severity: toInt(row?.criminal_severity) };
}
