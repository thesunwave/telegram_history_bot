# Public landing deployment

The landing lives in its own public GitHub repository:
https://github.com/thesunwave/telegram_history_landing

Its Cloudflare Worker service is `telegram-history-landing`. The bot Worker owns
`tghistory.thesunwave.space` and forwards only `/`, `/index.html` and
`/landing/*` through its `LANDING` service binding (defined in the hosted-only
Wrangler config produced by `scripts/generate-hosted-config.mjs`). Auth routes,
admin API and webhook remain exclusively in this bot repository.

The bot Worker **must** keep `workers_dev: true`: the Telegram webhook still
uses `telegram-history-bot.thesunwave.workers.dev`. Never replace the bot's
custom domain or disable that hostname as part of a landing release.

To release visual changes, commit to `main` in `telegram_history_landing`.
The landing repository owns its GitHub Actions build/deploy workflow and images;
no bot deployment is required. The bot deployment config must not contain
landing assets or the landing renderer.
