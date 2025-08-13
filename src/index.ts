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
    if (url.pathname === "/healthz") return new Response("ok");
    if (
      url.pathname.startsWith("/tg/") &&
      url.pathname.endsWith("/webhook") &&
      req.method === "POST"
    ) {
      const token = url.pathname.split("/")[2];
      const secretHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
      
      console.log("webhook auth check", {
        urlToken: token,
        envToken: env.TOKEN,
        tokenMatch: token === env.TOKEN,
        secretHeader: secretHeader,
        envSecret: env.SECRET,
        secretMatch: secretHeader === env.SECRET
      });
      
      if (token !== env.TOKEN) {
         console.log("token mismatch", { token, envToken: env.TOKEN });
         return new Response("forbidden", { status: 403 });
       }
       if (secretHeader !== env.SECRET) {
         console.log("secret mismatch", { secretHeader, envSecret: env.SECRET });
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
        hasMessage: !!msg,
        text: msg?.text?.substring(0, 50),
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
