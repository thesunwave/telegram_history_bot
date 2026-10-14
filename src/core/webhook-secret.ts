import type { Env } from './env';

export async function getWebhookSecret(env: Pick<Env, 'TOKEN' | 'SECRET'>): Promise<string | null> {
  const explicit = env.SECRET?.trim();
  if (explicit) return explicit;

  const token = env.TOKEN?.trim();
  if (!token) return null;

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`telegram-history-bot:webhook:v1:${token}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
