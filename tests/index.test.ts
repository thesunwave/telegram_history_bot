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
  SUMMARY_CHUNK_SIZE?: number;
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
    SUMMARY_CHUNK_SIZE: undefined,
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webhook", () => {
  it("stores message and increments counter", async () => {
    const now = Math.floor(Date.now() / 1000) - 10;
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
    expect(env.AI.run).toHaveBeenCalledWith("model", {
      prompt: expect.stringContaining("4096"),
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("supports chat models", async () => {
    env.SUMMARY_MODEL = "model-chat";
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
    expect(env.AI.run).toHaveBeenCalledWith("model-chat", {
      messages: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("4096") }),
      ]),
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('summarises last N messages', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const msgs = ['first', 'second', 'third'];
    for (let i = 0; i < msgs.length; i++) {
      const upd = {
        message: {
          message_id: i + 1,
          text: msgs[i],
          chat: { id: 1 },
          from: { id: 2, username: 'u' },
          date: now + i,
        },
      };
      const req = new Request('http://localhost/tg/t/webhook', {
        method: 'POST',
        headers: {
          'X-Telegram-Bot-Api-Secret-Token': 's',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(upd),
      });
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      tasks = [];
    }
    const cmd = {
      message: {
        message_id: 4,
        text: '/summary_last 2',
        chat: { id: 1 },
        from: { id: 2, username: 'u' },
        date: now + 3,
      },
    };
    const req2 = new Request('http://localhost/tg/t/webhook', {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 's',
        'Content-Type': 'application/json',

  it("summarizes long history in chunks", async () => {
    env.SUMMARY_CHUNK_SIZE = 80;
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const m = {
      message: {
        message_id: 1,
        text: "a".repeat(150),
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
      body: JSON.stringify(m),
    });
    await worker.fetch(req, env, ctx);
    await Promise.all(tasks);
    tasks = [];
    const cmd = {
      message: {
        message_id: 2,
        text: "/summary 1",
        chat: { id: 1 },
        from: { id: 2, username: "u" },
        date: now + 3,
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

    const call = (env.AI.run as any).mock.calls.at(-1)[1];
    const text = call.prompt ?? call.messages[1].content;
    const lines = text.split('\n').filter((l: string) => l.startsWith('u:'));
    expect(lines).toHaveLength(2);
    expect(lines.at(-1)).toContain('third');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('shows usernames in /top and handles rename', async () => {
    expect(env.AI.run).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows usernames in /top and handles rename", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const first = {
      message: {
        message_id: 1,
        text: "hi",
        chat: { id: 1 },
        from: { id: 2, username: "foo" },
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
    const topCmd = {
      message: {
        message_id: 2,
        text: "/top",
        chat: { id: 1 },
        from: { id: 3, username: "caller" },
        date: now + 1,
      },
    };
    const req2 = new Request("http://localhost/tg/t/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "s",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(topCmd),
    });
    await worker.fetch(req2, env, ctx);
    await Promise.all(tasks);
    let body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    expect(body.text).toContain("foo: 1");
    tasks = [];
    const second = {
      message: {
        message_id: 3,
        text: "hey",
        chat: { id: 1 },
        from: { id: 2, username: "bar" },
        date: now + 2,
      },
    };
    const req3 = new Request("http://localhost/tg/t/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "s",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(second),
    });
    await worker.fetch(req3, env, ctx);
    await Promise.all(tasks);
    tasks = [];
    const topCmd2 = {
      message: {
        message_id: 4,
        text: "/top",
        chat: { id: 1 },
        from: { id: 3, username: "caller" },
        date: now + 3,
      },
    };
    const req4 = new Request("http://localhost/tg/t/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "s",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(topCmd2),
    });
    await worker.fetch(req4, env, ctx);
    await Promise.all(tasks);
    body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    expect(body.text).toContain("bar: 2");
  });
});
