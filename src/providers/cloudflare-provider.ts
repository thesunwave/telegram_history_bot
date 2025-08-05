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

export class CloudflareAIProvider implements AIProvider {
  constructor(private env: Env) {}

  async summarize(request: SummaryRequest, options: SummaryOptions, env?: Env): Promise<string> {
    // Format messages as "username: text"
    const content = request.messages.map(m => `${m.username}: ${m.text}`).join('\n');
    
    try {
      let response: any;
      
      // Support both new and old configuration variables for backward compatibility
      const model = (this.env as any).CLOUDFLARE_MODEL || this.env.SUMMARY_MODEL;
      
      if (model.includes('chat')) {
        const messages = this.buildChatMessages(request, content);
        const aiOptions = {
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          top_p: options.topP,
          ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
          messages
        };
        response = await this.env.AI.run(model, aiOptions);
      } else {
        const input = `${request.userPrompt}\n${request.limitNote}\n${content}`;
        const aiOptions = {
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          top_p: options.topP,
          ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
          prompt: input
        };
        response = await this.env.AI.run(model, aiOptions);
      }
      
      const result = response.response ?? response;
      return truncateText(result, TELEGRAM_LIMIT);
    } catch (error: any) {
      throw new ProviderError(
        `Cloudflare AI error: ${error.message || String(error)}`,
        'cloudflare',
        error
      );
    }
  }

  private buildChatMessages(request: SummaryRequest, content: string): ChatMessage[] {
    const system = request.systemPrompt 
      ? `${request.systemPrompt}\n${request.limitNote}`
      : request.limitNote;
    
    return [
      { role: 'system', content: system },
      { role: 'user', content: `${request.userPrompt}\n${MESSAGE_SEPARATOR}\n${content}` }
    ];
  }

  validateConfig(): void {
    if (!this.env.AI) {
      throw new Error('AI binding is required for Cloudflare provider');
    }
    // Support both new and old configuration variables for backward compatibility
    const model = (this.env as any).CLOUDFLARE_MODEL || this.env.SUMMARY_MODEL;
    if (!model) {
      throw new Error('CLOUDFLARE_MODEL or SUMMARY_MODEL is required for Cloudflare provider');
    }
  }

  async analyzeProfanity(text: string, env?: any): Promise<ProfanityAnalysisResult> {
    const startTime = Date.now();
    const model = (this.env as any).CLOUDFLARE_MODEL || this.env.SUMMARY_MODEL;
    
    try {
      if (env) {
        Logger.debug(env, 'Cloudflare profanity analysis: starting', {
          provider: 'cloudflare',
          model,
          textLength: text.length,
          isChatModel: model.includes('chat')
        });
      }

      const { systemPrompt, userPrompt } = getProfanityPrompts(env || this.env);
      
      let response: any;
      
      if (model.includes('chat')) {
        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${userPrompt}\n${text}` }
        ];
        
        const aiOptions = {
          max_tokens: 500,
          temperature: 0.1,
          top_p: 0.9,
          messages
        };
        
        response = await this.env.AI.run(model, aiOptions);
      } else {
        const input = `${systemPrompt}\n\n${userPrompt}\n${text}`;
        const aiOptions = {
          max_tokens: 500,
          temperature: 0.1,
          top_p: 0.9,
          prompt: input
        };
        
        response = await this.env.AI.run(model, aiOptions);
      }
      
      const result = response.response ?? response;
      
      if (env) {
        Logger.debug(env, 'Cloudflare profanity analysis: raw response received', {
          provider: 'cloudflare',
          responseLength: typeof result === 'string' ? result.length : 0,
          responseType: typeof result
        });
      }
      
      const parsedResult = this.parseProfanityResponse(result);
      
      const duration = Date.now() - startTime;
      if (env) {
        Logger.debug(env, 'Cloudflare profanity analysis: completed successfully', {
          provider: 'cloudflare',
          duration,
          hasProfanity: parsedResult.hasProfanity,
          wordsFound: parsedResult.words.length
        });
      }
      
      return parsedResult;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      if (env) {
        Logger.error('Cloudflare profanity analysis: failed', {
          provider: 'cloudflare',
          model,
          textLength: text.length,
          duration,
          error: error.message || String(error),
          errorType: error.constructor.name,
          stack: error.stack
        });
      }

      throw new ProviderError(
        `Cloudflare AI profanity analysis error: ${error.message || String(error)}`,
        'cloudflare',
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
      Logger.error('Cloudflare profanity analysis: response parsing failed', {
        provider: 'cloudflare',
        rawResponse: response.substring(0, 200) + (response.length > 200 ? '...' : ''),
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return safe fallback on parsing error
      return {
        hasProfanity: false,
        words: []
      };
    }
  }

  getProviderInfo(): ProviderInfo {
    return {
      name: 'cloudflare',
      model: (this.env as any).CLOUDFLARE_MODEL || this.env.SUMMARY_MODEL
    };
  }
}