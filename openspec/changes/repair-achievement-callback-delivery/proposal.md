# Telegram achievement button delivery

## Why

Members reported that tapping a badge in a Telegram collection produced no visible response. An older webhook can filter out callback queries, and group replies can land outside the forum topic where the member tapped the button.

## What Changes

- Show callback delivery status to the bot owner and provide a targeted repair for an old explicit update filter.
- Keep replies in the originating topic, acknowledge card taps and show the badge details in text when a photo cannot be delivered.

## Capabilities

### New Capabilities

- `achievement-callback-delivery` — receive and respond to achievement button taps.

## Impact

The Worker uses the existing Telegram API, webhook credentials and owner setup page. No database migration is required.
