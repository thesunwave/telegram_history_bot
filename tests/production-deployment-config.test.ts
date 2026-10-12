import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function config(path: string): Record<string, any> {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  return parsed.config;
}

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

  it('pins the existing production identity and resources independently of the public template', () => {
    const production = config('wrangler.production.jsonc');
    const current = config('wrangler.jsonc');
    // Until the Cloudflare Builds cutover, root and production are identical.
    // Detect accidental drift in *all* bindings, flags, prompts and settings.
    expect(production).toEqual(current);
    expect(production.vars.TELEGRAM_LOGIN_CLIENT_ID).toBeTruthy();
    expect(production.vars.TELEGRAM_BOT_USERNAME).toBeTruthy();
    expect(production.migrations.at(-1)).toMatchObject({ tag: 'v6' });
  });

  it('provides a portable template with no account-specific resources or feature vars', () => {
    const publicConfig = config('wrangler.public.jsonc');
    expect(publicConfig.vars).toBeUndefined();
    expect(publicConfig.routes).toBeUndefined();
    expect(publicConfig.services).toBeUndefined();
    expect(publicConfig.secrets.required).toEqual(['TOKEN']);
    expect(publicConfig.kv_namespaces.every((binding: any) => !binding.id)).toBe(true);
    expect(publicConfig.d1_databases[0].database_id).toBeUndefined();
    const classes = publicConfig.durable_objects.bindings.map((binding: any) => binding.class_name);
    expect(classes).toEqual(['CountersDO', 'DayBlockManager', 'CriminalCodeAnalyzerDO']);
    expect(Object.keys(publicConfig.exports).sort()).toEqual([...classes].sort());
  });
});
