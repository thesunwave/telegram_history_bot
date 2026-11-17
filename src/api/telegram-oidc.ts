import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Env } from '../core/env';
import { createTelegramSessionCookie, type TelegramLoginPayload } from './admin-auth';

const ISSUER = 'https://oauth.telegram.org';
const NONCE_COOKIE = 'tg_login_nonce';
const NONCE_SECONDS = 300;
const TELEGRAM_KEYS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

/** Bounded error categories for diagnostics; never expose JWTs or claim values. */
function loginFailureReason(error: unknown): string {
  if (error instanceof Error && error.message === 'Telegram ID token nonce mismatch') {
    return 'nonce_mismatch';
  }
  if (error instanceof Error && error.message === 'Telegram ID token is missing a valid user ID') {
    return 'profile_id_missing';
  }
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code: unknown }).code : null;
  switch (code) {
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED': return 'signature_invalid';
    case 'ERR_JWKS_NO_MATCHING_KEY': return 'signing_key_missing';
    case 'ERR_JWKS_TIMEOUT': return 'key_fetch_timeout';
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
    case 'ERR_JWT_EXPIRED': return 'jwt_claims_invalid';
    default: return 'token_validation_failed';
  }
}

/** OIDC requires the Client ID of a Login Widget configured for this website in BotFather. */
export function telegramLoginClientId(env: Env): string | null {
  const candidate = (env.TELEGRAM_LOGIN_CLIENT_ID || '').trim();
  if (!/^\d{4,20}$/.test(candidate) || !Number.isSafeInteger(Number(candidate))) {
    return null;
  }
  return candidate;
}

function nonceCookie(nonce: string, maxAge: number): string {
  return [
    `${NONCE_COOKIE}=${nonce}`,
    'Path=/auth/telegram',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

function requestNonce(req: Request): string | null {
  const matches = (req.headers.get('Cookie') || '').split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(`${NONCE_COOKIE}=`));
  if (matches.length !== 1) return null;
  const nonce = matches[0].slice(NONCE_COOKIE.length + 1);
  return /^[a-f0-9-]{36}$/.test(nonce) ? nonce : null;
}

/** Verify the signed ID token, claims and browser-bound challenge before creating a session. */
export async function verifyTelegramIdToken(
  idToken: string,
  clientId: string,
  nonce: string,
  keys: JWTVerifyGetKey = TELEGRAM_KEYS,
): Promise<TelegramLoginPayload> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: ISSUER,
    audience: clientId,
    algorithms: ['RS256', 'ES256'],
    maxTokenAge: '5 minutes',
    clockTolerance: '30 seconds',
  });

  // jose's generic JWT validator checks signature and standard claims, but not
  // OIDC nonce. Reject any token that wasn't issued for this browser challenge.
  if (typeof payload.nonce !== 'string' || payload.nonce !== nonce) {
    throw new Error('Telegram ID token nonce mismatch');
  }

  // Telegram's Bot API user ID can be represented as a JSON number or decimal
  // string. Do not substitute OIDC 'sub': it is a distinct subject identifier.
  const userId = typeof payload.id === 'string' && /^[1-9][0-9]*$/.test(payload.id)
    ? Number(payload.id)
    : payload.id;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error('Telegram ID token is missing a valid user ID');
  }
  if (typeof payload.iat !== 'number') {
    throw new Error('Telegram ID token is missing its issuance time');
  }
  return {
    id: userId,
    auth_date: payload.iat,
    first_name: typeof payload.given_name === 'string' ? payload.given_name : undefined,
    last_name: typeof payload.family_name === 'string' ? payload.family_name : undefined,
    username: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
  };
}

/** Issue a fresh, browser-bound nonce to initiate the Telegram popup flow. */
export function telegramLoginConfig(env: Env): Response {
  const clientId = telegramLoginClientId(env);
  if (!clientId) {
    return Response.json({ clientId: null, botUsername: env.TELEGRAM_BOT_USERNAME || null }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const nonce = crypto.randomUUID();
  return Response.json({ clientId: Number(clientId), nonce }, {
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': nonceCookie(nonce, NONCE_SECONDS),
    },
  });
}

/** Validate Telegram's signed callback and set the existing /admin session cookie. */
export async function telegramLoginSession(
  req: Request,
  env: Env,
  keys: JWTVerifyGetKey = TELEGRAM_KEYS,
): Promise<Response> {
  const clientId = telegramLoginClientId(env);
  const origin = new URL(req.url).origin;
  if (!clientId || req.headers.get('Origin') !== origin ||
    !req.headers.get('Content-Type')?.startsWith('application/json')) {
    console.warn('telegram_login_rejected', { stage: 'request_headers_or_configuration' });
    return Response.json({ ok: false, error: 'request_rejected' }, { status: 403 });
  }

  const nonce = requestNonce(req);
  if (!nonce) {
    console.warn('telegram_login_rejected', { stage: 'missing_browser_nonce' });
    return Response.json({ ok: false, error: 'browser_nonce_missing' }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as { id_token?: unknown } | null;
  if (typeof body?.id_token !== 'string' || body.id_token.length > 8192) {
    console.warn('telegram_login_rejected', { stage: 'invalid_request_body' });
    return Response.json({ ok: false, error: 'invalid_request_body' }, { status: 400 });
  }

  try {
    const user = await verifyTelegramIdToken(body.id_token, clientId, nonce, keys);
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', await createTelegramSessionCookie(env, user));
    headers.append('Set-Cookie', nonceCookie('', 0));
    return Response.json({ ok: true, redirectTo: '/admin' }, { headers });
  } catch (error) {
    // Operational diagnosis only: never log JWTs, cookie values or identity claims.
    const reason = loginFailureReason(error);
    console.warn('telegram_login_rejected', {
      stage: 'token_or_session_validation',
      errorName: error instanceof Error ? error.name : 'unknown',
      reason,
    });
    return Response.json({ ok: false, error: 'telegram_auth_failed', reason }, {
      status: 401, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
