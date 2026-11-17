import type { Env } from '../core/env';
import { authenticateTelegramSession } from './admin-auth';
import { ProviderInitializer } from '../core/providers/provider-init';
import {
  profanityViaCriminalPrefilter, resolveRuntimeSettings, saveSummaryRuntimeSettings, saveRuntimeSettings,
} from '../core/runtime-settings';
import { getWebhookSecret } from '../core/webhook-secret';
import { AdminLanguage, createAdminTranslator, resolveAdminLanguage } from './admin-i18n';

const SESSION_COOKIE = 'tg_setup_session';
const SESSION_SECONDS = 2 * 60 * 60;

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return difference === 0;
}

async function signTimestamp(env: Env, timestamp: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.TOKEN),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode('telegram-history:setup:v1:' + timestamp),
  );
  return [...new Uint8Array(signature)].map(value => value.toString(16).padStart(2, '0')).join('');
}

const OWNER_SCOPE = 'telegram_owner';
type OwnerAuthMethod = 'telegram' | 'token';

function configuredOwnerId(env: Env): string | null {
  const value = env.ADMIN_USER_ID?.trim();
  return value && /^[1-9][0-9]*$/.test(value) ? value : null;
}

async function storedOwnerId(env: Env): Promise<string | null> {
  if (!env.DB?.prepare) return null;
  const row = await env.DB.prepare('SELECT settings_json FROM app_settings WHERE scope = ?')
    .bind(OWNER_SCOPE).first() as { settings_json?: string } | null;
  if (!row?.settings_json) return null;
  const parsed = JSON.parse(row.settings_json) as { telegramId?: unknown };
  return typeof parsed.telegramId === 'string' && /^[1-9][0-9]*$/.test(parsed.telegramId)
    ? parsed.telegramId : null;
}

/** Only the instance owner (or a user eligible for one-time pairing) sees the global settings link. */
export async function canAccessSetupLink(env: Env, telegramId: number): Promise<boolean> {
  const ownerId = configuredOwnerId(env) ?? await storedOwnerId(env);
  return !ownerId || ownerId === String(telegramId);
}

async function setupOwnerAuth(req: Request, env: Env): Promise<OwnerAuthMethod | null> {
  const principal = await authenticateTelegramSession(req, env);
  if (principal?.telegramId) {
    // Ordinary Telegram group admins have no instance-wide permissions.
    const ownerId = configuredOwnerId(env) ?? await storedOwnerId(env);
    if (String(principal.telegramId) === ownerId) return 'telegram';
  }
  // Token sessions only bootstrap standalone installations without Telegram Login.
  // When Telegram Login is configured, only the designated Telegram owner can
  // change global settings, even if a legacy token session cookie exists.
  if (!env.TOKEN || env.TELEGRAM_LOGIN_CLIENT_ID) return null;
  const matching = (req.headers.get('Cookie') || '').split(';').map(item => item.trim())
    .filter(item => item.startsWith(SESSION_COOKIE + '='));
  if (matching.length !== 1) return null;
  const cookie = matching[0].slice(SESSION_COOKIE.length + 1);
  const pieces = cookie.split('.');
  if (pieces.length !== 2 || !/^[0-9]{10}$/.test(pieces[0]) ||
    !/^[0-9a-f]{64}$/.test(pieces[1])) return null;
  const issuedAt = Number(pieces[0]);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now || now - issuedAt > SESSION_SECONDS) return null;
  return constantTimeEqual(pieces[1], await signTimestamp(env, pieces[0])) ? 'token' : null;
}

function setupCookie(value: string, maxAge: number): string {
  return [SESSION_COOKIE + '=' + value, 'Path=/admin', 'HttpOnly', 'Secure',
    'SameSite=Strict', 'Max-Age=' + maxAge].join('; ');
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
}

async function telegramApi(env: Env, method: string, args?: Record<string, unknown>) {
  const response = await fetch('https://api.telegram.org/bot' + env.TOKEN + '/' + method, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  const body = await response.json().catch(() => null) as {
    ok?: boolean; result?: Record<string, unknown>;
  } | null;
  if (!response.ok || !body?.ok) throw new Error('Telegram ' + method + ' failed');
  return body.result || {};
}

/** Mirror provider/model fallbacks without exposing credentials or invoking an AI call. */
function booleanEnv(value: boolean | string | undefined, fallback: boolean): boolean {
  // Match CriminalCodeAnalyzerDO.getBooleanEnv(name, fallback): omitted flags use
  // the fallback, and any value other than a case-insensitive "false" is enabled.
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() !== 'false';
}

function modelForCapability(env: Env, provider: string, override?: string): string | null {
  if (provider === 'legal-rag') return env.LEGAL_RAG_EMBEDDING_MODEL || '@cf/baai/bge-m3';
  if (override?.trim()) return override.trim();
  switch (provider) {
    case 'openai': return env.OPENAI_MODEL || 'gpt-3.5-turbo';
    case 'openai-premium': return (env as any).OPENAI_PREMIUM_MODEL || env.OPENAI_MODEL || 'gpt-4-turbo';
    case 'openrouter': return env.OPENROUTER_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
    case 'cloudflare': return env.CLOUDFLARE_MODEL || env.SUMMARY_MODEL || null;
    default: return null;
  }
}

function renderSetupHtml(language: AdminLanguage): string {
  const { h, js } = createAdminTranslator(language);
  return `<!doctype html>
<html lang="${language}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h('Настройка Telegram History Bot')}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.2rem;color:#192531;background:#f7f9fb}
section{padding:1.5rem;margin:1rem 0;background:#fff;border:1px solid #d6dfe8;border-radius:14px}
input,select,button{font:inherit;padding:.55rem;margin:.3rem 0;max-width:100%;box-sizing:border-box}
button{cursor:pointer;background:#125f78;border:0;border-radius:7px;color:white}
label{display:block;margin:.7rem 0}small{color:#637487}#error{color:#ba2929;white-space:pre-wrap}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}
</style></head>
<body>
<p><a href="/admin">${h('← Админка')}</a></p><h1>${h('Настройка бота')}</h1>
<section id="login"><h2>${h('Доступ владельца')}</h2>
<p>${h('Войди в')} <a href="/admin">${h('админку через Telegram')}</a>${h('. Если аккаунт уже привязан к боту, настройки откроются автоматически.')}</p>
<p id="ownerStatus"></p>
<form id="claimForm" hidden>
<p>${h('Для первой привязки этого Telegram-аккаунта к боту один раз подтверди владение BotFather-токеном. Повторно вводить его не придётся.')}</p>
<label>BotFather TOKEN <input id="claimToken" type="password" autocomplete="off"></label>
<button>${h('Привязать Telegram-аккаунт')}</button></form>
<details id="bootstrap"><summary>${h('Первоначальная самостоятельная установка без Telegram Login')}</summary>
<p>${h('Можно войти по BotFather-токену. Он не хранится в браузере или D1; сессия действует два часа.')}</p>
<form id="loginForm"><label>BotFather TOKEN <input id="token" type="password" required autocomplete="off"></label>
<button>${h('Войти')}</button></form></details></section>
<div id="settings" hidden>
<section><h2>${h('1. Как хранить сообщения?')}</h2>
<p>${h('Выбери, какие данные бот может сохранять. Решение можно изменить позже.')}</p>
<label><input autocomplete="off" type="radio" name="storageMode" value="stats_only"> <b>${h('Только статистика')}</b> ${h('— исходные сообщения не записываются в KV/DO-хранилище истории. Бот считает сообщения, слова и активность участников.')}</label>
<label><input autocomplete="off" type="radio" name="storageMode" value="history"> <b>${h('История сообщений + статистика')}</b> ${h('— исходные сообщения временно хранятся в твоих Cloudflare KV/DO; доступны сводки и контекстный анализ.')}</label>
<small>${h('В обоих вариантах хранятся счётчики, ID пользователей и метаданные чатов. Смена режима не удаляет уже сохранённую историю; она истекает по сроку хранения. Telegram, Cloudflare и возможные логи платформы остаются отдельными от истории бота.')}</small></section>
<section><h2>${h('2. Включить функции')}</h2>
<label><input id="activity" type="checkbox" autocomplete="off"> ${h('Статистика активности и топы участников')}</label>
<label><input id="profanity" type="checkbox" autocomplete="off"> ${h('Анализ мата при получении сообщений')}</label>
<small>${h('Для анализа мата текст может отправляться AI-провайдеру, даже в режиме без хранения. Провайдер определяется PROFANITY_PROVIDER, а без него — провайдером сводок. Результаты анализа (например, найденные слова) могут храниться отдельно.')}</small>
<label><input id="criminal" type="checkbox" autocomplete="off"> ${h('Контекстный анализ уголовных нарушений (требует истории)')}</label>
<label><input id="enabled" type="checkbox" autocomplete="off"> ${h('AI-сводки (требуют истории)')}</label>
<label>${h('AI-провайдер для сводок')} <select id="provider"><option value="cloudflare">Workers AI</option>
<option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></label>
<label>${h('Модель')} <input id="model" type="text" maxlength="150"></label>
<small>${h('Это настройки провайдера только для AI-сводок. Мат и уголовный анализ могут использовать другие модели.')} ${h('OpenAI/OpenRouter API-ключи добавляй как Cloudflare Secrets, не через эту страницу.')}</small>
<h3>${h('Текущая конфигурация (только чтение)')}</h3>
<p id="configSource"></p>
<ul><li id="configSummary"></li><li id="configProfanity"></li><li id="configCriminal"></li></ul>
<small>${h('Это информационный обзор. Настройки провайдеров мата, уголовного анализа и их дополнительных этапов по-прежнему задаются переменными Cloudflare.')}</small>
<p id="storageWarning" role="status"></p><p id="unsavedWarning" role="status"></p>
<p><button id="save" disabled>${h('Сохранить изменения')}</button></p></section>
<section><h2>3. Telegram webhook</h2>
<p>${h('Подключай бот только после того, как сохранишь выбранный режим хранения.')}</p>
<button id="connect">${h('Подключить webhook')}</button><span id="webhook"></span></section>
<section><h2>${h('Статус')}</h2><pre id="status"></pre>
<button id="logout">${h('Выйти из настройки')}</button></section>
</div><p id="error" role="alert"></p>
<script>
const el = id => document.getElementById(id);
async function api(path, method='GET', body) {
  const response = await fetch('/admin/api/setup/' + path, {
    method, headers:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const json = await response.json().catch(()=>({error:'Request failed'}));
  if (!response.ok) { const error = Error(json.error || 'Request failed ('+response.status+')'); error.status=response.status; throw error; }
  return json;
}
let loadedSettings = null;
let settingsDatabaseReady = false;
function currentSettings() {
  return {
    storageMode: selectedStorageMode(),
    activityTrackingEnabled: el('activity').checked,
    profanityEnabled: el('profanity').checked,
    criminalEnabled: el('criminal').checked,
    summary: { enabled: el('enabled').checked, provider: el('provider').value, model: el('model').value }
  };
}
function updatePendingChanges() {
  const current = currentSettings();
  const changed = loadedSettings && JSON.stringify(current) !== JSON.stringify(loadedSettings);
  el('save').disabled = !changed || !settingsDatabaseReady;
  el('unsavedWarning').textContent = changed
    ? ${js('Есть несохранённые изменения. Сохранение создаст переопределение в D1, которое будет иметь приоритет над переменными Cloudflare.')}
    : ${js('Нет несохранённых изменений.')};
}
function showProviderDetails(info) {
  el('configSource').textContent = info.settingsSource === 'd1'
    ? ${js('Настройки функций переопределены в D1. Изменения Cloudflare могут не влиять на эти переключатели.')}
    : info.settingsSource === 'env'
      ? ${js('Настройки функций получены из текущих переменных Cloudflare. В D1 нет глобального переопределения.')}
      : ${js('Не удалось достоверно определить источник настроек. Не сохраняй изменения, пока D1 недоступна.')};
  const cfg = info.providers;
  const byProvider = ${js('по настройкам провайдера')};
  const off = ${js('выключен')};
  el('configSummary').textContent = ${js('AI-сводки: ')} + (info.summary.enabled ? ${js('включены')} : ${js('выключены')}) +
    ${js('; провайдер: ')} + cfg.summary.provider + ${js('; модель: ')} + cfg.summary.model;
  el('configProfanity').textContent = ${js('Анализ мата: ')} + (!info.features.profanityEnabled ? off
    : cfg.profanity.viaCriminalPrefilter
      ? ${js('включён, считается внутри уголовного prefilter (локальный словарь и подсказки prefilter), отдельных AI-запросов нет')}
      : ${js('включён, отдельный AI-запрос на сообщение; провайдер: ')} + cfg.profanity.provider + ${js('; модель: ')} +
        (cfg.profanity.model || byProvider));
  el('configCriminal').textContent = ${js('Уголовный анализ: ')} + (info.features.criminalEnabled ? ${js('включён')} : off) +
    ${js('; основной провайдер: ')} + cfg.criminal.provider + '; ' + (cfg.criminal.provider === 'legal-rag' ? ${js('embedding-модель: ')} : ${js('модель: ')}) +
    (cfg.criminal.model || byProvider) +
    '; prefilter: ' + (cfg.criminal.prefilterEnabled ? cfg.criminal.prefilterProvider + ' (' + cfg.criminal.prefilterModel + ')' : off) +
    '; final judge: ' + (cfg.criminal.finalJudgeEnabled ? cfg.criminal.finalJudgeProvider + ' (' + cfg.criminal.finalJudgeModel + ')' : off);
}
function selectedStorageMode() {
  return document.querySelector('input[name="storageMode"]:checked')?.value || null;
}
function refreshDependencies() {
  const history = selectedStorageMode() === 'history';
  for (const id of ['enabled', 'criminal']) {
    el(id).disabled = !history;
    if (!history) el(id).checked = false;
  }
  el('storageWarning').textContent = history
    ? ${js('Сырой текст будет сохраняться на выбранный срок. Внешние AI-провайдеры получают данные только при включении соответствующих функций.')}
    : ${js('Без истории AI-сводки, контекстный уголовный анализ и backfill недоступны.')};
  updatePendingChanges();
}
for (const option of document.querySelectorAll('input[name="storageMode"]')) {
  option.onchange = refreshDependencies;
}
async function refresh() {
  try {
    const info = await api('status');
    el('login').hidden=true; el('settings').hidden=false;
    el('logout').hidden=info.authMethod!=='token';
    for (const option of document.querySelectorAll('input[name="storageMode"]')) {
      option.checked = option.value === info.storageMode;
    }
    el('activity').checked=info.features.activityTrackingEnabled;
    el('profanity').checked=info.features.profanityEnabled;
    el('criminal').checked=info.features.criminalEnabled;
    el('enabled').checked=info.summary.enabled;
    el('provider').value=info.summary.provider;
    el('model').value=info.summary.model;
    settingsDatabaseReady = info.databaseReady;
    loadedSettings = {
      storageMode: info.storageMode,
      activityTrackingEnabled: info.features.activityTrackingEnabled,
      profanityEnabled: info.features.profanityEnabled,
      criminalEnabled: info.features.criminalEnabled,
      summary: { enabled: info.summary.enabled, provider: info.summary.provider, model: info.summary.model }
    };
    showProviderDetails(info);
    refreshDependencies();
    el('status').textContent=JSON.stringify(info,null,2);
    el('webhook').textContent=info.webhookConfigured?${js(' Подключён')}:${js(' Не подключён')};
    el('connect').disabled=info.storageMode==='unconfigured';
    el('error').textContent=info.databaseReady
      ? info.storageMode==='unconfigured' ? ${js('Сначала выбери режим хранения и нажми «Сохранить настройки».')} : ''
      : ${js('D1 не инициализирована. Проверь, что команда npm run deploy завершила все миграции.')};
  } catch(error) {
    if (error.status===401) {
      el('settings').hidden=true; el('login').hidden=false; el('error').textContent='';
      try {
        const identity = await api('identity');
        el('claimForm').hidden=!identity.canClaimOwner;
        el('bootstrap').hidden=identity.telegramLoginConfigured;
        el('ownerStatus').textContent=identity.canClaimOwner
          ? ${js('Ты вошёл через Telegram. Подтверди владение ботом один раз.')}
          : identity.telegramAuthenticated
            ? ${js('Этот Telegram-аккаунт не назначен владельцем бота.')}
            : ${js('Сначала войди в админку через Telegram.')};
      } catch(identityError) {
        el('error').textContent=identityError.message;
      }
    } else {
      el('error').textContent=error.message;
    }
  }
}
el('loginForm').onsubmit=async event=>{
  event.preventDefault();
  try {
    await api('login','POST',{token:el('token').value});
    el('token').value=''; await refresh();
  } catch(error) { el('error').textContent=error.message; }
};
el('claimForm').onsubmit=async event=>{
  event.preventDefault();
  try {
    await api('claim-owner','POST',{token:el('claimToken').value});
    el('claimToken').value=''; await refresh();
  } catch(error) { el('error').textContent=error.message; }
};
el('connect').onclick=async ()=>{
  try { await api('webhook','POST'); await refresh(); }
  catch(error) {el('error').textContent=error.message;}
};
for (const id of ['activity', 'profanity', 'criminal', 'enabled', 'model']) {
  el(id).addEventListener('input', updatePendingChanges);
  el(id).addEventListener('change', updatePendingChanges);
}
el('provider').onchange=()=>{el('model').value='';updatePendingChanges();};
el('save').onclick=async ()=>{
  try {
    const settings = currentSettings();
    if (!settings.storageMode) throw Error(${js('Выбери режим хранения сообщений.')});
    if (!loadedSettings || JSON.stringify(settings) === JSON.stringify(loadedSettings)) return;
    if (!settingsDatabaseReady) throw Error(${js('D1 недоступна. Настройки не сохранены.')});
    if (!window.confirm(${js('Сохранить изменения глобальных настроек? Это запишет их в D1 и переопределит текущие переменные Cloudflare для функций бота.')})) return;
    el('save').disabled = true;
    await api('settings','PATCH',settings);
    await refresh();
  } catch(error) { el('error').textContent=error.message;updatePendingChanges(); }
};
window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
el('logout').onclick=async ()=>{await api('logout','POST');await refresh();};
refresh();
</script></body></html>`;
}

export async function handleSetupRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/admin/setup' && req.method === 'GET') {
    return new Response(renderSetupHtml(resolveAdminLanguage(req)), { headers: {
      'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store',
    } });
  }
  const prefix = '/admin/api/setup/';
  if (!url.pathname.startsWith(prefix)) return new Response('Not found', { status: 404 });
  const route = url.pathname.slice(prefix.length);

  if (req.method !== 'GET' && req.headers.get('Origin') !== url.origin) {
    return errorResponse('Origin check failed', 403);
  }

  if (route === 'identity' && req.method === 'GET') {
    try {
      const principal = await authenticateTelegramSession(req, env);
      const ownerId = configuredOwnerId(env) ?? await storedOwnerId(env);
      return Response.json({
        telegramAuthenticated: Boolean(principal?.telegramId),
        telegramLoginConfigured: Boolean(env.TELEGRAM_LOGIN_CLIENT_ID),
        canClaimOwner: Boolean(principal?.telegramId) && !ownerId,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return errorResponse('Unable to read owner settings', 503);
    }
  }

  if (route === 'claim-owner' && req.method === 'POST') {
    const principal = await authenticateTelegramSession(req, env);
    if (!principal?.telegramId) return errorResponse('Sign in with Telegram first', 401);
    if (!env.DB?.prepare) return errorResponse('D1 database is not ready', 503);
    if (configuredOwnerId(env)) return errorResponse('Owner already configured', 409);
    const body = await req.json().catch(() => null) as { token?: unknown } | null;
    if (typeof body?.token !== 'string' || body.token.length > 512 || !env.TOKEN ||
      !constantTimeEqual(body.token, env.TOKEN)) return errorResponse('Invalid BotFather token', 403);
    try {
      // Atomic claim: a concurrent request cannot replace an existing owner.
      await env.DB.prepare(`INSERT INTO app_settings(scope, settings_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(scope) DO NOTHING`)
        .bind(OWNER_SCOPE, JSON.stringify({ telegramId: String(principal.telegramId) })).run();
      if (await storedOwnerId(env) !== String(principal.telegramId)) {
        return errorResponse('Owner already linked', 409);
      }
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return errorResponse('Unable to link owner, check D1 migrations', 503);
    }
  }

  if (route === 'login' && req.method === 'POST') {
    if (env.TELEGRAM_LOGIN_CLIENT_ID) {
      return errorResponse('Use Telegram Login to manage bot settings', 403);
    }
    const body = await req.json().catch(() => null) as { token?: unknown } | null;
    const token = body?.token;
    if (typeof token !== 'string' || token.length > 512 || !env.TOKEN ||
      !constantTimeEqual(token, env.TOKEN)) return errorResponse('Invalid token', 403);
    const timestamp = String(Math.floor(Date.now() / 1000));
    return Response.json({ ok: true }, { headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': setupCookie(timestamp + '.' + await signTimestamp(env, timestamp), SESSION_SECONDS),
    } });
  }

  const ownerAuth = await setupOwnerAuth(req, env);
  if (!ownerAuth) return errorResponse('Owner authentication required', 401);

  if (route === 'logout' && req.method === 'POST') {
    return Response.json({ ok: true }, { headers: {
      'Cache-Control': 'no-store', 'Set-Cookie': setupCookie('', 0),
    } });
  }
  if (route === 'status' && req.method === 'GET') {
    const settings = await resolveRuntimeSettings(env);
    let databaseReady = false;
    let hasPersistedGlobalSettings = false;
    try {
      if (env.DB?.prepare) {
        await env.DB.prepare('SELECT scope FROM app_settings LIMIT 1').first();
        const override = await env.DB.prepare('SELECT scope FROM app_settings WHERE scope = ?')
          .bind('global').first();
        hasPersistedGlobalSettings = Boolean(override);
        databaseReady = true;
      }
    } catch {
      // A binding can exist before the initial D1 migrations have run.
    }
    let webhookConfigured = false;
    try {
      const webhook = await telegramApi(env, 'getWebhookInfo');
      webhookConfigured = Boolean(webhook.url);
    } catch { /* Report only the configured state, never the bot token. */ }
    return Response.json({
      ok: true, authMethod: ownerAuth, summary: settings.summary, webhookConfigured, databaseReady,
      settingsSource: databaseReady ? hasPersistedGlobalSettings ? 'd1' : 'env' : 'unknown',
      storageMode: settings.storageMode,
      providers: {
        summary: { provider: settings.summary.provider, model: settings.summary.model },
        profanity: {
          provider: env.PROFANITY_PROVIDER || settings.summary.provider,
          model: modelForCapability(env, env.PROFANITY_PROVIDER || settings.summary.provider, env.PROFANITY_MODEL),
          viaCriminalPrefilter: profanityViaCriminalPrefilter({ ...env, ENABLE_CRIMINAL_ANALYSIS: settings.criminalEnabled }),
        },
        criminal: {
          provider: env.CRIMINAL_PROVIDER || settings.summary.provider,
          model: modelForCapability(env, env.CRIMINAL_PROVIDER || settings.summary.provider, env.CRIMINAL_MODEL),
          prefilterEnabled: booleanEnv(env.CRIMINAL_AI_PREFILTER_ENABLED, true),
          prefilterProvider: env.CRIMINAL_PREFILTER_PROVIDER || 'openai',
          prefilterModel: env.CRIMINAL_PREFILTER_PROVIDER === 'qwen'
            ? env.QWEN_PREFILTER_MODEL || env.QWEN_SHADOW_MODEL || 'qwen3.7-flash'
            : env.CRIMINAL_PREFILTER_MODEL || env.LLM_NANO_MODEL || 'gpt-4.1-nano',
          finalJudgeEnabled: booleanEnv(env.CRIMINAL_FINAL_JUDGE_ENABLED, true),
          finalJudgeProvider: 'OpenAI',
          finalJudgeModel: env.CRIMINAL_FINAL_JUDGE_MODEL || 'gpt-5-nano',
        },
      },
      features: {
        activityTrackingEnabled: settings.activityTrackingEnabled,
        profanityEnabled: settings.profanityEnabled,
        criminalEnabled: settings.criminalEnabled,
      },
      bindings: { history: Boolean(env.HISTORY),
        database: Boolean(env.DB), workersAi: Boolean(env.AI) },
      providerKeys: { openai: Boolean(env.OPENAI_API_KEY), openrouter: Boolean(env.OPENROUTER_API_KEY) },
      advanced: { criminal: settings.criminalEnabled, rag: Boolean(env.LEGAL_RAG_INDEX) },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (route === 'webhook' && req.method === 'POST') {
    if ((await resolveRuntimeSettings(env)).storageMode === 'unconfigured') {
      return errorResponse('Choose and save a storage mode before connecting Telegram', 409);
    }
    const secret = await getWebhookSecret(env);
    if (!secret) return errorResponse('Webhook secret not configured', 400);
    try {
      await telegramApi(env, 'setWebhook', {
        url: url.origin + '/telegram/webhook',
        secret_token: secret,
        allowed_updates: ['message', 'edited_message'],
      });
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      return errorResponse('Telegram rejected webhook registration', 502);
    }
  }
  if (route === 'settings' && req.method === 'PATCH') {
    const input = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || !input.summary || typeof input.summary !== 'object') {
      return errorResponse('Invalid bot settings', 400);
    }
    try {
      const settings = await saveRuntimeSettings(env, input as any);
      ProviderInitializer.reset();
      return Response.json({ ok: true, settings }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Unable to save settings', 400);
    }
  }
  if (route === 'summary' && req.method === 'PATCH') {
    const input = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!input || typeof input.enabled !== 'boolean' ||
      !['cloudflare', 'openai', 'openrouter'].includes(String(input.provider)) ||
      typeof input.model !== 'string') return errorResponse('Invalid summary settings', 400);
    try {
      const summary = await saveSummaryRuntimeSettings(env, {
        enabled: input.enabled, provider: input.provider as 'cloudflare' | 'openai' | 'openrouter',
        model: input.model,
      });
      ProviderInitializer.reset();
      return Response.json({ ok: true, summary }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return errorResponse(error instanceof Error ? error.message : 'Unable to save settings', 400);
    }
  }
  return new Response('Not found', { status: 404 });
}
