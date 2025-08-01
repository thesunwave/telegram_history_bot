import type { DurableObjectState } from '@cloudflare/workers-types';
import { Env } from './env';

const STATS_PREFIX = 'stats';
const USER_PREFIX = 'user';
const ACTIVITY_PREFIX = 'activity';

export interface IncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
}

export class CountersDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 });
    let payload: IncrementPayload;
    try {
      payload = (await request.json()) as IncrementPayload;
      this.validate(payload);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    try {
      await this.incrementCounters(payload);
    } catch (err: any) {
      console.error('counter update error', err.message || err);
      return new Response('error', { status: 500 });
    }
    return new Response('ok');
  }

  private validate(p: IncrementPayload) {
    if (!p.chatId || !p.userId || !p.day) throw new Error('invalid payload');
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
}
