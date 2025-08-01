import { Env } from './env';

export class CountersDO {
  constructor(private state: any, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 });
    const { chatId, userId, username, day } = await request.json();
    if (!chatId || !userId || !day)
      return new Response('Bad request', { status: 400 });
    const ckey = `stats:${chatId}:${userId}:${day}`;
    const count = parseInt((await this.env.COUNTERS.get(ckey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(ckey, String(count));
    await this.env.COUNTERS.put(`user:${userId}`, username);
    const akey = `activity:${chatId}:${day}`;
    const acnt = parseInt((await this.env.COUNTERS.get(akey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(akey, String(acnt));
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
    return new Response('ok');
  }
}
