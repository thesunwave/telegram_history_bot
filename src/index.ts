interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
  DB: D1Database;
  AI: any;
  TOKEN: string;
  SECRET: string;
  SUMMARY_MODEL: string;
  SUMMARY_PROMPT: string;
}

interface StoredMessage {
  chat: number;
  user: number;
  username: string;
  text: string;
  ts: number;
}

const DAY = 86400;
const TELEGRAM_LIMIT = 4096;

function chunkText(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += limit) {
    parts.push(chars.slice(i, i + limit).join(''));
  }
  return parts.length ? parts : [''];
}

function truncateText(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('');
}

async function sendMessage(env: Env, chatId: number, text: string) {
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

async function fetchMessages(
  env: Env,
  chatId: number,
  start: number,
  end: number,
) {
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const messages: StoredMessage[] = [];
  do {
    const list = await env.HISTORY.list({ prefix, cursor });
    cursor = list.cursor;
    for (const key of list.keys) {
      const parts = key.name.split(":");
      const ts = parseInt(parts[2]);
      if (ts >= start && ts <= end) {
        const m = await env.HISTORY.get<StoredMessage>(key.name, {
          type: "json",
        });
        if (m) messages.push(m);
      }
    }
  } while (cursor && messages.length < 10000);
  return messages.sort((a, b) => a.ts - b.ts);
}

async function summariseChat(env: Env, chatId: number, days: number) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * DAY;
  const messages = await fetchMessages(env, chatId, start, end);
  if (!messages.length) {
    await sendMessage(env, chatId, "Нет сообщений");
    return;
  }
  const content = messages.map((m) => `${m.username}: ${m.text}`).join('\n');
  console.debug('summarize', {
    chat: chatId.toString(36),
    days,
    model: env.SUMMARY_MODEL,
    count: messages.length,
  });
  const limitNote = `Ответ не длиннее ${TELEGRAM_LIMIT} символов.`;
  let aiResp: any;
  if (env.SUMMARY_MODEL.includes('chat')) {
    const msg = [
      { role: 'system', content: `${env.SUMMARY_PROMPT}\n${limitNote}` },
      { role: 'user', content },
    ];
    aiResp = await env.AI.run(env.SUMMARY_MODEL, { messages: msg });
  } else {
    const input = `${env.SUMMARY_PROMPT}\n${limitNote}\n${content}`;
    aiResp = await env.AI.run(env.SUMMARY_MODEL, { prompt: input });
  }

  const summary = truncateText(aiResp.response ?? aiResp, TELEGRAM_LIMIT);
  await sendMessage(env, chatId, summary);
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO summaries (chat_id, period_start, period_end, summary) VALUES (?, ?, ?, ?)",
    )
      .bind(
        chatId,
        new Date(start * 1000).toISOString(),
        new Date(end * 1000).toISOString(),
        summary,
      )
      .run();
  }
}

async function topChat(env: Env, chatId: number, n: number, day: string) {
  const prefix = `stats:${chatId}:`;
  let cursor: string | undefined = undefined;
  const counts: Record<string, number> = {};
  do {
    const list = await env.COUNTERS.list({ prefix, cursor });
    cursor = list.cursor;
    for (const key of list.keys) {
      const [_, chat, user, d] = key.name.split(":");
      if (d !== day) continue;
      const c = parseInt((await env.COUNTERS.get(key.name)) || "0");
      counts[user] = (counts[user] || 0) + c;
    }
  } while (cursor);
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  const text =
    sorted.map(([u, c], i) => `${i + 1}. ${u}: ${c}`).join("\n") ||
    "Нет данных";
  await sendMessage(env, chatId, text);
}

async function resetCounters(env: Env, chatId: number) {
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

async function handleUpdate(update: any, env: Env) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const userId = msg.from?.id || 0;
  const username = msg.from?.username || `id${userId}`;
  const ts = msg.date;
  const stored: StoredMessage = {
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
  const count = parseInt((await env.COUNTERS.get(ckey)) || "0") + 1;
  await env.COUNTERS.put(ckey, String(count));

  if (msg.text.startsWith("/summary")) {
    const d = parseInt(msg.text.split(" ")[1] || "1");
    await summariseChat(env, chatId, d);
  } else if (msg.text.startsWith("/top")) {
    const n = parseInt(msg.text.split(" ")[1] || "5");
    await topChat(env, chatId, n, day);
  } else if (msg.text.startsWith("/reset")) {
    await resetCounters(env, chatId);
    await sendMessage(env, chatId, "Counters reset");
  }
}

async function dailySummary(env: Env) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = Math.floor((today.getTime() - DAY * 1000) / 1000);
  const date = new Date(start * 1000).toISOString().slice(0, 10);
  const prefix = "stats:";
  let cursor: string | undefined = undefined;
  const chats = new Set<number>();
  do {
    const list = await env.COUNTERS.list({ prefix, cursor });
    cursor = list.cursor;
    for (const key of list.keys) {
      const [_, chat, , d] = key.name.split(":");
      if (d === date) chats.add(parseInt(chat));
    }
  } while (cursor);
  for (const c of chats) {
    await summariseChat(env, c, 1);
  }
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (
      url.pathname.startsWith("/tg/") &&
      url.pathname.endsWith("/webhook") &&
      req.method === "POST"
    ) {
      const token = url.pathname.split("/")[2];
      if (token !== env.TOKEN)
        return new Response("forbidden", { status: 403 });
      if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.SECRET)
        return new Response("forbidden", { status: 403 });
      const update = await req.json();
      ctx.waitUntil(handleUpdate(update, env));
      return Response.json({});
    }
    if (url.pathname === "/jobs/daily_summary" && req.method === "POST") {
      await dailySummary(env);
      return Response.json({});
    }
    return new Response("Not found", { status: 404 });
  },
};
