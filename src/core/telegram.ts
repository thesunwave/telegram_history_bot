import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from "./env";

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

const TELEGRAM_FORMATTING_TAGS = new Set(['b', 'i', 'u', 's', 'code', 'pre']);

function nextUnitEnd(html: string, i: number): number {
  const ch = html[i];
  if (ch === '<') {
    const gt = html.indexOf('>', i);
    return gt === -1 ? i + 1 : gt + 1;
  }
  if (ch === '&') {
    const semi = html.indexOf(';', i);
    return semi !== -1 && semi - i <= 12 ? semi + 1 : i + 1;
  }

  const codeUnit = html.charCodeAt(i);
  if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && i + 1 < html.length) {
    const nextCodeUnit = html.charCodeAt(i + 1);
    if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) return i + 2;
  }
  return i + 1;
}

function applyTag(stack: string[], tag: string): void {
  const m = tag.match(/^<\/?([a-zA-Z][a-zA-Z0-9]*)/);
  if (!m) return;
  const name = m[1].toLowerCase();
  if (!TELEGRAM_FORMATTING_TAGS.has(name)) return;
  if (tag.startsWith('</')) {
    const idx = stack.lastIndexOf(name);
    if (idx !== -1) stack.splice(idx, 1);
  } else {
    stack.push(name);
  }
}

function openTagsBetween(reopened: string[], html: string, start: number, end: number): string[] {
  const stack = [...reopened];
  let i = start;
  while (i < end) {
    const ch = html[i];
    if (ch === '<') {
      const gt = html.indexOf('>', i);
      if (gt === -1 || gt >= end) break;
      applyTag(stack, html.substring(i, gt + 1));
      i = gt + 1;
    } else if (ch === '&') {
      const semi = html.indexOf(';', i);
      i = semi !== -1 && semi < end && semi - i <= 12 ? semi + 1 : i + 1;
    } else {
      i += 1;
    }
  }
  return stack;
}

/**
 * Splits Telegram HTML into chunks of at most `limit` characters (UTF-16 code
 * units), never cutting inside an HTML entity (`&...;`) or a tag (`<...>`),
 * and keeps the Telegram formatting tags (`<b>`, `<i>`, `<u>`, `<s>`, `<code>`,
 * `<pre>`) balanced in every chunk: open tags at a chunk boundary are closed at
 * the end of the chunk and reopened at the start of the next one.
 */
function chunkHtml(html: string, limit: number): string[] {
  if (html.length <= limit) return [html];

  const n = html.length;
  const parts: string[] = [];
  let start = 0;
  let reopened: string[] = [];

  while (start < n) {
    const reopenPrefix = reopened.map(t => `<${t}>`).join('');
    const baseLen = reopenPrefix.length;

    let i = start;
    let stack = [...reopened];
    let bestEnd = -1;
    let bestNewlineEnd = -1;

    while (i < n) {
      const next = nextUnitEnd(html, i);

      if (html[i] === '<') {
        applyTag(stack, html.substring(i, next));
      }

      const contentLen = next - start;
      let closeLen = 0;
      for (const t of stack) closeLen += t.length + 3;

      if (baseLen + contentLen + closeLen <= limit) {
        bestEnd = next;
        if (html.charCodeAt(next - 1) === 10) bestNewlineEnd = next;
      }

      if (baseLen + contentLen > limit) break;
      i = next;
    }

    let end = bestNewlineEnd !== -1 ? bestNewlineEnd : bestEnd;
    if (end === -1) end = nextUnitEnd(html, start);

    const openAtEnd = openTagsBetween(reopened, html, start, end);
    const closeSuffix = [...openAtEnd].reverse().map(t => `</${t}>`).join('');
    parts.push(reopenPrefix + html.substring(start, end) + closeSuffix);

    start = end;
    reopened = openAtEnd;
  }

  return parts.length ? parts : [''];
}

export async function sendMessage(env: Env, chatId: number, text: string): Promise<string | void> {
  // In DRY_RUN mode, return the text without sending
  if (env.DRY_RUN) {
    return text;
  }

  const url = `https://api.telegram.org/bot${env.TOKEN}/sendMessage`;
  const formattedText = convertToHtml(text);
  const parts = chunkHtml(formattedText, TELEGRAM_LIMIT);

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
