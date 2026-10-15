# Privacy and Security Audit — 2026-10-16

## Scope and limitations

Static audit of `telegram_history_bot` at `d4e7cf4` and the pending changes in
`security/privacy-audit-20261016`. Reviewed Worker routes, Cloudflare resource
bindings, raw message ingestion/retention, D1 cleanup, authentication, major AI
providers and logging. No production message contents, current Cloudflare Secrets,
logs or live runtime overrides were read. This is not a penetration test or an
independent audit of Telegram, Cloudflare or model providers.

## Data flow and retention

| Data | Where it goes | Retention found in code |
| --- | --- | --- |
| Telegram message text, user IDs, usernames, reply text | Webhook -> `recordMessage` -> DayBlockManager DO + `HISTORY` KV copies; individual `msg:` KV fallback | Prior to the patch, alarms could retain up to eight days from the first message of a UTC date, and KV backups refreshed seven-day TTL on subsequent writes. Patch anchors both daily DO and KV deadline to UTC midnight + 7 days by default, and caps fallback records by their message timestamp. Existing historic data/platform backups are NOT retroactively purged. |
| Activity stats, word/profanity counters, user IDs/usernames | `COUNTERS` KV, CountersDO, D1 `activity`, `stats_daily_*`, `stats_chat_user_profile` | Many records have no automatic expiration. `cleanupOldData()` explicitly leaves `activity` intact, and does not remove D1 daily aggregates or profiles. |
| Group title and chat identifiers | `HISTORY` KV `admin_chat:` | `saveAdminChatMeta()` writes with **no TTL**. |
| Generated summaries | D1 `summaries` | Daily cleanup removes rows with `period_end` older than 30 days, provided scheduled cleanup runs. |
| Criminal analysis results and excerpts | D1 `criminal_violations`, cache and counters | 30-day cleanup for violations; `quote` and `evidence_json` may contain chat content even with `CRIMINAL_STORE_TEXT_PREVIEW=false`. Aggregates may survive. |
| Requests to AI | Cloudflare Workers AI and optionally OpenAI, OpenRouter, Qwen endpoints | Public portable config disables AI processing initially. Current checked production file has `ENABLE_CRIMINAL_ANALYSIS=true`, `CRIMINAL_PREFILTER_PROVIDER=qwen`, `CRIMINAL_FINAL_JUDGE_ENABLED=true`; summary/profanity flags are false, but summary runtime settings can override. `SUMMARY_PROVIDER=openai` is configured if summaries are enabled. Current live runtime toggles NOT independently confirmed. |
| Worker logs / provider errors | Cloudflare observability | Logging enabled in both checked configs. Previously provider parse error handling logged `rawResponse`, potentially including message quotes. Selected error paths are sanitized here. Historical logs, unrelated loggers and platform log retention have NOT been audited or deleted. |

## Findings and changes (not deployed)

1. **High: dev-mode webhook authentication bypass.** Old `/tg/:token/webhook`
   allowed invalid credentials if `ENVIRONMENT=development`. Fixed to reject
   invalid or missing token/secret in all modes; regression test added.
2. **High: model replies leaking into logs.** OpenAI and Cloudflare AI response
   parsers logged entire model output on parse failure (even without debug
   enabled). The new code logs only safe response length/error-class metadata.
   A regression assertion explicitly rejects `rawResponse`.
3. **High: raw messages outliving the claimed window.** Daily DO alarm included
   an extra day; KV backups used sliding TTL. Day-aligned absolute expiry is
   now used for DO and KV, and individual fallback is anchored to source
   timestamp. Late/expired updates cannot restore expired raw text to storage.
   Tests cover both paths. The fixed deadline means messages arriving late in
   a UTC day persist a bit less than seven days.
4. **Medium: exception disclosure.** Selected DO errors previously emitted raw
   exception text, stack and request URL into logs and/or HTTP 500 bodies.
   New generic 500 response and redacted errors are tested. Other modules have
   not yet been audited exhaustively for payload-bearing exceptions.
5. **High: no complete per-chat erasure.** `/reset` deletes some counters and
   `activity`, not all raw KV/DO copies, D1 profiles/daily stats, cached results,
   notifications and platform backups. Do not promise comprehensive deletion.
6. **Medium: legacy webhook URL contains bot token.** Token is embedded in
   `/tg/:token/webhook`; prefer tokenless `/telegram/webhook` in a separately
   reviewed production webhook migration, with BotFather/Telegram updates.
7. **Medium: 30-day data cleanup is operational, not a hard TTL.** It depends
   on daily cron succeeding. Failure or skipped schedule can extend retention.
8. **Public test fixtures:** a test contained plausible real identifiers and
   message text; it was changed to synthetic fixtures to avoid reproducing
   private conversation material in source code.

## Claims currently safe to make

- You can deploy your own bot into **your own Cloudflare account** with your own
  Telegram bot token and Cloudflare storage bindings. The public template does
  not rely on the project maintainer's production D1/KV/DO bindings.
- You decide whether to enable optional AI processing and can inspect/modify
  the MIT-licensed code and configured storage policy.
- This is *Cloudflare-hosted* self-deployment, not a local-only install. Telegram
  and Cloudflare handle message data. Enabled external AI services receive the
  content submitted to them. Account administrators can access stored data.
- A seven-day maximum for **newly saved raw message copies** is the intent of
  this change. It is not an assertion that all user-related data, backups,
  provider copies or logs disappear within seven days.

## Required follow-up before strong privacy marketing

- [ ] Review and merge this PR only after CI and security review; do not deploy
      or restart current production as part of this audit.
- [ ] Design and test a **full deletion/retention policy** for D1 stats/profiles,
      `COUNTERS` KV, `admin_chat` metadata, per-chat DOs, backups and old data.
- [ ] Audit remaining logger/provider exception paths; check historical logging
      retention and access in Cloudflare.
- [ ] Verify production D1 runtime flags and third-party AI route selection
      without exposing user data or credentials.
- [ ] Migrate production to the tokenless webhook via separate approved rollout.
- [ ] Document platform-side data retention limits, including provider terms.
