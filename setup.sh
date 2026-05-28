#!/usr/bin/env bash
set -euo pipefail

echo "Creating Cloudflare resources for Telegram Stats Bot..."
echo

echo "1. KV namespaces"
npx wrangler kv namespace create HISTORY --config /dev/null
npx wrangler kv namespace create COUNTERS --config /dev/null
echo

echo "2. D1 database"
npx wrangler d1 create telegram_stats_bot --config /dev/null
echo

echo "3. Optional Vectorize index for legal RAG experiments"
echo "   Skip this unless you enable ENABLE_CRIMINAL_ANALYSIS/legal-rag."
echo "   Command:"
echo "   npx wrangler vectorize create telegram-stats-legal-rag --dimensions=1024 --metric=cosine"
echo

echo "Next steps:"
echo "- Copy the generated KV IDs and D1 database_id into wrangler.jsonc."
echo "- Set required secrets:"
echo "  npx wrangler secret put TOKEN"
echo "  npx wrangler secret put SECRET"
echo "- Apply migrations after updating wrangler.jsonc:"
echo "  npx wrangler d1 migrations apply DB --remote"
echo "- Deploy:"
echo "  npm run deploy"
