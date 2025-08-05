import { Env, StoredMessage, LOG_ID_RADIX, DEFAULT_KV_BATCH_SIZE, DEFAULT_KV_BATCH_DELAY } from './env';
import { Logger, PerformanceTracker } from './logger';
import { processBatches, processBatchesDetailed, BatchErrorType } from './utils';

export async function fetchMessages(env: Env, chatId: number, start: number, end: number): Promise<StoredMessage[]> {
  const trackerId = PerformanceTracker.start('fetchMessages', chatId.toString(LOG_ID_RADIX), { 
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
    timeRangeDays: Math.ceil((end - start) / (24 * 60 * 60))
  });
  
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const messages: StoredMessage[] = [];
  Logger.debug(env, 'fetchMessages start', {
    chat: chatId.toString(LOG_ID_RADIX),
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
    trackerId
  });
  try {
    do {
      Logger.debug(env, 'fetchMessages list', {
        chat: chatId.toString(LOG_ID_RADIX),
        cursor,
      });
      const list: { keys: { name: string }[], cursor?: string } = await env.HISTORY.list({ prefix, cursor });
      cursor = list.cursor;
      Logger.debug(env, 'fetchMessages list done', {
        chat: chatId.toString(LOG_ID_RADIX),
        keys: list.keys.length,
        nextCursor: cursor,
      });
      // Filter keys that match the time range before processing
      const keysToFetch = list.keys.filter((key: { name: string }) => {
        const parts = key.name.split(':');
        const ts = parseInt(parts[2]);
        return ts >= start && ts <= end;
      });

      Logger.debug(env, 'fetchMessages batch processing', {
        chat: chatId.toString(LOG_ID_RADIX),
        totalKeys: list.keys.length,
        keysToFetch: keysToFetch.length,
        batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
      });

      // Process KV requests in batches to avoid API limits with enhanced error handling
      const batchResult = await processBatchesDetailed(
        keysToFetch,
        async (key: { name: string }) => {
          const parts = key.name.split(':');
          const ts = parseInt(parts[2]);
          Logger.debug(env, 'fetchMessages get', {
            chat: chatId.toString(LOG_ID_RADIX),
            ts,
          });
          return env.HISTORY.get<StoredMessage>(key.name, { type: 'json' });
        },
        {
          batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
          delayBetweenBatches: env.KV_BATCH_DELAY || DEFAULT_KV_BATCH_DELAY,
        }
      );

      // Log detailed batch processing results with enhanced metrics
      Logger.debug(env, 'fetchMessages batch metrics', {
        chat: chatId.toString(LOG_ID_RADIX),
        totalDuration: batchResult.metrics.totalDuration,
        averageBatchDuration: batchResult.metrics.averageBatchDuration,
        requestsPerSecond: batchResult.metrics.requestsPerSecond,
        batchCount: batchResult.metrics.totalBatches,
        batchSize: batchResult.metrics.batchSize,
        successRate: batchResult.metrics.successRate,
        errorDistribution: {
          apiLimit: batchResult.metrics.apiLimitErrors,
          timeout: batchResult.metrics.timeoutErrors,
          network: batchResult.metrics.networkErrors,
          unknown: batchResult.metrics.unknownErrors
        }
      });

      if (batchResult.hasApiLimitErrors) {
        Logger.error('fetchMessages API limit errors detected', {
          chat: chatId.toString(LOG_ID_RADIX),
          apiLimitErrors: batchResult.metrics.apiLimitErrors,
          totalErrors: batchResult.errors.length,
          successRate: batchResult.successRate,
          requestsPerSecond: batchResult.metrics.requestsPerSecond,
          batchFailureRate: `${batchResult.metrics.criticalBatchFailures}/${batchResult.metrics.totalBatches}`
        });
      }

      if (batchResult.hasCriticalFailures) {
        Logger.error('fetchMessages critical batch failures detected', {
          chat: chatId.toString(LOG_ID_RADIX),
          criticalFailures: batchResult.metrics.criticalBatchFailures,
          totalBatches: batchResult.metrics.totalBatches,
          totalErrors: batchResult.errors.length,
          successRate: batchResult.successRate,
          errorsByBatch: batchResult.metrics.errorsByBatch.slice(0, 3) // Log first 3 failed batches
        });
      }

      // Add successful results to messages array
      for (const m of batchResult.results) {
        if (m !== null && m !== undefined) {
          messages.push(m);
        }
      }

      // Check if we should throw an error for critical failures
      if (batchResult.hasCriticalFailures && batchResult.successRate < 50) {
        const apiLimitErrors = batchResult.errors.filter(e => e.type === BatchErrorType.API_LIMIT_EXCEEDED);
        if (apiLimitErrors.length > 0) {
          throw new Error('API request limits exceeded. Please try again with a shorter time period or contact support if the issue persists.');
        } else {
          throw new Error('Critical failures occurred during message fetching. Please try again later.');
        }
      }
      Logger.debug(env, 'fetchMessages page processed', {
        chat: chatId.toString(LOG_ID_RADIX),
        totalKeysInPage: list.keys.length,
        keysMatchingTimeRange: keysToFetch.length,
        successfulFetches: batchResult.results.length,
        failedFetches: batchResult.totalFailed,
        successRate: batchResult.successRate,
        totalCollected: messages.length,
        batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
        hasApiLimitErrors: batchResult.hasApiLimitErrors,
        hasCriticalFailures: batchResult.hasCriticalFailures,
        processingTime: batchResult.metrics.totalDuration,
        requestsPerSecond: batchResult.metrics.requestsPerSecond,
        averageBatchTime: batchResult.metrics.averageBatchDuration
      });
    } while (cursor && messages.length < 10000);
    const sortedMessages = messages.sort((a, b) => a.ts - b.ts);
    
    // Track successful completion
    const finalMetrics = PerformanceTracker.end(trackerId, { 
      result: 'success',
      messagesFound: sortedMessages.length,
      timeRangeDays: Math.ceil((end - start) / (24 * 60 * 60))
    });
    
    // Log overall function performance insight
    if (finalMetrics) {
      Logger.logPerformanceInsight(env, 'fetchMessages', {
        duration: finalMetrics.duration,
        itemsProcessed: sortedMessages.length,
        chatId: chatId.toString(LOG_ID_RADIX),
        stage: 'complete',
        insights: [
          `${Math.ceil((end - start) / (24 * 60 * 60))}_DAYS_RANGE`,
          finalMetrics.duration > 10000 ? 'SLOW_FETCH' : 'NORMAL_SPEED'
        ]
      });
    }
    
    return sortedMessages;
  } catch (err: any) {
    // Track error completion
    const finalMetrics = PerformanceTracker.end(trackerId, { 
      result: 'error',
      errorType: err.constructor?.name || 'Unknown',
      messagesFound: messages.length
    });
    
    Logger.error('fetchMessages failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
      totalDuration: finalMetrics?.duration
    });
    throw err;
  } finally {
    Logger.debug(env, 'fetchMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
      count: messages.length,
    });
  }
}

export async function fetchLastMessages(env: Env, chatId: number, count: number): Promise<StoredMessage[]> {
  const trackerId = PerformanceTracker.start('fetchLastMessages', chatId.toString(LOG_ID_RADIX), { count });
  
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const keys: string[] = [];
  Logger.debug(env, 'fetchLastMessages start', {
    chat: chatId.toString(LOG_ID_RADIX),
    count,
    trackerId
  });
  try {
    do {
      Logger.debug(env, 'fetchLastMessages list', {
        chat: chatId.toString(LOG_ID_RADIX),
        cursor,
      });
      const list: { keys: { name: string }[], cursor?: string } = await env.HISTORY.list({ prefix, cursor });
      cursor = list.cursor;
      Logger.debug(env, 'fetchLastMessages list done', {
        chat: chatId.toString(LOG_ID_RADIX),
        keys: list.keys.length,
        nextCursor: cursor,
      });
      for (const k of list.keys) {
        keys.push(k.name);
        // Fetch extra messages to account for potential filtering
        if (keys.length > count + 5) keys.shift();
      }
      Logger.debug(env, 'fetchLastMessages page processed', {
        chat: chatId.toString(LOG_ID_RADIX),
        collected: keys.length,
      });
    } while (cursor);

    Logger.debug(env, 'fetchLastMessages batch processing', {
      chat: chatId.toString(LOG_ID_RADIX),
      totalKeys: keys.length,
      batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
    });

    // Process KV requests in batches to avoid API limits with enhanced error handling
    const batchResult = await processBatchesDetailed(
      keys,
      async (k: string) => {
        Logger.debug(env, 'fetchLastMessages get', {
          chat: chatId.toString(LOG_ID_RADIX),
          key: k,
        });
        return env.HISTORY.get<StoredMessage | null>(k, { type: 'json' });
      },
      {
        batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
        delayBetweenBatches: env.KV_BATCH_DELAY || DEFAULT_KV_BATCH_DELAY,
      }
    );

    // Log detailed batch processing results with enhanced metrics
    Logger.debug(env, 'fetchLastMessages batch metrics', {
      chat: chatId.toString(LOG_ID_RADIX),
      totalDuration: batchResult.metrics.totalDuration,
      averageBatchDuration: batchResult.metrics.averageBatchDuration,
      requestsPerSecond: batchResult.metrics.requestsPerSecond,
      batchCount: batchResult.metrics.totalBatches,
      batchSize: batchResult.metrics.batchSize,
      successRate: batchResult.metrics.successRate,
      errorDistribution: {
        apiLimit: batchResult.metrics.apiLimitErrors,
        timeout: batchResult.metrics.timeoutErrors,
        network: batchResult.metrics.networkErrors,
        unknown: batchResult.metrics.unknownErrors
      }
    });

    if (batchResult.hasApiLimitErrors) {
      Logger.error('fetchLastMessages API limit errors detected', {
        chat: chatId.toString(LOG_ID_RADIX),
        apiLimitErrors: batchResult.metrics.apiLimitErrors,
        totalErrors: batchResult.errors.length,
        successRate: batchResult.successRate,
        requestsPerSecond: batchResult.metrics.requestsPerSecond,
        batchFailureRate: `${batchResult.metrics.criticalBatchFailures}/${batchResult.metrics.totalBatches}`
      });
    }

    if (batchResult.hasCriticalFailures) {
      Logger.error('fetchLastMessages critical batch failures detected', {
        chat: chatId.toString(LOG_ID_RADIX),
        criticalFailures: batchResult.metrics.criticalBatchFailures,
        totalBatches: batchResult.metrics.totalBatches,
        totalErrors: batchResult.errors.length,
        successRate: batchResult.successRate,
        errorsByBatch: batchResult.metrics.errorsByBatch.slice(0, 3) // Log first 3 failed batches
      });
    }

    Logger.debug(env, 'fetchLastMessages batch processing complete', {
      chat: chatId.toString(LOG_ID_RADIX),
      totalKeys: keys.length,
      successfulFetches: batchResult.results.filter(m => m !== null).length,
      failedFetches: batchResult.totalFailed,
      successRate: batchResult.successRate,
      batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
      hasApiLimitErrors: batchResult.hasApiLimitErrors,
      hasCriticalFailures: batchResult.hasCriticalFailures,
      processingTime: batchResult.metrics.totalDuration,
      requestsPerSecond: batchResult.metrics.requestsPerSecond,
      averageBatchTime: batchResult.metrics.averageBatchDuration
    });

    // Check if we should throw an error for critical failures
    if (batchResult.hasCriticalFailures && batchResult.successRate < 50) {
      const apiLimitErrors = batchResult.errors.filter(e => e.type === BatchErrorType.API_LIMIT_EXCEEDED);
      if (apiLimitErrors.length > 0) {
        throw new Error('API request limits exceeded. Please try requesting fewer messages or contact support if the issue persists.');
      } else {
        throw new Error('Critical failures occurred during message fetching. Please try again later.');
      }
    }

    const msgs = batchResult.results;

    const filtered = msgs.filter((m): m is StoredMessage => m !== null);
    const sorted = filtered.sort((a: StoredMessage, b: StoredMessage) => b.ts - a.ts);
    
    // Filter out command messages and return only the requested count
    const nonCommandMessages = sorted.filter((msg: StoredMessage) => Boolean(msg.text) && !msg.text!.startsWith('/'));
    const result = nonCommandMessages.slice(0, count);
    
    // Sort the final result in ascending order (oldest first) for consistent ordering
    const sortedResult = result.sort((a: StoredMessage, b: StoredMessage) => a.ts - b.ts);
    
    // Track successful completion
    const finalMetrics = PerformanceTracker.end(trackerId, { 
      result: 'success',
      messagesRequested: count,
      messagesFound: sortedResult.length,
      keysProcessed: keys.length
    });
    
    // Log overall function performance insight
    if (finalMetrics) {
      Logger.logPerformanceInsight(env, 'fetchLastMessages', {
        duration: finalMetrics.duration,
        itemsProcessed: keys.length,
        chatId: chatId.toString(LOG_ID_RADIX),
        stage: 'complete',
        insights: [
          `${count}_MESSAGES_REQUESTED`,
          `${sortedResult.length}_MESSAGES_FOUND`,
          finalMetrics.duration > 5000 ? 'SLOW_FETCH' : 'NORMAL_SPEED'
        ]
      });
    }
    
    return sortedResult;
  } catch (err: any) {
    // Track error completion
    const finalMetrics = PerformanceTracker.end(trackerId, { 
      result: 'error',
      errorType: err.constructor?.name || 'Unknown',
      keysProcessed: keys.length
    });
    
    Logger.error('fetchLastMessages failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
      totalDuration: finalMetrics?.duration
    });
    throw err;
  } finally {
    Logger.debug(env, 'fetchLastMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
      count: keys.length,
    });
  }
}
