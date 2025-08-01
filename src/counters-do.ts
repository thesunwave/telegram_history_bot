import { Env } from './env';

export interface IncrementPayload {
  chatId: string;
  userId: string;
  username: string;
  day: string;
}

export class CountersDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  incrementCounter({ chatId, userId, username, day }: IncrementPayload): Promise<void> {
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
        } catch (e) {
          const error = e as Error;
          console.error('activity db error', {
            chat: chatId,
            err: error.message || String(error),
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
      const rawData = await request.json() as any;
      
      if (!rawData || typeof rawData !== 'object') {
        return new Response('Invalid JSON data', { status: 400 });
      }
      
      // Validate required fields before string conversion
      if (
        rawData.chatId == null || (typeof rawData.chatId === 'string' && rawData.chatId.trim() === '') ||
        rawData.userId == null || (typeof rawData.userId === 'string' && rawData.userId.trim() === '') ||
        rawData.username == null || (typeof rawData.username === 'string' && rawData.username.trim() === '') ||
        rawData.day == null || (typeof rawData.day === 'string' && rawData.day.trim() === '')
      ) {
        return new Response('Missing or invalid required fields', { status: 400 });
      }
      
      const chatId = String(rawData.chatId);
      const userId = String(rawData.userId);
      const username = String(rawData.username);
      const day = String(rawData.day);
      
      const payload: IncrementPayload = { chatId, userId, username, day };

      await this.incrementCounter(payload);
      return new Response('OK');
    } catch (error) {
      const err = error as Error;
      console.error('Error in CountersDO:', err);
      return new Response('Internal server error', { status: 500 });
    }
  }
}
