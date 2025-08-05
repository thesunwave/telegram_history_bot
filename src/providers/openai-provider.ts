import { Env, TELEGRAM_LIMIT } from "../env";
import { truncateText } from "../utils";
import { Logger } from "../logger";
import {
  AIProvider,
  ChatMessage,
  SummaryRequest,
  SummaryOptions,
  ProviderInfo,
  ProviderError,
  ProfanityAnalysisResult,
  MESSAGE_SEPARATOR,
  getProfanityPrompts,
} from "./ai-provider";

interface OpenAIChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
  top_p: number;
  frequency_penalty?: number;
  seed?: number;
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

  async summarize(request: SummaryRequest, options: SummaryOptions, env?: Env): Promise<string> {
    // Format messages with author information preserved
    const content = request.messages.map(m => `${m.username}: ${m.text}`).join('\n');
    
    // Debug logging
    if (env) {
      Logger.debug(env, 'OpenAI provider: request details', {
        messageCount: request.messages.length,
        contentLength: content.length,
        contentPreview: content.substring(0, 500),
        systemPrompt: request.systemPrompt?.substring(0, 200),
        userPrompt: request.userPrompt?.substring(0, 200)
      });
    }
    
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
      
      if (env) {
        Logger.debug(env, 'OpenAI provider: response details', {
          responseLength: result.length,
          responsePreview: result.substring(0, 200)
        });
      }
      
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
      ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
      ...(options.seed !== undefined && { seed: options.seed })
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
        const errorObj = errorBody as any;
        if (errorObj.error && errorObj.error.message) {
          errorMessage = `OpenAI API error: ${errorObj.error.message}`;
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

    return (await response.json()) as OpenAIChatResponse;
  }

  validateConfig(): void {
    if (!this.apiKey) {
      const keyName = this.providerType === 'premium' ? 'OPENAI_PREMIUM_API_KEY' : 'OPENAI_API_KEY';
      throw new Error(`${keyName} is required for OpenAI ${this.providerType} provider`);
    }
  }

  async analyzeProfanity(text: string, env?: any): Promise<ProfanityAnalysisResult> {
    const { systemPrompt, userPrompt } = getProfanityPrompts(env);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${userPrompt}\n${text}` }
    ];

    const options: SummaryOptions = {
      maxTokens: 500,
      temperature: 0.1,
      topP: 0.9
    };

    try {
      const response = await this.callOpenAI(messages, options);
      const result = response.choices[0].message.content.trim();
      
      // Parse JSON response
      const parsedResult = this.parseProfanityResponse(result);
      return parsedResult;
    } catch (error: any) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError(
        `OpenAI profanity analysis error: ${error.message || String(error)}`,
        'openai',
        error
      );
    }
  }

  private parseProfanityResponse(response: string): ProfanityAnalysisResult {
    try {
      // Clean up response - remove any markdown formatting or extra text
      let cleanResponse = response.trim();
      
      // Find JSON content between curly braces
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanResponse = jsonMatch[0];
      }
      
      const parsed = JSON.parse(cleanResponse);
      
      // Validate response structure
      if (typeof parsed.hasProfanity !== 'boolean') {
        throw new Error('Invalid response: hasProfanity must be boolean');
      }
      
      if (!Array.isArray(parsed.words)) {
        throw new Error('Invalid response: words must be array');
      }
      
      // Validate each word entry
      for (const word of parsed.words) {
        if (typeof word.word !== 'string' || typeof word.baseForm !== 'string') {
          throw new Error('Invalid response: word entries must have string word and baseForm');
        }
        if (typeof word.confidence !== 'number' || word.confidence < 0 || word.confidence > 1) {
          throw new Error('Invalid response: confidence must be number between 0 and 1');
        }
      }
      
      return parsed as ProfanityAnalysisResult;
    } catch (error) {
      // Return safe fallback on parsing error
      return {
        hasProfanity: false,
        words: []
      };
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: this.providerType === 'premium' ? 'openai-premium' : 'openai',
      model: this.model
    };
  }
}