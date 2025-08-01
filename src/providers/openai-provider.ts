import { Env, TELEGRAM_LIMIT } from "../env";
import { truncateText } from "../utils";
import {
  AIProvider,
  ChatMessage,
  SummaryRequest,
  SummaryOptions,
  ProviderInfo,
  ProviderError,
  MESSAGE_SEPARATOR,
} from "./ai-provider";

interface OpenAIChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  frequency_penalty?: number;
}

interface OpenAIChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string = 'https://api.openai.com/v1';
  private providerType: 'standard' | 'premium';

  constructor(private env: Env, providerType: 'standard' | 'premium' = 'standard') {
    this.providerType = providerType;
    
    if (providerType === 'premium') {
      this.apiKey = (env as any).OPENAI_PREMIUM_API_KEY || (env as any).OPENAI_API_KEY;
      this.model = (env as any).OPENAI_PREMIUM_MODEL || (env as any).OPENAI_MODEL || 'gpt-4-turbo';
    } else {
      this.apiKey = (env as any).OPENAI_API_KEY;
      this.model = (env as any).OPENAI_MODEL || 'gpt-3.5-turbo';
    }
  }

  async summarize(request: SummaryRequest, options: SummaryOptions): Promise<string> {
    // Format messages with author information preserved
    const content = request.messages.map(m => `${m.username}: ${m.text}`).join('\n');
    
    const messages: ChatMessage[] = [
      { 
        role: 'system', 
        content: request.systemPrompt 
          ? `${request.systemPrompt}\n${request.limitNote}`
          : request.limitNote 
      },
      { 
        role: 'user', 
        content: `${request.userPrompt}\n${MESSAGE_SEPARATOR}\n${content}` 
      }
    ];

    try {
      const response = await this.callOpenAI(messages, options);
      const result = response.choices[0].message.content;
      return truncateText(result, TELEGRAM_LIMIT);
    } catch (error: any) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError(
        `OpenAI provider error: ${error.message || String(error)}`,
        'openai',
        error
      );
    }
  }

  private async callOpenAI(messages: ChatMessage[], options: SummaryOptions): Promise<OpenAIChatResponse> {
    const requestBody: OpenAIChatRequest = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty })
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      let errorMessage = `OpenAI API error: ${response.status} ${response.statusText}`;
      
      try {
        const errorBody = await response.json();
        if (errorBody.error && errorBody.error.message) {
          errorMessage = `OpenAI API error: ${errorBody.error.message}`;
        }
      } catch {
        // If we can't parse the error body, use the status text
      }

      // Handle specific error codes
      switch (response.status) {
        case 401:
          throw new ProviderError('Invalid OpenAI API key', 'openai');
        case 429:
          throw new ProviderError('OpenAI API rate limit exceeded', 'openai');
        case 500:
        case 502:
        case 503:
        case 504:
          throw new ProviderError('OpenAI server error', 'openai');
        default:
          throw new ProviderError(errorMessage, 'openai');
      }
    }

    return await response.json();
  }

  validateConfig(): void {
    if (!this.apiKey) {
      const keyName = this.providerType === 'premium' ? 'OPENAI_PREMIUM_API_KEY' : 'OPENAI_API_KEY';
      throw new Error(`${keyName} is required for OpenAI ${this.providerType} provider`);
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: this.providerType === 'premium' ? 'openai-premium' : 'openai',
      model: this.model
    };
  }
}