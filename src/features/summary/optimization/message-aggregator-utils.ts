/**
 * Utilities for working with MessageAggregatorDO
 */

import { Env, StoredMessage } from '../../../core/env';
import { TelegramMessage } from '../../core/providers/ai-provider';
import { Logger, PerformanceTracker } from '../../../core/logger';

// Response type definitions for MessageAggregatorDO
interface InitializeResponse {
  success: boolean;
  sessionId: string;
}

interface AggregateResponse {
  success: boolean;
  messagesAggregated: number;
  messagesReceived: number;
}

interface CleanupResponse {
  success: boolean;
}

export interface AggregationResult {
  sessionId: string;
  status: 'running' | 'completed' | 'failed';
  messagesAggregated: number;
  messagesReceived: number;
  messages: TelegramMessage[];
  errors: string[];
  processingTime: number | null;
}

export interface AggregationStatus {
  sessionId: string;
  status: 'running' | 'completed' | 'failed';
  messagesReceived: number;
  messagesAggregated: number;
  errors: string[];
  startTime: number;
  endTime?: number;
  lastActivity: number;
}

export class MessageAggregatorUtils {
  private static readonly AGGREGATOR_TIMEOUT = 30000; // 30 seconds
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 1000; // 1 second

  /**
   * Initialize a new aggregation session
   */
  static async initializeSession(
    env: Env,
    sessionId: string,
    chatId: number
  ): Promise<boolean> {
    const trackerId = PerformanceTracker.start(
      'MessageAggregatorUtils_initializeSession',
      sessionId,
      { chatId: chatId.toString(36) }
    );

    try {
      const aggregatorId = env.MESSAGE_AGGREGATOR_DO.idFromName(sessionId);
      const aggregator = env.MESSAGE_AGGREGATOR_DO.get(aggregatorId);

      const request = new Request('http://localhost/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, chatId }),
      });

      const response = await Promise.race([
        aggregator.fetch(request as any),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Aggregator initialization timeout')), this.AGGREGATOR_TIMEOUT)
        ),
      ]);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Aggregator initialization failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as InitializeResponse;

      Logger.debug(env, 'MessageAggregator session initialized', {
        sessionId,
        chatId: chatId.toString(36),
        success: result.success,
      });

      PerformanceTracker.end(trackerId, {
        status: 'success',
        sessionInitialized: true,
      });

      return result.success;

    } catch (error: any) {
      Logger.error('MessageAggregator initialization error', {
        sessionId,
        chatId: chatId.toString(36),
        error: error.message || String(error),
      });

      PerformanceTracker.end(trackerId, {
        status: 'error',
        error: error.message,
      });

      return false;
    }
  }

  /**
   * Aggregate messages in batches
   */
  static async aggregateMessages(
    env: Env,
    sessionId: string,
    messages: StoredMessage[]
  ): Promise<boolean> {
    if (messages.length === 0) {
      return true;
    }

    const trackerId = PerformanceTracker.start(
      'MessageAggregatorUtils_aggregateMessages',
      sessionId,
      { messagesCount: messages.length }
    );

    try {
      const aggregatorId = env.MESSAGE_AGGREGATOR_DO.idFromName(sessionId);
      const aggregator = env.MESSAGE_AGGREGATOR_DO.get(aggregatorId);

      const request = new Request('http://localhost/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, messages }),
      });

      const response = await Promise.race([
        aggregator.fetch(request as any),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Aggregator timeout')), this.AGGREGATOR_TIMEOUT)
        ),
      ]);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Aggregation failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as AggregateResponse;

      Logger.debug(env, 'Messages aggregated successfully', {
        sessionId,
        messagesInput: messages.length,
        messagesAggregated: result.messagesAggregated,
        messagesReceived: result.messagesReceived,
      });

      PerformanceTracker.end(trackerId, {
        status: 'success',
        messagesProcessed: messages.length,
        messagesAggregated: result.messagesAggregated,
      });

      return result.success;

    } catch (error: any) {
      Logger.error('MessageAggregator aggregation error', {
        sessionId,
        messagesCount: messages.length,
        error: error.message || String(error),
      });

      PerformanceTracker.end(trackerId, {
        status: 'error',
        error: error.message,
      });

      return false;
    }
  }

  /**
   * Get aggregation results
   */
  static async getResults(
    env: Env,
    sessionId: string
  ): Promise<AggregationResult | null> {
    const trackerId = PerformanceTracker.start(
      'MessageAggregatorUtils_getResults',
      sessionId
    );

    try {
      const aggregatorId = env.MESSAGE_AGGREGATOR_DO.idFromName(sessionId);
      const aggregator = env.MESSAGE_AGGREGATOR_DO.get(aggregatorId);

      const request = new Request(`http://localhost/results?sessionId=${encodeURIComponent(sessionId)}`);

      const response = await Promise.race([
        aggregator.fetch(request as any),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Get results timeout')), this.AGGREGATOR_TIMEOUT)
        ),
      ]);

      if (!response.ok) {
        if (response.status === 404) {
          Logger.warn(env, 'MessageAggregator session not found', { sessionId });
          return null;
        }
        const errorText = await response.text();
        throw new Error(`Get results failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as AggregationResult;

      Logger.debug(env, 'MessageAggregator results retrieved', {
        sessionId,
        status: result.status,
        messagesAggregated: result.messagesAggregated,
        processingTime: result.processingTime,
        hasErrors: result.errors.length > 0,
      });

      PerformanceTracker.end(trackerId, {
        status: 'success',
        messagesReturned: result.messagesAggregated,
        processingTime: result.processingTime,
      });

      return result;

    } catch (error: any) {
      Logger.error('MessageAggregator get results error', {
        sessionId,
        error: error.message || String(error),
      });

      PerformanceTracker.end(trackerId, {
        status: 'error',
        error: error.message,
      });

      return null;
    }
  }

  /**
   * Get aggregation status
   */
  static async getStatus(
    env: Env,
    sessionId: string
  ): Promise<AggregationStatus | null> {
    try {
      const aggregatorId = env.MESSAGE_AGGREGATOR_DO.idFromName(sessionId);
      const aggregator = env.MESSAGE_AGGREGATOR_DO.get(aggregatorId);

      const request = new Request(`http://localhost/status?sessionId=${encodeURIComponent(sessionId)}`);

      const response = await Promise.race([
        aggregator.fetch(request as any),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Get status timeout')), this.AGGREGATOR_TIMEOUT)
        ),
      ]);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        const errorText = await response.text();
        throw new Error(`Get status failed: ${response.status} ${errorText}`);
      }

      return await response.json() as AggregationStatus;

    } catch (error: any) {
      Logger.error('MessageAggregator get status error', {
        sessionId,
        error: error.message || String(error),
      });
      return null;
    }
  }

  /**
   * Cleanup aggregation session
   */
  static async cleanupSession(
    env: Env,
    sessionId: string
  ): Promise<boolean> {
    const trackerId = PerformanceTracker.start(
      'MessageAggregatorUtils_cleanupSession',
      sessionId
    );

    try {
      const aggregatorId = env.MESSAGE_AGGREGATOR_DO.idFromName(sessionId);
      const aggregator = env.MESSAGE_AGGREGATOR_DO.get(aggregatorId);

      const request = new Request('http://localhost/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      const response = await Promise.race([
        aggregator.fetch(request as any),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error('Cleanup timeout')), this.AGGREGATOR_TIMEOUT)
        ),
      ]);

      if (!response.ok) {
        if (response.status === 404) {
          // Session already gone, consider it success
          Logger.debug(env, 'MessageAggregator session already cleaned', { sessionId });
          return true;
        }
        const errorText = await response.text();
        throw new Error(`Cleanup failed: ${response.status} ${errorText}`);
      }

      const result = await response.json() as CleanupResponse;

      Logger.debug(env, 'MessageAggregator session cleaned up', {
        sessionId,
        success: result.success,
      });

      PerformanceTracker.end(trackerId, {
        status: 'success',
        sessionCleaned: true,
      });

      return result.success;

    } catch (error: any) {
      Logger.error('MessageAggregator cleanup error', {
        sessionId,
        error: error.message || String(error),
      });

      PerformanceTracker.end(trackerId, {
        status: 'error',
        error: error.message,
      });

      // Don't fail the whole process if cleanup fails
      return true;
    }
  }

  /**
   * Process messages with aggregation and retries
   */
  static async processWithRetries(
    env: Env,
    sessionId: string,
    chatId: number,
    messageGroups: StoredMessage[][]
  ): Promise<TelegramMessage[] | null> {
    const trackerId = PerformanceTracker.start(
      'MessageAggregatorUtils_processWithRetries',
      sessionId,
      {
        chatId: chatId.toString(36),
        messageGroups: messageGroups.length,
        totalMessages: messageGroups.reduce((sum, group) => sum + group.length, 0),
      }
    );

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < this.MAX_RETRIES) {
      try {
        // Initialize session
        const initialized = await this.initializeSession(env, sessionId, chatId);
        if (!initialized) {
          throw new Error('Failed to initialize aggregation session');
        }

        // Aggregate all message groups
        for (let i = 0; i < messageGroups.length; i++) {
          const group = messageGroups[i];
          const success = await this.aggregateMessages(env, sessionId, group);
          if (!success) {
            throw new Error(`Failed to aggregate message group ${i + 1}/${messageGroups.length}`);
          }
        }

        // Get results
        const result = await this.getResults(env, sessionId);
        if (!result) {
          throw new Error('Failed to get aggregation results');
        }

        if (result.status === 'failed') {
          throw new Error(`Aggregation failed: ${result.errors.join(', ')}`);
        }

        Logger.info(env, 'MessageAggregator processing completed successfully', {
          sessionId,
          chatId: chatId.toString(36),
          messagesAggregated: result.messagesAggregated,
          processingTime: result.processingTime,
          attempts: attempt + 1,
        });

        PerformanceTracker.end(trackerId, {
          status: 'success',
          messagesAggregated: result.messagesAggregated,
          attempts: attempt + 1,
          processingTime: result.processingTime,
        });

        // Cleanup in background (don't wait)
        this.cleanupSession(env, sessionId).catch(error => {
          Logger.warn(env, 'Background cleanup failed', {
            sessionId,
            error: error.message,
          });
        });

        return result.messages;

      } catch (error: any) {
        lastError = error;
        attempt++;

        Logger.warn(env, 'MessageAggregator processing attempt failed', {
          sessionId,
          attempt,
          maxRetries: this.MAX_RETRIES,
          error: error.message || String(error),
        });

        if (attempt < this.MAX_RETRIES) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * attempt));
        }

        // Cleanup failed session
        try {
          await this.cleanupSession(env, sessionId);
        } catch (cleanupError: any) {
          Logger.debug(env, 'Failed session cleanup error', {
            sessionId,
            cleanupError: cleanupError.message,
          });
        }
      }
    }

    Logger.error('MessageAggregator processing failed after all retries', {
      sessionId,
      chatId: chatId.toString(36),
      attempts: this.MAX_RETRIES,
      lastError: lastError?.message || 'Unknown error',
    });

    PerformanceTracker.end(trackerId, {
      status: 'error',
      attempts: this.MAX_RETRIES,
      error: lastError?.message || 'Unknown error',
    });

    return null;
  }

  /**
   * Generate a unique session ID
   */
  static generateSessionId(chatId: number, prefix: string = 'agg'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${chatId.toString(36)}_${timestamp}_${random}`;
  }

  /**
   * Check if aggregation is available
   */
  static isAggregationAvailable(env: Env): boolean {
    return !!(env.MESSAGE_AGGREGATOR_DO);
  }
}
