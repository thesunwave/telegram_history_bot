# Telegram History Bot

Cloudflare Worker that stores Telegram chat messages for 7 days and can produce daily summaries via Workers AI.

## Features
- Webhook for receiving Telegram updates.
- Stores each message in KV with 7 day TTL.
- Maintains per-user counters in KV.
- Commands: `/summary`, `/top`, `/reset`.
- Daily cron job calls `/jobs/daily_summary`.

## Deployment
1. Install dependencies: `npm install`.
2. Create resources and update `wrangler.jsonc` with their IDs:
   ```bash
   ./setup.sh
   ```
   This will also run the initial D1 migrations. You can rerun them later with:
   ```bash
   npx wrangler d1 migrations apply summaries
   ```
3. Set secrets:
   ```bash
   wrangler secret put TOKEN
   wrangler secret put SECRET
   ```
4. Deploy with Wrangler:
   ```bash
   npm run deploy
   ```

## Development
Run unit tests with:
```bash
npm test
```

## Setup Script
`setup.sh` creates KV namespaces and the D1 database. Copy the printed IDs into
`wrangler.jsonc` so the worker can bind to these resources. The cron trigger is
configured in `wrangler.jsonc` and will be created on deployment.
