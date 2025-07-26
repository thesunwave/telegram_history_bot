# Telegram History Bot

Cloudflare Worker that stores Telegram chat messages for 7 days and can produce daily summaries via Workers AI.

## Features

- Webhook for receiving Telegram updates.
- Stores each message in KV with 7 day TTL.
- Maintains per-user counters in KV.
- Commands: `/summary`, `/summary_last`, `/top`, `/reset`, `/activity`.
- Daily cron job calls `/jobs/daily_summary`.

## Commands

- `/summary <days>` – summarise messages from the last N days (default 1).
- `/summary_last <n>` – summarise the most recent N messages (default 1, max 40).
- `/top <n>` – show top N active users for today (default 5).
- `/reset` – reset all counters for the current chat.
- `/activity [week|month]` – activity graph for last week or month.

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
   The summarisation model and prompt can be configured via `SUMMARY_MODEL` and
   `SUMMARY_PROMPT` in `wrangler.jsonc`. По умолчанию промпт заставляет
   модель отвечать только по-русски.
4. Deploy with Wrangler:
   ```bash
   npm run deploy
   ```

## Development

Run unit tests with:

```bash
npm test
```

Run `npm install` before `npm test` to ensure dev dependencies like Vitest are available.

## Setup Script

`setup.sh` creates KV namespaces and the D1 database. Copy the printed IDs into
`wrangler.jsonc` so the worker can bind to these resources. The cron trigger is
configured in `wrangler.jsonc` and will be created on deployment.
