import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from "./env";
import { chunkText } from "./utils";

const TELEGRAM_HTML_TAG_RE = /&lt;(\/?)(b|i|u|s|code|pre)&gt;/g;

function restoreTelegramHtmlTags(text: string): string {
  const rangesToRestore = new Set<number>();
  const stack: Array<{ tag: string; index: number }> = [];
  const matches = Array.from(text.matchAll(TELEGRAM_HTML_TAG_RE));

  for (const match of matches) {
    const [, closing, tag] = match;
    const index = match.index ?? 0;

    if (!closing) {
      stack.push({ tag, index });
      continue;
    }

    const opening = stack[stack.length - 1];
    if (opening?.tag !== tag) {
      continue;
    }

    rangesToRestore.add(opening.index);
    rangesToRestore.add(index);
    stack.pop();
  }

  return text.replace(TELEGRAM_HTML_TAG_RE, (match, closing, tag, offset) => {
    if (!rangesToRestore.has(offset)) {
      return match;
    }

    return `<${closing}${tag}>`;
  });
}

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

  // Escape HTML special characters while preserving entities produced by HTMLBuilder.
  result = result.replace(/&(?!(?:amp|lt|gt|quot);|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
  result = result.replace(/</g, '&lt;');
  result = result.replace(/>/g, '&gt;');

  // Restore Telegram HTML tags produced by internal formatters.
  result = restoreTelegramHtmlTags(result);

  return result;
}

export async function sendMessage(env: Env, chatId: number, text: string): Promise<string | void> {
  // In DRY_RUN mode, return the text without sending
  if (env.DRY_RUN) {
    return text;
  }

  const url = `https://api.telegram.org/bot${env.TOKEN}/sendMessage`;
  const formattedText = convertToHtml(text);
  const parts = chunkText(formattedText, TELEGRAM_LIMIT);

  let lastError: Error | null = null;
  let successfulParts = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    try {
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
        const errorMessage = `Telegram API error: ${res.status} - ${err}`;
        lastError = new Error(errorMessage);

        console.error("tg send failed", {
          status: res.status,
          chat: chatId.toString(LOG_ID_RADIX),
          partIndex: i + 1,
          totalParts: parts.length,
          err,
        });

        // For rate limiting, wait and retry once
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000;
          console.log(`Rate limited, waiting ${waitTime}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, waitTime));

          // Retry the same part
          const retryRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: part,
              parse_mode: "HTML"
            }),
          });

          if (retryRes.ok) {
            successfulParts++;
            continue;
          } else {
            const retryErr = await retryRes.text();
            console.error("tg send retry also failed", {
              status: retryRes.status,
              chat: chatId.toString(LOG_ID_RADIX),
              partIndex: i + 1,
              err: retryErr,
            });
          }
        }

        // If this is a critical error or we've failed multiple parts, stop sending
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // Client error (except rate limit) - don't continue
          break;
        }
      } else {
        successfulParts++;
      }
    } catch (error) {
      const e = error as Error;
      lastError = e;
      console.error("tg send network error", {
        chat: chatId.toString(LOG_ID_RADIX),
        partIndex: i + 1,
        totalParts: parts.length,
        error: e.message,
      });

      // For network errors, try to continue with remaining parts
      continue;
    }
  }

  // If no parts were sent successfully, throw the last error
  if (successfulParts === 0 && lastError) {
    throw lastError;
  }

  // Log partial success if some parts failed
  if (successfulParts < parts.length) {
    console.warn("tg send partial success", {
      chat: chatId.toString(LOG_ID_RADIX),
      successfulParts,
      totalParts: parts.length,
      lastError: lastError?.message,
    });
  }
}

export async function sendPhoto(env: Env, chatId: number, url: string): Promise<string | void> {
  // In DRY_RUN mode, return the URL without sending
  if (env.DRY_RUN) {
    return url;
  }

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
