import type { Env } from '../../core/env';
import type { InlineButton } from './cards';
import { getTelegramChatRole } from '../../api/admin-chats';

export type Buttons = InlineButton[][];
export interface View { text: string; buttons?: Buttons }

export function button(text: string, action: string, chatId: number, value?: string): InlineButton {
  return { text, callback_data: ['ach', action, chatId, ...(value ? [value] : [])].join(':') };
}

export function socialAvailable(env: Env): boolean {
  return String(env.ENABLE_CONVERSATION_ACHIEVEMENTS) === 'true' && String(env.ENABLE_ACTIVITY_TRACKING) !== 'false';
}

/** Existing explicit webhook filters may predate the album buttons. Only the owner changes the webhook. */
export async function callbackSetupHint(env: Env): Promise<string> {
  try {
    const info = await callTelegram<{ url?: string; allowed_updates?: unknown }>(env, 'getWebhookInfo', {});
    if (info?.url && Array.isArray(info.allowed_updates) && info.allowed_updates.length &&
      !info.allowed_updates.includes('callback_query')) {
      return '\n\nTelegram пока не доставляет нажатия на кнопки. Владельцу бота нужно заново подключить '
        + 'webhook в /admin/setup или добавить callback_query в свой список allowed_updates.';
    }
  } catch { /* This diagnostic is optional. Keep the menu available during an API outage. */ }
  return '';
}

/** Check membership via Telegram on each access. A temporary outage grants no access. */
export async function roleOf(env: Env, groupId: number, userId: number) {
  try {
    return await getTelegramChatRole(env, groupId, userId);
  } catch {
    return 'unverified' as const;
  }
}

export async function callTelegram<T>(env: Env, method: string, args: Record<string, unknown>): Promise<T> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
    });
    const data = await response.json() as { ok?: boolean; result?: T; description?: string };
    if (response.ok && data?.ok && data.result !== undefined) return data.result;
    if (response.status === 400 && method === 'editMessageText' &&
      data?.description?.startsWith('Bad Request: message is not modified')) return undefined as T;
  } catch { /* Map fetch failures to a message without request URL or token. */ }
  throw new Error('Telegram ' + method + ' failed');
}

export async function botUsername(env: Env): Promise<string> {
  const configured = env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
  if (configured && /^\w{5,32}$/.test(configured)) return configured;
  const me = await callTelegram<{ username: string }>(env, 'getMe', {});
  if (!/^\w{5,32}$/.test(me.username)) throw new Error('Invalid Telegram bot username');
  return me.username;
}

export async function groupTitle(env: Env, groupId: number) {
  const meta = await env.HISTORY.get<{ title?: string }>('admin_chat:' + groupId, 'json');
  return (meta?.title || 'Группа ' + groupId).slice(0, 64);
}

/** Only consider groups observed for this person. Every displayed title requires a live membership check. */
export async function groupPicker(env: Env, owner: number, before = 0): Promise<View> {
  const pageSize = 6;
  const result = await env.DB.prepare(`SELECT chat_id, MAX(album) AS album FROM (
      SELECT chat_id, 1 AS album FROM achievement_enrollments WHERE user_id=? AND chat_id<?
      UNION ALL
      SELECT profile.chat_id, 0 FROM stats_chat_user_profile profile
      JOIN achievement_groups g ON g.chat_id=profile.chat_id AND g.enabled=1
      WHERE profile.user_id=? AND profile.chat_id<?
    ) GROUP BY chat_id ORDER BY chat_id DESC LIMIT ?`).bind(owner, before, owner, before, pageSize + 1)
    .all<{ chat_id: number; album: number }>();
  const entries = await Promise.all(result.results.slice(0, pageSize).map(async row => {
    const role = await roleOf(env, row.chat_id, owner);
    if (role === 'admin' || role === 'member') {
      return [button(await groupTitle(env, row.chat_id), 'album', row.chat_id)];
    }
    if (role === 'unverified') {
      return [button('Повторить проверку членства', 'album', row.chat_id)];
    }
    // People who left can still delete their own stored data without exposing group metadata.
    return row.album ? [button('Удалить мой альбом · ' + row.chat_id, 'delete', row.chat_id)] : [];
  }));
  const buttons = entries.filter(row => row.length);
  if (result.results.length > pageSize) buttons.push([button('Следующие группы →', 'pick', result.results[pageSize - 1].chat_id)]);
  return { text: buttons.length ? 'Мои коллекции · выберите группу.' :
    'Пока нет доступных коллекций. Откройте /achievements в своей группе и нажмите «Мои бейджи».', buttons };
}
