import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { D1Database } from '@cloudflare/workers-types';
import type { AdminDateRange } from '../src/api/admin-stats';
import { getAdminMemberStatsFromD1 } from '../src/features/stats/admin-member-d1';
import {
  DEFAULT_CHAT_SETTINGS,
  parseChatSettingsInput,
  readChatSettings,
  resetChatSettingsCache,
  saveChatSettings,
} from '../src/core/chat-settings';
import { handleAdminRequest } from '../src/api/admin';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { recordMessage } from '../src/api/update';
import { disableConsoleLogging } from './test-utils';

type SQLValue = null | number | string;

/** Minimal D1 over better-sqlite3 with the real migration DDL. */
class FakeStatement {
  params: SQLValue[] = [];
  constructor(private readonly sqlite: Database.Database, readonly sql: string) {}
  bind(...values: SQLValue[]): this {
    this.params = values;
    return this;
  }
  async all() {
    return { success: true, results: this.sqlite.prepare(this.sql).all(...this.params), meta: {} };
  }
  async first() {
    return this.sqlite.prepare(this.sql).get(...this.params) ?? null;
  }
  async run() {
    this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: {} };
  }
}

function createD1(): { db: D1Database; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const file of [
    '0009_stats_daily_aggregates.sql',
    '0011_stats_chat_user_profile.sql',
    '0014_app_settings.sql',
    '0015_stats_daily_media_max_duration.sql',
  ]) {
    for (const statement of readFileSync(join(dir, file), 'utf8').split(';')) {
      if (statement.trim()) sqlite.exec(statement);
    }
  }
  const db = {
    prepare: (sql: string) => new FakeStatement(sqlite, sql),
    batch: async (statements: FakeStatement[]) => Promise.all(statements.map((stmt) => stmt.all())),
  };
  return { db: db as unknown as D1Database, sqlite };
}

function insertDay(
  sqlite: Database.Database,
  row: { chat?: number; day: string; user: number; messages: number; words?: number; profanity?: number; criminal?: number },
): void {
  sqlite.prepare(
    `INSERT INTO stats_daily_user (chat_id, day, user_id, message_count, word_count, profanity_count, criminal_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.chat ?? -100, row.day, row.user, row.messages, row.words ?? 0, row.profanity ?? 0, row.criminal ?? 0);
}

function range(days: string[]): AdminDateRange {
  return { period: 'custom', from: days[0], to: days[days.length - 1], days };
}

function createKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async ({ prefix = '' }: { prefix?: string } = {}) => ({
      keys: [...store.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  };
}

beforeEach(() => {
  disableConsoleLogging();
  resetChatSettingsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAdminMemberStatsFromD1', () => {
  it('compares one participant with the whole chat for the same window', async () => {
    const { db, sqlite } = createD1();
    insertDay(sqlite, { day: '2026-10-01', user: 1, messages: 10, words: 50, profanity: 2 });
    insertDay(sqlite, { day: '2026-10-02', user: 1, messages: 20, words: 150, profanity: 4, criminal: 1 });
    insertDay(sqlite, { day: '2026-10-02', user: 2, messages: 50, words: 100 });
    insertDay(sqlite, { day: '2026-09-29', user: 1, messages: 6, words: 30 });
    insertDay(sqlite, { day: '2026-10-02', user: 1, messages: 99, chat: -200 });
    sqlite.prepare(
      `INSERT INTO stats_daily_bucket_user (chat_id, day, bucket, user_id, message_count) VALUES
       (-100, '2026-10-01', 'night', 1, 30), (-100, '2026-10-02', 'morning', 2, 50)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO stats_daily_profanity_word_user (chat_id, day, word, user_id, count) VALUES
       (-100, '2026-10-01', 'блин', 1, 4), (-100, '2026-10-02', 'жесть', 1, 2), (-100, '2026-10-02', 'блин', 2, 9)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO stats_chat_user_profile (chat_id, user_id, username, last_message_ts) VALUES (-100, 1, 'alice', 1790000000)`,
    ).run();

    const stats = await getAdminMemberStatsFromD1(db, -100, 1, range(['2026-10-01', '2026-10-02']));

    expect(stats.username).toBe('alice');
    expect(stats.firstSeenDay).toBe('2026-09-29');
    expect(stats.totals).toMatchObject({
      messages: 30, words: 200, wordsPerMessage: 6.7, profanity: 6, profanityRate: 3, criminal: 1, activeDays: 2,
    });
    expect(stats.previous).toEqual({ messages: 6, words: 30, profanity: 0 });
    expect(stats.chat).toMatchObject({ messages: 80, activeUsers: 2, rank: 2, share: 37.5 });
    expect(stats.daily.map((row) => row.messages)).toEqual([10, 20]);
    expect(stats.buckets.find((row) => row.bucket === 'night')).toMatchObject({ count: 30, chatCount: 30 });
    expect(stats.buckets.find((row) => row.bucket === 'morning')).toMatchObject({ count: 0, chatCount: 50 });
    expect(stats.topWords).toEqual([{ word: 'блин', count: 4 }, { word: 'жесть', count: 2 }]);
  });

  it('returns zeros and no rank for a silent participant', async () => {
    const { db } = createD1();
    const stats = await getAdminMemberStatsFromD1(db, -100, 7, range(['2026-10-01']));
    expect(stats.username).toBe('id7');
    expect(stats.totals.messages).toBe(0);
    expect(stats.totals.profanityRate).toBeNull();
    expect(stats.chat.rank).toBeNull();
    expect(stats.previous).toBeNull();
  });
});

describe('chat settings', () => {
  it('defaults to everything on and visible to members', async () => {
    const { db } = createD1();
    expect(await readChatSettings({ DB: db } as any, -100)).toMatchObject(DEFAULT_CHAT_SETTINGS);
  });

  it('round-trips a saved choice with the editor name', async () => {
    const { db } = createD1();
    const env = { DB: db } as any;
    await saveChatSettings(env, -100, {
      profanityEnabled: false, criminalEnabled: true, summaryEnabled: false, dashboardAccess: 'admins',
    }, 'Artur');
    resetChatSettingsCache();
    expect(await readChatSettings(env, -100)).toMatchObject({
      profanityEnabled: false, criminalEnabled: true, summaryEnabled: false, dashboardAccess: 'admins',
      updatedByName: 'Artur',
    });
    expect(await readChatSettings(env, -200)).toMatchObject(DEFAULT_CHAT_SETTINGS);
  });

  it('fails closed when the stored choice cannot be read', async () => {
    const env = { DB: { prepare: () => { throw new Error('d1 down'); } } } as any;
    expect(await readChatSettings(env, -100)).toMatchObject({
      profanityEnabled: false, criminalEnabled: false, summaryEnabled: false, dashboardAccess: 'admins',
    });
  });

  it('treats an unknown-version row as unreadable', async () => {
    const { db, sqlite } = createD1();
    sqlite.prepare(`INSERT INTO app_settings (scope, settings_json) VALUES ('chat:-100', '{"version":2}')`).run();
    expect(await readChatSettings({ DB: db } as any, -100)).toMatchObject({
      profanityEnabled: false, criminalEnabled: false, summaryEnabled: false, dashboardAccess: 'admins',
    });
  });

  it('rejects malformed payloads', () => {
    expect(() => parseChatSettingsInput({ ...DEFAULT_CHAT_SETTINGS, profanityEnabled: 'yes' })).toThrow();
    expect(() => parseChatSettingsInput({ ...DEFAULT_CHAT_SETTINGS, dashboardAccess: 'everyone' })).toThrow();
    expect(parseChatSettingsInput({ ...DEFAULT_CHAT_SETTINGS, extra: 1 })).toEqual(DEFAULT_CHAT_SETTINGS);
  });

  async function recordWithChatSettings(criminalEnabled: boolean) {
    const { db } = createD1();
    const analyzerFetch = vi.fn(async () => Response.json({ ok: true }));
    const background: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => background.push(promise) } as any;
    const env = {
      DB: db,
      TOKEN: 'live-token',
      RAW_MESSAGE_STORAGE_MODE: 'stats_only',
      ENABLE_ACTIVITY_TRACKING: false,
      ENABLE_PROFANITY_ANALYSIS: true,
      ENABLE_CRIMINAL_ANALYSIS: true,
      HISTORY: createKv(),
      COUNTERS: createKv(),
      CRIMINAL_CODE_ANALYZER_DO: {
        idFromName: vi.fn(() => 'analyzer-id'),
        get: vi.fn(() => ({ fetch: analyzerFetch })),
      },
    } as any;
    await saveChatSettings(env, -100, {
      profanityEnabled: false, criminalEnabled, summaryEnabled: true, dashboardAccess: 'members',
    }, 'Artur');
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await recordMessage({
        message_id: 1, date: 1790000000, text: 'обычный текст',
        chat: { id: -100, type: 'supergroup', title: 'Group' }, from: { id: 5, username: 'bob' },
      }, env, ctx);
      await Promise.allSettled(background);
    } finally {
      vi.unstubAllEnvs();
    }
    return analyzerFetch;
  }

  it('skips criminal analysis for a chat that turned it off', async () => {
    expect(await recordWithChatSettings(false)).not.toHaveBeenCalled();
  });

  it('still runs criminal analysis for a chat that keeps it on', async () => {
    expect(await recordWithChatSettings(true)).toHaveBeenCalled();
  });
});

describe('admin group endpoints', () => {
  const ADMIN_ID = 42;
  const MEMBER_ID = 43;

  async function setup() {
    const { db, sqlite } = createD1();
    const env = {
      DB: db,
      TOKEN: 'bot-token',
      SECRET: 'secret',
      HISTORY: createKv(),
      COUNTERS: createKv(),
    } as any;
    await env.HISTORY.put('admin_chat:-100', JSON.stringify({ chatId: -100, title: 'Group', lastSeenAt: 10 }));
    insertDay(sqlite, { day: new Date().toISOString().slice(0, 10), user: MEMBER_ID, messages: 3 });
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
      if (String(input).includes('/getChatMember')) {
        const body = JSON.parse(init?.body || '{}');
        const status = body.user_id === ADMIN_ID ? 'administrator' : 'member';
        return Response.json({ ok: true, result: { status } });
      }
      return new Response(null, { status: 200 });
    });
    return { env, sqlite };
  }

  async function request(env: any, userId: number, path: string, init: RequestInit = {}) {
    const cookie = await createTelegramSessionCookie(env, {
      id: userId, first_name: 'User', username: `user${userId}`, auth_date: Math.floor(Date.now() / 1000),
    });
    return handleAdminRequest(new Request(`https://bot.example${path}`, {
      ...init,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(init.headers || {}) },
    }), env);
  }

  it('lists chats with role, seven-day pulse and module switches', async () => {
    const { env } = await setup();
    const body = await (await request(env, MEMBER_ID, '/admin/api/chats')).json() as any;
    expect(body.chats).toEqual([expect.objectContaining({
      chatId: -100,
      role: 'member',
      pulse: expect.objectContaining({ messages: 3, activeUsers: 1 }),
      settings: DEFAULT_CHAT_SETTINGS,
    })]);
  });

  it('lets only administrators change chat settings', async () => {
    const { env } = await setup();
    const payload = JSON.stringify({ ...DEFAULT_CHAT_SETTINGS, profanityEnabled: false });

    const denied = await request(env, MEMBER_ID, '/admin/api/chat-settings?chatId=-100', { method: 'POST', body: payload });
    expect(denied.status).toBe(403);

    const saved = await request(env, ADMIN_ID, '/admin/api/chat-settings?chatId=-100', { method: 'POST', body: payload });
    expect(saved.status).toBe(200);
    expect((await saved.json() as any).settings.profanityEnabled).toBe(false);

    const read = await (await request(env, MEMBER_ID, '/admin/api/chat-settings?chatId=-100')).json() as any;
    expect(read).toMatchObject({ canEdit: false, settings: { profanityEnabled: false } });
  });

  it('hides an administrators-only dashboard from regular members', async () => {
    const { env } = await setup();
    await request(env, ADMIN_ID, '/admin/api/chat-settings?chatId=-100', {
      method: 'POST', body: JSON.stringify({ ...DEFAULT_CHAT_SETTINGS, dashboardAccess: 'admins' }),
    });

    const memberChats = await (await request(env, MEMBER_ID, '/admin/api/chats')).json() as any;
    expect(memberChats.chats).toEqual([]);
    expect((await request(env, MEMBER_ID, `/admin/api/member?chatId=-100&userId=${MEMBER_ID}&period=week`)).status).toBe(403);

    const adminChats = await (await request(env, ADMIN_ID, '/admin/api/chats')).json() as any;
    expect(adminChats.chats).toHaveLength(1);
    const member = await request(env, ADMIN_ID, `/admin/api/member?chatId=-100&userId=${MEMBER_ID}&period=week`);
    expect(member.status).toBe(200);
    expect((await member.json() as any).totals.messages).toBe(3);
  });
});
