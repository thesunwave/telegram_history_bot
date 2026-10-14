const BASE = 'https://tghistory.thesunwave.space';

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
    validate: async response => response.ok && (await response.text()).includes('Настройка бота'),
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

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
