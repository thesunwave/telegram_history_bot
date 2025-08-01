import type { DurableObjectState } from '@cloudflare/workers-types';
import { Env } from './env';

export interface IncrementPayload {
  chatId: string;
  userId: string;
  username: string;
  day: string;
}

export class CountersDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  async incrementCounter({ chatId, userId, username, day }: IncrementPayload): Promise<void> {
    return this.state.blockConcurrencyWhile(async () => {
      const statsKey = `stats:${chatId}:${userId}:${day}`;
      const count = parseInt((await this.env.COUNTERS.get(statsKey)) || '0', 10) + 1;
      await this.env.COUNTERS.put(statsKey, String(count));
      await this.env.COUNTERS.put(`user:${userId}`, username);

      const activityKey = `activity:${chatId}:${day}`;
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
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const payload = await request.json() as IncrementPayload;
      
      if (!payload.chatId || !payload.userId || !payload.username || !payload.day) {
        return new Response('Missing required fields', { status: 400 });
      }

      await this.incrementCounter(payload);
      return new Response('OK');
    } catch (error) {
      console.error('Error in CountersDO:', error);
      return new Response('Internal server error', { status: 500 });
    }
  }
}
