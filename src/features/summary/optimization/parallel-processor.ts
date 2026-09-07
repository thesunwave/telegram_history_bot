/**
 * Parallel Processor for medium-sized data volumes
 *
 * Handles processing of messages by splitting them into chunks
 * and processing them in parallel, then aggregating the results.
 */

import { DirectProcessor as IDirectProcessor, SummaryContext } from './types';
import { TelegramMessage, SummaryRequest, SummaryOptions, MESSAGE_SEPARATOR } from '../../../core/providers/ai-provider';
import { Env } from '../../../core/env';
import { ProviderFactory } from '../../../core/providers/provider-factory';
import { ContextOptimizer } from './context-optimizer';
import { loadOptimizationConfig } from './config';
import { Logger, PerformanceTracker } from '../../../core/logger';
import { DirectProcessor } from './direct-processor';

export class ParallelProcessor implements IDirectProcessor {
    private contextOptimizer: ContextOptimizer;

    constructor() {
        this.contextOptimizer = null as any;
    }

    /**
     * Processes messages using parallel chunks
     */
    async process(messages: TelegramMessage[], env: Env, context?: SummaryContext): Promise<string> {
        const trackerId = PerformanceTracker.start('parallelProcessor', 'process', {
            messageCount: messages.length
        });

        Logger.debug(env, 'ParallelProcessor: Starting parallel processing', {
            messageCount: messages.length,
            trackerId
        });

        try {
            // Load configuration
            const config = loadOptimizationConfig(env);
            this.contextOptimizer = new ContextOptimizer(config);

            // Determine chunk size and worker count
            const batchSize = config.parallelProcessing.workerBatchSize;
            const metrics = {
                totalMessages: messages.length,
                batchSize,
                chunks: Math.ceil(messages.length / batchSize)
            };

            // Split messages into chunks
            const chunks: TelegramMessage[][] = [];
            for (let i = 0; i < messages.length; i += batchSize) {
                chunks.push(messages.slice(i, i + batchSize));
            }

            Logger.debug(env, 'ParallelProcessor: Created chunks', {
                ...metrics,
                chunkSizes: chunks.map(c => c.length)
            });

            // Process chunks in parallel
            const mapStart = Date.now();
            const chunkPromises = chunks.map((chunk, index) => this.processChunk(chunk, env, index, context));
            const chunkResults = await Promise.all(chunkPromises);
            const mapDuration = Date.now() - mapStart;

            Logger.debug(env, 'ParallelProcessor: Map phase completed', {
                duration: mapDuration,
                resultsCount: chunkResults.length
            });

            // Reduce phase: Aggregate results
            const survivorEntries = chunkResults
                .map((result, index) => ({ result, index }))
                .filter(entry => entry.result && entry.result.trim().length > 0);
            const validResults = survivorEntries.map(entry => entry.result);

            const totalChunks = chunks.length;
            const survivorChunks = validResults.length;
            const coverageRatio = totalChunks > 0 ? survivorChunks / totalChunks : 0;
            const coveredMessages = survivorEntries.reduce(
                (sum, entry) => sum + chunks[entry.index].length,
                0,
            );

            if (survivorChunks === 0) {
                throw new Error('All parallel chunks failed to produce a summary');
            }

            const minCoverage = config.parallelProcessing.minCoverageRatio;
            if (coverageRatio < minCoverage) {
                throw new Error(
                    `Parallel processor coverage collapsed: ${survivorChunks}/${totalChunks} chunks succeeded ` +
                    `(~${coveredMessages}/${messages.length} messages); coverage ` +
                    `${(coverageRatio * 100).toFixed(1)}% below minimum ${(minCoverage * 100).toFixed(1)}%.`
                );
            }

            if (survivorChunks === 1) {
                return validResults[0];
            }

            // Final aggregation
            const reduceStart = Date.now();
            const finalSummary = await this.aggregateResults(validResults, env, context, {
                survivorChunks,
                totalChunks,
                coveredMessages,
                requestedMessages: messages.length,
            });
            const reduceDuration = Date.now() - reduceStart;

            Logger.debug(env, 'ParallelProcessor: Reduce phase completed', {
                duration: reduceDuration,
                finalLength: finalSummary.length
            });

            PerformanceTracker.end(trackerId, {
                messageCount: messages.length,
                chunks: chunks.length,
                mapDuration,
                reduceDuration,
                totalDuration: mapDuration + reduceDuration,
                success: true
            });

            return finalSummary;

        } catch (error) {
            const e = error as Error;
            Logger.error('ParallelProcessor: Processing failed', {
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
     * Processes a single chunk of messages using DirectProcessor
     */
    private async processChunk(
        messages: TelegramMessage[],
        env: Env,
        index: number,
        context?: SummaryContext
    ): Promise<string> {
        const trackerId = PerformanceTracker.start('parallelProcessor', `chunk_${index}`, {
            messageCount: messages.length
        });

        try {
            // Use DirectProcessor for the chunk
            // We pass a modified context to indicate this is a partial summary if needed,
            // but for now, the standard summary is fine as a partial result.
            const processor = new DirectProcessor();

            // Override prompts for partial summarization if specific env vars exist,
            // otherwise standard DirectProcessor will use standard prompts which is okay.
            // Ideally we might want a specific "Partial Summary" prompt.

            // Create a dedicated Env for the chunk if we want to override prompts
            // For now, let's trust the standard summarizer to give a good partial summary.
            // Maybe slightly relax the "finality" of it in the system prompt?
            // Since DirectProcessor reads from Env, we can pass a proxy Env.

            const chunkEnv = {
                ...env,
                // Potentially override prompts here if we had partial-summary specific prompts in env
                SUMMARY_SYSTEM: env.SUMMARY_SYSTEM || this.getPartialSystemPrompt()
            };

            const result = await processor.process(messages, chunkEnv, {
                ...context,
                requestedMessageCount: messages.length
            });

            PerformanceTracker.end(trackerId, {
                success: true,
                resultLength: result.length
            });

            return result;
        } catch (error) {
            Logger.warn(`ParallelProcessor: Chunk ${index} failed`, {
                error: error instanceof Error ? error.message : String(error)
            });
            PerformanceTracker.end(trackerId, {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
            return ""; // Return empty string on failure to allow other chunks to succeed
        }
    }

    /**
     * Aggregates multiple summaries into a final one
     */
    private async aggregateResults(
        summaries: string[],
        env: Env,
        context: SummaryContext | undefined,
        coverage: {
            survivorChunks: number;
            totalChunks: number;
            coveredMessages: number;
            requestedMessages: number;
        },
    ): Promise<string> {
        const provider = ProviderFactory.createProvider(env, 'summary');

        // Create a virtual message list where each "message" is a partial summary
        // We treat them as part of the context for the final summarizer
        const combinedText = summaries.join(`\n\n${MESSAGE_SEPARATOR}\n\n`);

        // We construct a special request for aggregation
        const chatTitle = context?.chatId
            ? `Чат ${context.chatId}` // simplified for log id
            : 'Чат';

        const { survivorChunks, totalChunks, coveredMessages, requestedMessages } = coverage;
        const isPartial = survivorChunks < totalChunks;
        const coverageLine =
            `ℹ️ Покрытие: ${survivorChunks}/${totalChunks} частичных сводок ` +
            `(~${coveredMessages} из ${requestedMessages} сообщений).` +
            (isPartial
                ? ' Покрытие неполное — часть сообщений не учтена. Обязательно начни итоговую сводку с короткой пометки о неполном покрытии.'
                : '');

        const systemPrompt =
            `Ты главный редактор. Твоя задача — объединить несколько частичных сводок одного и того же чата (за разные временные промежутки) в одну связную, логичную и полную итоговую сводку.\n` +
            `Убери повторы, объедини связанные темы и хронологию. Итоговый текст должен читаться как единый документ, а не набор разрозненных частей.` +
            (isPartial
                ? '\n\nВНИМАНИЕ: доступны не все частичные сводки — покрытие чата неполное. Обязательно начни итоговую сводку с короткой пометки о неполном покрытии, чтобы читатель понимал, что охвачена лишь часть переписки.'
                : '');

        const userPrompt =
            `Вот частичные сводки сообщений из чата "${chatTitle}".\n` +
            `Объедини их в одну структурированную итоговую сводку.\n\n` +
            `${coverageLine}\n\n${combinedText}`;

        const request: SummaryRequest = {
            messages: [], // Content is in userPrompt
            systemPrompt,
            userPrompt,
            limitNote: "Ответ не длиннее 4000 символов."
        };

        const options: SummaryOptions = {
            maxTokens: 4000,
            temperature: 0.1,
            topP: 0.9
        };

        return await provider.summarize(request, options, env);
    }

    private getPartialSystemPrompt(): string {
        return `Ты аналитик. Проанализируй этот фрагмент переписки и создай краткую сводку ключевых событий и тем. Не пиши вступлений и заключений, только суть.`;
    }
}
