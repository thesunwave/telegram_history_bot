export const MESSAGE_SEPARATOR = "=== СООБЩЕНИЯ ===";

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
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
  temperature: number;
  topP: number;
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
Отвечай строго в формате JSON без дополнительных комментариев:
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

Если матерных слов не найдено, верни: {"hasProfanity": false, "words": []}`;

const DEFAULT_PROFANITY_USER_PROMPT = `Проанализируй следующий текст на наличие матерной лексики:

ТЕКСТ ДЛЯ АНАЛИЗА:`;

// Helper function to get profanity prompts from env with fallback
export function getProfanityPrompts(env?: any): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: env?.PROFANITY_SYSTEM_PROMPT || DEFAULT_PROFANITY_SYSTEM_PROMPT,
    userPrompt: env?.PROFANITY_USER_PROMPT || DEFAULT_PROFANITY_USER_PROMPT
  };
}

export interface AIProvider {
  summarize(request: SummaryRequest, options: SummaryOptions, env?: any): Promise<string>;
  analyzeProfanity(text: string, env?: any): Promise<ProfanityAnalysisResult>;
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