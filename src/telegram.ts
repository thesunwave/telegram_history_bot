import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from "./env";
import { chunkText } from "./utils";

/**
 * Converts basic markdown to HTML for Telegram messages.
 * 
 * This function supports bold formatting (**text**) and converts it to HTML tags.
 * Much simpler and more reliable than MarkdownV2.
 *
 * @param {string} text - The input string containing basic markdown.
 * @returns {string} The text with HTML formatting for Telegram.
 */
function convertToHtml(text: string): string {
  let result = text;
  
  // Convert **text** to <b>text</b>
  result = result.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  
  // Escape HTML special characters (except our bold tags)
  result = result.replace(/&/g, '&amp;');
  result = result.replace(/</g, '&lt;');
  result = result.replace(/>/g, '&gt;');
  
  // Restore our bold tags
  result = result.replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/g, '<b>$1</b>');
  
  return result;
}

export async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${env.TOKEN}/sendMessage`;
  const formattedText = convertToHtml(text);
  const parts = chunkText(formattedText, TELEGRAM_LIMIT);

  for (const part of parts) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: "HTML"
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("tg send", {
        status: res.status,
        chat: chatId.toString(LOG_ID_RADIX),
        err,
      });
      break;
    }
  }
}

export async function sendPhoto(env: Env, chatId: number, url: string) {
  const api = `https://api.telegram.org/bot${env.TOKEN}/sendPhoto`;
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, photo: url }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('tg sendPhoto', {
      status: res.status,
      chat: chatId.toString(LOG_ID_RADIX),
      err,
    });
  }
}