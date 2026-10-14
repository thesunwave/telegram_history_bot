# Release and self-hosting plan

## Deployment configurations

- `wrangler.production.jsonc`: the owner's **existing** Worker, including its
  current KV/D1 IDs, routes, landing service, and legacy Durable Object migrations.
  Do not replace its migration history with the new `exports` syntax.
- `wrangler.public.jsonc`: an isolated, portable Cloudflare installation with no
  account-specific IDs. This is a **staging template**, not yet the one-click default.
- `wrangler.jsonc`: temporarily still the owner's production configuration because
  **Cloudflare Builds auto-deploys this exact file from main**.

**Do not merge this staged rollout into main until the deployment transition is
approved.** Even when `wrangler.jsonc` is unchanged, a main-branch push still
triggers Cloudflare Builds and deploys the new application code.

The cutover to a public default `wrangler.jsonc` must be a separate coordinated change:

1. Verify the owner deploy workflow and protect the GitHub `production` environment
   with required reviewers, restricted release tags, and scoped Cloudflare credentials
   `CLOUDFLARE_ACCOUNT_ID` as an environment variable and
   `CLOUDFLARE_API_TOKEN` as an environment secret.
2. Disable the old automatic Cloudflare Builds **deployment** on `main`. Merely changing
   the GitHub Actions workflow is not sufficient.
3. Ensure the production config includes *all* bindings from the deployed Worker,
   including the separate landing Worker and Telegram OAuth client.
4. Replace the root `wrangler.jsonc` with the portable template, switch `npm run deploy`
   to the portable config and make it apply D1 migrations for fresh installs.
5. Smoke-test a separate Cloudflare account (resource provisioning, migrations, webhook,
   admin bootstrap, Basic mode) before advertising one-click setup as complete.

Until steps 1–5 are done, the README's deploy button still requires manual configuration.

### Test a new self-hosted installation before cutover

```sh
npm ci
cp .dev.vars.example .dev.vars  # supply the BotFather TOKEN
npm run dev:public
```

For an isolated Cloudflare account, `npm run deploy:public` deploys using
`wrangler.public.jsonc` and applies D1 migrations after provisioning. No
production resource IDs are used. Visit `/admin/setup` (or the Worker's root
URL, which redirects there for a fresh install), sign in with the BotFather
token, and register the Telegram webhook. This bootstrap credential is sent
over HTTPS and only a signed, two-hour session cookie is retained by the
browser. Once deployed, the bot starts with history/activity/stats enabled,
AI summary, profanity and criminal analysis disabled. OpenAI/OpenRouter keys
must be configured as Cloudflare Secrets before enabling those providers.

The full dashboard's Telegram OIDC login still requires
`TELEGRAM_LOGIN_CLIENT_ID` and BotFather domain configuration if enabled;
the initial owner setup does not require them.

## Production releases (after the cutover)

Tag reviewed commits using SemVer (`vMAJOR.MINOR.PATCH`). Use the GitHub Actions
`Deploy production release` workflow and enter an existing release tag. Leave
`deploy_to_production` unchecked for the first **read-only** credential preflight.
For an actual deployment, check the box, enter `BUILDS_DISABLED`, then approve
the protected `production` environment. The workflow checks the tag belongs
to main, runs tests, performs deploy dry-run, verifies Cloudflare access and
only then deploys using `wrangler.production.jsonc`. It never runs on push.

D1 migrations are **not** automatically applied to the owner's database by this workflow.
Before an upgrade that needs schema changes, back up D1, inspect pending migrations,
apply them deliberately, and have a recovery plan for non-reversible schema changes.
Cloudflare Secrets are configured in the Worker, not committed to Git.

## Community installations and upgrades

The Deploy to Cloudflare button clones a **new repository in the installer's account**,
which is automatically deployed by *their* Cloudflare Builds configuration. Updates
in the upstream source repository do **not** automatically update that copy.

For now, users can add this repository as an `upstream` Git remote and merge a
reviewed release tag into a branch, then open a PR in their own copy. They must
retain their `wrangler.jsonc` bindings and review migrations before merging.

The `Update from upstream release` workflow creates a PR to update a cloned
installation. Choose a reviewed SemVer tag; it merges the upstream commit while
preserving the current installation's `wrangler.jsonc`. It deliberately stops
if any other file conflicts. Review new required bindings and D1 migrations before
merging, because the old Wrangler config may need additive changes for the new code.
The copied repository must allow GitHub Actions to create pull requests and grant
its `GITHUB_TOKEN` repository write access. There is no unattended upstream update.

For local installations, with a clean Git worktree:
`bash scripts/prepare-upstream-update.sh v1.7.0`

Neither updater automatically deploys, overwrites installer credentials, or
applies potentially destructive D1 migrations.
