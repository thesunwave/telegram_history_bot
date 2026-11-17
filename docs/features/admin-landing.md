# Public landing deployment

The landing lives in its own public GitHub repository:
https://github.com/thesunwave/telegram_history_landing

Its Cloudflare Worker service is `telegram-history-landing`. The bot Worker owns
`tghistory.thesunwave.space` and forwards only `/`, `/index.html` and
`/landing/*` through its `LANDING` service binding (defined directly in the
canonical `wrangler.jsonc`). Auth routes,
admin API and webhook remain exclusively in this bot repository.

The bot Worker **must** keep `workers_dev: true`: the Telegram webhook still
uses `telegram-history-bot.thesunwave.workers.dev`. Never replace the bot's
custom domain or disable that hostname as part of a landing release.

Cloudflare Builds auto-deploys `wrangler.jsonc` from the bot's `main` branch.
All production bindings, custom-domain routes and the Login Widget Client ID
must therefore be declared in this file: an ignored, locally generated Wrangler
config gets overwritten by the next automatic deployment. For a separate
self-hosted bot, adapt these account-specific bindings and remove the
`LANDING` service binding if the landing service is not installed.

To release visual changes, commit to `main` in `telegram_history_landing`.
The landing repository owns its GitHub Actions build/deploy workflow and images;
no bot deployment is required. The bot deployment config must not contain
landing assets or the landing renderer.
