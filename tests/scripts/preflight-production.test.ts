import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareBindings,
  configuredBindings,
  isAdditiveMigration,
  pendingMigrations,
  migrationDecision,
  nonAdditiveMigrations,
  splitSqlStatements,
} from '../../scripts/preflight-production.mjs';

describe('production release preflight', () => {
  const config = {
    kv_namespaces: [{ binding: 'HISTORY', id: 'kv-1' }],
    d1_databases: [{ binding: 'DB', database_id: 'd1-1' }],
    durable_objects: { bindings: [{ name: 'COUNTERS_DO', class_name: 'CountersDO' }] },
    vectorize: [{ binding: 'LEGAL_RAG_INDEX', index_name: 'legal-rag' }],
    services: [{ binding: 'LANDING', service: 'landing-worker' }],
    analytics_engine_datasets: [{ binding: 'ANALYTICS', dataset: 'analytics' }],
    ai: { binding: 'AI' },
  };
  const deployed = [
    { name: 'HISTORY', type: 'kv_namespace', namespace_id: 'kv-1' },
    { name: 'DB', type: 'd1', database_id: 'd1-1' },
    { name: 'COUNTERS_DO', type: 'durable_object_namespace', class_name: 'CountersDO' },
    { name: 'LEGAL_RAG_INDEX', type: 'vectorize', index_name: 'legal-rag' },
    { name: 'LANDING', type: 'service', service: 'landing-worker' },
    { name: 'ANALYTICS', type: 'analytics_engine', dataset: 'analytics' },
    { name: 'AI', type: 'ai' },
    { name: 'TOKEN', type: 'secret_text' },
  ];

  it('accepts a matching deployment without disclosing or changing secrets', () => {
    expect(compareBindings(configuredBindings(config), deployed)).toEqual([]);
  });

  it('blocks removal of a deployed binding and changes of existing resource IDs', () => {
    const lostBinding = configuredBindings(config).filter(binding => binding.name !== 'LANDING');
    expect(compareBindings(lostBinding, deployed)).toContain(
      'LANDING: deployment would remove resource binding',
    );
    expect(compareBindings(configuredBindings(config), deployed.map(binding =>
      binding.name === 'DB' ? { ...binding, database_id: 'wrong-id' } : binding,
    ))).toContain('DB: database_id differs from deployed Worker');
  });

  it('blocks a not-yet-provisioned binding instead of inventing resources', () => {
    const expected = configuredBindings(config).concat({ name: 'NEW_KV', type: 'kv_namespace' });
    expect(compareBindings(expected, deployed)).toContain('NEW_KV: missing from deployed Worker');
  });

  it('fails closed on unrecognized live resources, including R2 and Queues', () => {
    const live = [
      ...deployed,
      { name: 'ASSETS', type: 'r2_bucket', bucket_name: 'old-assets' },
      { name: 'EVENTS', type: 'queue', queue_name: 'old-events' },
      { name: 'FUTURE_RESOURCE', type: 'new_cloudflare_binding_type' },
    ];
    const issues = compareBindings(configuredBindings(config), live);
    expect(issues).toContain('ASSETS: deployment would remove resource binding');
    expect(issues).toContain('EVENTS: deployment would remove resource binding');
    expect(issues).toContain('FUTURE_RESOURCE: deployment would remove resource binding');
  });

  it('matches configured R2 and Queue resources by their identities', () => {
    const configWithResources = {
      ...config,
      r2_buckets: [{ binding: 'ASSETS', bucket_name: 'my-assets' }],
      queues: { producers: [{ binding: 'EVENTS', queue: 'my-events' }] },
    };
    const live = [
      ...deployed,
      { name: 'ASSETS', type: 'r2_bucket', bucket_name: 'my-assets' },
      { name: 'EVENTS', type: 'queue', queue_name: 'my-events' },
      { name: 'RUNTIME_TOGGLE', type: 'json', json: '{}' },
      { name: 'ENVIRONMENT', type: 'plain_text', text: 'production' },
    ];
    expect(compareBindings(configuredBindings(configWithResources), live)).toEqual([]);
    expect(compareBindings(configuredBindings(configWithResources),
      live.map(binding => binding.name === 'ASSETS' ?
        { ...binding, bucket_name: 'wrong-assets' } : binding),
    )).toContain('ASSETS: bucket_name differs from deployed Worker');
  });

  it('blocks non-additive pending D1 migrations and allows previously applied migrations', () => {
    const files = ['0013_existing.sql', '0014_app_settings.sql'];
    expect(pendingMigrations(files, ['0013_existing.sql'])).toEqual(['0014_app_settings.sql']);
    expect(pendingMigrations(files, files)).toEqual([]);
    expect(migrationDecision(['0014_app_settings.sql'], false, []).safe).toBe(true);
    expect(migrationDecision(['0014_app_settings.sql'], true, ['0014_app_settings.sql']).safe)
      .toBe(false);
    expect(migrationDecision([], true, []).safe).toBe(true);
    // Omitting the classification must not silently pass the gate.
    expect(() => migrationDecision(['0014_app_settings.sql'], true)).toThrow();
  });

  it('lets an actual deploy apply pending migrations only when all are additive', () => {
    expect(migrationDecision(['0015_add.sql'], true, []).safe).toBe(true);
    expect(migrationDecision(['0015_add.sql', '0016_drop.sql'], true, ['0016_drop.sql']))
      .toMatchObject({ safe: false });
  });

  it('classifies only table/index creation and added columns as additive', () => {
    const sql = (file: string) => readFileSync(resolve('migrations', file), 'utf8');
    expect(isAdditiveMigration(sql('0015_stats_daily_media_max_duration.sql'))).toBe(true);
    expect(isAdditiveMigration(sql('0014_app_settings.sql'))).toBe(true);
    expect(isAdditiveMigration(sql('0009_stats_daily_aggregates.sql'))).toBe(true);
    // Data rewrites, seed inserts and triggers fail closed.
    expect(isAdditiveMigration(sql('0005_add_article_title.sql'))).toBe(false);
    expect(isAdditiveMigration(sql('0003_criminal_code.sql'))).toBe(false);
    expect(isAdditiveMigration('DROP TABLE summaries;')).toBe(false);
    expect(isAdditiveMigration('ALTER TABLE a RENAME TO b;')).toBe(false);
    expect(isAdditiveMigration('CREATE TABLE b AS SELECT * FROM a;')).toBe(false);
    expect(nonAdditiveMigrations(
      ['0015_stats_daily_media_max_duration.sql', '0005_add_article_title.sql'], sql,
    )).toEqual(['0005_add_article_title.sql']);
    expect(isAdditiveMigration('-- only a comment')).toBe(false);
    expect(isAdditiveMigration('ALTER TABLE t ADD COLUMN c INTEGER; /* x */ DELETE FROM t;'))
      .toBe(false);
  });

  it('does not treat comment markers or semicolons inside quotes as SQL syntax', () => {
    expect(isAdditiveMigration("CREATE TABLE x (v TEXT DEFAULT '--'); DROP TABLE users;"))
      .toBe(false);
    expect(isAdditiveMigration("CREATE TABLE x (v TEXT DEFAULT '/*'); DROP TABLE users; -- */"))
      .toBe(false);
    expect(isAdditiveMigration("CREATE TABLE x (v TEXT DEFAULT 'a;b', w TEXT DEFAULT 'it''s');"))
      .toBe(true);
    expect(splitSqlStatements("CREATE TABLE x (v TEXT DEFAULT 'a;b'); ALTER TABLE x ADD y INT;"))
      .toEqual(["CREATE TABLE x (v TEXT DEFAULT 'a;b')", 'ALTER TABLE x ADD y INT']);
    // Unterminated literals or block comments fail closed.
    expect(isAdditiveMigration("CREATE TABLE x (v TEXT DEFAULT 'oops);")).toBe(false);
    expect(isAdditiveMigration('CREATE TABLE x (v TEXT); /* never closed')).toBe(false);
  });
});
