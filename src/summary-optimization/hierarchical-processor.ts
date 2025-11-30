/**
 * Hierarchical Processor for large data volumes
 * 
 * Implements two-stage processing with preliminary summarization
 * for handling large message volumes that exceed single context limits
 */

import { HierarchicalProcessor as IHierarchicalProcessor, ProcessingPhase, ChunkUserSummaries, AggregatedUserSummary, SummaryContext } from './types';
import { TelegramMessage, SummaryRequest, SummaryOptions } from '../providers/ai-provider';
import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from '../env';
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
   * Processes messages using hierarchical approach with per-user aggregation
   * Stage 1: Per-chunk per-user summaries (JSON)
   * Stage 2: Aggregate per-user summaries across chunks
   * Stage 3: Final summarization of aggregated user summaries
   */
  async process(messages: TelegramMessage[], env: Env, context?: SummaryContext): Promise<string> {
    const trackerId = PerformanceTracker.start('hierarchicalProcessor', 'process', { 
      messageCount: messages.length 
    });

    Logger.debug(env, 'HierarchicalProcessor: Starting hierarchical processing (per-user)', {
      messageCount: messages.length,
      chat: context?.chatId ? context.chatId.toString(LOG_ID_RADIX) : undefined,
      trackerId
    });

    // Guard: empty messages should be rejected
    if (!messages || messages.length === 0) {
      Logger.warn('HierarchicalProcessor: No messages provided for processing', {
        messageCount: messages ? messages.length : 0,
        trackerId
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
      const { modelLimits } = config;

      const outputTokensBudget = Math.min(
        config.contextManagement.outputTokensTarget,
        config.contextManagement.finalMaxTokens,
        modelLimits.maxOutputTokens
      );
      const preprocessingInputBudget = Math.max(
        1000,
        Math.min(
          config.contextManagement.preprocessingMaxTokens,
          modelLimits.maxContextTokens - outputTokensBudget
        )
      );

      // Create optimal chunks for preprocessing
      const chunks = this.contextOptimizer.createOptimalChunks(
        messages,
        preprocessingInputBudget
      );

      Logger.debug(env, 'HierarchicalProcessor: Messages chunked for preprocessing', {
        originalCount: messages.length,
        chunkCount: chunks.length,
        chunksInfo: chunks.map((chunk, idx) => ({
          index: idx,
          messageCount: chunk.length,
          estimatedTokens: this.contextOptimizer.estimateTokens(chunk)
        })),
        budgets: {
          outputTokensBudget,
          preprocessingInputBudget,
          model: modelLimits.name
        }
      });

      // Stage 1: Preprocess each chunk into per-user summaries
      const preprocessingStart = Date.now();
      const chunkUserSummaries = await this.preprocessChunksPerUser(chunks, env);
      const preprocessingDuration = Date.now() - preprocessingStart;

      Logger.debug(env, 'HierarchicalProcessor: Per-user preprocessing completed', {
        chunkCount: chunks.length,
        resultsCount: chunkUserSummaries.length,
        preprocessingDuration
      });

      // Stage 2: Aggregate per-user summaries across chunks
      const aggregationStart = Date.now();
      const aggregated = this.aggregateUserSummaries(chunkUserSummaries);
      const aggregationDuration = Date.now() - aggregationStart;

      Logger.debug(env, 'HierarchicalProcessor: Aggregation completed', {
        users: aggregated.length,
        aggregationDuration
      });

      // Stage 3: Final summarization
      const finalProcessingStart = Date.now();
      const finalSummary = await this.processFinalSummaryForUsers(
        aggregated,
        messages,
        env,
        context
      );
      const finalProcessingDuration = Date.now() - finalProcessingStart;

      Logger.debug(env, 'HierarchicalProcessor: Final processing completed', {
        finalProcessingDuration,
        totalDuration: preprocessingDuration + aggregationDuration + finalProcessingDuration,
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
   * Preprocesses chunks with per-user JSON summaries
   */
  private async preprocessChunksPerUser(
    chunks: TelegramMessage[][],
    env: Env
  ): Promise<ChunkUserSummaries[]> {
    const provider = ProviderFactory.createProvider(env, 'summary');
    const config = loadOptimizationConfig(env);
    const results: ChunkUserSummaries[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      Logger.debug(env, `HierarchicalProcessor: Processing chunk ${i + 1}/${chunks.length} (per-user)`, {
        chunkIndex: i,
        messageCount: chunk.length,
        estimatedTokens: this.contextOptimizer.estimateTokens(chunk)
      });

      try {
        // Build preprocessing request (per-user JSON)
        const request = this.buildPreprocessingRequestForUsers(chunk, i, chunks.length, env, config);
        const options = this.buildPreprocessingOptions(env);
        options.forceJsonResponse = true; // enforce JSON only for per-user preprocessing

        // Process chunk
        const raw = await provider.summarize(request, options, env);
        const parsed = this.parseChunkUserSummaries(raw, i);
        results.push(parsed);

        Logger.debug(env, `HierarchicalProcessor: Chunk ${i + 1} processed (per-user)`, {
          chunkIndex: i,
          users: parsed.userSummaries.length
        });

      } catch (error) {
        const e = error as Error;
        Logger.error(`HierarchicalProcessor: Failed to process chunk ${i + 1} (per-user)`, {
          chunkIndex: i,
          error: e.message,
          messageCount: chunk.length
        });

        // Continue with empty per-user result if some chunks fail
        results.push({ chunkIndex: i, userSummaries: [] });
      }
    }

    return results;
  }

  /**
   * Aggregate per-user summaries across all chunks
   */
  private aggregateUserSummaries(chunkSummaries: ChunkUserSummaries[]): AggregatedUserSummary[] {
    const map = new Map<string, AggregatedUserSummary>();

    for (const chunk of chunkSummaries) {
      for (const us of chunk.userSummaries) {
        const key = us.username.trim();
        if (!key) continue;

        if (!map.has(key)) {
          map.set(key, {
            username: key,
            totalMessageCount: us.messageCount || 0,
            aggregatedSummary: us.summary || '',
            chunkContributions: [chunk.chunkIndex]
          });
        } else {
          const agg = map.get(key)!;
          agg.totalMessageCount += us.messageCount || 0;
          // Concatenate summaries with separators, avoiding duplicates
          const part = (us.summary || '').trim();
          if (part) {
            if (agg.aggregatedSummary) {
              agg.aggregatedSummary += `\n- ${part}`;
            } else {
              agg.aggregatedSummary = part;
            }
          }
          if (!agg.chunkContributions.includes(chunk.chunkIndex)) {
            agg.chunkContributions.push(chunk.chunkIndex);
          }
        }
      }
    }

    // Sort users by message count desc
    return Array.from(map.values()).sort((a, b) => b.totalMessageCount - a.totalMessageCount);
  }

  /**
   * Build final summary from aggregated per-user summaries
   */
  private async processFinalSummaryForUsers(
    aggregated: AggregatedUserSummary[],
    originalMessages: TelegramMessage[],
    env: Env,
    context?: SummaryContext
  ): Promise<string> {
    const provider = ProviderFactory.createProvider(env, 'summary');

    // Create synthetic messages where each message represents a user's aggregated summary
    const baseTs = originalMessages.length > 0 ? originalMessages[0].ts : Math.floor(Date.now() / 1000);
    const syntheticMessages: TelegramMessage[] = aggregated.map((u, index) => ({
      username: u.username,
      text: `Total messages: ${u.totalMessageCount}. Summary: ${u.aggregatedSummary}`,
      ts: baseTs + index
    }));

    const request = this.buildFinalSummaryRequestForUsers(
      syntheticMessages,
      originalMessages,
      aggregated,
      env,
      loadOptimizationConfig(env),
      context
    );

    const options = this.buildFinalSummaryOptions(env);

    Logger.debug(env, 'HierarchicalProcessor: Processing final summary (per-user)', {
      syntheticCount: syntheticMessages.length,
      totalOriginalMessages: originalMessages.length
    });

    const finalSummary = await provider.summarize(request, options, env);
    return finalSummary;
  }

  /**
   * Builds preprocessing request that enforces per-user JSON summaries
   */
  private buildPreprocessingRequestForUsers(
    messages: TelegramMessage[],
    chunkIndex: number,
    totalChunks: number,
    env: Env,
    config: any
  ): SummaryRequest {
    const systemPrompt = this.getPreprocessingSystemPromptForUsers();

    // Strict JSON instruction with schema
    const userPrompt = `Ты получишь сообщения чата. Создай краткие выжимки по КАЖДОМУ пользователю отдельно для части ${chunkIndex + 1} из ${totalChunks}.\n\nТребования:\n- Сохраняй ИСХОДНЫЕ имена пользователей без выдумывания новых\n- Игнорируй служебные сообщения и ботов\n- Объединяй повторы, сохраняя суть\n- Пиши кратко и по делу\n\nФормат ответa ТОЛЬКО строгий JSON без комментариев:\n{\n  "chunkIndex": ${chunkIndex},\n  "userSummaries": [\n    { "username": "имя", "messageCount": число, "summary": "краткая выжимка" }\n  ]\n}\n\nЕсли в части нет существенных сообщений, верни {"chunkIndex": ${chunkIndex}, "userSummaries": []}.\n\n{messages}`;

    return {
      messages,
      systemPrompt,
      userPrompt,
      limitNote: `Персональная предобработка части ${chunkIndex + 1} из ${totalChunks}`
    };
  }

  /**
   * Build final request leveraging aggregated per-user summaries
   */
  private buildFinalSummaryRequestForUsers(
    syntheticMessages: TelegramMessage[],
    originalMessages: TelegramMessage[],
    aggregated: AggregatedUserSummary[],
    env: Env,
    config: any,
    context?: SummaryContext
  ): SummaryRequest {
    // Extract participant information from original messages
    const participants = [...new Set(originalMessages.map(m => m.username))];
    const chatTitle = context?.chatId
      ? `Чат ${context.chatId.toString(LOG_ID_RADIX)}`
      : 'Неизвестный чат';
    const limitMessages = context?.requestedMessageCount ?? originalMessages.length;
    const firstMsg = originalMessages[0] || { ts: context?.periodStart ?? Math.floor(Date.now() / 1000) } as TelegramMessage;
    const lastMsg = originalMessages[originalMessages.length - 1] || firstMsg;
    const startTs = context?.periodStart ?? firstMsg.ts;
    const endTs = context?.periodEnd ?? lastMsg.ts;
    const startDate = new Date(startTs * 1000).toLocaleDateString('ru-RU');
    const endDate = new Date(endTs * 1000).toLocaleDateString('ru-RU');

    // Create participant stats
    const participantStats = participants.map(username => {
      const messageCount = originalMessages.filter(m => m.username === username).length;
      return { username, messageCount };
    }).sort((a, b) => b.messageCount - a.messageCount);

    const participantsInfo = participantStats.length > 0
      ? `${participantStats.length} чел. (${participantStats.map(p => `${p.username}: ${p.messageCount}`).join(', ')})`
      : 'нет данных';

    // Calculate period info
    const durationInSeconds = endTs - startTs;
    const durationInDays = Math.ceil(durationInSeconds / (24 * 60 * 60));
    const periodInfo = `${startDate} - ${endDate}${durationInDays > 0 ? ` (${durationInDays} дн.)` : ' (в тот же день)'}`;

    // Build user prompt with placeholders replaced
    let userPrompt = env.SUMMARY_PROMPT || this.getDefaultFinalPrompt();
    userPrompt = userPrompt.replace('{chatTitle}', chatTitle);
    userPrompt = userPrompt.replace('{startDate}', startDate);
    userPrompt = userPrompt.replace('{endDate}', endDate);
    userPrompt = userPrompt.replace('{totalMessages}', originalMessages.length.toString());
    userPrompt = userPrompt.replace('{participants}', participantsInfo);
    userPrompt = userPrompt.replace('{period}', periodInfo);
    userPrompt = userPrompt.replace('{limitMessages}', limitMessages.toString());
    userPrompt = userPrompt.replace('{messages}', ''); // Messages are added separately by provider

    // Add context note about per-user aggregation
    const contextNote = `\n\n📊 Данные подготовлены как выжимки по каждому пользователю (агрегировано по всем частям).\nВАЖНО: используй имена пользователей из сообщений как есть, не выдумывай новых.`;
    userPrompt = userPrompt + contextNote;

    // System prompt
    let systemPrompt = env.SUMMARY_SYSTEM || this.getDefaultFinalSystemPrompt();
    systemPrompt = systemPrompt.replace('{chatTitle}', chatTitle);
    systemPrompt = systemPrompt.replace('{startDate}', startDate);
    systemPrompt = systemPrompt.replace('{endDate}', endDate);
    systemPrompt = systemPrompt.replace('{totalMessages}', originalMessages.length.toString());
    systemPrompt = systemPrompt.replace('{participants}', participantsInfo);
    systemPrompt = systemPrompt.replace('{period}', periodInfo);
    systemPrompt = systemPrompt.replace('{limitMessages}', limitMessages.toString());

    return {
      messages: syntheticMessages,
      systemPrompt,
      userPrompt,
      limitNote: `Ответ не длиннее ${TELEGRAM_LIMIT} символов. Финальная обработка агрегированных пользовательских выжимок (${aggregated.length} пользователей).`
    };
  }

  /**
   * Parse provider response into ChunkUserSummaries
   */
  private parseChunkUserSummaries(response: string, chunkIndex: number): ChunkUserSummaries {
    try {
      let clean = (response || '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      if (jsonMatch) clean = jsonMatch[0];
      const parsed = JSON.parse(clean);

      const arr = Array.isArray(parsed.userSummaries) ? parsed.userSummaries : [];
      const userSummaries = arr
        .map((u: any) => {
          const username = typeof u.username === 'string' ? u.username.trim() : '';
          const messageCount = typeof u.messageCount === 'number' && isFinite(u.messageCount) ? u.messageCount : 0;
          const summary = typeof u.summary === 'string' ? u.summary.trim() : '';
          if (!username) return null;
          return { username, messageCount, summary };
        })
        .filter((v: any): v is { username: string; messageCount: number; summary: string } => !!v);

      return { chunkIndex, userSummaries };
    } catch (e) {
      return { chunkIndex, userSummaries: [] };
    }
  }

  /**
   * Legacy: Preprocesses chunks with simplified prompts (kept for compatibility)
   */
  private async preprocessChunks(
    chunks: TelegramMessage[][], 
    env: Env
  ): Promise<string[]> {
    const provider = ProviderFactory.createProvider(env, 'summary');
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
   * Legacy: Processes final summary from intermediate results (kept for compatibility)
   */
  private async processFinalSummary(
    intermediateResults: string[], 
    originalMessages: TelegramMessage[],
    env: Env,
    context?: SummaryContext
  ): Promise<string> {
    const provider = ProviderFactory.createProvider(env, 'summary');
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
      config,
      context
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
   * Builds preprocessing request with simplified prompt (legacy)
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
   * Builds final summary request (legacy)
   */
  private buildFinalSummaryRequest(
    syntheticMessages: TelegramMessage[],
    originalMessages: TelegramMessage[],
    intermediateResults: string[],
    env: Env,
    config: any,
    context?: SummaryContext
  ): SummaryRequest {
    // Extract participant information from original messages
    const participants = [...new Set(originalMessages.map(m => m.username))];
    const chatTitle = context?.chatId
      ? `Чат ${context.chatId.toString(LOG_ID_RADIX)}`
      : 'Неизвестный чат';
    const limitMessages = context?.requestedMessageCount ?? originalMessages.length;
    const firstMsg = originalMessages[0] || { ts: context?.periodStart ?? Math.floor(Date.now() / 1000) } as TelegramMessage;
    const lastMsg = originalMessages[originalMessages.length - 1] || firstMsg;
    const startTs = context?.periodStart ?? firstMsg.ts;
    const endTs = context?.periodEnd ?? lastMsg.ts;
    const startDate = new Date(startTs * 1000).toLocaleDateString('ru-RU');
    const endDate = new Date(endTs * 1000).toLocaleDateString('ru-RU');
    
    // Create participant stats
    const participantStats = participants.map(username => {
      const messageCount = originalMessages.filter(m => m.username === username).length;
      return { username, messageCount };
    }).sort((a, b) => b.messageCount - a.messageCount);

    const participantsInfo = participantStats.length > 0
      ? `${participantStats.length} чел. (${participantStats.map(p => `${p.username}: ${p.messageCount}`).join(', ')})`
      : 'нет данных';

    // Calculate period info
    const durationInSeconds = endTs - startTs;
    const durationInDays = Math.ceil(durationInSeconds / (24 * 60 * 60));
    const periodInfo = `${startDate} - ${endDate}${durationInDays > 0 ? ` (${durationInDays} дн.)` : ' (в тот же день)'}`;

    // Build user prompt with placeholders replaced
    let userPrompt = env.SUMMARY_PROMPT || this.getDefaultFinalPrompt();
    userPrompt = userPrompt.replace('{chatTitle}', chatTitle);
    userPrompt = userPrompt.replace('{startDate}', startDate);
    userPrompt = userPrompt.replace('{endDate}', endDate);
    userPrompt = userPrompt.replace('{totalMessages}', originalMessages.length.toString());
    userPrompt = userPrompt.replace('{participants}', participantsInfo);
    userPrompt = userPrompt.replace('{period}', periodInfo);
    userPrompt = userPrompt.replace('{limitMessages}', limitMessages.toString());
    userPrompt = userPrompt.replace('{messages}', ''); // Messages are added separately by provider

    // Add context about intermediate processing
    const contextNote = `\n\n📊 Обработано через иерархическую суммаризацию:\n` +
      `• Исходных сообщений: ${originalMessages.length}\n` +
      `• Промежуточных частей: ${intermediateResults.length}\n` +
      `• Каждая часть содержит предварительную сводку группы сообщений`;

    userPrompt = userPrompt + contextNote;

    // Get system prompt
    let systemPrompt = env.SUMMARY_SYSTEM || this.getDefaultFinalSystemPrompt();
    systemPrompt = systemPrompt.replace('{chatTitle}', chatTitle);
    systemPrompt = systemPrompt.replace('{startDate}', startDate);
    systemPrompt = systemPrompt.replace('{endDate}', endDate);
    systemPrompt = systemPrompt.replace('{totalMessages}', originalMessages.length.toString());
    systemPrompt = systemPrompt.replace('{participants}', participantsInfo);
    systemPrompt = systemPrompt.replace('{period}', periodInfo);
    systemPrompt = systemPrompt.replace('{limitMessages}', limitMessages.toString());

    return {
      messages: syntheticMessages,
      systemPrompt,
      userPrompt,
      limitNote: `Ответ не длиннее ${TELEGRAM_LIMIT} символов. Финальная обработка ${intermediateResults.length} промежуточных результатов.`
    };
  }

  /**
   * Builds AI options for preprocessing stage
   */
  private buildPreprocessingOptions(env: Env): SummaryOptions {
    const config = loadOptimizationConfig(env);
    const { modelLimits } = config;
    const provider = (env as any).SUMMARY_PROVIDER || 'cloudflare';

    const outputBudget = Math.min(
      config.contextManagement.outputTokensTarget,
      config.contextManagement.finalMaxTokens,
      modelLimits.maxOutputTokens
    );

    // Keep preprocessing responses compact to reduce downstream cost
    const baseMaxTokens = Math.floor(outputBudget * 0.25);
    const compactBudget = Math.max(500, Math.min(baseMaxTokens, 4000));

    const providerCaps: Record<string, number> = {
      cloudflare: 1200,
      openai: 4000,
      'openai-premium': 6000
    };

    const providerCap = providerCaps[provider] ?? compactBudget;

    return {
      maxTokens: Math.min(compactBudget, providerCap, modelLimits.maxOutputTokens),
      temperature: 0.2, // Lower temperature for consistency in JSON
      topP: 0.9
    };
  }

  /**
   * Builds AI options for final summary stage
   */
  private buildFinalSummaryOptions(env: Env): SummaryOptions {
    const config = loadOptimizationConfig(env);
    const provider = (env as any).SUMMARY_PROVIDER || 'cloudflare';
    const { modelLimits } = config;

    const outputBudget = Math.min(
      config.contextManagement.outputTokensTarget,
      config.contextManagement.finalMaxTokens,
      modelLimits.maxOutputTokens
    );

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

    // Clamp to detected model/output budget
    opts.maxTokens = Math.min(opts.maxTokens ?? outputBudget, outputBudget, modelLimits.maxOutputTokens);

    return opts;
  }

  /**
   * Returns default preprocessing prompt (legacy)
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
   * Returns system prompt for preprocessing (legacy)
   */
  private getPreprocessingSystemPrompt(): string {
    return `Ты помощник для предварительной обработки сообщений чата.
Твоя задача - создать промежуточную сводку части сообщений, которая будет использована для финальной суммаризации.
Сохраняй только важную информацию, опуская несущественные детали.
Будь объективным и точным в передаче смысла обсуждений.`;
  }

  /**
   * Returns system prompt for per-user preprocessing
   */
  private getPreprocessingSystemPromptForUsers(): string {
    return `Ты помощник для предварительной обработки сообщений чата.
Твоя задача — сформировать выжимки по каждому пользователю (персонально) в строгом формате JSON.
Важно: сохраняй ИСХОДНЫЕ имена пользователей без выдумывания новых, не добавляй комментарии вне JSON.`;
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
