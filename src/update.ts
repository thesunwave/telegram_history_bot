import { Env, DAY } from './env';
import { summariseChat, summariseChatMessages } from './summary';
import { topChat, resetCounters } from './stats';
import { sendMessage } from './telegram';

export async function handleUpdate(update: any, env: Env) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const userId = msg.from?.id || 0;
  const username = msg.from?.username || `id${userId}`;
  const ts = msg.date;
  const stored = {
    chat: chatId,
    user: userId,
    username,
    text: msg.text,
    ts,
  };
  const key = `msg:${chatId}:${ts}:${msg.message_id}`;
  await env.HISTORY.put(key, JSON.stringify(stored), {
    expirationTtl: 7 * DAY,
  });
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  const ckey = `stats:${chatId}:${userId}:${day}`;
  const count = parseInt((await env.COUNTERS.get(ckey)) || '0') + 1;
  await env.COUNTERS.put(ckey, String(count));
  await env.COUNTERS.put(`user:${userId}`, username);

  if (msg.text.startsWith('/summary_last')) {
    const n = parseInt(msg.text.split(' ')[1] || '100');
    await summariseChatMessages(env, chatId, n);
  } else if (msg.text.startsWith('/summary')) {
    const d = parseInt(msg.text.split(' ')[1] || '1');
    await summariseChat(env, chatId, d);
  } else if (msg.text.startsWith('/top')) {
    const n = parseInt(msg.text.split(' ')[1] || '5');
    await topChat(env, chatId, n, day);
  } else if (msg.text.startsWith('/reset')) {
    await resetCounters(env, chatId);
    await sendMessage(env, chatId, 'Counters reset');
  }
}
