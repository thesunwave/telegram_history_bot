import { migrateStatsBatch, MIGRATION_PAGE } from "./features/migration/migrate";
import { Env } from "./core/env";
import { dailySummary } from "./features/stats/stats";
import { summariseChat, summariseChatMessages } from "./features/summary/summary";
import {
  topChat,
  profanityTopUsers,
  profanityWordsStats,
  myProfanityStats,
  profanityChart,
  activityChart,
  activityByUser,
  criminalCodeStats,
  criminalTopUsers,
  myCriminalStats,
  cleanupOldData
} from "./features/stats/stats";
import { handleUpdate, recordMessage, getTextMessage } from "./api/update";
import { CountersDO } from "./durable-objects/counters-do";
import { MessageFetcherDO } from "./durable-objects/message-fetcher-do";
import { MessageAggregatorDO } from "./durable-objects/message-aggregator-do";
import { DayBlockManager } from "./durable-objects/day-block-manager";
import { CriminalCodeAnalyzerDO } from "./durable-objects/criminal-code-analyzer-do";
import { ProviderInitializer } from "./core/providers/provider-init";
import { Logger } from "./core/logger";
import { handleLegalRagIngestBatch, handleLegalRagSearch } from "./features/legal-rag/ingest";
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
      const key = url.searchParams.get("key");
      if (key !== env.SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }
      return new Response(MIGRATION_PAGE, {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname === "/api/migrate" && req.method === "POST") {
      const key = url.searchParams.get("key");
      if (key !== env.SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }
      const cursor = url.searchParams.get("cursor") || undefined;
      const result = await migrateStatsBatch(env, cursor);
      return Response.json(result);
    }

    if (url.pathname === "/api/reset-activity" && req.method === "POST") {
      const key = url.searchParams.get("key");
      if (key !== env.SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }
      const { resetActivityBatch } = await import("./features/migration/migrate");
      const cursor = url.searchParams.get("cursor") || undefined;
      const result = await resetActivityBatch(env, cursor);
      return Response.json(result);
    }

    if (url.pathname === "/api/legal-rag/ingest-batch" && req.method === "POST") {
      try {
        return await handleLegalRagIngestBatch(req, env);
      } catch (error: any) {
        return Response.json({
          ok: false,
          error: error?.message || String(error),
        }, { status: 400 });
      }
    }

    if (url.pathname === "/api/legal-rag/search" && req.method === "POST") {
      try {
        return await handleLegalRagSearch(req, env);
      } catch (error: any) {
        return Response.json({
          ok: false,
          error: error?.message || String(error),
        }, { status: 400 });
      }
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

    // Debug endpoint: top users
    if (url.pathname === "/debug/top_users" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const nStr = url.searchParams.get("n") || "5";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const n = parseInt(nStr, 10);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const day = today.toISOString().slice(0, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await topChat(debugEnv, chatId, n, day);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: profanity top users
    if (url.pathname === "/debug/profanity_top" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const countStr = url.searchParams.get("count") || "10";
      const period = url.searchParams.get("period") || "today";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const count = parseInt(countStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await profanityTopUsers(debugEnv, chatId, count, period);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: profanity words stats
    if (url.pathname === "/debug/profanity_words" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const countStr = url.searchParams.get("count") || "10";
      const period = url.searchParams.get("period") || "today";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const count = parseInt(countStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await profanityWordsStats(debugEnv, chatId, count, period);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: my profanity stats
    if (url.pathname === "/debug/my_profanity" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const userIdStr = url.searchParams.get("userId");
      const period = url.searchParams.get("period") || undefined;

      if (!chatIdStr || !userIdStr) {
        return new Response("Missing chatId or userId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const userId = parseInt(userIdStr, 10);

      if (isNaN(chatId) || isNaN(userId)) {
        return new Response("Invalid chatId or userId", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await myProfanityStats(debugEnv, chatId, userId, period);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: profanity chart
    if (url.pathname === "/debug/profanity_chart" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const period = url.searchParams.get("period") || "week";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      if (period !== "week" && period !== "month") {
        return new Response("Invalid period, must be 'week' or 'month'", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await profanityChart(debugEnv, chatId, period as 'week' | 'month');
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: activity chart
    if (url.pathname === "/debug/activity_chart" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const period = url.searchParams.get("period") || "week";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      if (period !== "week" && period !== "month") {
        return new Response("Invalid period, must be 'week' or 'month'", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await activityChart(debugEnv, chatId, period as 'week' | 'month');
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: activity by user
    if (url.pathname === "/debug/activity_users" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const period = url.searchParams.get("period") || "week";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      if (period !== "week" && period !== "month") {
        return new Response("Invalid period, must be 'week' or 'month'", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await activityByUser(debugEnv, chatId, period as 'week' | 'month');
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: criminal code stats
    if (url.pathname === "/debug/criminal_stats" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const period = url.searchParams.get("period") || "today";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await criminalCodeStats(debugEnv, chatId, period);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: criminal top users
    if (url.pathname === "/debug/criminal_top" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const countStr = url.searchParams.get("count") || "5";
      const period = url.searchParams.get("period") || "today";

      if (!chatIdStr) {
        return new Response("Missing chatId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const count = parseInt(countStr, 10);

      if (isNaN(chatId)) {
        return new Response("Invalid chatId", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await criminalTopUsers(debugEnv, chatId, count, period);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: my criminal stats
    if (url.pathname === "/debug/my_criminal" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const chatIdStr = url.searchParams.get("chatId");
      const userIdStr = url.searchParams.get("userId");
      const period = url.searchParams.get("period") || undefined;

      if (!chatIdStr || !userIdStr) {
        return new Response("Missing chatId or userId", { status: 400 });
      }

      const chatId = parseInt(chatIdStr, 10);
      const userId = parseInt(userIdStr, 10);

      if (isNaN(chatId) || isNaN(userId)) {
        return new Response("Invalid chatId or userId", { status: 400 });
      }

      const debugEnv = { ...env, DRY_RUN: "true" };
      try {
        const result = await myCriminalStats(debugEnv, chatId, userId, period);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
          error: error.message || String(error)
        }, { status: 500 });
      }
    }

    // Debug endpoint: manual cleanup
    if (url.pathname === "/debug/cleanup" && req.method === "POST") {
      if (env.ENVIRONMENT !== "development") {
        return new Response("Not found", { status: 404 });
      }

      const rawDays = parseInt(url.searchParams.get("raw") || "7");
      const summaryDays = parseInt(url.searchParams.get("summary") || "30");

      try {
        const result = await cleanupOldData(env, rawDays, summaryDays);
        return Response.json({ status: "success", result });
      } catch (error: any) {
        return Response.json({
          status: "failed",
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

    // Check for ENABLE_SUMMARY flag (default to true)
    const summaryEnabled = env.ENABLE_SUMMARY !== 'false' && env.ENABLE_SUMMARY !== false;

    if (summaryEnabled) {
      await dailySummary(env);
    } else {
      console.log('Daily summary skipped (ENABLE_SUMMARY is false)');
    }

    // Run cleanup job
    try {
      const cleanupResult = await cleanupOldData(env, 7, 30);
      Logger.info(env, "Daily cleanup completed", cleanupResult);
    } catch (e: any) {
      Logger.error("Daily cleanup failed", { error: e.message || String(e) });
    }
  },
};

export { CountersDO, MessageFetcherDO, MessageAggregatorDO, DayBlockManager, CriminalCodeAnalyzerDO };
