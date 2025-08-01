import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from "./env";
import { chunkText } from "./utils";

/**
 * Converts basic markdown to safe MarkdownV2 for Telegram messages.
 * 
 * This function currently supports bold formatting (i.e., **text**) and escapes
 * all special MarkdownV2 characters to prevent formatting issues or injection.
 * 
 * Limitations:
 * - Only bold (**text**) is supported; other markdown features (italic, links, etc.) are not handled.
 * - Nested or overlapping markdown may not be sanitized correctly.
 * - The function does not validate input for length or other Telegram-specific constraints.
 *
 * @param {string} text - The input string containing basic markdown.
 * @returns {string} The sanitized string safe for use with Telegram MarkdownV2.
 */
function sanitizeMarkdown(text: string): string {
  // Use a placeholder-based approach to safely handle markdown
  const BOLD_PLACEHOLDER = '___BOLD_START___';
  const BOLD_END_PLACEHOLDER = '___BOLD_END___';
  
  let result = text;
  
  // First, replace **text** with placeholders (using non-greedy to handle multiple bold sections)
  result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD_PLACEHOLDER}$1${BOLD_END_PLACEHOLDER}`);
  
  // Escape all special MarkdownV2 characters (fix regex character class)
  result = result.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  
  // Helper function to escape regex special characters
  const escapeRegExp = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Restore bold formatting with proper MarkdownV2 syntax
  result = result.replace(
    new RegExp(`${escapeRegExp(BOLD_PLACEHOLDER)}(.*?)${escapeRegExp(BOLD_END_PLACEHOLDER)}`, 'g'),
    '*$1*'
  );
  
  return result;
}

export async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `https://api.telegram.org/bot${env.TOKEN}/sendMessage`;
  const sanitizedText = sanitizeMarkdown(text);
  const parts = chunkText(sanitizedText, TELEGRAM_LIMIT);

  for (const part of parts) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: "MarkdownV2"
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