# AGENTS.md
## 📜 Project Overview
Telegram **Stats Bot** collects messages via webhook, stores them 7 days in Cloudflare KV, counts posts per user, and generates daily/weekly summaries with Workers AI (no training on user data). Targets ≤ $6 / month.

## 📁 Repo Layout
.
├── wrangler.jsonc         # Cloudflare env & KV bindings
├── package.json           # npm scripts, dev deps
├── package-lock.json      # dependency lock file
├── tsconfig.json          # TypeScript configuration
├── vitest.config.ts       # Vitest test configuration
├── setup.sh               # setup script for development
├── migrations/            # database migrations
│   ├── 0001_init.sql
│   └── 0002_activity.sql
├── src/
│   ├── index.ts           # main entry for CF Worker
│   ├── telegram.ts        # Telegram webhook handlers
│   ├── history.ts         # message history management
│   ├── stats.ts           # statistics calculation
│   ├── summary.ts         # summary generation
│   ├── update.ts          # update handlers
│   ├── utils.ts           # utility functions
│   └── env.ts             # environment types and validation
├── tests/
│   └── index.test.ts      # vitest unit tests
├── .github/
│   └── workflows/
│       └── ci.yml         # GitHub Actions CI/CD
└── .gitignore            # git ignore rules

## ▶️ Essential Commands
| Purpose           | Command                                   |
|-------------------|-------------------------------------------|
| Dev server        | `npx wrangler dev --local`                |
| Unit tests        | `npm test`                                |
| Deploy            | `npx wrangler deploy`                     |
| Setup             | `./setup.sh`                              |

Codex: **always run tests before committing changes**.  
If tests fail, prefer minimal fixes over large refactors.

## 🛠 Environment Variables (set via `wrangler secret put`)
- `TOKEN` – Telegram bot token; **never print** to logs.
- `SECRET` – webhook HMAC header for security validation.

## 🧑‍💻 Coding Conventions
1. TypeScript 5+, `moduleResolution=node16`, strict type-checks.  
2. ES2020 modules, top-level `await` allowed in Workers.  
3. Prettier default config; 100 char line length; single quotes.  
4. Use async/await; avoid `.then()` chains.  
5. **No console.log of user messages**; use `console.debug` with hashed IDs.
6. Follow functional programming patterns where possible.
7. Use descriptive variable names and JSDoc comments for public APIs.

## 🔐 Security & Privacy Rules
- Do **not** log full Telegram payloads.  
- Strip PII before saving metrics.  
- KV keys use pattern `msg:{chat}:{ts}:{id}` with **ttl=604800**.  
- Summaries are ephemeral; archive older than 30 d to D1.  
- Workers AI must be invoked with model in `env.AI`. Inputs stay private; Cloudflare **does not train** on them.
- Always validate webhook signatures using HMAC-SHA256.
- Sanitize all user inputs before processing.

## 🔄 Development Workflow
1. Create feature branch from main
2. Make changes with tests
3. Run `npm test` to ensure all tests pass
4. Run `npx wrangler dev --local` for local testing
5. Create PR with description of changes
6. CI will run tests automatically
7. Merge after approval and passing CI