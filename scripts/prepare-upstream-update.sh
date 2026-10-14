#!/usr/bin/env bash
# Merge a reviewed upstream release into a new branch without replacing
# Cloudflare's per-installation Wrangler resource IDs.
set -euo pipefail

TAG="${1:-}"
if [[ ! "$TAG" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "Usage: $0 vMAJOR.MINOR.PATCH" >&2
  exit 2
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Worktree is dirty; commit or stash your changes first." >&2
  exit 2
fi

BASE="$(git rev-parse HEAD)"
BRANCH="updates/$TAG"
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "Branch $BRANCH already exists; review it before trying again." >&2
  exit 2
fi

UPSTREAM_REPOSITORY_URL="${UPSTREAM_REPOSITORY_URL:-https://github.com/thesunwave/telegram_history_bot.git}"
git fetch --no-tags "$UPSTREAM_REPOSITORY_URL" "refs/tags/$TAG"
RELEASE_COMMIT="$(git rev-parse 'FETCH_HEAD^{commit}')"
git switch -c "$BRANCH"

# Even a fast-forward must leave a merge commit and a chance to restore
# the installer's resource IDs. Never deploy as a side effect of this script.
if ! git merge --no-commit --no-ff "$RELEASE_COMMIT"; then
  echo "Merge requires review; preserving the existing installation config." >&2
fi

if git cat-file -e "$BASE:wrangler.jsonc" 2>/dev/null; then
  git show "$BASE:wrangler.jsonc" > wrangler.jsonc
  git add wrangler.jsonc
fi

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo "Non-Wrangler merge conflicts remain. Resolve manually; no PR created." >&2
  git diff --name-only --diff-filter=U >&2
  exit 1
fi

if [[ -z "$(git rev-parse -q --verify MERGE_HEAD)" ]]; then
  echo "No merge to commit (already up to date)." >&2
  exit 0
fi
git -c user.name="Self-host Update Bot" -c user.email="selfhost-update@users.noreply.github.com" \
  commit -m "chore: update upstream to $TAG (retain installation config)"
echo "Prepared branch: $BRANCH"
