import type { Env } from '../core/env';
import { readChatSettings, type StoredChatSettings } from '../core/chat-settings';
import { resolveRuntimeSettings } from '../core/runtime-settings';
import type { AdminChatWithRole } from './admin-chats';

/**
 * Data for the dashboard's "Мои чаты" page and per-chat settings card. Chat
 * pulse comes from one bounded D1 aggregate query over the last seven UTC days.
 */

const PULSE_DAYS = 7;

export interface AdminChatPulse {
  messages: number;
  activeUsers: number;
  lastActiveDay: string | null;
}

export interface AdminChatOverview extends AdminChatWithRole {
  pulse: AdminChatPulse | null;
  settings: Pick<StoredChatSettings, 'profanityEnabled' | 'criminalEnabled' | 'summaryEnabled' | 'dashboardAccess'>;
}

/** Modules the bot owner enabled for the whole instance; chats cannot exceed these. */
export interface InstanceModules {
  profanity: boolean;
  criminal: boolean;
  summary: boolean;
}

function pulseWindowStart(): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - (PULSE_DAYS - 1));
  return day.toISOString().slice(0, 10);
}

async function readChatPulses(env: Env, chatIds: number[]): Promise<Map<number, AdminChatPulse> | null> {
  if (!chatIds.length) return new Map();
  if (!env.DB?.prepare) return null;
  try {
    const placeholders = chatIds.map(() => '?').join(', ');
    const result = await env.DB
      .prepare(
        `SELECT chat_id, SUM(message_count) AS messages,
                COUNT(DISTINCT CASE WHEN message_count > 0 THEN user_id END) AS active_users,
                MAX(CASE WHEN message_count > 0 THEN day END) AS last_active_day
         FROM stats_daily_user
         WHERE chat_id IN (${placeholders}) AND day >= ?
         GROUP BY chat_id`,
      )
      .bind(...chatIds, pulseWindowStart())
      .all() as { results?: Array<Record<string, unknown>> };
    const pulses = new Map<number, AdminChatPulse>();
    for (const row of result.results || []) {
      pulses.set(Number(row.chat_id), {
        messages: Number(row.messages) || 0,
        activeUsers: Number(row.active_users) || 0,
        lastActiveDay: typeof row.last_active_day === 'string' ? row.last_active_day : null,
      });
    }
    return pulses;
  } catch {
    return null;
  }
}

/**
 * Drops chats a member may not open (administrators-only dashboards) and adds
 * each remaining chat's seven-day pulse and module switches.
 */
export async function buildChatOverview(
  env: Env,
  chats: AdminChatWithRole[],
): Promise<AdminChatOverview[]> {
  const withSettings = await Promise.all(
    chats.map(async (chat) => ({ chat, settings: await readChatSettings(env, chat.chatId) })),
  );
  const visible = withSettings.filter(
    ({ chat, settings }) => settings.dashboardAccess !== 'admins' || chat.role !== 'member',
  );
  const pulses = await readChatPulses(env, visible.map(({ chat }) => chat.chatId));
  return visible.map(({ chat, settings }) => ({
    ...chat,
    pulse: pulses ? pulses.get(chat.chatId) ?? { messages: 0, activeUsers: 0, lastActiveDay: null } : null,
    settings: {
      profanityEnabled: settings.profanityEnabled,
      criminalEnabled: settings.criminalEnabled,
      summaryEnabled: settings.summaryEnabled,
      dashboardAccess: settings.dashboardAccess,
    },
  }));
}

export async function readInstanceModules(env: Env): Promise<InstanceModules> {
  const settings = await resolveRuntimeSettings(env);
  return {
    profanity: settings.profanityEnabled,
    criminal: settings.criminalEnabled,
    summary: settings.summary.enabled,
  };
}
