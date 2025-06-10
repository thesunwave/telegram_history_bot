# AGENTS.md
## 📜 Project Overview
Telegram **Stats Bot** collects messages via webhook, stores them 7 days in Cloudflare KV, counts posts per user, and generates daily/weekly summaries with Workers AI (no training on user data). Targets ≤ $6 / month.

## 📁 Repo Layout
.
├── wrangler.jsonc         # Cloudflare env & KV bindings
├── package.json           # npm scripts, dev deps
├── src/
│   ├── index.ts           # main entry for CF Worker
├── tests/
│   └── index.test.ts      # vitest unit tests

## ▶️ Essential Commands
| Purpose           | Command                                   |
|-------------------|-------------------------------------------|
| Dev server        | `npx wrangler dev --local`                |
| Unit tests        | `npm test`                                |
| Deploy            | `npx wrangler deploy`                     |

Codex: **always run tests before committing changes**.  
If tests fail, prefer minimal fixes over large refactors.

## 🛠 Environment Variables (set via `wrangler secret put`)
- `TOKEN` – kept secret; **never print** to logs.
- `SECRET` – webhook HMAC header.

## 🧑‍💻 Coding Conventions
1. TypeScript 5+, `moduleResolution=node16`, strict type-checks.  
2. ES2020 modules, top-level `await` allowed in Workers.  
3. Prettier default config; 100 char line length; single quotes.  
4. Use async/await; avoid `.then()` chains.  
5. **No console.log of user messages**; use `console.debug` with hashed IDs.

## 🔐 Security & Privacy Rules
- Do **not** log full Telegram payloads.  
- Strip PII before saving metrics.  
- KV keys use pattern `msg:{chat}:{ts}:{id}` with **ttl=604800**.  
- Summaries are ephemeral; archive older than 30 d to D1.  
- Workers AI must be invoked with model in `env.AI`. Inputs stay private; Cloudflare **does not train** on them.