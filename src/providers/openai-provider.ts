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
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  verbosity?: 'low' | 'medium' | 'high';
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
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

  private isGPT5Model(model: string): boolean {
    // GPT-5 models use max_completion_tokens parameter
    return model.toLowerCase().includes('gpt-5') || model.toLowerCase().includes('gpt5');
  }

  private allowedParamsFor(model: string) {
    const modelLower = model.toLowerCase();
    
    if (modelLower.includes('gpt-5-nano')) {
      return { 
        temperature: false, 
        top_p: false, 
        presence_penalty: false, 
        frequency_penalty: false, 
        verbosity: true, 
        reasoning_effort: true 
      };
    }
    
    if (modelLower.includes('gpt-5') || modelLower.includes('gpt5')) {
      return { 
        temperature: true, 
        top_p: true, 
        presence_penalty: true, 
        frequency_penalty: true, 
        verbosity: true, 
        reasoning_effort: true 
      };
    }
    
    return { 
      temperature: true, 
      top_p: true, 
      presence_penalty: true, 
      frequency_penalty: true, 
      verbosity: false, 
      reasoning_effort: false 
    };
  }

  constructor(env: Env, providerType: 'standard' | 'premium' = 'standard') {
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
    const isGPT5 = this.isGPT5Model(this.model);
    const allowedParams = this.allowedParamsFor(this.model);

    const requestBody: OpenAIChatRequest = {
      model: this.model,
      messages
    };

    // Use appropriate token parameter based on model generation
    if (isGPT5) {
      requestBody.max_completion_tokens = options.maxTokens;
    } else {
      requestBody.max_tokens = options.maxTokens;
    }

    // Add sampling parameters only if supported by the model
    if (allowedParams.temperature) {
      requestBody.temperature = options.temperature;
    }
    
    if (allowedParams.top_p) {
      requestBody.top_p = options.topP;
    }
    
    if (allowedParams.frequency_penalty && options.frequencyPenalty !== undefined) {
      requestBody.frequency_penalty = options.frequencyPenalty;
    }
    if (allowedParams.presence_penalty && options.presencePenalty !== undefined) {
      requestBody.presence_penalty = options.presencePenalty;
    }

    // Add GPT-5 specific parameters if supported
    if (allowedParams.verbosity && options.verbosity !== undefined) {
      requestBody.verbosity = options.verbosity;
    }
    
    if (allowedParams.reasoning_effort && options.reasoningEffort !== undefined) {
      requestBody.reasoning_effort = options.reasoningEffort;
    }

    // Always include seed if provided
    if (options.seed !== undefined) {
      requestBody.seed = options.seed;
    }

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
      let errorParam: string | undefined;

      try {
        const errorBody = await response.json();
        const errorObj = errorBody as any;
        if (errorObj.error && errorObj.error.message) {
          errorMessage = `OpenAI API error: ${errorObj.error.message}`;
          
          // Extract parameter name for 400 errors (parameter compatibility issues)
          if (response.status === 400 && errorObj.error.param) {
            errorParam = errorObj.error.param;
          }
        }
      } catch {
        // If we can't parse the error body, use the status text
      }

      // Handle specific error codes
      switch (response.status) {
        case 400:
          if (errorParam) {
            console.warn(`OpenAI parameter compatibility issue: parameter '${errorParam}' not allowed for model '${this.model}'`);
            throw new ProviderError(`OpenAI API parameter error: ${errorMessage} (parameter: ${errorParam})`, 'openai');
          }
          throw new ProviderError(errorMessage, 'openai');
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
    const startTime = Date.now();

    try {
      if (env) {
        Logger.debug(env, 'OpenAI profanity analysis: starting', {
          provider: 'openai',
          model: this.model,
          textLength: text.length,
          providerType: this.providerType,
          textPreview: text.substring(0, 100) + (text.length > 100 ? '...' : '')
        });
      }

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

      const response = await this.callOpenAI(messages, options);
      const result = response.choices[0].message.content?.trim() || '';

      if (env) {
        Logger.debug(env, 'OpenAI profanity analysis: raw response received', {
          provider: 'openai',
          responseLength: result.length,
          tokensUsed: response.usage?.total_tokens || 0,
          finishReason: response.choices[0].finish_reason,
          isEmpty: result === ''
        });
      }

      // Check if response was filtered by OpenAI
      if (response.choices[0].finish_reason === 'content_filter') {
        if (env) {
          Logger.warn('OpenAI profanity analysis: content filtered by OpenAI', {
            provider: 'openai',
            finishReason: response.choices[0].finish_reason
          });
        }
        
        return {
          hasProfanity: true,
          words: [{
            word: '[content_filtered]',
            baseForm: '[content_filtered]',
            confidence: 0.9
          }]
        };
      }

      // Parse JSON response
      const parsedResult = this.parseProfanityResponse(result);

      const duration = Date.now() - startTime;
      if (env) {
        Logger.debug(env, 'OpenAI profanity analysis: completed successfully', {
          provider: 'openai',
          duration,
          hasProfanity: parsedResult.hasProfanity,
          wordsFound: parsedResult.words.length,
          tokensUsed: response.usage?.total_tokens || 0
        });
      }

      return parsedResult;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (env) {
        Logger.error('OpenAI profanity analysis: failed', {
          provider: 'openai',
          model: this.model,
          providerType: this.providerType,
          textLength: text.length,
          duration,
          error: error.message || String(error),
          errorType: error.constructor.name,
          stack: error.stack
        });
      }

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
      // Handle empty response - OpenAI may return empty response when content is filtered
      if (!response || response.trim() === '') {
        Logger.warn('OpenAI profanity analysis: empty response received (likely content filtered)', {
          provider: 'openai',
          rawResponse: response
        });
        
        // Empty response likely means profanity was detected and filtered
        // Return conservative result indicating potential profanity
        return {
          hasProfanity: true,
          words: [{
            word: '[filtered]',
            baseForm: '[filtered]',
            confidence: 0.8
          }]
        };
      }

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
      Logger.error('OpenAI profanity analysis: response parsing failed', {
        provider: 'openai',
        rawResponse: response,
        error: error instanceof Error ? error.message : String(error)
      });

      // If parsing failed and response is empty, assume profanity was filtered
      if (!response || response.trim() === '') {
        Logger.warn('OpenAI profanity analysis: treating empty response as filtered profanity', {
          provider: 'openai'
        });
        
        return {
          hasProfanity: true,
          words: [{
            word: '[filtered]',
            baseForm: '[filtered]',
            confidence: 0.7
          }]
        };
      }

      // Return safe fallback on other parsing errors
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