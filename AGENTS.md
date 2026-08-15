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
├── docs/                  # project documentation (see docs/README.md)
│   ├── guides/
│   ├── ops/
│   ├── notes/
│   ├── debug/
│   └── features/
├── scripts/               # utilities and helpers
│   └── fixes/
├── logs/                  # local logs (gitignored)
├── src/
│   ├── index.ts           # main entry for CF Worker
│   ├── api/               # request handlers
│   ├── core/              # shared core modules
│   ├── durable-objects/   # DO implementations
│   └── features/          # feature modules
├── tests/                 # vitest tests
├── .github/
│   └── workflows/
│       └── ci.yml         # GitHub Actions CI/CD
└── .gitignore            # git ignore rules

## 📂 File Placement & Naming
- Root: keep clean; only core config files and top-level docs.
- docs/: all documentation goes here; see docs/README.md for categories.
- scripts/: tooling and ad-hoc scripts; use scripts/debug or scripts/fixes.
- logs/: runtime/test logs; never commit.
- Naming: docs filenames use lowercase kebab-case.

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
8. **DO NOT change quotes style** unless explicitly required to replace ALL quotes in the project.

## 🎯 Code Quality & Best Practices

### Clean Code Principles
- **DRY** - Don't Repeat Yourself; extract common logic into reusable functions
- **KISS** - Keep It Simple Stupid; prefer simple, readable solutions
- **YAGNI** - You Aren't Gonna Need It; don't add complexity for hypothetical future needs
- **SLAP** - Single Level of Abstraction Principle; one function - one level of abstraction

### Function Design
- **Single Responsibility**: each function should do one thing well
- **Small functions**: prefer 20-30 lines max, extract complex logic
- **Descriptive names**: function names should explain what they do (e.g., `incrementUserCounter` not `handleCounter`)
- **Early returns**: use guard clauses to reduce nesting
- **Pure functions**: prefer functions without side effects when possible

### Error Handling
- **Fail fast**: validate inputs early and throw meaningful errors
- **Graceful degradation**: handle edge cases without crashing the system
- **Consistent error format**: use structured error objects with context
- **Never swallow errors**: always log or propagate errors appropriately

### Code Structure
- **Type safety**: use proper TypeScript types, avoid `any`
- **Constants**: extract magic numbers/strings into named constants
- **Configuration**: move hardcoded values to environment variables or config files
- **Separation of concerns**: separate business logic from I/O operations
- **Modular design**: group related functionality into cohesive modules

### Testing
- **Testable code**: write functions that are easy to test in isolation
- **Edge cases**: always test boundary conditions and error paths
- **Mock external dependencies**: use mocks for external services (KV, DB, API)
- **Descriptive test names**: explain what scenario is being tested

### Documentation
- **JSDoc for public APIs**: document function purpose, parameters, and return values
- **Complex logic**: add comments explaining WHY, not WHAT
- **README updates**: document any new features or breaking changes
- **Code examples**: provide usage examples for complex functions

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

@RTK.md
