import type { Env } from '../core/env';
import { NotificationService } from '../core/services/notification-service';
import { NotificationRepository } from '../core/repositories/notification-repository';
import type { NotificationType } from '../core/models/notification-settings';
import {
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
import { getAdminChatStats, parseAdminPeriod } from './admin-stats';
import { renderAdminHtml } from './admin-html';

const ADMIN_PATH = '/admin';

const TELEGRAM_API = 'https://api.telegram.org';
const BOT_COMMANDS = [
  { command: 'help', description: 'Справка по командам' },
  { command: 'top', description: 'Топ активных участников' },
  { command: 'summary', description: 'Сводка за последние дни' },
  { command: 'summary_last', description: 'Сводка последних сообщений' },
];

function jsonError(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, { status });
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

async function telegramApiRequest(
  env: Env,
  method: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (!env.TOKEN) {
    return { ok: false, error: 'Telegram bot token is not configured' };
  }

  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TOKEN}/${method}`, body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : undefined);
    const payload = await response.json().catch(() => null) as {
      ok?: boolean;
      result?: unknown;
      description?: unknown;
    } | null;

    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        error: typeof payload?.description === 'string'
          ? payload.description
          : `Telegram API request failed (${response.status})`,
      };
    }

    return { ok: true, result: payload.result };
  } catch {
    return { ok: false, error: 'Telegram API request failed' };
  }
}

function isSummaryEnabled(env: Env): boolean {
  return env.ENABLE_SUMMARY !== false && env.ENABLE_SUMMARY !== 'false';
}

function renderSetupHtml(): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Настройка Telegram Stats Bot</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:800px;margin:32px auto;padding:0 16px;color:#18202a}section{border:1px solid #d9dee7;border-radius:8px;padding:16px;margin:16px 0}code{background:#f3f5f7;padding:2px 4px;border-radius:4px}button{padding:9px 14px;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f7;padding:12px;border-radius:6px}</style>
</head><body><p><a href="/admin">← Админ-панель</a></p><h1>Настройка бота</h1>
<section><h2>Webhook</h2><p>Подключите Telegram к этому Worker. Адрес webhook всегда создаётся из текущего домена и не вводится вручную.</p><button id="webhook">Подключить Telegram</button></section>
<section><h2>Сводки</h2><p><b>Выключено:</b> задайте <code>ENABLE_SUMMARY=false</code>.</p><p><b>OpenAI:</b> сохраните <code>OPENAI_API_KEY</code> как Worker Secret и задайте <code>SUMMARY_PROVIDER=openai</code>, <code>OPENAI_MODEL</code> (или <code>SUMMARY_MODEL</code>) в Variables.</p><p><b>Workers AI:</b> задайте <code>SUMMARY_PROVIDER=cloudflare</code> и модель в <code>SUMMARY_MODEL</code>. У Workers AI есть квоты и возможная тарификация после их исчерпания.</p><p>Секреты не вводятся и не сохраняются на этой странице. В Cloudflare Dashboard: <code>Workers & Pages → ваш Worker → Settings → Variables and Secrets</code>. CLI: <code>npx wrangler secret put OPENAI_API_KEY</code>.</p></section>
<section><h2>Текущее состояние</h2><button id="recheck">Проверить снова</button><pre id="status">Загрузка…</pre></section>
<script>const status=document.getElementById('status');async function recheck(){const r=await fetch('/admin/api/setup');if(r.status===401){location.assign('/admin');return}status.textContent=JSON.stringify(await r.json(),null,2)}document.getElementById('recheck').onclick=recheck;document.getElementById('webhook').onclick=async()=>{const r=await fetch('/admin/api/setup/webhook',{method:'POST'});status.textContent=JSON.stringify(await r.json(),null,2)};recheck();</script>
</body></html>`;
}

async function handleSetupStatus(env: Env): Promise<Response> {
  const [bot, webhook] = await Promise.all([
    telegramApiRequest(env, 'getMe'),
    telegramApiRequest(env, 'getWebhookInfo'),
  ]);

  return Response.json({
    ok: true,
    bot,
    webhook,
    summary: {
      enabled: isSummaryEnabled(env),
      provider: env.SUMMARY_PROVIDER || null,
      model: env.OPENAI_MODEL || env.SUMMARY_MODEL || null,
    },
    configured: {
      token: Boolean(env.TOKEN),
      webhookSecret: Boolean(env.SECRET),
      openaiApiKey: Boolean(env.OPENAI_API_KEY),
      workersAi: Boolean(env.AI),
      history: Boolean(env.HISTORY),
      counters: Boolean(env.COUNTERS),
      database: Boolean(env.DB),
    },
  });
}

async function handleSetupWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.TOKEN || !env.SECRET) {
    return jsonError('TOKEN and SECRET must be configured as Worker Secrets', 400);
  }

  const webhookUrl = `${new URL(req.url).origin}/telegram/webhook`;
  const webhook = await telegramApiRequest(env, 'setWebhook', {
    url: webhookUrl,
    secret_token: env.SECRET,
    allowed_updates: ['message', 'edited_message'],
  });
  if (!webhook.ok) {
    return Response.json({ ok: false, error: { code: 'set_webhook_failed', message: webhook.error } }, { status: 502 });
  }

  const commands = await telegramApiRequest(env, 'setMyCommands', { commands: BOT_COMMANDS });
  if (!commands.ok) {
    return Response.json({ ok: false, error: { code: 'set_commands_failed', message: commands.error } }, { status: 502 });
  }

  return Response.json({ ok: true, webhookUrl, webhook: webhook.result, commands: commands.result });
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
  const updatedBy = `admin-telegram:${principal.telegramId}`;
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

  if (url.pathname === `${ADMIN_PATH}/setup` || url.pathname.startsWith(`${ADMIN_PATH}/api/setup`)) {
    const principal = await authenticateTelegramSession(req, env);
    if (!principal) {
      return unauthorizedAdminResponse();
    }

    if (url.pathname === `${ADMIN_PATH}/setup` && req.method === 'GET') {
      return new Response(renderSetupHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=UTF-8',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.pathname === `${ADMIN_PATH}/api/setup` && req.method === 'GET') {
      return await handleSetupStatus(env);
    }

    if (url.pathname === `${ADMIN_PATH}/api/setup/webhook` && req.method === 'POST') {
      return await handleSetupWebhook(req, env);
    }

    return new Response('Not found', { status: 404 });
  }

  const principal = await authenticateTelegramSession(req, env);
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

    return Response.json(await getAdminChatStats(env, chatId, period));
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
