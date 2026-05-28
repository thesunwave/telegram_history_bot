import { describe, expect, it } from 'vitest';
import { detectLocalProfanity } from '../src/features/profanity/local-detector';

describe('detectLocalProfanity', () => {
  it('detects one-word profanity', () => {
    const result = detectLocalProfanity('пиздец');

    expect(result.hasProfanity).toBe(true);
    expect(result.words).toEqual([
      { word: 'пиздец', baseForm: 'пизда', count: 1, confidence: 0.95 },
    ]);
  });

  it('does not detect short neutral words', () => {
    const result = detectLocalProfanity('привет');

    expect(result.hasProfanity).toBe(false);
    expect(result.words).toEqual([]);
  });

  it('aggregates repeated word forms without collapsing variants', () => {
    const result = detectLocalProfanity('заебал, ебаный день, заебал');

    expect(result.words).toEqual([
      { word: 'заебал', baseForm: 'ебать', count: 2, confidence: 0.95 },
      { word: 'ебаный', baseForm: 'ебать', count: 1, confidence: 0.95 },
    ]);
  });

  it('does not flag similar safe words', () => {
    const result = detectLocalProfanity('блин херня тебе ребята');

    expect(result.hasProfanity).toBe(false);
    expect(result.words).toEqual([]);
  });
});
