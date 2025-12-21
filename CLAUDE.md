# Claude Instructions

Use this file together with AGENTS.md. AGENTS.md is the source of truth.

## Project Conventions
- Follow repo structure rules in AGENTS.md.
- Keep root clean; place docs in docs/, scripts in scripts/, logs in logs/.
- docs filenames use lowercase kebab-case.
- Do not change quote style unless replacing all quotes project-wide.
- Do not log user messages; use console.debug with hashed IDs when needed.
- Never print secrets (TOKEN, SECRET, API keys).

## Documentation Placement
- docs/guides/: user/dev guides
- docs/ops/: deployment/monitoring runbooks
- docs/notes/: implementation notes and fix summaries
- docs/debug/: debugging artifacts (e.g., Postman collections)
- docs/features/: feature design docs

## Testing
- Run `npm test` before commit.
- Prefer minimal fixes when tests fail.
