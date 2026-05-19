import { describe, expect, it } from 'vitest';
import { criminalPrefilter } from '../src/features/criminal/prefilter';

describe('criminalPrefilter', () => {
  it('queues rough language for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'я ее трахнул',
      previousTexts: ['табуретка опять шатается', 'надо было сильнее ударить по ножке'],
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });

  it('queues profanity without local legal-risk signal for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'какая же херня опять случилась',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });

  it('queues short neutral clarifications for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: '(не штурм)',
      previousTexts: ['не штурм?', 'ага.'],
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });

  it('queues explicit incitement wording for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'пора всех их убивать',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });

  it('queues first-person violence wording for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'я зарезал человека вчера',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });

  it('queues short direct threats for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'убью тебя',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });

  it('queues short slang direct threats for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'я захуярю тебя, мразь!!!',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });

  it('queues long ambiguous messages for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'слушайте, а вот такая ситуация в чате выглядит странно и может быть опасной для людей',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });
});
