import { describe, expect, it } from 'vitest';
import {
  calculateSentenceFromPunishment,
  calculateSentenceFromViolationCount,
  formatSentenceTotal,
  formatSentenceTotalValue,
} from '../src/features/criminal/sentence-calculator';

describe('criminal sentence calculator', () => {
  it('parses numeric maximum prison terms', () => {
    expect(
      calculateSentenceFromPunishment('лишение свободы на срок до 15 лет')
    ).toEqual({ totalYears: 15, lifeSentences: 0 });
  });

  it('parses Russian word ranges and takes maximum', () => {
    expect(
      calculateSentenceFromPunishment('лишение свободы на срок от восьми до пятнадцати лет')
    ).toEqual({ totalYears: 15, lifeSentences: 0 });
  });

  it('multiplies parsed terms by violation count', () => {
    expect(calculateSentenceFromViolationCount({
      article: '228',
      subarticle: null,
      articleTitle: 'Наркотики',
      punishment: 'лишение свободы на срок до трех лет',
      count: 2,
      averageSeverity: 7,
    })).toEqual({ totalYears: 6, lifeSentences: 0 });
  });

  it('ignores non-prison penalties', () => {
    expect(
      calculateSentenceFromPunishment('штраф до 300000 рублей или обязательные работы на срок до ста часов')
    ).toEqual({ totalYears: 0, lifeSentences: 0 });
  });

  it('ignores restriction of liberty when there is no imprisonment term', () => {
    expect(
      calculateSentenceFromPunishment('ограничение свободы на срок до трех лет')
    ).toEqual({ totalYears: 0, lifeSentences: 0 });
  });

  it('counts life sentences separately', () => {
    expect(
      calculateSentenceFromPunishment('пожизненное лишение свободы')
    ).toEqual({ totalYears: 0, lifeSentences: 1 });
  });

  it('counts life sentences in the instrumental form used by stored statute text', () => {
    expect(
      calculateSentenceFromPunishment('пожизненным лишением свободы')
    ).toEqual({ totalYears: 0, lifeSentences: 1 });
  });

  it('counts life sentences alongside a determinate term in a verbatim sanction clause', () => {
    const clause =
      'наказывается лишением свободы на срок от восьми до двадцати лет с ограничением свободы на срок от одного года до двух лет, либо пожизненным лишением свободы, либо смертной казнью';
    expect(calculateSentenceFromPunishment(clause)).toEqual({
      totalYears: 20,
      lifeSentences: 1,
    });
    expect(formatSentenceTotal(calculateSentenceFromPunishment(clause)))
      .toBe('напиздел на 20 лет и 1 пожизненное');
  });

  it('does not infer prison terms from article number fallbacks', () => {
    expect(calculateSentenceFromViolationCount({
      article: '119',
      subarticle: null,
      articleTitle: 'Угроза убийством или причинением тяжкого вреда здоровью',
      punishment: 'обязательные работы',
      count: 1,
      averageSeverity: 6,
    })).toEqual({ totalYears: 0, lifeSentences: 0 });
  });

  it('formats totals for report lines', () => {
    expect(formatSentenceTotal({ totalYears: 42, lifeSentences: 3 }))
      .toBe('напиздел на 42 года и 3 пожизненных');
    expect(formatSentenceTotalValue({ totalYears: 0, lifeSentences: 0 }))
      .toBe('срок не распознан');
  });
});
