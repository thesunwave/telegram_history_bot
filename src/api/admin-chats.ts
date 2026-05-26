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
      chatId,
      error: error.message || String(error),
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

async function listCounterChatIds(env: Env): Promise<Set<number>> {
  const chatIds = new Set<number>();
  let cursor: string | undefined;

  do {
    const list: any = await env.COUNTERS.list({ prefix: 'stats_v2:', cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    for (const key of list.keys) {
      const [, chatId] = key.name.split(':');
      const parsed = Number(chatId);
      if (Number.isFinite(parsed)) {
        chatIds.add(parsed);
      }
    }
  } while (cursor);

  return chatIds;
}

export async function listAdminChats(env: Env): Promise<AdminChatMeta[]> {
  const storedChats = await listStoredChatMeta(env);
  const byId = new Map<number, AdminChatMeta>();

  for (const chat of storedChats) {
    byId.set(chat.chatId, chat);
  }

  const counterChatIds = await listCounterChatIds(env);
  for (const chatId of counterChatIds) {
    if (!byId.has(chatId)) {
      byId.set(chatId, {
        chatId,
        title: `Chat ${chatId}`,
        lastSeenAt: 0,
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (b.lastSeenAt !== a.lastSeenAt) {
      return b.lastSeenAt - a.lastSeenAt;
    }

    return a.title.localeCompare(b.title);
  });
}

export async function isTelegramUserInChat(
  env: Env,
  chatId: number,
  userId: number,
): Promise<boolean> {
  if (!env.TOKEN) {
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${env.TOKEN}/getChatMember`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
    });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json().catch(() => null) as any;
    const status = payload?.result?.status;
    return (
      status === 'creator' ||
      status === 'administrator' ||
      status === 'member' ||
      status === 'restricted'
    );
  } catch {
    return false;
  }
}

export async function listAdminChatsForTelegramUser(
  env: Env,
  userId: number,
): Promise<AdminChatMeta[]> {
  const chats = await listAdminChats(env);
  const checks = await Promise.all(
    chats.map(async (chat) => ({
      chat,
      allowed: await isTelegramUserInChat(env, chat.chatId, userId),
    })),
  );

  return checks.filter(({ allowed }) => allowed).map(({ chat }) => chat);
}
