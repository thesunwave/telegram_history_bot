import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/core/utils';

interface TelegramMessage {
  username: string;
  text: string;
  ts: number;
}

function codePoints(s: string): number {
  return Array.from(s).length;
}

function createMessagesFromText(text: string): TelegramMessage[] {
  const lines = text.split('\n');
  return lines.map((line, index) => {
    const colonIndex = line.indexOf(': ');
    if (colonIndex > 0) {
      return {
        username: line.substring(0, colonIndex),
        text: line.substring(colonIndex + 2),
        ts: index,
      };
    } else {
      return { username: 'unknown', text: line, ts: index };
    }
  });
}

describe('chunkText', () => {
  it('returns [""] for empty input rather than [] (sendMessage relies on never receiving [])', () => {
    expect(chunkText('', 10)).toEqual(['']);
  });

  it('keeps a line whose length equals the limit as a single chunk within the cap', () => {
    const text = 'x'.repeat(4096);
    const parts = chunkText(text, 4096);
    expect(parts).toEqual([text]);
    expect(codePoints(parts[0])).toBe(4096);
  });

  it('never emits a chunk longer than the limit when chunking multi-line input', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `user_${i}: message ${i}`);
    const parts = chunkText(lines.join('\n'), 80);
    for (const part of parts) {
      expect(codePoints(part)).toBeLessThanOrEqual(80);
    }
  });

  it('hard-splits a single over-limit line by code points and rejoins losslessly', () => {
    const text = 'x'.repeat(5000);
    const parts = chunkText(text, 4096);
    expect(parts.length).toBe(Math.ceil(text.length / 4096));
    for (const part of parts) {
      expect(codePoints(part)).toBeLessThanOrEqual(4096);
    }
    expect(parts.join('')).toBe(text);
  });

  it('hard-splits an over-limit line after flushing a preceding line', () => {
    const parts = chunkText(`short\n${'x'.repeat(20)}`, 10);
    expect(parts).toEqual(['short', 'x'.repeat(10), 'x'.repeat(10)]);
    for (const part of parts) {
      expect(codePoints(part)).toBeLessThanOrEqual(10);
    }
  });

  it('chunks on newline boundaries so no line is severed and parts.join("\\n") reconstructs the input', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `user_${i % 5}: message number ${i}`);
    const text = lines.join('\n');
    const parts = chunkText(text, 200);
    for (const part of parts) {
      expect(part.startsWith('\n')).toBe(false);
      expect(part.endsWith('\n')).toBe(false);
    }
    expect(parts.join('\n')).toBe(text);
  });

  it('preserves a trailing newline through the join round-trip', () => {
    const text = 'a\nb\n';
    expect(chunkText(text, 100).join('\n')).toBe(text);
  });

  it('counts by code points, not UTF-16 code units, so surrogate pairs stay intact', () => {
    const text = '😀'.repeat(20);
    expect(text.length).toBe(40);
    const parts = chunkText(text, 5);
    for (const part of parts) {
      expect(codePoints(part)).toBeLessThanOrEqual(5);
    }
    expect(parts.join('')).toBe(text);
  });

  it('round-trips a multi-chunk legacy summary transcript without phantom "unknown" users or message loss', () => {
    const messages: TelegramMessage[] = Array.from({ length: 400 }, (_, i) => ({
      username: i % 7 === 0 ? 'user_6' : `user_${i % 5}`,
      text: `short realistic telegram message number ${i + 1} for testing the chunking bug`,
      ts: i,
    }));
    const content = messages.map((m) => `${m.username}: ${m.text}`).join('\n');
    const parts = chunkText(content, 8000);
    expect(parts.length).toBeGreaterThan(1);

    const parsed = parts.flatMap((p) => createMessagesFromText(p));
    expect(parsed.length).toBe(messages.length);
    expect(parsed.filter((m) => m.username === 'unknown')).toEqual([]);
    for (let i = 0; i < messages.length; i++) {
      expect(parsed[i].username).toBe(messages[i].username);
      expect(parsed[i].text).toBe(messages[i].text);
    }
  });
});
