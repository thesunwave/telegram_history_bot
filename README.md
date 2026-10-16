# Telegram Group Statistics & Analytics — History Bot

**See who is active in your Telegram group, what people discuss, and when conversation peaks.** History Bot is an MIT-licensed open-source Telegram group analytics bot with activity statistics, message/word counts, top members, voice-note stats and optional summaries.

**Try it without deploying anything:** [Add @stat_history_bot to your group](https://t.me/stat_history_bot?startgroup=true) · [See screenshots and features](https://tghistory.thesunwave.space/) · [Compare with Combot](https://tghistory.thesunwave.space/combot-alternative)

Once added, use `/help` to see commands and `/top` or `/activity_week` for group statistics. Statistics build up from messages the bot is allowed to receive; it cannot reconstruct messages sent before it joined. Bot privacy settings may affect which group messages Telegram delivers.

**Prefer full control?** [Deploy your own instance to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/thesunwave/telegram_history_bot). Self-hosting requires your own Telegram bot token and Cloudflare account; the steps are below. History Bot is primarily a *statistics* tool, not a substitute for moderation or anti-spam bots.

The root `wrangler.jsonc` is a portable self-hosting template. The owner's
existing Cloudflare Worker uses the separate `wrangler.production.jsonc` and
is deployed only from a reviewed GitHub release. See the
[release and self-hosting guide](docs/ops/release-and-self-hosting.md).

The public landing is maintained and released independently in
[telegram_history_landing](https://github.com/thesunwave/telegram_history_landing).
The owner's production config retains the `LANDING` service binding, custom
domain, and legacy webhook endpoint. Public installations do not require a
landing Worker or any owner-specific Cloudflare resource IDs.

Public marketing URLs are proxied from the separate landing Worker: `/` is the
canonical English home, `/ru` is Russian, and `/combot-alternative` is an
analytics comparison page. The same binding serves `/robots.txt`, `/sitemap.xml`
and `/landing/*` assets; old `/en` links redirect permanently to `/`. Login,
admin and Telegram webhook routes stay exclusively in this bot Worker.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thesunwave/telegram_history_bot)

## Install your own bot (Cloudflare)

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Click **Deploy to Cloudflare**, select your own Cloudflare account, and enter
   the `TOKEN` secret. The source repository is copied into your own GitHub
   repository; it is not linked to the owner's production account.
3. Confirm the build/deploy command is **`npm run deploy`** (not just
   `wrangler deploy`). It provisions the KV, D1 and Durable Objects bindings,
   then applies the D1 migrations. Verify both deployment and migrations
   succeeded in the build logs.
4. Open your new Worker's URL. It redirects to `/admin/setup`. Sign in with
   the same BotFather token and verify that D1 is ready. **Choose and save your
   storage mode**, then enable any features you want before selecting
   **Connect webhook**. This step registers the public Worker URL with Telegram.
5. Add the bot to your group. To allow it to collect ordinary group messages
   rather than just commands, disable bot privacy using BotFather's
   `/setprivacy` and re-add the bot to the group.

New installations **require an explicit storage decision** before Telegram is connected:
- **Statistics only:** count messages, words, media and activity without saving
  the raw text of chats in the bot's message-history KV/DO storage. Chat/user
  identifiers, group metadata and (when activity tracking is enabled) counts
  still persist. This does not control
  Telegram/Cloudflare platform logs or optional external AI providers.
  AI summaries, contextual criminal analysis, and their history-dependent
  commands are unavailable in this mode.
- **Message history + statistics:** save raw messages temporarily in your Cloudflare
  Durable Objects/KV (seven-day date-based retention by default) to allow
  AI summaries, context analysis and replay.

The owner can turn activity statistics, profanity analysis, criminal analysis and
AI summaries on/off in `/admin/setup`; AI-dependent features may transmit content
to their configured model provider. All advanced analyses initially start off.
Switching to stats-only stops **new raw message writes**, but does not purge
previously stored messages; they age out under their retention policy. This page
controls the entire self-hosted bot instance, not individual Telegram groups.
On existing deployments, the owner can open `/admin/setup` using the existing
admin Basic Auth credentials (`ADMIN_BASIC_USER` / `ADMIN_BASIC_PASSWORD`), or
an existing Telegram admin session when `ADMIN_USER_ID` matches the signed-in
Telegram account. BotFather token login remains a bootstrap fallback. Ordinary
Telegram group admins cannot change the instance-wide settings.
You can enable AI summaries after configuring any required provider key as a
Cloudflare Secret. Never paste an OpenAI/OpenRouter key into the dashboard.

The first-run flow can be rehearsed locally with a dummy token and no
production changes using `npm ci && npm run test:onboarding`. The smoke
test does not register a webhook; its status request may query Telegram's
`getWebhookInfo` with the dummy token.
See [the self-hosting guide](docs/ops/release-and-self-hosting.md) for
upgrades and troubleshooting.

Use [@stat_history_bot](https://t.me/stat_history_bot?startgroup=true) in a Telegram
group, or deploy an independent copy with the button. Cloudflare creates a new
repository and provisions its own KV, D1, Durable Objects and Workers AI.
Provide the `TOKEN` secret from BotFather during setup, then open
`https://YOUR-WORKER.workers.dev/admin/setup` to connect the Telegram webhook.
The deploy command applies D1 migrations automatically.

Cloudflare Worker that stores Telegram chat messages (7 days in KV), generates summaries, and optionally runs profanity/criminal analysis with notifications. Supports Cloudflare AI and OpenAI providers, and includes an **optimized summary system** with parallel processing, context optimization, and automatic fallback.

## Features

- Webhook for receiving Telegram updates.
- Optional message history in Durable Objects/KV, with seven-day default
  retention (daily blocks + fallback single-message storage). Stats Only does
  not write raw messages to those stores.
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
- `/help` – show full list

To enable autocomplete, register the commands with **BotFather** via `/setcommands` and provide the list above (one per line).

## 🚀 Optimized Summary System

### Overview

The bot includes an **optimized summary system** that improves performance and quality for large message volumes:

- **Parallel Processing**: Uses Durable Objects to fetch messages concurrently
- **Context Optimization**: High token budgets with configurable limits
- **Hierarchical Processing**: Two-stage summarization for large datasets
- **Automatic Fallback**: Seamlessly falls back to legacy system on errors

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

For detailed documentation, see `docs/README.md`.

## Configuration & Deployment

**Cloudflare (recommended):** click Deploy to Cloudflare above, supply the
BotFather `TOKEN` secret, and complete `/admin/setup` after deployment.
Only the token is required for Basic mode. OpenAI/OpenRouter API keys are
optional Cloudflare Secrets; never place their values in Git or D1.

**Local development:**

```sh
npm ci
cp .dev.vars.example .dev.vars
# Enter your BotFather TOKEN in .dev.vars (ignored by Git)
npm run dev
```

**CLI deployment:** configure `TOKEN` as a Worker Secret, then run
`npm run deploy` (Wrangler deployment followed by remote D1 migrations).
The root config is intentionally portable and has no pre-existing resource IDs.
Your installation's generated IDs must be retained when upgrading.

## Development

Run unit tests with:

```bash
npm test
```

Run `npm install` before `npm test` to ensure dev dependencies like Vitest are available.

## Docs

See `docs/README.md` for documentation structure and naming rules.

## License

History Bot is released under the [MIT License](LICENSE). Copyright © 2026 Artur Malev.

