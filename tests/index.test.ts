import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import worker from "../src/index";
import { KVNamespace } from "@miniflare/kv";
import { MemoryStorage } from "@miniflare/storage-memory";
import { D1Database } from "@miniflare/d1";

interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
  DB: D1Database;
  AI: { run: (model: string, opts: any) => Promise<any> };
  TOKEN: string;
  SECRET: string;
  SUMMARY_MODEL: string;
  SUMMARY_PROMPT: string;
}

let env: Env;
let ctx: any;
let tasks: Promise<any>[];

beforeEach(async () => {
  tasks = [];
  ctx = { waitUntil: (p: Promise<any>) => tasks.push(p) };
  const history = new KVNamespace(new MemoryStorage());
  const counters = new KVNamespace(new MemoryStorage());
  const db = {
    prepare: vi.fn(() => ({ bind: () => ({ run: vi.fn() }) })),
  } as unknown as D1Database;
  env = {
    HISTORY: history,
    COUNTERS: counters,
    DB: db,
    AI: { run: vi.fn(async () => ({ response: "ok" })) },
    TOKEN: "t",
    SECRET: "s",
    SUMMARY_MODEL: "model",
    SUMMARY_PROMPT: "prompt",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webhook", () => {
  it("stores message and increments counter", async () => {
    const now = Math.floor(Date.now() / 1000);
    const update = {
      message: {
        message_id: 1,
        text: "hi",
        chat: { id: 1 },
        from: { id: 2, username: "u" },
        date: now,
      },
    };
    const req = new Request("http://localhost/tg/t/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "s",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(update),
    });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    await Promise.all(tasks);
    const msg = await env.HISTORY.get<any>(`msg:1:${now}:1`, { type: "json" });
    expect(msg?.text).toBe("hi");
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const cnt = await env.COUNTERS.get(`stats:1:2:${day}`);
    expect(cnt).toBe("1");
    const list = await env.COUNTERS.list({ prefix: `stats:1:2:` });
    expect(list.keys[0]?.expiration).toBeUndefined();
  });

  it("calls AI and sends summary", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const first = {
      message: {
        message_id: 1,
        text: "hi",
        chat: { id: 1 },
        from: { id: 2, username: "u" },
        date: now,
      },
    };
    const req1 = new Request("http://localhost/tg/t/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "s",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(first),
    });
    await worker.fetch(req1, env, ctx);
    await Promise.all(tasks);
    tasks = [];
    const cmd = {
      message: {
        message_id: 2,
        text: "/summary 1",
        chat: { id: 1 },
        from: { id: 2, username: "u" },
        date: now + 1,
      },
    };
    const req2 = new Request("http://localhost/tg/t/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "s",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cmd),
    });
    await worker.fetch(req2, env, ctx);
    await Promise.all(tasks);
    expect(env.AI.run).toHaveBeenCalledWith('model', {
      prompt: expect.stringContaining('4096'),
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('supports chat models', async () => {
    env.SUMMARY_MODEL = 'model-chat';
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const first = {
      message: {
        message_id: 1,
        text: 'hi',
        chat: { id: 1 },
        from: { id: 2, username: 'u' },
        date: now,
      },
    };
    const req1 = new Request('http://localhost/tg/t/webhook', {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 's',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(first),
    });
    await worker.fetch(req1, env, ctx);
    await Promise.all(tasks);
    tasks = [];
    const cmd = {
      message: {
        message_id: 2,
        text: '/summary 1',
        chat: { id: 1 },
        from: { id: 2, username: 'u' },
        date: now + 1,
      },
    };
    const req2 = new Request('http://localhost/tg/t/webhook', {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 's',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
    });
    await worker.fetch(req2, env, ctx);
    await Promise.all(tasks);
    expect(env.AI.run).toHaveBeenCalledWith('model-chat', {
      messages: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('4096') }),
      ]),
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});
