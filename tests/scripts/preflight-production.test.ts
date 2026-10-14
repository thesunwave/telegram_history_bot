import { describe, expect, it } from 'vitest';
import {
  compareBindings,
  configuredBindings,
  pendingMigrations,
  migrationDecision,
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

  it('blocks pending D1 migrations and allows previously applied migrations', () => {
    const files = ['0013_existing.sql', '0014_app_settings.sql'];
    expect(pendingMigrations(files, ['0013_existing.sql'])).toEqual(['0014_app_settings.sql']);
    expect(pendingMigrations(files, files)).toEqual([]);
    expect(migrationDecision(['0014_app_settings.sql'], false).safe).toBe(true);
    expect(migrationDecision(['0014_app_settings.sql'], true).safe).toBe(false);
    expect(migrationDecision([], true).safe).toBe(true);
  });
});
