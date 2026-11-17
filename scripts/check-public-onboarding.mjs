import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const wranglerPackagePath = require.resolve('wrangler/package.json');
const wrangler = resolve(dirname(wranglerPackagePath), require('wrangler/package.json').bin.wrangler);
const config = 'wrangler.jsonc';
const token = '123456789:onboarding-dummy-not-a-real-bot';
const timeoutMs = 90_000;

function runWrangler(args) {
  return execFileSync(process.execPath, [wrangler, ...args], {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}

async function waitForHealth(base, server, logs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error('Worker exited before health check: ' + logs());
    try {
      const response = await fetch(base + '/healthz', { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200 && (await response.text()) === 'ok') return;
    } catch {
      // The local Worker is not listening yet.
    }
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error('Local Worker did not become healthy: ' + logs());
}

async function run() {
  const state = mkdtempSync(join(tmpdir(), 'telegram-history-onboarding-'));
  let server;
  let logs = '';
  try {
    // An isolated D1 state proves that migrations work without existing data.
    const local = ['--local', '--config', config, '--persist-to', state];
    runWrangler(['d1', 'migrations', 'apply', 'DB', ...local]);
    const migrationCount = readdirSync('migrations').filter(name => /^\d{4}_.+\.sql$/.test(name)).length;
    const query = runWrangler(['d1', 'execute', 'DB', ...local, '--json',
      '--command', 'SELECT COUNT(*) AS total FROM d1_migrations']);
    assert.equal(JSON.parse(query)[0].results[0].total, migrationCount);

    const port = await freePort();
    const base = 'http://127.0.0.1:' + port;
    server = spawn(process.execPath, [wrangler, 'dev', '--local', '--config', config,
      '--ip', '127.0.0.1', '--port', String(port), '--persist-to', state,
      '--var', 'TOKEN:' + token], { stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [server.stdout, server.stderr]) {
      stream.on('data', chunk => {
        logs = (logs + chunk.toString()).slice(-4_000);
      });
    }
    await waitForHealth(base, server, () => logs);

    const root = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(root.status, 302);
    assert.equal(new URL(root.headers.get('location')).pathname, '/admin/setup');

    const page = await fetch(base + '/admin/setup');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.ok((await page.text()).includes('loginForm'));

    const statusUrl = base + '/admin/api/setup/status';
    assert.equal((await fetch(statusUrl)).status, 401);

    async function login(candidate) {
      return fetch(base + '/admin/api/setup/login', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: candidate }),
      });
    }
    assert.equal((await login('not-the-token')).status, 403);
    const response = await login(token);
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.startsWith('tg_setup_session='));
    assert.ok(!cookie.includes(token));

    const headers = { Cookie: cookie };
    const status = await fetch(statusUrl, { headers });
    assert.equal(status.status, 200);
    const first = await status.json();
    assert.equal(first.summary.enabled, false);
    assert.equal(first.storageMode, 'unconfigured');
    assert.equal(first.features.activityTrackingEnabled, true);
    assert.equal(first.features.criminalEnabled, false);
    // Fresh installs cannot connect Telegram without explicitly choosing storage.
    const blockedWebhook = await fetch(base + '/admin/api/setup/webhook', {
      method: 'POST', headers: { ...headers, Origin: base },
    });
    assert.equal(blockedWebhook.status, 409);
    assert.equal(first.advanced.criminal, false);
    assert.equal(first.bindings.database, true);
    assert.equal(first.databaseReady, true);

    const save = await fetch(base + '/admin/api/setup/settings', {
      method: 'PATCH',
      headers: { ...headers, Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ storageMode: 'stats_only', activityTrackingEnabled: true,
        profanityEnabled: false, criminalEnabled: false,
        summary: { enabled: false, provider: 'cloudflare', model: 'smoke-test-model' } }),
    });
    assert.equal(save.status, 200);
    const updated = await fetch(statusUrl, { headers }).then(r => r.json());
    assert.equal(updated.summary.model, 'smoke-test-model');
    assert.equal(updated.storageMode, 'stats_only');

    // Read persisted settings directly rather than trusting the Worker's cache.
    const persisted = runWrangler(['d1', 'execute', 'DB', ...local, '--json',
      '--command', "SELECT settings_json FROM app_settings WHERE scope = 'global'"]);
    const storedSettings = JSON.parse(JSON.parse(persisted)[0].results[0].settings_json);
    assert.equal(storedSettings.summary.model, 'smoke-test-model');
    assert.equal(storedSettings.storageMode, 'stats_only');

    console.log('Fresh-install smoke passed: ' + migrationCount +
      ' migrations, health, setup, owner login, and persisted D1 settings.');
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise(resolve => {
        const finish = () => {
          server.off('exit', finish);
          server.off('error', finish);
          resolve();
        };
        server.once('exit', finish);
        server.once('error', finish);
        try {
          if (!server.kill('SIGTERM')) finish();
        } catch {
          finish();
        }
      });
    }
    // Windows may keep workerd's SQLite cache files open briefly after exit.
    rmSync(state, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : 'Onboarding smoke failed');
  process.exitCode = 1;
});
