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

// Runs after production approval, before the Worker deploy. Records a D1 Time
// Travel restore point, then applies pending migrations only if every one is
// additive. Non-additive migrations still need a manual backup and apply.
function main() {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) {
    throw new Error('Production Cloudflare credentials are missing');
  }
  const pending = readPendingMigrations();
  if (!pending.length) {
    report('Production D1 migrations are up to date; nothing to apply.');
    return;
  }
  const nonAdditive = nonAdditiveMigrations(pending, readMigrationSql);
  if (nonAdditive.length) {
    throw new Error('Non-additive D1 migrations need a manual backup and apply: ' +
      nonAdditive.join(', '));
  }

  const info = wranglerJson('d1', 'time-travel', 'info', 'DB', '--json', '--config', CONFIG_PATH);
  if (!info?.bookmark) throw new Error('Could not record a D1 Time Travel restore point');
  report('D1 restore point before migrations: `' + info.bookmark + '`');
  report('To roll back the schema and all later writes: `npx wrangler d1 time-travel restore DB ' +
    '--bookmark=' + info.bookmark + ' --config ' + CONFIG_PATH + '`');

  const apply = spawnSync(resolve('node_modules/.bin/wrangler'),
    ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', CONFIG_PATH],
    { stdio: 'inherit' });
  if (apply.status !== 0) throw new Error('Applying production D1 migrations failed');

  const remaining = readPendingMigrations();
  if (remaining.length) {
    throw new Error('D1 migrations still pending after apply: ' + remaining.join(', '));
  }
  report('Applied production D1 migrations: ' + pending.join(', '));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
