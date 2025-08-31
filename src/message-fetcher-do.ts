import type { DurableObjectState } from "@cloudflare/workers-types";
import {
  Env,
  StoredMessage,
  LOG_ID_RADIX,
  DEFAULT_KV_BATCH_SIZE,
  DEFAULT_KV_BATCH_DELAY,
} from "./env";
import { Logger, PerformanceTracker } from "./logger";
import { processBatchesDetailed, BatchErrorType } from "./utils";
import {
  ParallelFetchRequest,
  FetchStatus,
} from "./summary-optimization/types";

interface SessionData {
  sessionId: string;
  request: ParallelFetchRequest;
  status: "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  fetchesCompleted: number;
  totalFetches: number;
  messagesCollected: number;
  messages: StoredMessage[];
  errors: string[];
  cursors: string[];
  currentCursorIndex: number;
}

/**
 * Durable Object for coordinating parallel message fetching from KV storage.
 * Uses Promise.all() for concurrent KV operations rather than separate worker processes.
 */
export class MessageFetcherDO {
  private sessions = new Map<string, SessionData>();

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
        case "/status":
          return await this.handleGetStatus(request);
        case "/results":
          return await this.handleGetResults(request);
        case "/cleanup":
          return await this.handleCleanup(request);
        default:
          return new Response("Not found", { status: 404 });
      }
    } catch (error: unknown) {
      Logger.error("MessageFetcherDO error", {
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
      const fetchRequest: ParallelFetchRequest =
        (await request.json()) as ParallelFetchRequest;
      this.validateFetchRequest(fetchRequest);

      const sessionId = this.generateSessionId();
      const trackerId = PerformanceTracker.start(
        "MessageFetcherDO_initialize",
        sessionId,
        {
          chatId: fetchRequest.chatId.toString(LOG_ID_RADIX),
          timeRange: `${new Date(fetchRequest.start * 1000).toISOString()}_to_${new Date(fetchRequest.end * 1000).toISOString()}`,
          concurrentFetches: fetchRequest.concurrentFetches,
          batchSize: fetchRequest.batchSize,
        },
      );

      Logger.debug(this.env, "MessageFetcherDO initializing parallel fetch", {
        sessionId,
        chatId: fetchRequest.chatId.toString(LOG_ID_RADIX),
        start: new Date(fetchRequest.start * 1000).toISOString(),
        end: new Date(fetchRequest.end * 1000).toISOString(),
        concurrentFetches: fetchRequest.concurrentFetches,
        batchSize: fetchRequest.batchSize,
        trackerId,
      });

      // Initialize session
      const session: SessionData = {
        sessionId,
        request: fetchRequest,
        status: "running",
        startTime: Date.now(),
        fetchesCompleted: 0,
        totalFetches: fetchRequest.concurrentFetches,
        messagesCollected: 0,
        messages: [],
        errors: [],
        cursors: [],
        currentCursorIndex: 0,
      };

      this.sessions.set(sessionId, session);

      // Start parallel fetching in the background
      this.startParallelFetch(session, trackerId);

      return new Response(JSON.stringify({ sessionId }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error: unknown) {
      Logger.error("MessageFetcherDO initialization failed", {
        error: error.message || String(error),
        stack: error.stack,
      });
      return new Response("Bad request", { status: 400 });
    }
  }

  private async handleGetStatus(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return new Response("Missing sessionId parameter", { status: 400 });
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    const status: FetchStatus = {
      sessionId: session.sessionId,
      status: session.status,
      fetchesCompleted: session.fetchesCompleted,
      totalFetches: session.totalFetches,
      messagesCollected: session.messagesCollected,
      errors: session.errors,
    };

    return new Response(JSON.stringify(status), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleGetResults(request: Request): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return new Response("Missing sessionId parameter", { status: 400 });
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    if (session.status === "running") {
      return new Response("Session still running", { status: 202 });
    }

    return new Response(JSON.stringify(session.messages), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleCleanup(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const { sessionId } = (await request.json()) as { sessionId?: string };

    if (sessionId) {
      this.sessions.delete(sessionId);
      Logger.debug(this.env, "MessageFetcherDO session cleaned up", {
        sessionId,
      });
    } else {
      // Clean up all old sessions
      this.cleanupOldSessions();
      Logger.debug(this.env, "MessageFetcherDO all old sessions cleaned up");
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private validateFetchRequest(request: ParallelFetchRequest): void {
    if (!request.chatId || !request.start || !request.end) {
      throw new Error("Missing required parameters: chatId, start, end");
    }

    if (request.start >= request.end) {
      throw new Error("Start time must be less than end time");
    }

    if (request.concurrentFetches < 1 || request.concurrentFetches > 20) {
      throw new Error("concurrentFetches must be between 1 and 20");
    }

    if (request.batchSize < 1 || request.batchSize > 1000) {
      throw new Error("batchSize must be between 1 and 1000");
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async startParallelFetch(
    session: SessionData,
    trackerId: string,
  ): Promise<void> {
    try {
      Logger.debug(this.env, "MessageFetcherDO starting parallel fetch", {
        sessionId: session.sessionId,
        chatId: session.request.chatId.toString(LOG_ID_RADIX),
        trackerId,
      });

      // First, collect all cursors by scanning the KV namespace
      const cursors = await this.collectCursors(session);
      session.cursors = cursors;
      session.totalFetches = Math.min(
        cursors.length,
        session.request.concurrentFetches,
      );

      Logger.debug(this.env, "MessageFetcherDO cursors collected", {
        sessionId: session.sessionId,
        cursorsCount: cursors.length,
        actualFetches: session.totalFetches,
        trackerId,
      });

      if (cursors.length === 0) {
        session.status = "completed";
        session.endTime = Date.now();
        PerformanceTracker.end(trackerId, {
          result: "success",
          messagesFound: 0,
        });
        return;
      }

      // Process cursors in parallel using Promise.all()
      const messages = await this.processMultipleCursors(session, cursors);

      // Sort messages by timestamp
      session.messages = messages.sort((a, b) => a.ts - b.ts);
      session.messagesCollected = session.messages.length;
      session.status = "completed";
      session.endTime = Date.now();

      Logger.debug(this.env, "MessageFetcherDO parallel fetch completed", {
        sessionId: session.sessionId,
        messagesCollected: session.messagesCollected,
        duration: session.endTime - session.startTime,
        trackerId,
      });

      PerformanceTracker.end(trackerId, {
        result: "success",
        messagesFound: session.messagesCollected,
        duration: session.endTime - session.startTime,
      });
    } catch (error: unknown) {
      session.status = "failed";
      session.endTime = Date.now();
      session.errors.push(error.message || String(error));

      Logger.error("MessageFetcherDO parallel fetch failed", {
        sessionId: session.sessionId,
        error: error.message || String(error),
        stack: error.stack,
        trackerId,
      });

      PerformanceTracker.end(trackerId, {
        result: "error",
        errorType: error.constructor?.name || "Unknown",
        messagesFound: session.messagesCollected,
      });
    }
  }

  private async collectCursors(session: SessionData): Promise<string[]> {
    const { chatId, start, end } = session.request;
    const prefix = `msg:${chatId}:`;
    const cursors: string[] = [];
    let cursor: string | undefined = undefined;

    do {
      const list: { keys: { name: string }[]; cursor?: string } =
        await this.env.HISTORY.list({
          prefix,
          cursor,
          limit: 1000, // Get more keys per list operation
        });

      cursor = list.cursor;

      // Filter keys that match the time range
      const matchingKeys = list.keys.filter((key: { name: string }) => {
        const parts = key.name.split(":");
        const ts = parseInt(parts[2]);
        return ts >= start && ts <= end;
      });

      if (matchingKeys.length > 0) {
        // Group keys into cursor ranges for parallel processing
        cursors.push(cursor || "end");
      }
    } while (cursor && cursors.length < 100); // Limit cursor collection

    return cursors;
  }

  private async processMultipleCursors(
    session: SessionData,
    cursors: string[],
  ): Promise<StoredMessage[]> {
    const { chatId, start, end, concurrentFetches, batchSize } =
      session.request;
    const prefix = `msg:${chatId}:`;

    // Divide cursors among concurrent fetchers
    const cursorChunks = this.chunkArray(
      cursors,
      Math.ceil(cursors.length / concurrentFetches),
    );

    Logger.debug(this.env, "MessageFetcherDO processing cursor chunks", {
      sessionId: session.sessionId,
      totalCursors: cursors.length,
      chunks: cursorChunks.length,
      concurrentFetches,
    });

    // Create parallel fetch operations
    const fetchOperations = cursorChunks
      .slice(0, concurrentFetches)
      .map(async (chunk, index) => {
        const fetchId = `fetch_${index}`;
        const chunkStartTime = Date.now();

        try {
          Logger.debug(this.env, "MessageFetcherDO chunk processing start", {
            sessionId: session.sessionId,
            fetchId,
            chunkSize: chunk.length,
          });

          const messages: StoredMessage[] = [];
          let cursor: string | undefined = undefined;
          let keysProcessed = 0;

          // Process each cursor in the chunk
          do {
            const list: { keys: { name: string }[]; cursor?: string } =
              await this.env.HISTORY.list({
                prefix,
                cursor,
                limit: batchSize * 2, // Get more keys per list to reduce iterations
              });

            cursor = list.cursor;

            // Filter keys that match the time range
            const keysToFetch = list.keys.filter((key: { name: string }) => {
              const parts = key.name.split(":");
              const ts = parseInt(parts[2]);
              return ts >= start && ts <= end;
            });

            if (keysToFetch.length > 0) {
              // Batch process KV requests for this chunk
              const batchResult = await processBatchesDetailed(
                keysToFetch,
                async (key: { name: string }) => {
                  return this.env.HISTORY.get<StoredMessage>(key.name, {
                    type: "json",
                  });
                },
                {
                  batchSize: Math.min(batchSize, DEFAULT_KV_BATCH_SIZE),
                  delayBetweenBatches: DEFAULT_KV_BATCH_DELAY,
                },
              );

              // Collect valid messages
              for (const message of batchResult.results) {
                if (message !== null && message !== undefined) {
                  messages.push(message);
                }
              }

              keysProcessed += keysToFetch.length;

              // Handle errors in this chunk
              if (batchResult.errors.length > 0) {
                const errorMsg = `Chunk ${fetchId}: ${batchResult.errors.length} errors occurred`;
                session.errors.push(errorMsg);

                Logger.debug(
                  this.env,
                  "MessageFetcherDO chunk processing errors",
                  {
                    sessionId: session.sessionId,
                    fetchId,
                    errors: batchResult.errors.length,
                    successRate: batchResult.successRate,
                  },
                );
              }

              // Early break if we have too many API limit errors
              if (
                batchResult.hasApiLimitErrors &&
                batchResult.successRate < 50
              ) {
                Logger.error(
                  "MessageFetcherDO chunk aborted due to API limits",
                  {
                    sessionId: session.sessionId,
                    fetchId,
                    successRate: batchResult.successRate,
                  },
                );
                break;
              }
            }
          } while (cursor && messages.length < 10000); // Limit messages per chunk

          session.fetchesCompleted++;
          const chunkDuration = Date.now() - chunkStartTime;

          Logger.debug(
            this.env,
            "MessageFetcherDO chunk processing completed",
            {
              sessionId: session.sessionId,
              fetchId,
              messagesCollected: messages.length,
              keysProcessed,
              duration: chunkDuration,
              completedFetches: session.fetchesCompleted,
              totalFetches: session.totalFetches,
            },
          );

          return messages;
        } catch (error: unknown) {
          session.fetchesCompleted++;
          const errorMsg = `Fetch ${fetchId} failed: ${error.message || String(error)}`;
          session.errors.push(errorMsg);

          Logger.error("MessageFetcherDO chunk processing failed", {
            sessionId: session.sessionId,
            fetchId,
            error: error.message || String(error),
            duration: Date.now() - chunkStartTime,
          });

          return []; // Return empty array for failed chunks
        }
      });

    // Wait for all parallel operations to complete
    const results = await Promise.all(fetchOperations);

    // Flatten and return all messages
    const allMessages = results.flat();

    Logger.debug(this.env, "MessageFetcherDO all chunks processed", {
      sessionId: session.sessionId,
      totalMessages: allMessages.length,
      completedFetches: session.fetchesCompleted,
      errors: session.errors.length,
    });

    return allMessages;
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private cleanupOldSessions(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now - session.startTime;
      if (age > maxAge || session.status !== "running") {
        this.sessions.delete(sessionId);
      }
    }
  }
}
