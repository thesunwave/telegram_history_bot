import { Env } from "../env";
import { Logger } from "../logger";
import {
  AIProvider,
  ChatMessage,
  SummaryRequest,
  SummaryOptions,
  ProviderInfo,
  ProviderError,
  ProfanityAnalysisResult,
  CriminalAnalysisResult,
  MESSAGE_SEPARATOR,
  getProfanityPrompts,
  getCriminalCodePrompts,
} from "./ai-provider";

type AllowedParams = {
  temperature: boolean;
  top_p: boolean;
  presence_penalty: boolean;
  frequency_penalty: boolean;
  verbosity: boolean;
  reasoning_effort: boolean;
};

interface OpenAIChatRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
  verbosity?: 'low' | 'medium' | 'high';
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
  response_format?: {
    type: 'json_object' | 'text';
  };
}

interface OpenAIResponsesRequest {
  model: string;
  input: Array<string | { role: string; content: string }>;
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  reasoning?: {
    effort: 'minimal' | 'low' | 'medium' | 'high';
  };
  text?: {
    verbosity?: 'low' | 'medium' | 'high';
  };
  response_format?: {
    type: 'json_object' | 'text';
  };
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
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
}

export class OpenAIProvider implements AIProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string = 'https://api.openai.com/v1';
  private providerType: 'standard' | 'premium';
  private readonly modelCaps: Record<string, { maxOutput: number }> = {
    'gpt-5-nano': { maxOutput: 128000 },
    'gpt-4.1-nano': { maxOutput: 32000 },
    'gpt-4o-mini': { maxOutput: 12000 },
    'gpt-4o': { maxOutput: 32000 },
  };
  
  private isGPT5Model(model: string): boolean {
    return model.toLowerCase().includes('gpt-5') || model.toLowerCase().includes('gpt5');
  }

  private allowedParamsFor(model: string): AllowedParams {
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

    if (modelLower.includes('gpt-5-mini')) {
      return {
        // GPT-5-mini currently rejects sampling params like temperature
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
        // GPT-5.1 family currently rejects frequency/presence penalties
        presence_penalty: false,
        frequency_penalty: false,
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

  private sanitizeChatPayload(
    body: OpenAIChatRequest,
    allowed: AllowedParams
  ): OpenAIChatRequest {
    const payload: any = { ...body };

    if (!allowed.temperature) delete payload.temperature;
    if (!allowed.top_p) delete payload.top_p;
    if (!allowed.frequency_penalty) delete payload.frequency_penalty;
    if (!allowed.presence_penalty) delete payload.presence_penalty;
    if (!allowed.verbosity) delete payload.verbosity;
    if (!allowed.reasoning_effort) delete payload.reasoning_effort;

    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    }

    return payload as OpenAIChatRequest;
  }

  private sanitizeResponsesPayload(
    body: OpenAIResponsesRequest,
    allowed: AllowedParams
  ): OpenAIResponsesRequest {
    const payload: any = { ...body };

    // Clone nested objects before mutation
    if (payload.text) {
      payload.text = { ...payload.text };
    }

    if (!allowed.temperature) delete payload.temperature;
    if (!allowed.top_p) delete payload.top_p;
    if (!allowed.reasoning_effort) delete payload.reasoning;

    // The Responses API now expects verbosity under text.verbosity
    // Ensure old top-level verbosity is never sent
    if ('verbosity' in payload) delete payload.verbosity;

    if (payload.text) {
      if (!allowed.verbosity) delete payload.text.verbosity;
      if (payload.text.verbosity === undefined) delete payload.text.verbosity;

      if (Object.keys(payload.text).length === 0) {
        delete payload.text;
      }
    }

    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) {
        delete payload[key];
      }
    }

    return payload as OpenAIResponsesRequest;
  }

  constructor(env: Env, providerType: 'standard' | 'premium' = 'standard', modelOverride?: string) {
    this.providerType = providerType;

    if (providerType === 'premium') {
      this.apiKey = (env as any).OPENAI_PREMIUM_API_KEY || (env as any).OPENAI_API_KEY;
      this.model =
        modelOverride?.trim() ||
        (env as any).OPENAI_PREMIUM_MODEL ||
        (env as any).OPENAI_MODEL ||
        'gpt-4-turbo';
    } else {
      this.apiKey = (env as any).OPENAI_API_KEY;
      this.model = modelOverride?.trim() || (env as any).OPENAI_MODEL || 'gpt-3.5-turbo';
    }
  }

  async summarize(request: SummaryRequest, options: SummaryOptions, env?: Env): Promise<string> {
    // Format messages with semicolon separators between each message
    const content = request.messages.map(m => `${m.username}: ${m.text}`).join(';');

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

    const systemMessage: ChatMessage = {
      role: 'system',
      content: request.systemPrompt
        ? `${request.systemPrompt}\n${request.limitNote}`
        : request.limitNote
    };

    const messages: ChatMessage[] = [
      systemMessage,
      {
        role: 'user',
        content: `${request.userPrompt}\n${MESSAGE_SEPARATOR}\n${content}`
      }
    ];

    // Clamp max tokens to model capability to avoid max_output_tokens errors
    const maxOutputTokens = this.getModelOutputCap(this.model);
    const safeMaxTokens = this.clamp(options.maxTokens ?? maxOutputTokens, 1, maxOutputTokens);
    const safeOptions = { ...options, maxTokens: safeMaxTokens };

    if (env && safeMaxTokens !== options.maxTokens) {
      Logger.debug(env, 'OpenAI provider: maxTokens clamped', {
        requested: options.maxTokens,
        used: safeMaxTokens,
        model: this.model
      });
    }

    try {
      const response = await this.callOpenAI(messages, safeOptions, safeOptions.forceJsonResponse ?? false); // Text or JSON response
      const raw = response.choices[0].message.content;

      if (env) {
        Logger.debug(env, 'OpenAI provider: response details', {
          responseLength: raw.length,
          responsePreview: raw.substring(0, 200),
          tokensUsed: response.usage?.total_tokens || 0,
          cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens || 0
        });
      }

      return raw;
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



  private async callOpenAI(messages: ChatMessage[], options: SummaryOptions, forceJsonResponse?: boolean): Promise<OpenAIChatResponse> {
    const isGPT5 = this.isGPT5Model(this.model);
    const allowedParams = this.allowedParamsFor(this.model);
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    const useResponsesApi = isGPT5;
    let url = `${this.baseUrl}/chat/completions`;
    let body: OpenAIChatRequest | OpenAIResponsesRequest;

    if (useResponsesApi) {
      // Responses API payload for GPT-5.*
      const instructionsMessage = messages.find((m) => m.role === 'system' || m.role === 'developer');
      const remainingMessages = messages.filter((m) => m !== instructionsMessage);

      const responsesBody: OpenAIResponsesRequest = {
        model: this.model,
        input: remainingMessages.map((m) => ({ role: m.role, content: m.content })),
        max_output_tokens: options.maxTokens
      };

      if (instructionsMessage) {
        responsesBody.instructions = instructionsMessage.content;
      }

      if (allowedParams.temperature) {
        responsesBody.temperature = options.temperature;
      }

      if (allowedParams.top_p) {
        responsesBody.top_p = options.topP;
      }

      if (allowedParams.verbosity && options.verbosity !== undefined) {
        responsesBody.text = { verbosity: options.verbosity };
      }

      if (allowedParams.reasoning_effort && options.reasoningEffort !== undefined) {
        responsesBody.reasoning = { effort: options.reasoningEffort };
      }

      if (forceJsonResponse) {
        responsesBody.response_format = { type: 'json_object' };
      }

      url = `${this.baseUrl}/responses`;
      body = this.sanitizeResponsesPayload(responsesBody, allowedParams);
    } else {
      const requestBody: OpenAIChatRequest = {
        model: this.model,
        messages,
        max_tokens: options.maxTokens
      };

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

      // Force JSON response format when requested (used by profanity analysis and per-user preprocessing)
      if (forceJsonResponse) {
        requestBody.response_format = { type: 'json_object' };
      }

      body = this.sanitizeChatPayload(requestBody, allowedParams);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
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

    const parsed = await response.json();
    if (useResponsesApi) {
      const content = this.extractResponsesContent(parsed);
      return {
        choices: [
          {
            message: { content },
            finish_reason: 'stop'
          }
        ],
        usage: parsed.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      } as OpenAIChatResponse;
    }

    return parsed as OpenAIChatResponse;
  }

  private extractResponsesContent(response: any): string {
    if (!response) {
      throw new ProviderError('OpenAI Responses API returned empty response', 'openai');
    }

    if (typeof response === 'string') {
      return response;
    }

    const status = response.status;
    const incompleteReason = response.incomplete_details?.reason;

    if (typeof response.output_text === 'string' && response.output_text.trim()) {
      return response.output_text.trim();
    }

    if (Array.isArray(response.output)) {
      // Prefer message-type items; fallback to any item with text
      const orderedOutputs = [
        ...response.output.filter((item: any) => item?.type === 'message' || item?.role === 'assistant'),
        ...response.output
      ];

      for (const item of orderedOutputs) {
        if (typeof item === 'string' && item.trim()) return item.trim();

        const content = item?.content || item?.message?.content;
        if (typeof content === 'string' && content.trim()) return content.trim();
        if (Array.isArray(content)) {
          const textPart = content.find((c: any) => c?.text?.value || c?.text || typeof c === 'string');
          if (textPart?.text?.value?.trim()) return textPart.text.value.trim();
          if (typeof textPart?.text === 'string' && textPart.text.trim()) return textPart.text.trim();
          if (typeof textPart === 'string' && textPart.trim()) return textPart.trim();
        }

        if (Array.isArray(item?.summary) && item.summary.length > 0) {
          const summaryText = item.summary.join(' ').trim();
          if (summaryText) return summaryText;
        }
      }
    }

    if (status && status !== 'completed') {
      const reasonSuffix = incompleteReason ? ` (${incompleteReason})` : '';
      throw new ProviderError(`OpenAI Responses API returned incomplete result${reasonSuffix}`, 'openai');
    }

    throw new ProviderError('OpenAI Responses API did not return any text output', 'openai');
  }

  private getModelOutputCap(model: string): number {
    const key = Object.keys(this.modelCaps).find((m) => model.toLowerCase().includes(m));
    if (key) return this.modelCaps[key].maxOutput;
    // Conservative default to avoid hitting max_output_tokens
    return 8192;
  }

  private clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
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
          isGPT5: this.isGPT5Model(this.model)
        });
      }

      const { systemPrompt, userPrompt } = getProfanityPrompts(env);
      
      // Use 'developer' role for GPT-5 models, 'system' for others
      const roleToUse = this.isGPT5Model(this.model) ? 'developer' : 'system';
      const messages: ChatMessage[] = [
        { role: roleToUse, content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n${text}` }
      ];

      // Prepare options for profanity analysis
      const options: SummaryOptions = {
        maxTokens: 500,
        temperature: 0.1,
        topP: 0.9
      };

      // Add reasoning_effort for GPT-5 models
      if (this.isGPT5Model(this.model)) {
        options.reasoningEffort = 'medium';
      }

      if (env) {
        Logger.debug(env, 'OpenAI profanity analysis: request options', {
          model: this.model,
          finalOptions: options
        });
      }

      const response = await this.callOpenAI(messages, options, !this.isGPT5Model(this.model));
      const result = response.choices[0].message.content?.trim() || '';

      if (env) {
        Logger.debug(env, 'OpenAI profanity analysis: raw response received', {
          provider: 'openai',
          responseLength: result.length,
          tokensUsed: response.usage?.total_tokens || 0,
          cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens || 0,
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

  async analyzeCriminalCode(text: string, env?: any): Promise<CriminalAnalysisResult> {
    const startTime = Date.now();

    try {
      if (env) {
        Logger.debug(env, 'OpenAI criminal code analysis: starting', {
          provider: 'openai',
          model: this.model,
          textLength: text.length,
          providerType: this.providerType,
          isGPT5: this.isGPT5Model(this.model)
        });
      }

      const { systemPrompt, userPrompt } = getCriminalCodePrompts(env);
      
      // Use 'developer' role for GPT-5 models, 'system' for others
      const roleToUse = this.isGPT5Model(this.model) ? 'developer' : 'system';
      const messages: ChatMessage[] = [
        { role: roleToUse, content: systemPrompt },
        { role: 'user', content: `${userPrompt}\n${text}` }
      ];

      // Prepare options for criminal code analysis
      const options: SummaryOptions = {
        maxTokens: (env as any)?.OPENAI_MAX_TOKENS ?? (env as any)?.SUMMARY_MAX_TOKENS ?? 800,
        temperature: (env as any)?.OPENAI_TEMPERATURE ?? (env as any)?.SUMMARY_TEMPERATURE ?? 0.1,
        topP: (env as any)?.OPENAI_TOP_P ?? (env as any)?.SUMMARY_TOP_P ?? 0.9,
      };

      if ((env as any)?.OPENAI_FREQUENCY_PENALTY !== undefined || (env as any)?.SUMMARY_FREQUENCY_PENALTY !== undefined) {
        options.frequencyPenalty = (env as any)?.OPENAI_FREQUENCY_PENALTY ?? (env as any)?.SUMMARY_FREQUENCY_PENALTY;
      }
      if ((env as any)?.OPENAI_SEED !== undefined || (env as any)?.SUMMARY_SEED !== undefined) {
        options.seed = (env as any)?.OPENAI_SEED ?? (env as any)?.SUMMARY_SEED;
      }

      // Add reasoning_effort for GPT-5 models
      if (this.isGPT5Model(this.model)) {
        options.reasoningEffort = 'medium';
      }

      if (env) {
        Logger.debug(env, 'OpenAI criminal code analysis: request options', {
          model: this.model,
          finalOptions: options
        });
      }

      const response = await this.callOpenAI(messages, options, !this.isGPT5Model(this.model));
      const result = response.choices[0].message.content?.trim() || '';

      if (env) {
        Logger.debug(env, 'OpenAI criminal code analysis: raw response received', {
          provider: 'openai',
          responseLength: result.length,
          tokensUsed: response.usage?.total_tokens || 0,
          cachedTokens: response.usage?.prompt_tokens_details?.cached_tokens || 0,
          finishReason: response.choices[0].finish_reason,
          isEmpty: result === ''
        });
      }

      // Check if response was filtered by OpenAI
      if (response.choices[0].finish_reason === 'content_filter') {
        if (env) {
          Logger.warn('OpenAI criminal code analysis: content filtered by OpenAI', {
            provider: 'openai',
            finishReason: response.choices[0].finish_reason
          });
        }

        return {
          hasViolations: false,
          violations: [],
          totalSeverity: 0,
          riskLevel: 'low',
          analysisTimestamp: Date.now()
        };
      }

      // Parse JSON response
      const parsedResult = this.parseCriminalCodeResponse(result);

      const duration = Date.now() - startTime;
      if (env) {
        Logger.debug(env, 'OpenAI criminal code analysis: completed successfully', {
          provider: 'openai',
          duration,
          hasViolations: parsedResult.hasViolations,
          violationsFound: parsedResult.violations.length,
          tokensUsed: response.usage?.total_tokens || 0
        });
      }

      return parsedResult;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      const isIncomplete =
        error instanceof ProviderError &&
        /incomplete result|max_output_tokens/i.test(error.message || '');

      if (env) {
        const logMethod = isIncomplete ? Logger.warn : Logger.error;
        logMethod('OpenAI criminal code analysis: failed', {
          provider: 'openai',
          model: this.model,
          providerType: this.providerType,
          textLength: text.length,
          duration,
          error: error.message || String(error),
          errorType: error.constructor.name,
          stack: error.stack,
          incompleteResult: isIncomplete
        });
      }

      if (isIncomplete) {
        return {
          hasViolations: false,
          violations: [],
          totalSeverity: 0,
          riskLevel: 'low',
          analysisTimestamp: Date.now()
        };
      }

      if (error instanceof ProviderError) {
        throw error;
      }
      throw new ProviderError(
        `OpenAI criminal code analysis error: ${error.message || String(error)}`,
        'openai',
        error
      );
    }
  }

  private parseCriminalCodeResponse(response: string): CriminalAnalysisResult {
    try {
      // Handle empty response
      if (!response || response.trim() === '') {
        Logger.warn('OpenAI criminal code analysis: empty response received (likely content filtered)', {
          provider: 'openai',
          rawResponse: response
        });

        return {
          hasViolations: false,
          violations: [],
          totalSeverity: 0,
          riskLevel: 'low',
          analysisTimestamp: Date.now()
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
      if (typeof parsed.hasViolations !== 'boolean') {
        throw new Error('Invalid response: hasViolations must be boolean');
      }

      if (!Array.isArray(parsed.violations)) {
        throw new Error('Invalid response: violations must be array');
      }

      // Validate each violation entry
      for (const violation of parsed.violations) {
        if (typeof violation.article !== 'string' || 
            (violation.subarticle !== null && typeof violation.subarticle !== 'string') ||
            typeof violation.articleTitle !== 'string' ||
            typeof violation.quote !== 'string' ||
            typeof violation.punishment !== 'string') {
          throw new Error('Invalid response: violation entries must have string article, quote, punishment');
        }
        if (typeof violation.severity !== 'number' || violation.severity < 1 || violation.severity > 10) {
          throw new Error('Invalid response: severity must be number between 1 and 10');
        }
        if (typeof violation.confidence !== 'number' || violation.confidence < 0 || violation.confidence > 1) {
          throw new Error('Invalid response: confidence must be number between 0 and 1');
        }
      }

      return parsed as CriminalAnalysisResult;
    } catch (error) {
      Logger.error('OpenAI criminal code analysis: response parsing failed', {
        provider: 'openai',
        rawResponse: response,
        error: error instanceof Error ? error.message : String(error)
      });

      // Return safe fallback on parsing errors
      return {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: Date.now()
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
