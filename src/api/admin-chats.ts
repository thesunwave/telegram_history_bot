import type { Env } from '../core/env';
import { Logger } from '../core/logger';

const CHAT_META_PREFIX = 'admin_chat:';

export interface AdminChatMeta {
  chatId: number;
  title: string;
  type?: string;
  username?: string;
  lastSeenAt: number;
}

function getChatTitle(chat: any): string {
  const title = typeof chat?.title === 'string' ? chat.title.trim() : '';
  if (title) return title;

  const username = typeof chat?.username === 'string' ? chat.username.trim() : '';
  if (username) return `@${username}`;

  const fullName = [chat?.first_name, chat?.last_name]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .trim();
  if (fullName) return fullName;

  return `Chat ${chat?.id ?? 'unknown'}`;
}

function isAdminChatMeta(value: any): value is AdminChatMeta {
  return (
    value &&
    typeof value === 'object' &&
    Number.isFinite(value.chatId) &&
    typeof value.title === 'string' &&
    Number.isFinite(value.lastSeenAt)
  );
}

export async function saveAdminChatMeta(env: Env, chat: any, seenAt: number): Promise<void> {
  const chatId = Number(chat?.id);
  if (!Number.isFinite(chatId)) {
    return;
  }

  const meta: AdminChatMeta = {
    chatId,
    title: getChatTitle(chat),
    type: typeof chat?.type === 'string' ? chat.type : undefined,
    username: typeof chat?.username === 'string' ? chat.username : undefined,
    lastSeenAt: seenAt,
  };

  try {
    await env.HISTORY.put(`${CHAT_META_PREFIX}${chatId}`, JSON.stringify(meta));
  } catch (error: any) {
    Logger.error('Failed to save admin chat metadata', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

async function listStoredChatMeta(env: Env): Promise<AdminChatMeta[]> {
  const chats: AdminChatMeta[] = [];
  let cursor: string | undefined;

  do {
    const list: any = await env.HISTORY.list({ prefix: CHAT_META_PREFIX, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    for (let i = 0; i < list.keys.length; i += 10) {
      const batch = list.keys.slice(i, i + 10);
      const values = await Promise.all(batch.map((key: any) => env.HISTORY.get(key.name)));

      for (const value of values) {
        if (!value) continue;
        try {
          const parsed = JSON.parse(value);
          if (isAdminChatMeta(parsed)) {
            chats.push(parsed);
          }
        } catch {
          // Ignore corrupted metadata; fallback discovery can still show the chat ID.
        }
      }
    }
  } while (cursor);

  return chats;
}

async function listStatsChatIds(env: Env): Promise<Set<number>> {
  const chatIds = new Set<number>();

  if (!env.DB) return chatIds;
  const res = await env.DB.prepare('SELECT DISTINCT chat_id FROM activity').all<{ chat_id: number }>();
  for (const row of (res.results as Array<{ chat_id: number }> | undefined) ?? []) {
    const parsed = Number(row.chat_id);
    if (Number.isFinite(parsed)) {
      chatIds.add(parsed);
    }
  }

  return chatIds;
}

interface AdminChatCandidate {
  chat: AdminChatMeta;
  hasStoredMeta: boolean;
}

async function listAdminChatCandidates(env: Env): Promise<AdminChatCandidate[]> {
  const storedChats = await listStoredChatMeta(env);
  const byId = new Map<number, AdminChatCandidate>();

  for (const chat of storedChats) {
    byId.set(chat.chatId, { chat, hasStoredMeta: true });
  }

  const statsChatIds = await listStatsChatIds(env);
  for (const chatId of statsChatIds) {
    if (!byId.has(chatId)) {
      byId.set(chatId, {
        chat: {
          chatId,
          title: `Chat ${chatId}`,
          lastSeenAt: 0,
        },
        hasStoredMeta: false,
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (b.chat.lastSeenAt !== a.chat.lastSeenAt) {
      return b.chat.lastSeenAt - a.chat.lastSeenAt;
    }

    return a.chat.title.localeCompare(b.chat.title);
  });
}

export async function listAdminChats(env: Env): Promise<AdminChatMeta[]> {
  return (await listAdminChatCandidates(env)).map(({ chat }) => chat);
}

export type TelegramChatRole = 'admin' | 'member' | 'none';

/**
 * Resolves a user's standing in a chat via `getChatMember`. Telegram errors and
 * unknown statuses throw so callers never mistake an outage for "not a member".
 */
export async function getTelegramChatRole(
  env: Env,
  chatId: number,
  userId: number,
): Promise<TelegramChatRole> {
  if (!env.TOKEN) {
    return 'none';
  }

  const url = `https://api.telegram.org/bot${env.TOKEN}/getChatMember`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: userId }),
  });
  if (!response.ok) {
    throw new Error(`getChatMember HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null) as any;
  const status = payload?.result?.status;
  if (payload?.ok !== true || typeof status !== 'string') {
    throw new Error('getChatMember invalid response');
  }

  if (status === 'creator' || status === 'administrator') {
    return 'admin';
  }
  if (status === 'member') {
    return 'member';
  }
  if (status === 'restricted') {
    return payload.result.is_member === true ? 'member' : 'none';
  }
  if (status === 'left' || status === 'kicked') {
    return 'none';
  }

  throw new Error('getChatMember unknown status');
}

export async function isTelegramUserInChat(
  env: Env,
  chatId: number,
  userId: number,
): Promise<boolean> {
  return (await getTelegramChatRole(env, chatId, userId)) !== 'none';
}

export async function isTelegramUserChatAdmin(
  env: Env,
  chatId: number,
  userId: number,
): Promise<boolean> {
  return (await getTelegramChatRole(env, chatId, userId)) === 'admin';
}

export interface AdminChatWithRole extends AdminChatMeta {
  /** null when Telegram could not confirm the role; chat-scoped endpoints re-check. */
  role: Exclude<TelegramChatRole, 'none'> | null;
}

/** Chats the user belongs to, with the role each membership check confirmed. */
export async function listAdminChatsWithRoleForTelegramUser(
  env: Env,
  userId: number,
): Promise<AdminChatWithRole[]> {
  const candidates = await listAdminChatCandidates(env);
  const checks = await Promise.allSettled(
    candidates.map(async (candidate) => ({
      candidate,
      role: await getTelegramChatRole(env, candidate.chat.chatId, userId),
    })),
  );

  const allowedChats: AdminChatWithRole[] = [];

  checks.forEach((check, index) => {
    if (check.status === 'rejected') {
      const candidate = candidates[index];
      Logger.warn('Failed to verify admin chat membership while listing chats', {
        chatId: candidate.chat.chatId,
        error: check.reason instanceof Error ? check.reason.message : String(check.reason),
      });
      if (candidate.hasStoredMeta) {
        allowedChats.push({ ...candidate.chat, role: null });
      }
      return;
    }

    if (check.value.role !== 'none') {
      allowedChats.push({ ...check.value.candidate.chat, role: check.value.role });
    }
  });

  return allowedChats;
}

export async function listAdminChatsForTelegramUser(
  env: Env,
  userId: number,
): Promise<AdminChatMeta[]> {
  const chats = await listAdminChatsWithRoleForTelegramUser(env, userId);
  return chats.map(({ role: _role, ...chat }) => chat);
}
