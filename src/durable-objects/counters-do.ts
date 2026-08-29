import type { DurableObjectState } from '@cloudflare/workers-types';
import { Env } from '../core/env';
import { Logger } from '../core/logger';
import { normalizeProfanityWord } from '../features/profanity/local-detector';
import {
  logD1AggregateWriteError,
  writeActivityAggregates,
  writeCriminalAggregates,
  writeProfanityAggregates,
} from '../features/stats/d1-aggregate-writer';

const STATS_PREFIX = 'stats';
const USER_PREFIX = 'user';
const ACTIVITY_PREFIX = 'activity';
const ACTIVITY_HOUR_PREFIX = 'activity_hour';
const ACTIVITY_TIME_BUCKET_PREFIX = 'activity_time_bucket';
const WORD_STATS_PREFIX = 'word_stats';
const WORD_ACTIVITY_PREFIX = 'word_activity';
const LAST_MESSAGE_PREFIX = 'last_message';
const PROFANITY_USER_PREFIX = 'profanity';
const PROFANITY_WORDS_PREFIX = 'profanity_words';
const PROFANITY_WORD_USERS_PREFIX = 'profanity_word_users';
const CRIMINAL_USER_PREFIX = 'criminal';
const CRIMINAL_ARTICLE_PREFIX = 'criminal_article';
const CRIMINAL_SEVERITY_PREFIX = 'criminal_severity';

function safeErrorClass(error: unknown): 'Error' | 'ThrownString' | 'UnknownError' {
  if (error instanceof Error) return 'Error';
  if (typeof error === 'string') return 'ThrownString';
  return 'UnknownError';
}

function logCounterOperationError(operation: string, error: unknown): void {
  console.error('counter operation error', {
    operation,
    errorClass: safeErrorClass(error),
    errorCode: 'COUNTER_OPERATION_FAILED',
  });
}

function getTimeBucket(hour: number): 'night' | 'morning' | 'noon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'noon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export interface IncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
  hour?: number;
  wordCount?: number;
  voiceCount?: number;
  voiceDurationSeconds?: number;
  videoNoteCount?: number;
  videoNoteDurationSeconds?: number;
  ts?: number;
}

export interface ProfanityIncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
  count: number;
  words: Array<{
    word?: string;
    baseForm?: string;
    count: number;
  }>;
}

export interface CriminalIncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
  violations: Array<{
    article: string;
    severity: number;
    count: number;
  }>;
  totalSeverity: number;
}

interface BatchIncrementPayload {
  activity?: IncrementPayload[];
  profanity?: ProfanityIncrementPayload[];
  criminal?: CriminalIncrementPayload[];
}

export class CountersDO {
  constructor(private state: DurableObjectState, private env: Env) { }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 });

    const url = new URL(request.url);
    const endpoint = url.pathname;

    if (endpoint === '/inc') {
      let payload: IncrementPayload;
      try {
        payload = (await request.json()) as IncrementPayload;
        this.validate(payload);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        const result = (await this.state.blockConcurrencyWhile(() => this.incrementCounters(payload))) as {
          userDayCount: number;
          chatDayActivity: number;
        };
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err: unknown) {
        logCounterOperationError('increment', err);
        return new Response('error', { status: 500 });
      }
    } else if (endpoint === '/profanity') {
      let payload: ProfanityIncrementPayload;
      try {
        payload = (await request.json()) as ProfanityIncrementPayload;
        this.validateProfanity(payload);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        await this.state.blockConcurrencyWhile(() => this.incrementProfanityCounters(payload));
      } catch (err: unknown) {
        logCounterOperationError('profanity', err);
        return new Response('error', { status: 500 });
      }
      return new Response('ok');
    } else if (endpoint === '/criminal') {
      let payload: CriminalIncrementPayload;
      try {
        payload = (await request.json()) as CriminalIncrementPayload;
        this.validateCriminal(payload);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        await this.state.blockConcurrencyWhile(() => this.incrementCriminalCounters(payload));
      } catch (err: unknown) {
        logCounterOperationError('criminal', err);
        return new Response('error', { status: 500 });
      }
      return new Response('ok');
    } else if (endpoint === '/batch') {
      return await this.processBatchRequest(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private validate(p: IncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day)
      throw new Error('invalid payload');
    if (p.wordCount !== undefined && (!Number.isInteger(p.wordCount) || p.wordCount < 0))
      throw new Error('invalid word count');
    if (p.ts !== undefined && (!Number.isInteger(p.ts) || p.ts < 0))
      throw new Error('invalid timestamp');
    for (const value of [p.voiceCount, p.voiceDurationSeconds, p.videoNoteCount, p.videoNoteDurationSeconds]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0))
        throw new Error('invalid media metric');
    }
  }

  private validateProfanity(p: ProfanityIncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day || p.count == null || !Array.isArray(p.words))
      throw new Error('invalid profanity payload');
    if (!Number.isInteger(p.count) || p.count <= 0)
      throw new Error('invalid profanity count');

    let wordCountTotal = 0;
    for (const word of p.words) {
      const normalizedWord = this.normalizeProfanityCounterWord(word);
      if (!normalizedWord)
        throw new Error('invalid profanity word');
      if (!Number.isInteger(word.count) || word.count <= 0)
        throw new Error('invalid profanity word count');
      wordCountTotal += word.count;
    }
    if (wordCountTotal !== p.count)
      throw new Error('profanity count mismatch');
  }

  private validateCriminal(p: CriminalIncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day || !Array.isArray(p.violations) || p.totalSeverity == null)
      throw new Error('invalid criminal payload');
  }

  private async incrementCounters({
    chatId,
    userId,
    username,
    day,
    hour,
    wordCount = 0,
    voiceCount = 0,
    voiceDurationSeconds = 0,
    videoNoteCount = 0,
    videoNoteDurationSeconds = 0,
    ts,
  }: IncrementPayload): Promise<{
    userDayCount: number;
    chatDayActivity: number;
    userDayWordCount: number;
    chatDayWords: number;
  }> {
    const statsKey = `${STATS_PREFIX}:${chatId}:${userId}:${day}`;
    const count = parseInt((await this.env.COUNTERS.get(statsKey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(statsKey, String(count));

    // New optimized key format: stats_v2:chatId:day:userId
    // This allows listing all users for a specific day efficiently
    const statsV2Key = `stats_v2:${chatId}:${day}:${userId}`;
    await this.env.COUNTERS.put(statsV2Key, String(count));

    const wordStatsKey = `${WORD_STATS_PREFIX}:${chatId}:${userId}:${day}`;
    const userDayWordCount =
      parseInt((await this.env.COUNTERS.get(wordStatsKey)) || '0', 10) + wordCount;
    await this.env.COUNTERS.put(wordStatsKey, String(userDayWordCount));

    const wordStatsV2Key = `${WORD_STATS_PREFIX}_v2:${chatId}:${day}:${userId}`;
    await this.env.COUNTERS.put(wordStatsV2Key, String(userDayWordCount));

    await this.incrementMediaMetric(chatId, day, userId, 'voice', voiceCount, voiceDurationSeconds);
    await this.incrementMediaMetric(chatId, day, userId, 'video_note', videoNoteCount, videoNoteDurationSeconds);

    await this.env.COUNTERS.put(`${USER_PREFIX}:${userId}`, username);

    const activityKey = `${ACTIVITY_PREFIX}:${chatId}:${day}`;
    const actCnt = parseInt((await this.env.COUNTERS.get(activityKey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(activityKey, String(actCnt));

    const wordActivityKey = `${WORD_ACTIVITY_PREFIX}:${chatId}:${day}`;
    const chatDayWords =
      parseInt((await this.env.COUNTERS.get(wordActivityKey)) || '0', 10) + wordCount;
    await this.env.COUNTERS.put(wordActivityKey, String(chatDayWords));

    if (hour !== undefined && Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      const activityHourKey = `${ACTIVITY_HOUR_PREFIX}:${chatId}:${day}:${hour.toString().padStart(2, '0')}`;
      const hourCnt = parseInt((await this.env.COUNTERS.get(activityHourKey)) || '0', 10) + 1;
      await this.env.COUNTERS.put(activityHourKey, String(hourCnt));

      const bucket = getTimeBucket(hour);
      const timeBucketKey = `${ACTIVITY_TIME_BUCKET_PREFIX}:${chatId}:${day}:${bucket}:${userId}`;
      const bucketCnt = parseInt((await this.env.COUNTERS.get(timeBucketKey)) || '0', 10) + 1;
      await this.env.COUNTERS.put(timeBucketKey, String(bucketCnt));
    }

    if (ts !== undefined) {
      const lastMessageKey = `${LAST_MESSAGE_PREFIX}:${chatId}:${userId}`;
      const previousTs = parseInt((await this.env.COUNTERS.get(lastMessageKey)) || '0', 10);
      if (ts > previousTs) {
        await this.env.COUNTERS.put(lastMessageKey, String(ts));
      }
    }

    if (this.env.DB) {
      try {
        // One D1 batch total for a normal base message (aggregates + legacy
        // activity upsert share a single transaction).
        const validHourForD1 =
          hour !== undefined && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : undefined;
        await writeActivityAggregates(this.env.DB, {
          chatId,
          userId,
          username,
          day,
          hour: validHourForD1,
          bucket: validHourForD1 !== undefined ? getTimeBucket(validHourForD1) : undefined,
          wordCount,
          voiceCount,
          voiceDurationSeconds,
          videoNoteCount,
          videoNoteDurationSeconds,
          ts,
        });
      } catch (e: unknown) {
        logD1AggregateWriteError('activity', chatId, e);
      }
    }

    return {
      userDayCount: count,
      chatDayActivity: actCnt,
      userDayWordCount,
      chatDayWords,
    };
  }

  private async incrementMediaMetric(
    chatId: number,
    day: string,
    userId: number,
    type: 'voice' | 'video_note',
    countDelta: number,
    durationDelta: number,
  ) {
    if (countDelta <= 0 && durationDelta <= 0) return;

    const countKey = `media_stats_v2:${chatId}:${day}:${userId}:${type}`;
    const nextCount = parseInt((await this.env.COUNTERS.get(countKey)) || '0', 10) + countDelta;
    await this.env.COUNTERS.put(countKey, String(nextCount));

    const durationKey = `media_duration_v2:${chatId}:${day}:${userId}:${type}`;
    const nextDuration =
      parseInt((await this.env.COUNTERS.get(durationKey)) || '0', 10) + durationDelta;
    await this.env.COUNTERS.put(durationKey, String(nextDuration));
  }

  private async incrementProfanityCounters(payload: ProfanityIncrementPayload) {
    const { chatId, userId, username, day, count } = payload;
    const words = this.aggregateProfanityCounterWords(payload.words);

    Logger.debug(this.env, 'Profanity counters update', {
      totalCount: count,
      uniqueWords: words.length,
    });

    const profanityUserKey = `${PROFANITY_USER_PREFIX}:${chatId}:${userId}:${day}`;

    // Update user profanity count in KV
    const currentUserCount = parseInt((await this.env.COUNTERS.get(profanityUserKey)) || '0', 10);
    await this.env.COUNTERS.put(profanityUserKey, String(currentUserCount + count));
    await this.env.COUNTERS.put(`${USER_PREFIX}:${userId}`, username);

    // Update word-specific counts in KV
    for (const word of words) {
      const wordKey = `${PROFANITY_WORDS_PREFIX}:${chatId}:${word.word}:${day}`;
      const currentWordCount = parseInt((await this.env.COUNTERS.get(wordKey)) || '0', 10);
      await this.env.COUNTERS.put(wordKey, String(currentWordCount + word.count));

      const wordUserKey = `${PROFANITY_WORD_USERS_PREFIX}:${chatId}:${word.word}:${day}:${userId}`;
      const currentWordUserCount = parseInt((await this.env.COUNTERS.get(wordUserKey)) || '0', 10);
      await this.env.COUNTERS.put(wordUserKey, String(currentWordUserCount + word.count));
    }

    if (this.env.DB) {
      try {
        await writeProfanityAggregates(this.env.DB, {
          chatId,
          userId,
          username,
          day,
          count,
          words,
        });
      } catch (e: unknown) {
        logD1AggregateWriteError('profanity', chatId, e);
      }
    }
  }

  private aggregateProfanityCounterWords(
    words: ProfanityIncrementPayload['words'],
  ): Array<{ word: string; count: number }> {
    const counts = new Map<string, number>();
    for (const entry of words) {
      const normalizedWord = this.normalizeProfanityCounterWord(entry);
      if (!normalizedWord) {
        continue;
      }
      counts.set(normalizedWord, (counts.get(normalizedWord) || 0) + entry.count);
    }
    return Array.from(counts.entries()).map(([word, count]) => ({ word, count }));
  }

  private normalizeProfanityCounterWord(
    word: ProfanityIncrementPayload['words'][number],
  ): string | null {
    const rawWord = typeof word?.word === 'string' && word.word.trim()
      ? word.word
      : typeof word?.baseForm === 'string'
        ? word.baseForm
        : '';
    return normalizeProfanityWord(rawWord);
  }

  private async incrementCriminalCounters(payload: CriminalIncrementPayload) {
    const { chatId, userId, username, day, violations, totalSeverity } = payload;

    Logger.debug(this.env, 'Criminal counters update', {
      totalSeverity,
      violationCount: violations.length,
    });

    const criminalUserKey = `${CRIMINAL_USER_PREFIX}:${chatId}:${userId}:${day}`;
    const criminalSeverityKey = `${CRIMINAL_SEVERITY_PREFIX}:${chatId}:${userId}:${day}`;

    // Update user criminal violations count in KV
    const currentUserCount = parseInt((await this.env.COUNTERS.get(criminalUserKey)) || '0', 10);
    await this.env.COUNTERS.put(criminalUserKey, String(currentUserCount + violations.length));

    // Update user total severity in KV
    const currentSeverity = parseInt((await this.env.COUNTERS.get(criminalSeverityKey)) || '0', 10);
    await this.env.COUNTERS.put(criminalSeverityKey, String(currentSeverity + totalSeverity));

    // Update article-specific counts in KV
    for (const violation of violations) {
      const articleKey = `${CRIMINAL_ARTICLE_PREFIX}:${chatId}:${violation.article}:${day}`;
      const currentArticleCount = parseInt((await this.env.COUNTERS.get(articleKey)) || '0', 10);
      await this.env.COUNTERS.put(articleKey, String(currentArticleCount + violation.count));
    }

    if (this.env.DB) {
      try {
        await writeCriminalAggregates(this.env.DB, {
          chatId,
          userId,
          username,
          day,
          violationCount: violations.length,
          totalSeverity,
        });
      } catch (e: unknown) {
        logD1AggregateWriteError('criminal', chatId, e);
      }
    }
  }

  private async processBatchRequest(request: Request): Promise<Response> {
    let batchData: BatchIncrementPayload;

    try {
      batchData = (await request.json()) as BatchIncrementPayload;
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    try {
      await this.state.blockConcurrencyWhile(async () => {
        // Process activity increments
        if (batchData.activity && Array.isArray(batchData.activity)) {
          for (const payload of batchData.activity) {
            this.validate(payload);
            await this.incrementCounters(payload);
          }
        }

        // Process profanity increments
        if (batchData.profanity && Array.isArray(batchData.profanity)) {
          for (const payload of batchData.profanity) {
            this.validateProfanity(payload);
            await this.incrementProfanityCounters(payload);
          }
        }

        // Process criminal code violations increments
        if (batchData.criminal && Array.isArray(batchData.criminal)) {
          for (const payload of batchData.criminal) {
            this.validateCriminal(payload);
            await this.incrementCriminalCounters(payload);
          }
        }
      });
    } catch (err: unknown) {
      logCounterOperationError('batch', err);
      return new Response('error', { status: 500 });
    }

    return new Response('ok');
  }
}
