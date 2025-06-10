#!/bin/bash
# Create resources for the worker using Wrangler

# Use an empty config so creation works before IDs are set
npx wrangler kv namespace create HISTORY --config /dev/null
npx wrangler kv namespace create COUNTERS --config /dev/null
npx wrangler d1 create summaries --config /dev/null
npx wrangler d1 migrations apply summaries --config /dev/null
# Cron trigger is defined in wrangler.jsonc and will be created on deploy
