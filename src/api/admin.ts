import type { Env } from '../core/env';
import { NotificationService } from '../core/services/notification-service';
import { NotificationRepository } from '../core/repositories/notification-repository';
import type { NotificationType } from '../core/models/notification-settings';
import {
  authenticateAdmin,
  authenticateTelegramSession,
  clearTelegramSessionCookie,
  createTelegramSessionCookie,
  unauthorizedAdminResponse,
  verifyTelegramLogin,
  type AdminPrincipal,
} from './admin-auth';
import {
  isTelegramUserChatAdmin,
  isTelegramUserInChat,
  listAdminChatsForTelegramUser,
} from './admin-chats';
import { getAdminChatStats, parseAdminPeriod, type AdminDateRange } from './admin-stats';
import {
  AdminUnavailable,
  HistoricalStatsNotReady,
  LiveProgressUnavailable,
} from '../features/stats/admin-stats-errors';
import { renderAdminHtml } from './admin-html';

const ADMIN_PATH = '/admin';

function jsonError(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, { status });
}

function statsUnavailable(
  error: HistoricalStatsNotReady | AdminUnavailable,
  range: AdminDateRange,
): Response {
  const historical = error instanceof HistoricalStatsNotReady;
  return Response.json({
    ok: false,
    error: {
      code: historical ? 'HISTORICAL_STATS_NOT_READY' : 'ADMIN_UNAVAILABLE',
      message: historical
        ? 'Statistics for this range are not ready yet. Please try again later.'
        : 'Admin service is temporarily unavailable.',
      // User-safe requested range so the UI can name the unavailable period;
      // internal coverage reasons are never exposed.
      ...(historical ? { from: range.from, to: range.to } : {}),
    },
  }, {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      ...(historical ? { 'Retry-After': '300' } : {}),
    },
  });
}

function liveProgressUnavailableResponse(error: LiveProgressUnavailable): Response {
  return Response.json({
    ok: false,
    error: {
      code: error.code,
      message:
        error.code === 'LIVE_ANALYSIS_FAILED'
          ? 'Live analysis for the current UTC day failed and is not available yet.'
          : 'Live progress for the current UTC day is not available yet.',
      day: error.day,
    },
  }, {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
      'Retry-After': '300',
    },
  });
}

function parseChatId(url: URL): number | null {
  const rawChatId = url.searchParams.get('chatId');
  if (!rawChatId) {
    return null;
  }

  const chatId = Number(rawChatId);
  return Number.isFinite(chatId) ? chatId : null;
}

async function readNotificationPayload(req: Request) {
  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return payload as {
    enabled?: boolean;
    notifications?: Record<string, { enabled?: boolean }>;
  };
}

function isNotificationType(value: string, types: NotificationType[]): value is NotificationType {
  return types.includes(value as NotificationType);
}

async function handleNotificationGet(
  env: Env,
  chatId: number,
  principal: AdminPrincipal,
): Promise<Response> {
  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);
  const availableTypes = service.getAvailableNotificationTypes();
  const settings = await service.getChatSettings(String(chatId));
  const canEdit =
    principal.type === 'telegram' &&
    Boolean(principal.telegramId) &&
    await isTelegramUserChatAdmin(env, chatId, principal.telegramId!);

  return Response.json({
    ok: true,
    chatId,
    canEdit,
    availableTypes,
    settings,
  });
}

async function getBotUsername(env: Env): Promise<string | null> {
  if (env.TELEGRAM_BOT_USERNAME) {
    return env.TELEGRAM_BOT_USERNAME;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TOKEN}/getMe`);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null) as any;
    return typeof payload?.result?.username === 'string' ? payload.result.username : null;
  } catch {
    return null;
  }
}

async function authenticateAdminRequest(req: Request, env: Env): Promise<AdminPrincipal | null> {
  return (await authenticateTelegramSession(req, env)) || authenticateAdmin(req, env);
}

async function requireTelegramChatAccess(
  env: Env,
  principal: AdminPrincipal,
  chatId: number,
): Promise<Response | null> {
  if (principal.type !== 'telegram' || !principal.telegramId) {
    return unauthorizedAdminResponse();
  }

  const allowed = await isTelegramUserInChat(env, chatId, principal.telegramId);
  if (!allowed) {
    return jsonError('chat is not available for this Telegram user', 403);
  }

  return null;
}

async function requireTelegramChatAdmin(
  env: Env,
  principal: AdminPrincipal,
  chatId: number,
): Promise<Response | null> {
  if (principal.type !== 'telegram' || !principal.telegramId) {
    return unauthorizedAdminResponse();
  }

  const allowed = await isTelegramUserChatAdmin(env, chatId, principal.telegramId);
  if (!allowed) {
    return jsonError('only chat administrators can edit notification settings', 403);
  }

  return null;
}

function formatPrincipalName(principal: AdminPrincipal): string {
  if (principal.displayName?.trim()) {
    return principal.displayName.trim();
  }

  return principal.username;
}

async function handleNotificationPost(
  req: Request,
  env: Env,
  chatId: number,
  principal: AdminPrincipal,
): Promise<Response> {
  const payload = await readNotificationPayload(req);
  if (!payload) {
    return jsonError('Invalid JSON body', 400);
  }

  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);
  const availableTypes = service.getAvailableNotificationTypes();
  const updatedBy =
    principal.type === 'telegram' && principal.telegramId
      ? `admin-telegram:${principal.telegramId}`
      : `admin-basic:${principal.username}`;
  const updatedByName = formatPrincipalName(principal);
  const currentSettings =
    (await service.getChatSettings(String(chatId))) ||
    (await service.resetChatSettings(String(chatId), updatedBy));

  const nextSettings = {
    ...currentSettings,
    enabled: typeof payload.enabled === 'boolean' ? payload.enabled : currentSettings.enabled,
    updatedByName,
    notifications: { ...currentSettings.notifications },
  };

  for (const [type, update] of Object.entries(payload.notifications || {})) {
    if (!isNotificationType(type, availableTypes) || typeof update?.enabled !== 'boolean') {
      continue;
    }

    nextSettings.notifications[type] = {
      ...nextSettings.notifications[type],
      enabled: update.enabled,
    };
  }

  const settings = await service.updateChatSettings(
    String(chatId),
    nextSettings,
    updatedBy,
  );

  return Response.json({ ok: true, chatId, settings, availableTypes });
}

export async function handleAdminRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname !== ADMIN_PATH && !url.pathname.startsWith(`${ADMIN_PATH}/`)) {
    return new Response('Not found', { status: 404 });
  }

  if (url.pathname === ADMIN_PATH || url.pathname === `${ADMIN_PATH}/`) {
    const principal = await authenticateTelegramSession(req, env);
    return new Response(renderAdminHtml({
      botUsername: await getBotUsername(env),
      principal,
    }), {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  if (url.pathname === `${ADMIN_PATH}/login` && req.method === 'GET') {
    const payload = await verifyTelegramLogin(env, url.searchParams);
    if (!payload) {
      return new Response('Telegram login failed', { status: 403 });
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin',
        'Set-Cookie': await createTelegramSessionCookie(env, payload),
        'Cache-Control': 'no-store',
      },
    });
  }

  if (url.pathname === `${ADMIN_PATH}/logout`) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/admin',
        'Set-Cookie': clearTelegramSessionCookie(),
        'Cache-Control': 'no-store',
      },
    });
  }

  const principal = await authenticateAdminRequest(req, env);
  if (!principal) {
    return unauthorizedAdminResponse();
  }

  if (url.pathname === `${ADMIN_PATH}/api/chats` && req.method === 'GET') {
    if (principal.type !== 'telegram' || !principal.telegramId) {
      return unauthorizedAdminResponse();
    }

    return Response.json({
      ok: true,
      user: {
        id: principal.telegramId,
        username: principal.username,
        displayName: principal.displayName,
      },
      chats: await listAdminChatsForTelegramUser(env, principal.telegramId),
    });
  }

  if (url.pathname === `${ADMIN_PATH}/api/chat` && req.method === 'GET') {
    const chatId = parseChatId(url);
    if (chatId === null) {
      return jsonError('chatId is required', 400);
    }

    let period;
    try {
      period = parseAdminPeriod(
        url.searchParams.get('period'),
        url.searchParams.get('from'),
        url.searchParams.get('to'),
      );
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : 'invalid period', 400);
    }

    const denied = await requireTelegramChatAccess(env, principal, chatId);
    if (denied) {
      return denied;
    }

    try {
      return Response.json(await getAdminChatStats(env, chatId, period));
    } catch (error) {
      if (error instanceof LiveProgressUnavailable) {
        return liveProgressUnavailableResponse(error);
      }
      if (error instanceof HistoricalStatsNotReady || error instanceof AdminUnavailable) {
        return statsUnavailable(error, period);
      }
      throw error;
    }
  }

  if (url.pathname === `${ADMIN_PATH}/api/notifications`) {
    const chatId = parseChatId(url);
    if (chatId === null) {
      return jsonError('chatId is required', 400);
    }

    if (req.method === 'GET') {
      const denied = await requireTelegramChatAccess(env, principal, chatId);
      if (denied) {
        return denied;
      }

      return await handleNotificationGet(env, chatId, principal);
    }

    if (req.method === 'POST') {
      const denied = await requireTelegramChatAccess(env, principal, chatId);
      if (denied) {
        return denied;
      }
      const adminDenied = await requireTelegramChatAdmin(env, principal, chatId);
      if (adminDenied) {
        return adminDenied;
      }

      return await handleNotificationPost(req, env, chatId, principal);
    }
  }

  return new Response('Not found', { status: 404 });
}
