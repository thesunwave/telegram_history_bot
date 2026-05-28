# Telegram Stats Bot

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thesunwave/telegram_history_bot)

Self-hosted Telegram stats and summaries bot for private chats and groups. It works like a private Combot: every chat owner deploys their own Cloudflare Worker, and chat data stays in that owner’s Cloudflare account.

For one personal chat or a small/medium group, the default setup is designed to run on Cloudflare Free while you stay within Cloudflare’s published free limits. Heavy traffic, frequent AI summaries, or optional experimental features can exhaust those limits.

## What It Does

- Receives Telegram updates through a webhook.
- Stores recent messages for 7 days in Cloudflare KV/day blocks.
- Counts posts, words, and activity per user.
- Generates daily and on-demand AI summaries with Workers AI.
- Shows top users and activity charts.
- Keeps optional profanity, criminal/legal RAG, OpenAI/OpenRouter, admin UI, and analytics features disabled or optional by default.

## Why This Can Run For $0

The default configuration uses Cloudflare products that include free allocations:

| Cloudflare product | Used for | Official docs |
| --- | --- | --- |
| Workers | Telegram webhook and bot commands | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| KV | 7-day message history and counters/cache | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 | summaries, activity, optional moderation tables | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Durable Objects | consistent counters and day blocks | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Workers AI | summaries in the default provider | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Vectorize | optional legal RAG experiments | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Analytics Engine | optional operational analytics | [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) |

This is not a promise that every deployment costs exactly `$0`. It means the default bot is Free-first and appropriate for normal private-chat usage. Check Cloudflare Billing -> Billable usage after deployment.

## Deploy To Cloudflare

Click the button at the top of this README. Cloudflare will clone the repository, ask for the required secrets, provision configured resources, and deploy the Worker.

Required secrets:

- `TOKEN`: Telegram bot token from BotFather.
- `SECRET`: random webhook secret used by Telegram to authenticate webhook calls.

Generate `SECRET` locally:

```bash
openssl rand -hex 32
```

After deploy, set the Telegram webhook:

```bash
curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://<your-worker>.<your-subdomain>.workers.dev/tg/$TOKEN/webhook" \
  -d "secret_token=$SECRET"
```

Then add the bot to your Telegram chat or group and send `/help`.

## Manual Setup

Install dependencies:

```bash
npm install
```

Create Cloudflare resources and copy generated IDs into `wrangler.jsonc`:

```bash
./setup.sh
```

Set required secrets:

```bash
npx wrangler secret put TOKEN
npx wrangler secret put SECRET
```

Apply D1 migrations and deploy:

```bash
npm run deploy
```

Run locally:

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

## Commands

Core commands:

- `/help`: show commands.
- `/summary <days>`: summarize the last N days, default `1`.
- `/summary_last <n>`: summarize the last N messages, default `100`, max `1000`.
- `/top <n>`: top active users for today, default `5`.
- `/talkers <n> [period]`: top users by words and words/message.
- `/activity_week`: chat activity chart for the week.
- `/activity_month`: chat activity chart for the last 30 days.
- `/activity_users_week`: per-user activity for the week.
- `/activity_users_month`: per-user activity for the last 30 days.
- `/activity_hours <period>`: average activity by hour.

Optional commands are visible in `/help` but may be marked as globally disabled when their feature flags are off:

- profanity tracking: `/profanity_top`, `/profanity_words`, `/my_profanity`;
- legal/criminal analysis: `/criminal_stats`, `/criminal_top`, `/my_criminal`.

## Privacy Model

- The bot is self-hosted in your Cloudflare account.
- Telegram messages are stored with a 7-day TTL by default.
- Summaries are generated through your configured provider. The public default is Workers AI.
- The code must not log full Telegram payloads or full message text.
- `TOKEN`, `SECRET`, and optional provider keys are Cloudflare secrets, not committed files.

## Configuration

The public defaults in `wrangler.jsonc` are conservative:

- `SUMMARY_PROVIDER=cloudflare`
- `ENABLE_SUMMARY=true`
- `ENABLE_ACTIVITY_TRACKING=true`
- `ENABLE_PROFANITY_ANALYSIS=false`
- `ENABLE_CRIMINAL_ANALYSIS=false`
- `DEBUG_LOGS=false`

Optional provider secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
```

Optional legal RAG setup:

```bash
npx wrangler vectorize create telegram-stats-legal-rag --dimensions=1024 --metric=cosine
npm run ingest:legal-rag
```

Only enable legal/criminal analysis after you have configured the optional corpus, Vectorize index, and provider settings.

## Quality Checks

```bash
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir /tmp/telegram-stats-bot-public-audit
```

## Troubleshooting

- Webhook returns `403`: check that `TOKEN` and `SECRET` match the BotFather token and `setWebhook secret_token`.
- Summary fails: check Workers AI availability and free allocation in Cloudflare dashboard.
- Commands work locally but not after deploy: run `npm run deploy` again after setting secrets.
- Billing is not `$0`: inspect Cloudflare Billing -> Billable usage and reduce AI summary frequency or disable optional features.

---

# Telegram Stats Bot (RU)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thesunwave/telegram_history_bot)

Самостоятельно разворачиваемый Telegram-бот для статистики и сводок чата. Идея такая же, как у приватного Combot: каждый владелец чата разворачивает своего бота в своём Cloudflare-аккаунте, а данные чата остаются у него.

Для одного личного чата или небольшой/средней группы базовая конфигурация рассчитана на Cloudflare Free, пока вы укладываетесь в официальные бесплатные лимиты Cloudflare. Очень активные чаты, частые AI-сводки и экспериментальные функции могут эти лимиты исчерпать.

## Что Умеет Бот

- Принимает Telegram updates через webhook.
- Хранит последние сообщения 7 дней в Cloudflare KV/day blocks.
- Считает сообщения, слова и активность по пользователям.
- Генерирует ежедневные и ручные AI-сводки через Workers AI.
- Показывает топы пользователей и графики активности.
- Оставляет расширенные функции отключёнными или опциональными по умолчанию: мат, criminal/legal RAG, OpenAI/OpenRouter, админка, analytics.

## Почему Это Может Стоить $0

Базовая конфигурация использует Cloudflare-сервисы с бесплатными лимитами:

| Cloudflare-сервис | Для чего используется | Официальная документация |
| --- | --- | --- |
| Workers | webhook и команды бота | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| KV | 7-дневная история, счётчики, cache | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 | сводки, активность, опциональные таблицы модерации | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Durable Objects | консистентные счётчики и дневные блоки | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Workers AI | сводки в default provider | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Vectorize | опциональные legal RAG эксперименты | [Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) |
| Analytics Engine | опциональная операционная аналитика | [Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) |

Это не обещание, что любой объём трафика всегда будет стоить `$0`. Это означает, что default-настройка сделана Free-first и подходит для обычного приватного чата. После деплоя проверяйте Cloudflare Billing -> Billable usage.

## Deploy To Cloudflare

Нажмите кнопку Deploy в начале README. Cloudflare склонирует репозиторий, попросит секреты, создаст ресурсы и развернёт Worker.

Обязательные секреты:

- `TOKEN`: токен Telegram-бота из BotFather.
- `SECRET`: случайный webhook secret для проверки запросов от Telegram.

Сгенерировать `SECRET`:

```bash
openssl rand -hex 32
```

После деплоя задайте Telegram webhook:

```bash
curl "https://api.telegram.org/bot$TOKEN/setWebhook" \
  -d "url=https://<your-worker>.<your-subdomain>.workers.dev/tg/$TOKEN/webhook" \
  -d "secret_token=$SECRET"
```

Добавьте бота в чат или группу и отправьте `/help`.

## Ручная Установка

Установите зависимости:

```bash
npm install
```

Создайте ресурсы Cloudflare и перенесите сгенерированные ID в `wrangler.jsonc`:

```bash
./setup.sh
```

Добавьте обязательные секреты:

```bash
npx wrangler secret put TOKEN
npx wrangler secret put SECRET
```

Примените D1 migrations и задеплойте:

```bash
npm run deploy
```

Локальный запуск:

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

## Команды

Основные команды:

- `/help`: список команд.
- `/summary <days>`: сводка за последние N дней, по умолчанию `1`.
- `/summary_last <n>`: сводка последних N сообщений, по умолчанию `100`, максимум `1000`.
- `/top <n>`: топ активных пользователей за сегодня, по умолчанию `5`.
- `/talkers <n> [period]`: топ пользователей по словам и словам/сообщение.
- `/activity_week`: график активности за неделю.
- `/activity_month`: график активности за последние 30 дней.
- `/activity_users_week`: активность по пользователям за неделю.
- `/activity_users_month`: активность по пользователям за последние 30 дней.
- `/activity_hours <period>`: средняя активность по часам.

Опциональные команды видны в `/help`, но будут помечены как глобально отключённые, если соответствующий feature flag выключен:

- мат: `/profanity_top`, `/profanity_words`, `/my_profanity`;
- legal/criminal analysis: `/criminal_stats`, `/criminal_top`, `/my_criminal`.

## Модель Приватности

- Бот self-hosted: работает в вашем Cloudflare-аккаунте.
- Telegram-сообщения хранятся 7 дней по умолчанию.
- Сводки генерируются выбранным provider. Public default использует Workers AI.
- Код не должен логировать полные Telegram payloads или полный текст сообщений.
- `TOKEN`, `SECRET` и опциональные ключи провайдеров хранятся в Cloudflare Secrets и не коммитятся.

## Настройки

Публичные defaults в `wrangler.jsonc`:

- `SUMMARY_PROVIDER=cloudflare`
- `ENABLE_SUMMARY=true`
- `ENABLE_ACTIVITY_TRACKING=true`
- `ENABLE_PROFANITY_ANALYSIS=false`
- `ENABLE_CRIMINAL_ANALYSIS=false`
- `DEBUG_LOGS=false`

Опциональные provider secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENROUTER_API_KEY
```

Опциональный legal RAG:

```bash
npx wrangler vectorize create telegram-stats-legal-rag --dimensions=1024 --metric=cosine
npm run ingest:legal-rag
```

Включайте legal/criminal analysis только после настройки корпуса, Vectorize index и provider settings.

## Проверки

```bash
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir /tmp/telegram-stats-bot-public-audit
```

## Troubleshooting

- Webhook возвращает `403`: проверьте `TOKEN`, `SECRET` и `secret_token` в `setWebhook`.
- Сводка падает: проверьте доступность Workers AI и free allocation в Cloudflare dashboard.
- Локально команды работают, а после deploy нет: повторите `npm run deploy` после добавления secrets.
- Billing не `$0`: проверьте Cloudflare Billing -> Billable usage и уменьшите частоту AI-сводок или отключите optional features.
