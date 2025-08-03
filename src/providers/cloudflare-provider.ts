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

  getProviderInfo(): ProviderInfo {
    return {
      name: 'cloudflare',
      model: (this.env as any).CLOUDFLARE_MODEL || this.env.SUMMARY_MODEL
    };
  }
}