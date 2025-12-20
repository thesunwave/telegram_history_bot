/**
 * Summary V2 Cache
 * 
 * ADR-002: Caching utilities for summary v2 results.
 * Uses COUNTERS KV namespace following existing patterns from profanity.ts.
 */

import { Env } from '../env';
import { Logger } from '../logger';
import { hashText } from '../utils';
import { SummaryV2CacheEntry, SummaryV2Result, SummaryV2Config, DEFAULT_V2_CONFIG } from './types';

/**
 * Generate cache key for a summary
 * Format: summary_v2:{chatId}:{lastMessageId}:{version}
 */
export function getCacheKey(
    chatId: number,
    lastMessageId: number,
    version: string = DEFAULT_V2_CONFIG.version
): string {
    const chatIdBase36 = chatId.toString(36);
    return `summary_v2:${chatIdBase36}:${lastMessageId}:${version}`;
}

/**
 * Generate a hash-based cache key when lastMessageId is not available
 * Uses first and last message timestamps as fallback
 */
export function getCacheKeyFromPeriod(
    chatId: number,
    startTs: number,
    endTs: number,
    messageCount: number,
    version: string = DEFAULT_V2_CONFIG.version
): string {
    const chatIdBase36 = chatId.toString(36);
    const periodHash = hashText(`${startTs}:${endTs}:${messageCount}`);
    return `summary_v2:${chatIdBase36}:p${periodHash}:${version}`;
}

/**
 * Retrieve cached summary result
 */
export async function getCached(
    cacheKey: string,
    env: Env
): Promise<SummaryV2Result | null> {
    try {
        const startTime = Date.now();
        const cached = await env.COUNTERS.get(cacheKey);
        const duration = Date.now() - startTime;

        if (cached) {
            const entry = JSON.parse(cached) as SummaryV2CacheEntry;

            Logger.debug(env, 'Summary V2 cache: hit', {
                cacheKey: cacheKey.substring(0, 40) + '...',
                cachedAt: new Date(entry.cachedAt).toISOString(),
                messageCount: entry.messageCount,
                retrievalTime: duration,
            });

            // Return result with cache flag set
            return {
                ...entry.result,
                metadata: {
                    ...entry.result.metadata,
                    fromCache: true,
                },
            };
        }

        Logger.debug(env, 'Summary V2 cache: miss', {
            cacheKey: cacheKey.substring(0, 40) + '...',
            retrievalTime: duration,
        });

        return null;
    } catch (error) {
        Logger.error('Summary V2 cache: retrieval failed', {
            cacheKey: cacheKey.substring(0, 40) + '...',
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * Store summary result in cache
 */
export async function setCache(
    cacheKey: string,
    result: SummaryV2Result,
    messageCount: number,
    env: Env,
    config: SummaryV2Config = DEFAULT_V2_CONFIG
): Promise<void> {
    try {
        const entry: SummaryV2CacheEntry = {
            result,
            cachedAt: Date.now(),
            version: config.version,
            messageCount,
        };

        const startTime = Date.now();
        await env.COUNTERS.put(cacheKey, JSON.stringify(entry), {
            expirationTtl: config.cacheTTL,
        });
        const duration = Date.now() - startTime;

        Logger.debug(env, 'Summary V2 cache: stored', {
            cacheKey: cacheKey.substring(0, 40) + '...',
            messageCount,
            ttlSeconds: config.cacheTTL,
            storageTime: duration,
            entrySize: JSON.stringify(entry).length,
        });
    } catch (error) {
        Logger.error('Summary V2 cache: storage failed', {
            cacheKey: cacheKey.substring(0, 40) + '...',
            error: error instanceof Error ? error.message : String(error),
        });
        // Don't throw - cache failure shouldn't break summarization
    }
}

/**
 * Invalidate cached summary for a chat
 * Note: Usually not needed as new messages create new cache keys
 */
export async function invalidateCache(
    cacheKey: string,
    env: Env
): Promise<void> {
    try {
        await env.COUNTERS.delete(cacheKey);
        Logger.debug(env, 'Summary V2 cache: invalidated', {
            cacheKey: cacheKey.substring(0, 40) + '...',
        });
    } catch (error) {
        Logger.error('Summary V2 cache: invalidation failed', {
            cacheKey: cacheKey.substring(0, 40) + '...',
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
