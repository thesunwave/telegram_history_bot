import { describe, expect, it } from 'vitest';
import { criminalPrefilter } from '../src/features/criminal/prefilter';

describe('criminalPrefilter', () => {
  it('skips rough language with benign object context', () => {
    const result = criminalPrefilter({
      text: 'я ее трахнул',
      previousTexts: ['табуретка опять шатается', 'надо было сильнее ударить по ножке'],
    });

    expect(result.shouldQueue).toBe(false);
    expect(result.reasons).toContain('benign_object_context');
  });

  it('skips profanity without local legal-risk signal', () => {
    const result = criminalPrefilter({
      text: 'какая же херня опять случилась',
    });

    expect(result.shouldQueue).toBe(false);
    expect(result.reasons).toContain('no_signal');
  });

  it('skips short neutral clarifications', () => {
    const result = criminalPrefilter({
      text: '(не штурм)',
      previousTexts: ['не штурм?', 'ага.'],
    });

    expect(result.shouldQueue).toBe(false);
    expect(result.reasons).toContain('short_neutral');
  });

  it('queues explicit incitement to violence', () => {
    const result = criminalPrefilter({
      text: 'пора всех их убивать',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('incitement');
  });

  it('queues first-person violence admissions', () => {
    const result = criminalPrefilter({
      text: 'я зарезал человека вчера',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('first_person_violence');
  });

  it('queues short direct threats despite short-neutral filtering', () => {
    const result = criminalPrefilter({
      text: 'убью тебя',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('threat_or_violence');
  });

  it('queues long ambiguous messages for semantic prefilter', () => {
    const result = criminalPrefilter({
      text: 'слушайте, а вот такая ситуация в чате выглядит странно и может быть опасной для людей',
    });

    expect(result.shouldQueue).toBe(true);
    expect(result.reasons).toContain('semantic_prefilter');
  });
});
