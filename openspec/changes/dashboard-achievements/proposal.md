## Why

Group members who use the statistics dashboard need a way to see which badges their chat has earned and follow their own progress there.

## What Changes

- Add an Achievements tab to the selected chat in both dashboard languages.
- Show the shared collection and the signed-in participant's personal album using the existing rules, awards, consent and illustrations.
- Keep enrollment, sharing and consent changes in the existing Telegram flows.

## Capabilities

### New Capabilities

- `dashboard-achievements` — read group and personal achievements in the web dashboard.

## Impact

The Worker reads the existing D1 tables and serves the bundled badge illustrations. The change requires no schema migration.
