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
    // For chat with system prompt present, we separate entries with ";\n" to reduce ambiguity between lines.
    // Otherwise (including completion or when system prompt is undefined), we use a simple "\n" separator.
    try {
      let response: any;
      
      // Support both new and old configuration variables for backward compatibility
      const model = (this.env as any).CLOUDFLARE_MODEL || this.env.SUMMARY_MODEL;
      
      if (model.includes('chat')) {
        const contentForChat = request.messages
          .map(m => `${m.username}: ${m.text}`)
          .join(request.systemPrompt ? ';\n' : '\n');
        const messages = this.buildChatMessages(request, contentForChat);
        const aiOptions = {
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          top_p: options.topP,
          ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
          messages
        };
        response = await this.env.AI.run(model, aiOptions);
      } else {
        const contentForCompletion = request.messages
          .map(m => `${m.username}: ${m.text}`)
          .join('\n');
        const input = `${request.userPrompt}\n${request.limitNote}\n${contentForCompletion}`;
        const aiOptions = {
          max_tokens: options.maxTokens,
          temperature: options.temperature,
          top_p: options.topP,
          ...(options.frequencyPenalty !== undefined && { frequency_penalty: options.frequencyPenalty }),
          prompt: input
        };
        response = await this.env.AI.run(model, aiOptions);
      }
      
      const raw = (response.response ?? response) as string;
      return truncateText(raw, TELEGRAM_LIMIT);
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
      
      // Validate hasProfanity
      const hasProfanity = typeof parsed.hasProfanity === 'boolean' ? parsed.hasProfanity : false;
      
      // Normalize words array to required structure
      const rawWords = Array.isArray(parsed.words) ? parsed.words : [];
      const words = rawWords
        .map((w: any) => {
          if (typeof w === 'string') {
            const s = w.trim();
            if (!s) return null;
            return { word: s, baseForm: s, confidence: 0.5 };
          }
          if (w && typeof w === 'object') {
            const word = typeof w.word === 'string' && w.word.trim().length > 0 ? w.word.trim() : undefined;
            const baseForm = typeof w.baseForm === 'string' && w.baseForm.trim().length > 0 ? w.baseForm.trim() : (word || undefined);
            let confidence = typeof w.confidence === 'number' ? w.confidence : 0.5;
            if (!(confidence >= 0 && confidence <= 1)) confidence = 0.5;
            if (!word && !baseForm) return null;
            return { word: word || baseForm!, baseForm: baseForm || word!, confidence };
          }
          return null;
        })
        .filter((v: any): v is { word: string; baseForm: string; confidence: number } => !!v);
      
      return {
        hasProfanity,
        words
      };
    } catch (e: any) {
      // If parsing fails, try basic heuristic: if response contains "true", assume profanity
      const lower = String(response).toLowerCase();
      const hasProfanity = lower.includes('true');
      const words: { word: string; baseForm: string; confidence: number }[] = [];
      return { hasProfanity, words };
    }
  }

  getProviderInfo(): ProviderInfo {
    // Support both new and old configuration variables for backward compatibility
    const model = (this.env as any).CLOUDFLARE_MODEL || this.env.SUMMARY_MODEL;
    return {
      name: 'cloudflare',
      model
    };
  }
}