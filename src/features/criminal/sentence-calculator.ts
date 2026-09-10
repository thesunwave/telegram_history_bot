import type { ViolationCount } from '../../core/models/statistics';

export interface SentenceTotal {
  totalYears: number;
  lifeSentences: number;
}

const ZERO_TOTAL: SentenceTotal = {
  totalYears: 0,
  lifeSentences: 0,
};

const NUMBER_WORDS: Record<string, number> = {
  ноль: 0,
  один: 1,
  одного: 1,
  одной: 1,
  одно: 1,
  два: 2,
  двух: 2,
  две: 2,
  три: 3,
  трех: 3,
  трёх: 3,
  четыре: 4,
  четырех: 4,
  четырёх: 4,
  пять: 5,
  пяти: 5,
  шесть: 6,
  шести: 6,
  семь: 7,
  семи: 7,
  восемь: 8,
  восьми: 8,
  девять: 9,
  девяти: 9,
  десять: 10,
  десяти: 10,
  одиннадцать: 11,
  одиннадцати: 11,
  двенадцать: 12,
  двенадцати: 12,
  тринадцать: 13,
  тринадцати: 13,
  четырнадцать: 14,
  четырнадцати: 14,
  пятнадцать: 15,
  пятнадцати: 15,
  шестнадцать: 16,
  шестнадцати: 16,
  семнадцать: 17,
  семнадцати: 17,
  восемнадцать: 18,
  восемнадцати: 18,
  девятнадцать: 19,
  девятнадцати: 19,
  двадцать: 20,
  двадцати: 20,
  тридцать: 30,
  тридцати: 30,
  сорок: 40,
  сорока: 40,
  пятьдесят: 50,
  пятидесяти: 50,
  шестьдесят: 60,
  шестидесяти: 60,
  семьдесят: 70,
  семидесяти: 70,
  восемьдесят: 80,
  восьмидесяти: 80,
  девяносто: 90,
  девяноста: 90,
  сто: 100,
  ста: 100,
};

const NUMBER_TOKEN = '(?:\\d+(?:[.,]\\d+)?|[а-яё]+(?:\\s+[а-яё]+){0,3})';
const YEAR_UNIT = '(?:лет|года|год)';
const IMPRISONMENT_CONTEXT =
  '(?:лишени[ея]\\s+свободы|лишением\\s+свободы|колони[ияю]|заключени[ея])';

/**
 * Parses a punishment string into the maximum imprisonment term in years.
 * Non-prison penalties are ignored, and life sentences are counted separately.
 */
export function calculateSentenceFromPunishment(punishment: string): SentenceTotal {
  const normalized = normalizePunishment(punishment);
  if (!normalized) return { ...ZERO_TOTAL };

  const lifeSentences = /пожизненн(?:ое|ого|ым|ому|ая|ую)\s+(?:лишени[ея]|лишением)\s+свободы/i
    .test(normalized)
    ? 1
    : 0;

  const yearMatches = [
    ...extractYearTerms(normalized, `от\\s+${NUMBER_TOKEN}\\s+до\\s+(${NUMBER_TOKEN})\\s+${YEAR_UNIT}`),
    ...extractYearTerms(normalized, `до\\s+(${NUMBER_TOKEN})\\s+${YEAR_UNIT}`),
    ...extractYearTerms(normalized, `на\\s+срок\\s+(${NUMBER_TOKEN})\\s+${YEAR_UNIT}`),
    ...extractYearTerms(normalized, `(${NUMBER_TOKEN})\\s+${YEAR_UNIT}\\s+${IMPRISONMENT_CONTEXT}`),
  ];

  return {
    totalYears: yearMatches.length > 0 ? Math.max(...yearMatches) : 0,
    lifeSentences,
  };
}

export function calculateSentenceFromViolationCount(violation: ViolationCount | null | undefined): SentenceTotal {
  if (!violation) return { ...ZERO_TOTAL };

  const count = Number.isFinite(violation.count) ? Math.max(0, Math.floor(violation.count)) : 0;
  const perViolation = calculateSentenceFromPunishment(violation.punishment || '');

  return {
    totalYears: perViolation.totalYears * count,
    lifeSentences: perViolation.lifeSentences * count,
  };
}

export function calculateSentenceFromViolationCounts(
  violations: Array<ViolationCount | null | undefined>
): SentenceTotal {
  return violations.reduce<SentenceTotal>((total, violation) => {
    const sentence = calculateSentenceFromViolationCount(violation);
    return addSentenceTotals(total, sentence);
  }, { ...ZERO_TOTAL });
}

export function addSentenceTotals(first: SentenceTotal, second: SentenceTotal): SentenceTotal {
  return {
    totalYears: first.totalYears + second.totalYears,
    lifeSentences: first.lifeSentences + second.lifeSentences,
  };
}

export function formatSentenceTotal(total: SentenceTotal): string {
  const value = formatSentenceTotalValue(total);
  return value === 'срок не распознан' ? value : `напиздел на ${value}`;
}

export function formatSentenceTotalValue(total: SentenceTotal): string {
  const parts: string[] = [];
  const years = Math.round(total.totalYears * 10) / 10;

  if (years > 0) {
    parts.push(`${formatNumber(years)} ${pluralizeYears(years)}`);
  }

  if (total.lifeSentences > 0) {
    parts.push(`${total.lifeSentences} ${pluralizeLifeSentences(total.lifeSentences)}`);
  }

  return parts.length > 0 ? parts.join(' и ') : 'срок не распознан';
}

function extractYearTerms(value: string, pattern: string): number[] {
  const regexp = new RegExp(pattern, 'gi');
  const terms: number[] = [];

  for (const match of value.matchAll(regexp)) {
    const candidate = parseNumberToken(match[1]);
    if (candidate === null) continue;

    const surroundingText = value.slice(
      Math.max(0, match.index - 80),
      Math.min(value.length, (match.index || 0) + match[0].length + 80),
    );
    if (hasImprisonmentContext(surroundingText)) {
      terms.push(candidate);
    }
  }

  return terms;
}

function hasImprisonmentContext(value: string): boolean {
  return new RegExp(IMPRISONMENT_CONTEXT, 'i').test(value);
}

function parseNumberToken(value: string): number | null {
  const normalized = value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\dа-я.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const rightRangeBoundary = normalized.split(/\s+до\s+/).pop()?.trim() || normalized;

  const numericValue = rightRangeBoundary.match(/\d+(?:[.,]\d+)?/);
  if (numericValue) {
    return Number(numericValue[0].replace(',', '.'));
  }

  const total = rightRangeBoundary
    .split(/[\s-]+/)
    .reduce((sum, word) => sum + (NUMBER_WORDS[word] || 0), 0);

  return total > 0 ? total : null;
}

function normalizePunishment(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function pluralizeYears(value: number): string {
  const integer = Math.floor(Math.abs(value));
  const lastTwo = integer % 100;
  const last = integer % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return 'лет';
  if (last === 1) return 'год';
  if (last >= 2 && last <= 4) return 'года';
  return 'лет';
}

function pluralizeLifeSentences(value: number): string {
  const lastTwo = value % 100;
  const last = value % 10;

  if (lastTwo >= 11 && lastTwo <= 14) return 'пожизненных';
  if (last === 1) return 'пожизненное';
  return 'пожизненных';
}
