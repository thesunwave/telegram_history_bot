# Production releases and self-hosting

## Deployment configurations

- `wrangler.jsonc`: the portable **public installation template**. It has no
  account-specific resource IDs, custom domain, landing Worker, or advanced flags.
  Cloudflare provisions new resources for each Deploy to Cloudflare user.
- `wrangler.production.jsonc`: the owner's **existing** Worker, including its
  KV/D1 IDs, domain, landing binding, Telegram OAuth client, Vectorize and legacy
  Durable Object migrations. Never replace its migration history with `exports`.

The owner's Cloudflare Builds Git-push deployment must remain **disabled**.
Otherwise a merge to `main` could deploy the public template into the owner's
existing account. The owner's releases use only the explicitly selected
`wrangler.production.jsonc` and the manual GitHub Actions workflow.

Configure a protected GitHub `production` Environment with required reviewers,
`CLOUDFLARE_ACCOUNT_ID` as an environment variable, and
`CLOUDFLARE_API_TOKEN` as an environment secret.

**Do not run plain `npm run deploy` in the owner's account.** It is intended
for portable public installs. Use `npm run deploy:production` only through
the controlled release process.

### Test a new self-hosted installation

```sh
npm ci
cp .dev.vars.example .dev.vars  # supply the BotFather TOKEN
npm run dev
```

For an isolated Cloudflare account, `npm run deploy` deploys using
`wrangler.jsonc` and applies D1 migrations after provisioning. No
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

## Production releases

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
