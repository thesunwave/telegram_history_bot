import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function config(path: string): Record<string, any> {
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (parsed.error) throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
  return parsed.config;
}

describe('production deployment contract', () => {
  it('keeps existing production bindings and webhook independently of the public template', () => {
    const production = config('wrangler.production.jsonc');
    expect(production.workers_dev).toBe(true);
    expect(production.routes).toContainEqual({
      pattern: 'tghistory.thesunwave.space',
      custom_domain: true,
    });
    expect(production.services).toContainEqual({
      binding: 'LANDING',
      service: 'telegram-history-landing',
    });
    expect(production.kv_namespaces.map((entry: any) => entry.binding)).toEqual(['HISTORY', 'COUNTERS']);
    expect(production.kv_namespaces.every((entry: any) => entry.id)).toBe(true);
    expect(production.d1_databases[0].database_id).toBeTruthy();
    expect(production.vectorize[0].binding).toBe('LEGAL_RAG_INDEX');
    expect(production.vars.TELEGRAM_LOGIN_CLIENT_ID).toBeTruthy();
    expect(production.vars.TELEGRAM_BOT_USERNAME).toBeTruthy();
    expect(production.migrations.at(-1)).toMatchObject({ tag: 'v6' });
  });

  it('makes the root Wrangler config portable for Deploy to Cloudflare', () => {
    const publicConfig = config('wrangler.jsonc');
    // The portable template may declare privacy-safe flags, never credentials
    // or account-specific values. New deployments must choose a storage policy.
    expect(publicConfig.vars).toEqual({ REQUIRE_EXPLICIT_STORAGE_CHOICE: true });
    expect(publicConfig.routes).toBeUndefined();
    expect(publicConfig.services).toBeUndefined();
    expect(publicConfig.secrets.required).toEqual(['TOKEN']);
    expect(publicConfig.kv_namespaces.every((binding: any) => !binding.id)).toBe(true);
    expect(publicConfig.d1_databases[0].database_id).toBeUndefined();
    const classes = publicConfig.durable_objects.bindings.map((binding: any) => binding.class_name);
    expect(classes).toEqual(['CountersDO', 'DayBlockManager', 'CriminalCodeAnalyzerDO']);
    expect(Object.keys(publicConfig.exports).sort()).toEqual([...classes].sort());
    expect(publicConfig.d1_databases[0].migrations_dir).toBe('migrations');
  });
});
