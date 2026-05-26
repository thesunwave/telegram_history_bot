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
2. Enter the Basic Auth username and password.
3. Select a chat from the list, then choose `today`, `week`, or `month`.
4. Use the dashboard to view activity, profanity, criminal-code stats, and auto-notification settings.

Only chats known to the bot are listed. The Worker filters the list with Telegram `getChatMember`,
so the logged-in Telegram user only sees chats where Telegram reports them as a participant.
