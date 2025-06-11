import { Env, DAY } from './env';
import { sendMessage } from './telegram';
import { summariseChat } from './summary';

export async function topChat(env: Env, chatId: number, n: number, day: string) {
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
