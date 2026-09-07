import { describe, expect, it } from 'vitest';
import { detectLocalProfanity } from '../src/features/profanity/local-detector';

describe('local profanity detector — себе / Себастьян false positives', () => {
  describe('false positives that must not be flagged', () => {
    it('does not flag "себе"', () => {
      const result = detectLocalProfanity('представь себе');

      expect(result.hasProfanity).toBe(false);
      expect(result.words).toEqual([]);
    });

    it('does not flag "себе" in a sentence', () => {
      const result = detectLocalProfanity('я купил себе кофе');

      expect(result.hasProfanity).toBe(false);
      expect(result.words).toEqual([]);
    });

    it('does not flag "к себе" (local-only short-message branch)', () => {
      const result = detectLocalProfanity('к себе');

      expect(result.hasProfanity).toBe(false);
      expect(result.words).toEqual([]);
    });

    it('does not flag "Себастьян"', () => {
      const result = detectLocalProfanity('привет себастьян');

      expect(result.hasProfanity).toBe(false);
      expect(result.words).toEqual([]);
    });

    it('does not flag inflected Себастьян forms', () => {
      const forms = [
        'себастьяна',
        'себастьяну',
        'себастьяном',
        'себастьяне',
        'себастьяны',
        'себастьянов',
        'себастьянова',
      ];

      for (const form of forms) {
        const result = detectLocalProfanity(form);

        expect(result.hasProfanity, `expected "${form}" not to be flagged`).toBe(false);
        expect(result.words, `expected "${form}" not to produce words`).toEqual([]);
      }
    });
  });

  describe('true positives preserved by the fix', () => {
    it('still detects "заебал"', () => {
      const result = detectLocalProfanity('заебал');

      expect(result.hasProfanity).toBe(true);
      expect(result.words).toEqual([
        { word: 'заебал', baseForm: 'ебать', count: 1, confidence: 0.95 },
      ]);
    });

    it('still detects "ебет" (еб + е + consonant)', () => {
      const result = detectLocalProfanity('ебет');

      expect(result.hasProfanity).toBe(true);
      expect(result.words).toEqual([
        { word: 'ебет', baseForm: 'ебать', count: 1, confidence: 0.95 },
      ]);
    });

    it('still detects "ебешь" (еб + е + шь)', () => {
      const result = detectLocalProfanity('ебешь');

      expect(result.hasProfanity).toBe(true);
      expect(result.words).toEqual([
        { word: 'ебешь', baseForm: 'ебать', count: 1, confidence: 0.95 },
      ]);
    });

    it('still detects "себать"-family slang', () => {
      const result = detectLocalProfanity('себать себался себани');

      expect(result.hasProfanity).toBe(true);
      expect(result.words).toEqual([
        { word: 'себать', baseForm: 'ебать', count: 1, confidence: 0.95 },
        { word: 'себался', baseForm: 'ебать', count: 1, confidence: 0.95 },
        { word: 'себани', baseForm: 'ебать', count: 1, confidence: 0.95 },
      ]);
    });

    it('still detects "спиздил" (parallel с prefix on пизда)', () => {
      const result = detectLocalProfanity('спиздил');

      expect(result.hasProfanity).toBe(true);
      expect(result.words).toEqual([
        { word: 'спиздил', baseForm: 'пизда', count: 1, confidence: 0.95 },
      ]);
    });
  });

  describe('corpus regression — true-positive tokens still detected', () => {
    const conjugated: Array<[string, string]> = [
      ['ебать', 'ебать'],
      ['ебал', 'ебать'],
      ['ебала', 'ебать'],
      ['ебали', 'ебать'],
      ['ебу', 'ебать'],
      ['ебет', 'ебать'],
      ['ебешь', 'ебать'],
      ['ебите', 'ебать'],
      ['ебись', 'ебать'],
      ['ебитесь', 'ебать'],
    ];

    const yofForms: Array<[string, string, string]> = [
      ['ебёшь', 'ебешь', 'ебать'],
      ['ебёт', 'ебет', 'ебать'],
      ['ебётся', 'ебется', 'ебать'],
      ['ебаньё', 'ебанье', 'ебать'],
    ];

    const eachDerivative: Array<{ input: string; baseForm: string }> = [
      ['ебань', 'ебать'],
      ['ебанье', 'ебать'],
      ['ебало', 'ебать'],
      ['еблан', 'ебать'],
      ['ебло', 'ебать'],
      ['ебучий', 'ебать'],
      ['ебучка', 'ебать'],
      ['ебатор', 'ебать'],
      ['ебырь', 'ебать'],
    ].map(([input, baseForm]) => ({ input, baseForm }));

    const eachSLang: Array<{ input: string; baseForm: string }> = [
      ['себать', 'ебать'],
      ['себался', 'ебать'],
      ['себани', 'ебать'],
      ['себанул', 'ебать'],
      ['себанулся', 'ебать'],
    ].map(([input, baseForm]) => ({ input, baseForm }));

    const eachParallel: Array<{ input: string; baseForm: string }> = [
      ['спиздил', 'пизда'],
      ['спиздила', 'пизда'],
    ].map(([input, baseForm]) => ({ input, baseForm }));

    const eachConjugated = conjugated.map(([input, baseForm]) => ({
      input,
      expectedWord: input,
      baseForm,
    }));
    const eachYof = yofForms.map(([input, expectedWord, baseForm]) => ({
      input,
      expectedWord,
      baseForm,
    }));

    it.each(eachConjugated)(
      'detects "$input" as "$baseForm"',
      ({ input, expectedWord, baseForm }) => {
        const result = detectLocalProfanity(input);

        expect(result.hasProfanity).toBe(true);
        expect(result.words).toEqual([
          { word: expectedWord, baseForm, count: 1, confidence: 0.95 },
        ]);
      },
    );

    it.each(eachYof)(
      'normalizes "$input" -> "$expectedWord" and detects as "$baseForm"',
      ({ input, expectedWord, baseForm }) => {
        const result = detectLocalProfanity(input);

        expect(result.hasProfanity).toBe(true);
        expect(result.words).toEqual([
          { word: expectedWord, baseForm, count: 1, confidence: 0.95 },
        ]);
      },
    );

    it.each(eachDerivative)(
      'detects derivative "$input" as "$baseForm"',
      ({ input, baseForm }) => {
        const result = detectLocalProfanity(input);

        expect(result.hasProfanity).toBe(true);
        expect(result.words).toEqual([
          { word: input, baseForm, count: 1, confidence: 0.95 },
        ]);
      },
    );

    it.each(eachSLang)(
      'detects с-prefixed slang "$input" as "$baseForm"',
      ({ input, baseForm }) => {
        const result = detectLocalProfanity(input);

        expect(result.hasProfanity).toBe(true);
        expect(result.words).toEqual([
          { word: input, baseForm, count: 1, confidence: 0.95 },
        ]);
      },
    );

    it.each(eachParallel)(
      'detects parallel с-prefixed "$input" as "$baseForm"',
      ({ input, baseForm }) => {
        const result = detectLocalProfanity(input);

        expect(result.hasProfanity).toBe(true);
        expect(result.words).toEqual([
          { word: input, baseForm, count: 1, confidence: 0.95 },
        ]);
      },
    );
  });
});
