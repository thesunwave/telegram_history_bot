import { Env, DAY, MAX_LAST_MESSAGES } from './env';
import { summariseChat, summariseChatMessages } from './summary';
import { topChat, resetCounters, activityChart, activityByUser } from './stats';
import { sendMessage } from './telegram';

const HELP_TEXT =
  '/summary <days> – \u0441\u0432\u043e\u0434\u043a\u0430 \u0437\u0430 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 N \u0434\u043d\u0435\u0439 (\u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e 1)\n' +
  '/summary_last <n> – \u0441\u0432\u043e\u0434\u043a\u0430 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0445 N \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439 (\u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e 1, \u043c\u0430\u043a\u0441 40)\n' +
  '/top <n> – \u0442\u043e\u043f N \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0445 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0435\u0439 \u0437\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f (\u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e 5)\n' +
  '/reset – \u0441\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u0441\u0447\u0435\u0442\u0447\u0438\u043a\u0438 \u0434\u043b\u044f \u0447\u0430\u0442\u0430\n' +
  '/activity_week – \u0433\u0440\u0430\u0444\u0438\u043a \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u0438 \u0437\u0430 \u043d\u0435\u0434\u0435\u043b\u044e\n' +
  '/activity_month – \u0433\u0440\u0430\u0444\u0438\u043a \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u0438 \u0437\u0430 \u043c\u0435\u0441\u044f\u0446\n' +
  '/activity_users_week – \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u043f\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f\u043c \u0437\u0430 \u043d\u0435\u0434\u0435\u043b\u044e\n' +
  '/activity_users_month – \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0441\u0442\u044c \u043f\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f\u043c \u0437\u0430 \u043c\u0435\u0441\u044f\u0446\n' +
  '/help – \u044d\u0442\u0430 \u0441\u043f\u0440\u0430\u0432\u043a\u0430';

export function getTextMessage(update: any) {
  const msg = update.message;
  if (!msg || !msg.text) return null;
  if (msg.from?.is_bot) return null;
  return msg;
}

export async function recordMessage(msg: any, env: Env) {
  if (!msg) return;
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
  const akey = `activity:${chatId}:${day}`;
  const acnt = parseInt((await env.COUNTERS.get(akey)) || '0') + 1;
  await env.COUNTERS.put(akey, String(acnt));
  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO activity (chat_id, day, count) VALUES (?, ?, 1) ' +
          'ON CONFLICT(chat_id, day) DO UPDATE SET count = count + 1',
      )
        .bind(chatId, day)
        .run();
    } catch (e) {
      console.error('activity db error', {
        chat: chatId.toString(36),
        err: (e as any).message || String(e),
      });
    }
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
