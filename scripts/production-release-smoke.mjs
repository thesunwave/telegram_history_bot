import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://tghistory.thesunwave.space';

export function isSetupResponse(response) {
  if (response.status === 200) {
    return response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() === 'text/html';
  }
  // Older releases redirect unauthenticated setup visitors to /admin with
  // a 401. Accept that explicit auth contract without depending on page copy.
  return response.status === 401 &&
    response.headers.get('location') === '/admin' &&
    response.headers.get('cache-control')?.split(',')
      .some(directive => directive.trim().toLowerCase() === 'no-store') === true;
}

const checks = [
  {
    path: '/healthz',
    validate: async response => response.ok && (await response.text()).trim() === 'ok',
  },
  {
    path: '/',
    validate: async response => response.ok && (await response.text()).length > 100,
  },
  {
    path: '/auth/telegram/config',
    validate: async response => {
      if (!response.ok) return false;
      const data = await response.json().catch(() => null);
      return Number.isFinite(data?.clientId) && data.clientId > 0;
    },
  },
  {
    path: '/admin/setup',
    validate: isSetupResponse,
  },
];

async function run() {
  for (const check of checks) {
    let passed = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const response = await fetch(BASE + check.path, {
          headers: { 'Cache-Control': 'no-cache' },
          signal: AbortSignal.timeout(8_000),
        });
        passed = await check.validate(response);
        if (passed) break;
      } catch {
        // The new deployment may not be routed to all edges immediately.
      }
      if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3_000));
    }
    if (!passed) throw new Error(`Post-deploy smoke check failed: ${check.path}`);
    console.log(`OK ${check.path}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
