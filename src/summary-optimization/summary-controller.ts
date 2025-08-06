/**
 * Main controller for optimized summarization system
 */

import { SummaryController, ProcessingSession, ProcessingStrategy, SummaryOptimizationConfig } from './types';
import { OptimizedStrategySelector } from './strategy-selector';
import { loadOptimizationConfig } from './config';
import { Env, DAY, LOG_ID_RADIX } from '../env';
import { Logger, PerformanceTracker } from '../logger';
import { fetchMessages, fetchLastMessages } from '../history';
import { TelegramMessage } from '../providers/ai-provider';
import { sendMessage } from '../telegram';

// Import existing functions for backward compatibility
import { summariseChat as legacySummariseChat, summariseChatMessages as legacySummariseChatMessages } from '../summary';

export class OptimizedSummaryController implements SummaryController {
  private config: SummaryOptimizationConfig;
  private strategySelector: OptimizedStrategySelector;
  private sessions: Map<string, ProcessingSession> = new Map();

  constructor(private env: Env) {
    this.config = loadOptimizationConfig(env);
    this.strategySelector = new OptimizedStrategySelector(this.config, env);
    
    Logger.debug(env, 'OptimizedSummaryController initialized', {
      config: this.config,
      timestamp: Date.now()
    });
  }

  /**
   * Summarizes chat messages for a given number of days
   */
  async summarizeChat(chatId: number, days: number): Promise<string> {
    const trackerId = PerformanceTracker.start('optimizedSummarizeChat', chatId.toString(LOG_ID_RADIX), { days });
    const sessionId = this.generateSessionId(chatId, 'chat', days);
    
    Logger.debug(this.env, 'OptimizedSummaryController: summarizeChat started', {
      chatId: chatId.toString(LOG_ID_RADIX),
      days,
      sessionId,
      trackerId
    });

    try {
      // Initialize session
      const session = this.initializeSession(sessionId, chatId, 'chat');
      
      // Calculate time range
      const end = Math.floor(Date.now() / 1000);
      const start = end - days * DAY;
      
      // Estimate message count for strategy selection
      const estimatedMessageCount = await this.estimateMessageCount(chatId, start, end);
      
      // Check if we should use optimized processing
      if (this.shouldUseOptimizedProcessing(estimatedMessageCount)) {
        Logger.debug(this.env, 'Using optimized processing path', {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          sessionId
        });
        
        return await this.processOptimized(session, chatId, start, end, estimatedMessageCount);
      } else {
        Logger.debug(this.env, 'Using legacy processing path', {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          reason: 'Below optimization threshold'
        });
        
        // Fall back to legacy implementation for small volumes
        return await this.processLegacy('chat', chatId, days);
      }
    } catch (error) {
      const e = error as Error;
      Logger.error('OptimizedSummaryController: summarizeChat error', {
        chatId: chatId.toString(LOG_ID_RADIX),
        sessionId,
        error: e.message,
        stack: e.stack
      });
      
      // Try fallback to legacy system
      Logger.debug(this.env, 'Falling back to legacy system due to error', {
        chatId: chatId.toString(LOG_ID_RADIX),
        error: e.message
      });
      
      return await this.processLegacy('chat', chatId, days);
    } finally {
      // Cleanup session
      this.sessions.delete(sessionId);
      PerformanceTracker.cleanup();
    }
  }

  /**
   * Summarizes a specific number of recent chat messages
   */
  async summarizeChatMessages(chatId: number, count: number): Promise<string> {
    const trackerId = PerformanceTracker.start('optimizedSummarizeChatMessages', chatId.toString(LOG_ID_RADIX), { count });
    const sessionId = this.generateSessionId(chatId, 'messages', count);
    
    Logger.debug(this.env, 'OptimizedSummaryController: summarizeChatMessages started', {
      chatId: chatId.toString(LOG_ID_RADIX),
      count,
      sessionId,
      trackerId
    });

    try {
      // Initialize session
      const session = this.initializeSession(sessionId, chatId, 'messages');
      
      // For message count-based requests, we estimate based on the requested count
      const estimatedMessageCount = count;
      
      // Check if we should use optimized processing
      if (this.shouldUseOptimizedProcessing(estimatedMessageCount)) {
        Logger.debug(this.env, 'Using optimized processing path', {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          sessionId
        });
        
        return await this.processOptimizedMessages(session, chatId, count);
      } else {
        Logger.debug(this.env, 'Using legacy processing path', {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          reason: 'Below optimization threshold'
        });
        
        // Fall back to legacy implementation for small volumes
        return await this.processLegacy('messages', chatId, count);
      }
    } catch (error) {
      const e = error as Error;
      Logger.error('OptimizedSummaryController: summarizeChatMessages error', {
        chatId: chatId.toString(LOG_ID_RADIX),
        sessionId,
        error: e.message,
        stack: e.stack
      });
      
      // Try fallback to legacy system
      Logger.debug(this.env, 'Falling back to legacy system due to error', {
        chatId: chatId.toString(LOG_ID_RADIX),
        error: e.message
      });
      
      return await this.processLegacy('messages', chatId, count);
    } finally {
      // Cleanup session
      this.sessions.delete(sessionId);
      PerformanceTracker.cleanup();
    }
  }

  /**
   * Determines if optimized processing should be used
   */
  private shouldUseOptimizedProcessing(estimatedMessageCount: number): boolean {
    // For now, use a simple threshold. This can be made more sophisticated later.
    const threshold = this.config.parallelProcessing.minMessagesThreshold;
    return estimatedMessageCount >= threshold;
  }

  /**
   * Estimates message count for a time range (placeholder implementation)
   */
  private async estimateMessageCount(chatId: number, start: number, end: number): Promise<number> {
    // For now, return a rough estimate based on time range
    // In a real implementation, this could sample a few messages to get a better estimate
    const timeRangeHours = (end - start) / 3600;
    const estimatedMessagesPerHour = 10; // Conservative estimate
    
    const estimate = Math.floor(timeRangeHours * estimatedMessagesPerHour);
    
    Logger.debug(this.env, 'Message count estimation', {
      chatId: chatId.toString(LOG_ID_RADIX),
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      timeRangeHours,
      estimate
    });
    
    return estimate;
  }

  /**
   * Processes chat summarization using optimized approach (placeholder)
   */
  private async processOptimized(
    session: ProcessingSession,
    chatId: number,
    start: number,
    end: number,
    estimatedMessageCount: number
  ): Promise<string> {
    Logger.debug(this.env, 'processOptimized: Starting optimized processing', {
      sessionId: session.sessionId,
      chatId: chatId.toString(LOG_ID_RADIX),
      estimatedMessageCount
    });

    // For now, this is a placeholder that falls back to legacy processing
    // The actual implementation will be done in subsequent tasks
    Logger.debug(this.env, 'processOptimized: Falling back to legacy (not yet implemented)', {
      sessionId: session.sessionId
    });
    
    // Calculate days for legacy call
    const days = Math.ceil((end - start) / DAY);
    return await this.processLegacy('chat', chatId, days);
  }

  /**
   * Processes message summarization using optimized approach (placeholder)
   */
  private async processOptimizedMessages(
    session: ProcessingSession,
    chatId: number,
    count: number
  ): Promise<string> {
    Logger.debug(this.env, 'processOptimizedMessages: Starting optimized processing', {
      sessionId: session.sessionId,
      chatId: chatId.toString(LOG_ID_RADIX),
      count
    });

    // For now, this is a placeholder that falls back to legacy processing
    // The actual implementation will be done in subsequent tasks
    Logger.debug(this.env, 'processOptimizedMessages: Falling back to legacy (not yet implemented)', {
      sessionId: session.sessionId
    });
    
    return await this.processLegacy('messages', chatId, count);
  }

  /**
   * Falls back to legacy processing
   */
  private async processLegacy(type: 'chat' | 'messages', chatId: number, value: number): Promise<string> {
    Logger.debug(this.env, 'Using legacy processing', {
      type,
      chatId: chatId.toString(LOG_ID_RADIX),
      value
    });

    if (type === 'chat') {
      await legacySummariseChat(this.env, chatId, value);
      return 'Legacy processing completed'; // Legacy function sends message directly
    } else {
      await legacySummariseChatMessages(this.env, chatId, value);
      return 'Legacy processing completed'; // Legacy function sends message directly
    }
  }

  /**
   * Initializes a processing session
   */
  private initializeSession(sessionId: string, chatId: number, type: string): ProcessingSession {
    const session: ProcessingSession = {
      sessionId,
      chatId,
      startTime: Date.now(),
      strategy: 'direct', // Will be updated based on strategy selection
      status: 'initializing',
      metrics: {
        totalMessages: 0,
        fetchDuration: 0,
        processingDuration: 0,
        tokensUsed: 0,
        aiRequestsCount: 0
      },
      errors: []
    };

    this.sessions.set(sessionId, session);
    
    Logger.debug(this.env, 'Processing session initialized', {
      sessionId,
      chatId: chatId.toString(LOG_ID_RADIX),
      type
    });

    return session;
  }

  /**
   * Generates a unique session ID
   */
  private generateSessionId(chatId: number, type: string, value: number): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${type}_${chatId.toString(LOG_ID_RADIX)}_${value}_${timestamp}_${random}`;
  }

  /**
   * Gets current configuration (useful for debugging)
   */
  getConfig(): SummaryOptimizationConfig {
    return this.config;
  }

  /**
   * Gets strategy explanation for given parameters (useful for debugging)
   */
  explainStrategy(messageCount: number, estimatedTokens: number) {
    return this.strategySelector.explainStrategySelection(messageCount, estimatedTokens);
  }
}