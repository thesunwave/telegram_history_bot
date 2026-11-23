import type { Env } from '../core/env';
import { getWebhookSecret } from '../core/webhook-secret';

const HOSTED_ORIGIN = 'https://tghistory.thesunwave.space';
const HOSTED_ORIGINS = [HOSTED_ORIGIN, 'https://telegram-history-bot.thesunwave.workers.dev'];

/** Only these Telegram delivery fields may leave the owner endpoint. */
export function webhookDelivery(info: Record<string, unknown>) {
  const filters = info.allowed_updates;
  const count = info.pending_update_count;
  const date = info.last_error_date;
  let callbackQueries: boolean | null = null;
  if (typeof info.url === 'string' && info.url) {
    // The default Telegram update set includes callback_query.
    if (filters === undefined) callbackQueries = true;
    else if (Array.isArray(filters) && filters.every(type => typeof type === 'string' && type.length)) {
      callbackQueries = !filters.length || filters.includes('callback_query');
    }
  }
  return {
    callbackQueries,
    pendingUpdateCount: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : null,
    ...(typeof date === 'number' && Number.isSafeInteger(date) && date > 0 ? { lastErrorDate: date } : {}),
  };
}

/** Recreate only a registration whose destination and receiving secret this Worker controls. */
export async function callbackRegistration(info: Record<string, unknown>, requestOrigin: string, env: Env) {
  if (!requestOrigin.startsWith('https://') || info.has_custom_certificate !== false ||
    webhookDelivery(info).callbackQueries !== false) return null;
  const hosted = env.PUBLIC_URL === HOSTED_ORIGIN;
  if (hosted && !HOSTED_ORIGINS.includes(requestOrigin)) return null;
  const origins = hosted ? HOSTED_ORIGINS : [requestOrigin];
  let secret: string | null = null;
  // Exact full URLs exclude credentials, query strings, extra path segments and alternate destinations.
  if (origins.some(origin => info.url === origin + '/telegram/webhook')) {
    secret = await getWebhookSecret(env);
  } else if (env.TOKEN && origins.some(origin => info.url === origin + '/tg/' + env.TOKEN + '/webhook')) {
    secret = env.SECRET ?? null;
  }
  const connections = info.max_connections;
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret) || typeof connections !== 'number' ||
    !Number.isInteger(connections) || connections < 1 || connections > 100) return null;
  // WebhookInfo.ip_address is the address currently in use. It does not indicate a fixed-IP override.
  return {
    url: info.url, allowed_updates: [...info.allowed_updates as string[], 'callback_query'],
    max_connections: connections, secret_token: secret, drop_pending_updates: false,
  };
}
