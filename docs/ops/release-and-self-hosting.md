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
Restrict its deployment-branch policy to **`main` only**. Protect `main` with
required pull requests and the `test` status check; production workflows
also explicitly reject `workflow_dispatch` calls from non-main refs.

**Do not run plain `npm run deploy` in the owner's account.** It is intended
for portable public installs. Use `npm run deploy:production` only through
the controlled release process.

### Test a new self-hosted installation

```sh
npm ci
cp .dev.vars.example .dev.vars  # supply the BotFather TOKEN
npm run dev
```

For an isolated end-to-end dry run, `npm run test:onboarding` creates a
temporary **local** D1 database, applies every migration, boots the actual
Worker via Wrangler and exercises the owner setup API with a dummy token.
It does not register a Telegram webhook or provision remote Cloudflare
resources. The GitHub CI `onboarding` job runs the same check independently
of the production build.

For an isolated Cloudflare account, `npm run deploy` deploys using
`wrangler.jsonc` and applies D1 migrations after provisioning. No
production resource IDs are used. Visit `/admin/setup` (or the Worker's root
URL, which redirects there for a fresh install), sign in with the BotFather
token, and register the Telegram webhook. This bootstrap credential is sent
over HTTPS and only a signed, two-hour session cookie is retained by the
browser. On new portable installs the owner must explicitly select either statistics-only
(no new raw message text storage) or history + statistics before connecting the
Telegram webhook. Existing installations use the existing Telegram Login session for the
configured `ADMIN_USER_ID`, or can link their Telegram account one time with
BotFather-token proof if that ID is not configured. The binding is stored in
D1 as `app_settings.scope = telegram_owner` and never grants rights merely
because someone administers a Telegram group. Basic Auth is not used for bot
settings. On installations with Telegram Login, an ordinary BotFather-token
setup session cannot bypass the Telegram owner binding; the token can only
confirm the one-time pairing. The standalone token bootstrap remains available
when Telegram Login is not configured.
Activity stats are enabled initially, while AI summary,
profanity and criminal analysis are disabled. The owner can configure all four
features in `/admin/setup` when their dependencies and AI credentials are available. Without message history, summaries and
contextual criminal analysis cannot be enabled. Switching modes does not delete
previously captured data and does not affect persistent user statistics/metadata.
Statistics-only is **not** a no-processing guarantee: if an operator enables
profanity analysis, message text can still be sent to the selected external AI
provider, while extracted matches and provider/platform logs may be retained.
Telegram and Cloudflare process incoming webhook traffic in either mode.
Existing production installations preserve their configured storage behaviour
until an owner changes it. The settings page explicitly distinguishes live
Cloudflare environment defaults from global D1 overrides, and shows separate
read-only provider/model settings for summary, profanity and criminal analysis.
The criminal prefilter shows its configured or effective default provider/model;
the optional final judge uses OpenAI and shows its model (configured or default).
For Legal RAG the reported model is the embedding model used for retrieval.
When `ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER` is on and criminal analysis is
enabled, profanity counters come from the criminal prefilter without a separate
AI call per message. Without a D1 override the profanity toggle then shows as
enabled (an older summary-only D1 row keeps `ENABLE_PROFANITY_ANALYSIS`
instead); turning it off and saving stops those counters.
The editable provider/model input
only controls **summaries**. Unsaved changes must be confirmed; clicking Save
writes a global D1 override for every feature toggle and the summary settings,
which then take precedence over environment defaults. Do not use Save merely
to inspect existing configurations.
OpenAI/OpenRouter keys
must be configured as Cloudflare Secrets before enabling those providers.
In the Deploy to Cloudflare setup screen make sure the deploy command is
`npm run deploy` and check the build log for successful D1 migrations.
Cloudflare automatically provisions bindings with missing resource IDs,
but resource IDs are not necessarily committed back to the new GitHub copy.
Keep the generated bindings when updating and do not repeat resource
provisioning manually. The historical `setup.sh` is deprecated.

The full dashboard's Telegram OIDC login still requires
`TELEGRAM_LOGIN_CLIENT_ID` and BotFather domain configuration if enabled;
the initial owner setup does not require them.

## Production releases

Tag reviewed commits using SemVer (`vMAJOR.MINOR.PATCH`). Use the GitHub Actions
`Deploy production release` workflow and enter an existing release tag. Leave
`deploy_to_production` unchecked for a **read-only** preflight. The workflow
first resolves the release tag to a commit SHA, confirms it is on `main` and
validates its code. It reuses an already successful `main` CI run **only for
the exact same SHA**; otherwise it runs the full test suite. It always runs
release-preflight unit tests and a fresh production Wrangler dry-run.

**Only after validation succeeds** does the `release` job request approval
from the protected `production` Environment. For an actual deployment, check
the box and enter `BUILDS_DISABLED`, then approve the deployment. The
post-approval job checks out the **validated SHA**, installs dependencies,
compares the live Cloudflare KV/D1/DO/Vectorize/service bindings against the
selected release and lists pending D1 migrations without changing them.
Infrastructure drift blocks the release. A read-only run only lists pending
migrations. On an actual deploy, pending migrations that are all **additive**
(only `CREATE TABLE`, `CREATE [UNIQUE] INDEX` or `ALTER TABLE … ADD`) are applied
automatically: the job first records a D1 Time Travel bookmark and prints the
restore command in the run summary, then runs `wrangler d1 migrations apply`.
Any other pending migration (data rewrites, inserts, drops, triggers, renames)
still **blocks an actual deploy** until applied manually after backup.
Only after this check does Wrangler deploy with `wrangler.production.jsonc`.
It never runs on push. The post-deploy smoke check validates health, public
landing, Telegram auth config and owner setup; no Telegram messages are sent.

The preflight and smoke scripts are pinned to the workflow commit separately
from the release commit, so earlier supported release tags can be redeployed
without silently switching their application code.

Only additive D1 migrations are applied automatically, and only after production
approval on an actual deploy. For anything else, back up D1, inspect pending
migrations, apply them deliberately, and have a recovery plan for non-reversible
schema changes. The `CLOUDFLARE_API_TOKEN` needs D1 Edit permission for the
automatic apply. Cloudflare Secrets are configured in the Worker, not committed to Git.
Rollback of Worker code does not roll back D1 schema changes; restoring the
recorded Time Travel bookmark rolls back the schema **and every write since**.

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
`bash scripts/prepare-upstream-update.sh <reviewed-release-tag>`

Neither updater automatically deploys, overwrites installer credentials, or
applies potentially destructive D1 migrations.
