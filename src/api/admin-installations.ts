import type { Env } from '../core/env';
import { BOT_MEMBERSHIP_PREFIX } from '../core/consts';
import { getGroup, pauseGroupDependents, setGroupEnabled } from '../features/achievements/repository';
import { callTelegram } from '../features/achievements/settings';
import { isTelegramUserInChat, listAdminChats, saveAdminChatMeta, type AdminChatMeta } from './admin-chats';

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
  const row = await env.DB.prepare('SELECT settings_json FROM app_settings WHERE scope = ?')
    .bind(`${BOT_MEMBERSHIP_PREFIX}${chatId}`).first<{ settings_json: string }>();
  const raw = row?.settings_json;
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as InstallationState;
    return MEMBER_STATUSES.includes(state.status) && typeof state.active === 'boolean' &&
      Number.isFinite(state.statusChangedAt) ? state : null;
  } catch {
    return null;
  }
}

function isGroup(type?: string): boolean {
  return type === 'group' || type === 'supergroup';
}

function canBeGroup(chat: AdminChatMeta): boolean {
  return chat.chatId < 0 && (!chat.type || isGroup(chat.type));
}

/** Records bot membership events without storing the actor or Telegram payload. */
export async function recordBotMembership(
  env: Env,
  update: MembershipUpdate,
  updateId?: number,
): Promise<void> {
  if (!Number.isSafeInteger(update?.chat?.id) || !Number.isFinite(update.date) ||
      !MEMBER_STATUSES.includes(update.new_chat_member?.status) || !update.old_chat_member) return;

  const active = isActive(update.new_chat_member);
  const installedAt = active && !isActive(update.old_chat_member)
    ? update.date : undefined;
  const state: InstallationState = {
    status: update.new_chat_member.status,
    active,
    installedAt,
    statusChangedAt: update.date,
    updateId,
  };
  // D1 compares and writes in one statement: concurrent deliveries cannot replace
  // a newer membership with an older one. Preserve install time on role changes.
  const scope = BOT_MEMBERSHIP_PREFIX + update.chat.id;
  const membership = env.DB.prepare(`
    INSERT INTO app_settings(scope, settings_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(scope) DO UPDATE SET
      settings_json = json_set(excluded.settings_json, '$.installedAt', COALESCE(
        json_extract(excluded.settings_json, '$.installedAt'),
        json_extract(app_settings.settings_json, '$.installedAt'))),
      updated_at = CURRENT_TIMESTAMP
    WHERE json_extract(excluded.settings_json, '$.statusChangedAt') >
            json_extract(app_settings.settings_json, '$.statusChangedAt')
       OR (json_extract(excluded.settings_json, '$.statusChangedAt') =
             json_extract(app_settings.settings_json, '$.statusChangedAt')
           AND COALESCE(json_extract(excluded.settings_json, '$.updateId'), -1) >
             COALESCE(json_extract(app_settings.settings_json, '$.updateId'), -1))
  `).bind(scope, JSON.stringify(state));
  const confirmedRemoval = ['left', 'kicked'].includes(state.status) ||
    (state.status === 'restricted' && update.new_chat_member.is_member === false);
  const group = update.chat.type === 'group' || update.chat.type === 'supergroup';
  let result;
  if (group && confirmedRemoval) {
    // Fence the cleanup against the same Telegram (timestamp, update_id) order
    // as membership. A redelivery after reinstall cannot erase the new consent.
    const generation = crypto.randomUUID();
    const pause = env.DB.prepare(`UPDATE achievement_groups SET enabled=0,generation=?
      WHERE chat_id=? AND enabled=1 AND NOT EXISTS (
        SELECT 1 FROM app_settings WHERE scope=? AND (
          json_extract(settings_json,'$.statusChangedAt')>? OR (
            json_extract(settings_json,'$.statusChangedAt')=? AND
            COALESCE(json_extract(settings_json,'$.updateId'),-1)>=?)))`)
      .bind(generation, update.chat.id, scope, update.date, update.date, updateId ?? -1);
    const batch = await env.DB.batch([
      pause, ...pauseGroupDependents(env.DB, update.chat.id, generation), membership,
    ]);
    result = batch[batch.length - 1];
  } else {
    result = await membership.run();
  }
  if (result.meta?.changes === 0) return;
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
}

/** Lists all known chat installations; the caller must authenticate the bot owner. */
export async function listBotInstallations(env: Env) {
  const chats = await listAdminChats(env);
  const installations = [];
  for (let offset = 0; offset < chats.length; offset += 10) {
    installations.push(...await Promise.all(chats.slice(offset, offset + 10).map(async chat => {
      const [membership, achievements] = await Promise.all([
        readInstallation(env, chat.chatId),
        canBeGroup(chat) ? getGroup(env.DB, chat.chatId) : null,
      ]);
      const achievementsEnabled = canBeGroup(chat) && membership?.active !== false
        ? Boolean(achievements?.enabled) : null;
      return { ...chat, membership, achievementsEnabled };
    })));
  }
  return installations;
}

/** Activate a known group for the verified bot owner. Bot removal still fences the write. */
export async function enableInstallationAchievements(env: Env, chatId: number): Promise<Response> {
  const json = (body: { ok: true } | { error: string }, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const chat = (await listAdminChats(env)).find(entry => entry.chatId === chatId);
  if (!chat || !canBeGroup(chat)) return json({ error: 'Этой группы нет в установках бота.' }, 404);
  if (String(env.ENABLE_ACTIVITY_TRACKING) === 'false' || env.RAW_MESSAGE_STORAGE_MODE === 'unconfigured') {
    return json({ error: 'Сначала включите сбор статистики в настройках бота.' }, 409);
  }
  const installation = await readInstallation(env, chatId);
  if (installation?.active === false) return json({ error: 'Бот больше не подключён к этой группе.' }, 409);

  try {
    if (!chat.type) {
      const live = await callTelegram<{ type: string }>(env, 'getChat', { chat_id: chatId });
      if (!isGroup(live.type)) return json({ error: 'Достижения доступны только в группах.' }, 404);
    }
    if (!installation) {
      const bot = await callTelegram<{ id: number }>(env, 'getMe', {});
      if (!Number.isSafeInteger(bot.id) || bot.id <= 0) throw new Error('Bot identity unavailable');
      if (!await isTelegramUserInChat(env, chatId, bot.id)) {
        return json({ error: 'Бот больше не подключён к этой группе.' }, 409);
      }
    }
  } catch {
    return json({ error: 'Telegram не подтвердил подключение бота. Попробуйте ещё раз.' }, 503);
  }

  const updated = await setGroupEnabled(env.DB, chatId, true);
  return updated?.enabled ? json({ ok: true }) : json({ error: 'Бот больше не подключён к этой группе.' }, 409);
}

/** Anonymous self-hosted installations received by the hosted instance; owner-only data. */
export async function listSelfHostedInstallations(env: Env) {
  if (![true, 'true', '1'].includes(env.TELEMETRY_RECEIVER ?? false)) return null;
  // Old cron tests sent a fresh ID with no activity. Retain the raw rows so a
  // genuine ID can still appear once it reports activity or a second UTC day.
  const included = "ping_days > 1 OR active_chats_7d <> '0' OR active_groups_7d <> '0'";
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN last_seen >= date('now', '-6 day') THEN 1 ELSE 0 END), 0) AS active7d
       FROM telemetry_installs WHERE ${included}`,
  ).first<{ total: number; active7d: number }>();
  const rows = await env.DB.prepare(
    `SELECT install_id, first_seen, last_seen, active_chats_7d, active_groups_7d, ping_days
       FROM telemetry_installs WHERE ${included}
       ORDER BY last_seen DESC, install_id LIMIT 200`,
  ).all<{
    install_id: string; first_seen: string; last_seen: string;
    active_chats_7d: string; active_groups_7d: string; ping_days: number;
  }>();
  return { total: totals?.total ?? 0, active7d: totals?.active7d ?? 0, rows: rows.results ?? [] };
}
