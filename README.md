# Telegram History Bot

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thesunwave/telegram_history_bot)

Cloudflare Worker that stores Telegram chat messages (7 days in KV), generates summaries, and optionally runs profanity/criminal analysis with notifications. Supports Cloudflare AI and OpenAI providers, and includes an **optimized summary system** with parallel processing, context optimization, and automatic fallback.

## Features

- Webhook for receiving Telegram updates.
- Stores messages in KV with 7-day TTL (daily blocks + fallback single-message storage).
- Per-user counters via Durable Objects and KV.
- **🚀 Optimized Summary System** with parallel processing and context management.
- **🛡️ Automatic fallback** to legacy summarization on errors.
- Optional profanity and criminal-code analysis with notification flows.
- D1 storage for violation history and summaries.
- Daily cron job triggers scheduled summaries.

## Commands

- `/summary <days>` – summary for last N days (default 1)
- `/summary_last <n>` – summary of last N messages (default 100, max 1000)
- `/top <n>` – top N active users for today (default 5)
- `/profanity_top [n] [period]` – top N profanity users (today|week|month)
- `/profanity_words [n] [period]` – top N profanity words (today|week|month)
- `/my_profanity [period]` – your profanity stats (today|week|month)
- `/profanity_chart_week` – profanity chart for week
- `/profanity_chart_month` – profanity chart for month
- `/profanity_reset` – reset profanity counters for chat
- `/criminal_stats [period]` – criminal violations stats (today|week|month)
- `/my_criminal [period]` – your criminal stats (today|week|month)
- `/criminal_top [n] [period]` – top N criminal violations
- `/criminal_reset` – reset criminal counters for chat
- `/auto_notifications ...` – manage automatic notifications
- `/reset` – reset all counters for the current chat
- `/activity_week` – activity chart for week
- `/activity_month` – activity chart for month
- `/activity_users_week` – per-user activity for week
- `/activity_users_month` – per-user activity for month
- `/test_race_conditions` – race-condition test (admins only)
- `/help` – show full list

To enable autocomplete, register the commands with **BotFather** via `/setcommands` and provide the list above (one per line).

## 🚀 Optimized Summary System

### Overview

The bot includes an optional **optimized summary system** that improves performance and quality for large message volumes:

- **Parallel Processing**: Uses Durable Objects to fetch messages concurrently
- **Context Optimization**: High token budgets with configurable limits
- **Hierarchical Processing**: Two-stage summarization for large datasets
- **Automatic Fallback**: Seamlessly falls back to legacy system on errors

### Configuration

The public deployment template starts with summaries disabled, so a new installation makes no
AI calls. After choosing a summary provider, the optimized system can be enabled with environment
variables:

```bash
# Feature flag (default: true)
SUMMARY_OPT_ENABLED=true

# Parallel processing (default: 5 workers, 50 batch size)
SUMMARY_OPT_MAX_WORKERS=5
SUMMARY_OPT_WORKER_BATCH_SIZE=50

# Context management (default: 120k tokens)
SUMMARY_OPT_MAX_TOKENS_PER_REQUEST=120000
SUMMARY_OPT_TOKEN_ESTIMATION_FACTOR=4

# Hierarchical processing (default: enabled at 80k tokens)
SUMMARY_OPT_HIERARCHICAL_ENABLED=true
SUMMARY_OPT_CHUNK_SIZE_THRESHOLD=80000
```

### Monitoring

Enable detailed monitoring to track performance:

```bash
wrangler tail --format=pretty | grep "Optimized summary"
```

Look for log messages:
- `"Attempting optimized summary"` - System activated
- `"Optimized summary completed successfully"` - Success
- `"Optimized summary failed, falling back to legacy"` - Fallback triggered

### Troubleshooting

**Emergency disable**: Set `SUMMARY_OPT_ENABLED=false` and redeploy.

**Common issues**:
- Configuration validation errors → Reset invalid env vars to defaults
- Frequent fallbacks → Check Workers AI quotas and network stability  
- Performance issues → Reduce `SUMMARY_OPT_MAX_WORKERS` to 3

For detailed documentation, see `docs/README.md`.

## Deploy to Cloudflare

1. Create a Telegram bot with **BotFather** and copy its token.
2. Click the Deploy to Cloudflare button above. During deployment, enter:
   - `TOKEN` — the BotFather token;
   - `SECRET` — a random webhook secret, for example from `openssl rand -hex 32`.
3. Cloudflare creates the Worker, KV namespaces, D1 database, SQLite-backed Durable Objects,
   Workers AI binding, cron trigger, and Workers Builds integration. The deploy script also applies
   all D1 migrations.
4. Open the deployed Worker. Its landing page shows the exact hostname to register with
   BotFather `/setdomain`.
5. Sign in at `/admin` with Telegram, open the setup wizard, and connect the webhook.
6. Add the bot to a group as an administrator, or disable BotFather Privacy Mode so it can receive
   ordinary messages. Send a message, then verify `/top`.

New installations collect statistics but keep summaries disabled. The setup wizard never asks for
or stores credentials; it checks which Cloudflare Worker Secrets are configured and explains these
three paths:

- **Disabled** — keep `ENABLE_SUMMARY=false`; no AI calls are made.
- **OpenAI** — add `OPENAI_API_KEY` as a Worker Secret, set `SUMMARY_PROVIDER=openai`, and set
  `ENABLE_SUMMARY=true` under **Settings → Variables and Secrets**.
- **Workers AI** — set `SUMMARY_PROVIDER=cloudflare` and `ENABLE_SUMMARY=true`. No API key is
  required, but Cloudflare usage quotas and pricing apply.

Secrets must be stored as Cloudflare Worker Secrets, never as plaintext `vars`, D1 rows, or KV
values. The wizard returns only configured/not-configured status.

For a manual deployment:

```bash
npm install
npx wrangler secret put TOKEN
npx wrangler secret put SECRET
npm run deploy
```

The repository owner can deploy the existing account-specific configuration without replacing its
legacy Durable Object namespaces:

```bash
npm run deploy:production
```

## Development

Run unit tests with:

```bash
npm test
```

Run `npm install` before `npm test` to ensure dev dependencies like Vitest are available.

## Docs

See `docs/README.md` for documentation structure and naming rules.
