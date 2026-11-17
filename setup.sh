#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
Manual resource provisioning through setup.sh is no longer supported.
It creates resources without connecting their IDs to the Worker.

For a new installation, use the Deploy to Cloudflare button in README.md.
For a self-hosted CLI installation, follow docs/ops/release-and-self-hosting.md
and use npm run deploy:public in YOUR OWN Cloudflare account.

Do not run the public deploy command in the owner's production account.
EOF
exit 1
