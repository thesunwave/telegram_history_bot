#!/bin/bash
# Create resources for the worker
wrangler kv:namespace create HISTORY
wrangler kv:namespace create COUNTERS
wrangler d1 create summaries
wrangler d1 migrations apply summaries
wrangler cron create daily_summary "59 23 * * *" /jobs/daily_summary
