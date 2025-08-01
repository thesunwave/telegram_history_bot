import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker, { CountersDO } from '../src/index';
import { KVNamespace } from '@miniflare/kv';
import { MemoryStorage } from '@miniflare/storage-memory';
import { D1Database } from '@miniflare/d1';
import { WEEK_DAYS } from '../src/env';

function createCountersNamespace(env: Env) {
  const objects = new Map<string, { obj: CountersDO; chain: Promise<any> }>();
  return {
    idFromName(name: string) {
      return name as any;
    },
    get(id: string) {
      let entry = objects.get(id);
      if (!entry) {
        const state = {
          blockConcurrencyWhile: async (fn: () => Promise<any>) => await fn(),
        } as any;
        entry = { obj: new CountersDO(state, env), chain: Promise.resolve() };
        objects.set(id, entry);
      }
      return {
        fetch: (url: string, init?: RequestInit) => {
          entry!.chain = entry!.chain.then(() =>
            entry!.obj.fetch(new Request(url, init)),
          );
          return entry!.chain;
        },
      } as any;
    },
  };
}

interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
  COUNTERS_DO: any;
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
    prepare: vi.fn(() => ({
      bind: () => ({
        run: vi.fn(),
        all: vi.fn(async () => ({ results: [] })),
      }),
    })),
  } as unknown as D1Database;
  env = {
    HISTORY: history,
    COUNTERS: counters,
    COUNTERS_DO: {} as any,
    DB: db,
    AI: { run: vi.fn(async () => ({ response: "ok" })) },
    TOKEN: "t",
    SECRET: "s",
    SUMMARY_MODEL: "model",
    SUMMARY_PROMPT: "prompt",
    SUMMARY_CHUNK_SIZE: undefined,
  };
  env.COUNTERS_DO = createCountersNamespace(env);
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
    const activity = await env.COUNTERS.get(`activity:1:${day}`);
    expect(activity).toBe("1");
    const list = await env.COUNTERS.list({ prefix: `stats:1:2:` });
    expect(list.keys[0]?.expiration).toBeUndefined();
  });

  it('increments counters atomically', async () => {
    const now = Math.floor(Date.now() / 1000);
    const upd1 = {
      message: {
        message_id: 1,
        text: 'a',
        chat: { id: 1 },
        from: { id: 2, username: 'u' },
        date: now,
      },
    };
    const upd2 = {
      message: {
        message_id: 2,
        text: 'b',
        chat: { id: 1 },
        from: { id: 2, username: 'u' },
        date: now + 1,
      },
    };
    const req1 = new Request('http://localhost/tg/t/webhook', {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 's',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upd1),
    });
    const req2 = new Request('http://localhost/tg/t/webhook', {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 's',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upd2),
    });
    await Promise.all([worker.fetch(req1, env, ctx), worker.fetch(req2, env, ctx)]);
    await Promise.all(tasks);
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const cnt = await env.COUNTERS.get(`stats:1:2:${day}`);
    expect(cnt).toBe('2');
  });

  it('ignores messages from bots', async () => {
    const now = Math.floor(Date.now() / 1000);
    const update = {
      message: {
        message_id: 1,
        text: 'hi',
        chat: { id: 1 },
        from: { id: 2, username: 'bot', is_bot: true },
        date: now,
      },
    };
    const req = new Request('http://localhost/tg/t/webhook', {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 's',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(update),
    });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    await Promise.all(tasks);
    const msg = await env.HISTORY.get(`msg:1:${now}:1`);
    expect(msg).toBeNull();
    const day = new Date(now * 1000).toISOString().slice(0, 10);
    const cnt = await env.COUNTERS.get(`stats:1:2:${day}`);
    expect(cnt).toBeNull();
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
    expect(env.AI.run).toHaveBeenCalledWith(
      "model",
      expect.objectContaining({ prompt: expect.stringContaining("4096") }),
    );
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
    expect(env.AI.run).toHaveBeenCalledWith(
      "model-chat",
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining("4096") }),
        ]),
      }),
    );
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

  it('shows activity graph for week', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 3; i++) {
      const upd = {
        message: {
          message_id: i + 1,
          text: 'hi',
          chat: { id: 1 },
          from: { id: 2, username: 'u' },
          date: now - i * 86400,
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
        message_id: 10,
        text: '/activity_week',
        chat: { id: 1 },
        from: { id: 3, username: 'c' },
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
    const msgCall = fetchMock.mock.calls.at(-2);
    expect(msgCall[0]).toContain('/sendMessage');
    const text = JSON.parse(msgCall[1].body).text;
    expect(text).not.toContain('Total:');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(7);
    const photoCall = fetchMock.mock.calls.at(-1);
    expect(photoCall[0]).toContain('/sendPhoto');
  });

  it('shows activity chart by user', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const users = [
      { id: 2, username: 'a' },
      { id: 3, username: 'b' },
    ];
    for (const u of users) {
      const upd = {
        message: {
          message_id: u.id,
          text: 'hi',
          chat: { id: 1 },
          from: u,
          date: now,
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
        message_id: 10,
        text: '/activity_users_week',
        chat: { id: 1 },
        from: { id: 4, username: 'c' },
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
    const call = fetchMock.mock.calls.at(-1);
    expect(call[0]).toContain('/sendPhoto');
    const body = JSON.parse(call[1].body);
    expect(body.photo).toContain('quickchart.io');
    const encoded = body.photo.split('?c=')[1];
    const chart = JSON.parse(decodeURIComponent(encoded));
    const today = new Date((now + 1) * 1000);
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - WEEK_DAYS);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = today.toISOString().slice(0, 10);
    expect(chart.options.plugins.title.text).toBe(`${startStr} - ${endStr}`);
    expect(chart.options.plugins.datalabels.anchor).toBe('end');
    expect(chart.options.plugins.datalabels.align).toBe('top');
  });

  it('shows monthly activity chart by user', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const user = { id: 2, username: 'a' };
    for (let i = 0; i < 2; i++) {
      const upd = {
        message: {
          message_id: i + 1,
          text: 'hi',
          chat: { id: 1 },
          from: user,
          date: now - i * 20 * 86400,
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
        message_id: 10,
        text: '/activity_users_month',
        chat: { id: 1 },
        from: { id: 3, username: 'b' },
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
    const call = fetchMock.mock.calls.at(-1);
    expect(call[0]).toContain('/sendPhoto');
    const body = JSON.parse(call[1].body);
    expect(body.photo).toContain('quickchart.io');
  });

  it('sanitizes labels in user activity charts', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const upd = {
      message: {
        message_id: 1,
        text: 'hi',
        chat: { id: 1 },
        from: { id: 2, username: 'bad"name' },
        date: now,
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
    const cmd = {
      message: {
        message_id: 2,
        text: '/activity_users_week',
        chat: { id: 1 },
        from: { id: 3, username: 'c' },
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
    const call = fetchMock.mock.calls.at(-1);
    const body = JSON.parse(call[1].body);
    const encoded = body.photo.split('?c=')[1];
    const chart = JSON.parse(decodeURIComponent(encoded));
    expect(chart.data.labels[0]).toBe('badname');
  });

  it('responds with help text', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const now = Math.floor(Date.now() / 1000);
    const cmd = {
      message: {
        message_id: 1,
        text: '/help',
        chat: { id: 1 },
        from: { id: 2, username: 'u' },
        date: now,
      },
    };
    const req = new Request('http://localhost/tg/t/webhook', {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 's',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cmd),
    });
    await worker.fetch(req, env, ctx);
    await Promise.all(tasks);
    const call = fetchMock.mock.calls.at(-1);
    expect(call[0]).toContain('/sendMessage');
    const text = JSON.parse(call[1].body).text;
    expect(text).toContain('/summary');
  });
});

describe('cron', () => {
  it('runs daily summary on schedule', async () => {
    const spy = vi
      .spyOn(await import('../src/stats'), 'dailySummary')
      .mockResolvedValue(undefined);
    const event: ScheduledEvent = {
      scheduledTime: Date.now(),
      cron: '* * * * *',
      noRetry: () => {},
      waitUntil: () => {},
    } as ScheduledEvent;
    await worker.scheduled(event, env, ctx);
    expect(spy).toHaveBeenCalled();
  });
});
