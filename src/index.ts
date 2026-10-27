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
import { handleAdminRequest } from "./api/admin";
import { telegramLoginConfig, telegramLoginSession } from "./api/telegram-oidc";
import { CountersDO } from "./durable-objects/counters-do";
import { DayBlockManager } from "./durable-objects/day-block-manager";
import { CriminalCodeAnalyzerDO } from "./durable-objects/criminal-code-analyzer-do";
import { ProviderInitializer } from "./core/providers/provider-init";
import { Logger } from "./core/logger";
import { withRuntimeSettings } from "./core/runtime-settings";
import { getWebhookSecret } from "./core/webhook-secret";
import {
  BACKFILL_CRON,
  DAILY_SUMMARY_CRON,
  backfillErrorInfo,
  runDailyAggregateBackfill,
} from "./features/stats/daily-backfill";
import { handleLegalRagIngestBatch, handleLegalRagSearch } from "./features/legal-rag/ingest";
import type {
  ExecutionContext,
  ScheduledEvent,
} from "@cloudflare/workers-types";

const ADMIN_UNAVAILABLE_ERROR_CODE = "ADMIN_UNAVAILABLE";

function constantTimeEqual(left: string | null, right: string | null): boolean {
  const a = left || "";
  const b = right || "";
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function describeError(error: unknown): { name: string } {
  if (error instanceof Error) {
    return { name: error.name || "Error" };
  }
  return { name: typeof error === "string" ? "Error" : "UnknownError" };
}

function adminUnavailableResponse(requestId: string): Response {
  return Response.json(
    {
      ok: false,
      error: {
        code: ADMIN_UNAVAILABLE_ERROR_CODE,
        message: "Admin service is temporarily unavailable.",
        requestId,
      },
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(req.url);
    // Privacy-sensitive ingestion must use the current persisted policy, not a
    // potentially stale isolate cache. On D1 failure, reject and let Telegram retry.
    const isWebhook = req.method === 'POST' &&
      (url.pathname === '/telegram/webhook' || /^\/tg\/[^/]+\/webhook$/.test(url.pathname));
    try {
      env = await withRuntimeSettings(env, isWebhook);
    } catch {
      return new Response('Bot settings temporarily unavailable', { status: 503 });
    }
    const isPublicRead = req.method === "GET" || req.method === "HEAD";
    const isLegacyEnglish = ['/en', '/en/', '/en/index.html'].includes(url.pathname);
    if (isPublicRead && isLegacyEnglish) {
      const canonical = new URL("/", req.url);
      canonical.search = url.search;
      return Response.redirect(canonical, 301);
    }
    const isLandingPage = [
      '/', '/index.html', '/ru', '/ru/', '/ru/index.html',
      '/combot-alternative', '/ru/combot-alternative', '/ru/combot-alternative/', '/robots.txt', '/sitemap.xml',
    ]
      .includes(url.pathname);

    if (url.pathname === "/telegram/webhook" && req.method === "POST") {
      const secret = await getWebhookSecret(env);
      if (!secret) return new Response("webhook not configured", { status: 503 });
      if (!constantTimeEqual(req.headers.get("X-Telegram-Bot-Api-Secret-Token"), secret)) {
        return new Response("forbidden", { status: 403 });
      }
      if (env.RAW_MESSAGE_STORAGE_MODE === 'unconfigured') {
        return new Response('Choose message storage in /admin/setup before connecting the bot', { status: 503 });
      }
      const message = getTextMessage(await req.json());
      await recordMessage(message, env, ctx);
      ctx.waitUntil(handleUpdate(message, env));
      return Response.json({});
    }

    if (isPublicRead &&
      (isLandingPage || url.pathname.startsWith("/landing/"))) {
      // The marketing site has its own repository and release lifecycle.
      // Proxy only these paths; keep login, admin and webhook in this Worker.
      if (env.LANDING) return env.LANDING.fetch(req);
      if (isLandingPage) {
        const needsSetup = env.TOKEN && !env.TELEGRAM_LOGIN_CLIENT_ID && !env.ADMIN_BASIC_USER;
        return Response.redirect(new URL(needsSetup ? "/admin/setup" : "/admin", req.url), 302);
      }
      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/auth/telegram/config" && req.method === "GET") {
      return telegramLoginConfig(env);
    }

    if (url.pathname === "/auth/telegram" && req.method === "POST") {
      return telegramLoginSession(req, env);
    }

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

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      try {
        return await handleAdminRequest(req, env);
      } catch (error) {
        // Containment boundary: any unexpected admin failure must return
        // structured JSON instead of surfacing a Cloudflare 1101 page. Log only
        // the error class name and the safe request id — never the raw error
        // message, which could embed request payload.
        const requestId = crypto.randomUUID();
        const { name } = describeError(error);
        console.error("Admin request failed with unhandled exception", {
          requestId,
          method: req.method,
          pathname: url.pathname,
          errorName: name,
        });
        return adminUnavailableResponse(requestId);
      }
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

    if (url.pathname === "/api/criminal/analyze-test" && req.method === "POST") {
      const key = url.searchParams.get("key") || req.headers.get("X-Legal-Rag-Ingest-Key");
      const ingestKey = env.LEGAL_RAG_INGEST_KEY || env.SECRET;
      if (key !== ingestKey && key !== env.SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }

      try {
        const payload = await req.json<any>();
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) {
          return Response.json({ ok: false, error: "text is required" }, { status: 400 });
        }

        const chatId = Number.isFinite(Number(payload.chatId)) ? Number(payload.chatId) : -990519001;
        const analyzerId = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(String(chatId));
        const analyzer = env.CRIMINAL_CODE_ANALYZER_DO.get(analyzerId);
        const response = await analyzer.fetch("https://do/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            chatId,
            userId: Number.isFinite(Number(payload.userId)) ? Number(payload.userId) : 990519001,
            username: typeof payload.username === "string" ? payload.username : "legal_rag_test",
            messageId: Number.isFinite(Number(payload.messageId)) ? Number(payload.messageId) : Date.now(),
            day: typeof payload.day === "string" ? payload.day : new Date().toISOString().slice(0, 10),
            ts: typeof payload.ts === "number" && Number.isInteger(payload.ts) && Number.isFinite(payload.ts) ? payload.ts : undefined,
            forceRefresh: true,
          }),
        });

        const result = await response.json().catch(() => null);
        return Response.json({ ok: response.ok, result }, { status: response.status });
      } catch (error: any) {
        return Response.json({
          ok: false,
          error: error?.message || String(error),
        }, { status: 500 });
      }
    }

    if (url.pathname === "/api/criminal/diagnose" && req.method === "POST") {
      const key = url.searchParams.get("key") || req.headers.get("X-Legal-Rag-Ingest-Key");
      const ingestKey = env.LEGAL_RAG_INGEST_KEY || env.SECRET;
      if (key !== ingestKey && key !== env.SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }

      try {
        const payload = await req.json<any>();
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) {
          return Response.json({ ok: false, error: "text is required" }, { status: 400 });
        }

        const chatId = Number.isFinite(Number(payload.chatId)) ? Number(payload.chatId) : -990519001;
        const analyzerId = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(String(chatId));
        const analyzer = env.CRIMINAL_CODE_ANALYZER_DO.get(analyzerId);
        const response = await analyzer.fetch("https://do/diagnose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            text,
            chatId,
            userId: Number.isFinite(Number(payload.userId)) ? Number(payload.userId) : 990519001,
            username: typeof payload.username === "string" ? payload.username : "diagnostic",
            messageId: Number.isFinite(Number(payload.messageId)) ? Number(payload.messageId) : Date.now(),
            day: typeof payload.day === "string" ? payload.day : new Date().toISOString().slice(0, 10),
          }),
        });

        const result = await response.json().catch(() => null);
        return Response.json(result, { status: response.status });
      } catch (error: any) {
        return Response.json({
          ok: false,
          error: error?.message || String(error),
        }, { status: 500 });
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

      // Fail closed in every environment. A public development Worker is still
      // reachable by attackers; ENVIRONMENT must never disable webhook auth.
      if (!env.TOKEN || !env.SECRET || !constantTimeEqual(token, env.TOKEN) ||
          !constantTimeEqual(secretHeader, env.SECRET)) {
        Logger.warn(env, "webhook authentication failed");
        return new Response("forbidden", { status: 403 });
      }

      if (env.RAW_MESSAGE_STORAGE_MODE === 'unconfigured') {
        return new Response('Choose message storage in /admin/setup before connecting the bot', { status: 503 });
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
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    env = await withRuntimeSettings(env);
    // Phase 3a: the distinct temporary backfill cron (`* * * * *`) runs ONLY
    // the D1 aggregate backfill and returns before provider initialization,
    // summary, and cleanup. The exact daily cron (`59 23 * * *`) keeps its
    // original behavior; any unknown cron no-ops safely.
    const cron = event && typeof event.cron === "string" ? event.cron : "";
    if (cron === BACKFILL_CRON) {
      try {
        const summary = await runDailyAggregateBackfill(env);
        Logger.info(env, "Daily aggregate backfill run completed", summary);
      } catch (e: unknown) {
        // Privacy-safe: only the error class name and the safe closed-set
        // BackfillError code. Never raw error message/stack/query/identity.
        const { name, code } = backfillErrorInfo(e);
        Logger.error("Daily aggregate backfill failed", { errName: name, errCode: code });
      }
      return;
    }
    if (cron !== DAILY_SUMMARY_CRON) {
      return;
    }

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

export { CountersDO, DayBlockManager, CriminalCodeAnalyzerDO };
