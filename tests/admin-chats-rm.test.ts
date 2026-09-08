/**
 * Regression tests for the admin-chats Telegram error-handling bug.
 *
 * Background: `isTelegramUserInChat` / `isTelegramUserChatAdmin` previously
 * collapsed any Telegram API error (non-2xx, network/timeout) into a
 * definitive `false` — the same value used for a genuine "user is not a
 * member" verdict. Telegram never reports non-membership via a non-2xx;
 * `left`/`kicked` arrive on the success path (HTTP 200) as `result.status`.
 * The conflated `false` caused:
 *   - `listAdminChatsForTelegramUser` to silently drop chats from the admin
 *     list during transient Telegram errors (symptom A).
 *   - `requireTelegramChatAccess` to return `403 "chat is not available for
 *     this Telegram user"` when Telegram couldn't answer (symptom B).
 *
 * The fix reserves `false` for genuine membership verdicts (HTTP 200 with
 * `result.status` not in the allowed set) and throws on Telegram errors so
 * callers can distinguish "not a member" from "couldn't verify":
 *   - The listing caller keeps metadata-backed chats whose membership check is
 *     indeterminate, but counter-only fallback IDs still require positive
 *     membership verification; chat-scoped endpoints remain the authorization
 *     boundary and re-check access.
 *   - The admin access guards let the throw propagate to the admin error
 *     boundary in `src/index.ts`, which returns a 503 with a requestId.
 *   - The capability-flag caller (`handleNotificationGet`) and the webhook
 *     command caller (`canEditAutoNotifications`) catch locally to preserve
 *     graceful degradation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTelegramUserInChat,
  isTelegramUserChatAdmin,
  listAdminChats,
  listAdminChatsForTelegramUser,
  saveAdminChatMeta,
} from '../src/api/admin-chats';
import { createTelegramSessionCookie } from '../src/api/admin-auth';
import { handleUpdate } from '../src/api/update';
import worker from '../src/index';
import { createMockEnv, disableConsoleLogging } from './test-utils';

vi.mock('../src/core/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue('123'),
}));

vi.mock('../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

let env: ReturnType<typeof createMockEnv>;
const ctx: any = { waitUntil: () => {} };

beforeEach(() => {
  disableConsoleLogging();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  env = createMockEnv({
    TOKEN: 't',
    SECRET: 's',
    TELEGRAM_BOT_USERNAME: 'test_bot',
    DEBUG_LOGS: 'false',
  });
});

async function adminSessionCookie(userId = 42): Promise<string> {
  return await createTelegramSessionCookie(env, {
    id: userId,
    first_name: 'Admin',
    username: 'admin_user',
    auth_date: Math.floor(Date.now() / 1000),
  });
}

function mockGetChatMemberByChatId(
  resolver: (chatId: number) => Response,
) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    if (String(input).includes('/getChatMember')) {
      const body = JSON.parse(init?.body || '{}');
      return resolver(Number(body.chat_id));
    }
    return new Response(null, { status: 200 });
  });
}

function memberResponse(): Response {
  return Response.json({ ok: true, result: { user: { id: 42 }, status: 'member' } });
}

function adminResponse(): Response {
  return Response.json({ ok: true, result: { user: { id: 42 }, status: 'administrator' } });
}

function statusResponse(status: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: true, result: { user: { id: 42 }, status, ...extra } });
}

function errorResponse(status: number, description = 'error'): Response {
  return new Response(
    JSON.stringify({ ok: false, description }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeEmptyD1() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
        first: vi.fn(async () => null),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
    batch: vi.fn(async (statements: unknown[]) =>
      Array.from({ length: statements.length }, () => ({ results: [] })),
    ),
  } as any;
}

async function saveChat(chatId: number, title: string, lastSeenAt = 10): Promise<void> {
  await saveAdminChatMeta(env, { id: chatId, title, type: 'supergroup' }, lastSeenAt);
}

describe('isTelegramUserInChat — genuine membership verdicts (no regression)', () => {
  it('returns true for HTTP 200 with status "creator"', async () => {
    mockGetChatMemberByChatId(() => statusResponse('creator'));
    expect(await isTelegramUserInChat(env, -1, 42)).toBe(true);
  });

  it('returns true for HTTP 200 with status "administrator"', async () => {
    mockGetChatMemberByChatId(() => statusResponse('administrator'));
    expect(await isTelegramUserInChat(env, -1, 42)).toBe(true);
  });

  it('returns true for HTTP 200 with status "member"', async () => {
    mockGetChatMemberByChatId(() => memberResponse());
    expect(await isTelegramUserInChat(env, -1, 42)).toBe(true);
  });

  it('returns true for HTTP 200 with status "restricted" when is_member is true', async () => {
    mockGetChatMemberByChatId(() => statusResponse('restricted', { is_member: true }));
    expect(await isTelegramUserInChat(env, -1, 42)).toBe(true);
  });

  it('returns false for HTTP 200 with status "restricted" when is_member is false', async () => {
    mockGetChatMemberByChatId(() => statusResponse('restricted', { is_member: false }));
    expect(await isTelegramUserInChat(env, -1, 42)).toBe(false);
  });

  it('returns false for HTTP 200 with status "left" (genuine non-membership)', async () => {
    mockGetChatMemberByChatId(() => statusResponse('left'));
    expect(await isTelegramUserInChat(env, -1, 42)).toBe(false);
  });

  it('returns false for HTTP 200 with status "kicked" (genuine non-membership)', async () => {
    mockGetChatMemberByChatId(() => statusResponse('kicked'));
    expect(await isTelegramUserInChat(env, -1, 42)).toBe(false);
  });

  it('returns false when env.TOKEN is falsy without calling Telegram', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const tokenless = { ...env, TOKEN: '' } as any;
    expect(await isTelegramUserInChat(tokenless, -1, 42)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('isTelegramUserInChat — Telegram errors now propagate (bug fix)', () => {
  it('throws on a transient 429 rate-limit instead of returning false', async () => {
    mockGetChatMemberByChatId(() => errorResponse(429, 'Too Many Requests: retry after 5'));
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 429/);
  });

  it('throws on a transient 5xx server error instead of returning false', async () => {
    mockGetChatMemberByChatId(() => errorResponse(500, 'Bad Request: internal server error'));
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 500/);
  });

  it('throws on a 502 bad gateway instead of returning false', async () => {
    mockGetChatMemberByChatId(() => errorResponse(502, 'Bad Gateway'));
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 502/);
  });

  it('throws on a 503 service unavailable instead of returning false', async () => {
    mockGetChatMemberByChatId(() => errorResponse(503, 'Service Unavailable'));
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 503/);
  });

  it('throws on a 403 (bot removed from supergroup) instead of returning false', async () => {
    mockGetChatMemberByChatId(() =>
      errorResponse(403, 'Forbidden: bot is not a member of the supergroup chat'),
    );
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 403/);
  });

  it('throws on a network/timeout error instead of returning false', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('network reset');
    });
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow('network reset');
  });

  it('throws on an HTTP 200 response without a membership status', async () => {
    mockGetChatMemberByChatId(() => Response.json({ ok: true, result: {} }));
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow(
      'getChatMember invalid response',
    );
  });

  it('throws on an unknown membership status', async () => {
    mockGetChatMemberByChatId(() => statusResponse('unknown'));
    await expect(isTelegramUserInChat(env, -1, 42)).rejects.toThrow(
      'getChatMember unknown status',
    );
  });
});

describe('isTelegramUserChatAdmin — genuine admin verdicts (no regression)', () => {
  it('returns true for HTTP 200 with status "creator"', async () => {
    mockGetChatMemberByChatId(() => statusResponse('creator'));
    expect(await isTelegramUserChatAdmin(env, -1, 42)).toBe(true);
  });

  it('returns true for HTTP 200 with status "administrator"', async () => {
    mockGetChatMemberByChatId(() => adminResponse());
    expect(await isTelegramUserChatAdmin(env, -1, 42)).toBe(true);
  });

  it('returns false for HTTP 200 with status "member" (non-admin member)', async () => {
    mockGetChatMemberByChatId(() => memberResponse());
    expect(await isTelegramUserChatAdmin(env, -1, 42)).toBe(false);
  });

  it('returns false for HTTP 200 with status "left" (genuine non-member)', async () => {
    mockGetChatMemberByChatId(() => statusResponse('left'));
    expect(await isTelegramUserChatAdmin(env, -1, 42)).toBe(false);
  });

  it('returns false for HTTP 200 with status "kicked" (genuine non-member)', async () => {
    mockGetChatMemberByChatId(() => statusResponse('kicked'));
    expect(await isTelegramUserChatAdmin(env, -1, 42)).toBe(false);
  });

  it('returns false when env.TOKEN is falsy without calling Telegram', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const tokenless = { ...env, TOKEN: '' } as any;
    expect(await isTelegramUserChatAdmin(tokenless, -1, 42)).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('isTelegramUserChatAdmin — Telegram errors now propagate (bug fix)', () => {
  it('throws on a transient 429 rate-limit instead of returning false', async () => {
    mockGetChatMemberByChatId(() => errorResponse(429, 'Too Many Requests: retry after 5'));
    await expect(isTelegramUserChatAdmin(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 429/);
  });

  it('throws on a 5xx server error instead of returning false', async () => {
    mockGetChatMemberByChatId(() => errorResponse(500, 'internal server error'));
    await expect(isTelegramUserChatAdmin(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 500/);
  });

  it('throws on a 403 (bot removed) instead of returning false', async () => {
    mockGetChatMemberByChatId(() => errorResponse(403, 'bot is not a member'));
    await expect(isTelegramUserChatAdmin(env, -1, 42)).rejects.toThrow(/getChatMember HTTP 403/);
  });

  it('throws on a network/timeout error instead of returning false', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('network timeout');
    });
    await expect(isTelegramUserChatAdmin(env, -1, 42)).rejects.toThrow('network timeout');
  });

  it('throws on an HTTP 200 response without a membership status', async () => {
    mockGetChatMemberByChatId(() => Response.json({ ok: true, result: {} }));
    await expect(isTelegramUserChatAdmin(env, -1, 42)).rejects.toThrow(
      'getChatMember invalid response',
    );
  });
});

describe('listAdminChatsForTelegramUser — tolerate indeterminate membership (symptom A fix)', () => {
  it('keeps the chat whose membership check returns 429', async () => {
    await saveChat(-1001, 'Group One', 10);
    await saveChat(-1002, 'Group Two', 20);
    mockGetChatMemberByChatId((chatId) =>
      chatId === -1001 ? memberResponse() : errorResponse(429, 'Too Many Requests'),
    );

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats.map((c) => c.title)).toEqual(['Group Two', 'Group One']);
  });

  it('keeps the chat whose membership check returns 5xx', async () => {
    await saveChat(-1001, 'Group One', 10);
    await saveChat(-1002, 'Group Two', 20);
    mockGetChatMemberByChatId((chatId) =>
      chatId === -1001 ? memberResponse() : errorResponse(500, 'internal server error'),
    );

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats.map((c) => c.title)).toEqual(['Group Two', 'Group One']);
  });

  it('keeps the chat whose membership check throws a network error', async () => {
    await saveChat(-1001, 'Group One', 10);
    await saveChat(-1002, 'Group Two', 20);
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
      if (String(input).includes('/getChatMember')) {
        const body = JSON.parse(init?.body || '{}');
        if (body.chat_id === -1001) return memberResponse();
        throw new Error('network reset');
      }
      return new Response(null, { status: 200 });
    });

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats.map((c) => c.title)).toEqual(['Group Two', 'Group One']);
  });

  it('keeps all chats when every membership check is indeterminate', async () => {
    await saveChat(-1001, 'Group One', 20);
    await saveChat(-1002, 'Group Two', 10);
    mockGetChatMemberByChatId(() => errorResponse(429, 'Too Many Requests'));

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats.map((c) => c.title)).toEqual(['Group One', 'Group Two']);
  });

  it('still filters out chats on genuine non-membership', async () => {
    await saveChat(-1001, 'Allowed', 2);
    await saveChat(-1002, 'Left', 1);
    mockGetChatMemberByChatId((chatId) =>
      chatId === -1001 ? memberResponse() : statusResponse('left'),
    );

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats.map((c) => c.title)).toEqual(['Allowed']);
  });

  it('mixed outcome keeps confirmed and indeterminate chats but filters non-members', async () => {
    await saveChat(-1001, 'Member', 30);
    await saveChat(-1002, 'Errored', 20);
    await saveChat(-1003, 'Left', 10);
    mockGetChatMemberByChatId((chatId) => {
      if (chatId === -1001) return memberResponse();
      if (chatId === -1002) return errorResponse(500, 'internal server error');
      return statusResponse('left');
    });

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats.map((c) => c.title)).toEqual(['Member', 'Errored']);
  });

  it('omits an indeterminate counter-only fallback chat', async () => {
    await env.COUNTERS.put('stats_v2:184486882:2026-09-01:42', '1');
    mockGetChatMemberByChatId(() => errorResponse(429, 'Too Many Requests'));

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats).toEqual([]);
  });

  it('keeps a counter-only fallback chat when membership is positively verified', async () => {
    await env.COUNTERS.put('stats_v2:-1002860305983:2026-09-01:42', '1');
    mockGetChatMemberByChatId(() => memberResponse());

    const chats = await listAdminChatsForTelegramUser(env, 42);

    expect(chats).toEqual([{
      chatId: -1002860305983,
      title: 'Chat -1002860305983',
      lastSeenAt: 0,
    }]);
  });

  it('returns an empty list when there are no stored chats', async () => {
    mockGetChatMemberByChatId(() => memberResponse());
    const chats = await listAdminChatsForTelegramUser(env, 42);
    expect(chats).toEqual([]);
  });
});

describe('/admin/api/chats — one Telegram failure does not break the whole list', () => {
  it('returns 200 with verified and indeterminate chats so the dashboard can continue loading', async () => {
    await saveChat(-1001, 'Working Group', 20);
    await saveChat(-1002, 'Temporarily Unverifiable', 10);
    mockGetChatMemberByChatId((chatId) =>
      chatId === -1001 ? memberResponse() : errorResponse(429, 'Too Many Requests'),
    );

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request('http://localhost/admin/api/chats', {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.chats.map((chat: any) => chat.title)).toEqual([
      'Working Group',
      'Temporarily Unverifiable',
    ]);
  });

  it('allows stats loading when only the listing membership check is transiently unavailable', async () => {
    const chatId = -1001;
    await saveChat(chatId, 'Working Group', 20);

    let getChatMemberCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        getChatMemberCalls += 1;
        return getChatMemberCalls === 1
          ? errorResponse(429, 'Too Many Requests')
          : memberResponse();
      }
      return new Response(null, { status: 200 });
    });

    const cookie = await adminSessionCookie();
    const chatsResponse = await worker.fetch(
      new Request('http://localhost/admin/api/chats', {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(chatsResponse.status).toBe(200);
    const chatsBody = (await chatsResponse.json()) as any;
    expect(chatsBody.chats.map((chat: any) => chat.title)).toEqual(['Working Group']);

    env.DB = makeEmptyD1();
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 1);
    const dayStr = day.toISOString().slice(0, 10);
    const statsResponse = await worker.fetch(
      new Request(
        `http://localhost/admin/api/chat?chatId=${chatId}&period=custom&from=${dayStr}&to=${dayStr}`,
        { headers: { Cookie: cookie } },
      ),
      env,
      ctx,
    );

    expect(statsResponse.status).toBe(200);
    const statsBody = (await statsResponse.json()) as any;
    expect(statsBody.chatId).toBe(chatId);
    expect(getChatMemberCalls).toBe(2);
  });
});

describe('/admin/api/criminal-violations', () => {
  it.each(['0', '1.5', '9007199254740992'])(
    'rejects invalid chatId %s before Telegram membership lookup',
    async (chatId) => {
      let membershipChecks = 0;
      mockGetChatMemberByChatId(() => {
        membershipChecks += 1;
        return memberResponse();
      });
      const cookie = await adminSessionCookie();

      const response = await worker.fetch(
        new Request(
          `http://localhost/admin/api/criminal-violations?chatId=${chatId}&userId=77&period=today`,
          { headers: { Cookie: cookie } },
        ),
        env,
        ctx,
      );

      expect(response.status).toBe(400);
      expect(membershipChecks).toBe(0);
    },
  );

  it.each(['0', '-1', '1.5', '9007199254740992'])(
    'rejects invalid userId %s before Telegram membership lookup',
    async (userId) => {
      let membershipChecks = 0;
      mockGetChatMemberByChatId(() => {
        membershipChecks += 1;
        return memberResponse();
      });
      const cookie = await adminSessionCookie();

      const response = await worker.fetch(
        new Request(
          `http://localhost/admin/api/criminal-violations?chatId=-1001&userId=${userId}&period=today`,
          { headers: { Cookie: cookie } },
        ),
        env,
        ctx,
      );

      expect(response.status).toBe(400);
      expect(membershipChecks).toBe(0);
    },
  );

  it('returns bounded violation details only after Telegram chat membership is verified', async () => {
    const chatId = -1001;
    mockGetChatMemberByChatId(() => memberResponse());
    env.DB = makeEmptyD1();
    const cookie = await adminSessionCookie();
    const day = new Date();
    day.setUTCDate(day.getUTCDate() - 1);
    const dayStr = day.toISOString().slice(0, 10);

    const response = await worker.fetch(
      new Request(
        `http://localhost/admin/api/criminal-violations?chatId=${chatId}&userId=77&period=custom&from=${dayStr}&to=${dayStr}`,
        { headers: { Cookie: cookie } },
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as any;
    expect(body).toMatchObject({
      chatId,
      userId: 77,
      range: { from: dayStr, to: dayStr },
      violations: [],
      hasMore: false,
    });
  });

  it('lets unexpected detail failures reach the global admin boundary with a requestId', async () => {
    const chatId = -1001;
    mockGetChatMemberByChatId(() => memberResponse());
    env.DB = {
      prepare: vi.fn(() => {
        throw new Error('simulated detail query defect');
      }),
    } as any;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cookie = await adminSessionCookie();

    const response = await worker.fetch(
      new Request(
        `http://localhost/admin/api/criminal-violations?chatId=${chatId}&userId=77&period=today`,
        { headers: { Cookie: cookie } },
      ),
      env,
      ctx,
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe('ADMIN_UNAVAILABLE');
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(consoleError).toHaveBeenCalledWith(
      'Admin request failed with unhandled exception',
      expect.objectContaining({
        requestId: body.error.requestId,
        pathname: '/admin/api/criminal-violations',
        errorName: 'Error',
      }),
    );
  });
});

describe('requireTelegramChatAccess via worker.fetch — 503 on transient Telegram error (symptom B fix)', () => {
  it('returns 503 (not 403) when the per-chat getChatMember 429s after the listing succeeded', async () => {
    const chatId = -1001;
    await saveChat(chatId, 'Real Group', 10);

    let getChatMemberCalls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        getChatMemberCalls += 1;
        if (getChatMemberCalls === 1) {
          return memberResponse();
        }
        return errorResponse(429, 'Too Many Requests: retry after 5');
      }
      return new Response(null, { status: 200 });
    });

    expect(
      (await listAdminChatsForTelegramUser(env, 42)).map((c) => c.title),
    ).toContain('Real Group');

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/chat?chatId=${chatId}&period=today`, {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as any;
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('ADMIN_UNAVAILABLE');
    expect(body.error.message).toBe('Admin service is temporarily unavailable.');
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('returns 503 when the per-chat getChatMember 5xx errors', async () => {
    const chatId = -1002;
    await saveChat(chatId, 'Real Group', 10);
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        return errorResponse(500, 'internal server error');
      }
      return new Response(null, { status: 200 });
    });

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/chat?chatId=${chatId}&period=today`, {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe('ADMIN_UNAVAILABLE');
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('still returns 403 for genuine non-membership (left) — no regression', async () => {
    const chatId = -1003;
    await saveChat(chatId, 'Real Group', 10);
    mockGetChatMemberByChatId(() => statusResponse('left'));

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/chat?chatId=${chatId}&period=today`, {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'chat is not available for this Telegram user',
    });
  });

  it('still returns 403 for genuine non-membership (kicked) — no regression', async () => {
    const chatId = -1004;
    await saveChat(chatId, 'Real Group', 10);
    mockGetChatMemberByChatId(() => statusResponse('kicked'));

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/chat?chatId=${chatId}&period=today`, {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(403);
  });
});

describe('requireTelegramChatAdmin via worker.fetch — 503 on transient Telegram error', () => {
  it('returns 503 (not 403) when getChatMember (admin check) 429s for a POST', async () => {
    const chatId = -1005;
    await saveChat(chatId, 'Real Group', 10);

    let call = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        call += 1;
        if (call === 1) return memberResponse();
        return errorResponse(429, 'Too Many Requests');
      }
      return new Response(null, { status: 200 });
    });

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/notifications?chatId=${chatId}`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true, notifications: { daily_summary: { enabled: true } } }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as any;
    expect(body.error.code).toBe('ADMIN_UNAVAILABLE');
  });

  it('still returns 403 for a non-admin member on POST — no regression', async () => {
    const chatId = -1006;
    await saveChat(chatId, 'Real Group', 10);
    mockGetChatMemberByChatId(() => memberResponse());

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/notifications?chatId=${chatId}`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: true, notifications: { daily_summary: { enabled: true } } }),
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'only chat administrators can edit notification settings',
    });
  });
});

describe('handleNotificationGet — graceful degradation for canEdit flag (fix 1b)', () => {
  it('returns 200 with canEdit:false when the admin check 429s (still delivers settings)', async () => {
    const chatId = -1007;
    await saveChat(chatId, 'Real Group', 10);

    let call = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        call += 1;
        if (call === 1) return memberResponse();
        return errorResponse(429, 'Too Many Requests');
      }
      return new Response(null, { status: 200 });
    });

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/notifications?chatId=${chatId}`, {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.canEdit).toBe(false);
    expect(body.chatId).toBe(chatId);
    expect(Array.isArray(body.availableTypes)).toBe(true);
    expect(body.settings).toBeDefined();
  });

  it('returns canEdit:true when the admin check confirms administrator — no regression', async () => {
    const chatId = -1008;
    await saveChat(chatId, 'Real Group', 10);
    mockGetChatMemberByChatId(() => adminResponse());

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/notifications?chatId=${chatId}`, {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.canEdit).toBe(true);
  });

  it('returns canEdit:false for a non-admin member — no regression', async () => {
    const chatId = -1009;
    await saveChat(chatId, 'Real Group', 10);
    mockGetChatMemberByChatId(() => memberResponse());

    const cookie = await adminSessionCookie();
    const response = await worker.fetch(
      new Request(`http://localhost/admin/api/notifications?chatId=${chatId}`, {
        headers: { Cookie: cookie },
      }),
      env,
      ctx,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.canEdit).toBe(false);
  });
});

describe('canEditAutoNotifications — webhook path stays fail-closed (fix 2)', () => {
  async function sendAutoNotifications(text: string, chatId = -100123): Promise<void> {
    await handleUpdate(
      {
        chat: { id: chatId, title: 'Group', type: 'supergroup' },
        from: { id: 456, username: 'testuser' },
        text,
        date: Math.floor(Date.now() / 1000),
      },
      env,
    );
  }

  async function sentMessages(): Promise<string[]> {
    const { sendMessage } = await import('../src/core/telegram');
    return (sendMessage as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: any[]) => (call[2] as string) || '',
    );
  }

  it('rejects the enable subcommand with a rights message when getChatMember 429s', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        return errorResponse(429, 'Too Many Requests');
      }
      return new Response(null, { status: 200 });
    });

    await sendAutoNotifications('/auto_notifications enable');

    const messages = await sentMessages();
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('У вас нет прав')]),
    );
  });

  it('rejects the disable subcommand with a rights message when getChatMember 5xx errors', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        return errorResponse(500, 'internal server error');
      }
      return new Response(null, { status: 200 });
    });

    await sendAutoNotifications('/auto_notifications disable');

    const messages = await sentMessages();
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('У вас нет прав')]),
    );
  });

  it('still serves the status subcommand (read-only) when getChatMember 429s', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        return errorResponse(429, 'Too Many Requests');
      }
      return new Response(null, { status: 200 });
    });

    await sendAutoNotifications('/auto_notifications status');

    const messages = await sentMessages();
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('Уведомления не настроены')]),
    );
  });

  it('still serves the types subcommand (read-only) when getChatMember 429s', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/getChatMember')) {
        return errorResponse(429, 'Too Many Requests');
      }
      return new Response(null, { status: 200 });
    });

    await sendAutoNotifications('/auto_notifications types');

    const messages = await sentMessages();
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('Доступные типы уведомлений')]),
    );
  });

  it('still rejects a non-admin member for enable — no regression', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({ ok: true, result: { status: 'member' } }),
    );

    await sendAutoNotifications('/auto_notifications enable');

    const messages = await sentMessages();
    expect(messages).toEqual(
      expect.arrayContaining([expect.stringContaining('У вас нет прав')]),
    );
  });
});
