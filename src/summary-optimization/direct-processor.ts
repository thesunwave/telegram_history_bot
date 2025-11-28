/**
 * Direct Processor for small data volumes
 * 
 * Handles direct processing of messages without chunking,
 * optimizing for full context utilization within OpenAI limits
 */

import { DirectProcessor as IDirectProcessor, SummaryContext } from './types';
import { TelegramMessage, SummaryRequest, SummaryOptions } from '../providers/ai-provider';
import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from '../env';
import { ProviderFactory } from '../providers/provider-factory';
import { ContextOptimizer } from './context-optimizer';
import { loadOptimizationConfig } from './config';
import { Logger, PerformanceTracker } from '../logger';
import { truncateText } from '../utils';

export class DirectProcessor implements IDirectProcessor {
  private contextOptimizer: ContextOptimizer;

  constructor() {
    // Context optimizer will be initialized with config in process method
    this.contextOptimizer = null as any;
  }

  /**
   * Processes messages directly using a single AI request
   * Optimizes for full context utilization
   */
  async process(messages: TelegramMessage[], env: Env, context?: SummaryContext): Promise<string> {
    const trackerId = PerformanceTracker.start('directProcessor', 'process', { 
      messageCount: messages.length 
    });

    Logger.debug(env, 'DirectProcessor: Starting direct processing', {
      messageCount: messages.length,
      chat: context?.chatId ? context.chatId.toString(LOG_ID_RADIX) : undefined,
      trackerId
    });

    if (!messages || messages.length === 0) {
      Logger.warn('DirectProcessor: No messages provided for processing', {
        trackerId,
        chat: context?.chatId ? context.chatId.toString(LOG_ID_RADIX) : undefined
      });
      PerformanceTracker.end(trackerId, {
        messageCount: 0,
        success: false,
        error: 'No messages provided'
      });
      throw new Error('No messages provided');
    }

    try {
      // Load configuration
      const config = loadOptimizationConfig(env);
      this.contextOptimizer = new ContextOptimizer(config);

      // Get max tokens for direct processing from config
      const maxTokens = config.contextManagement.maxTokensPerRequest;

      // Estimate tokens and optimize if needed
      const estimatedTokens = this.contextOptimizer.estimateTokens(messages);
      Logger.debug(env, 'DirectProcessor: Token estimation', {
        originalMessages: messages.length,
        estimatedTokens,
        maxTokens
      });

      // Optimize messages to fit within context limit
      const optimizedMessages = this.contextOptimizer.optimizeForContext(messages, maxTokens);
      
      if (optimizedMessages.length < messages.length) {
        Logger.debug(env, 'DirectProcessor: Messages optimized for context', {
          originalCount: messages.length,
          optimizedCount: optimizedMessages.length,
          removedCount: messages.length - optimizedMessages.length
        });
      }

      // Create AI provider
      const provider = ProviderFactory.createProvider(env, 'summary');

      // Build summary request with existing prompts
      const summaryRequest = this.buildSummaryRequest(optimizedMessages, env, context);

      // Build AI options based on provider
      const aiOptions = this.buildAIOptions(env);

      // Process with AI provider
      const processingStart = Date.now();
      const summary = await provider.summarize(summaryRequest, aiOptions, env);
      const processingDuration = Date.now() - processingStart;
      const safeSummary = truncateText(summary, TELEGRAM_LIMIT);

      Logger.debug(env, 'DirectProcessor: Processing completed', {
        messageCount: optimizedMessages.length,
        processingDuration,
        resultLength: safeSummary.length,
        trackerId
      });

      // Track performance metrics
      PerformanceTracker.end(trackerId, {
        messageCount: optimizedMessages.length,
        estimatedTokens,
        processingDuration,
        success: true
      });

      return safeSummary;

    } catch (error) {
      const e = error as Error;
      Logger.error('DirectProcessor: Processing failed', {
        error: e.message,
        stack: e.stack,
        messageCount: messages.length
      });

      PerformanceTracker.end(trackerId, {
        messageCount: messages.length,
        success: false,
        error: e.message
      });

      throw error;
    }
  }

  /**
   * Builds a summary request compatible with existing prompts
   */
  private buildSummaryRequest(
    messages: TelegramMessage[],
    env: Env,
    context?: SummaryContext
  ): SummaryRequest {
    // Extract participant information
    const participants = [...new Set(messages.map(m => m.username))];
    
    const chatTitle = context?.chatId
      ? `Чат ${context.chatId.toString(LOG_ID_RADIX)}`
      : 'Неизвестный чат';
    const limitMessages = context?.requestedMessageCount ?? messages.length;

    // Calculate time range
    const startTs = context?.periodStart ?? messages[0]?.ts;
    const endTs = context?.periodEnd ?? messages[messages.length - 1]?.ts;
    const startDate = startTs ? new Date(startTs * 1000).toLocaleDateString('ru-RU') : 'неизвестно';
    const endDate = endTs ? new Date(endTs * 1000).toLocaleDateString('ru-RU') : 'неизвестно';
    
    // Create participant stats
    const participantStats = participants.map(username => {
      const messageCount = messages.filter(m => m.username === username).length;
      return { username, messageCount };
    }).sort((a, b) => b.messageCount - a.messageCount);

    const participantsInfo = participantStats.length > 0
      ? `${participantStats.length} чел. (${participantStats.map(p => `${p.username}: ${p.messageCount}`).join(', ')})`
      : 'нет данных';

    // Calculate period info
    const durationInSeconds = startTs !== undefined && endTs !== undefined ? endTs - startTs : 0;
    const durationInDays = startTs !== undefined && endTs !== undefined
      ? Math.ceil(durationInSeconds / (24 * 60 * 60))
      : 0;
    const periodInfo = `${startDate} - ${endDate}${durationInDays > 0 ? ` (${durationInDays} дн.)` : ' (в тот же день)'}`;

    // Build user prompt with placeholders replaced
    let userPrompt = env.SUMMARY_PROMPT || this.getDefaultUserPrompt();
    userPrompt = userPrompt.replace('{chatTitle}', chatTitle);
    userPrompt = userPrompt.replace('{startDate}', startDate);
    userPrompt = userPrompt.replace('{endDate}', endDate);
    userPrompt = userPrompt.replace('{totalMessages}', messages.length.toString());
    userPrompt = userPrompt.replace('{participants}', participantsInfo);
    userPrompt = userPrompt.replace('{period}', periodInfo);
    userPrompt = userPrompt.replace('{limitMessages}', limitMessages.toString());
    userPrompt = userPrompt.replace('{messages}', ''); // Messages are added separately by provider

    // Get system prompt
    let systemPrompt = env.SUMMARY_SYSTEM || this.getDefaultSystemPrompt();
    systemPrompt = systemPrompt.replace('{chatTitle}', chatTitle);
    systemPrompt = systemPrompt.replace('{startDate}', startDate);
    systemPrompt = systemPrompt.replace('{endDate}', endDate);
    systemPrompt = systemPrompt.replace('{totalMessages}', messages.length.toString());
    systemPrompt = systemPrompt.replace('{participants}', participantsInfo);
    systemPrompt = systemPrompt.replace('{period}', periodInfo);
    systemPrompt = systemPrompt.replace('{limitMessages}', limitMessages.toString());

    return {
      messages,
      systemPrompt,
      userPrompt,
      limitNote: `Ответ не длиннее ${TELEGRAM_LIMIT} символов. Обработано ${limitMessages} сообщений напрямую.`
    };
  }

  /**
   * Builds AI options based on provider configuration
   */
  private buildAIOptions(env: Env): SummaryOptions {
    const provider = (env as any).SUMMARY_PROVIDER || 'cloudflare';

    let opts: SummaryOptions;

    switch (provider) {
      case 'cloudflare':
        opts = {
          maxTokens: (env as any).CLOUDFLARE_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 400,
          temperature: (env as any).CLOUDFLARE_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: (env as any).CLOUDFLARE_TOP_P ?? env.SUMMARY_TOP_P ?? 0.95,
        };
        const cloudflareFreqPenalty = (env as any).CLOUDFLARE_FREQUENCY_PENALTY ?? env.SUMMARY_FREQUENCY_PENALTY;
        if (cloudflareFreqPenalty !== undefined) {
          opts.frequencyPenalty = cloudflareFreqPenalty;
        }
        const cloudflareSeed = (env as any).CLOUDFLARE_SEED ?? env.SUMMARY_SEED;
        if (cloudflareSeed !== undefined) {
          opts.seed = cloudflareSeed;
        }
        break;

      case 'openai':
        opts = {
          maxTokens: (env as any).OPENAI_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 500,
          temperature: (env as any).OPENAI_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: (env as any).OPENAI_TOP_P ?? env.SUMMARY_TOP_P ?? 0.9,
        };
        const openaiFreqPenalty = (env as any).OPENAI_FREQUENCY_PENALTY ?? env.SUMMARY_FREQUENCY_PENALTY;
        if (openaiFreqPenalty !== undefined) {
          opts.frequencyPenalty = openaiFreqPenalty;
        }
        const openaiSeed = (env as any).OPENAI_SEED ?? env.SUMMARY_SEED;
        if (openaiSeed !== undefined) {
          opts.seed = openaiSeed;
        }
        break;

      case 'openai-premium':
        opts = {
          maxTokens: (env as any).OPENAI_PREMIUM_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 600,
          temperature: (env as any).OPENAI_PREMIUM_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: (env as any).OPENAI_PREMIUM_TOP_P ?? env.SUMMARY_TOP_P ?? 0.85,
        };
        const premiumFreqPenalty = (env as any).OPENAI_PREMIUM_FREQUENCY_PENALTY ?? env.SUMMARY_FREQUENCY_PENALTY;
        if (premiumFreqPenalty !== undefined) {
          opts.frequencyPenalty = premiumFreqPenalty;
        }
        const premiumSeed = (env as any).OPENAI_PREMIUM_SEED ?? env.SUMMARY_SEED;
        if (premiumSeed !== undefined) {
          opts.seed = premiumSeed;
        }
        break;

      default:
        // Fallback to default values
        opts = {
          maxTokens: env.SUMMARY_MAX_TOKENS ?? 300,
          temperature: env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: env.SUMMARY_TOP_P ?? 0.9,
        };
        if (env.SUMMARY_FREQUENCY_PENALTY !== undefined) {
          opts.frequencyPenalty = env.SUMMARY_FREQUENCY_PENALTY;
        }
        if (env.SUMMARY_SEED !== undefined) {
          opts.seed = env.SUMMARY_SEED;
        }
    }

    return opts;
  }

  /**
   * Returns default system prompt if not configured
   */
  private getDefaultSystemPrompt(): string {
    return `Ты аналитик чатов. Твоя задача - создать краткую, но информативную сводку о происходящем в чате.
Сосредоточься на ключевых темах, важных событиях и общей динамике общения.
Выдели основные обсуждаемые вопросы и резюмируй консенсус или разногласия.`;
  }

  /**
   * Returns default user prompt if not configured
   */
  private getDefaultUserPrompt(): string {
    return `Проанализируй следующие сообщения из чата и создай структурированную сводку.

📊 ИНФОРМАЦИЯ О ЧАТЕ:
• Период: {period}
• Участники: {participants}
• Всего сообщений: {totalMessages}

Создай сводку в следующем формате:

📌 ОСНОВНЫЕ ТЕМЫ:
[Перечисли 3-5 ключевых тем обсуждения]

💬 КРАТКОЕ СОДЕРЖАНИЕ:
[Опиши основное содержание разговоров]

👥 АКТИВНОСТЬ УЧАСТНИКОВ:
[Отметь наиболее активных участников и их вклад]

⚡ ВАЖНЫЕ МОМЕНТЫ:
[Выдели ключевые решения, договоренности или важную информацию]

{messages}`;
  }
}

/**
 * Factory function to create a DirectProcessor instance
 */
export function createDirectProcessor(): DirectProcessor {
  return new DirectProcessor();
}
