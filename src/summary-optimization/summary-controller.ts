/**
 * Main controller for optimized summarization system
 */

import {
  SummaryController,
  ProcessingSession,
  ProcessingStrategy,
  SummaryOptimizationConfig,
} from "./types";
import { OptimizedStrategySelector } from "./strategy-selector";
import { loadOptimizationConfig } from "./config";
import { DirectProcessor } from "./direct-processor";
import { HierarchicalProcessor } from "./hierarchical-processor";
import { Env, DAY, LOG_ID_RADIX } from "../env";
import { Logger, PerformanceTracker } from "../logger";
import { fetchMessages, fetchLastMessages } from "../history";
import { fetchMessagesHybrid } from "../history-optimized";
import { TelegramMessage } from "../providers/ai-provider";
import { sendMessage } from "../telegram";

// Import existing functions for backward compatibility
import {
  summariseChatLegacy as legacySummariseChat,
  summariseChatMessagesLegacy as legacySummariseChatMessages,
} from "../summary";

export class OptimizedSummaryController implements SummaryController {
  private config: SummaryOptimizationConfig;
  private strategySelector: OptimizedStrategySelector;
  private sessions: Map<string, ProcessingSession> = new Map();

  constructor(private env: Env) {
    this.config = loadOptimizationConfig(env);
    this.strategySelector = new OptimizedStrategySelector(this.config, env);

    Logger.debug(env, "OptimizedSummaryController initialized", {
      config: this.config,
      timestamp: Date.now(),
    });
  }

  /**
   * Summarizes chat messages for a given number of days
   */
  async summarizeChat(chatId: number, days: number): Promise<string> {
    const trackerId = PerformanceTracker.start(
      "optimizedSummarizeChat",
      chatId.toString(LOG_ID_RADIX),
      { days },
    );
    const sessionId = this.generateSessionId(chatId, "chat", days);

    Logger.debug(
      this.env,
      "OptimizedSummaryController: summarizeChat started",
      {
        chatId: chatId.toString(LOG_ID_RADIX),
        days,
        sessionId,
        trackerId,
      },
    );

    try {
      // Initialize session
      const session = this.initializeSession(sessionId, chatId, "chat");

      // Calculate time range
      const end = Math.floor(Date.now() / 1000);
      const start = end - days * DAY;

      // Estimate message count for strategy selection
      const estimatedMessageCount = await this.estimateMessageCount(
        chatId,
        start,
        end,
      );

      // Check if we should use optimized processing
      if (this.shouldUseOptimizedProcessing(estimatedMessageCount)) {
        Logger.debug(this.env, "Using optimized processing path", {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          sessionId,
        });

        return await this.processOptimized(
          session,
          chatId,
          start,
          end,
          estimatedMessageCount,
        );
      } else {
        Logger.debug(this.env, "Using legacy processing path", {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          reason: "Below optimization threshold",
        });

        // Fall back to legacy implementation for small volumes
        return await this.processLegacy("chat", chatId, days);
      }
    } catch (error) {
      const e = error as Error;
      Logger.error("OptimizedSummaryController: summarizeChat error", {
        chatId: chatId.toString(LOG_ID_RADIX),
        sessionId,
        error: e.message,
        stack: e.stack,
      });

      // Try fallback to legacy system
      Logger.debug(this.env, "Falling back to legacy system due to error", {
        chatId: chatId.toString(LOG_ID_RADIX),
        error: e.message,
      });

      return await this.processLegacy("chat", chatId, days);
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
    const trackerId = PerformanceTracker.start(
      "optimizedSummarizeChatMessages",
      chatId.toString(LOG_ID_RADIX),
      { count },
    );
    const sessionId = this.generateSessionId(chatId, "messages", count);

    Logger.debug(
      this.env,
      "OptimizedSummaryController: summarizeChatMessages started",
      {
        chatId: chatId.toString(LOG_ID_RADIX),
        count,
        sessionId,
        trackerId,
      },
    );

    try {
      // Initialize session
      const session = this.initializeSession(sessionId, chatId, "messages");

      // For message count-based requests, we estimate based on the requested count
      const estimatedMessageCount = count;

      // Check if we should use optimized processing
      if (this.shouldUseOptimizedProcessing(estimatedMessageCount)) {
        Logger.debug(this.env, "Using optimized processing path", {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          sessionId,
        });

        return await this.processOptimizedMessages(session, chatId, count);
      } else {
        Logger.debug(this.env, "Using legacy processing path", {
          chatId: chatId.toString(LOG_ID_RADIX),
          estimatedMessageCount,
          reason: "Below optimization threshold",
        });

        // Fall back to legacy implementation for small volumes
        return await this.processLegacy("messages", chatId, count);
      }
    } catch (error) {
      const e = error as Error;
      Logger.error("OptimizedSummaryController: summarizeChatMessages error", {
        chatId: chatId.toString(LOG_ID_RADIX),
        sessionId,
        error: e.message,
        stack: e.stack,
      });

      // Try fallback to legacy system
      Logger.debug(this.env, "Falling back to legacy system due to error", {
        chatId: chatId.toString(LOG_ID_RADIX),
        error: e.message,
      });

      return await this.processLegacy("messages", chatId, count);
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
    // Always use optimized processing when enabled - let the strategy selector
    // decide which specific strategy to use (direct, parallel, or hierarchical)
    return true;
  }

  /**
   * Estimates message count for a time range (placeholder implementation)
   */
  private async estimateMessageCount(
    chatId: number,
    start: number,
    end: number,
  ): Promise<number> {
    // For now, return a rough estimate based on time range
    // In a real implementation, this could sample a few messages to get a better estimate
    const timeRangeHours = (end - start) / 3600;
    const estimatedMessagesPerHour = 10; // Conservative estimate

    const estimate = Math.floor(timeRangeHours * estimatedMessagesPerHour);

    Logger.debug(this.env, "Message count estimation", {
      chatId: chatId.toString(LOG_ID_RADIX),
      start: new Date(start * 1000).toISOString(),
      end: new Date(end * 1000).toISOString(),
      timeRangeHours,
      estimate,
    });

    return estimate;
  }

  /**
   * Processes chat summarization using optimized approach
   */
  private async processOptimized(
    session: ProcessingSession,
    chatId: number,
    start: number,
    end: number,
    estimatedMessageCount: number,
  ): Promise<string> {
    Logger.debug(this.env, "processOptimized: Starting optimized processing", {
      sessionId: session.sessionId,
      chatId: chatId.toString(LOG_ID_RADIX),
      estimatedMessageCount,
    });

    try {
      // Update session status
      session.status = "fetching";
      const fetchStart = Date.now();

      // Fetch messages using optimized method
      const allMessages = await fetchMessagesHybrid(this.env, chatId, start, end);
      const fetchDuration = Date.now() - fetchStart;
      session.metrics.fetchDuration = fetchDuration;
      session.metrics.totalMessages = allMessages.length;

      Logger.debug(this.env, "processOptimized: Messages fetched", {
        sessionId: session.sessionId,
        messageCount: allMessages.length,
        fetchDuration,
      });

      // Filter content messages (remove bot commands, etc.)
      const messages = this.filterContentMessages(allMessages);

      if (messages.length === 0) {
        Logger.debug(this.env, "processOptimized: No content messages found", {
          sessionId: session.sessionId,
          originalCount: allMessages.length,
        });
        return "Нет сообщений для суммаризации в указанном периоде.";
      }

      // Update session status
      session.status = "processing";
      const processingStart = Date.now();

      // Estimate tokens and select strategy
      const estimatedTokens = this.strategySelector.estimateTokens(messages);
      const strategy = this.strategySelector.selectStrategy(
        messages.length,
        estimatedTokens,
      );
      session.strategy = strategy;

      Logger.debug(this.env, "processOptimized: Strategy selected", {
        sessionId: session.sessionId,
        strategy,
        messageCount: messages.length,
        estimatedTokens,
      });

      let result: string;

      // Process based on selected strategy
      switch (strategy) {
        case "direct":
          const directProcessor = new DirectProcessor();
          result = await directProcessor.process(messages, this.env);
          break;

        case "hierarchical":
          const hierarchicalProcessor = new HierarchicalProcessor();
          result = await hierarchicalProcessor.process(messages, this.env);
          break;

        case "parallel":
          // Will be implemented in Task 5-6
          Logger.debug(
            this.env,
            "processOptimized: Parallel processing not yet implemented, falling back to direct",
            {
              sessionId: session.sessionId,
            },
          );
          const parallelFallback = new DirectProcessor();
          result = await parallelFallback.process(messages, this.env);
          break;

        default:
          throw new Error(`Unknown processing strategy: ${strategy}`);
      }

      // Update session metrics
      const processingDuration = Date.now() - processingStart;
      session.metrics.processingDuration = processingDuration;
      session.metrics.tokensUsed = estimatedTokens;
      session.status = "completed";
      session.endTime = Date.now();

      Logger.debug(this.env, "processOptimized: Processing completed", {
        sessionId: session.sessionId,
        strategy,
        processingDuration,
        totalDuration: session.endTime - session.startTime,
      });

      return result;
    } catch (error) {
      const e = error as Error;
      session.status = "failed";
      session.errors.push({
        stage: "ai_final",
        error: e.message,
        timestamp: Date.now(),
        recoverable: true,
      });

      Logger.error("processOptimized: Processing failed", {
        sessionId: session.sessionId,
        error: e.message,
        stack: e.stack,
      });

      // Try fallback to legacy system
      const days = Math.ceil((end - start) / DAY);
      return await this.processLegacy("chat", chatId, days);
    }
  }

  /**
   * Processes message summarization using optimized approach
   */
  private async processOptimizedMessages(
    session: ProcessingSession,
    chatId: number,
    count: number,
  ): Promise<string> {
    Logger.debug(
      this.env,
      "processOptimizedMessages: Starting optimized processing",
      {
        sessionId: session.sessionId,
        chatId: chatId.toString(LOG_ID_RADIX),
        count,
      },
    );

    try {
      // Update session status
      session.status = "fetching";
      const fetchStart = Date.now();

      // Fetch last N messages
      const allMessages = await fetchLastMessages(this.env, chatId, count);
      const fetchDuration = Date.now() - fetchStart;
      session.metrics.fetchDuration = fetchDuration;
      session.metrics.totalMessages = allMessages.length;

      Logger.debug(this.env, "processOptimizedMessages: Messages fetched", {
        sessionId: session.sessionId,
        messageCount: allMessages.length,
        fetchDuration,
      });

      // Filter content messages (remove bot commands, etc.)
      const messages = this.filterContentMessages(allMessages);

      if (messages.length === 0) {
        Logger.debug(
          this.env,
          "processOptimizedMessages: No content messages found",
          {
            sessionId: session.sessionId,
            originalCount: allMessages.length,
          },
        );
        return "Нет сообщений для суммаризации.";
      }

      // Update session status
      session.status = "processing";
      const processingStart = Date.now();

      // Estimate tokens and select strategy
      const estimatedTokens = this.strategySelector.estimateTokens(messages);
      const strategy = this.strategySelector.selectStrategy(
        messages.length,
        estimatedTokens,
      );
      session.strategy = strategy;

      Logger.debug(this.env, "processOptimizedMessages: Strategy selected", {
        sessionId: session.sessionId,
        strategy,
        messageCount: messages.length,
        estimatedTokens,
      });

      let result: string;

      // Process based on selected strategy
      switch (strategy) {
        case "direct":
          const directProcessor = new DirectProcessor();
          result = await directProcessor.process(messages, this.env);
          break;

        case "hierarchical":
          const hierarchicalProcessor = new HierarchicalProcessor();
          result = await hierarchicalProcessor.process(messages, this.env);
          break;

        case "parallel":
          // Will be implemented in Task 5-6
          Logger.debug(
            this.env,
            "processOptimizedMessages: Parallel processing not yet implemented, falling back to direct",
            {
              sessionId: session.sessionId,
            },
          );
          const parallelFallback = new DirectProcessor();
          result = await parallelFallback.process(messages, this.env);
          break;

        default:
          throw new Error(`Unknown processing strategy: ${strategy}`);
      }

      // Update session metrics
      const processingDuration = Date.now() - processingStart;
      session.metrics.processingDuration = processingDuration;
      session.metrics.tokensUsed = estimatedTokens;
      session.status = "completed";
      session.endTime = Date.now();

      Logger.debug(this.env, "processOptimizedMessages: Processing completed", {
        sessionId: session.sessionId,
        strategy,
        processingDuration,
        totalDuration: session.endTime - session.startTime,
      });

      return result;
    } catch (error) {
      const e = error as Error;
      session.status = "failed";
      session.errors.push({
        stage: "ai_final",
        error: e.message,
        timestamp: Date.now(),
        recoverable: true,
      });

      Logger.error("processOptimizedMessages: Processing failed", {
        sessionId: session.sessionId,
        error: e.message,
        stack: e.stack,
      });

      // Try fallback to legacy system
      return await this.processLegacy("messages", chatId, count);
    }
  }

  /**
   * Falls back to legacy processing
   */
  private async processLegacy(
    type: "chat" | "messages",
    chatId: number,
    value: number,
  ): Promise<string> {
    Logger.debug(this.env, "Using legacy processing", {
      type,
      chatId: chatId.toString(LOG_ID_RADIX),
      value,
    });

    // The legacy functions send messages directly, so we need to call them
    // and then throw an error to indicate that the message was already sent
    if (type === "chat") {
      await legacySummariseChat(this.env, chatId, value);
    } else {
      await legacySummariseChatMessages(this.env, chatId, value);
    }

    // Throw a special error to indicate that the message was already sent
    // This prevents the caller from trying to send another message
    throw new Error("LEGACY_MESSAGE_SENT");
  }

  /**
   * Initializes a processing session
   */
  private initializeSession(
    sessionId: string,
    chatId: number,
    type: string,
  ): ProcessingSession {
    const session: ProcessingSession = {
      sessionId,
      chatId,
      startTime: Date.now(),
      strategy: "direct", // Will be updated based on strategy selection
      status: "initializing",
      metrics: {
        totalMessages: 0,
        fetchDuration: 0,
        processingDuration: 0,
        tokensUsed: 0,
        aiRequestsCount: 0,
      },
      errors: [],
    };

    this.sessions.set(sessionId, session);

    Logger.debug(this.env, "Processing session initialized", {
      sessionId,
      chatId: chatId.toString(LOG_ID_RADIX),
      type,
    });

    return session;
  }

  /**
   * Generates a unique session ID
   */
  private generateSessionId(
    chatId: number,
    type: string,
    value: number,
  ): string {
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
    return this.strategySelector.explainStrategySelection(
      messageCount,
      estimatedTokens,
    );
  }

  /**
   * Filters content messages (removes bot commands, empty messages, etc.)
   */
  private filterContentMessages(
    messages: TelegramMessage[],
  ): TelegramMessage[] {
    return messages.filter((msg) => {
      if (!msg.text || typeof msg.text !== 'string') {
        return false;
      }
      const text = msg.text.toLowerCase().trim();

      // Ignore bot commands
      if (text.startsWith("/")) {
        return false;
      }

      // Ignore bot mentions
      if (text.includes("@stat_history_bot") || text.includes("@bot")) {
        return false;
      }

      // Ignore very short messages (likely reactions), but only if less than 2 characters
      if (text.length < 2) {
        return false;
      }

      // Ignore messages with only emoji or symbols
      if (!/[а-яёa-z]/i.test(text)) {
        return false;
      }

      return true;
    });
  }
}
