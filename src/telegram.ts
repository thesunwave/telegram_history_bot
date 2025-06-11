import { Env } from './env';
import { chunkText } from './utils';
import { TELEGRAM_LIMIT } from './env';

export async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${env.TOKEN}/sendMessage`;
  const parts = chunkText(text, TELEGRAM_LIMIT);
  for (const part of parts) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('tg send', {
        status: res.status,
        chat: chatId.toString(36),
        err,
      });
      break;
    }
  }
}
