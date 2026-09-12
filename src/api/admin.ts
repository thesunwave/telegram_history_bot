import type { Env } from '../core/env';
import { NotificationService } from '../core/services/notification-service';
import { NotificationRepository } from '../core/repositories/notification-repository';
import type { NotificationType } from '../core/models/notification-settings';
import { NotificationValidationUtils } from '../core/models/notification-validation';
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
import { getAdminCriminalViolationDetails } from './admin-criminal';
import {
  AdminUnavailable,
  HistoricalStatsNotReady,
  LiveProgressUnavailable,
} from '../features/stats/admin-stats-errors';
import { renderAdminHtml } from './admin-html';
import { ProviderInitializer } from '../core/providers/provider-init';
import {
  resolveRuntimeSettings,
  saveSummaryRuntimeSettings,
} from '../core/runtime-settings';
import { getWebhookSecret } from '../core/webhook-secret';

const ADMIN_PATH = '/admin';
const TELEGRAM_API = 'https://api.telegram.org';
const BOT_COMMANDS = [
  { command: 'help', description: 'Справка по командам' },
  { command: 'top', description: 'Топ активных участников' },
  { command: 'summary', description: 'Сводка за последние дни' },
  { command: 'summary_last', description: 'Сводка последних сообщений' },
  { command: 'profanity_top', description: 'Топ пользователей по мату' },
  { command: 'profanity_words', description: 'Топ матерных слов' },
  { command: 'my_profanity', description: 'Моя статистика мата' },
  { command: 'profanity_chart_week', description: 'График мата за неделю' },
  { command: 'profanity_chart_month', description: 'График мата за месяц' },
  { command: 'profanity_reset', description: 'Сброс статистики мата' },
  { command: 'criminal_stats', description: 'Статистика нарушений УК' },
  { command: 'my_criminal', description: 'Моя статистика нарушений УК' },
  { command: 'criminal_top', description: 'Топ нарушений УК' },
  { command: 'criminal_reset', description: 'Сброс статистики нарушений УК' },
  { command: 'auto_notifications', description: 'Настройка автоуведомлений' },
  { command: 'reset', description: 'Сброс счётчиков чата' },
  { command: 'activity_week', description: 'Активность за неделю' },
  { command: 'activity_month', description: 'Активность за месяц' },
  { command: 'activity_users_week', description: 'Активность участников за неделю' },
  { command: 'activity_users_month', description: 'Активность участников за месяц' },
  { command: 'test_race_conditions', description: 'Проверка race conditions' },
];

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
  return Number.isSafeInteger(chatId) && chatId !== 0 ? chatId : null;
}

function parseUserId(url: URL): number | null {
  const rawUserId = url.searchParams.get('userId');
  if (!rawUserId) {
    return null;
  }

  const userId = Number(rawUserId);
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
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
  let canEdit = false;
  if (principal.type === 'telegram' && Boolean(principal.telegramId)) {
    try {
      canEdit = await isTelegramUserChatAdmin(env, chatId, principal.telegramId!);
    } catch {
      canEdit = false;
    }
  }

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
    const response = await fetch(
      `${TELEGRAM_API}/bot${env.TOKEN}/${method}`,
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : undefined,
    );
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: unknown;
      description?: unknown;
    } | null;

    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        error:
          typeof payload?.description === 'string'
            ? payload.description
            : `Telegram API request failed (${response.status})`,
      };
    }

    return { ok: true, result: payload.result };
  } catch {
    return { ok: false, error: 'Telegram API request failed' };
  }
}

function renderSetupHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Настройка Telegram Stats Bot</title>
  <style>
    body{font:16px/1.5 system-ui,sans-serif;max-width:800px;margin:32px auto;padding:0 16px;color:#18202a}
    section{border:1px solid #d9dee7;border-radius:10px;padding:18px;margin:16px 0}
    code,pre{background:#f3f5f7;border-radius:6px}code{padding:2px 4px}pre{padding:12px;white-space:pre-wrap;overflow-wrap:anywhere}
    button,input,select{font:inherit}button{padding:9px 14px;cursor:pointer}.row{display:grid;gap:8px;margin:12px 0}.muted{color:#667085}.ok{color:#16825d}.advanced{background:#fafafa}.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  </style>
</head>
<body>
  <p><a href="/admin">← Админ-панель</a></p>
  <h1>Настройка бота</h1>
  <section>
    <h2>1. Basic</h2>
    <p class="ok"><b>Работает сразу после deploy.</b></p>
    <p>Бот сохраняет сообщения, считает активность и базовую статистику. AI для этого не нужен.</p>
    <div class="actions"><button id="webhook">Подключить Telegram</button><span id="webhookState" class="muted"></span></div>
  </section>
  <section>
    <h2>2. AI-сводки</h2>
    <label class="row"><span><input id="summaryEnabled" type="checkbox"> Включить AI-сводки</span></label>
    <label class="row">Провайдер
      <select id="summaryProvider">
        <option value="cloudflare">Cloudflare Workers AI — без отдельного API key</option>
        <option value="openai">OpenAI</option>
        <option value="openrouter">OpenRouter</option>
      </select>
    </label>
    <label class="row">Модель <input id="summaryModel" type="text"></label>
    <p class="muted" id="providerHint"></p>
    <div class="actions"><button id="saveSummary">Сохранить</button><span id="saveState" class="muted"></span></div>
  </section>
  <section class="advanced">
    <h2>3. Advanced: criminal / RAG</h2>
    <p>В базовой установке выключено. RAG требует отдельного Vectorize binding и загрузки корпуса, поэтому мы не заставляем каждого пользователя создавать эту инфраструктуру при первом deploy.</p>
    <p class="muted">Следующим шагом это можно оформить отдельным Advanced setup flow.</p>
  </section>
  <section>
    <h2>Диагностика</h2>
    <button id="recheck">Проверить снова</button>
    <pre id="status">Загрузка…</pre>
  </section>
  <script>
    const status = document.getElementById('status');
    const summaryEnabled = document.getElementById('summaryEnabled');
    const summaryProvider = document.getElementById('summaryProvider');
    const summaryModel = document.getElementById('summaryModel');
    const providerHint = document.getElementById('providerHint');
    const saveState = document.getElementById('saveState');
    const webhookState = document.getElementById('webhookState');
    let lastState = null;

    function updateProviderHint() {
      if (summaryProvider.value === 'cloudflare') {
        providerHint.textContent = 'Workers AI уже подключён к базовому Worker. Дополнительный секрет не нужен.';
      } else if (summaryProvider.value === 'openai') {
        providerHint.textContent = lastState?.configured?.openaiApiKey
          ? 'OPENAI_API_KEY найден в Cloudflare Secrets.'
          : 'Сначала добавьте OPENAI_API_KEY в Cloudflare → Worker → Settings → Variables and Secrets.';
      } else {
        providerHint.textContent = lastState?.configured?.openrouterApiKey
          ? 'OPENROUTER_API_KEY найден в Cloudflare Secrets.'
          : 'Сначала добавьте OPENROUTER_API_KEY в Cloudflare → Worker → Settings → Variables and Secrets.';
      }
    }

    async function recheck() {
      const response = await fetch('/admin/api/setup');
      if (response.status === 401) { location.assign('/admin'); return; }
      lastState = await response.json();
      status.textContent = JSON.stringify(lastState, null, 2);
      summaryEnabled.checked = Boolean(lastState.summary?.enabled);
      summaryProvider.value = lastState.summary?.provider || 'cloudflare';
      summaryModel.value = lastState.summary?.model || '';
      const webhookUrl = lastState.webhook?.result?.url || '';
      webhookState.textContent = webhookUrl ? 'Webhook подключён' : 'Webhook ещё не подключён';
      updateProviderHint();
    }
    summaryProvider.onchange = updateProviderHint;
    document.getElementById('recheck').onclick = recheck;
    document.getElementById('webhook').onclick = async () => {
      const response = await fetch('/admin/api/setup/webhook', { method: 'POST' });
      const body = await response.json();
      webhookState.textContent = response.ok ? 'Telegram подключён' : (body.error?.message || body.error || 'Ошибка');
      await recheck();
    };
    document.getElementById('saveSummary').onclick = async () => {
      saveState.textContent = 'Сохраняю…';
      const response = await fetch('/admin/api/setup/summary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: summaryEnabled.checked,
          provider: summaryProvider.value,
          model: summaryModel.value,
        }),
      });
      const body = await response.json();
      saveState.textContent = response.ok ? 'Сохранено' : (body.error || 'Ошибка');
      if (response.ok) await recheck();
    };
    recheck();
  </script>
</body>
</html>`;
}

async function handleSetupStatus(env: Env): Promise<Response> {
  const [bot, webhook, settings, webhookSecret] = await Promise.all([
    telegramApiRequest(env, 'getMe'),
    telegramApiRequest(env, 'getWebhookInfo'),
    resolveRuntimeSettings(env),
    getWebhookSecret(env),
  ]);

  return Response.json({
    ok: true,
    bot,
    webhook,
    mode: 'basic',
    summary: settings.summary,
    advanced: {
      criminalEnabled: settings.criminalEnabled,
      ragBindingConfigured: Boolean(env.LEGAL_RAG_INDEX),
    },
    configured: {
      token: Boolean(env.TOKEN),
      webhookSecret: Boolean(webhookSecret),
      webhookSecretSource: env.SECRET ? 'explicit' : 'derived-from-token',
      openaiApiKey: Boolean(env.OPENAI_API_KEY),
      openrouterApiKey: Boolean(env.OPENROUTER_API_KEY),
      workersAi: Boolean(env.AI),
      history: Boolean(env.HISTORY),
      counters: Boolean(env.COUNTERS),
      database: Boolean(env.DB),
    },
  });
}

async function handleSetupWebhook(req: Request, env: Env): Promise<Response> {
  const webhookSecret = await getWebhookSecret(env);
  if (!env.TOKEN || !webhookSecret) {
    return jsonError('TOKEN must be configured as a Worker Secret', 400);
  }

  const webhookUrl = `${new URL(req.url).origin}/telegram/webhook`;
  const webhook = await telegramApiRequest(env, 'setWebhook', {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ['message', 'edited_message'],
  });
  if (!webhook.ok) {
    return Response.json(
      { ok: false, error: { code: 'set_webhook_failed', message: webhook.error } },
      { status: 502 },
    );
  }

  const commands = await telegramApiRequest(env, 'setMyCommands', { commands: BOT_COMMANDS });
  if (!commands.ok) {
    return Response.json(
      { ok: false, error: { code: 'set_commands_failed', message: commands.error } },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, webhookUrl, webhook: webhook.result, commands: commands.result });
}

async function handleSetupSummary(req: Request, env: Env): Promise<Response> {
  const payload = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return jsonError('Invalid JSON body', 400);

  try {
    const summary = await saveSummaryRuntimeSettings(env, {
      enabled: typeof payload.enabled === 'boolean' ? payload.enabled : undefined,
      provider: typeof payload.provider === 'string' ? payload.provider as any : undefined,
      model: typeof payload.model === 'string' ? payload.model : undefined,
    });
    ProviderInitializer.reset();
    return Response.json({ ok: true, summary });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Failed to save summary settings', 400);
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
    (await service.getChatSettings(String(chatId))) ??
    NotificationValidationUtils.createDefaultChatSettings(String(chatId), updatedBy);

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

    if (url.pathname === `${ADMIN_PATH}/api/setup/summary` && req.method === 'PATCH') {
      return await handleSetupSummary(req, env);
    }

    return new Response('Not found', { status: 404 });
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

  if (url.pathname === `${ADMIN_PATH}/api/criminal-violations` && req.method === 'GET') {
    const chatId = parseChatId(url);
    const userId = parseUserId(url);
    if (chatId === null) {
      return jsonError('chatId is required', 400);
    }
    if (userId === null) {
      return jsonError('userId is required', 400);
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

    const details = await getAdminCriminalViolationDetails(env, chatId, userId, period);
    return Response.json(details, { headers: { 'Cache-Control': 'no-store' } });
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
