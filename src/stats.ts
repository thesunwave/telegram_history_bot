import { Env, DAY, MONTH_DAYS, WEEK_DAYS } from './env';
import { sendMessage, sendPhoto } from './telegram';
import { summariseChat } from './summary';
import { fetchMessages } from './history';

export async function topChat(
  env: Env,
  chatId: number,
  n: number,
  day: string,
) {
  const start = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
  const end = start + DAY;
  const messages = await fetchMessages(env, chatId, start, end - 1);
  const counts: Record<number, number> = {};
  for (const m of messages) {
    counts[m.user] = (counts[m.user] || 0) + 1;
    await env.COUNTERS.put(`user:${m.user}`, m.username);
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  const lines = [];
  const names = await Promise.all(
    sorted.map(([u]) => env.COUNTERS.get(`user:${u}`)),
  );
  for (let i = 0; i < sorted.length; i++) {
    const [u, c] = sorted[i];
    const name = names[i] || `id${u}`;
    lines.push(`${i + 1}. ${name}: ${c}`);
  }
  const text = lines.join('\n') || 'Нет данных';
  await sendMessage(env, chatId, text);
}

export async function resetCounters(env: Env, chatId: number) {
  await env.COUNTERS.delete(`chat:${chatId}`);
  if (env.DB) {
    try {
      await env.DB.prepare('DELETE FROM activity WHERE chat_id = ?')
        .bind(chatId)
        .run();
      await env.DB.prepare('DELETE FROM user_activity WHERE chat_id = ?')
        .bind(chatId)
        .run();
    } catch (e) {
      console.error('activity reset db error', {
        chat: chatId.toString(36),
        err: (e as any).message || String(e),
      });
    }
  }
}

export async function dailySummary(env: Env) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = Math.floor((today.getTime() - DAY * 1000) / 1000);
  const end = Math.floor(today.getTime() / 1000);
  const date = new Date(start * 1000).toISOString().slice(0, 10);
  const list = await env.COUNTERS.list({ prefix: 'chat:' });
  const chats = list.keys.map((k) => parseInt(k.name.split(':')[1]));
  for (const chatId of chats) {
    const msgs = await fetchMessages(env, chatId, start, end - 1);
    if (msgs.length === 0) continue;
    await summariseChat(env, chatId, 1);
    await aggregateForChat(env, chatId, msgs, date);
  }
}

async function aggregateForChat(
  env: Env,
  chatId: number,
  msgs: { user: number; username: string }[],
  date: string,
) {
  if (!env.DB) return;
  const perUser: Record<number, number> = {};
  for (const m of msgs) {
    perUser[m.user] = (perUser[m.user] || 0) + 1;
  }
  const total = msgs.length;
  try {
    await env.DB.prepare(
      'INSERT INTO activity (chat_id, day, count) VALUES (?, ?, ?) ' +
        'ON CONFLICT(chat_id, day) DO UPDATE SET count = count + ?',
    )
      // reuse `total` for both the INSERT value and the UPDATE increment
      .bind(chatId, date, total, total)
      .run();
  } catch (e) {
    console.error('activity agg db error', {
      chat: chatId.toString(36),
      err: (e as any).message || String(e),
    });
  }
  for (const [u, c] of Object.entries(perUser)) {
    try {
      await env.DB.prepare(
        'INSERT INTO user_activity (chat_id, user_id, day, count) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(chat_id, user_id, day) DO UPDATE SET count = count + ?',
      )
        // upsert: increment existing count or insert new row with the same value
        .bind(chatId, parseInt(u), date, c, c)
        .run();
    } catch (e) {
      console.error('user_activity agg db error', {
        chat: chatId.toString(36),
        user: u,
        err: (e as any).message || String(e),
      });
    }
  }
}

function drawGraph(data: { label: string; value: number }[]): string {
  const max = Math.max(...data.map((d) => d.value), 1);
  const scale = max > 0 ? 10 / max : 0;
  return data
    .map(({ label, value }) => {
      const bar = '█'.repeat(Math.round(value * scale));
      return `${label.padStart(3, ' ')} |${bar} ${value}`;
    })
    .join('\n');
}

function sanitizeLabel(label: string): string {
  const truncated = label.slice(0, 32);
  const allowlist = /^[a-zA-Z0-9_.@-]+$/;
  if (allowlist.test(truncated)) return truncated;
  const sanitized = truncated.replace(/[^a-zA-Z0-9_.@-]+/g, '');
  return sanitized || 'unknown';
}

function formatActivityText(data: { label: string; value: number }[]): string {
  if (data.length === 0) return 'Нет данных';
  return drawGraph(data);
}

interface ChartDataset {
  label: string;
  data: number[];
}

interface ChartConfig {
  type: 'bar';
  data: { labels: string[]; datasets: ChartDataset[] };
  options?: {
    plugins: {
      title: { display: boolean; text: string };
      datalabels?: {
        anchor?: 'start' | 'center' | 'end' | string;
        align?: 'top' | 'bottom' | 'center' | 'start' | 'end' | string;
        color?: string;
      };
    };
  };
}

function createBarChartUrl(
  labels: string[],
  data: number[],
  name: string,
  title?: string,
): string {
  if (
    labels.length === 0 ||
    data.length === 0 ||
    labels.length !== data.length
  ) {
    throw new Error(
      `Invalid chart data: labels and data arrays must have equal lengths and contain at least one element each. ` +
        `Received labels.length=${labels.length}, data.length=${data.length}.`,
    );
  }
  const chart: ChartConfig = {
    type: 'bar',
    data: { labels, datasets: [{ label: name, data }] },
    options: {
      plugins: {
        title: { display: Boolean(title), text: title ?? '' },
        datalabels: { anchor: 'end', align: 'top' },
      },
    },
  };
  return (
    'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(chart))
  );
}

export async function activityChart(
  env: Env,
  chatId: number,
  period: 'week' | 'month',
) {
  const totals: Record<string, number> = {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(
    start.getUTCDate() - (period === 'month' ? MONTH_DAYS : WEEK_DAYS),
  );
  const startStr = start.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  let dbOk = false;
  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        'SELECT day, count FROM activity WHERE chat_id = ? AND day >= ? AND day < ? ORDER BY day',
      )
        .bind(chatId, startStr, todayStr)
        .all();
      for (const row of res.results as any[]) {
        totals[row.day] = row.count;
      }
      dbOk = (res.results as any[]).length > 0;
    } catch (e) {
      console.error('activity db read error', {
        chat: chatId.toString(36),
        err: (e as any).message || String(e),
      });
    }
  }
  if (!dbOk) {
    const msgs = await fetchMessages(
      env,
      chatId,
      Math.floor(start.getTime() / 1000),
      Math.floor(Date.now() / 1000),
    );
    for (const m of msgs) {
      const d = new Date(m.ts * 1000).toISOString().slice(0, 10);
      totals[d] = (totals[d] || 0) + 1;
    }
  } else {
    const todayMsgs = await fetchMessages(
      env,
      chatId,
      Math.floor(today.getTime() / 1000),
      Math.floor(Date.now() / 1000),
    );
    totals[todayStr] = todayMsgs.length;
  }

  let data: { label: string; value: number }[] = [];
  if (period === 'week') {
    const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY * 1000);
      const key = d.toISOString().slice(0, 10);
      data.push({ label: labels[d.getUTCDay()], value: totals[key] || 0 });
    }
  } else {
    const weeks = [0, 0, 0, 0];
    for (const day in totals) {
      const diff = Math.floor(
        (today.getTime() - new Date(day).getTime()) / (DAY * 1000),
      );
      const idx = 3 - Math.floor(diff / 7);
      if (idx >= 0 && idx < 4) weeks[idx] += totals[day];
    }
    for (let i = 0; i < 4; i++)
      data.push({ label: `W${i + 1}`, value: weeks[i] });
  }

  await sendMessage(env, chatId, formatActivityText(data));
}

export async function activityByUser(
  env: Env,
  chatId: number,
  period: 'week' | 'month',
) {
  const totals: Record<string, number> = {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(
    start.getUTCDate() - (period === 'month' ? MONTH_DAYS : WEEK_DAYS),
  );
  const startStr = start.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);
  let dbOk = false;
  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        'SELECT user_id, SUM(count) as c FROM user_activity WHERE chat_id = ? AND day >= ? AND day < ? GROUP BY user_id',
      )
        .bind(chatId, startStr, todayStr)
        .all();
      for (const row of res.results as any[]) {
        totals[String(row.user_id)] = row.c;
      }
      dbOk = (res.results as any[]).length > 0;
    } catch (e) {
      console.error('user_activity db read error', {
        chat: chatId.toString(36),
        err: (e as any).message || String(e),
      });
    }
  }
  if (!dbOk) {
    const msgs = await fetchMessages(
      env,
      chatId,
      Math.floor(start.getTime() / 1000),
      Math.floor(Date.now() / 1000),
    );
    for (const m of msgs) {
      totals[String(m.user)] = (totals[String(m.user)] || 0) + 1;
      await env.COUNTERS.put(`user:${m.user}`, m.username);
    }
  } else {
    const todays = await fetchMessages(
      env,
      chatId,
      Math.floor(today.getTime() / 1000),
      Math.floor(Date.now() / 1000),
    );
    for (const m of todays) {
      totals[String(m.user)] = (totals[String(m.user)] || 0) + 1;
      await env.COUNTERS.put(`user:${m.user}`, m.username);
    }
  }

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const names = await Promise.all(
    sorted.map(([u]) => env.COUNTERS.get(`user:${u}`)),
  );
  const labels = names.map((n, i) => sanitizeLabel(n || `id${sorted[i][0]}`));
  const data = sorted.map(([, c]) => c);
  const title = `${startStr} - ${todayStr}`;
  const url = createBarChartUrl(labels, data, 'Messages', title);
  await sendPhoto(env, chatId, url);
}
