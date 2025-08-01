import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from "./env";
import { chunkText } from "./utils";

// Convert basic markdown to safe MarkdownV2
function sanitizeMarkdown(text: string): string {
  // Use a placeholder-based approach to safely handle markdown
  const BOLD_PLACEHOLDER = '___BOLD_START___';
  const BOLD_END_PLACEHOLDER = '___BOLD_END___';
  
  let result = text;
  
  // First, replace **text** with placeholders
  result = result.replace(/\*\*(.*?)\*\*/g, `${BOLD_PLACEHOLDER}$1${BOLD_END_PLACEHOLDER}`);
  
  // Escape all special MarkdownV2 characters
  result = result.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
  
  // Restore bold formatting with proper MarkdownV2 syntax
  result = result.replace(new RegExp(`${BOLD_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*?)${BOLD_END_PLACEHOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '*$1*');
  
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