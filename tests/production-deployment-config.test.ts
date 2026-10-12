import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('production deployment contract', () => {
  it('keeps the landing binding and legacy Telegram webhook on Cloudflare Builds', () => {
    // Cloudflare Builds auto-deploys wrangler.jsonc from main, not any local
    // generated config. These entries must survive every bot release.
    const config = readFileSync('wrangler.jsonc', 'utf8');
    expect(config).toMatch(/"workers_dev"\s*:\s*true/);
    expect(config).toContain('"pattern": "tghistory.thesunwave.space"');
    expect(config).toContain('"binding": "LANDING", "service": "telegram-history-landing"');
    expect(config).toContain('"TELEGRAM_LOGIN_CLIENT_ID": "7807841637"');
    expect(config).toContain('"TELEGRAM_BOT_USERNAME": "stat_history_bot"');
  });
});
