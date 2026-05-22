import { describe, expect, it } from 'vitest';
import { detectLocalProfanity } from '../src/features/profanity/local-detector';

describe('detectLocalProfanity', () => {
  it('detects one-word profanity', () => {
    const result = detectLocalProfanity('пиздец');

    expect(result.hasProfanity).toBe(true);
    expect(result.words).toEqual([
      { baseForm: 'пизда', count: 1, confidence: 0.95 },
    ]);
  });

  it('does not detect short neutral words', () => {
    const result = detectLocalProfanity('привет');

    expect(result.hasProfanity).toBe(false);
    expect(result.words).toEqual([]);
  });

  it('aggregates repeated base forms', () => {
    const result = detectLocalProfanity('заебал, ебаный день, заебал');

    expect(result.words).toEqual([
      { baseForm: 'ебать', count: 3, confidence: 0.95 },
    ]);
  });

  it('does not flag similar safe words', () => {
    const result = detectLocalProfanity('блин херня тебе ребята');

    expect(result.hasProfanity).toBe(false);
    expect(result.words).toEqual([]);
  });
});
