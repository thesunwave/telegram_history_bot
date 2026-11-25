## Why

Members can browse locked achievements, but they cannot consistently see how close the chat or their own album is to unlocking them. The existing counters also lag until a scheduled evaluation.

## What Changes

- Show current, target, and remaining values for locked group, personal, and conversation badges in Telegram and in the dashboard.
- Preview eligible activity from the open UTC day after the statistics pipeline processes it.
- Refresh visible dashboard counters every minute and offer a refresh button in Telegram.

## Capabilities

### New Capabilities

- `live-achievement-progress`: Read and present current progress and its confirmation status in both collections.

## Impact

The existing achievement dashboard endpoint gains progress details. Telegram commands and callback authorization stay compatible. The feature uses existing D1 tables and award jobs.
