import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';

export const CONFIG_PATH = 'wrangler.production.jsonc';
// Only inert values and Worker Secrets are deliberately excluded from
// infrastructure drift checks. Unknown live binding types fail closed.
const NON_RESOURCE_TYPES = new Set(['plain_text', 'json', 'secret_text']);

export function wranglerJson(...args) {
  const command = resolve('node_modules/.bin/wrangler');
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Cloudflare read-only request failed: ${args[0]} ${args[1] || ''}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`Cloudflare returned invalid JSON for ${args[0]} ${args[1] || ''}`);
  }
}

export function report(text) {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  }
}

export function configuredBindings(config) {
  const bindings = [];
  for (const kv of config.kv_namespaces || []) {
    bindings.push({ name: kv.binding, type: 'kv_namespace', namespace_id: kv.id });
  }
  for (const bucket of config.r2_buckets || []) {
    bindings.push({ name: bucket.binding, type: 'r2_bucket', bucket_name: bucket.bucket_name });
  }
  for (const queue of config.queues?.producers || []) {
    bindings.push({ name: queue.binding, type: 'queue', queue_name: queue.queue });
  }
  for (const db of config.d1_databases || []) {
    bindings.push({ name: db.binding, type: 'd1', database_id: db.database_id });
  }
  for (const entry of config.durable_objects?.bindings || []) {
    bindings.push({ name: entry.name, type: 'durable_object_namespace', class_name: entry.class_name });
  }
  for (const entry of config.vectorize || []) {
    bindings.push({ name: entry.binding, type: 'vectorize', index_name: entry.index_name });
  }
  for (const entry of config.services || []) {
    bindings.push({ name: entry.binding, type: 'service', service: entry.service });
  }
  for (const entry of config.analytics_engine_datasets || []) {
    bindings.push({ name: entry.binding, type: 'analytics_engine', dataset: entry.dataset });
  }
  if (config.ai?.binding) bindings.push({ name: config.ai.binding, type: 'ai' });
  return bindings;
}

export function compareBindings(expected, deployed) {
  const actual = new Map(deployed.filter(binding => !NON_RESOURCE_TYPES.has(binding.type))
    .map(binding => [binding.name, binding]));
  const desired = new Map(expected.map(binding => [binding.name, binding]));
  const mismatches = [];

  for (const [name, binding] of desired) {
    const live = actual.get(name);
    if (!live) {
      mismatches.push(`${name}: missing from deployed Worker`);
      continue;
    }
    for (const [key, value] of Object.entries(binding)) {
      if (value !== undefined && live[key] !== value) {
        mismatches.push(`${name}: ${key} differs from deployed Worker`);
      }
    }
  }
  for (const name of actual.keys()) {
    if (!desired.has(name)) mismatches.push(`${name}: deployment would remove resource binding`);
  }
  return mismatches;
}

export function pendingMigrations(files, applied) {
  const appliedNames = new Set(applied);
  return files.filter(file => !appliedNames.has(file)).sort();
}

// A statement is additive when it only creates tables/indexes or adds columns.
// Anything else (UPDATE, DROP, INSERT, triggers, renames) fails closed.
const ADDITIVE_STATEMENT =
  /^(CREATE\s+TABLE(\s+IF\s+NOT\s+EXISTS)?\s|CREATE\s+(UNIQUE\s+)?INDEX(\s+IF\s+NOT\s+EXISTS)?\s|ALTER\s+TABLE\s+\S+\s+ADD\s)/i;

const QUOTE_CLOSERS = { "'": "'", '"': '"', '`': '`', '[': ']' };

// Quote-aware split: comments and semicolons inside string literals or quoted
// identifiers stay part of the statement. Returns null for unterminated input.
export function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) break;
      current += ' ';
      i = end;
    } else if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return null;
      current += ' ';
      i = end + 1;
    } else if (QUOTE_CLOSERS[char]) {
      const closer = QUOTE_CLOSERS[char];
      let end = i + 1;
      // A doubled quote ('' or "") is an escaped quote inside the literal.
      while (end < sql.length && !(sql[end] === closer && sql[end + 1] !== closer)) {
        end += sql[end] === closer ? 2 : 1;
      }
      if (end >= sql.length) return null;
      current += sql.slice(i, end + 1);
      i = end;
    } else if (char === ';') {
      statements.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  statements.push(current);
  return statements.map(statement => statement.trim()).filter(Boolean);
}

// CREATE TABLE ... AS SELECT copies rows, so it is not purely additive.
const CREATE_TABLE_AS_SELECT = /^CREATE\s+TABLE\b[\s\S]*\bAS\s+SELECT\b/i;

export function isAdditiveMigration(sql) {
  const statements = splitSqlStatements(sql);
  return Boolean(statements?.length) &&
    statements.every(statement =>
      ADDITIVE_STATEMENT.test(statement) && !CREATE_TABLE_AS_SELECT.test(statement));
}

// Additive migrations are applied by the release job after a D1 Time Travel
// restore point is recorded; anything else still blocks an actual deploy.
// nonAdditive is required so a caller cannot skip classification by omission.
export function migrationDecision(pending, willDeploy, nonAdditive) {
  if (!Array.isArray(nonAdditive)) throw new Error('migrationDecision requires the non-additive list');
  if (!pending.length) return { safe: true, reason: 'up to date' };
  if (!willDeploy) {
    return { safe: true, reason: 'Pending production D1 migrations: ' + pending.join(', ') };
  }
  if (nonAdditive.length) {
    return {
      safe: false,
      reason: 'Non-additive D1 migrations need a manual backup and apply before deployment: ' +
        nonAdditive.join(', '),
    };
  }
  return {
    safe: true,
    reason: 'Additive D1 migrations will be applied after a restore point: ' + pending.join(', '),
  };
}

export function nonAdditiveMigrations(pending, readSql) {
  return pending.filter(file => !isAdditiveMigration(readSql(file)));
}

export function readMigrationSql(file) {
  return readFileSync(resolve('migrations', file), 'utf8');
}

export function readPendingMigrations() {
  const result = wranglerJson('d1', 'execute', 'DB', '--remote',
    '--config', CONFIG_PATH, '--json', '--command',
    'SELECT name FROM d1_migrations ORDER BY id');
  if (!Array.isArray(result) || !result[0]?.success || !Array.isArray(result[0].results)) {
    throw new Error('Could not read the production D1 migration registry');
  }
  const files = readdirSync('migrations').filter(name => /^[0-9]{4}.*[.]sql$/.test(name));
  return pendingMigrations(files, result[0].results.map(row => row.name));
}

function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Production Cloudflare credentials are missing');
  }
  const parsed = ts.parseConfigFileTextToJson(CONFIG_PATH, readFileSync(CONFIG_PATH, 'utf8'));
  if (parsed.error) throw new Error('Invalid production Wrangler config');
  const config = parsed.config;
  if (config.name !== 'telegram-history-bot') throw new Error('Unexpected production Worker name');
  if (!config.routes?.some(route =>
    route.pattern === 'tghistory.thesunwave.space' && route.custom_domain === true)) {
    throw new Error('Production custom domain is missing');
  }
  if (!config.services?.some(binding =>
    binding.binding === 'LANDING' && binding.service === 'telegram-history-landing')) {
    throw new Error('Production landing service binding is missing');
  }

  const deployments = wranglerJson('deployments', 'list', '--name', config.name,
    '--json', '--config', CONFIG_PATH);
  const latest = [...deployments].sort((a, b) => b.created_on.localeCompare(a.created_on))[0];
  if (!latest || latest.versions.length !== 1 || latest.versions[0].percentage !== 100) {
    throw new Error('Expected a single active production Worker version at 100%');
  }
  const version = wranglerJson('versions', 'view', latest.versions[0].version_id,
    '--name', config.name, '--json', '--config', CONFIG_PATH);
  const mismatches = compareBindings(configuredBindings(config), version.resources.bindings);
  if (mismatches.length) {
    throw new Error('Production binding drift:\n' + mismatches.join('\n'));
  }
  report('Production resource bindings match the active Worker.');

  const pending = readPendingMigrations();
  if (pending.length) {
    const decision = migrationDecision(
      pending,
      process.env.DEPLOY_TO_PRODUCTION === 'true',
      nonAdditiveMigrations(pending, readMigrationSql),
    );
    report(decision.reason);
    if (!decision.safe) throw new Error(decision.reason);
    return;
  }
  report('Production D1 migrations are up to date.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
