import type { DurableObjectState } from '@cloudflare/workers-types';
import { Env } from './env';

const STATS_PREFIX = 'stats';
const USER_PREFIX = 'user';
const ACTIVITY_PREFIX = 'activity';
const PROFANITY_USER_PREFIX = 'profanity';
const PROFANITY_WORDS_PREFIX = 'profanity_words';
const CRIMINAL_USER_PREFIX = 'criminal';
const CRIMINAL_ARTICLE_PREFIX = 'criminal_article';
const CRIMINAL_SEVERITY_PREFIX = 'criminal_severity';

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
        const result = (await this.state.blockConcurrencyWhile(() => this.incrementCounters(payload))) as {
          userDayCount: number;
          chatDayActivity: number;
        };
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err: any) {
        console.error('counter update error', err.message || err);
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
      } catch (err: any) {
        console.error('profanity counter update error', err.message || err);
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
      } catch (err: any) {
        console.error('criminal counter update error', err.message || err);
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
  }

  private validateProfanity(p: ProfanityIncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day || p.count == null || !Array.isArray(p.words))
      throw new Error('invalid profanity payload');
  }

  private validateCriminal(p: CriminalIncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day || !Array.isArray(p.violations) || p.totalSeverity == null)
      throw new Error('invalid criminal payload');
  }

  private async incrementCounters({ chatId, userId, username, day }: IncrementPayload): Promise<{ userDayCount: number; chatDayActivity: number }> {
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

    return { userDayCount: count, chatDayActivity: actCnt };
  }

  private async incrementProfanityCounters(payload: ProfanityIncrementPayload) {
    const { chatId, userId, username, day, count, words } = payload;
    
    // Critical logging for profanity detection
    console.log(`CRITICAL: Profanity detected - User: ${username} (${userId}), Chat: ${chatId}, Count: ${count}, Words: ${words.map(w => w.baseForm).join(', ')}`);
    
    const profanityUserKey = `${PROFANITY_USER_PREFIX}:${chatId}:${userId}:${day}`;
    
    // Update user profanity count in KV
    const currentUserCount = parseInt((await this.env.COUNTERS.get(profanityUserKey)) || '0', 10);
    await this.env.COUNTERS.put(profanityUserKey, String(currentUserCount + count));
    
    // Update word-specific counts in KV
    for (const word of words) {
      const wordKey = `${PROFANITY_WORDS_PREFIX}:${chatId}:${word.baseForm}:${day}`;
      const currentWordCount = parseInt((await this.env.COUNTERS.get(wordKey)) || '0', 10);
      await this.env.COUNTERS.put(wordKey, String(currentWordCount + word.count));
    }
  }

  private async incrementCriminalCounters(payload: CriminalIncrementPayload) {
    const { chatId, userId, username, day, violations, totalSeverity } = payload;
    
    // Critical logging for criminal code violations
    console.log(`CRITICAL: Criminal code violations detected - User: ${username} (${userId}), Chat: ${chatId}, Total Severity: ${totalSeverity}, Articles: ${violations.map(v => v.article).join(', ')}`);
    
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
  }

  private async processBatchRequest(request: Request): Promise<Response> {
    let batchData: {
      activity?: IncrementPayload[];
      profanity?: ProfanityIncrementPayload[];
      criminal?: CriminalIncrementPayload[];
    };

    try {
      const data = (await request.json()) as any;
      batchData = data as {
        activity?: IncrementPayload[];
        profanity?: ProfanityIncrementPayload[];
        criminal?: CriminalIncrementPayload[];
      };
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
    } catch (err: any) {
      console.error('batch counter update error', err.message || err);
      return new Response('error', { status: 500 });
    }

    return new Response('ok');
  }
}
