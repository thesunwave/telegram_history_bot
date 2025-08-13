/**
 * Hierarchical Processor for large data volumes
 * 
 * Implements two-stage processing with preliminary summarization
 * for handling large message volumes that exceed single context limits
 */

import { HierarchicalProcessor as IHierarchicalProcessor, ProcessingPhase } from './types';
import { TelegramMessage, SummaryRequest, SummaryOptions } from '../providers/ai-provider';
import { Env, LOG_ID_RADIX } from '../env';
import { ProviderFactory } from '../providers/provider-factory';
import { ContextOptimizer } from './context-optimizer';
import { loadOptimizationConfig } from './config';
import { Logger, PerformanceTracker } from '../logger';

export class HierarchicalProcessor implements IHierarchicalProcessor {
  private contextOptimizer: ContextOptimizer;

  constructor() {
    // Context optimizer will be initialized with config in process method
    this.contextOptimizer = null as any;
  }

  /**
   * Processes messages using hierarchical two-stage approach
   * Stage 1: Preprocessing chunks with simplified prompts
   * Stage 2: Final summarization of intermediate results
   */
  async process(messages: TelegramMessage[], env: Env): Promise<string> {
    const trackerId = PerformanceTracker.start('hierarchicalProcessor', 'process', { 
      messageCount: messages.length 
    });

    Logger.debug(env, 'HierarchicalProcessor: Starting hierarchical processing', {
      messageCount: messages.length,
      trackerId
    });

    try {
      // Load configuration
      const config = loadOptimizationConfig(env);
      this.contextOptimizer = new ContextOptimizer(config);

      // Create optimal chunks for preprocessing
      const chunks = this.contextOptimizer.createOptimalChunks(
        messages,
        config.contextManagement.preprocessingMaxTokens
      );

      Logger.debug(env, 'HierarchicalProcessor: Messages chunked for preprocessing', {
        originalCount: messages.length,
        chunkCount: chunks.length,
        chunksInfo: chunks.map((chunk, idx) => ({
          index: idx,
          messageCount: chunk.length,
          estimatedTokens: this.contextOptimizer.estimateTokens(chunk)
        }))
      });

      // Stage 1: Preprocess each chunk
      const preprocessingStart = Date.now();
      const intermediateResults = await this.preprocessChunks(chunks, env);
      const preprocessingDuration = Date.now() - preprocessingStart;

      Logger.debug(env, 'HierarchicalProcessor: Preprocessing completed', {
        chunkCount: chunks.length,
        intermediateResultsCount: intermediateResults.length,
        preprocessingDuration
      });

      // Stage 2: Final summarization
      const finalProcessingStart = Date.now();
      const finalSummary = await this.processFinalSummary(
        intermediateResults, 
        messages, 
        env
      );
      const finalProcessingDuration = Date.now() - finalProcessingStart;

      Logger.debug(env, 'HierarchicalProcessor: Final processing completed', {
        finalProcessingDuration,
        totalDuration: preprocessingDuration + finalProcessingDuration,
        resultLength: finalSummary.length
      });

      // Track performance metrics
      PerformanceTracker.end(trackerId, {
        messageCount: messages.length,
        chunkCount: chunks.length,
        preprocessingDuration,
        finalProcessingDuration,
        success: true
      });

      return finalSummary;

    } catch (error) {
      const e = error as Error;
      Logger.error('HierarchicalProcessor: Processing failed', {
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
   * Preprocesses chunks with simplified prompts
   */
  private async preprocessChunks(
    chunks: TelegramMessage[][], 
    env: Env
  ): Promise<string[]> {
    const provider = ProviderFactory.createProvider(env);
    const config = loadOptimizationConfig(env);
    const results: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      Logger.debug(env, `HierarchicalProcessor: Processing chunk ${i + 1}/${chunks.length}`, {
        chunkIndex: i,
        messageCount: chunk.length,
        estimatedTokens: this.contextOptimizer.estimateTokens(chunk)
      });

      try {
        // Build preprocessing request
        const request = this.buildPreprocessingRequest(chunk, i, chunks.length, env, config);
        const options = this.buildPreprocessingOptions(env);

        // Process chunk
        const chunkResult = await provider.summarize(request, options, env);
        results.push(chunkResult);

        Logger.debug(env, `HierarchicalProcessor: Chunk ${i + 1} processed`, {
          chunkIndex: i,
          resultLength: chunkResult.length
        });

      } catch (error) {
        const e = error as Error;
        Logger.error(`HierarchicalProcessor: Failed to process chunk ${i + 1}`, {
          chunkIndex: i,
          error: e.message,
          messageCount: chunk.length
        });
        
        // Continue with partial results if some chunks fail
        results.push(`[Ошибка обработки части ${i + 1}]`);
      }
    }

    return results;
  }

  /**
   * Processes final summary from intermediate results
   */
  private async processFinalSummary(
    intermediateResults: string[], 
    originalMessages: TelegramMessage[],
    env: Env
  ): Promise<string> {
    const provider = ProviderFactory.createProvider(env);
    const config = loadOptimizationConfig(env);

    // Create synthetic messages from intermediate results
    const syntheticMessages: TelegramMessage[] = intermediateResults.map((result, index) => ({
      username: `Часть ${index + 1}`,
      text: result,
      ts: originalMessages[0].ts + index // Sequential timestamps
    }));

    // Build final summary request
    const request = this.buildFinalSummaryRequest(
      syntheticMessages, 
      originalMessages, 
      intermediateResults,
      env,
      config
    );
    const options = this.buildFinalSummaryOptions(env);

    Logger.debug(env, 'HierarchicalProcessor: Processing final summary', {
      intermediateCount: intermediateResults.length,
      totalOriginalMessages: originalMessages.length
    });

    // Process final summary
    const finalSummary = await provider.summarize(request, options, env);

    return finalSummary;
  }

  /**
   * Builds preprocessing request with simplified prompt
   */
  private buildPreprocessingRequest(
    messages: TelegramMessage[], 
    chunkIndex: number,
    totalChunks: number,
    env: Env,
    config: any
  ): SummaryRequest {
    // Get preprocessing prompt from config or use default
    const preprocessingPrompt = config.hierarchicalProcessing.preprocessingPrompt || 
      this.getDefaultPreprocessingPrompt();

    // Build system prompt for preprocessing
    const systemPrompt = this.getPreprocessingSystemPrompt();

    // Format messages for preprocessing
    const userPrompt = preprocessingPrompt
      .replace('{chunkNumber}', (chunkIndex + 1).toString())
      .replace('{totalChunks}', totalChunks.toString())
      .replace('{messageCount}', messages.length.toString());

    return {
      messages,
      systemPrompt,
      userPrompt,
      limitNote: `Предобработка части ${chunkIndex + 1} из ${totalChunks}`
    };
  }

  /**
   * Builds final summary request
   */
  private buildFinalSummaryRequest(
    syntheticMessages: TelegramMessage[],
    originalMessages: TelegramMessage[],
    intermediateResults: string[],
    env: Env,
    config: any
  ): SummaryRequest {
    // Extract participant information from original messages
    const participants = [...new Set(originalMessages.map(m => m.username))];
    const firstMsg = originalMessages[0];
    const lastMsg = originalMessages[originalMessages.length - 1];
    const startDate = new Date(firstMsg.ts * 1000).toLocaleDateString('ru-RU');
    const endDate = new Date(lastMsg.ts * 1000).toLocaleDateString('ru-RU');
    
    // Create participant stats
    const participantStats = participants.map(username => {
      const messageCount = originalMessages.filter(m => m.username === username).length;
      return { username, messageCount };
    }).sort((a, b) => b.messageCount - a.messageCount);

    const participantsInfo = participantStats.length > 0
      ? `${participantStats.length} чел. (${participantStats.map(p => `${p.username}: ${p.messageCount}`).join(', ')})`
      : 'нет данных';

    // Calculate period info
    const durationInSeconds = lastMsg.ts - firstMsg.ts;
    const durationInDays = Math.floor(durationInSeconds / (24 * 60 * 60));
    const periodInfo = `${startDate} - ${endDate}${durationInDays > 0 ? ` (${durationInDays} дн.)` : ' (в тот же день)'}`;

    // Build user prompt with placeholders replaced
    let userPrompt = env.SUMMARY_PROMPT || this.getDefaultFinalPrompt();
    userPrompt = userPrompt.replace('{chatTitle}', 'Hierarchical Processing Chat');
    userPrompt = userPrompt.replace('{startDate}', startDate);
    userPrompt = userPrompt.replace('{endDate}', endDate);
    userPrompt = userPrompt.replace('{totalMessages}', originalMessages.length.toString());
    userPrompt = userPrompt.replace('{participants}', participantsInfo);
    userPrompt = userPrompt.replace('{period}', periodInfo);
    userPrompt = userPrompt.replace('{messages}', ''); // Messages are added separately by provider

    // Add context about intermediate processing
    const contextNote = `\n\n📊 Обработано через иерархическую суммаризацию:\n` +
      `• Исходных сообщений: ${originalMessages.length}\n` +
      `• Промежуточных частей: ${intermediateResults.length}\n` +
      `• Каждая часть содержит предварительную сводку группы сообщений`;

    userPrompt = userPrompt + contextNote;

    // Get system prompt
    let systemPrompt = env.SUMMARY_SYSTEM || this.getDefaultFinalSystemPrompt();
    systemPrompt = systemPrompt.replace('{chatTitle}', 'Hierarchical Processing Chat');
    systemPrompt = systemPrompt.replace('{startDate}', startDate);
    systemPrompt = systemPrompt.replace('{endDate}', endDate);
    systemPrompt = systemPrompt.replace('{totalMessages}', originalMessages.length.toString());
    systemPrompt = systemPrompt.replace('{participants}', participantsInfo);
    systemPrompt = systemPrompt.replace('{period}', periodInfo);

    return {
      messages: syntheticMessages,
      systemPrompt,
      userPrompt,
      limitNote: `Финальная обработка ${intermediateResults.length} промежуточных результатов`
    };
  }

  /**
   * Builds AI options for preprocessing stage
   */
  private buildPreprocessingOptions(env: Env): SummaryOptions {
    const config = loadOptimizationConfig(env);
    const provider = (env as any).SUMMARY_PROVIDER || 'cloudflare';

    // Use reduced tokens for preprocessing to save resources
    const baseMaxTokens = config.contextManagement.preprocessingMaxTokens;
    const reducedMaxTokens = Math.floor(baseMaxTokens * 0.6); // Use 60% of max for preprocessing

    let opts: SummaryOptions = {
      maxTokens: reducedMaxTokens,
      temperature: 0.3, // Lower temperature for more consistent preprocessing
      topP: 0.9
    };

    // Provider-specific adjustments
    switch (provider) {
      case 'cloudflare':
        opts.maxTokens = Math.min(reducedMaxTokens, 300);
        break;
      case 'openai':
        opts.maxTokens = Math.min(reducedMaxTokens, 400);
        break;
      case 'openai-premium':
        opts.maxTokens = Math.min(reducedMaxTokens, 500);
        break;
    }

    return opts;
  }

  /**
   * Builds AI options for final summary stage
   */
  private buildFinalSummaryOptions(env: Env): SummaryOptions {
    const config = loadOptimizationConfig(env);
    const provider = (env as any).SUMMARY_PROVIDER || 'cloudflare';

    let opts: SummaryOptions;

    switch (provider) {
      case 'cloudflare':
        opts = {
          maxTokens: (env as any).CLOUDFLARE_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 400,
          temperature: (env as any).CLOUDFLARE_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: (env as any).CLOUDFLARE_TOP_P ?? env.SUMMARY_TOP_P ?? 0.95,
        };
        break;

      case 'openai':
        opts = {
          maxTokens: (env as any).OPENAI_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 500,
          temperature: (env as any).OPENAI_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: (env as any).OPENAI_TOP_P ?? env.SUMMARY_TOP_P ?? 0.9,
        };
        break;

      case 'openai-premium':
        opts = {
          maxTokens: (env as any).OPENAI_PREMIUM_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 600,
          temperature: (env as any).OPENAI_PREMIUM_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: (env as any).OPENAI_PREMIUM_TOP_P ?? env.SUMMARY_TOP_P ?? 0.85,
        };
        break;

      default:
        opts = {
          maxTokens: env.SUMMARY_MAX_TOKENS ?? 300,
          temperature: env.SUMMARY_TEMPERATURE ?? 0.0,
          topP: env.SUMMARY_TOP_P ?? 0.9,
        };
    }

    // Use higher max tokens for final summary
    opts.maxTokens = Math.floor(opts.maxTokens * 1.5);

    return opts;
  }

  /**
   * Returns default preprocessing prompt
   */
  private getDefaultPreprocessingPrompt(): string {
    return `Создай краткую сводку для части {chunkNumber} из {totalChunks}.
Эта часть содержит {messageCount} сообщений.

Сосредоточься на:
- Основных темах обсуждения
- Ключевых участниках и их позициях
- Важных решениях или договоренностях
- Значимых событиях

Сводка должна быть лаконичной, но сохранять всю важную информацию.

{messages}`;
  }

  /**
   * Returns system prompt for preprocessing
   */
  private getPreprocessingSystemPrompt(): string {
    return `Ты помощник для предварительной обработки сообщений чата.
Твоя задача - создать промежуточную сводку части сообщений, которая будет использована для финальной суммаризации.
Сохраняй только важную информацию, опуская несущественные детали.
Будь объективным и точным в передаче смысла обсуждений.`;
  }

  /**
   * Returns default final prompt
   */
  private getDefaultFinalPrompt(): string {
    return `Проанализируй промежуточные сводки и создай финальную структурированную сводку.

📊 ИНФОРМАЦИЯ О ЧАТЕ:
• Период: {period}
• Участники: {participants}
• Всего сообщений: {totalMessages}

Создай сводку в следующем формате:

📌 ОСНОВНЫЕ ТЕМЫ:
[Перечисли 3-5 ключевых тем обсуждения на основе всех частей]

💬 КРАТКОЕ СОДЕРЖАНИЕ:
[Объедини информацию из всех частей в связное описание]

👥 АКТИВНОСТЬ УЧАСТНИКОВ:
[Отметь наиболее активных участников и их общий вклад]

⚡ ВАЖНЫЕ МОМЕНТЫ:
[Выдели ключевые решения, договоренности или важную информацию из всех частей]

🔄 ДИНАМИКА ОБСУЖДЕНИЯ:
[Опиши как развивалось обсуждение через все части]

{messages}`;
  }

  /**
   * Returns default system prompt for final processing
   */
  private getDefaultFinalSystemPrompt(): string {
    return `Ты аналитик чатов, специализирующийся на создании финальных сводок.
Твоя задача - объединить промежуточные сводки в единый, связный и информативный отчет.
Обеспечь целостность повествования и выдели самые важные аспекты обсуждения.
Избегай повторений и сохраняй логическую структуру.`;
  }
}

/**
 * Factory function to create a HierarchicalProcessor instance
 */
export function createHierarchicalProcessor(): HierarchicalProcessor {
  return new HierarchicalProcessor();
}
