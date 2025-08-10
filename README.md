# Telegram History Bot

Cloudflare Worker that stores Telegram chat messages for 7 days and can produce daily summaries via Workers AI. Features an **optimized summary system** with parallel processing, intelligent context management, and automatic fallback for enhanced performance and reliability.

## Features

- Webhook for receiving Telegram updates.
- Stores each message in KV with 7 day TTL.
- Maintains per-user counters via Durable Object and KV.
- **🚀 Optimized Summary System** with parallel processing and intelligent context management.
- **🛡️ Automatic fallback** to legacy system for reliability.
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

## 🚀 Optimized Summary System

### Overview

The bot includes an **optimized summary system** that significantly improves performance and quality for large message volumes:

- **Parallel Processing**: Uses Durable Objects to fetch messages concurrently
- **Context Optimization**: Maximizes OpenAI context usage (up to 128k tokens)
- **Hierarchical Processing**: Two-stage summarization for large datasets
- **Automatic Fallback**: Seamlessly falls back to legacy system on errors

### Performance Improvements

| Metric | Legacy System | Optimized System |
|--------|---------------|------------------|
| 1000 messages | ~45 seconds | ~12 seconds |
| KV requests | 1000 sequential | 5 parallel workers |
| AI requests | 3-5 chunked | 1-2 hierarchical |
| Context loss | Significant | Minimal |
| Failure rate | ~15% | ~2% (with fallback) |

### Configuration

The optimized system is **enabled by default** and configured via environment variables:

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

For detailed documentation, see [OPTIMIZED_SUMMARY_INTEGRATION.md](./OPTIMIZED_SUMMARY_INTEGRATION.md).

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
configured in `wrangler.jsonc` and will be created on deployment. The Durable
Object for counters is defined in `wrangler.jsonc` and requires no additional
setup.
