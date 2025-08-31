import type { DurableObjectState } from "@cloudflare/workers-types";
import {
  Env,
  StoredMessage,
  LOG_ID_RADIX,
} from "./env";
import { Logger, PerformanceTracker } from "./logger";
import { TelegramMessage } from "./providers/ai-provider";

interface AggregationSession {
  sessionId: string;
  chatId: number;
  status: "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  messagesReceived: number;
  messagesAggregated: number;
  aggregatedMessages: TelegramMessage[];
  errors: string[];
  lastActivity: number;
}

/**
 * Durable Object for aggregating messages from parallel fetching operations.
 * Handles sorting, deduplication, and session management.
 */
export class MessageAggregatorDO {
  private sessions = new Map<string, AggregationSession>();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_SESSIONS = 100;

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    // Clean up old sessions on startup
    this.cleanupOldSessions();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const endpoint = url.pathname;

    try {
      switch (endpoint) {
        case "/initialize":
          return await this.handleInitialize(request);
        case "/aggregate":
          return await this.handleAggregate(request);
        case "/results":
          return await this.handleGetResults(request);
        case "/cleanup":
          return await this.handleCleanup(request);
        case "/status":
          return await this.handleGetStatus(request);
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error: unknown) {
      Logger.error("MessageAggregatorDO error", {
        endpoint,
        error: error.message || String(error),
        stack: error.stack,
      });
      return new Response("Internal server error", { status: 500 });
    }
  }

  private async handleInitialize(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await request.json() as { sessionId: string; chatId: number };
      const { sessionId, chatId } = body;

      if (!sessionId || typeof chatId !== 'number') {
        return new Response("Invalid request body", { status: 400 });
      }

      // Clean up old sessions before creating new one
      this.cleanupOldSessions();

      if (this.sessions.size >= this.MAX_SESSIONS) {
        Logger.warn(this.env, "MessageAggregatorDO session limit reached", {
          sessionId,
          currentSessions: this.sessions.size,
          maxSessions: this.MAX_SESSIONS,
        });
        return new Response("Session limit reached", { status: 429 });
      }

      const trackerId = PerformanceTracker.start(
        "MessageAggregatorDO_initialize",
        sessionId,
        {
          chatId: chatId.toString(LOG_ID_RADIX),
        },
      );

      const session: AggregationSession = {
        sessionId,
        chatId,
        status: "running",
        startTime: Date.now(),
        messagesReceived: 0,
        messagesAggregated: 0,
        aggregatedMessages: [],
        errors: [],
        lastActivity: Date.now(),
      };

      this.sessions.set(sessionId, session);

      Logger.debug(this.env, "MessageAggregatorDO session initialized", {
        sessionId,
        chatId: chatId.toString(LOG_ID_RADIX),
      });

      PerformanceTracker.end(trackerId, {
        status: "success",
        sessionCreated: true,
      });

      return new Response(JSON.stringify({ success: true, sessionId }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error: unknown) {
      Logger.error("MessageAggregatorDO initialization error", {
        error: error.message || String(error),
        stack: error.stack,
      });
      return new Response("Failed to initialize session", { status: 500 });
    }
  }

  private async handleAggregate(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await request.json() as {
        sessionId: string;
        messages: StoredMessage[];
      };
      const { sessionId, messages } = body;

      if (!sessionId || !Array.isArray(messages)) {
        return new Response("Invalid request body", { status: 400 });
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }

      if (session.status !== "running") {
        return new Response("Session not in running state", { status: 409 });
      }

      const trackerId = PerformanceTracker.start(
        "MessageAggregatorDO_aggregate",
        sessionId,
        {
          chatId: session.chatId.toString(LOG_ID_RADIX),
          incomingMessages: messages.length,
          currentAggregated: session.messagesAggregated,
        },
      );

      try {
        // Convert StoredMessage to TelegramMessage and add to aggregation
        const telegramMessages: TelegramMessage[] = messages.map(msg => ({
          username: msg.username,
          text: msg.text,
          ts: msg.ts,
        }));

        // Add new messages to the session
        session.aggregatedMessages.push(...telegramMessages);
        session.messagesReceived += messages.length;
        session.lastActivity = Date.now();

        // Sort messages by timestamp to maintain chronological order
        session.aggregatedMessages.sort((a, b) => a.ts - b.ts);

        // Remove duplicates based on timestamp and username
        const uniqueMessages = this.deduplicateMessages(session.aggregatedMessages);
        session.aggregatedMessages = uniqueMessages;
        session.messagesAggregated = uniqueMessages.length;

        Logger.debug(this.env, "MessageAggregatorDO messages aggregated", {
          sessionId,
          chatId: session.chatId.toString(LOG_ID_RADIX),
          incomingMessages: messages.length,
          totalReceived: session.messagesReceived,
          totalAggregated: session.messagesAggregated,
          duplicatesRemoved: session.messagesReceived - session.messagesAggregated,
        });

        PerformanceTracker.end(trackerId, {
          status: "success",
          messagesProcessed: messages.length,
          totalAggregated: session.messagesAggregated,
          duplicatesRemoved: session.messagesReceived - session.messagesAggregated,
        });

        return new Response(JSON.stringify({
          success: true,
          messagesAggregated: session.messagesAggregated,
          messagesReceived: session.messagesReceived,
        }), {
          headers: { "Content-Type": "application/json" },
        });

      } catch (error: unknown) {
        session.errors.push(`Aggregation error: ${error.message}`);
        session.status = "failed";

        PerformanceTracker.end(trackerId, {
          status: "error",
          error: error.message,
        });

        throw error;
      }

    } catch (error: unknown) {
      Logger.error("MessageAggregatorDO aggregation error", {
        error: error.message || String(error),
        stack: error.stack,
      });
      return new Response("Failed to aggregate messages", { status: 500 });
    }
  }

  private async handleGetResults(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get("sessionId");

      if (!sessionId) {
        return new Response("Missing sessionId parameter", { status: 400 });
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }

      const trackerId = PerformanceTracker.start(
        "MessageAggregatorDO_getResults",
        sessionId,
        {
          chatId: session.chatId.toString(LOG_ID_RADIX),
          messagesAggregated: session.messagesAggregated,
        },
      );

      // Mark session as completed when results are retrieved
      if (session.status === "running") {
        session.status = "completed";
        session.endTime = Date.now();
      }

      // Validate message integrity
      const validationErrors = this.validateMessageIntegrity(session.aggregatedMessages);
      if (validationErrors.length > 0) {
        session.errors.push(...validationErrors);
        Logger.warn(this.env, "MessageAggregatorDO validation errors", {
          sessionId,
          validationErrors,
        });
      }

      const result = {
        sessionId,
        status: session.status,
        messagesAggregated: session.messagesAggregated,
        messagesReceived: session.messagesReceived,
        messages: session.aggregatedMessages,
        errors: session.errors,
        processingTime: session.endTime ? session.endTime - session.startTime : null,
      };

      Logger.debug(this.env, "MessageAggregatorDO results retrieved", {
        sessionId,
        chatId: session.chatId.toString(LOG_ID_RADIX),
        messagesCount: session.messagesAggregated,
        status: session.status,
        processingTime: result.processingTime,
        hasErrors: session.errors.length > 0,
      });

      PerformanceTracker.end(trackerId, {
        status: "success",
        messagesReturned: session.messagesAggregated,
        processingTime: result.processingTime,
      });

      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error: unknown) {
      Logger.error("MessageAggregatorDO get results error", {
        error: error.message || String(error),
        stack: error.stack,
      });
      return new Response("Failed to get results", { status: 500 });
    }
  }

  private async handleGetStatus(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get("sessionId");

      if (!sessionId) {
        return new Response("Missing sessionId parameter", { status: 400 });
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }

      const status = {
        sessionId,
        status: session.status,
        messagesReceived: session.messagesReceived,
        messagesAggregated: session.messagesAggregated,
        errors: session.errors,
        startTime: session.startTime,
        endTime: session.endTime,
        lastActivity: session.lastActivity,
      };

      return new Response(JSON.stringify(status), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error: unknown) {
      Logger.error("MessageAggregatorDO get status error", {
        error: error.message || String(error),
        stack: error.stack,
      });
      return new Response("Failed to get status", { status: 500 });
    }
  }

  private async handleCleanup(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body = await request.json() as { sessionId: string };
      const { sessionId } = body;

      if (!sessionId) {
        return new Response("Missing sessionId", { status: 400 });
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }

      const trackerId = PerformanceTracker.start(
        "MessageAggregatorDO_cleanup",
        sessionId,
        {
          chatId: session.chatId.toString(LOG_ID_RADIX),
          messagesAggregated: session.messagesAggregated,
        },
      );

      this.sessions.delete(sessionId);

      Logger.debug(this.env, "MessageAggregatorDO session cleaned up", {
        sessionId,
        chatId: session.chatId.toString(LOG_ID_RADIX),
        remainingSessions: this.sessions.size,
      });

      PerformanceTracker.end(trackerId, {
        status: "success",
        sessionCleaned: true,
        remainingSessions: this.sessions.size,
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error: unknown) {
      Logger.error("MessageAggregatorDO cleanup error", {
        error: error.message || String(error),
        stack: error.stack,
      });
      return new Response("Failed to cleanup session", { status: 500 });
    }
  }

  /**
   * Remove duplicate messages based on timestamp and username combination
   */
  private deduplicateMessages(messages: TelegramMessage[]): TelegramMessage[] {
    const seen = new Set<string>();
    const uniqueMessages: TelegramMessage[] = [];

    for (const message of messages) {
      // Create a unique key based on timestamp, username, and first 50 chars of text
      const key = `${message.ts}_${message.username}_${message.text.substring(0, 50)}`;

      if (!seen.has(key)) {
        seen.add(key);
        uniqueMessages.push(message);
      }
    }

    return uniqueMessages;
  }

  /**
   * Validate the integrity of aggregated messages
   */
  private validateMessageIntegrity(messages: TelegramMessage[]): string[] {
    const errors: string[] = [];

    // Check for required fields
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (!message.username || typeof message.username !== 'string') {
        errors.push(`Message ${i}: missing or invalid username`);
      }

      if (!message.text || typeof message.text !== 'string') {
        errors.push(`Message ${i}: missing or invalid text`);
      }

      if (!message.ts || typeof message.ts !== 'number' || message.ts <= 0) {
        errors.push(`Message ${i}: missing or invalid timestamp`);
      }
    }

    // Check for chronological order
    for (let i = 1; i < messages.length; i++) {
      if (messages[i].ts < messages[i - 1].ts) {
        errors.push(`Messages not in chronological order at index ${i}`);
        break; // One error is enough for this check
      }
    }

    return errors;
  }

  /**
   * Clean up old and inactive sessions
   */
  private cleanupOldSessions(): void {
    const now = Date.now();
    const sessionsToDelete: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const timeSinceLastActivity = now - session.lastActivity;

      if (timeSinceLastActivity > this.SESSION_TIMEOUT) {
        sessionsToDelete.push(sessionId);
      }
    }

    if (sessionsToDelete.length > 0) {
      for (const sessionId of sessionsToDelete) {
        this.sessions.delete(sessionId);
      }

      Logger.debug(this.env, "MessageAggregatorDO cleaned up old sessions", {
        cleanedSessions: sessionsToDelete.length,
        remainingSessions: this.sessions.size,
      });
    }
  }
}
