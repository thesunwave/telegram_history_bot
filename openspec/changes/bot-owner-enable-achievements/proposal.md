# Bot owner activation of group achievements

## Why

The bot owner needs to activate achievements in the web dashboard even without the chat administrator role.

## What Changes

- Add achievement status and activation to Bot installations.
- Use the existing verified owner session and confirm that the bot is installed in the selected group.

## Capabilities

### New Capabilities

- `owner-activation` — activate a shared group collection from the bot owner's web dashboard.

## Impact

Reuses the installation registry and enable operation. No database migration is required.
