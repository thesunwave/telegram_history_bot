export interface LocalProfanityWord {
  word: string;
  baseForm: string;
  count: number;
  confidence: number;
}

export interface LocalProfanityResult {
  hasProfanity: boolean;
  words: LocalProfanityWord[];
}

const CYRILLIC_HOMOGLYPHS: Record<string, string> = {
  a: 'а',
  e: 'е',
  o: 'о',
  p: 'р',
  c: 'с',
  x: 'х',
  y: 'у',
};

const MIN_PROFANITY_TOKEN_LENGTH = 3;

const PROFANITY_PATTERNS: Array<{ baseForm: string; pattern: RegExp }> = [
  {
    baseForm: 'хуй',
    pattern: /^(?:на|по|под|за|от|до|вы|про|при|пере|с)?ху(?:й|я|е|ё|и|ю|ем|ям|ями|ев|ня|йн|ило|ли|ла|ло|яр)/u,
  },
  {
    baseForm: 'пизда',
    pattern: /^(?:на|по|под|за|от|до|вы|про|при|пере|с)?пизд/u,
  },
  {
    baseForm: 'ебать',
    pattern: /^(?:за|на|по|под|от|до|вы|про|при|пере|с|у|о|об)?еб(?:а|у|е|и|л|н|т|ш|ись|ок|уч|ыр)/u,
  },
  {
    baseForm: 'блядь',
    pattern: /^бля(?:д|т|$)/u,
  },
];

export function detectLocalProfanity(text: string): LocalProfanityResult {
  const counts = new Map<string, { baseForm: string; count: number }>();

  for (const token of tokenizeProfanityText(text)) {
    const match = PROFANITY_PATTERNS.find(({ pattern }) => pattern.test(token));
    if (!match) {
      continue;
    }
    const current = counts.get(token);
    counts.set(token, {
      baseForm: match.baseForm,
      count: (current?.count || 0) + 1,
    });
  }

  const words = Array.from(counts.entries()).map(([word, entry]) => ({
    word,
    baseForm: entry.baseForm,
    count: entry.count,
    confidence: 0.95,
  }));

  return {
    hasProfanity: words.length > 0,
    words,
  };
}

export function canonicalizeLocalProfanityBaseForm(value: string): string | null {
  const result = detectLocalProfanity(value);
  return result.words[0]?.baseForm || null;
}

export function normalizeProfanityText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[aeopcxy]/g, (char) => CYRILLIC_HOMOGLYPHS[char] || char);
}

export function tokenizeProfanityText(text: string): string[] {
  return (normalizeProfanityText(text).match(/[а-я]+/gu) || [])
    .filter(token => token.length >= MIN_PROFANITY_TOKEN_LENGTH);
}

export function normalizeProfanityWord(value: string): string | null {
  const tokens = tokenizeProfanityText(value);
  return tokens.length === 1 ? tokens[0] : null;
}

export function countNormalizedProfanityTokens(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokenizeProfanityText(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}
