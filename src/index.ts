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
import type {
  ExecutionContext,
  ScheduledEvent,
} from "@cloudflare/workers-types";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAdminEndpointsEnabled(env: Env): boolean {
  return env.ENABLE_ADMIN_ENDPOINTS === true || env.ENABLE_ADMIN_ENDPOINTS === "true";
}

function isDebugEndpointsEnabled(env: Env): boolean {
  return env.ENABLE_DEBUG_ENDPOINTS === true || env.ENABLE_DEBUG_ENDPOINTS === "true";
}

function getAdminSecretFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }
  const headerSecret = req.headers.get("X-Admin-Secret");
  return headerSecret ? headerSecret.trim() : null;
}

function isAdminAuthorized(req: Request, env: Env): boolean {
  const adminSecret = env.ADMIN_SECRET;
  if (!adminSecret) {
    return false;
  }
  const providedSecret = getAdminSecretFromRequest(req);
  if (!providedSecret) {
    return false;
  }
  return timingSafeEqual(providedSecret, adminSecret);
}

function ensureAdminEndpointsEnabled(env: Env): Response | null {
  if (!isAdminEndpointsEnabled(env)) {
    return new Response("Not found", { status: 404 });
  }
  return null;
}

function ensureDebugEndpointsEnabled(env: Env): Response | null {
  if (!isDebugEndpointsEnabled(env)) {
    return new Response("Not found", { status: 404 });
  }
  return null;
}

function ensureAdminAuthorized(req: Request, env: Env): Response | null {
  if (!isAdminAuthorized(req, env)) {
    return new Response("Unauthorized", { status: 403 });
  }
  return null;
}

function normalizeSignatureHeader(headerValue: string): string {
  const trimmed = headerValue.trim();
  if (trimmed.toLowerCase().startsWith("sha256=")) {
    return trimmed.slice("sha256=".length);
  }
  return trimmed;
}

async function signHmacSha256(secret: string, data: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, data);
  const bytes = new Uint8Array(signature);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

async function verifyWebhookSignature(body: ArrayBuffer, req: Request, env: Env): Promise<boolean> {
  if (!env.WEBHOOK_HMAC_SECRET) {
    return true;
  }
  const signatureHeader = req.headers.get("X-Webhook-Signature");
  if (!signatureHeader) {
    return false;
  }
  const expected = await signHmacSha256(env.WEBHOOK_HMAC_SECRET, body);
  const provided = normalizeSignatureHeader(signatureHeader).toLowerCase();
  return timingSafeEqual(provided, expected);
}

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
      const adminGate = ensureAdminEndpointsEnabled(env);
      if (adminGate) return adminGate;
      return new Response(MIGRATION_PAGE, {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.pathname === "/api/migrate" && req.method === "POST") {
      const adminGate = ensureAdminEndpointsEnabled(env);
      if (adminGate) return adminGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;
      const cursor = url.searchParams.get("cursor") || undefined;
      const result = await migrateStatsBatch(env, cursor);
      return Response.json(result);
    }

    if (url.pathname === "/api/reset-activity" && req.method === "POST") {
      const adminGate = ensureAdminEndpointsEnabled(env);
      if (adminGate) return adminGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;
      const { resetActivityBatch } = await import("./features/migration/migrate");
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

      const rawBody = await req.arrayBuffer();
      const signatureValid = await verifyWebhookSignature(rawBody, req, env);
      if (!signatureValid) {
        Logger.warn(env, "webhook signature mismatch");
        return new Response("forbidden", { status: 403 });
      }

      let update: any;
      try {
        update = JSON.parse(textDecoder.decode(rawBody));
      } catch {
        Logger.warn(env, "webhook invalid json payload");
        return new Response("bad request", { status: 400 });
      }
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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
      const debugGate = ensureDebugEndpointsEnabled(env);
      if (debugGate) return debugGate;
      const adminAuth = ensureAdminAuthorized(req, env);
      if (adminAuth) return adminAuth;

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
