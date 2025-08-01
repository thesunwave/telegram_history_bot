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
}

export interface ProviderInfo {
  name: string;
  model: string;
  version?: string;
}

export interface AIProvider {
  summarize(request: SummaryRequest, options: SummaryOptions): Promise<string>;
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