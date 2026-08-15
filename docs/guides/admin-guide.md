# Admin Guide

The admin UI is served by the Worker at `/admin` and uses Telegram Login.

## Setup

Telegram Login requires the bot domain to be configured in BotFather with `/setdomain`.
Use the production admin domain, for example `telegram-history-bot.thesunwave.workers.dev`.

The public template does not use Basic Auth. Authentication and chat authorization both require a
verified Telegram session.

## Usage

1. Open `https://<your-domain>/admin`.
2. Sign in with Telegram Login.
3. For a new installation, open `/admin/setup`, connect the canonical Telegram webhook, and review
   the summary provider instructions. The setup page never accepts or stores API keys.
4. Select a chat, then choose `today`, `week`, `month`, or a custom period of up to 90 days.
5. Use the dashboard to view activity, profanity, criminal-code stats, and auto-notification settings.
6. In **"Ритм участников"**, any verified member of the selected chat can compare each
   participant's typical activity by weekday and by **night, morning, day, and evening** (UTC).
   Select a participant to see the same qualitative pattern by date. The view uses only
   **"Нет активности"**, **"Активен"**, and **"Активно общается"**; it never shows message
   text or raw message, word, or activity counts.

Only chats known to the bot are listed. The Worker filters the list with Telegram `getChatMember`,
so the logged-in Telegram user only sees chats where Telegram reports them as a participant.
