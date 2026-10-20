import type { Env } from './env';
import { Logger } from './logger';

/**
 * Per-chat switches that chat administrators manage from the dashboard. They
 * only narrow the instance-level policy in `runtime-settings.ts`: a module the
 * bot owner disabled stays off whatever a chat chooses.
 */

const CACHE_TTL_MS = 30_000;

export type DashboardAccess = 'members' | 'admins';

export interface ChatSettings {
  profanityEnabled: boolean;
  criminalEnabled: boolean;
  /** Nightly AI summary posted into the chat by the daily cron. */
  summaryEnabled: boolean;
  /** Who may open this chat's dashboard: every member or only administrators. */
  dashboardAccess: DashboardAccess;
}

export interface StoredChatSettings extends ChatSettings {
  updatedAt: string | null;
  updatedByName: string | null;
}

interface PersistedChatSettingsV1 extends Partial<ChatSettings> {
  version: 1;
  updatedByName?: string;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  profanityEnabled: true,
  criminalEnabled: true,
  summaryEnabled: true,
  dashboardAccess: 'members',
};

/** Used when the stored choice cannot be read: never re-enable what a chat may have turned off. */
const UNREADABLE_CHAT_SETTINGS: ChatSettings = {
  profanityEnabled: false,
  criminalEnabled: false,
  summaryEnabled: false,
  dashboardAccess: 'admins',
};

const cache = new Map<number, { expiresAt: number; value: StoredChatSettings }>();

function scopeOf(chatId: number): string {
  return `chat:${chatId}`;
}

function sanitize(raw: unknown, updatedAt: string | null): StoredChatSettings {
  if (raw !== null && (typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1)) {
    // An unknown or corrupt row must not silently re-enable anything.
    throw new Error('Unsupported chat settings row');
  }
  const value = (raw ?? {}) as Partial<PersistedChatSettingsV1>;
  const flag = (key: 'profanityEnabled' | 'criminalEnabled' | 'summaryEnabled') =>
    typeof value[key] === 'boolean' ? value[key] as boolean : DEFAULT_CHAT_SETTINGS[key];
  return {
    profanityEnabled: flag('profanityEnabled'),
    criminalEnabled: flag('criminalEnabled'),
    summaryEnabled: flag('summaryEnabled'),
    dashboardAccess: value.dashboardAccess === 'admins' ? 'admins' : 'members',
    updatedAt,
    updatedByName: typeof value.updatedByName === 'string' ? value.updatedByName : null,
  };
}

export function resetChatSettingsCache(): void {
  cache.clear();
}

/**
 * Reads one chat's settings, cached per isolate unless `fresh`. A failed read yields the
 * restrictive fallback (not cached) so a D1 hiccup never turns analysis back on.
 */
export async function readChatSettings(
  env: Env,
  chatId: number,
  options: { fresh?: boolean } = {},
): Promise<StoredChatSettings> {
  const now = Date.now();
  const cached = cache.get(chatId);
  if (!options.fresh && cached && cached.expiresAt > now) return cached.value;
  if (!env.DB?.prepare) return { ...DEFAULT_CHAT_SETTINGS, updatedAt: null, updatedByName: null };

  try {
    const row = await env.DB
      .prepare('SELECT settings_json, updated_at FROM app_settings WHERE scope = ?')
      .bind(scopeOf(chatId))
      .first() as { settings_json?: string; updated_at?: string } | null;
    const value = sanitize(
      row?.settings_json ? JSON.parse(row.settings_json) : null,
      row?.updated_at ?? null,
    );
    cache.set(chatId, { expiresAt: now + CACHE_TTL_MS, value });
    return value;
  } catch (error) {
    Logger.warn('Chat settings unreadable, using restrictive fallback', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return { ...UNREADABLE_CHAT_SETTINGS, updatedAt: null, updatedByName: null };
  }
}

/** Validates a full settings payload from the dashboard; throws on anything malformed. */
export function parseChatSettingsInput(input: unknown): ChatSettings {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : null;
  if (!value) throw new Error('Invalid settings');
  for (const key of ['profanityEnabled', 'criminalEnabled', 'summaryEnabled'] as const) {
    if (typeof value[key] !== 'boolean') throw new Error(`Invalid ${key} setting`);
  }
  if (value.dashboardAccess !== 'members' && value.dashboardAccess !== 'admins') {
    throw new Error('Invalid dashboardAccess setting');
  }
  return {
    profanityEnabled: value.profanityEnabled as boolean,
    criminalEnabled: value.criminalEnabled as boolean,
    summaryEnabled: value.summaryEnabled as boolean,
    dashboardAccess: value.dashboardAccess,
  };
}

export async function saveChatSettings(
  env: Env,
  chatId: number,
  settings: ChatSettings,
  updatedByName: string,
): Promise<StoredChatSettings> {
  if (!env.DB?.prepare) throw new Error('D1 database is not available');
  const payload: PersistedChatSettingsV1 = { version: 1, ...settings, updatedByName };
  await env.DB
    .prepare(
      `INSERT INTO app_settings(scope, settings_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(scope) DO UPDATE SET settings_json = excluded.settings_json, updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(scopeOf(chatId), JSON.stringify(payload))
    .run();
  cache.delete(chatId);
  // Report what was written even if the read-back hits a transient error.
  const stored = await readChatSettings(env, chatId, { fresh: true });
  return { ...settings, updatedAt: stored.updatedAt, updatedByName };
}
