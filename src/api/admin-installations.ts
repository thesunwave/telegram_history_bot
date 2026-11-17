import type { Env } from '../core/env';
import { listAdminChats, listAdminChatsForTelegramUser, saveAdminChatMeta } from './admin-chats';

const INSTALLATION_PREFIX = 'admin_installation:';
const MEMBER_STATUSES = ['creator', 'administrator', 'member', 'restricted', 'left', 'kicked'];

interface MembershipUpdate {
  chat: { id: number; type?: string; title?: string; username?: string };
  date: number;
  new_chat_member: { status: string; is_member?: boolean };
  old_chat_member: { status: string; is_member?: boolean };
}

interface InstallationState {
  status: string;
  active: boolean;
  installedAt?: number;
  statusChangedAt: number;
  updateId?: number;
}

function isActive(member: MembershipUpdate['new_chat_member']): boolean {
  return member.status === 'restricted'
    ? member.is_member === true
    : ['creator', 'administrator', 'member'].includes(member.status);
}

async function readInstallation(env: Env, chatId: number): Promise<InstallationState | null> {
  const raw = await env.HISTORY.get(`${INSTALLATION_PREFIX}${chatId}`);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as InstallationState;
    return MEMBER_STATUSES.includes(state.status) && typeof state.active === 'boolean' &&
      Number.isFinite(state.statusChangedAt) ? state : null;
  } catch {
    return null;
  }
}

/** Records bot membership events without storing the actor or Telegram payload. */
export async function recordBotMembership(
  env: Env,
  update: MembershipUpdate,
  updateId?: number,
): Promise<void> {
  if (!Number.isSafeInteger(update?.chat?.id) || !Number.isFinite(update.date) ||
      !MEMBER_STATUSES.includes(update.new_chat_member?.status) || !update.old_chat_member) return;

  const previous = await readInstallation(env, update.chat.id);
  // Telegram can retry updates or deliver them out of order.
  if (previous && (previous.statusChangedAt > update.date ||
      (previous.statusChangedAt === update.date && previous.updateId !== undefined &&
        updateId !== undefined && previous.updateId >= updateId))) return;
  const active = isActive(update.new_chat_member);
  const installedAt = active && !isActive(update.old_chat_member)
    ? update.date : previous?.installedAt;
  const state: InstallationState = {
    status: update.new_chat_member.status,
    active,
    installedAt,
    statusChangedAt: update.date,
    updateId,
  };
  // Membership-only chats must be discoverable even before their first message.
  const metadata = await env.HISTORY.get(`admin_chat:${update.chat.id}`);
  let lastSeenAt = 0;
  try {
    const parsed = metadata ? JSON.parse(metadata) : null;
    if (Number.isFinite(parsed?.lastSeenAt)) lastSeenAt = parsed.lastSeenAt;
  } catch {
    // Recover corrupted chat metadata from the current membership event.
  }
  await saveAdminChatMeta(env, update.chat, lastSeenAt);
  await env.HISTORY.put(`${INSTALLATION_PREFIX}${update.chat.id}`, JSON.stringify(state));
}

/** Lists known installations, scoped to chat membership for Telegram sessions. */
export async function listBotInstallations(env: Env, telegramId?: number) {
  const chats = telegramId === undefined
    ? await listAdminChats(env) : await listAdminChatsForTelegramUser(env, telegramId);
  const installations = [];
  for (let offset = 0; offset < chats.length; offset += 10) {
    installations.push(...await Promise.all(chats.slice(offset, offset + 10).map(async (chat) => ({
      ...chat,
      membership: await readInstallation(env, chat.chatId),
    }))));
  }
  return installations;
}
