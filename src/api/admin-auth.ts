import type { Env } from '../core/env';

export interface AdminPrincipal {
  type: 'basic' | 'telegram';
  username: string;
  telegramId?: number;
  displayName?: string;
}

export interface TelegramLoginPayload {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
}

const ADMIN_SESSION_COOKIE = 'tg_admin_session';
const TELEGRAM_AUTH_MAX_AGE_SECONDS = 86400;
const SESSION_MAX_AGE_SECONDS = 7 * 86400;

export function unauthorizedAdminResponse(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      Location: '/admin',
      'Set-Cookie': clearTelegramSessionCookie(),
    },
  });
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < maxLength; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }

  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

async function hmacSha256(keyBytes: BufferSource, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return new Uint8Array(signature);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeBasicCredentials(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) {
    return null;
  }

  try {
    const decoded = atob(header.slice('Basic '.length));
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function authenticateAdmin(req: Request, env: Env): AdminPrincipal | null {
  const expectedUser = env.ADMIN_BASIC_USER;
  const expectedPassword = env.ADMIN_BASIC_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    return null;
  }

  const credentials = decodeBasicCredentials(req.headers.get('Authorization'));
  if (!credentials) {
    return null;
  }

  const userMatches = constantTimeEqual(credentials.username, expectedUser);
  const passwordMatches = constantTimeEqual(credentials.password, expectedPassword);

  if (!userMatches || !passwordMatches) {
    return null;
  }

  return { type: 'basic', username: credentials.username };
}

export function getAdminSessionCookieName(): string {
  return ADMIN_SESSION_COOKIE;
}

function getCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get('Cookie');
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      return rawValue.join('=') || null;
    }
  }

  return null;
}

function getSessionSecret(env: Env): string | null {
  return env.SECRET || env.TOKEN || null;
}

async function signSessionPayload(env: Env, encodedPayload: string): Promise<string | null> {
  const secret = getSessionSecret(env);
  if (!secret) {
    return null;
  }

  const signature = await hmacSha256(new TextEncoder().encode(secret), encodedPayload);
  return base64UrlEncode(signature);
}

export async function createTelegramSessionCookie(env: Env, user: TelegramLoginPayload): Promise<string> {
  const payload = {
    id: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signSessionPayload(env, encodedPayload);
  if (!signature) {
    throw new Error('Admin session secret is not configured');
  }

  return [
    `${ADMIN_SESSION_COOKIE}=${encodedPayload}.${signature}`,
    'Path=/admin',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ].join('; ');
}

export function clearTelegramSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function authenticateTelegramSession(
  req: Request,
  env: Env,
): Promise<AdminPrincipal | null> {
  const cookie = getCookie(req, ADMIN_SESSION_COOKIE);
  if (!cookie) {
    return null;
  }

  const [encodedPayload, signature] = cookie.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signSessionPayload(env, encodedPayload);
  if (!expectedSignature || !constantTimeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const decoded = new TextDecoder().decode(base64UrlDecode(encodedPayload));
    const payload = JSON.parse(decoded);
    const issuedAt = Number(payload.issuedAt);
    const telegramId = Number(payload.id);
    if (!Number.isFinite(issuedAt) || !Number.isFinite(telegramId)) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - issuedAt > SESSION_MAX_AGE_SECONDS) {
      return null;
    }

    const username = typeof payload.username === 'string' ? payload.username : `id${telegramId}`;
    const displayName = [payload.firstName, payload.lastName]
      .filter((value) => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
      .trim();

    return {
      type: 'telegram',
      username,
      telegramId,
      displayName: displayName || username,
    };
  } catch {
    return null;
  }
}

export async function verifyTelegramLogin(
  env: Env,
  params: URLSearchParams,
): Promise<TelegramLoginPayload | null> {
  const hash = params.get('hash');
  if (!hash || !env.TOKEN) {
    return null;
  }

  const authDate = Number(params.get('auth_date'));
  const telegramId = Number(params.get('id'));
  if (!Number.isFinite(authDate) || !Number.isFinite(telegramId)) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
    return null;
  }

  const checkString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = await sha256(env.TOKEN);
  const computedHash = bytesToHex(await hmacSha256(secretKey, checkString));

  if (!constantTimeEqual(computedHash, hash)) {
    return null;
  }

  return {
    id: telegramId,
    first_name: params.get('first_name') || undefined,
    last_name: params.get('last_name') || undefined,
    username: params.get('username') || undefined,
    photo_url: params.get('photo_url') || undefined,
    auth_date: authDate,
  };
}
