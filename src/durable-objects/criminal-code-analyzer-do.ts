// ========================================
// 🏛️ CRIMINAL CODE ANALYZER DURABLE OBJECT
// ========================================
// Анализирует сообщения на предмет нарушений УК РФ
// с кэшированием результатов и атомарными операциями

import type {
  Env,
  CriminalAnalysisResult,
  CriminalAnalysisRequest,
  CriminalBatchAnalysisRequest,
  CriminalContextAnalysisInput,
  CriminalContextMessage,
  CriminalViolation,
  CriminalViolationStats,
  CriminalAnalysisCache,
  CriminalSemanticPrefilterResult,
  StoredMessage,
  LegalReferenceHit
} from '../core/env';
import {
  CRIMINAL_MAX_TEXT_LENGTH,
  CRIMINAL_BATCH_SIZE
} from '../core/env';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { ProviderFactory } from '../core/providers/provider-factory';
import type { AIProvider } from '../core/providers/ai-provider';
import { criminalPrefilter, CriminalPrefilterReason } from '../features/criminal/prefilter';
import {
  countNormalizedProfanityTokens,
  detectLocalProfanity,
  normalizeProfanityWord,
  type LocalProfanityResult,
} from '../features/profanity/local-detector';
import { fetchLastMessagesOptimized } from '../features/history/history-optimized';
import { sendMessage } from '../core/telegram';
import { getBudgetTracker } from '../core/llm';

interface QueuedCriminalAnalysisTask {
  text: string;
  chatId: number;
  userId?: number;
  messageId?: number;
  username?: string;
  day?: string;
  ts?: number;
  sequence?: number;
  reasons: CriminalPrefilterReason[];
  enqueuedAt: number;
  localProfanity?: LocalProfanityResult;
}

interface CriminalFinalJudgeResult {
  decision?: 'violation' | 'no_violation' | 'uncertain';
  confidence?: number;
  evidence?: {
    subject?: string;
    object?: string;
    intent?: string;
    contextSummary?: string;
    whyNotBenign?: string;
  };
  violations?: Array<Partial<CriminalViolation>>;
}

interface CriminalPrefilterBatchItem {
  id: string;
  input: CriminalContextAnalysisInput;
  task: QueuedCriminalAnalysisTask;
}

const QUEUE_STORAGE_KEY = 'criminal_analysis_queue';
const LAST_OPENROUTER_CALL_KEY = 'criminal_openrouter_last_call';
const LAST_FINAL_ANALYSIS_CALL_KEY = 'criminal_final_analysis_last_call';

/**
 * Privacy-safe error classification: never include message/stack/content in
 * logs because downstream errors may embed Telegram message text.
 */
function safeErrorClass(error: unknown): 'Error' | 'ThrownString' | 'UnknownError' {
  if (error instanceof Error) return 'Error';
  if (typeof error === 'string') return 'ThrownString';
  return 'UnknownError';
}

export class CriminalCodeAnalyzerDO {
  private state: DurableObjectState;
  private env: Env;
  private aiProvider: AIProvider | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // ========================================
  // 🔧 INITIALIZATION
  // ========================================

  private async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize();
    }
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    try {
      this.aiProvider = await ProviderFactory.createProvider(this.env, 'criminal');
      console.log('✅ CriminalCodeAnalyzerDO initialized successfully');
    } catch (error: any) {
      console.error('❌ Failed to initialize CriminalCodeAnalyzerDO', {
        op: 'initialize',
        errorClass: safeErrorClass(error),
      });
      throw error;
    }
  }

  // ========================================
  // 🌐 HTTP REQUEST HANDLER
  // ========================================

  async fetch(request: Request): Promise<Response> {
    try {
      await this.initialize();

      const url = new URL(request.url);
      const path = url.pathname;

      // 🔍 Single message analysis
      if (path === '/analyze' && request.method === 'POST') {
        return this.blockConcurrencyWhile(async () => {
          return await this.handleAnalyzeRequest(request);
        });
      }

      // 🧵 Queue contextual analysis without blocking webhook
      if (path === '/enqueue' && request.method === 'POST') {
        return this.blockConcurrencyWhile(async () => {
          return await this.handleEnqueueRequest(request);
        });
      }

      // 🧪 Protected diagnostic analysis without queueing or storing violations
      if (path === '/diagnose' && request.method === 'POST') {
        return this.blockConcurrencyWhile(async () => {
          return await this.handleDiagnoseRequest(request);
        });
      }

      // 📊 Batch analysis
      if (path === '/batch-analyze' && request.method === 'POST') {
        return this.blockConcurrencyWhile(async () => {
          return await this.handleBatchAnalyzeRequest(request);
        });
      }

      // 📈 Get statistics
      if (path === '/stats' && request.method === 'GET') {
        return await this.handleStatsRequest(request);
      }

      // 🗑️ Clear cache
      if (path === '/clear-cache' && request.method === 'POST') {
        return this.blockConcurrencyWhile(async () => {
          return await this.handleClearCacheRequest(request);
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch {
      console.error('CriminalCodeAnalyzerDO fetch error', { op: 'doFetch', errorClass: 'Error' });
      return new Response(
        JSON.stringify({ error: 'Internal server error', code: 'DO_FETCH_FAILED' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  async alarm(): Promise<void> {
    await this.initialize();
    await this.flushQueue('alarm');
  }

  // ========================================
  // 🔍 SINGLE MESSAGE ANALYSIS
  // ========================================

  private async handleAnalyzeRequest(request: Request): Promise<Response> {
    try {
      let body: CriminalAnalysisRequest;
      try {
        body = await request.json() as CriminalAnalysisRequest;
      } catch (error: any) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
      }
      const { text, chatId, messageId, userId, forceRefresh = false, day, ts } = body;

      if (!text || text.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: 'Text is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!chatId) {
        return new Response(
          JSON.stringify({ error: 'Chat ID is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Truncate text if too long, but still return an error if it exceeds the limit
      if (text.length > (CRIMINAL_MAX_TEXT_LENGTH || 10000)) {
        return new Response(
          JSON.stringify({
            error: 'Text too long',
            maxLength: (CRIMINAL_MAX_TEXT_LENGTH || 10000)
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 🔍 Check cache first
      let result: CriminalAnalysisResult;
      if (!forceRefresh) {
        const cached = await this.getCachedAnalysis(text);
        if (cached) {
          console.log('📋 Using cached criminal code analysis');
          result = cached;
        } else {
          result = await this.performAnalysis(text);
          await this.cacheAnalysis(text, result);
        }
      } else {
        result = await this.performAnalysis(text);
        await this.cacheAnalysis(text, result);
      }

      // 💾 Store violation in database if found
      if (result.hasViolations && result.violations.length > 0) {
        await this.storeViolations(result.violations, chatId, messageId, userId, text, body.username, day, undefined, ts);
        await this.updateStatistics(result);
      }

      return new Response(
        JSON.stringify(result),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch {
      console.error('Error in handleAnalyzeRequest', { op: 'analyze', errorClass: 'Error' });
      return new Response(
        JSON.stringify({ error: 'Analysis failed', code: 'ANALYSIS_FAILED' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleEnqueueRequest(request: Request): Promise<Response> {
    try {
      let body: CriminalAnalysisRequest;
      try {
        body = await request.json() as CriminalAnalysisRequest;
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
      }

      const { text, chatId, messageId, userId, username, day, ts, sequence } = body;
      if (!text || text.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'Text is required' }), { status: 400 });
      }
      if (!chatId) {
        return new Response(JSON.stringify({ error: 'Chat ID is required' }), { status: 400 });
      }

      const localProfanity = this.detectLocalProfanityForMessage(text);
      const previousTexts = await this.getRecentContextTexts(chatId);
      const prefilter = criminalPrefilter({
        text,
        isCommand: text.startsWith('/'),
        previousTexts,
      });

      if (!prefilter.shouldQueue) {
        const task: QueuedCriminalAnalysisTask = {
          text,
          chatId,
          userId,
          messageId,
          username,
          day,
          ts,
          sequence,
          reasons: prefilter.reasons,
          enqueuedAt: Date.now(),
          localProfanity,
        };
        // Independent terminal outcomes: profanity propagation identity must not block criminal ack.
        try {
          const profResult = await this.recordProfanityCountersFromAnalysis({
            task,
            semanticPrefilter: undefined,
            sequence,
          });
          if (profResult) {
            // completed via profanity increment handled inside; ack via that path
          } else {
            const profanityGloballyDisabled = !this.getBooleanEnv('ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER', false);
            await this.ackProfanityOutcome(task, profanityGloballyDisabled ? 'skipped' : 'zero');
          }
        } catch {
          await this.ackProfanityOutcome(task, 'failed');
        }
        await this.ackCriminalOutcome(task, 'skipped');
        return new Response(
          JSON.stringify({ queued: false, reasons: prefilter.reasons }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const queue = await this.loadQueue();
      const existing = queue.some(task => task.chatId === chatId && task.messageId === messageId);
      if (!existing) {
        queue.push({
          text,
          chatId,
          userId,
          messageId,
          username,
          day,
          ts,
          sequence,
          reasons: prefilter.reasons,
          enqueuedAt: Date.now(),
          localProfanity,
        });
        await this.saveQueue(queue);
      }

      const batchSize = this.getNumberEnv('CRIMINAL_QUEUE_BATCH_SIZE', 5);
      if (queue.length >= batchSize) {
        await this.flushQueue('batch-size');
      } else {
        await this.scheduleQueueAlarm();
      }

      return new Response(
        JSON.stringify({ queued: !existing, reasons: prefilter.reasons, queueSize: queue.length }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch {
      console.error('Error in handleEnqueueRequest', { op: 'enqueue', errorClass: 'Error' });
      return new Response(
        JSON.stringify({ error: 'Enqueue failed', code: 'ENQUEUE_FAILED' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async handleDiagnoseRequest(request: Request): Promise<Response> {
    try {
      let body: any;
      try {
        body = await request.json();
      } catch {
        return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
      }

      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        return Response.json({ ok: false, error: 'text is required' }, { status: 400 });
      }

      const chatId = Number.isFinite(Number(body.chatId)) ? Number(body.chatId) : 0;
      const targetTimestamp = Number.isFinite(Number(body.ts))
        ? Number(body.ts)
        : Math.floor(Date.now() / 1000);
      const input = this.buildDiagnosticContextInput(body, text, chatId, targetTimestamp);
      const task: QueuedCriminalAnalysisTask = {
        text,
        chatId,
        userId: input.targetUserId,
        messageId: input.targetMessageId,
        username: input.targetUsername,
        ts: targetTimestamp,
        reasons: ['semantic_prefilter'],
        enqueuedAt: Date.now(),
      };

      const semanticPrefilter = await this.runSemanticPrefilter(input, task);
      if (!semanticPrefilter.shouldAnalyze && !body.forceRag) {
        return Response.json({
          ok: true,
          skipped: true,
          semanticPrefilter,
          retrieval: null,
          final: {
            hasViolations: false,
            decision: 'no_violation',
            violations: [],
            totalSeverity: 0,
            riskLevel: 'low',
            analysisTimestamp: Date.now(),
            targetMessageId: input.targetMessageId,
            contextWindow: input.contextWindow,
          },
        });
      }

      const contextInput = { ...input, semanticPrefilter };
      const retrieval = this.aiProvider?.analyzeCriminalCodeWithContext
        ? await this.aiProvider.analyzeCriminalCodeWithContext(contextInput, this.env)
        : await this.aiProvider!.analyzeCriminalCode(text, this.env);
      this.logLegalRagRetrievalResult(contextInput, retrieval);
      const final = this.shouldRunOpenAIFinalJudge(contextInput, retrieval)
        ? await this.runOpenAIFinalJudge(contextInput, retrieval)
        : retrieval;

      return Response.json({
        ok: true,
        skipped: false,
        semanticPrefilter,
        retrieval: {
          decision: retrieval.decision,
          hasViolations: retrieval.hasViolations,
          legalReferences: retrieval.legalReferences || [],
        },
        final,
      });
    } catch (error: any) {
      console.error('❌ Error in handleDiagnoseRequest', {
        op: 'diagnose',
        errorClass: safeErrorClass(error),
      });
      return Response.json({
        ok: false,
        error: error?.message || String(error),
      }, { status: 500 });
    }
  }

  private buildDiagnosticContextInput(
    body: any,
    text: string,
    chatId: number,
    targetTimestamp: number
  ): CriminalContextAnalysisInput {
    const targetMessageId = Number.isFinite(Number(body.messageId)) ? Number(body.messageId) : Date.now();
    const targetUserId = Number.isFinite(Number(body.userId)) ? Number(body.userId) : undefined;
    const targetUsername = typeof body.username === 'string' ? body.username : 'diagnostic';
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];

    if (rawMessages.length === 0) {
      return {
        targetMessageId,
        targetUserId,
        targetUsername,
        targetText: text,
        targetTimestamp,
        chatId,
        contextWindow: { before: 0, after: 0, totalMessages: 1 },
        messages: [{
          messageId: targetMessageId,
          username: targetUsername,
          userId: targetUserId,
          text,
          ts: targetTimestamp,
          relativePosition: 0,
          isTarget: true,
        }],
      };
    }

    const messages = rawMessages
      .map((message: any, index: number): CriminalContextMessage => ({
        messageId: Number.isFinite(Number(message.messageId)) ? Number(message.messageId) : undefined,
        username: typeof message.username === 'string' ? message.username : 'unknown',
        userId: Number.isFinite(Number(message.userId)) ? Number(message.userId) : undefined,
        text: typeof message.text === 'string' ? message.text : '',
        ts: Number.isFinite(Number(message.ts)) ? Number(message.ts) : targetTimestamp + index,
        relativePosition: Number.isFinite(Number(message.relativePosition))
          ? Number(message.relativePosition)
          : index,
        isTarget: Boolean(message.isTarget),
      }))
      .filter((message: CriminalContextMessage) => message.text.trim().length > 0);

    if (!messages.some((message: CriminalContextMessage) => message.isTarget)) {
      messages.push({
        messageId: targetMessageId,
        username: targetUsername,
        userId: targetUserId,
        text,
        ts: targetTimestamp,
        relativePosition: 0,
        isTarget: true,
      });
    }

    return {
      targetMessageId,
      targetUserId,
      targetUsername,
      targetText: text,
      targetTimestamp,
      chatId,
      contextWindow: {
        before: messages.filter((message: CriminalContextMessage) => message.relativePosition < 0).length,
        after: messages.filter((message: CriminalContextMessage) => message.relativePosition > 0).length,
        totalMessages: messages.length,
      },
      messages,
    };
  }

  // ========================================
  // 📊 BATCH ANALYSIS
  // ========================================

  private async handleBatchAnalyzeRequest(request: Request): Promise<Response> {
    try {
      const body = await request.json() as CriminalBatchAnalysisRequest;
      const { messages, forceRefresh = false } = body;

      if (!messages || messages.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Messages array is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (messages.length > CRIMINAL_BATCH_SIZE) {
        return new Response(
          JSON.stringify({
            error: 'Too many messages',
            maxBatchSize: CRIMINAL_BATCH_SIZE || 10
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const results: Array<CriminalAnalysisResult & { messageId?: number; chatId?: number }> = [];

      for (const message of messages) {
        if (!message.text || message.text.trim().length === 0) {
          continue;
        }

        if (message.text.length > (CRIMINAL_MAX_TEXT_LENGTH || 10000)) {
          console.warn(`⚠️ Skipping message ${message.messageId}: text too long`);
          continue;
        }

        let result: CriminalAnalysisResult;
        if (!forceRefresh) {
          const cached = await this.getCachedAnalysis(message.text);
          if (cached) {
            result = cached;
          } else {
            result = await this.performAnalysis(message.text);
            await this.cacheAnalysis(message.text, result);
          }
        } else {
          result = await this.performAnalysis(message.text);
          await this.cacheAnalysis(message.text, result);
        }

        // 💾 Store violations if found
        if (result.hasViolations && result.violations.length > 0) {
          await this.storeViolations(
            result.violations,
            message.chatId,
            message.messageId,
            message.userId,
            message.text,
            message.username,
            message.day,
            undefined,
            message.ts
          );
          await this.updateStatistics(result);
        }

        results.push({
          ...result,
          messageId: message.messageId,
          chatId: message.chatId
        });
      }

      return new Response(
        JSON.stringify({ results }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error('❌ Error in handleBatchAnalyzeRequest', {
        op: 'batchAnalyze',
        errorClass: safeErrorClass(error),
      });
      return new Response(
        JSON.stringify({ error: 'Batch analysis failed', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  private async flushQueue(reason: string): Promise<void> {
    const queue = await this.loadQueue();
    if (queue.length === 0) {
      return;
    }

    const batchSize = this.getNumberEnv('CRIMINAL_QUEUE_BATCH_SIZE', 5);
    const batch = queue.slice(0, batchSize);
    const remaining = queue.slice(batch.length);
    await this.saveQueue(remaining);

    const prepared = await Promise.all(batch.map(async (task, index): Promise<CriminalPrefilterBatchItem> => ({
      id: String(index),
      task,
      input: await this.buildContextInput(task),
    })));
    const prefilterStarted = Date.now();
    const semanticPrefilters = await this.runSemanticPrefilterBatch(prepared);
    console.log('📏 Criminal pipeline stage metrics', {
      stage: 'semantic_prefilter_batch',
      itemCount: prepared.length,
      durationMs: Date.now() - prefilterStarted,
    });

    for (const item of prepared) {
      const { task, input: contextInput } = item;
      const semanticPrefilter = semanticPrefilters.get(item.id) || this.buildNoSignalPrefilter(
        'missing semantic prefilter result'
      );
      // Profanity and criminal terminal outcomes must be independent: profanity
      // success/failure must never block criminal completed/zero/skipped/failed.
      let profanityResult: { words: Array<{ word: string; count: number }>; count: number } | null = null;
      let profanityError: unknown = null;
      try {
        profanityResult = await this.recordProfanityCountersFromAnalysis({ task, semanticPrefilter, sequence: task.sequence });
      } catch (e: unknown) {
        profanityError = e;
      }
      // Always ack profanity exactly once: completed vs zero (no words) vs failed (exception)
      // This is independent of criminal outcome below.
      if (profanityError !== null) {
        await this.ackProfanityOutcome(task, 'failed');
      } else if (profanityResult) {
        // recordProfanityCountersFromAnalysis already advanced profanity completed via /profanity increment
        // No additional ack needed - the completed increment itself resolved progress
      } else {
        // No profanity found or disabled path: recordProfanityCountersFromAnalysis
        // returned null without progress mutation; now ack zero/skipped.
        // Incomplete identity is NOT here: it throws inside the recorder and is
        // acked as failed above (a missing identity is not evidence of zero profanity).
        // We distinguish: if profanity feature disabled, we still want terminal (skipped vs zero convention).
        // For criminal prefilter path, disabled profanity is not per-message but global; treat as skipped.
        const profanityGloballyDisabled = !this.getBooleanEnv('ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER', false);
        if (profanityGloballyDisabled) {
          await this.ackProfanityOutcome(task, 'skipped');
        } else {
          await this.ackProfanityOutcome(task, 'zero');
        }
      }
      if (!semanticPrefilter.shouldAnalyze) {
        console.log('Criminal semantic prefilter skipped RAG', {
          op: 'prefilterSkip',
        });
        await this.ackCriminalOutcome(task, 'zero');
        continue;
      }

      if (!(await this.canSpendFinalAnalysisRequest())) {
        await this.recordDailyCounter(this.getSkippedFinalAnalysisUsageKey());
        console.warn('Criminal final analysis skipped by daily cap', {
          op: 'criminalSkip',
        });
        await this.ackCriminalOutcome(task, 'skipped');
        continue;
      }

      await this.recordFinalAnalysisRequest();

      if (this.getCriminalProviderName() === 'openrouter') {
        await this.waitForFinalAnalysisInterval();
      }
      let result: CriminalAnalysisResult;
      try {
        result = await this.performContextualAnalysis({
          ...contextInput,
          semanticPrefilter,
        });
      } catch {
        await this.ackCriminalOutcome(task, 'failed');
        console.error('Criminal contextual analysis failed', {
          op: 'criminalFailed',
          errorClass: 'Error',
        });
        continue;
      }

      if (result.hasViolations && result.violations.length > 0) {
        let storeError: unknown = null;
        try {
          await this.storeViolations(
            result.violations,
            task.chatId,
            task.messageId,
            task.userId,
            task.text,
            task.username,
            task.day,
            task.sequence,
            task.ts
          );
        } catch (e: unknown) {
          storeError = e;
        }
        if (storeError !== null) {
          await this.ackCriminalOutcome(task, 'failed');
          console.error('Criminal storeViolations failed', { op: 'storeFailed', errorClass: 'Error' });
          continue;
        }
        await this.updateStatistics(result);
        try {
          await this.sendAdminViolationReport(result, task);
        } catch {
          console.error('Failed to send admin criminal violation report', { op: 'adminReport', errorClass: 'Error' });
        }
        // Criminal completed is implicit via storeViolations -> CountersDO increment; no separate ack needed
        // But if storeViolations succeeded, criminal progress is already completed; we still need to ensure no double ack
        // CountersDO completed path already handled; no additional ack.
      } else if (this.hasStrongLocalSignal(task) && result.legalReferences && result.legalReferences.length > 0) {
        await this.ackCriminalOutcome(task, 'zero');
        try {
          await this.sendAdminLegalReferenceReport(result, task);
        } catch {
          console.error('Failed to send admin legal reference report', { op: 'adminReport', errorClass: 'Error' });
        }
      } else {
        await this.ackCriminalOutcome(task, 'zero');
      }
    }

    if (remaining.length > 0) {
      await this.scheduleQueueAlarm();
    }
  }

  private async buildContextInput(task: QueuedCriminalAnalysisTask): Promise<CriminalContextAnalysisInput> {
    const beforeLimit = this.getNumberEnv('CRIMINAL_CONTEXT_BEFORE', 15);
    const afterLimit = this.getNumberEnv('CRIMINAL_CONTEXT_AFTER', 5);
    const totalLimit = beforeLimit + afterLimit + 1;
    const recentMessages = await fetchLastMessagesOptimized(this.env, task.chatId, Math.max(totalLimit, 25))
      .catch(() => [] as StoredMessage[]);

    const targetIndex = this.findTargetMessageIndex(recentMessages, task);
    const start = targetIndex >= 0 ? Math.max(0, targetIndex - beforeLimit) : Math.max(0, recentMessages.length - beforeLimit);
    const end = targetIndex >= 0 ? Math.min(recentMessages.length, targetIndex + afterLimit + 1) : recentMessages.length;
    const selected = recentMessages.slice(start, end);
    const effectiveTargetIndex = targetIndex >= 0 ? targetIndex : selected.length - 1;

    const messages: CriminalContextMessage[] = selected.map((message, index) => {
      const absoluteIndex = start + index;
      return {
        messageId: message.messageId,
        username: message.username,
        userId: message.user,
        text: message.text,
        ts: message.ts,
        relativePosition: absoluteIndex - effectiveTargetIndex,
        isTarget: absoluteIndex === effectiveTargetIndex,
      };
    });

    if (!messages.some(message => message.isTarget)) {
      messages.push({
        messageId: task.messageId,
        username: task.username || 'unknown',
        userId: task.userId,
        text: task.text,
        ts: task.ts || Math.floor(Date.now() / 1000),
        relativePosition: 0,
        isTarget: true,
      });
    }

    return {
      targetMessageId: task.messageId,
      targetUserId: task.userId,
      targetUsername: task.username,
      targetText: task.text,
      targetTimestamp: task.ts || Math.floor(Date.now() / 1000),
      chatId: task.chatId,
      contextWindow: {
        before: messages.filter(message => message.relativePosition < 0).length,
        after: messages.filter(message => message.relativePosition > 0).length,
        totalMessages: messages.length,
      },
      messages,
    };
  }

  private findTargetMessageIndex(
    messages: StoredMessage[],
    task: QueuedCriminalAnalysisTask
  ): number {
    if (task.messageId !== undefined) {
      const byMessageId = messages.findIndex(message => message.messageId === task.messageId);
      if (byMessageId >= 0) {
        return byMessageId;
      }
    }
    const byText = messages.findIndex(message => (
      message.user === task.userId &&
      message.text === task.text
    ));
    return byText;
  }

  private detectLocalProfanityForMessage(text: string): LocalProfanityResult | undefined {
    if (!this.getBooleanEnv('ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER', false)) {
      return undefined;
    }
    if (text.trim().startsWith('/')) {
      return undefined;
    }
    return detectLocalProfanity(text);
  }

  private async ackProfanityOutcome(
    task: QueuedCriminalAnalysisTask,
    outcome: 'completed' | 'zero' | 'skipped' | 'failed',
  ): Promise<void> {
    if (task.sequence === undefined || !task.day) return;
    try {
      const id = this.env.COUNTERS_DO.idFromName(String(task.chatId));
      const response = await this.env.COUNTERS_DO.get(id).fetch('https://do/ack', {
        method: 'POST',
        body: JSON.stringify({
          chatId: task.chatId,
          day: task.day,
          category: 'profanity',
          messageId: task.messageId,
          sequence: task.sequence,
          outcome,
        }),
      });
      if (!response.ok) {
        console.warn('Ack to CountersDO returned non-OK status', {
          op: 'ack',
          category: 'profanity',
          outcome,
          status: response.status,
        });
      }
    } catch {
      // Best-effort ack; never break the analysis pipeline.
    }
  }

  /**
   * Best-effort acknowledgement of a criminal terminal branch to CountersDO.
   * Ack failures never break the analysis pipeline.
   */
  private async ackCriminalOutcome(
    task: QueuedCriminalAnalysisTask,
    outcome: 'completed' | 'zero' | 'skipped' | 'failed',
  ): Promise<void> {
    if (task.sequence === undefined || !task.day) return;
    try {
      const id = this.env.COUNTERS_DO.idFromName(String(task.chatId));
      const response = await this.env.COUNTERS_DO.get(id).fetch('https://do/ack', {
        method: 'POST',
        body: JSON.stringify({
          chatId: task.chatId,
          day: task.day,
          category: 'criminal',
          messageId: task.messageId,
          sequence: task.sequence,
          outcome,
        }),
      });
      if (!response.ok) {
        console.warn('Ack to CountersDO returned non-OK status', {
          op: 'ack',
          category: 'criminal',
          outcome,
          status: response.status,
        });
      }
    } catch {
      // Best-effort ack; never break the analysis pipeline.
    }
  }

  private async recordProfanityCountersFromAnalysis(input: {
    task: QueuedCriminalAnalysisTask;
    semanticPrefilter?: CriminalSemanticPrefilterResult;
    sequence?: number;
  }): Promise<{ words: Array<{ word: string; count: number }>; count: number } | null> {
    if (!this.getBooleanEnv('ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER', false)) {
      return null;
    }


    if (input.task.userId === undefined || !input.task.day) {
      console.warn('Profanity counters skipped because task identity incomplete', {
        op: 'profanityPrefilter',
        errorCode: 'INCOMPLETE_IDENTITY',
      });
      // Missing identity is validated before the empty-words check: an
      // incomplete identity is not evidence of zero profanity even when no
      // words were detected. Surface as a recorder failure so callers ack the
      // profanity outcome as failed instead of mapping it to a false zero.
      throw new Error('Profanity counter update skipped due to incomplete task identity');
    }

    const words = this.mergeProfanityWords(
      input.task.text,
      input.task.localProfanity,
      input.semanticPrefilter?.profanity
    );
    if (words.length === 0) {
      return null;
    }

    const count = words.reduce((sum, word) => sum + word.count, 0);
    try {
      const id = this.env.COUNTERS_DO.idFromName(String(input.task.chatId));
      const response = await this.env.COUNTERS_DO.get(id).fetch('https://do/profanity', {
        method: 'POST',
        body: JSON.stringify({
          chatId: input.task.chatId,
          userId: input.task.userId,
          username: input.task.username || String(input.task.userId),
          day: input.task.day,
          count,
          words,
          sequence: input.sequence ?? input.task.sequence,
          messageId: input.task.messageId,
        }),
      });
      if (!response.ok) {
        const responseText = await response.text().catch(() => 'Unable to read response');
        throw new Error(`Counter update failed with status: ${response.status}, response: ${responseText}`);
      }
      return { words, count };
    } catch (e: unknown) {
      console.warn('Profanity counter update from criminal prefilter failed', {
        op: 'profanityPrefilter',
        errorCode: 'COUNTER_UPDATE_FAILED',
      });
      // Rethrow so callers ack the profanity outcome as failed instead of
      // treating a transport failure as a successful no-profanity null result.
      throw e;
    }
  }

  private mergeProfanityWords(
    text: string,
    localResult?: LocalProfanityResult,
    modelResult?: CriminalSemanticPrefilterResult['profanity']
  ): Array<{ word: string; count: number }> {
    const counts = new Map<string, number>();
    const tokenCounts = countNormalizedProfanityTokens(text);

    for (const source of [localResult, modelResult]) {
      if (!source?.hasProfanity || !Array.isArray(source.words)) {
        continue;
      }
      const sourceCounts = new Map<string, number>();
      for (const rawWord of source.words) {
        const normalized = this.normalizeProfanityCounterWord(rawWord);
        if (!normalized) {
          continue;
        }
        const tokenCount = tokenCounts.get(normalized.word) || 0;
        if (tokenCount <= 0) {
          continue;
        }
        const count = Math.min(normalized.count, tokenCount);
        sourceCounts.set(
          normalized.word,
          (sourceCounts.get(normalized.word) || 0) + count
        );
      }
      for (const [word, count] of sourceCounts) {
        counts.set(word, Math.max(counts.get(word) || 0, count));
      }
    }
    return Array.from(counts.entries()).map(([word, count]) => ({ word, count }));
  }

  private normalizeProfanityCounterWord(rawWord: any): { word: string; count: number } | null {
    const confidence = typeof rawWord?.confidence === 'number'
      ? this.clampNumber(rawWord.confidence, 0, 1)
      : 0;
    if (confidence < 0.5) {
      return null;
    }

    const word = normalizeProfanityWord(String(rawWord?.word || rawWord?.baseForm || ''));
    const count = Math.round(this.clampNumber(Number(rawWord?.count ?? 1), 0, 100));
    if (!word || count <= 0) {
      return null;
    }
    return { word, count };
  }

  private async runSemanticPrefilter(
    input: CriminalContextAnalysisInput,
    task: QueuedCriminalAnalysisTask
  ): Promise<CriminalSemanticPrefilterResult> {
    const result = await this.runSemanticPrefilterBatch([{ id: 'single', input, task }]);
    return result.get('single') || this.buildNoSignalPrefilter('missing semantic prefilter result');
  }

  private async runSemanticPrefilterBatch(
    items: CriminalPrefilterBatchItem[]
  ): Promise<Map<string, CriminalSemanticPrefilterResult>> {
    const results = new Map<string, CriminalSemanticPrefilterResult>();
    if (items.length === 0) {
      return results;
    }

    const enabled = this.getBooleanEnv('CRIMINAL_AI_PREFILTER_ENABLED', true);
    if (!enabled) {
      for (const item of items) {
        results.set(item.id, {
          shouldAnalyze: true,
          reason: 'none',
          confidence: 1,
          explanation: 'semantic prefilter disabled',
        });
      }
      return results;
    }

    const misses: CriminalPrefilterBatchItem[] = [];
    for (const item of items) {
      const cached = await this.getCachedSemanticPrefilter(item.input);
      if (cached) {
        results.set(item.id, cached);
        console.log('Criminal semantic prefilter cache hit', {
          op: 'prefilterCacheHit',
          reason: cached.reason,
        });
      } else {
        misses.push(item);
      }
    }

    if (misses.length === 0) {
      return results;
    }

    try {
      if (!(await this.canSpendPrefilterRequest())) {
        await this.recordDailyCounter(this.getSkippedPrefilterUsageKey());
        for (const item of misses) {
          results.set(item.id, this.buildNoSignalPrefilter('semantic prefilter daily cap exceeded'));
        }
        return results;
      }
      await this.recordPrefilterRequest();
      const fetched = await this.callOpenAIPrefilterForItems(misses);
      for (const item of misses) {
        const fetchedResult = fetched.get(item.id) || this.buildNoSignalPrefilter(
          'model did not return this prefilter item'
        );
        const filtered = this.applySemanticPrefilterThreshold(fetchedResult);
        await this.cacheSemanticPrefilter(item.input, filtered);
        results.set(item.id, filtered);
        console.log('Criminal semantic prefilter result', {
          op: 'prefilterResult',
          reason: filtered.reason,
        });
      }
      return results;
    } catch (error: any) {
      console.warn('Criminal semantic prefilter batch failed', {
        op: 'prefilterBatch',
        errorClass: 'Error',
      });

      for (const item of misses) {
        results.set(item.id, this.buildNoSignalPrefilter('fallback after semantic prefilter failure'));
      }
      return results;
    }
  }

  private async callOpenAIPrefilter(input: CriminalContextAnalysisInput): Promise<CriminalSemanticPrefilterResult> {
    const results = await this.callOpenAIPrefilterForItems([{
      id: 'single',
      input,
      task: {
        text: input.targetText,
        chatId: input.chatId,
        userId: input.targetUserId,
        messageId: input.targetMessageId,
        username: input.targetUsername,
        ts: input.targetTimestamp,
        reasons: ['semantic_prefilter'],
        enqueuedAt: Date.now(),
      },
    }]);
    return results.get('single') || this.buildNoSignalPrefilter('model did not return this prefilter item');
  }

  private async callOpenAIPrefilterForItems(
    items: CriminalPrefilterBatchItem[]
  ): Promise<Map<string, CriminalSemanticPrefilterResult>> {
    if (!this.getBooleanEnv('CRIMINAL_PREFILTER_BATCH_ENABLED', true) || items.length <= 1) {
      const results = new Map<string, CriminalSemanticPrefilterResult>();
      for (const item of items) {
        results.set(item.id, await this.callOpenAIPrefilterSingle(item.input));
      }
      return results;
    }

    const results = new Map<string, CriminalSemanticPrefilterResult>();
    const batchSize = Math.round(this.clampNumber(
      this.getNumberEnv('CRIMINAL_PREFILTER_BATCH_SIZE', 8),
      2,
      20
    ));
    for (let index = 0; index < items.length; index += batchSize) {
      const chunk = items.slice(index, index + batchSize);
      const chunkResults = await this.callOpenAIPrefilterBatchChunk(chunk);
      for (const [id, result] of chunkResults) {
        results.set(id, result);
      }
    }
    return results;
  }

  private async callOpenAIPrefilterSingle(
    input: CriminalContextAnalysisInput
  ): Promise<CriminalSemanticPrefilterResult> {
    const apiKey = (this.env as any).OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for criminal semantic prefilter');
    }

    const model = (this.env as any).CRIMINAL_PREFILTER_MODEL || (this.env as any).LLM_NANO_MODEL || 'gpt-4.1-nano';
    const maxTokens = Math.max(this.getNumberEnv('CRIMINAL_PREFILTER_MAX_TOKENS', 512), 512);
    const isGpt5 = String(model).toLowerCase().includes('gpt-5');
    const systemPrompt = this.buildSemanticPrefilterSystemPrompt(false);
    const userPayload = JSON.stringify(this.buildSemanticPrefilterPayload(input));
    const userInput = `Analyze this JSON payload and return JSON only:\n${userPayload}`;

      const response = await fetch(
      isGpt5 ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions',
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(isGpt5
        ? {
          model,
          instructions: systemPrompt,
          input: [{ role: 'user', content: userInput }],
          max_output_tokens: maxTokens,
          reasoning: { effort: 'minimal' },
          text: {
            format: { type: 'json_object' },
            verbosity: 'low'
          }
        }
        : {
          model,
          max_tokens: maxTokens,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userInput }
          ]
        })
    });

    const parsed = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(parsed?.error?.message || `OpenAI prefilter failed with ${response.status}`);
    }

    this.recordOpenAIUsage(model, 'criminal_prefilter', parsed?.usage);

    const raw = isGpt5 ? this.extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI prefilter returned empty content');
    }

    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<CriminalSemanticPrefilterResult>;
    return this.normalizeSemanticPrefilterResult(result);
  }

  private async callOpenAIPrefilterBatchChunk(
    items: CriminalPrefilterBatchItem[]
  ): Promise<Map<string, CriminalSemanticPrefilterResult>> {
    const apiKey = (this.env as any).OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for criminal semantic prefilter');
    }

    const model = (this.env as any).CRIMINAL_PREFILTER_MODEL || (this.env as any).LLM_NANO_MODEL || 'gpt-4.1-nano';
    const maxTokens = Math.max(
      this.getNumberEnv('CRIMINAL_PREFILTER_MAX_TOKENS', 512),
      Math.min(2048, 260 * items.length)
    );
    const isGpt5 = String(model).toLowerCase().includes('gpt-5');
    const systemPrompt = this.buildSemanticPrefilterSystemPrompt(true);
    const userPayload = JSON.stringify({
      items: items.map(item => ({
        id: item.id,
        ...this.buildSemanticPrefilterPayload(item.input),
      })),
    });
    const userInput = `Analyze this JSON payload and return JSON only:\n${userPayload}`;

    const response = await fetch(
      isGpt5 ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(isGpt5
          ? {
            model,
            instructions: systemPrompt,
            input: [{ role: 'user', content: userInput }],
            max_output_tokens: maxTokens,
            reasoning: { effort: 'minimal' },
            text: {
              format: { type: 'json_object' },
              verbosity: 'low',
            },
          }
          : {
            model,
            max_tokens: maxTokens,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userInput },
            ],
          })
      }
    );

    const parsed = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(parsed?.error?.message || `OpenAI prefilter batch failed with ${response.status}`);
    }

    this.recordOpenAIUsage(model, 'criminal_prefilter_batch', parsed?.usage);

    const raw = isGpt5 ? this.extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI prefilter batch returned empty content');
    }

    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    const parsedResult = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as any;
    const resultItems = Array.isArray(parsedResult?.items)
      ? parsedResult.items
      : Array.isArray(parsedResult?.results)
        ? parsedResult.results
        : [];
    const results = new Map<string, CriminalSemanticPrefilterResult>();
    for (const item of resultItems) {
      if (typeof item?.id !== 'string') {
        continue;
      }
      results.set(item.id, this.normalizeSemanticPrefilterResult(item));
    }
    return results;
  }

  private buildSemanticPrefilterSystemPrompt(isBatch: boolean): string {
    return [
      'Ты быстрый prefilter для Telegram-чата.',
      'Реши, нужно ли отправлять target-сообщение в дорогой юридический анализ УК РФ.',
      'Оценивай только target-сообщение. На этом этапе соседние сообщения не передаются намеренно, чтобы они не подменяли target.',
      'Ищи только реальные признаки: угрозы, угрозы сексуального насилия, призывы к насилию, экстремизм/терроризм, самообвинение в насилии, опасные инструкции.',
      'Мат, сексуальный сленг, шутки, бытовые фразы и действия с предметами сами по себе не являются причиной.',
      'Но разговорные угрозы причинить вред человеку должны проходить: обещания избить, ударить, покалечить, убить, изнасиловать или совершить иное насилие.',
      'Если shouldAnalyze=true, reason не может быть none.',
      'Для угроз сексуального насилия используй reason=sexual_threat.',
      'Для бытовых угроз физической расправы без сексуального смысла используй reason=threat, не sexual_threat.',
      'Если shouldAnalyze=true, добавь searchQuery на русском: нейтральную юридическую формулировку для поиска по УК РФ без номера статьи и без цитирования мата.',
      'searchQuery должен описывать деяние простыми юридическими словами, например: угроза убийством, угроза причинением вреда здоровью, угроза сексуального насилия.',
      'Не используй английский язык, жаргон, странные слова, номера статей или фразы вроде "без указания конкретной статьи" в searchQuery.',
      'Одновременно проверь target-сообщение на русскую обсценную лексику. Это не влияет на shouldAnalyze.',
      'В profanity.words возвращай только точные словоформы мата из target-сообщения и count по ним, не леммы и не базовые формы.',
      'Не включай морально-негативные, религиозные или просто грубые слова, если они не являются русской обсценной лексикой.',
      isBatch
        ? 'Верни строго JSON: {"items":[{"id":"same id","shouldAnalyze":boolean,"reason":"threat|sexual_threat|incitement|self_incrimination|extremism|dangerous_instruction|none","confidence":0..1,"explanation":"short","searchQuery":"short or empty","profanity":{"hasProfanity":boolean,"words":[{"word":"string","count":1,"confidence":0..1}]}}]}'
        : 'Верни строго JSON: {"shouldAnalyze":boolean,"reason":"threat|sexual_threat|incitement|self_incrimination|extremism|dangerous_instruction|none","confidence":0..1,"explanation":"short","searchQuery":"short or empty","profanity":{"hasProfanity":boolean,"words":[{"word":"string","count":1,"confidence":0..1}]}}'
    ].join('\n');
  }

  private buildSemanticPrefilterPayload(input: CriminalContextAnalysisInput): Record<string, unknown> {
    return {
      targetMessageId: input.targetMessageId,
      targetText: input.targetText,
      targetUsername: input.targetUsername,
      contextWindow: input.contextWindow,
      messages: input.messages
        .filter(message => message.isTarget)
        .map(message => ({
          username: message.username,
          text: message.text,
          relativePosition: message.relativePosition,
          isTarget: message.isTarget
        }))
    };
  }

  private normalizeSemanticPrefilterResult(
    result: Partial<CriminalSemanticPrefilterResult>
  ): CriminalSemanticPrefilterResult {
    const reason = result.reason === 'threat' ||
      result.reason === 'sexual_threat' ||
      result.reason === 'incitement' ||
      result.reason === 'self_incrimination' ||
      result.reason === 'extremism' ||
      result.reason === 'dangerous_instruction'
      ? result.reason
      : 'none';

    return {
      shouldAnalyze: Boolean(result.shouldAnalyze),
      reason,
      confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0,
      explanation: typeof result.explanation === 'string' ? result.explanation.slice(0, 200) : '',
      searchQuery: typeof result.searchQuery === 'string' ? result.searchQuery.slice(0, 300) : '',
      profanity: this.normalizeSemanticPrefilterProfanity((result as any).profanity),
    };
  }

  private normalizeSemanticPrefilterProfanity(
    result: any
  ): CriminalSemanticPrefilterResult['profanity'] {
    const words = Array.isArray(result?.words)
      ? result.words
        .map((word: any) => {
          const normalized = this.normalizeProfanityCounterWord(word);
          if (!normalized) {
            return null;
          }
          const confidence = typeof word?.confidence === 'number'
            ? this.clampNumber(word.confidence, 0, 1)
            : 0.5;
          return { ...normalized, confidence };
        })
        .filter((word: any): word is { word: string; count: number; confidence: number } => Boolean(word))
      : [];
    return {
      hasProfanity: Boolean(result?.hasProfanity) && words.length > 0,
      words,
    };
  }

  private applySemanticPrefilterThreshold(
    result: CriminalSemanticPrefilterResult
  ): CriminalSemanticPrefilterResult {
    const threshold = this.getSemanticPrefilterMinConfidence();
    return {
      ...result,
      shouldAnalyze: result.shouldAnalyze && result.reason !== 'none' && result.confidence >= threshold,
    };
  }

  private getSemanticPrefilterMinConfidence(): number {
    return this.getNumberEnv('CRIMINAL_PREFILTER_MIN_CONFIDENCE', 0.55);
  }

  private buildNoSignalPrefilter(explanation: string): CriminalSemanticPrefilterResult {
    return {
      shouldAnalyze: false,
      reason: 'none',
      confidence: 0,
      explanation,
      searchQuery: '',
    };
  }

  private recordOpenAIUsage(model: string, feature: string, usage: any): void {
    if (!usage) {
      return;
    }
    const promptTokens = usage.prompt_tokens || usage.input_tokens || 0;
    const completionTokens = usage.completion_tokens || usage.output_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);
    getBudgetTracker(this.env).recordUsage(model, 'criminal', {
      promptTokens,
      completionTokens,
      totalTokens,
    });
    console.log('📏 Criminal OpenAI usage', {
      feature,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
    });
  }

  private async getCachedSemanticPrefilter(
    input: CriminalContextAnalysisInput
  ): Promise<CriminalSemanticPrefilterResult | null> {
    if (!this.getBooleanEnv('CRIMINAL_PREFILTER_CACHE_ENABLED', true)) {
      return null;
    }
    try {
      const key = await this.getSemanticPrefilterCacheKey(input);
      const cached = await this.env.HISTORY?.get?.(key, 'json') as any;
      if (!cached?.result || typeof cached.createdAt !== 'number') {
        return null;
      }
      const ttlMs = this.getSemanticPrefilterCacheTTL() * 1000;
      if (Date.now() - cached.createdAt > ttlMs) {
        return null;
      }
      return this.applySemanticPrefilterThreshold(
        this.normalizeSemanticPrefilterResult(cached.result)
      );
    } catch (error: any) {
      console.warn('Criminal semantic prefilter cache read failed', {
        op: 'prefilterCacheRead',
        errorClass: 'Error',
      });
      return null;
    }
  }

  private async cacheSemanticPrefilter(
    input: CriminalContextAnalysisInput,
    result: CriminalSemanticPrefilterResult
  ): Promise<void> {
    if (!this.getBooleanEnv('CRIMINAL_PREFILTER_CACHE_ENABLED', true)) {
      return;
    }
    try {
      const key = await this.getSemanticPrefilterCacheKey(input);
      await this.env.HISTORY?.put?.(
        key,
        JSON.stringify({
          result,
          createdAt: Date.now(),
        }),
        { expirationTtl: this.getSemanticPrefilterCacheTTL() } as any
      );
    } catch (error: any) {
      console.warn('Criminal semantic prefilter cache write failed', {
        op: 'prefilterCacheWrite',
        errorClass: 'Error',
      });
    }
  }

  private async getSemanticPrefilterCacheKey(input: CriminalContextAnalysisInput): Promise<string> {
    const normalized = this.normalizeTextForSemanticCache(input.targetText);
    const hash = await this.hashText(normalized);
    const version = String((this.env as any).CRIMINAL_PREFILTER_CACHE_VERSION || 'v4')
      .replace(/[^a-z0-9_-]+/gi, '_');
    const model = String((this.env as any).CRIMINAL_PREFILTER_MODEL || (this.env as any).LLM_NANO_MODEL || 'default')
      .replace(/[^a-z0-9_.-]+/gi, '_');
    const threshold = String(this.getSemanticPrefilterMinConfidence()).replace(/[^0-9.]+/g, '_');
    return `criminal_semantic_prefilter:${version}:${model}:${threshold}:${hash}`;
  }

  private normalizeTextForSemanticCache(text: string): string {
    return text
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private getSemanticPrefilterCacheTTL(): number {
    return Math.round(this.clampNumber(
      this.getNumberEnv('CRIMINAL_PREFILTER_CACHE_TTL', 30 * 24 * 60 * 60),
      60,
      90 * 24 * 60 * 60
    ));
  }

  private extractOpenAIResponsesText(response: any): string | null {
    if (typeof response?.output_text === 'string') {
      return response.output_text;
    }
    const nestedJson = this.findJsonLikeText(response?.output);
    if (nestedJson) {
      return nestedJson;
    }
    if (!Array.isArray(response?.output)) {
      return null;
    }
    for (const item of response.output) {
      const content = item?.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const part of content) {
        if (typeof part?.text === 'string') {
          return part.text;
        }
      }
    }
    return null;
  }

  private findJsonLikeText(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (
        trimmed.includes('"shouldAnalyze"') ||
        (trimmed.startsWith('{') && trimmed.includes('"confidence"'))
      ) {
        return value;
      }
      return null;
    }
    if (!value || typeof value !== 'object') {
      return null;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findJsonLikeText(item);
        if (found) {
          return found;
        }
      }
      return null;
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = this.findJsonLikeText(nested);
      if (found) {
        return found;
      }
    }
    return null;
  }

  // ========================================
  // 📈 STATISTICS
  // ========================================

  private async handleStatsRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const chatId = url.searchParams.get('chatId');
      const period = url.searchParams.get('period') || '7d';

      let query = `
        SELECT 
          article,
          COUNT(*) as violation_count,
          AVG(severity) as avg_severity,
          MAX(severity) as max_severity,
          MIN(created_at) as first_seen,
          MAX(created_at) as last_seen
        FROM violation_stats 
        WHERE created_at >= datetime('now', '-${this.getPeriodDays(period)} days')
      `;

      const params: any[] = [];
      if (chatId) {
        query += ' AND chat_id = ?';
        params.push(parseInt(chatId));
      }

      query += ' GROUP BY article ORDER BY violation_count DESC';

      const stmt = this.env.DB.prepare(query);
      const stats = await stmt.bind(...params).all();

      const userStats = {
        totalViolations: stats.results?.reduce((sum: number, stat: any) => sum + stat.violation_count, 0) || 0,
        avgSeverity: stats.results?.reduce((sum: number, stat: any) => sum + stat.avg_severity, 0) / (stats.results?.length || 1) || 0,
        topViolations: stats.results?.slice(0, 5) || []
      };

      return new Response(
        JSON.stringify({
          stats: stats.results || [],
          userStats
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error('❌ Error in handleStatsRequest', {
        op: 'stats',
        errorClass: safeErrorClass(error),
      });
      return new Response(
        JSON.stringify({ error: 'Failed to get statistics', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ========================================
  // 🗑️ CACHE MANAGEMENT
  // ========================================

  private async handleClearCacheRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const pattern = url.searchParams.get('pattern') || '*';

      // Clear from KV storage
      const list = await this.env.HISTORY.list({ prefix: 'criminal_cache:' });
      const deletePromises = list.keys.map(key => this.env.HISTORY.delete(key.name));
      await Promise.all(deletePromises);

      // Clear from database
      const stmt = this.env.DB.prepare('DELETE FROM criminal_analysis_cache WHERE created_at < datetime(\'now\', \'-1 hour\')');
      await stmt.run();

      return new Response(
        JSON.stringify({
          message: 'Cache cleared successfully',
          deletedKeys: list.keys.length
        }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error('❌ Error in handleClearCacheRequest', {
        op: 'clearCache',
        errorClass: safeErrorClass(error),
      });
      return new Response(
        JSON.stringify({ error: 'Failed to clear cache', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ========================================
  // 🤖 AI ANALYSIS
  // ========================================

  private async performAnalysis(text: string): Promise<CriminalAnalysisResult> {
    if (!this.aiProvider) {
      throw new Error('AI provider not initialized');
    }

    console.log('🔍 Performing criminal code analysis...');

    try {
      const result = await this.aiProvider.analyzeCriminalCode(text, this.env);
      const input = this.buildSingleMessageContextInput(text);
      if (this.shouldRunOpenAIFinalJudge(input, result)) {
        const judged = await this.runOpenAIFinalJudge(input, result);
        console.log(`✅ Analysis completed: ${judged.hasViolations ? judged.violations.length + ' violations found' : 'no violations'}`);
        return judged;
      }
      console.log(`✅ Analysis completed: ${result.hasViolations ? result.violations.length + ' violations found' : 'no violations'}`);
      return result;
    } catch (error: any) {
      console.error('❌ AI analysis failed', {
        op: 'analyze',
        errorClass: safeErrorClass(error),
      });
      // Return safe fallback result
      return {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: Date.now()
      };
    }
  }

  private buildSingleMessageContextInput(text: string): CriminalContextAnalysisInput {
    const ts = Math.floor(Date.now() / 1000);
    return {
      targetText: text,
      targetTimestamp: ts,
      chatId: 0,
      contextWindow: {
        before: 0,
        after: 0,
        totalMessages: 1,
      },
      messages: [{
        username: 'unknown',
        text,
        ts,
        relativePosition: 0,
        isTarget: true,
      }],
    };
  }

  private async performContextualAnalysis(input: CriminalContextAnalysisInput): Promise<CriminalAnalysisResult> {
    if (!this.aiProvider) {
      throw new Error('AI provider not initialized');
    }

    try {
      let result: CriminalAnalysisResult;
      if (this.aiProvider.analyzeCriminalCodeWithContext) {
        result = await this.aiProvider.analyzeCriminalCodeWithContext(input, this.env);
      } else {
        result = await this.aiProvider.analyzeCriminalCode(input.targetText, this.env);
      }

      this.logLegalRagRetrievalResult(input, result);

      if (this.shouldRunOpenAIFinalJudge(input, result)) {
        return await this.runOpenAIFinalJudge(input, result);
      }

      return result;
    } catch (error: any) {
      console.error('Criminal contextual AI analysis failed', {
        op: 'contextualAnalysis',
        errorClass: 'Error',
      });
      // Rethrow so flushQueue's failed-ack branch runs instead of converting
      // the provider exception into a fabricated no-violation / zero result.
      throw error;
    }
  }

  private shouldRunOpenAIFinalJudge(
    input: CriminalContextAnalysisInput,
    result: CriminalAnalysisResult
  ): boolean {
    if (this.getCriminalProviderName() !== 'legal-rag') {
      return false;
    }
    if (!this.getBooleanEnv('CRIMINAL_FINAL_JUDGE_ENABLED', true)) {
      return false;
    }
    if (result.hasViolations) {
      return false;
    }
    if (!result.legalReferences?.length) {
      return false;
    }
    const selected = this.selectFinalJudgeReferences(
      result.legalReferences,
      this.getFinalJudgeMaxReferences()
    );
    const minQualityReferences = this.getFinalJudgeMinQualityReferences(input);
    const qualityCount = selected.filter(reference => this.isUsefulFinalJudgeReference(reference)).length;
    const shouldRun = qualityCount >= minQualityReferences;
    if (!shouldRun) {
      console.log('Criminal final judge skipped by RAG quality gate', {
        op: 'finalJudgeSkip',
      });
    }
    return shouldRun;
  }

  private async runOpenAIFinalJudge(
    input: CriminalContextAnalysisInput,
    retrievalResult: CriminalAnalysisResult
  ): Promise<CriminalAnalysisResult> {
    try {
      const finalJudgeReferences = this.selectFinalJudgeReferences(
        retrievalResult.legalReferences || [],
        this.getFinalJudgeMaxReferences()
      );

      const judge = await this.callOpenAIFinalJudge(input, finalJudgeReferences);
      const judged = this.buildJudgedAnalysisResult(input, retrievalResult, judge);
      console.log('Criminal final judge result', {
        op: 'finalJudge',
      });
      return judged;
    } catch (error: any) {
      console.warn('Criminal final judge failed', {
        op: 'finalJudge',
        errorClass: 'Error',
      });
      return retrievalResult;
    }
  }

  private logLegalRagRetrievalResult(
    input: CriminalContextAnalysisInput,
    result: CriminalAnalysisResult
  ): void {
    if (this.getCriminalProviderName() !== 'legal-rag') {
      return;
    }
    const references = result.legalReferences || [];
    console.log('Criminal legal-rag retrieval result', {
      op: 'legalRag',
      referenceCount: references.length,
    });
  }

  private async callOpenAIFinalJudge(
    input: CriminalContextAnalysisInput,
    references: LegalReferenceHit[]
  ): Promise<CriminalFinalJudgeResult> {
    const apiKey = (this.env as any).OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for criminal final judge');
    }

    const model = (this.env as any).CRIMINAL_FINAL_JUDGE_MODEL || 'gpt-5-nano';
    const maxTokens = Math.max(this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MAX_TOKENS', 900), 512);
    const maxReferences = this.getFinalJudgeMaxReferences();
    const isGpt5 = String(model).toLowerCase().includes('gpt-5');
    const systemPrompt = [
      'Ты юридический классификатор для Telegram-чата.',
      'Твоя задача: по target-сообщению, краткому контексту и найденным статьям УК РФ решить, есть ли достаточно оснований сохранить событие как возможное нарушение.',
      'Не фантазируй и не расширяй состав преступления. Если не хватает контекста, это uncertain или no_violation.',
      'Используй только статьи из legalReferences. Не добавляй статьи, которых нет в списке.',
      'Квалифицируй только target-сообщение. Соседние сообщения служат только для понимания target; не сохраняй violation, если состав есть только в before/after.',
      'Сначала выбери основную норму Особенной части УК РФ. Общие нормы о приготовлении, соучастии, группе лиц или отягчающих обстоятельствах сами по себе недостаточны без подходящей основной статьи.',
      'Сверяй target-сообщение с диспозицией статьи в legalReferences, а не только с названием статьи. Если обязательные признаки состава из текста статьи не видны в target/context, верни uncertain или no_violation.',
      'violation разрешен только если target/context содержит конкретное деяние, угрозу, призыв, самообвинение или опасную инструкцию, подходящие под найденную статью.',
      'Шутки, цитаты, обсуждение закона, новостей, книг, игр, мемов и гипотетические рассуждения не классифицируй как violation без прямого опасного смысла.',
      'Поле violations[].quote должно быть точной цитатой из targetText, а не из соседнего сообщения и не из legalReferences.',
      'Поле violations[].punishment не используй для вольного пересказа санкции: если сомневаешься, верни пустую строку. Приложение сохранит наказание из legalReferences.',
      'Верни строго JSON: {"decision":"violation|no_violation|uncertain","confidence":0..1,"evidence":{"subject":"short","object":"short","intent":"short","contextSummary":"short","whyNotBenign":"short"},"violations":[{"article":"article number from legalReferences","subarticle":null,"articleTitle":"...","quote":"exact user quote","punishment":"short","severity":1..10,"confidence":0..1}]}',
    ].join('\n');
    const payload = {
      targetMessageId: input.targetMessageId,
      targetText: input.targetText,
      targetUsername: input.targetUsername,
      contextWindow: input.contextWindow,
      messages: this.selectFinalJudgeMessages(input).map(message => ({
        username: message.username,
        text: message.text,
        relativePosition: message.relativePosition,
        isTarget: message.isTarget,
      })),
      legalReferences: this.selectFinalJudgeReferences(references, maxReferences).map(reference => ({
        article: reference.article,
        subarticle: reference.subarticle,
        articleTitle: reference.articleTitle,
        quote: this.buildFinalJudgeReferenceExcerpt(reference),
        sourceUrl: reference.sourceUrl,
        score: reference.score,
      })),
    };
    const userInput = `Classify this JSON payload and return JSON only:\n${JSON.stringify(payload)}`;

    const response = await fetch(
      isGpt5 ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(isGpt5
          ? {
            model,
            instructions: systemPrompt,
            input: [{ role: 'user', content: userInput }],
            max_output_tokens: maxTokens,
            reasoning: { effort: 'minimal' },
            text: {
              format: { type: 'json_object' },
              verbosity: 'low',
            },
          }
          : {
            model,
            max_tokens: maxTokens,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userInput },
            ],
          })
      }
    );

    const parsed = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(parsed?.error?.message || `OpenAI final judge failed with ${response.status}`);
    }

    this.recordOpenAIUsage(model, 'criminal_final_judge', parsed?.usage);

    const raw = isGpt5 ? this.extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI final judge returned empty content');
    }

    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : raw) as CriminalFinalJudgeResult;
  }

  private getFinalJudgeMaxReferences(): number {
    return Math.round(this.clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MAX_REFERENCES', 6),
      1,
      12
    ));
  }

  private getFinalJudgeMaxReferenceChars(): number {
    return Math.round(this.clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MAX_REFERENCE_CHARS', 700),
      250,
      1500
    ));
  }

  private getFinalJudgeMinRagScore(): number {
    return this.clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MIN_RAG_SCORE', 0.58),
      0,
      1
    );
  }

  private getFinalJudgeMinQualityReferences(input: CriminalContextAnalysisInput): number {
    const configured = this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MIN_QUALITY_REFERENCES', 1);
    if (input.semanticPrefilter?.reason === 'none') {
      return 1;
    }
    return Math.round(this.clampNumber(configured, 1, 3));
  }

  private selectFinalJudgeMessages(input: CriminalContextAnalysisInput): CriminalContextMessage[] {
    const before = Math.round(this.clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_CONTEXT_BEFORE', 3),
      0,
      15
    ));
    const after = Math.round(this.clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_CONTEXT_AFTER', 2),
      0,
      10
    ));

    return input.messages.filter(message => {
      if (message.isTarget) {
        return true;
      }
      if (message.relativePosition < 0) {
        return Math.abs(message.relativePosition) <= before;
      }
      return message.relativePosition <= after;
    });
  }

  private buildJudgedAnalysisResult(
    input: CriminalContextAnalysisInput,
    retrievalResult: CriminalAnalysisResult,
    judge: CriminalFinalJudgeResult
  ): CriminalAnalysisResult {
    const decision = judge.decision === 'violation' ||
      judge.decision === 'no_violation' ||
      judge.decision === 'uncertain'
      ? judge.decision
      : 'uncertain';
    const minConfidence = this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MIN_CONFIDENCE', 0.75);
    const allowedReferences = this.buildAllowedReferenceMap(this.selectFinalJudgeReferences(
      retrievalResult.legalReferences || [],
      this.getFinalJudgeMaxReferences()
    ));
    const evidence = {
      subject: this.cleanJudgeText(judge.evidence?.subject, input.targetUsername || 'unknown'),
      object: this.cleanJudgeText(judge.evidence?.object, 'unknown'),
      intent: this.cleanJudgeText(judge.evidence?.intent, decision === 'violation' ? 'possible criminal intent' : 'not established'),
      contextSummary: this.cleanJudgeText(judge.evidence?.contextSummary, 'Final judge completed'),
      whyNotBenign: this.cleanJudgeText(judge.evidence?.whyNotBenign, decision === 'violation' ? 'model classified as non-benign' : 'not classified as violation'),
    };
    const violations = (judge.violations || [])
      .map(violation => this.normalizeJudgedViolation(violation, allowedReferences, evidence, input))
      .filter((violation): violation is CriminalViolation => Boolean(violation));
    const confidentViolations = violations.filter(violation => violation.confidence >= minConfidence);
    const hasViolations = decision === 'violation' && confidentViolations.length > 0;
    const totalSeverity = hasViolations
      ? confidentViolations.reduce((sum, violation) => sum + violation.severity, 0)
      : 0;

    return {
      hasViolations,
      decision: hasViolations ? 'violation' : decision === 'violation' ? 'uncertain' : decision,
      evidence,
      violations: hasViolations ? confidentViolations : [],
      totalSeverity,
      riskLevel: this.calculateRiskLevel(totalSeverity),
      analysisTimestamp: Date.now(),
      targetMessageId: input.targetMessageId,
      contextWindow: input.contextWindow,
      legalReferences: retrievalResult.legalReferences || [],
    };
  }

  private normalizeJudgedViolation(
    violation: Partial<CriminalViolation>,
    allowedReferences: Map<string, LegalReferenceHit>,
    evidence: NonNullable<CriminalAnalysisResult['evidence']>,
    input: CriminalContextAnalysisInput
  ): CriminalViolation | null {
    const article = typeof violation.article === 'string' ? violation.article.trim() : '';
    const subarticle = typeof violation.subarticle === 'string' && violation.subarticle.trim()
      ? violation.subarticle.trim()
      : null;
    const reference = allowedReferences.get(`${article}:${subarticle || ''}`);
    if (!article || !reference) {
      return null;
    }

    const confidence = this.clampNumber(Number(violation.confidence ?? 0), 0, 1);
    const severity = Math.round(this.clampNumber(Number(violation.severity ?? 1), 1, 10));
    const quote = this.cleanJudgeText(violation.quote, '').slice(0, 500);
    if (!this.isQuoteGroundedInTarget(quote, input.targetText)) {
      console.warn('Criminal final judge rejected ungrounded violation quote', {
        op: 'finalJudgeQuote',
        errorCode: 'UNGROUNDED_QUOTE',
      });
      return null;
    }

    return {
      article: reference.article,
      subarticle: reference.subarticle || null,
      articleTitle: reference.articleTitle || this.cleanJudgeText(violation.articleTitle, ''),
      quote,
      punishment: this.buildStoredPunishment(reference),
      severity,
      confidence,
      decision: 'violation',
      evidence,
      targetMessageId: input.targetMessageId,
      contextWindow: input.contextWindow,
    };
  }

  private buildAllowedReferenceMap(references: LegalReferenceHit[]): Map<string, LegalReferenceHit> {
    const result = new Map<string, LegalReferenceHit>();
    const referencesByArticle = new Map<string, LegalReferenceHit[]>();

    for (const reference of references) {
      result.set(`${reference.article}:${reference.subarticle || ''}`, reference);
      const articleReferences = referencesByArticle.get(reference.article) || [];
      articleReferences.push(reference);
      referencesByArticle.set(reference.article, articleReferences);
    }

    for (const [article, articleReferences] of referencesByArticle) {
      if (articleReferences.length === 1) {
        result.set(`${article}:`, articleReferences[0]);
      }
    }

    return result;
  }

  private buildStoredPunishment(reference: LegalReferenceHit): string {
    const referenceText = this.cleanLegalReferenceText(reference.quote);
    const punishmentText = this.extractPunishmentText(referenceText);
    return (punishmentText || referenceText).slice(0, 1000);
  }

  private extractPunishmentText(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return '';
    }

    const startIndex = normalized.search(/наказыва(?:ет|ю)тся/i);
    if (startIndex < 0) {
      return '';
    }

    const tail = normalized.slice(startIndex);
    const nextPartIndex = tail.search(/\s\d+(?:\.\d+)*\.\s+[А-ЯЁA-Z]/);
    const clause = nextPartIndex > 0 ? tail.slice(0, nextPartIndex) : tail;
    return clause
      .replace(/\((?:в\s+ред\.|см\.).*$/i, '')
      .trim();
  }

  private cleanJudgeText(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
      return fallback;
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized ? normalized.slice(0, 1000) : fallback;
  }

  private selectFinalJudgeReferences(
    references: LegalReferenceHit[],
    maxReferences: number
  ): LegalReferenceHit[] {
    const bestByArticle = new Map<string, LegalReferenceHit>();
    for (const reference of references) {
      const key = `${reference.article}:${reference.subarticle || ''}`;
      const existing = bestByArticle.get(key);
      if (!existing || this.getReferencePriority(reference) > this.getReferencePriority(existing)) {
        bestByArticle.set(key, reference);
      }
    }

    return Array.from(bestByArticle.values())
      .sort((a, b) => this.getReferencePriority(b) - this.getReferencePriority(a))
      .slice(0, maxReferences);
  }

  private isQuoteGroundedInTarget(quote: string, targetText: string): boolean {
    const normalizedQuote = this.normalizeForGrounding(quote);
    const normalizedTarget = this.normalizeForGrounding(targetText);
    if (!normalizedQuote || !normalizedTarget) {
      return false;
    }
    return normalizedTarget.includes(normalizedQuote) || normalizedQuote.includes(normalizedTarget);
  }

  private isUsefulFinalJudgeReference(reference: LegalReferenceHit): boolean {
    const text = this.cleanLegalReferenceText(reference.quote);
    if ((reference.score || 0) < this.getFinalJudgeMinRagScore()) {
      return false;
    }
    if (!reference.articleTitle?.trim()) {
      return false;
    }
    if (/утратил[аои]? силу/i.test(reference.quote || '')) {
      return false;
    }
    const titleAndText = `${reference.articleTitle} ${text}`;
    if (text.length < 80) {
      return /^Статья\s+\d/i.test(text) && this.hasLegalDispositionSignal(titleAndText);
    }
    return this.hasLegalDispositionSignal(titleAndText);
  }

  private hasLegalDispositionSignal(text: string): boolean {
    return /Статья\s+\d|наказыва(?:ет|ю)тся|угроза|призывы|склонение|вовлечение|причинение|насильственн|полов/i
      .test(text);
  }

  private buildFinalJudgeReferenceExcerpt(reference: LegalReferenceHit): string {
    const text = this.cleanLegalReferenceText(reference.quote);
    const maxChars = this.getFinalJudgeMaxReferenceChars();
    if (text.length <= maxChars) {
      return text;
    }

    const punishmentIndex = text.search(/наказыва(?:ет|ю)тся/i);
    if (punishmentIndex > 0) {
      const start = Math.max(0, punishmentIndex - Math.floor(maxChars * 0.65));
      return text.slice(start, start + maxChars).trim();
    }

    return text.slice(0, maxChars).trim();
  }

  private normalizeForGrounding(value: string): string {
    return value
      .replace(/[«»"“”]/g, '')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private getReferencePriority(reference: LegalReferenceHit): number {
    const quote = reference.quote || '';
    let priority = reference.score || 0;
    if (/наказыва(?:ет|ю)тся|лишением свободы|штрафом/i.test(quote)) {
      priority += 1;
    }
    if (/утратил[аои]? силу/i.test(quote)) {
      priority -= 1;
    }
    return priority;
  }

  private cleanLegalReferenceText(value: string): string {
    return value
      .replace(/\([^)]*утратил[аои]? силу[^)]*\)/gi, ' ')
      .replace(/(?:Примечани[ея]\.?\s*)?Утратил[аои]? силу\.\s*/gi, ' ')
      .replace(/(?:^|\s)\d+(?:\.\d+)*\.\s*Утратил[аои]? силу\.\s*/gim, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  private calculateRiskLevel(totalSeverity: number): 'low' | 'medium' | 'high' | 'critical' {
    if (totalSeverity >= 16) {
      return 'critical';
    }
    if (totalSeverity >= 8) {
      return 'high';
    }
    if (totalSeverity >= 4) {
      return 'medium';
    }
    return 'low';
  }

  private async sendAdminViolationReport(
    result: CriminalAnalysisResult,
    task: QueuedCriminalAnalysisTask
  ): Promise<void> {
    const adminId = this.getAdminUserId();
    if (!adminId) {
      console.warn('⚠️ Criminal violation found, but ADMIN_USER_ID is not configured');
      return;
    }

    const topViolation = result.violations[0];
    const evidence = topViolation?.evidence || result.evidence;
    const lines = [
      'Тихий репорт: возможный риск УК РФ',
      '',
      `Чат: ${task.chatId}`,
      `Сообщение: ${task.messageId || 'unknown'}`,
      `Пользователь: ${task.username || task.userId || 'unknown'}`,
      `Статья: ${topViolation.article}${topViolation.subarticle ? `.${topViolation.subarticle}` : ''} ${topViolation.articleTitle}`,
      `Уверенность: ${Math.round(topViolation.confidence * 100)}%`,
      `Цитата: "${topViolation.quote}"`,
    ];

    if (evidence) {
      lines.push(
        '',
        `Субъект: ${evidence.subject}`,
        `Объект: ${evidence.object}`,
        `Намерение: ${evidence.intent}`,
        `Контекст: ${evidence.contextSummary}`,
        `Почему не benign: ${evidence.whyNotBenign}`
      );
    }

    await sendMessage(this.env, adminId, lines.join('\n'));
  }

  private async sendAdminLegalReferenceReport(
    result: CriminalAnalysisResult,
    task: QueuedCriminalAnalysisTask
  ): Promise<void> {
    const adminId = this.getAdminUserId();
    if (!adminId) {
      return;
    }

    const references = (result.legalReferences || []).slice(0, 5);
    const lines = [
      'Справка УК РФ: найдены релевантные статьи',
      '',
      `Чат: ${task.chatId}`,
      `Сообщение: ${task.messageId || 'unknown'}`,
      `Пользователь: ${task.username || task.userId || 'unknown'}`,
      'Это справочная привязка, не юридическая квалификация.',
      '',
      ...references.map(reference => {
        const article = reference.subarticle
          ? `${reference.article}.${reference.subarticle}`
          : reference.article;
        return `ст. ${article} ${reference.articleTitle} (${Math.round(reference.score * 100)}%)`;
      }),
    ];

    await sendMessage(this.env, adminId, lines.join('\n'));
  }

  // ========================================
  // 💾 CACHE OPERATIONS
  // ========================================

  private getCacheTTL(): number {
    // TTL in seconds, prefer env var, fallback to 24 hours
    const raw = (this.env as any).CRIMINAL_ANALYSIS_CACHE_TTL;
    const ttl = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 24 * 60 * 60;
    // Ensure positive integer seconds
    return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 24 * 60 * 60;
  }

  private getNumberEnv(name: string, fallback: number): number {
    const value = (this.env as any)[name];
    const parsed = typeof value === 'number' ? value : Number(String(value ?? ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getBooleanEnv(name: string, fallback: boolean): boolean {
    const value = (this.env as any)[name];
    if (value === undefined || value === null) {
      return fallback;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).toLowerCase() !== 'false';
  }

  private getAdminUserId(): number | null {
    const raw = (this.env as any).ADMIN_USER_ID;
    const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async loadQueue(): Promise<QueuedCriminalAnalysisTask[]> {
    const storage = (this.state as any).storage;
    if (!storage?.get) {
      return [];
    }
    const queue = await storage.get(QUEUE_STORAGE_KEY);
    return Array.isArray(queue) ? queue as QueuedCriminalAnalysisTask[] : [];
  }

  private async saveQueue(queue: QueuedCriminalAnalysisTask[]): Promise<void> {
    const storage = (this.state as any).storage;
    if (!storage?.put) {
      return;
    }
    await storage.put(QUEUE_STORAGE_KEY, queue);
  }

  private async scheduleQueueAlarm(): Promise<void> {
    const storage = (this.state as any).storage;
    if (!storage?.setAlarm) {
      return;
    }
    if (storage.getAlarm) {
      const existingAlarm = await storage.getAlarm();
      if (typeof existingAlarm === 'number' && existingAlarm > Date.now()) {
        return;
      }
    }
    const delay = this.getNumberEnv('CRIMINAL_QUEUE_MAX_DELAY_MS', 60000);
    await storage.setAlarm(Date.now() + delay);
  }

  private async waitForFinalAnalysisInterval(): Promise<void> {
    const storage = (this.state as any).storage;
    if (!storage?.get) {
      return;
    }
    const lastCall = await storage.get(LAST_FINAL_ANALYSIS_CALL_KEY) as number | undefined;
    const minInterval = this.getNumberEnv('CRIMINAL_OPENROUTER_MIN_INTERVAL_MS', 3500);
    const elapsed = lastCall ? Date.now() - lastCall : minInterval;
    if (elapsed < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - elapsed));
    }
    if (storage.put) {
      await storage.put(LAST_OPENROUTER_CALL_KEY, Date.now());
      await storage.put(LAST_FINAL_ANALYSIS_CALL_KEY, Date.now());
    }
  }

  private async canSpendPrefilterRequest(): Promise<boolean> {
    const cap = this.getNumberEnv('CRIMINAL_PREFILTER_DAILY_CAP', 250);
    return await this.canSpendDailyCounter(this.getPrefilterUsageKey(), cap);
  }

  private async recordPrefilterRequest(): Promise<void> {
    await this.recordDailyCounter(this.getPrefilterUsageKey());
  }

  private async canSpendFinalAnalysisRequest(): Promise<boolean> {
    const provider = this.getCriminalProviderName();
    const cap = provider === 'legal-rag'
      ? this.getNumberEnv('LEGAL_RAG_DAILY_QUERY_CAP', 250)
      : this.getNumberEnv('CRIMINAL_OPENROUTER_DAILY_SOFT_CAP', 45);
    return await this.canSpendDailyCounter(this.getFinalAnalysisUsageKey(), cap);
  }

  private async recordFinalAnalysisRequest(): Promise<void> {
    await this.recordDailyCounter(this.getFinalAnalysisUsageKey());
  }

  private async canSpendDailyCounter(key: string, cap: number): Promise<boolean> {
    if (!this.env.COUNTERS?.get) {
      return true;
    }
    const count = parseInt(await this.env.COUNTERS.get(key) || '0', 10);
    return count < cap;
  }

  private async recordDailyCounter(key: string): Promise<void> {
    if (!this.env.COUNTERS?.get || !this.env.COUNTERS?.put) {
      return;
    }
    const count = parseInt(await this.env.COUNTERS.get(key) || '0', 10);
    await this.env.COUNTERS.put(key, String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 } as any);
  }

  private getPrefilterUsageKey(): string {
    return `criminal_prefilter_daily:${new Date().toISOString().slice(0, 10)}`;
  }

  private getSkippedPrefilterUsageKey(): string {
    return `criminal_prefilter_skipped_daily:${new Date().toISOString().slice(0, 10)}`;
  }

  private getFinalAnalysisUsageKey(): string {
    const provider = this.getCriminalProviderName();
    if (provider === 'legal-rag') {
      return `legal_rag_daily:${new Date().toISOString().slice(0, 10)}`;
    }
    return `criminal_openrouter_daily:${new Date().toISOString().slice(0, 10)}`;
  }

  private getSkippedFinalAnalysisUsageKey(): string {
    const provider = this.getCriminalProviderName();
    return `${provider.replace(/[^a-z0-9_]+/gi, '_')}_skipped_daily:${new Date().toISOString().slice(0, 10)}`;
  }

  private getCriminalProviderName(): string {
    return this.aiProvider?.getProviderInfo?.().name || String((this.env as any).CRIMINAL_PROVIDER || '');
  }

  private hasStrongLocalSignal(task: QueuedCriminalAnalysisTask): boolean {
    return task.reasons.some(reason => reason !== 'semantic_prefilter');
  }

  private async getRecentContextTexts(chatId: number): Promise<string[]> {
    const count = this.getNumberEnv('CRIMINAL_CONTEXT_BEFORE', 15);
    const messages = await fetchLastMessagesOptimized(this.env, chatId, count).catch(() => [] as StoredMessage[]);
    return messages.map(message => message.text).filter(Boolean);
  }

  private async getCachedAnalysis(text: string): Promise<CriminalAnalysisResult | null> {
    try {
      const textHash = await this.hashText(text);
      const cacheKey = `criminal_cache:${textHash}`;
      const cacheTTL = this.getCacheTTL();

      // Try KV storage first (faster)
      const cached = await this.env.HISTORY.get(cacheKey, 'json');
      if (cached) {
        const cacheData = cached as CriminalAnalysisCache;
        if (Date.now() - cacheData.createdAt < cacheTTL * 1000) {
          return cacheData.result;
        }
      }

      // Try database cache
      const stmt = this.env.DB.prepare(`
        SELECT analysis_result FROM criminal_analysis_cache 
        WHERE text_hash = ? AND created_at > datetime('now', '-${cacheTTL} seconds')
      `);
      const dbResult = await stmt.bind(textHash).first();

      if (dbResult) {
        const result = JSON.parse(dbResult.analysis_result as string) as CriminalAnalysisResult;
        // Update KV cache
        await this.env.HISTORY.put(cacheKey, JSON.stringify({
          textHash,
          result,
          createdAt: Date.now()
        }), { expirationTtl: cacheTTL });
        return result;
      }

      return null;
    } catch (error: any) {
      console.error('❌ Error getting cached analysis', {
        op: 'getCache',
        errorClass: safeErrorClass(error),
      });
      return null;
    }
  }

  private async cacheAnalysis(text: string, result: CriminalAnalysisResult): Promise<void> {
    try {
      const textHash = await this.hashText(text);
      const cacheKey = `criminal_cache:${textHash}`;
      const cacheTTL = this.getCacheTTL();
      const cacheData: CriminalAnalysisCache = {
        textHash,
        result,
        createdAt: Date.now()
      } as any; // allow createdAt for KV object

      // Store in KV (fast access)
      await this.env.HISTORY.put(
        cacheKey,
        JSON.stringify(cacheData),
        { expirationTtl: cacheTTL }
      );

      // Store in database (persistent backup)
      const stmt = this.env.DB.prepare(`
        INSERT OR REPLACE INTO criminal_analysis_cache (text_hash, analysis_result, expires_at, created_at)
        VALUES (?, ?, datetime('now', '+${cacheTTL} seconds'), datetime('now'))
      `);
      await stmt.bind(textHash, JSON.stringify(result)).run();
    } catch (error: any) {
      console.error('❌ Error caching analysis', {
        op: 'cacheAnalysis',
        errorClass: safeErrorClass(error),
      });
      // Don't throw - caching failure shouldn't break analysis
    }
  }

  // ========================================
  // 💾 DATABASE OPERATIONS
  // ========================================

  private async storeViolations(
    violations: CriminalViolation[],
    chatId?: number,
    messageId?: number,
    userId?: number,
    text?: string,
    username?: string,
    day?: string,
    sequence?: number,
    ts?: number
  ): Promise<void> {
    try {
      const storePreviewRaw = (this.env as any).CRIMINAL_STORE_TEXT_PREVIEW;
      const storePreview = typeof storePreviewRaw === 'string' ? storePreviewRaw.toLowerCase() === 'true' : Boolean(storePreviewRaw);
      const previewLenRaw = (this.env as any).CRIMINAL_TEXT_PREVIEW_LENGTH;
      const previewLength = Number.isFinite(Number(previewLenRaw)) && Number(previewLenRaw) > 0 ? Math.floor(Number(previewLenRaw)) : 200;

      // Store violations in database with canonical message timestamp/day, not processing time.
      // A valid source timestamp wins over the caller-provided day: both must represent
      // the same original message instant, and the ts is the authoritative instant.
      // Contract: Unix seconds (the webhook path sends Telegram `msg.date`). The operator
      // `/analyze-test` boundary forwards any finite integer, so a caller passing
      // `Date.now()` (milliseconds) would otherwise be stored as a year-~58000 date.
      // Detect millisecond-scale values and rescale them to seconds so the contract
      // always holds. Threshold 1e11 cleanly separates present-day seconds (~1.8e9)
      // from milliseconds (~1.8e12); a seconds value above 1e11 would itself be year
      // 5138+, so misclassifying it as milliseconds is harmless.
      const safeTs = typeof ts === 'number' && Number.isInteger(ts) && Number.isFinite(ts) && ts >= 0 ? ts : NaN;
      const canonicalTs = Number.isFinite(safeTs)
        ? (safeTs > 1e11 ? Math.floor(safeTs / 1000) : safeTs)
        : Math.floor(Date.now() / 1000);
      const canonicalDay = Number.isFinite(safeTs)
        ? new Date(canonicalTs * 1000).toISOString().slice(0, 10)
        : day || new Date(canonicalTs * 1000).toISOString().slice(0, 10);
      for (const violation of violations) {
        const stmt = this.env.DB.prepare(`
          INSERT INTO criminal_violations (
            chat_id, message_id, user_id, article, subarticle, article_title, quote, punishment, 
            severity, confidence, text_preview, decision, evidence_json, target_message_id,
            context_before, context_after, context_total_messages, created_at, violation_day, violation_ts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), ?, ?)
        `);
        const textPreview = storePreview && text ? text.substring(0, previewLength) : null;
        const contextWindow = violation.contextWindow;

        await stmt.bind(
          chatId || null,
          messageId || null,
          userId || null,
          violation.article,
          violation.subarticle || null,
          violation.articleTitle,
          violation.quote,
          violation.punishment,
          violation.severity,
          violation.confidence,
          textPreview,
          violation.decision || 'violation',
          violation.evidence ? JSON.stringify(violation.evidence) : null,
          violation.targetMessageId || messageId || null,
          contextWindow?.before ?? null,
          contextWindow?.after ?? null,
          contextWindow?.totalMessages ?? null,
          canonicalTs,
          canonicalDay,
          canonicalTs
        ).run();
      }

      // Send data to CountersDO for KV storage updates
      if (chatId && userId && violations.length > 0) {
        try {
          const dayToUse = canonicalDay;
          const totalSeverity = violations.reduce((sum, v) => sum + v.severity, 0);

          const countersId = this.env.COUNTERS_DO.idFromName(String(chatId));
          const counters = this.env.COUNTERS_DO.get(countersId);

          const payload = {
            chatId,
            userId,
            username: username || 'unknown',
            day: dayToUse,
            violations,
            totalSeverity,
            sequence,
            messageId,
          };

          const response = await counters.fetch('https://do/criminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            console.error('Criminal counters update rejected', {
              op: 'criminalCounters',
              status: response.status,
            });
            // Counters increment is the criminal completed signal; a non-OK
            // response means aggregate/progress resolution is absent, so the
            // failure must surface as a failed ack, never implicit completion.
            throw new Error(`Criminal counters update rejected with status: ${response.status}`);
          }
        } catch (error: any) {
          console.error('Criminal counters update failed', {
            op: 'criminalCounters',
            errorClass: 'Error',
          });
          // Counters increment is the criminal completed signal; its failure
          // must surface as a failed ack, never as implicit completion.
          throw error;
        }
      }
    } catch (error: any) {
      console.error('Criminal violation persistence failed', {
        op: 'storeViolations',
        errorClass: 'Error',
      });
      // Rethrow so flushQueue's failed-ack branch runs: a persistence failure
      // must never be acknowledged as a completed/zero criminal outcome.
      throw error;
    }
  }

  private async updateStatistics(result: CriminalAnalysisResult): Promise<void> {
    try {
      // Statistics are updated automatically via database trigger
      // This method can be extended for additional statistics logic
      console.log(`📊 Statistics updated for ${result.violations.length} violations`);
    } catch (error: any) {
      console.error('❌ Error updating statistics', {
        op: 'updateStatistics',
        errorClass: safeErrorClass(error),
      });
    }
  }

  // ========================================
  // 🛠️ UTILITY METHODS
  // ========================================

  private async hashText(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text.trim().toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private getPeriodDays(period: string): number {
    switch (period) {
      case '1d': return 1;
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      default: return 7;
    }
  }

  // ========================================
  // 🔒 CONCURRENCY CONTROL
  // ========================================

  private async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    // This method ensures atomic operations by blocking concurrent access
    // using Durable Objects' built-in concurrency control
    return await this.state.blockConcurrencyWhile(callback);
  }
}
