import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  CONFIG_PATH,
  nonAdditiveMigrations,
  readMigrationSql,
  readPendingMigrations,
  report,
  wranglerJson,
} from './preflight-production.mjs';

// Records a D1 Time Travel restore point, then applies pending migrations only
// if every one is additive. Non-additive migrations still need a manual backup
// and apply. Cloudflare calls are injected so the flow is unit-testable.
export function applyAdditiveMigrations({ readPending, readSql, bookmark, apply, log }) {
  const pending = readPending();
  if (!pending.length) {
    log('Production D1 migrations are up to date; nothing to apply.');
    return { applied: [] };
  }
  const nonAdditive = nonAdditiveMigrations(pending, readSql);
  if (nonAdditive.length) {
    throw new Error('Non-additive D1 migrations need a manual backup and apply: ' +
      nonAdditive.join(', '));
  }

  const restorePoint = bookmark();
  if (!restorePoint) throw new Error('Could not record a D1 Time Travel restore point');
  log('D1 restore point before migrations: `' + restorePoint + '`');
  log('To roll back the schema and all later writes: `npx wrangler d1 time-travel restore DB ' +
    '--bookmark=' + restorePoint + ' --config ' + CONFIG_PATH + '`');

  if (!apply()) throw new Error('Applying production D1 migrations failed');

  const remaining = readPending();
  if (remaining.length) {
    throw new Error('D1 migrations still pending after apply: ' + remaining.join(', '));
  }
  log('Applied production D1 migrations: ' + pending.join(', '));
  return { applied: pending, bookmark: restorePoint };
}

function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Production Cloudflare credentials are missing');
  }
  applyAdditiveMigrations({
    readPending: readPendingMigrations,
    readSql: readMigrationSql,
    bookmark: () =>
      wranglerJson('d1', 'time-travel', 'info', 'DB', '--json', '--config', CONFIG_PATH)?.bookmark,
    apply: () => spawnSync(resolve('node_modules/.bin/wrangler'),
      ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', CONFIG_PATH],
      { stdio: 'inherit' }).status === 0,
    log: report,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
