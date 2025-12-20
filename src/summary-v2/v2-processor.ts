/**
 * V2 Processor - Main Pipeline Coordinator
 * 
 * ADR-002: Coordinates the two-layer summary pipeline:
 * 1. Check cache
 * 2. Layer 1: Event Log Builder (nano)
 * 3. Layer 2: Story Summarizer (mini)
 * 4. Store in cache
 * 5. Return result
 */

import { Env, LOG_ID_RADIX } from '../env';
import { Logger, PerformanceTracker } from '../logger';
import { TelegramMessage } from '../providers/ai-provider';
import { getLLMFeatureModes, isFeatureDisabled } from '../llm';
import {
    SummaryV2Result,
    SummaryV2Config,
    SummaryV2Context,
    DEFAULT_V2_CONFIG,
    EventLog,
} from './types';
import { buildEventLog } from './event-log-builder';
import { summarizeEventLog } from './story-summarizer';
import {
    getCacheKey,
    getCacheKeyFromPeriod,
    getCached,
    setCache
} from './summary-cache';
import { loadV2Config } from './config';

/**
 * Main V2 processor class implementing DirectProcessor interface
 */
export class V2Processor {
    /**
     * Process messages through the V2 pipeline
     */
    async process(
        messages: TelegramMessage[],
        env: Env,
        context?: SummaryV2Context
    ): Promise<string> {
        const trackerId = PerformanceTracker.start('v2Processor', 'process', {
            messageCount: messages.length,
        });

        const config = loadV2Config(env);

        // Build context if not provided
        const ctx: SummaryV2Context = context || {
            chatId: 0,
            periodStart: messages[0]?.ts,
            periodEnd: messages[messages.length - 1]?.ts,
            requestedMessageCount: messages.length,
        };

        Logger.debug(env, 'V2 Processor: starting', {
            chatId: ctx.chatId?.toString(LOG_ID_RADIX),
            messageCount: messages.length,
            config: {
                enabled: config.enabled,
                maxMessagesPerBatch: config.maxMessagesPerBatch,
                maxNanoCalls: config.maxNanoCalls,
            },
        });

        try {
            // Check feature mode
            const modes = getLLMFeatureModes();
            if (isFeatureDisabled('summary', modes)) {
                Logger.warn('V2 Processor: summary disabled due to budget', {
                    chatId: ctx.chatId?.toString(LOG_ID_RADIX),
                });
                PerformanceTracker.end(trackerId, { success: false, reason: 'disabled' });
                throw new Error('Summary feature is disabled due to budget limits');
            }

            // Step 1: Check cache
            const lastMessageTs = messages[messages.length - 1]?.ts || 0;
            const cacheKey = ctx.lastMessageId
                ? getCacheKey(ctx.chatId, ctx.lastMessageId, config.version)
                : getCacheKeyFromPeriod(
                    ctx.chatId,
                    ctx.periodStart || messages[0]?.ts || 0,
                    ctx.periodEnd || lastMessageTs,
                    messages.length,
                    config.version
                );

            const cached = await getCached(cacheKey, env);
            if (cached) {
                Logger.debug(env, 'V2 Processor: cache hit', {
                    chatId: ctx.chatId?.toString(LOG_ID_RADIX),
                    cacheKey: cacheKey.substring(0, 40) + '...',
                });
                PerformanceTracker.end(trackerId, {
                    success: true,
                    fromCache: true,
                    summaryLength: cached.summary.length,
                });
                return cached.summary;
            }

            // Step 2: Layer 1 - Build event log
            const layer1Start = Date.now();
            const eventLog = await buildEventLog(messages, env, ctx, config);
            const layer1Duration = Date.now() - layer1Start;

            Logger.debug(env, 'V2 Processor: Layer 1 complete', {
                chatId: ctx.chatId?.toString(LOG_ID_RADIX),
                eventCount: eventLog.events.length,
                layer1Duration,
            });

            // Step 3: Layer 2 - Summarize event log
            const layer2Start = Date.now();
            const result = await summarizeEventLog(eventLog, env, config);
            const layer2Duration = Date.now() - layer2Start;

            // Update metadata with accurate durations
            result.metadata.layer1Duration = layer1Duration;
            result.metadata.layer2Duration = layer2Duration;

            Logger.debug(env, 'V2 Processor: Layer 2 complete', {
                chatId: ctx.chatId?.toString(LOG_ID_RADIX),
                summaryLength: result.summary.length,
                layer2Duration,
            });

            // Step 4: Store in cache
            await setCache(cacheKey, result, messages.length, env, config);

            // Log final metrics - always visible for comparison
            const totalDuration = layer1Duration + layer2Duration;
            console.log(`[V2_METRICS] messages=${messages.length} events=${eventLog.events.length} ` +
                `L1=${layer1Duration}ms L2=${layer2Duration}ms total=${totalDuration}ms ` +
                `summary=${result.summary.length}chars`);

            Logger.debug(env, 'V2 Processor: complete', {
                chatId: ctx.chatId?.toString(LOG_ID_RADIX),
                messageCount: messages.length,
                eventCount: eventLog.events.length,
                summaryLength: result.summary.length,
                topicCount: result.topics.length,
                participantCount: Object.keys(result.participantRoles).length,
                layer1Duration,
                layer2Duration,
                totalDuration,
                cached: false,
            });

            PerformanceTracker.end(trackerId, {
                success: true,
                fromCache: false,
                eventCount: eventLog.events.length,
                summaryLength: result.summary.length,
                layer1Duration,
                layer2Duration,
            });

            return result.summary;

        } catch (error) {
            const e = error as Error;
            Logger.error('V2 Processor: failed', {
                chatId: ctx.chatId?.toString(LOG_ID_RADIX),
                error: e.message,
                stack: e.stack,
            });

            PerformanceTracker.end(trackerId, {
                success: false,
                error: e.message,
            });

            throw error;
        }
    }

    /**
     * Get full result including metadata (for debugging/testing)
     */
    async processWithMetadata(
        messages: TelegramMessage[],
        env: Env,
        context?: SummaryV2Context
    ): Promise<SummaryV2Result> {
        const config = loadV2Config(env);

        const ctx: SummaryV2Context = context || {
            chatId: 0,
            periodStart: messages[0]?.ts,
            periodEnd: messages[messages.length - 1]?.ts,
            requestedMessageCount: messages.length,
        };

        // Check cache
        const lastMessageTs = messages[messages.length - 1]?.ts || 0;
        const cacheKey = ctx.lastMessageId
            ? getCacheKey(ctx.chatId, ctx.lastMessageId, config.version)
            : getCacheKeyFromPeriod(
                ctx.chatId,
                ctx.periodStart || messages[0]?.ts || 0,
                ctx.periodEnd || lastMessageTs,
                messages.length,
                config.version
            );

        const cached = await getCached(cacheKey, env);
        if (cached) {
            return cached;
        }

        // Full pipeline
        const layer1Start = Date.now();
        const eventLog = await buildEventLog(messages, env, ctx, config);
        const layer1Duration = Date.now() - layer1Start;

        const result = await summarizeEventLog(eventLog, env, config);
        result.metadata.layer1Duration = layer1Duration;

        await setCache(cacheKey, result, messages.length, env, config);

        return result;
    }
}

/**
 * Factory function to create V2 processor
 */
export function createV2Processor(): V2Processor {
    return new V2Processor();
}
