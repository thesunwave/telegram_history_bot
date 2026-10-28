import { Env, LOG_ID_RADIX } from '../core/env';

/**
 * Helps people find the web dashboard from inside Telegram: the /dashboard and
 * /start replies carry the link, and /dashboard is added to the bot's command
 * menu so it is always one tap away.
 */

export const DASHBOARD_COMMAND = {
  command: 'dashboard',
  description: 'Ссылка на дашборд со статистикой',
};

// PUBLIC_URL wins over the webhook origin: a webhook registered on *.workers.dev
// would otherwise hand out a host where Telegram login is not allowed.
export function resolveDashboardUrl(env: Env, origin?: string): string | null {
  const base = (env.PUBLIC_URL || origin || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;
  return base + '/admin';
}

export function buildDashboardText(dashboardUrl: string | null): string {
  if (!dashboardUrl) {
    return 'Ссылка на дашборд пока не настроена. Попросите владельца бота указать PUBLIC_URL.';
  }
  return [
    'Дашборд со статистикой чатов:',
    dashboardUrl,
    '',
    'Войдите через Telegram, и там будут все чаты, где есть бот и вы. ' +
      'Ссылку всегда можно получить снова командой /dashboard.',
  ].join('\n');
}

async function telegramCall(env: Env, method: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${env.TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null) as { ok?: boolean; result?: unknown } | null;
  if (!res.ok || !body?.ok) throw new Error(`Telegram ${method} failed: ${res.status}`);
  return body.result;
}

export async function sendDashboardLink(
  env: Env, chatId: number, dashboardUrl: string | null,
): Promise<string | void> {
  const text = buildDashboardText(dashboardUrl);
  if (env.DRY_RUN) return text;
  const args: Record<string, unknown> = { chat_id: chatId, text, disable_web_page_preview: true };
  if (dashboardUrl) {
    args.reply_markup = { inline_keyboard: [[{ text: 'Открыть дашборд', url: dashboardUrl }]] };
  }
  try {
    await telegramCall(env, 'sendMessage', args);
  } catch {
    console.error('dashboard link send failed', { chat: chatId.toString(LOG_ID_RADIX) });
  }
}

/**
 * Adds /dashboard to the bot's default command menu, keeping any commands the
 * owner already set in BotFather. Idempotent; failures are non-fatal.
 */
export async function ensureDashboardCommand(env: Env): Promise<void> {
  if (env.DRY_RUN || !env.TOKEN) return;
  try {
    const current = await telegramCall(env, 'getMyCommands', {});
    const commands = Array.isArray(current) ? current : [];
    if (commands.some((c: { command?: string }) => c?.command === DASHBOARD_COMMAND.command)) return;
    await telegramCall(env, 'setMyCommands', { commands: [DASHBOARD_COMMAND, ...commands] });
  } catch {
    console.error('dashboard command registration failed');
  }
}
