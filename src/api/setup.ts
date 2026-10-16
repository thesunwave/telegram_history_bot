import type { Env } from '../core/env';
import { authenticateTelegramSession } from './admin-auth';
import { ProviderInitializer } from '../core/providers/provider-init';
import { resolveRuntimeSettings, saveSummaryRuntimeSettings, saveRuntimeSettings } from '../core/runtime-settings';
import { getWebhookSecret } from '../core/webhook-secret';

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

async function isSetupOwner(req: Request, env: Env): Promise<boolean> {
  const ownerId = env.ADMIN_USER_ID?.trim();
  if (ownerId && /^[1-9][0-9]*$/.test(ownerId)) {
    const principal = await authenticateTelegramSession(req, env);
    if (principal?.telegramId && String(principal.telegramId) === ownerId) return true;
  }
  if (!env.TOKEN) return false;
  const matching = (req.headers.get('Cookie') || '').split(';').map(item => item.trim())
    .filter(item => item.startsWith(SESSION_COOKIE + '='));
  if (matching.length !== 1) return false;
  const cookie = matching[0].slice(SESSION_COOKIE.length + 1);
  const pieces = cookie.split('.');
  if (pieces.length !== 2 || !/^[0-9]{10}$/.test(pieces[0]) ||
    !/^[0-9a-f]{64}$/.test(pieces[1])) return false;
  const issuedAt = Number(pieces[0]);
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now || now - issuedAt > SESSION_SECONDS) return false;
  return constantTimeEqual(pieces[1], await signTimestamp(env, pieces[0]));
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

function renderSetupHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Настройка Telegram History Bot</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:3rem auto;padding:0 1.2rem;color:#192531;background:#f7f9fb}
section{padding:1.5rem;margin:1rem 0;background:#fff;border:1px solid #d6dfe8;border-radius:14px}
input,select,button{font:inherit;padding:.55rem;margin:.3rem 0;max-width:100%;box-sizing:border-box}
button{cursor:pointer;background:#125f78;border:0;border-radius:7px;color:white}
label{display:block;margin:.7rem 0}small{color:#637487}#error{color:#ba2929;white-space:pre-wrap}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}
</style></head>
<body>
<p><a href="/admin">← Админка</a></p><h1>Настройка бота</h1>
<section id="login"><h2>Доступ владельца</h2>
<p>Для первого входа используй токен из BotFather. Он не сохраняется в браузере или D1.
Сессия действует два часа.</p>
<form id="loginForm"><label>BotFather TOKEN <input id="token" type="password" required autocomplete="off"></label>
<button>Войти</button></form></section>
<div id="settings" hidden>
<section><h2>1. Как хранить сообщения?</h2>
<p>Выбери, какие данные бот может сохранять. Решение можно изменить позже.</p>
<label><input type="radio" name="storageMode" value="stats_only"> <b>Только статистика</b> — текст сообщений не сохраняется. Бот считает сообщения, слова и активность участников.</label>
<label><input type="radio" name="storageMode" value="history"> <b>История сообщений + статистика</b> — исходные сообщения временно хранятся в твоих Cloudflare KV/DO; доступны сводки и контекстный анализ.</label>
<small>В обоих вариантах хранятся счётчики, ID пользователей и метаданные чатов. Смена режима не удаляет уже сохранённую историю; она истекает по сроку хранения. Telegram и Cloudflare всё равно обрабатывают входящие сообщения.</small></section>
<section><h2>2. Включить функции</h2>
<label><input id="activity" type="checkbox"> Статистика активности и топы участников</label>
<label><input id="profanity" type="checkbox"> Анализ мата при получении сообщений</label>
<small>Для анализа мата текст может отправляться AI-провайдеру, даже в режиме без хранения. Провайдер определяется PROFANITY_PROVIDER, а без него — провайдером сводок. Результаты анализа (например, найденные слова) могут храниться отдельно.</small>
<label><input id="criminal" type="checkbox"> Контекстный анализ уголовных нарушений (требует истории)</label>
<label><input id="enabled" type="checkbox"> AI-сводки (требуют истории)</label>
<label>AI-провайдер для сводок <select id="provider"><option value="cloudflare">Workers AI</option>
<option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></label>
<label>Модель <input id="model" type="text" maxlength="150"></label>
<small>OpenAI/OpenRouter API-ключи добавляй как Cloudflare Secrets, не через эту страницу.</small>
<p id="storageWarning" role="status"></p><p><button id="save">Сохранить настройки</button></p></section>
<section><h2>3. Telegram webhook</h2>
<p>Подключай бот только после того, как сохранишь выбранный режим хранения.</p>
<button id="connect">Подключить webhook</button><span id="webhook"></span></section>
<section><h2>Статус</h2><pre id="status"></pre>
<button id="logout">Выйти из настройки</button></section>
</div><p id="error" role="alert"></p>
<script>
const el = id => document.getElementById(id);
async function api(path, method='GET', body) {
  const response = await fetch('/admin/api/setup/' + path, {
    method, headers:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const json = await response.json().catch(()=>({error:'Request failed'}));
  if (!response.ok) throw Error(json.error || 'Request failed ('+response.status+')');
  return json;
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
    ? 'Сырой текст будет сохраняться на выбранный срок. Внешние AI-провайдеры получают данные только при включении соответствующих функций.'
    : 'Без истории AI-сводки, контекстный уголовный анализ и backfill недоступны.';
}
for (const option of document.querySelectorAll('input[name="storageMode"]')) {
  option.onchange = refreshDependencies;
}
async function refresh() {
  try {
    const info = await api('status');
    el('login').hidden=true; el('settings').hidden=false;
    for (const option of document.querySelectorAll('input[name="storageMode"]')) {
      option.checked = option.value === info.storageMode;
    }
    el('activity').checked=info.features.activityTrackingEnabled;
    el('profanity').checked=info.features.profanityEnabled;
    el('criminal').checked=info.features.criminalEnabled;
    el('enabled').checked=info.summary.enabled;
    el('provider').value=info.summary.provider;
    el('model').value=info.summary.model;
    refreshDependencies();
    el('status').textContent=JSON.stringify(info,null,2);
    el('webhook').textContent=info.webhookConfigured?' Подключён':' Не подключён';
    el('connect').disabled=!info.databaseReady || info.storageMode==='unconfigured';
    el('error').textContent=info.databaseReady
      ? info.storageMode==='unconfigured' ? 'Сначала выбери режим хранения и нажми «Сохранить настройки».' : ''
      : 'D1 не инициализирована. Проверь, что команда npm run deploy завершила все миграции.';
  } catch(error) {
    el('settings').hidden=true; el('login').hidden=false;
  }
}
el('loginForm').onsubmit=async event=>{
  event.preventDefault();
  try {
    await api('login','POST',{token:el('token').value});
    el('token').value=''; await refresh();
  } catch(error) { el('error').textContent=error.message; }
};
el('connect').onclick=async ()=>{
  try { await api('webhook','POST'); await refresh(); }
  catch(error) {el('error').textContent=error.message;}
};
el('provider').onchange=()=>{el('model').value='';};
el('save').onclick=async ()=>{
  try {
    const storageMode = selectedStorageMode();
    if (!storageMode) throw Error('Выбери режим хранения сообщений.');
    await api('settings','PATCH',{
      storageMode,
      activityTrackingEnabled:el('activity').checked,
      profanityEnabled:el('profanity').checked,
      criminalEnabled:el('criminal').checked,
      summary:{enabled:el('enabled').checked, provider:el('provider').value, model:el('model').value}
    });
    await refresh();
  } catch(error) { el('error').textContent=error.message; }
};
el('logout').onclick=async ()=>{await api('logout','POST');await refresh();};
refresh();
</script></body></html>`;
}

export async function handleSetupRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/admin/setup' && req.method === 'GET') {
    return new Response(renderSetupHtml(), { headers: {
      'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store',
    } });
  }
  const prefix = '/admin/api/setup/';
  if (!url.pathname.startsWith(prefix)) return new Response('Not found', { status: 404 });
  const route = url.pathname.slice(prefix.length);

  if (req.method !== 'GET' && req.headers.get('Origin') !== url.origin) {
    return errorResponse('Origin check failed', 403);
  }

  if (route === 'login' && req.method === 'POST') {
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

  if (!await isSetupOwner(req, env)) return errorResponse('Owner authentication required', 401);

  if (route === 'logout' && req.method === 'POST') {
    return Response.json({ ok: true }, { headers: {
      'Cache-Control': 'no-store', 'Set-Cookie': setupCookie('', 0),
    } });
  }
  if (route === 'status' && req.method === 'GET') {
    const settings = await resolveRuntimeSettings(env);
    let databaseReady = false;
    try {
      if (env.DB?.prepare) {
        await env.DB.prepare('SELECT scope FROM app_settings LIMIT 1').first();
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
      ok: true, summary: settings.summary, webhookConfigured, databaseReady,
      storageMode: settings.storageMode,
      features: {
        activityTrackingEnabled: settings.activityTrackingEnabled,
        profanityEnabled: settings.profanityEnabled,
        criminalEnabled: settings.criminalEnabled,
      },
      bindings: { history: Boolean(env.HISTORY), counters: Boolean(env.COUNTERS),
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
