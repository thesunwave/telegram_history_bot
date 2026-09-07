/**
 * Regression tests for sendMessage HTML-aware chunking.
 *
 * These tests drive the real sendMessage pipeline (convertToHtml -> chunkHtml ->
 * fetch body with parse_mode:"HTML") with a mocked fetch that records every
 * outbound request body, so the exact strings Telegram would receive are
 * captured. They reproduce the failure modes described in the bug report:
 *   - a 4096 boundary landing inside a `<b>...</b>` pair produced by convertToHtml
 *   - a 4096 boundary slicing inside an `&...;` entity
 *   - Telegram returning HTTP 400 for a malformed chunk aborting remaining parts
 * and assert that the fix produces balanced, valid HTML in every chunk and
 * delivers the full message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/core/telegram';
import type { Env } from '../src/core/env';
import { MessageFormatter } from '../src/core/message-formatter';
import type { UserStats } from '../src/core/models/statistics';
import type { ViolationCount } from '../src/core/models/statistics';

const TELEGRAM_LIMIT = 4096;
const env = { TOKEN: 'test-token' } as Env;
// Plaintext "<script>" -> convertToHtml -> escaped entity "<script>".
const ENTITY_SCRIPT = '&' + 'lt;script' + '&' + 'gt;';

function getBodies(): string[] {
  const fetchMock = vi.mocked(fetch);
  return fetchMock.mock.calls.map(call => {
    const init = call[1];
    return JSON.parse(init?.body as string).text as string;
  });
}

/**
 * A faithful stand-in for Telegram's HTML parser: a chunk is "valid" iff every
 * supported formatting tag is balanced and no entity (`&...;`) or tag (`<...>`)
 * is split by the chunk boundary.
 */
function isValidTelegramHtml(text: string): boolean {
  const stack: string[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '&') {
      const semi = text.indexOf(';', i);
      if (semi === -1) return false;
      i = semi + 1;
      continue;
    }

    if (text[i] === '<') {
      const gt = text.indexOf('>', i);
      if (gt === -1) return false;

      const tag = text.slice(i, gt + 1);
      const match = tag.match(/^<(\/?)(b|i|u|s|code|pre)>$/);
      if (!match) return false;

      const [, closing, name] = match;
      if (closing) {
        if (stack.pop() !== name) return false;
      } else {
        stack.push(name);
      }
      i = gt + 1;
      continue;
    }

    i += 1;
  }

  return stack.length === 0;
}

function validatingFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: any, init: any) => {
    const body = JSON.parse(init?.body as string);
    return new Response(null, { status: isValidTelegramHtml(body.text) ? 200 : 400 });
  });
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const codeUnit = text.charCodeAt(i);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('sendMessage HTML-aware chunking', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not split a <b> tag pair across the 4096 boundary', async () => {
    const input = 'x'.repeat(4093) + '**bold**' + 'tail';
    await sendMessage(env, 123, input);

    const bodies = getBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect(isValidTelegramHtml(body)).toBe(true);
    }

    // The `bold` text and its wrapping <b></b> must remain in the same chunk.
    const chunkWithBold = bodies.find(b => b.includes('bold'));
    expect(chunkWithBold).toBeDefined();
    expect(chunkWithBold).toContain('<b>bold</b>');
    expect(chunkWithBold).not.toMatch(/<b>[^<]*$/); // no dangling open tag at end
  });

  it('does not split an < entity across the 4096 boundary', async () => {
    const input = 'x'.repeat(4093) + '<script>' + 'more';
    await sendMessage(env, 123, input);

    const bodies = getBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect(isValidTelegramHtml(body)).toBe(true);
    }
    // The escaped entity must arrive intact in some chunk, never split mid-entity.
    expect(bodies.some(b => b.includes(ENTITY_SCRIPT))).toBe(true);
    expect(bodies.some(b => /&$/.test(b))).toBe(false); // no chunk ends with a bare '&'
    expect(bodies.some(b => /^;/.test(b))).toBe(false); // no chunk starts with an orphan ';'
  });

  it('delivers every part when Telegram rejects malformed HTML only (no 400)', async () => {
    vi.restoreAllMocks();
    validatingFetch();

    const input = 'x'.repeat(4093) + '**bold**' + 'tail';
    await expect(sendMessage(env, 123, input)).resolves.toBeUndefined();

    const bodies = getBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    // Every chunk is valid, so Telegram (the validating mock) returned 200 for
    // each and the loop did not break on a 400. No retries occurred (no 429).
    expect(vi.mocked(fetch).mock.calls.length).toBe(bodies.length);
    for (const body of bodies) {
      expect(isValidTelegramHtml(body)).toBe(true);
    }
  });

  it('keeps nested formatting tags balanced across the boundary', async () => {
    const input = 'a'.repeat(4080) + '<b><i>' + 'b'.repeat(100) + '</i></b>';
    await sendMessage(env, 123, input);

    const bodies = getBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect(isValidTelegramHtml(body)).toBe(true);
    }
  });

  it('does not split an emoji surrogate pair across chunks', async () => {
    const input = 'x'.repeat(4095) + '😀tail';
    await sendMessage(env, 123, input);

    const bodies = getBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect(hasLoneSurrogate(body)).toBe(false);
    }
  });

  it('chunks a realistic MessageFormatter stats output into valid parts', async () => {
    vi.restoreAllMocks();
    validatingFetch();

    const violations: ViolationCount[] = [];
    for (let k = 0; k < 60; k++) {
      violations.push({
        article: `${100 + k}`,
        subarticle: k % 2 === 0 ? '1' : null,
        articleTitle: `Возбуждение ненависти либо вражды, а равно унижение человеческого достоинства группа ${k}`,
        punishment: 'штраф в размере от ста тысяч до трехсот тысяч рублей либо лишение свободы на срок до пяти лет',
        count: 1 + (k % 9),
        averageSeverity: 4 + (k % 6),
      });
    }
    const stats: UserStats = {
      userId: 'user123',
      chatId: 'chat456',
      totalViolations: violations.reduce((s, v) => s + v.count, 0),
      violationsByArticle: violations,
      averageSeverity: 6.4,
      riskLevel: 'high',
      lastViolationDate: new Date('2024-01-15'),
      mostCommonViolation: '282',
    };

    const formatter = new MessageFormatter();
    const formatted = formatter.formatUserStats(stats);
    expect(formatted.length).toBeGreaterThan(TELEGRAM_LIMIT);

    await expect(sendMessage(env, 123, formatted)).resolves.toBeUndefined();

    const bodies = getBodies();
    expect(bodies.length).toBeGreaterThanOrEqual(2);
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect(isValidTelegramHtml(body)).toBe(true);
    }
    // Every fetch succeeded (no 400-induced break/retry), so the number of
    // fetch calls equals the number of chunks.
    expect(vi.mocked(fetch).mock.calls.length).toBe(bodies.length);

    // The visible text (tags stripped) is preserved end-to-end across chunks.
    const stripTags = (s: string) => s.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*>/g, '');
    const visibleSent = bodies.map(stripTags).join('');
    const visibleExpected = stripTags(
      // Re-derive the converted HTML the same way sendMessage does.
      formatted
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/&(?!(?:amp|lt|gt|quot);|#\d+;|#x[0-9a-fA-F]+;)/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>'),
    ).replace(/<\/?[a-zA-Z][a-zA-Z0-9]*>/g, '');
    expect(visibleSent).toBe(visibleExpected);
  });
});
