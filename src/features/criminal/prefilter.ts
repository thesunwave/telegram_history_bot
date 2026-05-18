export type CriminalPrefilterReason =
  | 'command'
  | 'empty'
  | 'too_short'
  | 'short_neutral'
  | 'benign_object_context'
  | 'threat_or_violence'
  | 'incitement'
  | 'extremism_or_terrorism'
  | 'first_person_violence'
  | 'dangerous_instruction'
  | 'semantic_prefilter'
  | 'no_signal';

export interface CriminalPrefilterInput {
  text?: string;
  isCommand?: boolean;
  previousTexts?: string[];
}

export interface CriminalPrefilterResult {
  shouldQueue: boolean;
  reasons: CriminalPrefilterReason[];
}

const MIN_SIGNAL_LENGTH = 8;
const SEMANTIC_PREFILTER_MIN_LENGTH = 48;
const SHORT_NEUTRAL_MAX_LENGTH = 24;

const BENIGN_OBJECT_WORDS = [
  'табурет',
  'табуретку',
  'стул',
  'стулом',
  'диван',
  'стол',
  'шкаф',
  'дверь',
  'машин',
  'комп',
  'код',
  'сервер',
  'бот',
  'игр',
  'предмет',
];

const VIOLENCE_PATTERNS = [
  /(убью|убить|убей|убивай|зарежу|зарезать|пырну|расстреляю|взорву|подожгу|изобью|сломаю\s+.*(?:лицо|руки|ноги|челюсть))/i,
  /(резать|стрелять|вешать|топить|жечь)\s+(?:их|его|ее|её|тебя|вас|людей|человека|чела)/i,
];

const INCITEMENT_PATTERNS = [
  /(надо|нужно|пора|давайте|го|призываю)\s+(?:всех\s+)?(?:их\s+|его\s+|ее\s+|её\s+|людей\s+)?(убивать|резать|бить|жечь|взрывать|травить|изгонять)/i,
  /(смерть|уничтожить|ликвидировать)\s+(?:всем\s+)?[\p{L}\p{N}_-]+/iu,
];

const EXTREMISM_PATTERNS = [
  /(террористическ|теракт|экстремистск|захватить\s+заложник|массов(ый|ое)\s+убийств)/i,
  /(слава\s+террор|поддерживаю\s+террор|оправдываю\s+теракт)/i,
];

const FIRST_PERSON_VIOLENCE_PATTERNS = [
  /(?:^|\s)(я|мы)\s+(убил|убила|убили|зарезал|зарезала|пырнул|пырнула|избил|избила|поджег|поджёг|взорвал|взорвала)/i,
  /(захуярил|захуячил|порезал|пристрелил)\s+(?:чела|человека|его|ее|её|их)/i,
];

const DANGEROUS_INSTRUCTION_PATTERNS = [
  /(как|инструкция|рецепт|схема)\s+.{0,40}(бомб|взрывчат|коктейл[ья]\s+молотова|поджог|оружие)/i,
  /(собрать|сделать|изготовить)\s+.{0,40}(бомбу|взрывчатку|детонатор)/i,
];

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function hasBenignObjectContext(text: string, previousTexts: string[]): boolean {
  const joinedContext = [text, ...previousTexts.slice(-5)].join(' ').toLowerCase();
  const hasRoughSexualVerb = /(трахнул|трахнула|трахнули|выебал|ебанул|херакнул|захуярил)/i.test(text);
  if (!hasRoughSexualVerb) {
    return false;
  }
  return BENIGN_OBJECT_WORDS.some(word => joinedContext.includes(word));
}

function collectLocalRiskReasons(text: string): CriminalPrefilterReason[] {
  const reasons: CriminalPrefilterReason[] = [];

  if (hasAnyPattern(text, VIOLENCE_PATTERNS)) {
    reasons.push('threat_or_violence');
  }
  if (hasAnyPattern(text, INCITEMENT_PATTERNS)) {
    reasons.push('incitement');
  }
  if (hasAnyPattern(text, EXTREMISM_PATTERNS)) {
    reasons.push('extremism_or_terrorism');
  }
  if (hasAnyPattern(text, FIRST_PERSON_VIOLENCE_PATTERNS)) {
    reasons.push('first_person_violence');
  }
  if (hasAnyPattern(text, DANGEROUS_INSTRUCTION_PATTERNS)) {
    reasons.push('dangerous_instruction');
  }

  return reasons;
}

function isShortNeutralMessage(text: string): boolean {
  const normalized = text
    .replace(/[()[\]{}"'«».,!?…:;\\/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized.length <= SHORT_NEUTRAL_MAX_LENGTH;
}

export function criminalPrefilter(input: CriminalPrefilterInput): CriminalPrefilterResult {
  const text = input.text?.trim() || '';

  if (!text) {
    return { shouldQueue: false, reasons: ['empty'] };
  }
  if (input.isCommand || text.startsWith('/')) {
    return { shouldQueue: false, reasons: ['command'] };
  }
  if (text.length < MIN_SIGNAL_LENGTH) {
    return { shouldQueue: false, reasons: ['too_short'] };
  }

  const reasons = collectLocalRiskReasons(text);
  if (reasons.length > 0) {
    return { shouldQueue: true, reasons };
  }

  if (hasBenignObjectContext(text, input.previousTexts || [])) {
    return { shouldQueue: false, reasons: ['benign_object_context'] };
  }

  if (isShortNeutralMessage(text)) {
    return { shouldQueue: false, reasons: ['short_neutral'] };
  }

  if (text.length < SEMANTIC_PREFILTER_MIN_LENGTH) {
    return { shouldQueue: false, reasons: ['no_signal'] };
  }

  return { shouldQueue: true, reasons: ['semantic_prefilter'] };
}
