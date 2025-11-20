import { migrateStatsBatch, MIGRATION_PAGE } from "./migrate";
import { Env } from "./env";
import { dailySummary } from "./stats";
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
        Logger.warn(env, "webhook token mismatch", {
          tokenProvided: Boolean(token),
        });
        return new Response("forbidden", { status: 403 });
      }

      if (!secretMatches) {
        Logger.warn(env, "webhook secret mismatch", {
          secretProvided: Boolean(secretHeader),
        });
        return new Response("forbidden", { status: 403 });
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

        const response = await stub.fetch(new Request(statsUrl.toString()));
        return response;
      } catch (error: any) {
        console.error("Criminal stats API error:", error);
        return new Response("Internal server error", { status: 500 });
      }
    }

    if (url.pathname === "/api/criminal-report" && req.method === "POST") {
      try {
        const body = await req.json();
        const { chatId, text, userId } = body;

        if (!chatId || !text) {
          return new Response("Missing required parameters", { status: 400 });
        }

        const id = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(`criminal-analyzer-${chatId}`);
        const stub = env.CRIMINAL_CODE_ANALYZER_DO.get(id);

        const analyzeRequest = new Request("http://localhost/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, userId })
        });

        const response = await stub.fetch(analyzeRequest);
        return response;
      } catch (error: any) {
        console.error("Criminal report API error:", error);
        return new Response("Internal server error", { status: 500 });
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
