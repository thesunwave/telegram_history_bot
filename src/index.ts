import { migrateStatsBatch, MIGRATION_PAGE } from "./migrate";
import { Env } from "./env";
import { dailySummary } from "./stats";
import { summariseChat, summariseChatMessages } from "./summary";
import { handleUpdate, recordMessage, getTextMessage } from "./update";
import { CountersDO } from "./counters-do";
import { MessageFetcherDO } from "./message-fetcher-do";
import { MessageAggregatorDO } from "./message-aggregator-do";
import { DayBlockManager } from "./day-block-manager";
import { CriminalCodeAnalyzerDO } from "./criminal-code-analyzer-do";
import { ProviderInitializer } from "./providers/provider-init";
import { Logger } from "./logger";
import type {
  ExecutionContext,
  ScheduledEvent,
} from "@cloudflare/workers-types";

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // Initialize provider on first request if not already initialized
    if (!ProviderInitializer.isProviderInitialized()) {
      try {
        await ProviderInitializer.initializeProvider(env);
      } catch (error: any) {
        console.error("Failed to initialize provider on request", {
          error: error.message || String(error),
          path: new URL(req.url).pathname,
        });
        // Continue processing - provider will be created on-demand if needed
      }
    }

    const url = new URL(req.url);

    // Migration endpoints
    if (url.pathname === "/migrate") {
      return new Response(MIGRATION_PAGE, {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname === "/api/migrate" && req.method === "POST") {
      const cursor = url.searchParams.get("cursor") || undefined;
      const result = await migrateStatsBatch(env, cursor);
      return Response.json(result);
    }

    if (url.pathname === "/api/reset-activity" && req.method === "POST") {
      const { resetActivityBatch } = await import("./migrate");
      const cursor = url.searchParams.get("cursor") || undefined;
      const result = await resetActivityBatch(env, cursor);
      return Response.json(result);
    }

    if (url.pathname === "/healthz") return new Response("ok");
    if (
      url.pathname.startsWith("/tg/") &&
      url.pathname.endsWith("/webhook") &&
      req.method === "POST"
    ) {
      const token = url.pathname.split("/")[2];
      const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

      const tokenMatches = token === env.TOKEN;
      const secretMatches = secretHeader === env.SECRET;

      Logger.debug(env, "webhook auth check", {
        tokenProvided: Boolean(token),
        tokenMatches,
        secretProvided: Boolean(secretHeader),
        secretMatches,
      });

      if (!tokenMatches) {
        if (env.ENVIRONMENT === "development") {
          Logger.warn(env, "webhook token mismatch (IGNORED IN DEVELOPMENT)", {
            tokenProvided: Boolean(token),
          });
        } else {
          Logger.warn(env, "webhook token mismatch", {
            tokenProvided: Boolean(token),
          });
          return new Response("forbidden", { status: 403 });
        }
      }

      if (!secretMatches) {
        console.log('DEBUG: env.ENVIRONMENT =', `"${env.ENVIRONMENT}"`);
        console.log('DEBUG: secretMatches =', secretMatches);
        if (env.ENVIRONMENT === "development") {
          Logger.warn(env, "webhook secret mismatch (IGNORED IN DEVELOPMENT)", {
            secretProvided: Boolean(secretHeader),
          });
        } else {
          Logger.warn(env, "webhook secret mismatch", {
            secretProvided: Boolean(secretHeader),
          });
          return new Response("forbidden", { status: 403 });
        }
      }
      const update = await req.json();
      Logger.debug(env, "webhook received", {
        updateType: (update as any).message ? "message" : "other",
        chatId: (update as any).message?.chat?.id,
        messageId: (update as any).message?.message_id,
        hasText: !!(update as any).message?.text,
        isBot: (update as any).message?.from?.is_bot,
      });

      const msg = getTextMessage(update);
      Logger.debug(env, "getTextMessage result", {
        hasMessage: Boolean(msg),
        textLength: msg?.text?.length ?? 0,
        isCommand: msg?.text?.startsWith("/") ?? false,
      });

      await recordMessage(msg, env, ctx);
      ctx.waitUntil(handleUpdate(msg, env));
      return Response.json({});
    }
    if (url.pathname === "/jobs/daily_summary" && req.method === "POST") {
      await dailySummary(env);
      return Response.json({});
    }

    // Criminal Code Analysis API endpoints
    if (url.pathname === "/api/criminal-stats" && req.method === "GET") {
      try {
        const chatId = url.searchParams.get("chatId");
        const userId = url.searchParams.get("userId");
        const days = url.searchParams.get("days") || "30";

        if (!chatId) {
          return new Response("Missing chatId parameter", { status: 400 });
        }

        const id = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(`criminal-analyzer-${chatId}`);
        const stub = env.CRIMINAL_CODE_ANALYZER_DO.get(id);

        const statsUrl = new URL("/stats", "http://localhost");
        if (userId) statsUrl.searchParams.set("userId", userId);
        statsUrl.searchParams.set("days", days);

        // Use string URL to avoid Request type conflicts
        const response = await stub.fetch(statsUrl.toString());
        return response as unknown as Response;
      } catch (error: any) {
        console.error("Criminal stats API error:", error);
        return new Response("Internal server error", { status: 500 });
      }
    }

    if (url.pathname === "/api/criminal-report" && req.method === "POST") {
      try {
        const body = await req.json() as any;
        const { chatId, text, userId } = body;

        if (!chatId || !text) {
          return new Response("Missing required parameters", { status: 400 });
        }

        const id = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(`criminal-analyzer-${chatId}`);
        const stub = env.CRIMINAL_CODE_ANALYZER_DO.get(id);

        // Use URL string and init object to avoid Request type conflicts
        const response = await stub.fetch("http://localhost/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, userId })
        });
        return response as unknown as Response;
      } catch (error: any) {
        console.error("Criminal report API error:", error);
        return new Response("Internal server error", { status: 500 });
      }
    }

    // Debug endpoints
    if (url.pathname === "/debug/summary" && req.method === "POST") {
      // Ensure debug endpoints are only available in development
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const daysStr = url.searchParams.get("days") || "1";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const days = parseInt(daysStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      console.log(`[DEBUG] Starting summary for chat ${chatId} (days=${days})`);

      // Check if mock mode is requested
      const useMock = url.searchParams.get("mock") === "true";

      // Force enable debug logs and dry run for this operation
      // If mock is requested, override provider to 'mock'
      const debugEnv = {
        ...env,
        DEBUG_LOGS: "true",
        DRY_RUN: "true",
        ...(useMock ? { SUMMARY_PROVIDER: "mock" as any } : {})
      };

      // Await summarization to keep request open and prevent premature timeout
      try {
        const result = await summariseChat(debugEnv, chatId, days);

        // If we got a string result back (from dry run), return it
        if (typeof result === 'string') {
          return Response.json({ status: "completed", chatId, days, summary: result, provider: useMock ? "mock" : "real" });
        }

        return Response.json({ status: "completed", chatId, days });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          chatId,
          days,
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    if (url.pathname === "/debug/summary_messages" && req.method === "POST") {
      // Ensure debug endpoints are only available in development
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const countStr = url.searchParams.get("count") || "50";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const count = parseInt(countStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      console.log(`[DEBUG] Starting message summary for chat ${chatId} (count=${count})`);

      // Check if mock mode is requested
      const useMock = url.searchParams.get("mock") === "true";

      // Force enable debug logs and dry run for this operation
      // If mock is requested, override provider to 'mock'
      const debugEnv = {
        ...env,
        DEBUG_LOGS: "true",
        DRY_RUN: "true",
        ...(useMock ? { SUMMARY_PROVIDER: "mock" as any } : {})
      };

      try {
        const result = await summariseChatMessages(debugEnv, chatId, count);

        // If we got a string result back (from dry run), return it
        if (typeof result === 'string') {
          return Response.json({ status: "completed", chatId, count, summary: result, provider: useMock ? "mock" : "real" });
        }

        return Response.json({ status: "completed", chatId, count });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          chatId,
          count,
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    // Initialize provider for scheduled events if not already initialized
    if (!ProviderInitializer.isProviderInitialized()) {
      try {
        await ProviderInitializer.initializeProvider(env);
      } catch (error: any) {
        console.error("Failed to initialize provider on scheduled event", {
          error: error.message || String(error),
        });
        // Continue processing - provider will be created on-demand if needed
      }
    }

    await dailySummary(env);
  },
};

export { CountersDO, MessageFetcherDO, MessageAggregatorDO, DayBlockManager, CriminalCodeAnalyzerDO };
