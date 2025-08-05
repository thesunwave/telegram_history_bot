import type { DurableObjectState } from '@cloudflare/workers-types';
import { Env } from './env';

const STATS_PREFIX = 'stats';
const USER_PREFIX = 'user';
const ACTIVITY_PREFIX = 'activity';
const PROFANITY_USER_PREFIX = 'profanity';
const PROFANITY_WORDS_PREFIX = 'profanity_words';

export interface IncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
}

export interface ProfanityIncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
  count: number;
  words: Array<{
    baseForm: string;
    count: number;
  }>;
}

export class CountersDO {
  constructor(private state: DurableObjectState, private env: Env) {}

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
        await this.state.blockConcurrencyWhile(() => this.incrementCounters(payload));
      } catch (err: any) {
        console.error('counter update error', err.message || err);
        return new Response('error', { status: 500 });
      }
      return new Response('ok');
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
      } catch (err: any) {
        console.error('profanity counter update error', err.message || err);
        return new Response('error', { status: 500 });
      }
      return new Response('ok');
    }
    
    return new Response('Not found', { status: 404 });
  }

  private validate(p: IncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day)
      throw new Error('invalid payload');
  }

  private validateProfanity(p: ProfanityIncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day || p.count == null || !Array.isArray(p.words))
      throw new Error('invalid profanity payload');
  }

  private async incrementCounters({ chatId, userId, username, day }: IncrementPayload) {
    const statsKey = `${STATS_PREFIX}:${chatId}:${userId}:${day}`;
    const count = parseInt((await this.env.COUNTERS.get(statsKey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(statsKey, String(count));
    await this.env.COUNTERS.put(`${USER_PREFIX}:${userId}`, username);

    const activityKey = `${ACTIVITY_PREFIX}:${chatId}:${day}`;
    const actCnt = parseInt((await this.env.COUNTERS.get(activityKey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(activityKey, String(actCnt));

    if (this.env.DB) {
      try {
        await this.env.DB.prepare(
          'INSERT INTO activity (chat_id, day, count) VALUES (?, ?, 1) ' +
            'ON CONFLICT(chat_id, day) DO UPDATE SET count = count + 1',
        )
          .bind(chatId, day)
          .run();
      } catch (e: any) {
        console.error('activity db error', {
          chat: chatId.toString(36),
          err: e.message || String(e),
        });
      }
    }
  }

  private async incrementProfanityCounters({ chatId, userId, username, day, count, words }: ProfanityIncrementPayload) {
    try {
      console.log('Profanity counters: starting update', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        username,
        day,
        count,
        wordsCount: words.length
      });

      // Store username for later retrieval
      await this.env.COUNTERS.put(`${USER_PREFIX}:${userId}`, username);

      // Increment user profanity counter: profanity:chat:user:day
      const userProfanityKey = `${PROFANITY_USER_PREFIX}:${chatId}:${userId}:${day}`;
      const currentUserCount = parseInt((await this.env.COUNTERS.get(userProfanityKey)) || '0', 10);
      const newUserCount = currentUserCount + count;
      await this.env.COUNTERS.put(userProfanityKey, String(newUserCount));

      console.log('Profanity counters: user counter updated', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        previousCount: currentUserCount,
        increment: count,
        newCount: newUserCount
      });

      // Increment word profanity counters: profanity_words:chat:word:day
      let wordsUpdated = 0;
      for (const word of words) {
        const wordKey = `${PROFANITY_WORDS_PREFIX}:${chatId}:${word.baseForm}:${day}`;
        const currentWordCount = parseInt((await this.env.COUNTERS.get(wordKey)) || '0', 10);
        const newWordCount = currentWordCount + word.count;
        await this.env.COUNTERS.put(wordKey, String(newWordCount));
        wordsUpdated++;

        console.log('Profanity counters: word counter updated', {
          chatId: chatId.toString(36),
          baseForm: word.baseForm.substring(0, 3) + '***', // Censor word in logs
          previousCount: currentWordCount,
          increment: word.count,
          newCount: newWordCount
        });
      }

      console.log('Profanity counters: update completed successfully', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        totalWordsIncrement: count,
        uniqueWordsUpdated: wordsUpdated
      });

    } catch (error: any) {
      console.error('Profanity counters: update failed', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        error: error.message || String(error),
        stack: error.stack
      });
      throw error;
    }
  }
}
