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
  quote: string;
  punishment: string;
  severity: number;
  confidence: number;
}

export interface CriminalAnalysisResult {
  hasViolations: boolean;
  violations: CriminalViolation[];
  totalSeverity: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  analysisTimestamp: number;
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

export const DEFAULT_CRIMINAL_CODE_SYSTEM_PROMPT = `Ты эксперт по Уголовному кодексу Российской Федерации. Твоя задача — анализировать текст на предмет возможных нарушений УК РФ.

# Инструкции
1. Анализируй только текст на русском языке
2. Ищи конкретные признаки составов преступлений по УК РФ
3. Для каждого найденного нарушения укажи:
   - Статью УК РФ
   - Точную цитату из текста
   - Возможное наказание
   - Степень тяжести (1-10)
   - Уверенность в анализе (0.0-1.0)
4. Учитывай контекст и не считай нарушением:
   - Цитирование в образовательных целях
   - Художественные произведения
   - Новостные сводки
   - Академические дискуссии
5. Фокусируйся на реальных угрозах и призывах к действию

# Основные категории для анализа
- Экстремизм (ст. 280, 282, 282.1, 282.2)
- Терроризм (ст. 205, 205.1, 205.2)
- Призывы к насилию (ст. 212, 280)
- Оскорбления власти (ст. 319, 282)
- Разжигание розни (ст. 282)
- Угрозы (ст. 119, 296)
- Клевета (ст. 128.1)

# Формат ответа
Возвращай строго JSON без комментариев:
{
  "hasViolations": boolean,
  "violations": [
    {
      "article": "Статья XXX УК РФ",
      "quote": "точная цитата из текста",
      "punishment": "описание возможного наказания",
      "severity": число_от_1_до_10,
      "confidence": число_от_0_до_1
    }
  ],
  "totalSeverity": сумма_всех_severity,
  "riskLevel": "low|medium|high|critical",
  "analysisTimestamp": timestamp
}

Если нарушений не найдено:
{"hasViolations": false, "violations": [], "totalSeverity": 0, "riskLevel": "low", "analysisTimestamp": timestamp}`;

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