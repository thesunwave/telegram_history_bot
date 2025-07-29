import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from "./env";
import { chunkText } from "./utils";

export async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${env.TOKEN}/sendMessage`;
  const parts = chunkText(text, TELEGRAM_LIMIT);
  for (const part of parts) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: part }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("tg send", {
        status: res.status,
        chat: chatId.toString(LOG_ID_RADIX),
        err,
      });
      break;
    }
  }
}

export async function sendPhoto(env: Env, chatId: number, url: string) {
  const api = `https://api.telegram.org/bot${env.TOKEN}/sendPhoto`;
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: url }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('tg sendPhoto', {
      status: res.status,
      chat: chatId.toString(LOG_ID_RADIX),
      err,
    });
  }
}
