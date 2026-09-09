# Admin Stats D1 Optimization

Implementation-ready specification for removing the request-time full-chat KV scan
behind `/admin/api/chat`. Phase 1 (containment + guard) and Phase 2 (D1 schema +
live dual-write of daily aggregates) are implemented. Phase 3a
(bounded/resumable production backfill) is implemented below. Phase 4 (the D1
aggregate reader, `src/features/stats/admin-stats-d1.ts`) is implemented: D1 is
the **sole admin stats source** — every request reads D1 aggregates directly,
absent daily aggregate rows render as zero, and D1 failures surface the
structured `ADMIN_UNAVAILABLE` 503. No KV read fallback and no `CountersDO`
proof gate exist on the read path. The remaining phases (parity re-verification,
retention cleanup) are specified here but **not implemented**; they are
write-side only and do not gate admin reads.

**v3 barrier complete (current):** the v3 backfill has reached terminal `done`
status. The temporary `* * * * *` cron trigger has been removed from
`wrangler.jsonc` — only the daily `59 23 * * *` remains. Backfill and
coverage-integrity internals are write-side concerns; admin reads never consult
them. 304 coverage rows remain incomplete (parity mismatches or missing base
activity) and require separate explicit remediation; they are not addressed by
cron retries. The `src/index.ts` backfill dispatch code is preserved for possible
future explicit reruns.

## Admin Read Model (implemented)

`/admin/api/chat` reads all stats directly from D1 aggregates via
`getAdminChatStatsFromD1`. There is no KV scan, no legacy read fallback, and no
readiness/coverage gate on the read path: a day with no aggregate rows renders
zero counts, and a D1 read failure surfaces the structured `ADMIN_UNAVAILABLE`
503. Backfill version, coverage status, and `CountersDO` proof state are
write-side internals and never gate admin reads.

### Preset windows

- **Week** = rolling 7 UTC days `[today-6, today]`, including today.
- **Month** = rolling 30 UTC days `[today-29, today]`, including today.
- **Today** = `[today, today]`.
- Custom ranges keep the 90-day cap; malformed, future-ended, or over-90-day
  ranges return JSON 400.

### Missing aggregate rows

- A day (or user/hour/bucket/word row) absent from the D1 aggregate tables
  renders zero in the response. No proof of emptiness is required.

### API response contract

- **200** with stats; `status` is always `'final'`.
- **503 `ADMIN_UNAVAILABLE`**: any D1 read failure; structured JSON, no KV or DO
  fallback.
- **400**: malformed/future/over-90-day custom range.
- Auth and chat-access checks still run before stats selection (no pre-auth
  rejection).

### Admin UI

- Non-2xx responses are parsed as JSON; `ADMIN_UNAVAILABLE` and generic failures
  render designed Russian error states. Raw response text, thrown error messages,
  and serialized payloads are never rendered. Controls stay usable.

## Incident

A two-month custom date range request to `/admin/api/chat` returned a Cloudflare
**1101 HTML error page** instead of stats JSON. Cloudflare documents error 1101 as
"Worker threw a JavaScript exception" — the request hit an uncaught exception and
the runtime rendered the generic 1101 page, which the admin SPA cannot render.

### Confirmed evidence

- `src/api/admin.ts` returns `await handleAdminRequest(req, env)` directly for
  `/admin*` with no exception boundary (`src/index.ts`), so any throw escapes to the
  runtime and surfaces as 1101.
- `src/api/admin-stats.ts` `getAdminChatStats` fans out five KV-heavy aggregations
  through `Promise.all`: `getActivityStats` (per-day prefix `list` + batched `get`
  across `stats_v2`, `word_stats_v2`, `media_stats_v2`, `media_duration_v2`,
  `activity_hour`, `activity_time_bucket`) plus full-chat-prefix scans for
  `profanity:*`, `profanity_words:*`, `profanity_word_users:*`, `criminal:*`.
- Each `COUNTERS.list` page and each `COUNTERS.get` counts as a subrequest.
  Cloudflare Workers cap subrequests at **1,000 per invocation**.
- KV counters currently have **no TTL**, so they remain a complete backfill source.
- Existing D1 binding `DB` (database `summaries`) has only `activity(chat_id, day,
  count)` with 575 rows across 4 chats — it **cannot** reconstruct historical
  per-user/category stats on its own.
- Baseline test suite passes (`rtk npm test`, 70 files) and `rtk npx wrangler deploy
  --dry-run` passes.

### Assumptions (not yet confirmed)

- The exact exception text from the incident is **not available** through current CLI
  evidence. Subrequest exhaustion is the strongest **hypothesis**, not a fact.
- Confirm via **Workers Logs**:
  - Filter `$workers.outcome = "exception"` to list all uncaught-exception requests.
  - Open the matching request's exception log lines; the message/stack names the
    throwing operation. Subrequest limit hits surface as a limit/over-limit error
    (e.g. subrequest count exceeded) rather than a domain error.
  - Cross-check the request path (`/admin/api/chat`) and the long `from`/`to` span.

### Root cause hypothesis

For a busy chat, a 60-day custom range issues per-day prefix scans plus full-chat
prefix scans across five parallel aggregations. That is thousands of KV subrequests
in a single request, exceeding the per-invocation limit and throwing an uncaught
exception, which Cloudflare renders as 1101. Logs filtered with
`$workers.outcome = "exception"` confirm the exact failing operation.

## Target Architecture

- **`CountersDO` remains the serialized writer** for all counter increments
  (`src/durable-objects/counters-do.ts`); it writes daily aggregates (dual-write).
- **Existing D1 (`DB`, database `summaries`) is the sole admin aggregate read
  model.** Admin reads are a single D1 query set; no KV scan.
- **KV remains the temporary source for the write-side backfill** (counters have
  no TTL); KV is never consulted by admin reads.
- **No request-time full-chat KV scan** on `/admin/api/chat`.

## Phased Rollout

1. **Containment** (Phase 1 — implemented): admin exception boundary returns
   `ADMIN_UNAVAILABLE` JSON 503; no 1101 from this route. The temporary 3-day
   guard with `HISTORICAL_STATS_NOT_READY` (historical) was superseded by the
   direct D1 reader: custom ranges now read D1 like presets.
2. **D1 schema** (Phase 2 — implemented): aggregate tables + coverage table added
   by migration `0009_stats_daily_aggregates.sql` (see below). Existing `activity`
   table remains untouched.
3. **Dual-write** (Phase 2 — implemented): `CountersDO` writes each day's aggregate
   rows alongside existing counter increments in a single D1 `batch` per event;
   coverage for that (chat, day) records live statuses (never `complete`). Admin
   reads now use D1 directly.
4. **Cursor/bounded backfill** (Phase 3a — implemented): backfill all available
   modern counter history older than an immutable cutoff day from existing KV
   counters in bounded, resumable, D1-checkpointed slices; each completed day
   gets its coverage row (completed only after finalize parity). See
   "Phase 3a: Backfill" below.
5. **Parity**: compare D1 aggregate totals against KV-derived totals for the same
   ranges per chat; mismatches are tracked as coverage `reason_code`s. This is a
   write-side integrity check and does not gate admin reads.
6. **D1 canary/cutover** (superseded): the planned backend-selection flag and
   legacy KV fallback were removed by the simplified reader — admin reads are
   D1-only for every range.
7. **D1 reader (implemented)**: admin reads serve D1 aggregates directly for every
   range. Absent aggregate rows render zero. D1 failures return
   `ADMIN_UNAVAILABLE` (503); no legacy KV fallback and no `CountersDO` proof
   gate exist on the read path. The reader derives preset-period sentence
   attributes (`totalYears`/`lifeSentences`) from `criminal_violations`; custom
   ranges stay count-only. A preset with aggregate criminal counts but no viable
   violations rows returns a safe `ADMIN_UNAVAILABLE` rather than silently
   dropping the sentence schema.
8. **Retention cleanup**: once D1 is authoritative, apply TTL to new KV counter writes
   and remove old KV counter keys; the legacy KV read path is already gone.

## Phase 3a: Backfill (completed — v3 job done, cron removed)

The v3 backfill has reached terminal `done` status. The `* * * * *` cron trigger
has been removed from `wrangler.jsonc`; only the daily `59 23 * * *` remains.
The backfill ran from `BACKFILL_CRON` in `src/features/stats/daily-backfill.ts`
via `src/index.ts` scheduled dispatch. The dispatch code is preserved for
possible future explicit reruns. The regular cron (`59 23 * * *`,
`DAILY_SUMMARY_CRON`) remains unchanged. **304 coverage rows remain incomplete**
(parity mismatches or missing base activity) and require separate explicit
remediation — they are not addressed by cron retries. Incomplete coverage is a
write-side integrity matter and never gates admin reads: days without aggregate
rows render zero.

### Scope: full available modern counter history

- Migrates **all parseable modern source families consumed by Phase-2 aggregate
  tables** strictly older than an immutable cutoff day, not only keys reachable
  from a `stats_v2` base key. There is **no 90-day limit**.
- Scanned families: `stats_v2`, `word_stats_v2`, `media_stats_v2`,
  `media_duration_v2`, `profanity`, `criminal`, `criminal_severity`,
  `activity_hour`, `activity_time_bucket`, `profanity_words`,
  `profanity_word_users`. Each family writes only its own columns via
  column-specific absolute upserts, so family arrival order can never zero or
  overwrite another family's values.
- Signed Telegram identifiers are accepted: negative group/supergroup chat IDs
  (`-100...`) and positive user IDs. Malformed, decimal, exponent, or otherwise
  non-integer values are rejected.
- Intentional non-target exclusions: `word_activity:{chat}:{day}` is a redundant
  chat-day word total derivable from `SUM(stats_daily_user.word_count)`;
  `criminal_article:{chat}:{article}:{day}` is article-level data absent from
  Phase-2 target tables and current admin aggregate response. Neither is scanned
  or given a coverage predicate. This phase does not add unused target schema.
- At job initialization the backfill persists `cutoff_day` = the UTC day the job
  begins. Source keys with `day >= cutoff_day` are skipped — those dates
  continue only live dual-writing and are never marked complete by this phase.
- Legacy-only `stats:{chat}:{user}:{day}` history is **out of scope**: it cannot
  be listed by date without a full legacy-namespace scan, so those days remain
  unavailable. Raw message history is out of scope and cannot reconstruct
  classifications.

### State, lease, and resumability (D1-authoritative)

- Migration `0010_stats_backfill_state.sql` adds the singleton `stats_backfill_state`
  table (job `daily_aggregates_v1`) with version, status, phase, `cutoff_day`,
  the KV list cursor + in-page offset, lease owner/expiry, revision, a safe
  `error_code`, and timestamps. **Progress is never stored in COUNTERS KV**; the
  previous KV-checkpoint implementation and its key assumptions are removed.
- Each invocation acquires a short lease via an atomic compare-and-set UPDATE
  (`lease_owner IS NULL OR lease_expires_at < now`); a competing cron run that
  overlaps an active run **no-ops** (reported as `leaseBlocked`). The lease is
  renewed on every state write and released when the invocation finishes; a
  crashed run stalls only until the lease expires.
- The checkpoint advances **only after** the D1 batch succeeds. A failed slice
  keeps its cursor + offset and is retried; because every aggregate write is an
  **absolute upsert** keyed by table PK (never additive `+`), re-reading the
  same slice converges and never double-counts.
- After acquiring or resetting, an invocation captures its exact
  `{job_name, version, revision, lease_owner, lease_check_time}` epoch. Every
  backfill aggregate, profile, coverage, and finalize mutation embeds that
  state predicate in its own SQL statement; upserts repeat it in both the
  insert and conflict-update paths. Checkpoint, terminal finish, and lease
  release also compare the full epoch. A revision increment creates the next
  token, so an expired, reset, or superseded runner cannot mutate data or
  progress after losing authority. Coverage conflict updates additionally
  require `source = 'backfill'`; live ownership always wins.

### Version-gated rescan (Phase 4a: one-time profile rehydration restart)

When `JOB_VERSION` is bumped (currently 3, bumped from 2 for v3 barrier
preparation), the backfill enforces the new version. This is a **write-side**
consistency mechanism: admin reads never consult `JOB_VERSION`, coverage
status, or backfill state.
- **Backfill atomic reset**: on the first scheduled backfill run after a
  version bump, the backfill detects `state.version !== JOB_VERSION` and issues
  a single `db.batch()` containing two statements:
   1. Reset the state row only if its observed prior revision still matches and
      its lease is free or expired: `version = JOB_VERSION, status = 'running',
      phase = 'base', cursor = NULL, page_offset = 0, error_code = NULL`, a
      fresh lease owner/expiry, and `revision = revision + 1`.
   2. Invalidate every backfill-owned coverage row (`source = 'backfill'`):
      `base_status = 'pending', profanity_status = 'pending,
      criminal_status = 'pending, reason_code = NULL`, only when the state
      row still exactly matches that resulting reset epoch.
  Both statements run in the same D1 atomic batch, so old `complete` coverage
  can never be finalized-between the version bump and the coverage reset.
  Live-owned rows (`source = 'live'`) are untouched. The immutable `cutoff_day` is
  preserved. After the batch, the backfill re-reads the state row and continues
  the normal lease-acquire / phase-dispatch flow from `base` with a clean
  checkpoint.
- **Aggregate data preserved**: absolute upserts are re-run over the same KV
  source data with the new profile hydration code; no aggregates or coverage
  metadata are deleted. Days that were previously `complete` re-processed and
  re-finalize with parity checks. The version bump is a one-time rescan, not
  a deployment/status fiction.

#### First fenced rollout prerequisite

Epoch fencing protects only SQL emitted by fenced code. Before activating this
first fenced `JOB_VERSION=2` rollout, operators must establish a drain barrier
for every v1 backfill invocation: stop v1 backfill dispatch, wait for all
in-flight v1 invocations to finish (at least the active lease window plus
observed request drain), then deploy/activate the fenced worker and allow its
version reset. A v1 invocation already executing unfenced SQL cannot be
retroactively stopped by a state reset and can otherwise write stale rows after
the reset invalidates coverage. **The drain window is closed; v3 reached
terminal done.**

### Phases

Deterministic global phases over the complete modern KV namespaces, one phase
(or page portion) per invocation, always filtering parsed source dates
`< cutoffDay`:

1. `base` — `stats_v2:` → absolute `message_count` per user + username profiles
   from `user:{id}`.
2. `words` — `word_stats_v2:` → `word_count`.
3. `media_stats` — `media_stats_v2:` → `voice_count` / `video_note_count`.
4. `media_duration` — `media_duration_v2:` → `voice_duration_seconds` /
   `video_note_duration_seconds`.
5. `profanity` — `profanity:` → `profanity_count`.
6. `criminal` — `criminal:` → `criminal_count`.
7. `criminal_severity` — `criminal_severity:` → `criminal_severity`.
8. `hours` — `activity_hour:` → `stats_daily_hour`.
9. `buckets` — `activity_time_bucket:` → `stats_daily_bucket_user`.
10. `profanity_words` — `profanity_words:` → `stats_daily_profanity_word`.
11. `profanity_word_users` — `profanity_word_users:` →
    `stats_daily_profanity_word_user`.
12. `finalize` — page coverage rows with `source = 'backfill'`, day `<
    cutoffDay`, no reason, and non-complete statuses. For each: if there is no
    base counter (`SUM(stats_daily_user.message_count) = 0`, e.g. an orphan
    source-family day) it is marked `missing_base_counter`; otherwise compare
    `SUM(stats_daily_user.message_count)` with the matching legacy `activity`
    row. An exact match atomically sets all three statuses `complete` (`source =
    'backfill'`, reason cleared) **only if** the coverage still reflects the
    expected backfill state (`source = 'backfill'` and all statuses `pending`).
    Missing activity rows stay incomplete with
    `reason_code = 'missing_activity_total'`; mismatches stay incomplete with
    `reason_code = 'message_count_mismatch'`. **Coverage is never set
    `complete` anywhere else.**

Each newly discovered `(chat, day)` gets a coverage row `source = 'backfill'`
with `pending` statuses. For an existing `source = 'live'` row, backfill leaves
source, all statuses, and `reason_code` unchanged (only timestamp may refresh),
so live ownership never regresses. Invalid scoped keys/values are recorded as short safe
`reason_code` values (`source_key_invalid` / `source_value_invalid`) on the
affected (chat, day) and never logged raw; such days stay incomplete rather than
assumed correct. The backfill does not delete or mutate KV source data or legacy
tables.

### Resource and idempotency bounds

- Per invocation: one phase/page portion, at most **50 inspected source KV list
  entries** (valid, malformed, invalid, and cutoff entries all count), at most
  300 KV gets, and at most **90 D1 statements total across the entire
  invocation**. Source data batches cap at 81 statements, reserving nine for
  initial state, lease, checkpoint/release, and state-error recovery; finalize
  keeps its fixed safe 25-row page (each row costs parity reads plus an update,
  so raising it would break the total statement budget). The slice stops before
  a logical row that would exceed remaining source-data budget and resumes there
  next run.
- **Phase-aware admission (50 is a cap, not a target).** Before a valid key is
  processed the phase reserves its worst-case statements — base reserves two
  (message_count upsert plus the optional username profile upsert), every count
  family reserves one — plus one coverage upsert per new (chat, day), and the
  KV gets; the key is left for the next run when the estimate would exceed the
  81-statement source batch or 300 KV gets. Simple one-statement families (e.g.
  `profanity_words`, `profanity_word_users`) therefore reach the full 50-key
  cap, while the base phase naturally stays near its previous safe count
  (~25–40 keys depending on profile/coverage density) and finalize stays at 25
  rows. Malformed, invalid, and cutoff keys still count against the 50
  inspected-key cap regardless of admission. This is a temporary migration
  throughput optimization only; the D1/KV hard limits are unchanged and no ETA
  or cost reduction is implied.
- No broad namespace/counter data is buffered in memory (only the current list
  page of key names).
- `reason_code` (nullable) is added to `stats_daily_coverage` by migration 0010;
  only short enumerated safe codes are ever stored
  (`source_key_invalid`, `source_value_invalid`, `missing_base_counter`,
  `missing_activity_total`, `message_count_mismatch`).

### Live/backfill race (closed; both orderings converge)

The live dual-write persists **exact post-KV totals** (absolute, not additive),
and the backfill uses `MAX` on conflict for live-owned days, so a stale backfill
snapshot cannot reduce a counter that the live path already advanced, and a
late live batch cannot double-count a message that the backfill snapshot
already observed. Both orderings converge; a separate reconciliation run is not
required.

- The live writer (`d1-aggregate-writer.ts`) forces any category status it
  touches back to `live` (and `source = 'live'`) in the **same D1 batch** as its
  absolute write, even if that day was `pending`, `backfill`, or `complete`.
- Backfill inserts missing coverage as `pending` with `source = 'backfill'`, but
  conditional UPSERT fields preserve an existing `source = 'live'` row. The
  `finalize` completion is conditional on the coverage still reflecting expected
  backfill state (`source = 'backfill'` and all three statuses `pending`), so a
  live-owned day never marks coverage `complete` — only the finalize parity
  check can.
- Excluding the cutoff day and later and parity-gating coverage completion
  remain required, but counter values converge, so a raced/late day serves its
  live counts rather than rendering zero from a stale snapshot.

### Privacy

Backfill error logs carry only the error name/code/safe message, phase, and
operation — never raw chat/user ids, dates, words, messages, query data, or
SQL. Run summaries are count-based.

### Termination

Terminal `done` job status performs only a cheap D1 state read (no writes).
See "Phase 3b: Temporary Cron Removal" for the exact removal path.

## Phase 3b: Temporary Cron Removal (completed)

The `* * * * *` cron has been permanently removed from `wrangler.jsonc`. The v3
backfill reached terminal `done` status. The `src/index.ts` backfill dispatch
branch is preserved for possible future explicit reruns.

1. ~~Remove `"* * * * *"` from `wrangler.jsonc` `triggers.crons`~~ — **done**
2. Verify the job reached terminal state: `stats_backfill_state` row for
   `daily_aggregates_v1` has `status = 'done'` and `phase = 'done'` — **done**
3. Verify coverage: 304 `stats_daily_coverage` rows remain incomplete (parity
   mismatches or missing base activity); these require separate explicit
   remediation.
4. Keep the `59 23 * * *` daily cron unchanged. The `stats_backfill_state`
   `done` row is harmless and may be left in place (or deleted to allow a
   future re-run, which is safe because all writes are absolute).

Phase 5 (parity re-verification) remains not implemented. The D1 reader **is**
implemented: admin reads serve D1 aggregates directly for every range; absent
aggregate rows render zero and D1 failures surface `ADMIN_UNAVAILABLE`. 304
incomplete rows need explicit remediation (write-side, does not gate reads).

## v3 Barrier Release (completed)

The v3 backfill has reached terminal `done` status. The temporary `* * * * *`
cron trigger has been removed from `wrangler.jsonc`.

### What changed

- `wrangler.jsonc` `triggers.crons`: `"* * * * *"` removed; only
  `"59 23 * * *"` (daily summary cron) remains.
- `docs/features/admin-stats-d1-optimization.md`: updated to reflect v3
  completion and 304 incomplete coverage rows.

### What did NOT change

- `src/index.ts` dispatch — backfill branch preserved for future explicit
  reruns.
- `src/features/stats/daily-backfill.ts` — handler code untouched.
- Runtime vars, bindings, KV, D1, migrations, all other source code — untouched.

### Rollout state

| Step | Status |
|---|---|
| Remove v2 cron trigger from config | **Done** |
| Deploy v3 cron-off Worker | **Done** |
| Re-add cron for v3 backfill run | **Done** |
| First v3 backfill run / v3 state reset | **Done** |
| v3 backfill terminal done | **Done** |
| Remove `* * * * *` cron permanently | **Done** |
| D1 admin reader (all ranges) | **Active** |
| 304 incomplete coverage rows | **Requires separate explicit remediation** |
| Phase 5 parity re-verification | Not implemented |

## Intended Aggregate Tables & Key Fields

All primary keys are date-indexed (`(chat_id, day, ...)`). Implemented by migration
`0009_stats_daily_aggregates.sql` (Phase 2). Migration `0010_stats_backfill_state.sql`
(Phase 3a) additionally adds the D1-authoritative `stats_backfill_state` job
table and the nullable `reason_code` column on `stats_daily_coverage`. Names
differ from the original plan below; these tables are authoritative. The
reader consumes these tables for admin stats.

| Table | Columns | PK |
|---|---|---|
| `stats_daily_user` | `chat_id`, `day`, `user_id`, `message_count`, `word_count`, `voice_count`, `voice_duration_seconds`, `video_note_count`, `video_note_duration_seconds`, `profanity_count`, `criminal_count`, `criminal_severity`, nullable `last_message_ts` | `(chat_id, day, user_id)` |
| `stats_daily_hour` | `chat_id`, `day`, `hour` (0–23 CHECK), `message_count` | `(chat_id, day, hour)` |
| `stats_daily_bucket_user` | `chat_id`, `day`, `bucket`, `user_id`, `message_count` | `(chat_id, day, bucket, user_id)` |
| `stats_daily_profanity_word` | `chat_id`, `day`, `word`, `count` | `(chat_id, day, word)` |
| `stats_daily_profanity_word_user` | `chat_id`, `day`, `word`, `user_id`, `count` | `(chat_id, day, word, user_id)` |
| `stats_user_profile` | `user_id`, `username`, `last_seen_ts` | `user_id` |
| `stats_daily_coverage` | `chat_id`, `day`, `base_status`, `profanity_status`, `criminal_status`, `source`, `reason_code` (nullable, migration 0010), `updated_at` | `(chat_id, day)` |

`stats_daily_user` merges the original `stats_daily` / `stats_profanity` /
`stats_criminal` per-user tables into one row per (chat, day, user). No separate
`stats_activity_hourly` / `stats_activity_bucket` / `stats_profanity_words` tables
exist; the equivalent rows live in `stats_daily_hour`, `stats_daily_bucket_user`,
and `stats_daily_profanity_word` / `stats_daily_profanity_word_user`.

Source KV key patterns (consumed by the backfill; not read by admin stats):

- `stats_v2:{chatId}:{day}:{userId}` — per-user message count
- `word_stats_v2:{chatId}:{day}:{userId}` — per-user word count
- `media_stats_v2:{chatId}:{day}:{userId}:{voice|video_note}` / `media_duration_v2:...` — media counts/seconds
- `activity_hour:{chatId}:{day}:{hour}` — hourly counts
- `activity_time_bucket:{chatId}:{day}:{bucket}:{userId}` — time-bucket participation
- `activity:{chatId}:{day}` — legacy day totals (unused by admin stats)
- `profanity:{chatId}:{userId}:{day}` / `profanity_words:{chatId}:{word}:{day}` / `profanity_word_users:{chatId}:{word}:{day}:{userId}`
- `criminal:{chatId}:{userId}:{day}`
- The D1 reader resolves leaderboard/profile names and last-message
  timestamps from the chat-scoped `stats_chat_user_profile` table (migration
  0011), so the D1 read path performs no request-time KV metadata reads.
  `last_message:{chatId}:{userId}` and `user:{userId}` remain in KV as the
  backfill source.

## Coverage Tracking

- One `stats_daily_coverage` row per `(chat_id, day)` with per-category statuses
  (`base_status`, `profanity_status`, `criminal_status`), a `source` column, a
  nullable `reason_code` (safe enumerated anomaly/parity code), and `updated_at`.
  Statuses are `none` (default), `live`, `pending` (backfill in progress), or
  `complete`; **`complete` is never written by live events** and only by the
  Phase 3a `finalize` parity check.
- Phase 2 live dual-write only upgrades the category it touched to `live` and sets
  `source = 'live'`.
- Phase 3a backfill inserts missing coverage rows as `pending` with
  `source = 'backfill'`; it may refresh existing backfill-owned rows, but its
  conditional UPSERT preserves an existing `source = 'live'` row's source,
  statuses, and reason. The `finalize` phase marks all three statuses `complete`
  with `source = 'backfill'` and clears `reason_code` only when (a) a base
  counter exists (`SUM(stats_daily_user.message_count) > 0`), (b) that sum
  exactly equals the legacy `activity` total for that (chat, day), and (c) the
  coverage still reflects expected backfill state (no live write raced in). Days
  with no base counter stay incomplete with `reason_code =
  'missing_base_counter'`; missing/mismatched legacy totals keep non-complete
  statuses with `reason_code = 'missing_activity_total'` or
  `'message_count_mismatch'`. Coverage statuses are write-side integrity
  bookkeeping only: admin reads never consult them, and a day without aggregate
  rows renders zero regardless of coverage state.

## Read Semantics

- D1 is the **sole admin stats source**: every `/admin/api/chat` request reads
  D1 aggregates directly. No KV scan/merge, no legacy fallback, no `CountersDO`
  proof, and no readiness/coverage gate on the read path.
- Days with no aggregate rows render zero counts. Absent per-user, per-hour,
  per-bucket, or per-word rows render zero in their respective rankings.
- **Never mix sources for one range**: the whole response comes from the single
  D1 read.

## Failure Semantics

- Any D1 read failure → structured `ADMIN_UNAVAILABLE` JSON 503 via the
  containment boundary; no KV or DO fallback.
- A custom range ending in the future is invalid 400; malformed or over-90-day
  ranges are 400.
- Dual-write/backfill failures are write-side: the D1 aggregate row simply stays
  absent until the write succeeds, so the affected day renders zero rather than
  failing the read.

## Privacy

- Aggregates store counts only — **no message text** and **no raw profanity words
  beyond the already-normalized word totals**. The chat-scoped
  `stats_chat_user_profile` table (migration 0011) stores the current username
  and last-message timestamp per (chat, user) with monotonic semantics (older
  events never overwrite newer profile state). The D1 read path resolves names
  and last-message timestamps from this table, so no cross-chat username leakage
  and no request-time KV metadata reads on the D1 success path.
- Dual-write error logs contain only the base36 chat identity, the operation
  category, and the error name/message — never user IDs, usernames, profanity
  words, message text, raw day values, query SQL, or payloads.
- Backfill error logs contain only error name/code/safe message, phase, and
  operation; run summaries are count-based. Never raw chat/user ids, dates,
  words, messages, query data, or SQL.
- Admin containment logging logs only method, pathname, request ID, and error
  name/message — never Telegram payloads, usernames, query values, or raw chat IDs.
- Privacy-safe participant-timeline rendering is unchanged.

## Rollback

- KV write path remains untouched until retention cleanup; `wrangler rollback`
  reverts code.
- D1 aggregate rows are additive and can be left in place or cleared; admin reads
  always come from D1, so no read path depends on KV state.

## Data Correctness Guardrails

- Coverage `complete` status is only written by the Phase 3a `finalize` parity
  check (after `SUM(stats_daily_user.message_count)` matches the legacy
  `activity` total per (chat, day)) or by the Phase 5 parity check; live
  dual-write only records `live` statuses, and backfill in progress records
  `pending`. Coverage is write-side bookkeeping and never gates admin reads.
- Backfill is idempotent (absolute upsert by PK), bounded, and D1-checkpoint
  resumable (lease + cursor + offset).

## Cost Guardrails

- Phase 1 adds **no paid service, queue, Durable Object, or Worker binding**.
- One range request = one D1 read set, instead of thousands of KV
  subrequests. D1 free tier (5M rows read/month) is ample for per-day aggregates.
- One D1 write set per (chat, day), serialized through the single `CountersDO`
  writer.

## Phase 1 Acceptance Criteria

- This spec exists under `docs/features/`.
- Uncaught admin failure returns the exact `ADMIN_UNAVAILABLE` 503 JSON with
  `Cache-Control: no-store`; no Cloudflare 1101 page from this route.
- Admin stats read D1 aggregates directly: days with no aggregate rows render
  zero; a D1 read failure returns `ADMIN_UNAVAILABLE` 503 with no KV/DO
  fallback; a custom range ending in the future is 400.
- Admin UI renders designed Russian error states and never renders raw response
  text/JSON; week/month labels state the rolling windows including today.
- No KV mixing on the admin read path.
- All existing tests plus new focused tests pass.
- `rtk npx wrangler deploy --dry-run` passes.
- Only intended files changed; `opencode.json` untouched (user's worktree change).

## Validation Commands

```bash
rtk npm test
rtk npx vitest run tests/index.test.ts
rtk npx vitest run tests/daily-backfill.test.ts
rtk npx wrangler deploy --dry-run
rtk git diff --check
```

`rtk npx tsc --noEmit` is **not** an acceptance gate: the repo has 199 pre-existing
baseline TypeScript errors unrelated to this work; fixing them is a documented
non-goal.

## Non-Goals & Notes

- Phase 1 does **not** create any D1 migration, does not implement aggregates,
  dual-write, backfill, parity, canary, or retention cleanup.
- **Parity re-verification (Phase 5) and retention cleanup are not implemented.**
  The D1 reader **is** implemented: admin reads serve D1 aggregates directly via
  `/admin/api/chat` for every range; absent aggregate rows render zero and D1
  failures surface `ADMIN_UNAVAILABLE`. 304 coverage rows remain incomplete and
  require separate explicit remediation; they are not addressed by cron retries
  and do not gate admin reads.
- `MAX_CUSTOM_RANGE_DAYS` (90) is unchanged; malformed/over-90-day ranges still
  return JSON 400.
- The 3-day guard is explicit temporary containment, not an attempt to optimize KV
  scanning.
