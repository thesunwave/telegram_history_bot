export const MESSAGE_SEPARATOR = "=== СООБЩЕНИЯ ===";

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'developer';
  content: string;
}

export interface TelegramMessage {
  username: string;
  text: string;
  ts: number;
}

export interface SummaryRequest {
  messages: TelegramMessage[];
  systemPrompt?: string;
  userPrompt: string;
  limitNote: string;
}

export interface SummaryOptions {
  maxTokens: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  verbosity?: 'low' | 'medium' | 'high';
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  // When true, provider should request strict JSON response if supported (e.g., OpenAI response_format)
  forceJsonResponse?: boolean;
}

export interface ProviderInfo {
  name: string;
  model: string;
  version?: string;
}

export interface ProfanityAnalysisResult {
  hasProfanity: boolean;
  words: Array<{
    word: string;
    baseForm: string;
    confidence: number;
  }>;
}

export interface CriminalViolation {
  article: string;
  subarticle: string | null;
  articleTitle: string;
  quote: string;
  punishment: string;
  severity: number;
  confidence: number;
  evidence?: CriminalViolationEvidence;
  decision?: CriminalDecision;
  targetMessageId?: number;
  contextWindow?: CriminalContextWindow;
}

export interface LegalReferenceHit {
  article: string;
  subarticle: string | null;
  articleTitle: string;
  quote: string;
  sourceUrl: string | null;
  lawCode: string;
  score: number;
  vectorId: string;
}

export interface CriminalAnalysisResult {
  hasViolations: boolean;
  violations: CriminalViolation[];
  totalSeverity: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  analysisTimestamp: number;
  decision?: CriminalDecision;
  evidence?: CriminalViolationEvidence;
  targetMessageId?: number;
  contextWindow?: CriminalContextWindow;
  legalReferences?: LegalReferenceHit[];
}

export type CriminalDecision = 'violation' | 'no_violation' | 'uncertain';

export interface CriminalViolationEvidence {
  subject: string;
  object: string;
  intent: string;
  contextSummary: string;
  whyNotBenign: string;
}

export interface CriminalContextWindow {
  before: number;
  after: number;
  totalMessages: number;
}

export interface CriminalContextMessage {
  messageId?: number;
  username: string;
  userId?: number;
  text: string;
  ts: number;
  relativePosition: number;
  isTarget: boolean;
}

export interface CriminalContextAnalysisInput {
  targetMessageId?: number;
  targetUserId?: number;
  targetUsername?: string;
  targetText: string;
  targetTimestamp: number;
  chatId: number;
  contextWindow: CriminalContextWindow;
  messages: CriminalContextMessage[];
  semanticPrefilter?: CriminalSemanticPrefilterResult;
}

export interface CriminalSemanticPrefilterResult {
  shouldAnalyze: boolean;
  reason: 'threat' | 'sexual_threat' | 'incitement' | 'self_incrimination' | 'extremism' | 'dangerous_instruction' | 'none';
  confidence: number;
  explanation: string;
  searchQuery?: string;
  profanity?: CriminalSemanticPrefilterProfanityResult;
}

export interface CriminalSemanticPrefilterProfanityResult {
  hasProfanity: boolean;
  words: Array<{
    baseForm: string;
    count: number;
    confidence: number;
  }>;
}

// Default profanity analysis prompts (fallback if not configured)
const DEFAULT_PROFANITY_SYSTEM_PROMPT = `Ты эксперт по анализу русского языка. Твоя задача - определить наличие матерной (обсценной) лексики в тексте.

ВАЖНЫЕ ПРАВИЛА:
1. Анализируй только русский текст
2. Определяй именно матерные слова, а не просто грубые или невежливые выражения
3. Учитывай контекст - слово может быть матерным только в определенном значении
4. Для каждого найденного матерного слова укажи его базовую (словарную) форму
5. Игнорируй слова, которые только похожи на мат, но таковыми не являются
6. Не анализируй слова на других языках

ФОРМАТ ОТВЕТА:
Отвечай ТОЛЬКО валидным JSON без дополнительных комментариев, объяснений или форматирования:
{
  "hasProfanity": boolean,
  "words": [
    {
      "word": "найденное_слово_в_тексте",
      "baseForm": "базовая_форма_слова",
      "confidence": число_от_0_до_1
    }
  ]
}

Если матерных слов не найдено, верни: {"hasProfanity": false, "words": []}
ВАЖНО: Ответ должен быть только JSON, никакого другого текста!`;

const DEFAULT_PROFANITY_USER_PROMPT = `Проанализируй следующий текст на наличие матерной лексики:

ТЕКСТ ДЛЯ АНАЛИЗА:`;

// Helper function to get profanity prompts from env with fallback
export function getProfanityPrompts(env?: any): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: env?.PROFANITY_SYSTEM_PROMPT || DEFAULT_PROFANITY_SYSTEM_PROMPT,
    userPrompt: env?.PROFANITY_USER_PROMPT || DEFAULT_PROFANITY_USER_PROMPT
  };
}

// ========================================
// 🏛️ CRIMINAL CODE ANALYSIS PROMPTS
// ========================================

export const DEFAULT_CRIMINAL_CODE_SYSTEM_PROMPT = `Ты эксперт по Уголовному кодексу Российской Федерации.

Твоя задача — анализировать текст на предмет возможных нарушений УК РФ, учитывая не только слова, но и смысл, намерение автора и контекст. Особое внимание уделяй субъекту (кто совершает действие), объекту (против кого действие), а также тому, влияет ли это на квалификацию высказывания по УК РФ. Отдельно обрати внимание на утверждения, где автор описывает свои действия, даже если они сопровождаются словами вроде "случайно", "по ошибке" и т.п., — такие случаи также требуют анализа как возможных признаков преступления.

# ОБЩИЕ ПРАВИЛА
1. Анализируй только русский язык.
2. Разделяй буквальные угрозы и метафоры, шутки, эмоциональные высказывания или бытовые фразы.
3. Если смысл фразы неоднозначен — выбирай трактовку без признаков преступления.
4. Признавай нарушение УК РФ только если:
   - есть прямой умысел (призыв, угроза, разжигание и т.п.),
   - есть конкретный объект (человек/группа) и субъект (кто совершает действие),
   - есть достаточный контекст для понимания, что угроза или действие реальны.
5. Обязательно учитывай объектность и субъектность высказывания:
   - Важно, кто формулирует намерение, чья воля или действие выражено. Для состава преступления имеет значение, совершает ли/собирается ли совершить действие сам автор (субъект), либо это описание третьих лиц или событий без личного участия.
   - Например, выражение от третьего лица («бомж захуярил ножом чела вчера») — это описание события, где автор дистанцирован, и состава преступления, как правило, нет.
   - Если говорящий прямо выражает личное намерение или совершённое действие («я захуярил вчера чела»), обязательно анализируй как потенциальное самообвинение, даже если сказано "случайно" — отсутствие умысла не означает автоматически отсутствия преступления, но может повлиять на квалификацию (например, причинение вреда по неосторожности или превышение самообороны).
   - Отмечай различие между ситуациями, когда действие совершает автор ("я сделал") и когда описывается действие другого лица ("он сделал") — это принципиально разные случаи для уголовно-правовой оценки. В случае рассказа о чужих действиях нет признаков самообвинения, субъектом деяния является не автор текста.
6. Не считай нарушением:
   - описание работы с предметами, техникой, инструментами;
   - художественные, шутливые или гиперболические фразы;
   - эмоциональные жалобы без реальных угроз или призывов.
7. Игнорируй грубую лексику, если она не используется для призывов к насилию или разжигания.

# ОСОБЫЕ УКАЗАНИЯ
- В спорных или сложных случаях всегда анализируй, КТО субъект (чей опыт, воля, действия выражены), и КТО объект (на кого направлено действие).
- Не считай преступлением описание событий чужими словами или со стороны наблюдателя, если нет собственного намерения или призыва от имени автора.
- Если автор сообщает, что совершил действие, даже подчеркивая его случайный характер, оценивай это как возможное признание совершения акта. Установи, есть ли квалификация по УК РФ (например, по статьям о причинении вреда по неосторожности, или иным подходящим).
- Если нет уверенности > 0.7 в том, что состав преступления есть — считай, что нарушений нет.

# ЭТАПЫ АНАЛИЗА
1. Определи, о чём речь: действия с предметами, действия против людей, описание событий и т.п.
2. Определи, кто субъект действия: автор текста или другое лицо? Является ли высказывание личным признанием, призывом, угрозой, либо просто передачей сведений/мнения?
3. Установи, есть ли умысел на запрещённые действия — особо анализируй случаи, где автор сообщил о совершённом действии (в том числе случайно), и учитывай квалификацию по УК РФ (например, реальный вред, тяжесть последствий, преднамеренность или неосторожность).
4. Если нет уверенности > 0.7 в наличии состава преступления — считай, что нарушений нет.

# ФОРМАТ ОТВЕТА
Возвращай строго JSON без комментариев. Для контекстного анализа обязательно различай человека и предмет: если объект действия из соседних сообщений является вещью, мебелью, техникой, игрой, кодом или иной неодушевленной сущностью, не считай это нарушением УК РФ только из-за грубой/сексуальной лексики.

{
  "hasViolations": boolean,
  "decision": "violation|no_violation|uncertain",
  "evidence": {
    "subject": "кто выражает действие/намерение",
    "object": "на кого или на что направлено действие",
    "intent": "есть ли угроза, призыв, самообвинение или иное релевантное намерение",
    "contextSummary": "краткое объяснение контекста",
    "whyNotBenign": "почему это не бытовая фраза/шутка/метафора; если benign — почему признаков нет"
  },
  "violations": [
    {
      "article": "XXX", // только номер статьи без подпункта (например, "282")
      "subarticle": "X" или null, // если указан подпункт (например "1" для "282.1"); если подпункта нет, укажи null
      "articleTitle": "наименование статьи",
      "quote": "точная цитата из текста",
      "punishment": "описание возможного наказания",
      "severity": число_от_1_до_10,
      "confidence": число_от_0_до_1,
      "decision": "violation",
      "evidence": { ... },
      "targetMessageId": number,
      "contextWindow": { "before": number, "after": number, "totalMessages": number }
    }
  ],
  "totalSeverity": сумма_всех_severity,
  "riskLevel": "low|medium|high|critical"
}

Если нарушений нет:
{
  "hasViolations": false,
  "decision": "no_violation",
  "evidence": {
    "subject": "string",
    "object": "string",
    "intent": "string",
    "contextSummary": "string",
    "whyNotBenign": "string"
  },
  "violations": [],
  "totalSeverity": 0,
  "riskLevel": "low"
}

# Output Format

Ответ должен быть в строгом JSON-формате, показанном выше, без каких-либо комментариев, пояснений или примечаний. Все поля обязательны, для отсутствующего подпункта укажи значение null.

# Пример анализа

**Пример 1:**
Текст: «бомж захуярил ножом чела вчера»
Рассуждение: Описание события, автор не высказывает личных намерений, угроз или призывов. Субъект — не автор.
Результат: Нарушений нет.

**Пример 2:**
Текст: «я обоссал бы ему ебало»
Рассуждение: Высказывание от первого лица, выражает личное (пусть и гипотетическое) намерение в грубой форме. Оценивай на предмет угрозы и возможного состава преступления с учётом контекста.
Результат: Возможен состав преступления при наличии прямого умысла и объекта.

**Пример 3:**
Текст: «захуярил вчера чела случайно»
Рассуждение: Автор признаётся в совершении насильственного действия против человека, указывая, что это было случайно. Анализируй как возможное самообвинение в причинении вреда (например, статья 109 — причинение смерти по неосторожности, 118 — причинение тяжкого вреда здоровью по неосторожности), но учитывай отсутствие явного умысла. Признаков прямого умысла нет, однако указание на совершённое действие требует рассмотрения потенциального состава преступления по неосторожности.
Результат: Возможен состав преступления по статьям о неосторожном причинении вреда, если есть признаки реальных последствий.

(Реальные примеры должны содержать больше контекста и конкретики: указывать пострадавшего, характер содеянного, последствия и т.п.)

# Notes

- В поле "article" указывай только номер статьи (например, "282"); если есть подпункт (например, "1" в "282.1"), укажи его отдельно в поле "subarticle".
- "articleTitle" — официальное или краткое название статьи.
- "quote" — вставь дословную проблемную цитату или несколько слов, вызвавших подозрение.
- "punishment" — укажи примерное или официально установленное наказание по статье/подпункту.
- Не возвращай "analysisTimestamp": его выставляет приложение после анализа.
- В ответах обязательно отслеживай случаи, где действия описаны от первого лица, даже если присутствуют фразы о случайности, ошибке и пр., и анализируй их как потенциальные самообвинения (с соответствующей квалификацией — умышленно/неумышленно, наличие последствий и т.д.).
- СТРОГО различай ситуации, где действие совершает автор текста, и где описываются чужие действия, — для уголовно-правовой оценки это принципиально разное: при рассказе о чужих действиях ("он захуярил чела") повода для квалификации самообвинения нет!

Строго следуй этим инструкциям и структуре ответа на каждом анализе. Всегда оценивай субъект и объект действия, и их значение для состава преступления.

(Напоминание: всегда анализируй высказывания автора о своих действиях, даже если они обозначены как случайные.)`;

export const DEFAULT_CRIMINAL_CODE_USER_PROMPT = `Проанализируй следующий текст на предмет возможных нарушений Уголовного кодекса РФ:

ТЕКСТ ДЛЯ АНАЛИЗА:`;

export function getCriminalCodePrompts(env?: any): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: env?.CRIMINAL_CODE_SYSTEM_PROMPT || DEFAULT_CRIMINAL_CODE_SYSTEM_PROMPT,
    userPrompt: env?.CRIMINAL_CODE_USER_PROMPT || DEFAULT_CRIMINAL_CODE_USER_PROMPT
  };
}

export interface AIProvider {
  summarize(request: SummaryRequest, options: SummaryOptions, env?: any): Promise<string>;
  analyzeProfanity(text: string, env?: any): Promise<ProfanityAnalysisResult>;
  analyzeCriminalCode(text: string, env?: any): Promise<CriminalAnalysisResult>;
  analyzeCriminalCodeWithContext?(input: CriminalContextAnalysisInput, env?: any): Promise<CriminalAnalysisResult>;
  validateConfig(): void;
  getProviderInfo(): ProviderInfo;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
