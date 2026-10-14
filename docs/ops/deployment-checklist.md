# Deployment checklist

This project has **two independent deployment paths**. Never use the public
Wrangler configuration to update the owner's production Worker.

## New community installation

1. In your own Cloudflare account, use the
   [Deploy to Cloudflare button](../../README.md#install-your-own-bot-cloudflare).
   Enter the BotFather `TOKEN` as a Worker Secret.
2. Confirm that the deploy command is `npm run deploy`. It uses the portable
   `wrangler.jsonc`, provisions KV, D1 and Durable Objects, then applies D1
   migrations. Check that the *entire* command completed successfully.
3. Open the new Worker URL (redirects to `/admin/setup`), sign in with
   the BotFather token and verify `databaseReady: true` in the status.
4. Click **Connect webhook**. Add the bot to your Telegram group and test a
   message or command. Disable Telegram bot privacy with BotFather's
   `/setprivacy` if you need to collect all group messages.
5. Enable AI summaries in the setup page only if desired. Configure OpenAI or
   OpenRouter keys as Cloudflare Secrets, never as plaintext in the dashboard.

For an isolated rehearsal, `npm ci && npm run test:onboarding` runs the
actual Worker and migrations locally with a dummy token. It does not deploy to
Cloudflare or register a Telegram webhook.

Do not run `setup.sh`; it is a deprecated manual provisioning script.

## Owner production

1. Review and merge a PR into protected `main`. CI must pass.
2. Create a reviewed SemVer release tag.
3. Use GitHub Actions **Deploy production release** (manual dispatch on
   `main`) with `deploy_to_production=false` for a read-only preflight.
4. Review infrastructure drift and pending production D1 migrations. Before
   applying migrations, create and verify a private production D1 backup.
5. For a real deploy, dispatch the same tag with
   `deploy_to_production=true`, confirmation `BUILDS_DISABLED`, and approve
   the protected `production` environment.
6. Confirm the GitHub deployment and post-deploy smoke tests, Cloudflare's
   active Worker version, Telegram webhook delivery and the bot's real commands.

The owner's Cloudflare Builds auto-deploy must stay **disabled**. Do not run
`npm run deploy` or plain `wrangler deploy` in the owner's account.
Production deploys use `wrangler.production.jsonc` only.

## Recovery

Use Cloudflare deployment history to identify the last known-good Worker.
Rolling back Worker code **does not** roll back D1 schema or new database writes.
Treat D1 restore as a separate, carefully planned operation.

For commands, backup requirements, upgrade procedure and safeguards, see
[Production releases and self-hosting](release-and-self-hosting.md).
