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
import { criminalPrefilter } from '../features/criminal/prefilter';
import {
  detectLocalProfanity,
  type LocalProfanityResult,
} from '../features/profanity/local-detector';
import { fetchLastMessagesOptimized } from '../features/history/history-optimized';
import { sendMessage } from '../core/telegram';
import { getBudgetTracker } from '../core/llm';
import {
  createShadowEvaluationId,
  storeShadowEvaluationInput,
  storeShadowEvaluationProviderResult,
  type ShadowEvaluationProvider,
  type ShadowEvaluationUsage,
} from '../features/model-shadow/evaluation-store';
import {
  buildDiagnosticContextInput,
  buildContextMessages,
  normalizeReplyContext,
  findTargetMessageIndex,
  buildSingleMessageContextInput,
  normalizeAnalysisResult,
  hashText,
  getPeriodDays,
} from '../features/criminal/analyzer/context-messages';
import {
  buildAllowedReferenceMap,
  cleanJudgeText,
  selectFinalJudgeReferences,
  isQuoteGroundedInTarget,
  isUsefulFinalJudgeReference,
  cleanLegalReferenceText,
  clampNumber,
  calculateRiskLevel,
  evaluateFinalJudgeMeaning,
  getGroundedFinalJudgeMeaningEvidence,
  normalizeJudgedViolation,
} from '../features/criminal/analyzer/legal-references';
import {
  buildQwenPrefilterResponseFormat,
  buildSemanticPrefilterSystemPrompt,
  buildSemanticPrefilterPayload,
  selectSemanticPrefilterMessages,
  normalizeSemanticPrefilterResult,
  semanticFrameSupportsReason,
  buildNoSignalPrefilter,
  normalizeTextForSemanticCache,
  extractOpenAIResponsesText,
  buildShadowUsage,
  getShadowErrorMessage,
  mergeProfanityWords,
} from '../features/criminal/analyzer/semantic-prefilter';
import type {
  CriminalFinalJudgeResult,
  CriminalPrefilterBatchItem,
  QueuedCriminalAnalysisTask,
} from '../features/criminal/analyzer/types';
import { readChatSettings } from '../core/chat-settings';

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
      const url = new URL(request.url);
      const path = url.pathname;
      // These routes can process message text even after the webhook is disabled.
      // Check durable owner settings before accepting any new analysis input.
      if (request.method === 'POST' &&
          ['/analyze', '/enqueue', '/diagnose', '/batch-analyze'].includes(path)) {
        const enabled = await this.isAnalysisAllowed();
        if (!enabled) return Response.json({ error: 'Criminal analysis disabled' }, { status: 409 });
      }
      await this.initialize();

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
      const replyTo = normalizeReplyContext(body.replyTo);
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
          replyTo,
          day,
          ts,
          sequence,
          reasons: prefilter.reasons,
          enqueuedAt: Date.now(),
          localProfanity,
        };
        // Evaluate consent once per message; a disabled feature must not update counters.
        const profanityEnabled = await this.isProfanityAnalysisEnabled(task.chatId);
        // Independent terminal outcomes: profanity propagation identity must not block criminal ack.
        try {
          const profResult = await this.recordProfanityCountersFromAnalysis({
            task,
            semanticPrefilter: undefined,
            sequence,
            profanityEnabled,
          });
          if (profResult) {
            // completed via profanity increment handled inside; ack via that path
          } else {
            await this.ackProfanityOutcome(task, profanityEnabled ? 'zero' : 'skipped');
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
          replyTo,
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
        if (this.getBooleanEnv('CRIMINAL_QUEUE_ASYNC_FLUSH_ENABLED', false)) {
          await this.scheduleQueueAlarm(0);
        } else {
          await this.flushQueue('batch-size');
        }
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
      const input = buildDiagnosticContextInput(body, text, chatId, targetTimestamp);
      const task: QueuedCriminalAnalysisTask = {
        text,
        chatId,
        userId: input.targetUserId,
        messageId: input.targetMessageId,
        username: input.targetUsername,
        replyTo: input.replyTo,
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
    // An alarm might fire after the owner has switched to Stats Only or
    // disabled criminal analysis, or the chat turned it off (one DO per chat).
    // Drop pending message text instead of sending it to an AI provider;
    // terminal acks keep counters from stalling.
    if (!(await this.isAnalysisAllowed()) ||
        !(await readChatSettings(this.env, queue[0].chatId, { fresh: true })).criminalEnabled) {
      await this.saveQueue([]);
      for (const task of queue) {
        await this.ackCriminalOutcome(task, 'skipped');
        await this.ackProfanityOutcome(task, 'skipped');
      }
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
      const semanticPrefilter = semanticPrefilters.get(item.id) || buildNoSignalPrefilter(
        'missing semantic prefilter result'
      );
      // Profanity and criminal terminal outcomes must be independent: profanity
      // success/failure must never block criminal completed/zero/skipped/failed.
      let profanityResult: { words: Array<{ word: string; count: number }>; count: number } | null = null;
      let profanityError: unknown = null;
      const profanityEnabled = await this.isProfanityAnalysisEnabled(task.chatId);
      try {
        profanityResult = await this.recordProfanityCountersFromAnalysis({
          task, semanticPrefilter, sequence: task.sequence, profanityEnabled,
        });
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
        if (!profanityEnabled) {
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
        // Exactly-one terminal ack per criminal branch. storeViolations only
        // emits the implicit completed signal via POST /criminal when
        // task.userId is truthy (it gates per-user/per-article aggregates).
        // For anonymous authors (userId === 0, e.g. Telegram's anonymous group
        // admins) that increment is skipped, which would leave the sequence
        // pending forever. Always ack explicitly; CountersDO's
        // isSequenceAlreadyResolved makes this a no-op when /criminal already
        // resolved progress, so the known-user path is unchanged.
        await this.ackCriminalOutcome(task, 'completed');
        try {
          await this.sendAdminViolationReport(result, task);
        } catch {
          console.error('Failed to send admin criminal violation report', { op: 'adminReport', errorClass: 'Error' });
        }
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
      await this.scheduleQueueAlarm(0);
    }
  }

  private async buildContextInput(task: QueuedCriminalAnalysisTask): Promise<CriminalContextAnalysisInput> {
    const beforeLimit = this.getNumberEnv('CRIMINAL_CONTEXT_BEFORE', 15);
    const afterLimit = this.getNumberEnv('CRIMINAL_CONTEXT_AFTER', 5);
    const totalLimit = beforeLimit + afterLimit + 1;
    const recentMessages = await fetchLastMessagesOptimized(this.env, task.chatId, Math.max(totalLimit, 25))
      .catch(() => [] as StoredMessage[]);
    const messages = buildContextMessages(recentMessages, task, beforeLimit, afterLimit);
    const targetIndex = findTargetMessageIndex(recentMessages, task);
    const storedReplyTo = targetIndex >= 0 ? recentMessages[targetIndex]?.replyTo : undefined;
    const replyTo = normalizeReplyContext(task.replyTo ?? storedReplyTo);

    return {
      targetMessageId: task.messageId,
      targetUserId: task.userId,
      targetUsername: task.username,
      targetText: task.text,
      targetTimestamp: task.ts || Math.floor(Date.now() / 1000),
      chatId: task.chatId,
      replyTo,
      contextWindow: {
        before: messages.filter(message => message.relativePosition < 0).length,
        after: messages.filter(message => message.relativePosition > 0).length,
        totalMessages: messages.length,
      },
      messages,
    };
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

  private async isProfanityAnalysisEnabled(chatId: number): Promise<boolean> {
    if (!this.getBooleanEnv('ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER', false)) return false;
    if (!this.env.DB?.prepare) return true;
    if (!(await this.isInstanceProfanityEnabled())) return false;
    // A chat administrator's opt-out narrows the instance policy.
    return (await readChatSettings(this.env, chatId, { fresh: true })).profanityEnabled;
  }

  private async isInstanceProfanityEnabled(): Promise<boolean> {
    try {
      const row = await this.env.DB.prepare('SELECT settings_json FROM app_settings WHERE scope = ?')
        .bind('global').first() as { settings_json?: string } | null;
      if (!row?.settings_json) return this.env.REQUIRE_EXPLICIT_STORAGE_CHOICE !== true &&
        this.env.REQUIRE_EXPLICIT_STORAGE_CHOICE !== 'true';
      const policy = JSON.parse(row.settings_json) as Record<string, unknown>;
      if (policy.version !== 1) return false;
      // Old settings rows only contain summary settings. Respect the existing
      // deployment-level switch instead of interpreting an absent field as opt-in.
      return typeof policy.profanityEnabled === 'boolean'
        ? policy.profanityEnabled
        : this.getBooleanEnv('ENABLE_PROFANITY_ANALYSIS', false);
    } catch {
      // Unknown consent state: do not write derived profanity data.
      return false;
    }
  }

  private async recordProfanityCountersFromAnalysis(input: {
    task: QueuedCriminalAnalysisTask;
    semanticPrefilter?: CriminalSemanticPrefilterResult;
    sequence?: number;
    profanityEnabled: boolean;
  }): Promise<{ words: Array<{ word: string; count: number }>; count: number } | null> {
    if (!input.profanityEnabled) {
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

    const words = mergeProfanityWords(
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

  private async runSemanticPrefilter(
    input: CriminalContextAnalysisInput,
    task: QueuedCriminalAnalysisTask
  ): Promise<CriminalSemanticPrefilterResult> {
    const result = await this.runSemanticPrefilterBatch([{ id: 'single', input, task }]);
    return result.get('single') || buildNoSignalPrefilter('missing semantic prefilter result');
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

    const shadowEnabled = this.getBooleanEnv('SHADOW_EVAL_ENABLED', false);
    const misses: CriminalPrefilterBatchItem[] = [];
    for (const item of items) {
      if (shadowEnabled) {
        // An A/B sample must contain two fresh calls for the exact same input.
        // Do not let the production prefilter cache silently replace the OpenAI side.
        misses.push(item);
        continue;
      }
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
          results.set(item.id, buildNoSignalPrefilter('semantic prefilter daily cap exceeded'));
        }
        return results;
      }
      const requestItems = shadowEnabled
        ? misses.map(item => ({
          ...item,
          shadowEvaluationId: createShadowEvaluationId(),
          shadowCreatedAt: Date.now(),
        }))
        : misses;
      await this.recordPrefilterRequest();
      const prefilterProvider = String((this.env as any).CRIMINAL_PREFILTER_PROVIDER || 'openai')
        .trim()
        .toLowerCase();
      let fetched: Map<string, CriminalSemanticPrefilterResult>;
      if (prefilterProvider === 'qwen') {
        fetched = await this.callQwenPrefilterForItems(requestItems);
        const qwenSucceededItems = requestItems.filter(item => fetched.has(item.id));
        const qwenFailedItems = requestItems.filter(item => !fetched.has(item.id));

        if (shadowEnabled && qwenSucceededItems.length > 0) {
          this.scheduleBackground(
            this.callOpenAIPrefilterSingles(qwenSucceededItems).then(() => undefined).catch(() => undefined)
          );
        }

        if (qwenFailedItems.length > 0) {
          console.warn('Qwen prefilter failed; falling back to OpenAI single calls', {
            op: 'qwenPrefilterProviderFallback',
            failedItems: qwenFailedItems.length,
          });
          const fallbackResults = await this.callOpenAIPrefilterSingles(qwenFailedItems);
          for (const [id, result] of fallbackResults) {
            fetched.set(id, result);
          }
        }
      } else {
        if (shadowEnabled) {
          this.scheduleBackground(
            this.callQwenPrefilterForItems(requestItems).then(() => undefined).catch(() => undefined)
          );
        }
        fetched = await this.callOpenAIPrefilterForItems(requestItems);
      }
      for (const item of requestItems) {
        const fetchedResult = fetched.get(item.id) || buildNoSignalPrefilter(
          'model did not return this prefilter item'
        );
        const filtered = this.applySemanticPrefilterThreshold(fetchedResult, item.input.targetText);
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
        results.set(item.id, buildNoSignalPrefilter('fallback after semantic prefilter failure'));
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
        replyTo: input.replyTo,
        ts: input.targetTimestamp,
        reasons: ['semantic_prefilter'],
        enqueuedAt: Date.now(),
      },
    }]);
    return results.get('single') || buildNoSignalPrefilter('model did not return this prefilter item');
  }

  private async callOpenAIPrefilterForItems(
    items: CriminalPrefilterBatchItem[]
  ): Promise<Map<string, CriminalSemanticPrefilterResult>> {
    if (!this.getBooleanEnv('CRIMINAL_PREFILTER_BATCH_ENABLED', true) || items.length <= 1) {
      const results = new Map<string, CriminalSemanticPrefilterResult>();
      for (const item of items) {
        results.set(item.id, await this.callOpenAIPrefilterSingle(item));
      }
      return results;
    }

    const results = new Map<string, CriminalSemanticPrefilterResult>();
    const batchSize = Math.round(clampNumber(
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

  private async callOpenAIPrefilterSingles(
    items: CriminalPrefilterBatchItem[]
  ): Promise<Map<string, CriminalSemanticPrefilterResult>> {
    const results = new Map<string, CriminalSemanticPrefilterResult>();
    await Promise.all(items.map(async item => {
      try {
        results.set(item.id, await this.callOpenAIPrefilterSingle(item));
      } catch {
        // The single-call helper records the provider error for shadow diagnostics.
      }
    }));
    return results;
  }

  private async callOpenAIPrefilterSingle(
    item: CriminalPrefilterBatchItem
  ): Promise<CriminalSemanticPrefilterResult> {
    const input = item.input;
    const apiKey = (this.env as any).OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for criminal semantic prefilter');
    }

    const model = (this.env as any).CRIMINAL_PREFILTER_MODEL || (this.env as any).LLM_NANO_MODEL || 'gpt-4.1-nano';
    const maxTokens = Math.max(this.getNumberEnv('CRIMINAL_PREFILTER_MAX_TOKENS', 512), 512);
    const isGpt5 = String(model).toLowerCase().includes('gpt-5');
    const systemPrompt = buildSemanticPrefilterSystemPrompt(false);
    const userPayload = JSON.stringify(buildSemanticPrefilterPayload(input));
    const userInput = `Analyze this JSON payload and return JSON only:\n${userPayload}`;
    if (this.isProductionPrefilterProvider('openai')) {
      this.scheduleShadowInput(item, systemPrompt, userInput, 1);
    }
    const startedAt = Date.now();

    try {
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
        }
      );

      const parsed = await response.json().catch(() => null) as any;
      if (!response.ok) {
        throw new Error(parsed?.error?.message || `OpenAI prefilter failed with ${response.status}`);
      }

      this.recordOpenAIUsage(model, 'criminal_prefilter', parsed?.usage);

      const raw = isGpt5 ? extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
      if (!raw) {
        throw new Error('OpenAI prefilter returned empty content');
      }

      const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<CriminalSemanticPrefilterResult>;
      const normalized = normalizeSemanticPrefilterResult(result, item.input.targetText);
      this.scheduleShadowProviderResult(item, 'openai', model, startedAt, {
        rawOutput: String(raw),
        parsedOutput: normalized,
        finishReason: isGpt5 ? parsed?.status : parsed?.choices?.[0]?.finish_reason,
        usage: buildShadowUsage(parsed?.usage, 1),
      });
      return normalized;
    } catch (error: unknown) {
      this.scheduleShadowProviderResult(item, 'openai', model, startedAt, {
        error: getShadowErrorMessage(error),
      });
      throw error;
    }
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
    const systemPrompt = buildSemanticPrefilterSystemPrompt(true);
    const userPayload = JSON.stringify({
      items: items.map(item => ({
        id: item.id,
        ...buildSemanticPrefilterPayload(item.input),
      })),
    });
    const userInput = `Analyze this JSON payload and return JSON only:\n${userPayload}`;
    if (this.isProductionPrefilterProvider('openai')) {
      for (const item of items) {
        this.scheduleShadowInput(item, systemPrompt, userInput, items.length);
      }
    }
    const startedAt = Date.now();

    try {
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

      const raw = isGpt5 ? extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
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
      const finishReason = isGpt5 ? parsed?.status : parsed?.choices?.[0]?.finish_reason;
      const usage = buildShadowUsage(parsed?.usage, items.length);
      for (const item of items) {
        const rawItem = resultItems.find((resultItem: any) => resultItem?.id === item.id);
        if (!rawItem) {
          this.scheduleShadowProviderResult(item, 'openai', model, startedAt, {
            error: 'Model did not return this prefilter item',
            finishReason,
            usage,
          });
          continue;
        }
        const normalized = normalizeSemanticPrefilterResult(rawItem, item.input.targetText);
        results.set(item.id, normalized);
        this.scheduleShadowProviderResult(item, 'openai', model, startedAt, {
          rawOutput: JSON.stringify(rawItem),
          parsedOutput: normalized,
          finishReason,
          usage,
        });
      }
      return results;
    } catch (error: unknown) {
      for (const item of items) {
        this.scheduleShadowProviderResult(item, 'openai', model, startedAt, {
          error: getShadowErrorMessage(error),
        });
      }
      throw error;
    }
  }

  private async callQwenPrefilterForItems(
    items: CriminalPrefilterBatchItem[]
  ): Promise<Map<string, CriminalSemanticPrefilterResult>> {
    const results = new Map<string, CriminalSemanticPrefilterResult>();
    if (items.length === 0) {
      return results;
    }

    const model = (this.env as any).QWEN_PREFILTER_MODEL ||
      (this.env as any).QWEN_SHADOW_MODEL ||
      'qwen3.7-flash';
    const apiKey = (this.env as any).ALIBABA_API_KEY;
    if (!apiKey) {
      throw new Error('ALIBABA_API_KEY is required for Qwen criminal semantic prefilter');
    }

    const batchEnabled = this.getBooleanEnv('QWEN_PREFILTER_BATCH_ENABLED', false);
    if (!batchEnabled || items.length <= 1) {
      await Promise.all(items.map(async item => {
        try {
          results.set(item.id, await this.callQwenPrefilterSingle(item, apiKey, model));
        } catch {
          // Keep failures item-scoped so the production caller can fall back independently.
        }
      }));
      return results;
    }

    const batchSize = Math.round(clampNumber(
      this.getNumberEnv('CRIMINAL_PREFILTER_BATCH_SIZE', 8),
      2,
      20
    ));
    for (let index = 0; index < items.length; index += batchSize) {
      const chunk = items.slice(index, index + batchSize);
      try {
        const chunkResults = await this.callQwenPrefilterBatchChunk(chunk, apiKey, model);
        for (const [id, result] of chunkResults) {
          results.set(id, result);
        }
      } catch {
        // Batch/single helpers already recorded Qwen errors. Missing ids fall back upstream.
      }
    }
    return results;
  }

  private async callQwenPrefilterSingle(
    item: CriminalPrefilterBatchItem,
    apiKey: string,
    model: string
  ): Promise<CriminalSemanticPrefilterResult> {
    const systemPrompt = buildSemanticPrefilterSystemPrompt(
      false,
      this.getQwenPrefilterPromptVariant()
    );
    const userPayload = JSON.stringify(buildSemanticPrefilterPayload(item.input));
    const userInput = `Analyze this JSON payload and return JSON only:\n${userPayload}`;
    if (this.isProductionPrefilterProvider('qwen')) {
      this.scheduleShadowInput(item, systemPrompt, userInput, 1);
    }
    const startedAt = Date.now();
    let parsed: any;
    let raw: string | undefined;

    try {
      parsed = await this.callQwenChat(apiKey, model, systemPrompt, userInput, false);
      raw = parsed?.choices?.[0]?.message?.content;
      if (!raw) {
        throw new Error('Qwen prefilter returned empty content');
      }
      const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<CriminalSemanticPrefilterResult>;
      const normalized = normalizeSemanticPrefilterResult(result, item.input.targetText);
      this.scheduleShadowProviderResult(item, 'qwen', model, startedAt, {
        rawOutput: String(raw),
        parsedOutput: normalized,
        finishReason: parsed?.choices?.[0]?.finish_reason,
        usage: buildShadowUsage(parsed?.usage, 1),
      });
      return normalized;
    } catch (error: unknown) {
      this.scheduleShadowProviderResult(item, 'qwen', model, startedAt, {
        rawOutput: raw,
        finishReason: parsed?.choices?.[0]?.finish_reason,
        usage: buildShadowUsage(parsed?.usage, 1),
        error: getShadowErrorMessage(error),
      });
      throw error;
    }
  }

  private async callQwenPrefilterBatchChunk(
    items: CriminalPrefilterBatchItem[],
    apiKey: string,
    model: string
  ): Promise<Map<string, CriminalSemanticPrefilterResult>> {
    const systemPrompt = buildSemanticPrefilterSystemPrompt(
      true,
      this.getQwenPrefilterPromptVariant()
    );
    const userPayload = JSON.stringify({
      items: items.map(item => ({
        id: item.id,
        ...buildSemanticPrefilterPayload(item.input),
      })),
    });
    const userInput = `Analyze this JSON payload and return JSON only:\n${userPayload}`;
    if (this.isProductionPrefilterProvider('qwen')) {
      for (const item of items) {
        this.scheduleShadowInput(item, systemPrompt, userInput, items.length);
      }
    }
    const startedAt = Date.now();
    let parsed: any;
    let raw: string | undefined;
    let resultItems: any[];
    let finishReason: string | undefined;
    let usage: ShadowEvaluationUsage | undefined;

    try {
      parsed = await this.callQwenChat(apiKey, model, systemPrompt, userInput, true);
      raw = parsed?.choices?.[0]?.message?.content;
      if (!raw) {
        throw new Error('Qwen prefilter batch returned empty content');
      }
      const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
      const parsedResult = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as any;
      resultItems = Array.isArray(parsedResult?.items)
        ? parsedResult.items
        : Array.isArray(parsedResult?.results)
          ? parsedResult.results
          : [];
      finishReason = parsed?.choices?.[0]?.finish_reason;
      usage = buildShadowUsage(parsed?.usage, items.length);
    } catch (error: unknown) {
      console.warn('Qwen prefilter batch failed; retrying items individually', {
        op: 'qwenPrefilterBatchFallback',
        errorClass: 'Error',
      });
      resultItems = [];
    }

    const results = new Map<string, CriminalSemanticPrefilterResult>();
    for (const item of items) {
      const rawItem = resultItems.find((resultItem: any) => resultItem?.id === item.id);
      if (rawItem) {
        const normalized = normalizeSemanticPrefilterResult(rawItem, item.input.targetText);
        results.set(item.id, normalized);
        this.scheduleShadowProviderResult(item, 'qwen', model, startedAt, {
          rawOutput: JSON.stringify(rawItem),
          parsedOutput: normalized,
          finishReason,
          usage,
        });
        continue;
      }
      try {
        results.set(item.id, await this.callQwenPrefilterSingle(item, apiKey, model));
      } catch {
        // The single-call helper already records the provider error for shadow diagnostics.
      }
    }

    if (results.size === 0) {
      throw new Error('Qwen prefilter failed for every item in the batch');
    }
    return results;
  }

  private async callQwenChat(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userInput: string,
    isBatch: boolean
  ): Promise<any> {
    const baseUrl = String(
      (this.env as any).QWEN_PREFILTER_BASE_URL ||
      (this.env as any).QWEN_SHADOW_BASE_URL ||
      'https://ws-lhg064f1wayjpiqu.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'
    ).replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        // Qwen 3.7 enables thinking by default; this prefilter should stay low-latency.
        enable_thinking: false,
        response_format: buildQwenPrefilterResponseFormat(isBatch),
        messages: [
          {
            role: 'system',
            content: [{
              type: 'text',
              text: systemPrompt,
              cache_control: { type: 'ephemeral' },
            }],
          },
          { role: 'user', content: userInput },
        ],
      }),
    });
    const parsed = await response.json().catch(() => null) as any;
    if (!response.ok) {
      throw new Error(parsed?.error?.message || `Qwen prefilter failed with ${response.status}`);
    }
    return parsed;
  }

  private scheduleShadowInput(
    item: CriminalPrefilterBatchItem,
    systemPrompt: string,
    userInput: string,
    batchSize: number
  ): void {
    if (!item.shadowEvaluationId || !item.shadowCreatedAt) {
      return;
    }
    this.scheduleBackground(storeShadowEvaluationInput(this.env, {
      evaluationId: item.shadowEvaluationId,
      feature: 'criminal_prefilter',
      createdAt: item.shadowCreatedAt,
      chatId: item.input.chatId,
      messageId: item.input.targetMessageId,
      targetText: item.input.targetText,
      targetUsername: item.input.targetUsername,
      systemPrompt,
      userInput,
      batchItemId: item.id,
      batchSize,
    }).catch(() => undefined));
  }

  private scheduleShadowProviderResult(
    item: CriminalPrefilterBatchItem,
    provider: ShadowEvaluationProvider,
    model: string,
    startedAt: number,
    result: {
      rawOutput?: string;
      parsedOutput?: CriminalSemanticPrefilterResult;
      finishReason?: string;
      usage?: ShadowEvaluationUsage;
      error?: string;
    }
  ): void {
    if (!item.shadowEvaluationId || !item.shadowCreatedAt) {
      return;
    }
    this.scheduleBackground(storeShadowEvaluationProviderResult(this.env, {
      evaluationId: item.shadowEvaluationId,
      feature: 'criminal_prefilter',
      chatId: item.input.chatId,
      provider,
      model,
      createdAt: item.shadowCreatedAt,
      latencyMs: Math.max(0, Date.now() - startedAt),
      status: result.error ? 'error' : 'ok',
      rawOutput: result.rawOutput,
      parsedOutput: result.parsedOutput,
      finishReason: result.finishReason,
      usage: result.usage,
      error: result.error,
    }).catch(() => undefined));
  }

  private isProductionPrefilterProvider(provider: 'openai' | 'qwen'): boolean {
    return String((this.env as any).CRIMINAL_PREFILTER_PROVIDER || 'openai')
      .trim()
      .toLowerCase() === provider;
  }

  private getQwenPrefilterPromptVariant(): 'ru' | 'hybrid_en_v1' {
    return String((this.env as any).QWEN_PREFILTER_PROMPT_VARIANT || 'ru')
      .trim()
      .toLowerCase() === 'hybrid_en_v1'
      ? 'hybrid_en_v1'
      : 'ru';
  }

  private applySemanticPrefilterThreshold(
    result: CriminalSemanticPrefilterResult,
    targetText: string
  ): CriminalSemanticPrefilterResult {
    const threshold = this.getSemanticPrefilterMinConfidence();
    const semanticFrame = result.semanticFrame
      ? {
        ...result.semanticFrame,
        evidenceSpans: result.semanticFrame.evidenceSpans.filter(span =>
          isQuoteGroundedInTarget(span, targetText)
        ),
      }
      : undefined;
    const frameSupportsAnalysis = semanticFrameSupportsReason(semanticFrame, result.reason);
    return {
      ...result,
      semanticFrame,
      shouldAnalyze: result.shouldAnalyze &&
        result.reason !== 'none' &&
        result.confidence >= threshold &&
        frameSupportsAnalysis,
    };
  }

  private getSemanticPrefilterMinConfidence(): number {
    return this.getNumberEnv('CRIMINAL_PREFILTER_MIN_CONFIDENCE', 0.7);
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
        normalizeSemanticPrefilterResult(cached.result),
        input.targetText
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
    const normalizedTarget = normalizeTextForSemanticCache(input.targetText);
    const normalizedReply = input.replyTo
      ? [
        Number.isFinite(input.replyTo.messageId) ? String(input.replyTo.messageId) : '',
        normalizeTextForSemanticCache(input.replyTo.text || ''),
      ].join(':')
      : '';
    const normalizedContext = selectSemanticPrefilterMessages(input)
      .filter(message => !message.isTarget)
      .map(message => `${message.relativePosition}:${normalizeTextForSemanticCache(message.text)}`)
      .join('\n');
    const hash = await hashText(`${normalizedTarget}\nreply:\n${normalizedReply}\ncontext:\n${normalizedContext}`);
    const version = String((this.env as any).CRIMINAL_PREFILTER_CACHE_VERSION || 'v8')
      .replace(/[^a-z0-9_-]+/gi, '_');
    const provider = String((this.env as any).CRIMINAL_PREFILTER_PROVIDER || 'openai')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gi, '_');
    const model = String(provider === 'qwen'
      ? (this.env as any).QWEN_PREFILTER_MODEL || (this.env as any).QWEN_SHADOW_MODEL || 'qwen3.7-flash'
      : (this.env as any).CRIMINAL_PREFILTER_MODEL || (this.env as any).LLM_NANO_MODEL || 'default')
      .replace(/[^a-z0-9_.-]+/gi, '_');
    const promptVariant = provider === 'qwen' ? this.getQwenPrefilterPromptVariant() : 'ru';
    const threshold = String(this.getSemanticPrefilterMinConfidence()).replace(/[^0-9.]+/g, '_');
    return `criminal_semantic_prefilter:${version}:${provider}:${model}:${promptVariant}:${threshold}:${hash}`;
  }

  private getSemanticPrefilterCacheTTL(): number {
    return Math.round(clampNumber(
      this.getNumberEnv('CRIMINAL_PREFILTER_CACHE_TTL', 30 * 24 * 60 * 60),
      60,
      90 * 24 * 60 * 60
    ));
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
        WHERE created_at >= datetime('now', '-${getPeriodDays(period)} days')
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
      const input = buildSingleMessageContextInput(text);
      if (this.shouldRunOpenAIFinalJudge(input, result)) {
        const judged = await this.runOpenAIFinalJudge(input, result);
        console.log(`✅ Analysis completed: ${judged.hasViolations ? judged.violations.length + ' violations found' : 'no violations'}`);
        return judged;
      }
      console.log(`✅ Analysis completed: ${result.hasViolations ? result.violations.length + ' violations found' : 'no violations'}`);
      return normalizeAnalysisResult(result);
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

      return normalizeAnalysisResult(result);
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
    const selected = selectFinalJudgeReferences(
      result.legalReferences,
      this.getFinalJudgeMaxReferences()
    );
    const minQualityReferences = this.getFinalJudgeMinQualityReferences(input);
    const qualityCount = selected.filter(reference => isUsefulFinalJudgeReference(reference)).length;
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
      const finalJudgeReferences = selectFinalJudgeReferences(
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
      'Ты игровой классификатор "на сколько лет человек наговорил" для Telegram-чата, а не юрист и не суд.',
      'Твоя задача: по буквальному смыслу target-сообщения, краткому контексту и найденным статьям УК РФ выбрать ближайшую уголовную квалификацию для гротескной статистики.',
      'Не требуй судебной доказуемости, публичности, реальной возможности исполнить угрозу, факта предыдущей административной ответственности или иных формальных условий, если они не меняют основной смысл высказывания.',
      'Используй только статьи из legalReferences. Не добавляй статьи, которых нет в списке.',
      'Квалифицируй только target-сообщение. Соседние сообщения служат только для понимания target; не сохраняй violation, если состав есть только в before/after.',
      'Если передан replyTo, это сообщение, на которое target является прямым ответом. Для короткой ответной реплики используй replyTo как основной семантический контекст перед обычными before/after.',
      'Не переноси деяние, угрозу или объект из replyTo на target. Ответный подкол, шутка, сексуальный сленг, уточнение или отрицание без самостоятельного криминального смысла target должны давать no_violation, даже если отдельные слова target без replyTo двусмысленны.',
      'Сначала выбери основную норму Особенной части УК РФ. Общие нормы о приготовлении, соучастии, группе лиц или отягчающих обстоятельствах сами по себе недостаточны без подходящей основной статьи.',
      'Сначала определи literal meaning target в поле meaning. speechAct должен быть одним из threat|admission|fantasy|endorsement|incitement|plan|instruction|prediction|taunt|report|quote|metaphor|other|unclear.',
      'Для эллиптических и двусмысленных target используй соседний контекст только чтобы восстановить обычный смысл самого target; не переноси опасное действие из before/after на target.',
      'Установи contextResolvesBenign=true, только если соседний контекст однозначно раскрывает target как бытовую, предметную, игровую, метафорическую или иную некриминальную реплику. Тогда decision не может быть violation.',
      'meaning.evidence должна быть точной короткой цитатой только из targetText, которая подтверждает выбранный literal meaning.',
      'Для этого продукта threat, admission, fantasy, endorsement, incitement, plan и instruction считаются violation, если буквально выражают деяние, которое разумно соответствует одной из legalReferences.',
      'Фантазия, пожелание или одобрение насилия считаются, если автор выражает их от себя. Не требуй, чтобы это было прямой угрозой адресату.',
      'prediction, taunt, report, quote и metaphor сами по себе не являются violation. Отличай "он убить меня хочет" как сообщение о третьем лице от "я тебя убью" как угрозы автора.',
      'Шутка может считаться violation, если её буквальный гротескный смысл всё равно выражает авторскую угрозу, фантазию, одобрение, призыв, план или признание; чистая цитата/пересказ/техническая метафора — нет.',
      'Сверяй основной смысл target с диспозицией статьи, но выбирай ближайшую норму по core behavior, а не проверяй полный судебный состав.',
      'Если несколько частей одной статьи подходят, предпочитай более специфичную по буквальному поведению target.',
      'Не превращай угрозу или прогноз вреда школе, компании, проекту, образованию или другому не-человеческому объекту в угрозу убийством/телесным вредом, если target не содержит угрозы человеку.',
      'semanticFrame и retrievalScores являются только подсказками для поиска и понимания. Они не доказывают состав преступления и не заменяют evidence из target/context.',
      'Поле violations[].quote должно быть точной цитатой из targetText, а не из соседнего сообщения и не из legalReferences.',
      'Поле violations[].punishment не используй для вольного пересказа санкции: если сомневаешься, верни пустую строку. Приложение сохранит наказание из legalReferences.',
      'Верни strictly JSON: {"decision":"violation|no_violation|uncertain","confidence":0..1,"contextResolvesBenign":boolean,"meaning":{"speechAct":"threat|admission|fantasy|endorsement|incitement|plan|instruction|prediction|taunt|report|quote|metaphor|other|unclear","evidence":"exact target quote"},"evidence":{"subject":"short","object":"short","intent":"short","contextSummary":"short","whyNotBenign":"short"},"violations":[{"article":"article number from legalReferences","subarticle":"part from legalReferences or null","articleTitle":"...","quote":"exact target quote","punishment":"short","severity":1..10,"confidence":0..1}]}',
    ].join('\n');
    const payload = {
      targetMessageId: input.targetMessageId,
      targetText: input.targetText,
      targetUsername: input.targetUsername,
      replyTo: input.replyTo,
      semanticFrame: input.semanticPrefilter?.semanticFrame,
      contextWindow: input.contextWindow,
      messages: this.selectFinalJudgeMessages(input).map(message => ({
        username: message.username,
        text: message.text,
        relativePosition: message.relativePosition,
        isTarget: message.isTarget,
      })),
      legalReferences: selectFinalJudgeReferences(references, maxReferences).map(reference => ({
        article: reference.article,
        subarticle: reference.subarticle,
        articleTitle: reference.articleTitle,
        quote: this.buildFinalJudgeReferenceExcerpt(reference),
        sourceUrl: reference.sourceUrl,
        score: reference.score,
        retrievalScores: reference.retrievalScores,
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

    const raw = isGpt5 ? extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI final judge returned empty content');
    }

    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : raw) as CriminalFinalJudgeResult;
  }

  private getFinalJudgeMaxReferences(): number {
    return Math.round(clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MAX_REFERENCES', 12),
      1,
      12
    ));
  }

  private getFinalJudgeMaxReferenceChars(): number {
    return Math.round(clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MAX_REFERENCE_CHARS', 700),
      250,
      1500
    ));
  }

  private getFinalJudgeMinQualityReferences(input: CriminalContextAnalysisInput): number {
    const configured = this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MIN_QUALITY_REFERENCES', 1);
    if (input.semanticPrefilter?.reason === 'none') {
      return 1;
    }
    return Math.round(clampNumber(configured, 1, 3));
  }

  private selectFinalJudgeMessages(input: CriminalContextAnalysisInput): CriminalContextMessage[] {
    const before = Math.round(clampNumber(
      this.getNumberEnv('CRIMINAL_FINAL_JUDGE_CONTEXT_BEFORE', 3),
      0,
      15
    ));
    const after = Math.round(clampNumber(
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
    const minConfidence = this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MIN_CONFIDENCE', 0.55);
    const allowedReferences = buildAllowedReferenceMap(selectFinalJudgeReferences(
      retrievalResult.legalReferences || [],
      this.getFinalJudgeMaxReferences()
    ));
    const evidence = {
      subject: cleanJudgeText(judge.evidence?.subject, input.targetUsername || 'unknown'),
      object: cleanJudgeText(judge.evidence?.object, 'unknown'),
      intent: cleanJudgeText(judge.evidence?.intent, 'not established'),
      contextSummary: cleanJudgeText(judge.evidence?.contextSummary, 'Final judge completed'),
      whyNotBenign: cleanJudgeText(judge.evidence?.whyNotBenign, 'not established'),
    };
    const groundedMeaningQuote = getGroundedFinalJudgeMeaningEvidence(judge.meaning, input);
    const meaningVerdict = judge.contextResolvesBenign === true && groundedMeaningQuote
      ? 'benign'
      : evaluateFinalJudgeMeaning(judge.meaning, input);
    const judgedViolations = judge.violations || [];
    const violations = meaningVerdict === 'criminal'
      ? judgedViolations
        .map(violation => normalizeJudgedViolation(
          violation,
          allowedReferences,
          retrievalResult.legalReferences || [],
          evidence,
          input,
          judge.confidence,
          groundedMeaningQuote
        ))
        .filter((violation): violation is CriminalViolation => Boolean(violation))
      : [];
    const confidentViolations = violations.filter(violation => violation.confidence >= minConfidence);
    const hasViolations = decision === 'violation' && confidentViolations.length > 0;
    const totalSeverity = hasViolations
      ? confidentViolations.reduce((sum, violation) => sum + violation.severity, 0)
      : 0;

    return {
      hasViolations,
      decision: hasViolations
        ? 'violation'
        : decision === 'violation'
          ? meaningVerdict === 'benign' ? 'no_violation' : 'uncertain'
          : decision,
      evidence,
      violations: hasViolations ? confidentViolations : [],
      totalSeverity,
      riskLevel: calculateRiskLevel(totalSeverity),
      analysisTimestamp: Date.now(),
      targetMessageId: input.targetMessageId,
      contextWindow: input.contextWindow,
      legalReferences: retrievalResult.legalReferences || [],
    };
  }

  private buildFinalJudgeReferenceExcerpt(reference: LegalReferenceHit): string {
    const text = cleanLegalReferenceText(reference.quote);
    const maxChars = this.getFinalJudgeMaxReferenceChars();
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars).trim();
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

  private scheduleBackground(promise: Promise<unknown>): void {
    const waitUntil = (this.state as any).waitUntil;
    if (typeof waitUntil === 'function') {
      waitUntil.call(this.state, promise);
      return;
    }
    void promise.catch(() => undefined);
  }

  private getAdminUserId(): number | null {
    const raw = (this.env as any).ADMIN_USER_ID;
    const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private async isAnalysisAllowed(): Promise<boolean> {
    if (!this.env.DB?.prepare) {
      return this.env.REQUIRE_EXPLICIT_STORAGE_CHOICE !== true &&
        this.env.REQUIRE_EXPLICIT_STORAGE_CHOICE !== 'true';
    }
    // A failed D1 read must not silently opt a configured bot back into AI.
    const row = await this.env.DB.prepare('SELECT settings_json FROM app_settings WHERE scope = ?')
      .bind('global').first() as { settings_json?: string } | null;
    if (!row?.settings_json) {
      // Older deployments did not have an owner policy; preserve their flags.
      return this.env.REQUIRE_EXPLICIT_STORAGE_CHOICE !== true &&
        this.env.REQUIRE_EXPLICIT_STORAGE_CHOICE !== 'true';
    }
    let policy: Record<string, unknown>;
    try {
      policy = JSON.parse(row.settings_json);
    } catch {
      return false;
    }
    return policy.version === 1 && policy.storageMode !== 'stats_only' &&
      policy.criminalEnabled !== false;
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

  private async scheduleQueueAlarm(delayOverrideMs?: number): Promise<void> {
    const storage = (this.state as any).storage;
    if (!storage?.setAlarm) {
      return;
    }
    const delay = delayOverrideMs ?? this.getNumberEnv('CRIMINAL_QUEUE_MAX_DELAY_MS', 60000);
    const targetAlarm = Date.now() + Math.max(0, delay);
    if (storage.getAlarm) {
      const existingAlarm = await storage.getAlarm();
      if (typeof existingAlarm === 'number' && existingAlarm > Date.now() && existingAlarm <= targetAlarm) {
        return;
      }
    }
    await storage.setAlarm(targetAlarm);
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
    if (!this.env.HISTORY?.get) {
      return true;
    }
    return (await this.readDailyCounter(key)) < cap;
  }

  private async recordDailyCounter(key: string): Promise<void> {
    if (!this.env.HISTORY?.get || !this.env.HISTORY?.put) {
      return;
    }
    const count = await this.readDailyCounter(key);
    await this.env.HISTORY.put(key, String(count + 1), { expirationTtl: 2 * 24 * 60 * 60 } as any);
  }

  // Daily caps moved from COUNTERS to HISTORY. Until today's key exists in
  // HISTORY, continue from the legacy COUNTERS value so a deploy mid-day does
  // not reset the budget.
  private async readDailyCounter(key: string): Promise<number> {
    const current = await this.env.HISTORY.get(key);
    const raw = current ?? (await this.env.COUNTERS?.get?.(key)) ?? '0';
    const count = parseInt(raw, 10);
    return Number.isFinite(count) ? count : 0;
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
      const textHash = await hashText(text);
      const cacheKey = `criminal_cache:${textHash}`;
      const cacheTTL = this.getCacheTTL();

      // Try KV storage first (faster)
      const cached = await this.env.HISTORY.get(cacheKey, 'json');
      if (cached) {
        const cacheData = cached as CriminalAnalysisCache;
        if (Date.now() - cacheData.createdAt < cacheTTL * 1000) {
          return normalizeAnalysisResult(cacheData.result);
        }
      }

      // Try database cache
      const stmt = this.env.DB.prepare(`
        SELECT analysis_result FROM criminal_analysis_cache 
        WHERE text_hash = ? AND created_at > datetime('now', '-${cacheTTL} seconds')
      `);
      const dbResult = await stmt.bind(textHash).first();

      if (dbResult) {
        const result = normalizeAnalysisResult(
          JSON.parse(dbResult.analysis_result as string) as CriminalAnalysisResult
        );
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
      const textHash = await hashText(text);
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

  // ========================================
  // 🔒 CONCURRENCY CONTROL
  // ========================================

  private async blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    // This method ensures atomic operations by blocking concurrent access
    // using Durable Objects' built-in concurrency control
    return await this.state.blockConcurrencyWhile(callback);
  }
}
