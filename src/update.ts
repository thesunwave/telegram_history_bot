import { Env, DAY, MAX_LAST_MESSAGES } from './env';
import type { KVNamespace } from '@cloudflare/workers-types';
import { summariseChat, summariseChatMessages } from './summary';
import { topChat, resetCounters, activityChart, activityByUser } from './stats';
import { sendMessage } from './telegram';
import { Logger } from './logger';

const HELP_TEXT = [
  '/summary <days> – сводка за последние N дней (по умолчанию 1)',
  '/summary_last <n> – сводка последних N сообщений (по умолчанию 1, макс 40)',
  '/top <n> – топ N активных пользователей за сегодня (по умолчанию 5)',
  '/reset – сбросить счетчики для чата',
  '/activity_week – график активности за неделю',
  '/activity_month – график активности за месяц',
  '/activity_users_week – активность по пользователям за неделю',
  '/activity_users_month – активность по пользователям за месяц',
  '/help – показать список всех команд',
].join('\n');

export function getTextMessage(update: any) {
  const msg = update.message;
  if (!msg || !msg.text) return null;
  if (msg.from?.is_bot) return null;
  return msg;
}

export async function recordMessage(msg: any, env: Env) {
  if (!msg) {
    Logger.debug(env, 'recordMessage: no message');
    return;
  }
  if (msg.from?.is_bot) {
    Logger.debug(env, 'recordMessage: bot message, skipping');
    return;
  }
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
  
  Logger.debug(env, 'recordMessage: saving to KV', {
    key,
    chatId,
    username,
    textLength: msg.text?.length || 0,
    timestamp: ts,
    messageId: msg.message_id
  });
  
  try {
    await env.HISTORY.put(key, JSON.stringify(stored), {
      expirationTtl: 7 * DAY,
    });
    Logger.debug(env, 'recordMessage: KV save successful', { key });
  } catch (error: any) {
    Logger.error('recordMessage: KV save failed', {
      key,
      error: error.message || String(error),
      stack: error.stack
    });
  }
  
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  const id = env.COUNTERS_DO.idFromName(String(chatId));
  
  try {
    await env.COUNTERS_DO.get(id).fetch('https://do/inc', {
      method: 'POST',
      body: JSON.stringify({ chatId, userId, username, day }),
    });
    Logger.debug(env, 'recordMessage: counter update successful', { chatId, day });
  } catch (error: any) {
    Logger.error('recordMessage: counter update failed', {
      chatId,
      error: error.message || String(error)
    });
  }
}

export async function handleUpdate(msg: any, env: Env) {
  if (!msg) return;
  const chatId = msg.chat.id;
  const ts = msg.date;
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  if (msg.text.startsWith('/summary_last')) {
    const n = parseInt(msg.text.split(' ')[1] || '1', 10);
    const count = Math.min(n, MAX_LAST_MESSAGES);
    await summariseChatMessages(env, chatId, count);
  } else if (msg.text.startsWith('/summary')) {
    const d = parseInt(msg.text.split(' ')[1] || '1');
    await summariseChat(env, chatId, d);
  } else if (msg.text.startsWith('/top')) {
    const n = parseInt(msg.text.split(' ')[1] || '5');
    await topChat(env, chatId, n, day);
  } else if (msg.text.startsWith('/reset')) {
    await resetCounters(env, chatId);
    await sendMessage(env, chatId, 'Counters reset');
  } else if (msg.text.startsWith('/activity_week')) {
    await activityChart(env, chatId, 'week');
    await activityByUser(env, chatId, 'week');
  } else if (msg.text.startsWith('/activity_month')) {
    await activityChart(env, chatId, 'month');
    await activityByUser(env, chatId, 'month');
  } else if (msg.text.startsWith('/activity_users_week')) {
    await activityByUser(env, chatId, 'week');
  } else if (msg.text.startsWith('/activity_users_month')) {
    await activityByUser(env, chatId, 'month');
  } else if (msg.text.startsWith('/activity')) {
    const parts = msg.text.split(/\s+/);
    const sub = parts[1] || 'week';
    if (sub === 'users') {
      const period = parts[2] === 'month' ? 'month' : 'week';
      await activityByUser(env, chatId, period);
    } else {
      const period = sub === 'month' ? 'month' : 'week';
      await activityChart(env, chatId, period);
    }
  } else if (msg.text.startsWith('/help')) {
    await sendMessage(env, chatId, HELP_TEXT);
  }
}
