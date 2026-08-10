# Admin Guide

The admin UI is served by the Worker at `/admin` and uses Telegram Login.

## Setup

Telegram Login requires the bot domain to be configured in BotFather with `/setdomain`.
Use the production admin domain, for example `telegram-history-bot.thesunwave.workers.dev`.

Basic Auth credentials may still exist as an emergency fallback, but chat data APIs require a
verified Telegram session.

Configure fallback credentials before using the page:

```bash
wrangler secret put ADMIN_BASIC_PASSWORD
```

Set `ADMIN_BASIC_USER` as a Worker variable. The password should stay in secrets.

## Usage

1. Open `https://<your-domain>/admin`.
2. Sign in with Telegram Login.
3. Select a chat, then choose `today`, `week`, `month`, or a custom period of up to 90 days.
4. Use the dashboard to view activity, profanity, criminal-code stats, and auto-notification settings.
5. In **"Активность участников"**, any verified member of the selected chat can view the
   aggregate daily activity heatmap. It uses the labels **"Нет активности"**, **"Активен"**,
   and **"Активно общается"**; it never shows message text or raw message, word, or activity
   counts.

Only chats known to the bot are listed. The Worker filters the list with Telegram `getChatMember`,
so the logged-in Telegram user only sees chats where Telegram reports them as a participant.
