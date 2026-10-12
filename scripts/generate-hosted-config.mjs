/**
 * Build a hosted-only Wrangler config without baking one owner's domain and
 * Telegram login identity into the publicly reusable deployment config.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const clientId = process.env.TELEGRAM_LOGIN_CLIENT_ID || '';
const username = process.env.TELEGRAM_BOT_USERNAME || '';
const domain = process.env.TELEGRAM_CUSTOM_DOMAIN || '';

if (!/^\d{4,20}$/.test(clientId) || !Number.isSafeInteger(Number(clientId))) {
  throw new Error('Set a numeric TELEGRAM_LOGIN_CLIENT_ID from BotFather.');
}
if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
  throw new Error('Set TELEGRAM_BOT_USERNAME, without the @ prefix.');
}
if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.includes('..')) {
  throw new Error('Set TELEGRAM_CUSTOM_DOMAIN to a domain you own, without https://.');
}

const original = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8');
const mainAnchor = '"main": "src/index.ts",';
const varsAnchor = '"vars": {';
if (original.split(mainAnchor).length !== 2 ||
    original.split(varsAnchor).length !== 2 ||
    original.includes('"TELEGRAM_LOGIN_CLIENT_ID"')) {
  throw new Error('Unexpected Wrangler config layout. Refusing to alter it.');
}

const hosted = original
  .replace(mainAnchor, `${mainAnchor}
  // Telegram's existing webhook uses the workers.dev hostname. Keep it
  // reachable when adding the hosted website's custom domain.
  "workers_dev": true,
  // The separately deployed landing owns only / and /landing/*.
  "services": [
    { "binding": "LANDING", "service": "telegram-history-landing" }
  ],
  "routes": [
    { "pattern": ${JSON.stringify(domain)}, "custom_domain": true }
  ],`)
  .replace(varsAnchor, `${varsAnchor}
    "TELEGRAM_LOGIN_CLIENT_ID": ${JSON.stringify(clientId)},
    "TELEGRAM_BOT_USERNAME": ${JSON.stringify(username)},`);

const output = resolve(root, '.wrangler.hosted.jsonc');
writeFileSync(output, hosted, { mode: 0o600 });
console.log('Generated .wrangler.hosted.jsonc for the hosted Worker.');
