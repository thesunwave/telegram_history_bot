import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from "./env";
import { chunkText } from "./utils";

// Escape special characters for MarkdownV2
function escapeMarkdownV2(text: string): string {
  // Characters that need to be escaped in MarkdownV2
  const specialChars = /[_*[\]()~`>#+=|{}.!-]/g;
  return text.replace(specialChars, '\\$&');
}

// Convert basic markdown to safe MarkdownV2
function sanitizeMarkdown(text: string): string {
  // First escape all special characters
  let escaped = escapeMarkdownV2(text);
  
  // Then restore intended formatting patterns
  // Bold: **text** -> *text*
  escaped = escaped.replace(/\\\*\\\*(.*?)\\\*\\\*/g, '*$1*');
  
  // Italic: _text_ -> _text_
  escaped = escaped.replace(/\\_(.*?)\\_/g, '_$1_');
  
  // Bold + Italic: ***text*** -> *_text_*
  escaped = escaped.replace(/\\\*\\\*\\\*(.*?)\\\*\\\*\\\*/g, '*_$1_*');
  
  return escaped;
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
