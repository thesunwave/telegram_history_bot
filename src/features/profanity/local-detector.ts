export interface LocalProfanityWord {
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
  const counts = new Map<string, number>();

  for (const token of tokenize(normalizeProfanityText(text))) {
    const match = PROFANITY_PATTERNS.find(({ pattern }) => pattern.test(token));
    if (!match) {
      continue;
    }
    counts.set(match.baseForm, (counts.get(match.baseForm) || 0) + 1);
  }

  const words = Array.from(counts.entries()).map(([baseForm, count]) => ({
    baseForm,
    count,
    confidence: 0.95,
  }));

  return {
    hasProfanity: words.length > 0,
    words,
  };
}

function normalizeProfanityText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[aeopcxy]/g, (char) => CYRILLIC_HOMOGLYPHS[char] || char);
}

function tokenize(text: string): string[] {
  return text.match(/[а-я]+/gu) || [];
}
