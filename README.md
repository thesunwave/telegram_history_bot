# Telegram History Bot

Cloudflare Worker that stores Telegram chat messages for 7 days and can produce daily summaries via Workers AI.

## Features

- Webhook for receiving Telegram updates.
- Stores each message in KV with 7 day TTL.
- Aggregates daily stats in D1; today's stats are computed from KV messages.
- Commands: `/summary`, `/summary_last`, `/top`, `/reset`,
  `/activity_week`, `/activity_month`,
  `/activity_users_week`, `/activity_users_month`, `/help`.
- Daily cron job calls `/jobs/daily_summary`.

## Commands

- `/summary <days>` – summarise messages from the last N days (default 1).
- `/summary_last <n>` – summarise the most recent N messages (default 1, max 40).
- `/top <n>` – show top N active users for today (default 5).
- `/reset` – reset all counters for the current chat.
- `/activity_week` – totals and user chart for the last week.
- `/activity_month` – totals and user chart for the last month.
- `/activity_users_week` – user chart for the last week.
- `/activity_users_month` – user chart for the last month.
- `/help` – show this list of commands.

To enable autocomplete, register the commands with **BotFather** via `/setcommands` and provide the list above (one per line).

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
   The summarisation model and prompts can be configured via
   `SUMMARY_MODEL`, `SUMMARY_SYSTEM` and `SUMMARY_PROMPT` in `wrangler.jsonc`.
   Additional tuning parameters such as `SUMMARY_MAX_TOKENS`,
   `SUMMARY_TEMPERATURE`, `SUMMARY_TOP_P` and
   `SUMMARY_FREQUENCY_PENALTY` allow you to control output length and
   determinism. By default the bot uses Llama‑3.1 8B instruct fast and always
   replies in Russian.
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
