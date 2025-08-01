import { Env } from './env';

export interface IncrementPayload {
  chatId: string;
  userId: string;
  username: string;
  day: string;
}

export class CountersDO {
  constructor(private state: DurableObjectState, private env: Env) {}

  private validatePayload(rawData: unknown): string | null {
    if (!rawData || typeof rawData !== 'object') {
      return 'Invalid data format';
    }
    
    const data = rawData as Record<string, unknown>;
    const missingFields: string[] = [];
    
    if (data.chatId == null || (typeof data.chatId === 'string' && data.chatId.trim() === '')) {
      missingFields.push('chatId');
    }
    if (data.userId == null || (typeof data.userId === 'string' && data.userId.trim() === '')) {
      missingFields.push('userId');
    }
    if (data.username == null || (typeof data.username === 'string' && data.username.trim() === '')) {
      missingFields.push('username');
    }
    if (data.day == null || (typeof data.day === 'string' && data.day.trim() === '')) {
      missingFields.push('day');
    }
    
    if (missingFields.length > 0) {
      return `Missing or invalid required fields: ${missingFields.join(', ')}`;
    }
    
    return null;
  }

  private incrementCounter({ chatId, userId, username, day }: IncrementPayload): Promise<void> {
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
      const rawData = await request.json() as unknown;
      
      const validationError = this.validatePayload(rawData);
      if (validationError) {
        return new Response(validationError, { status: 400 });
      }
      
      const data = rawData as Record<string, unknown>;
      const chatId = String(data.chatId);
      const userId = String(data.userId);
      const username = String(data.username);
      const day = String(data.day);
      
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
