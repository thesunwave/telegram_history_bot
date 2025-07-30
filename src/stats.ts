import { Env, DAY, MONTH_DAYS, WEEK_DAYS } from './env';
import { sendMessage, sendPhoto } from './telegram';
import { summariseChat } from './summary';

export async function topChat(
  env: Env,
  chatId: number,
  n: number,
  day: string,
) {
  const prefix = `stats:${chatId}:`;
  let cursor: string | undefined = undefined;
  const counts: Record<string, number> = {};
  do {
    const list = await env.COUNTERS.list({ prefix, cursor });
    cursor = list.cursor;
    const values = await Promise.all(
      list.keys.map((k) => env.COUNTERS.get(k.name)),
    );
    for (let i = 0; i < list.keys.length; i++) {
      const key = list.keys[i];
      const [_, chat, user, d] = key.name.split(':');
      if (d !== day) continue;
      const c = parseInt(values[i] || '0');
      counts[user] = (counts[user] || 0) + c;
    }
  } while (cursor);
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
  const prefix = `stats:${chatId}:`;
  let cursor: string | undefined = undefined;
  do {
    const list = await env.COUNTERS.list({ prefix, cursor });
    cursor = list.cursor;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);
  const aPrefix = `activity:${chatId}:`;
  cursor = undefined;
  do {
    const list = await env.COUNTERS.list({ prefix: aPrefix, cursor });
    cursor = list.cursor;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);
  if (env.DB) {
    try {
      await env.DB.prepare('DELETE FROM activity WHERE chat_id = ?')
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
  const date = new Date(start * 1000).toISOString().slice(0, 10);
  const prefix = 'stats:';
  let cursor: string | undefined = undefined;
  const chats = new Set<number>();
  do {
    const list = await env.COUNTERS.list({ prefix, cursor });
    cursor = list.cursor;
    for (const key of list.keys) {
      const [_, chat, , d] = key.name.split(':');
      if (d === date) chats.add(parseInt(chat));
    }
  } while (cursor);
  for (const c of chats) {
    await summariseChat(env, c, 1);
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
  const text = drawGraph(data);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return total > 0 ? `${text}\nTotal: ${total}` : text;
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
      title?: { display: boolean; text: string };
      datalabels?: { anchor: 'end'; align: 'top'; color?: string };
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
    options: { plugins: { datalabels: { anchor: 'end', align: 'top' } } },
  };
  if (title) {
    chart.options!.plugins.title = { display: true, text: title };
  }
  return (
    'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(chart))
  );
}

export async function activityChart(
  env: Env,
  chatId: number,
  period: 'week' | 'month',
) {
  const prefix = `activity:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(
    start.getUTCDate() - (period === 'month' ? MONTH_DAYS : WEEK_DAYS),
  );
  const startStr = start.toISOString().slice(0, 10);
  let dbOk = false;
  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        'SELECT day, count FROM activity WHERE chat_id = ? AND day >= ? ORDER BY day',
      )
        .bind(chatId, startStr)
        .all();
      for (const row of res.results as any[]) {
        totals[row.day] = row.count;
      }
      dbOk = true;
    } catch (e) {
      console.error('activity db read error', {
        chat: chatId.toString(36),
        err: (e as any).message || String(e),
      });
    }
  }
  if (!dbOk) {
    do {
      const list = await env.COUNTERS.list({ prefix, cursor });
      cursor = list.cursor;
      const values = await Promise.all(
        list.keys.map((k) => env.COUNTERS.get(k.name)),
      );
      for (let i = 0; i < list.keys.length; i++) {
        const [_, , day] = list.keys[i].name.split(':');
        if (day >= startStr) {
          const c = parseInt(values[i] || '0', 10);
          totals[day] = (totals[day] || 0) + c;
        }
      }
    } while (cursor);
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
  const prefix = `stats:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(
    start.getUTCDate() - (period === 'month' ? MONTH_DAYS : WEEK_DAYS),
  );
  const startStr = start.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);
  do {
    const list = await env.COUNTERS.list({ prefix, cursor });
    cursor = list.cursor;
    const values = await Promise.all(
      list.keys.map((k) => env.COUNTERS.get(k.name)),
    );
    for (let i = 0; i < list.keys.length; i++) {
      const [_, , user, day] = list.keys[i].name.split(':');
      if (day >= startStr) {
        const c = parseInt(values[i] || '0', 10);
        totals[user] = (totals[user] || 0) + c;
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const names = await Promise.all(
    sorted.map(([u]) => env.COUNTERS.get(`user:${u}`)),
  );
  const labels = names.map((n, i) => sanitizeLabel(n || `id${sorted[i][0]}`));
  const data = sorted.map(([, c]) => c);
  const title = `${startStr} - ${endStr}`;
  const url = createBarChartUrl(labels, data, 'Messages', title);
  await sendPhoto(env, chatId, url);
}
