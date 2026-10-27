import type { Env } from '../../core/env';

// Anonymous install counting for self-hosted bots. Once a day each install
// sends a random install id and coarse usage buckets to the hosted instance.
// Never chat ids, user ids, message content, tokens or bot usernames.
// Opt out with TELEMETRY_DISABLED=true.

export const TELEMETRY_ENDPOINT = 'https://tghistory.thesunwave.space/telemetry/v1/ping';
export const TELEMETRY_PATH = '/telemetry/v1/ping';
export const TELEMETRY_SCHEMA = 1;
const TELEMETRY_SETTINGS_SCOPE = 'telemetry';
const MAX_BODY_BYTES = 1024;

export const CHAT_BUCKETS = ['0', '1', '2-5', '6-20', '21-100', '100+'] as const;
export type ChatBucket = typeof CHAT_BUCKETS[number];

export interface TelemetryPayload {
  schema: number;
  installId: string;
  activeChats7d: ChatBucket;
  activeGroups7d: ChatBucket;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isTrue(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

export function isTelemetryDisabled(env: Env): boolean {
  // The receiving instance counts its own chats directly in D1.
  return isTrue(env.TELEMETRY_DISABLED) || isTrue(env.TELEMETRY_RECEIVER);
}

export function bucketChats(count: number): ChatBucket {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 100) return '21-100';
  return '100+';
}

export async function getInstallId(env: Env): Promise<string> {
  const candidate = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO app_settings(scope, settings_json, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(scope) DO NOTHING`,
  ).bind(TELEMETRY_SETTINGS_SCOPE, JSON.stringify({ installId: candidate })).run();
  const row = await env.DB.prepare('SELECT settings_json FROM app_settings WHERE scope = ?')
    .bind(TELEMETRY_SETTINGS_SCOPE)
    .first<{ settings_json: string }>();
  const stored = row ? JSON.parse(row.settings_json)?.installId : undefined;
  if (typeof stored !== 'string' || !UUID_PATTERN.test(stored)) {
    throw new Error('telemetry install id unavailable');
  }
  return stored;
}

export async function buildTelemetryPayload(env: Env): Promise<TelemetryPayload> {
  const installId = await getInstallId(env);
  const counts = await env.DB.prepare(
    `SELECT COUNT(DISTINCT chat_id) AS chats,
            COUNT(DISTINCT CASE WHEN chat_id < 0 THEN chat_id END) AS groups
       FROM stats_daily_user
      WHERE day >= date('now', '-7 day')`,
  ).first<{ chats: number; groups: number }>();
  return {
    schema: TELEMETRY_SCHEMA,
    installId,
    activeChats7d: bucketChats(Number(counts?.chats) || 0),
    activeGroups7d: bucketChats(Number(counts?.groups) || 0),
  };
}

// Best effort: telemetry must never break the daily cron.
export async function sendTelemetryPing(
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<'sent' | 'disabled' | 'failed'> {
  if (isTelemetryDisabled(env)) return 'disabled';
  try {
    const payload = await buildTelemetryPayload(env);
    const response = await fetchImpl(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}

export function parseTelemetryPayload(raw: unknown): TelemetryPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (value.schema !== TELEMETRY_SCHEMA) return null;
  if (typeof value.installId !== 'string' || !UUID_PATTERN.test(value.installId)) return null;
  const isBucket = (bucket: unknown): bucket is ChatBucket =>
    typeof bucket === 'string' && (CHAT_BUCKETS as readonly string[]).includes(bucket);
  if (!isBucket(value.activeChats7d) || !isBucket(value.activeGroups7d)) return null;
  return {
    schema: TELEMETRY_SCHEMA,
    installId: value.installId,
    activeChats7d: value.activeChats7d,
    activeGroups7d: value.activeGroups7d,
  };
}

// Receiver on the hosted instance. Stores only the payload fields and the
// UTC day; no IP address, user agent or other request metadata.
export async function handleTelemetryPing(req: Request, env: Env): Promise<Response> {
  if (!isTrue(env.TELEMETRY_RECEIVER)) return new Response('Not found', { status: 404 });
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return new Response('Payload too large', { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  const payload = parseTelemetryPayload(raw);
  if (!payload) return new Response('Bad request', { status: 400 });
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT INTO telemetry_installs(install_id, first_seen, last_seen, active_chats_7d, active_groups_7d, ping_days)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(install_id) DO UPDATE SET
       ping_days = ping_days + CASE WHEN last_seen < excluded.last_seen THEN 1 ELSE 0 END,
       last_seen = excluded.last_seen,
       active_chats_7d = excluded.active_chats_7d,
       active_groups_7d = excluded.active_groups_7d`,
  ).bind(payload.installId, day, day, payload.activeChats7d, payload.activeGroups7d).run();
  return new Response(null, { status: 204 });
}
