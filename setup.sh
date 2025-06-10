#!/bin/bash
# Create resources for the worker using Wrangler
npx wrangler kv namespace create HISTORY
npx wrangler kv namespace create COUNTERS
npx wrangler d1 create summaries
npx wrangler d1 migrations apply summaries
# Cron trigger is defined in wrangler.jsonc and will be created on deploy
