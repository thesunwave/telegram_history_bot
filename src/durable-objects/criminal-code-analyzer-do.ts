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
  reasons: CriminalPrefilterReason[];
  enqueuedAt: number;
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

const QUEUE_STORAGE_KEY = 'criminal_analysis_queue';
const LAST_OPENROUTER_CALL_KEY = 'criminal_openrouter_last_call';
const LAST_FINAL_ANALYSIS_CALL_KEY = 'criminal_final_analysis_last_call';

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
      console.error('❌ Failed to initialize CriminalCodeAnalyzerDO:', error);
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
    } catch (error: any) {
      console.error('❌ CriminalCodeAnalyzerDO fetch error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error', details: error.message }),
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
      const { text, chatId, messageId, userId, forceRefresh = false, day } = body;

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
        await this.storeViolations(result.violations, chatId, messageId, userId, text, body.username, day);
        await this.updateStatistics(result);
      }

      return new Response(
        JSON.stringify(result),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: any) {
      console.error('❌ Error in handleAnalyzeRequest:', error);
      return new Response(
        JSON.stringify({ error: 'Analysis failed', details: error.message }),
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

      const { text, chatId, messageId, userId, username, day, ts } = body;
      if (!text || text.trim().length === 0) {
        return new Response(JSON.stringify({ error: 'Text is required' }), { status: 400 });
      }
      if (!chatId) {
        return new Response(JSON.stringify({ error: 'Chat ID is required' }), { status: 400 });
      }

      const previousTexts = await this.getRecentContextTexts(chatId);
      const prefilter = criminalPrefilter({
        text,
        isCommand: text.startsWith('/'),
        previousTexts,
      });

      if (!prefilter.shouldQueue) {
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
          reasons: prefilter.reasons,
          enqueuedAt: Date.now(),
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
    } catch (error: any) {
      console.error('❌ Error in handleEnqueueRequest:', error);
      return new Response(
        JSON.stringify({ error: 'Enqueue failed', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
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
            message.day
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
      console.error('❌ Error in handleBatchAnalyzeRequest:', error);
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

    for (const task of batch) {
      const contextInput = await this.buildContextInput(task);
      const semanticPrefilter = await this.runSemanticPrefilter(contextInput, task);
      if (!semanticPrefilter.shouldAnalyze) {
        console.log('✅ Criminal semantic prefilter skipped final analysis', {
          chatId: task.chatId.toString(36),
          messageId: task.messageId,
          reason: semanticPrefilter.reason,
          confidence: semanticPrefilter.confidence
        });
        continue;
      }

      if (!(await this.canSpendFinalAnalysisRequest())) {
        await this.recordDailyCounter(this.getSkippedFinalAnalysisUsageKey());
        console.warn('⚠️ Criminal final analysis skipped by daily cap', {
          chatId: task.chatId.toString(36),
          messageId: task.messageId,
          provider: this.getCriminalProviderName(),
        });
        continue;
      }

      await this.recordFinalAnalysisRequest();

      if (this.getCriminalProviderName() === 'openrouter') {
        await this.waitForFinalAnalysisInterval();
      }
      const result = await this.performContextualAnalysis(contextInput);

      if (result.hasViolations && result.violations.length > 0) {
        await this.storeViolations(
          result.violations,
          task.chatId,
          task.messageId,
          task.userId,
          task.text,
          task.username,
          task.day
        );
        await this.updateStatistics(result);
        try {
          await this.sendAdminViolationReport(result, task);
        } catch (error: any) {
          console.error('❌ Failed to send admin criminal violation report:', error);
        }
      } else if (this.hasStrongLocalSignal(task) && result.legalReferences && result.legalReferences.length > 0) {
        try {
          await this.sendAdminLegalReferenceReport(result, task);
        } catch (error: any) {
          console.error('❌ Failed to send admin legal reference report:', error);
        }
      } else {
        console.log(`✅ Criminal queue task analyzed without confirmed violation (${reason})`);
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

  private async runSemanticPrefilter(
    input: CriminalContextAnalysisInput,
    task: QueuedCriminalAnalysisTask
  ): Promise<CriminalSemanticPrefilterResult> {
    const enabled = this.getBooleanEnv('CRIMINAL_AI_PREFILTER_ENABLED', true);
    if (!enabled) {
      return {
        shouldAnalyze: true,
        reason: 'none',
        confidence: 1,
        explanation: 'semantic prefilter disabled'
      };
    }

    try {
      if (!(await this.canSpendPrefilterRequest())) {
        await this.recordDailyCounter(this.getSkippedPrefilterUsageKey());
        return {
          shouldAnalyze: false,
          reason: 'none',
          confidence: 0,
          explanation: 'semantic prefilter daily cap exceeded'
        };
      }
      await this.recordPrefilterRequest();
      const result = await this.callOpenAIPrefilter(input);
      const threshold = this.getNumberEnv('CRIMINAL_PREFILTER_MIN_CONFIDENCE', 0.55);
      return {
        ...result,
        shouldAnalyze: result.shouldAnalyze && result.confidence >= threshold,
      };
    } catch (error: any) {
      console.warn('⚠️ Criminal semantic prefilter failed', {
        chatId: task.chatId.toString(36),
        messageId: task.messageId,
        error: error.message || String(error),
      });

      const hasStrongLocalSignal = task.reasons.some(reason => reason !== 'semantic_prefilter' && reason !== 'benign_object_context');
      return {
        shouldAnalyze: hasStrongLocalSignal,
        reason: hasStrongLocalSignal ? 'threat' : 'none',
        confidence: hasStrongLocalSignal ? 1 : 0,
        explanation: 'fallback after semantic prefilter failure',
      };
    }
  }

  private async callOpenAIPrefilter(input: CriminalContextAnalysisInput): Promise<CriminalSemanticPrefilterResult> {
    const apiKey = (this.env as any).OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for criminal semantic prefilter');
    }

    const model = (this.env as any).CRIMINAL_PREFILTER_MODEL || (this.env as any).LLM_NANO_MODEL || 'gpt-4.1-nano';
    const maxTokens = Math.max(this.getNumberEnv('CRIMINAL_PREFILTER_MAX_TOKENS', 512), 512);
    const isGpt5 = String(model).toLowerCase().includes('gpt-5');
    const systemPrompt = [
      'Ты быстрый prefilter для Telegram-чата.',
      'Реши, нужно ли отправлять target-сообщение в дорогой юридический анализ УК РФ.',
      'Ищи только реальные признаки: угрозы, призывы к насилию, экстремизм/терроризм, самообвинение в насилии, опасные инструкции.',
      'Мат, сексуальный сленг, шутки, бытовые фразы и действия с предметами сами по себе не являются причиной.',
      'Верни строго JSON: {"shouldAnalyze":boolean,"reason":"threat|incitement|self_incrimination|extremism|dangerous_instruction|none","confidence":0..1,"explanation":"short"}'
    ].join('\n');
    const userPayload = JSON.stringify({
      targetMessageId: input.targetMessageId,
      targetText: input.targetText,
      targetUsername: input.targetUsername,
      contextWindow: input.contextWindow,
      messages: input.messages.map(message => ({
        username: message.username,
        text: message.text,
        relativePosition: message.relativePosition,
        isTarget: message.isTarget
      }))
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

    const usage = parsed?.usage;
    if (usage) {
      getBudgetTracker(this.env).recordUsage(model, 'criminal', {
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0)),
      });
    }

    const raw = isGpt5 ? this.extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI prefilter returned empty content');
    }

    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<CriminalSemanticPrefilterResult>;
    const reason = result.reason === 'threat' ||
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
    };
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
      console.error('❌ Error in handleStatsRequest:', error);
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
      console.error('❌ Error in handleClearCacheRequest:', error);
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
      if (this.shouldRunOpenAIFinalJudge(result)) {
        const input = this.buildSingleMessageContextInput(text);
        const judged = await this.runOpenAIFinalJudge(input, result);
        console.log(`✅ Analysis completed: ${judged.hasViolations ? judged.violations.length + ' violations found' : 'no violations'}`);
        return judged;
      }
      console.log(`✅ Analysis completed: ${result.hasViolations ? result.violations.length + ' violations found' : 'no violations'}`);
      return result;
    } catch (error: any) {
      console.error('❌ AI analysis failed:', error);
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

      if (this.shouldRunOpenAIFinalJudge(result)) {
        return await this.runOpenAIFinalJudge(input, result);
      }

      return result;
    } catch (error: any) {
      console.error('❌ Contextual AI analysis failed:', error);
      return {
        hasViolations: false,
        decision: 'no_violation',
        evidence: {
          subject: 'unknown',
          object: 'unknown',
          intent: 'analysis failed',
          contextSummary: 'safe fallback',
          whyNotBenign: 'not enough reliable model output to classify as violation',
        },
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: Date.now(),
        targetMessageId: input.targetMessageId,
        contextWindow: input.contextWindow,
      };
    }
  }

  private shouldRunOpenAIFinalJudge(result: CriminalAnalysisResult): boolean {
    if (this.getCriminalProviderName() !== 'legal-rag') {
      return false;
    }
    if (!this.getBooleanEnv('CRIMINAL_FINAL_JUDGE_ENABLED', true)) {
      return false;
    }
    if (result.hasViolations) {
      return false;
    }
    return Boolean(result.legalReferences?.length);
  }

  private async runOpenAIFinalJudge(
    input: CriminalContextAnalysisInput,
    retrievalResult: CriminalAnalysisResult
  ): Promise<CriminalAnalysisResult> {
    try {
      const judge = await this.callOpenAIFinalJudge(input, retrievalResult.legalReferences || []);
      return this.buildJudgedAnalysisResult(input, retrievalResult, judge);
    } catch (error: any) {
      console.warn('⚠️ Criminal final judge failed, keeping legal-rag result', {
        chatId: input.chatId.toString(36),
        messageId: input.targetMessageId,
        error: error.message || String(error),
      });
      return retrievalResult;
    }
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
    const maxTokens = Math.max(this.getNumberEnv('CRIMINAL_FINAL_JUDGE_MAX_TOKENS', 1200), 512);
    const isGpt5 = String(model).toLowerCase().includes('gpt-5');
    const systemPrompt = [
      'Ты юридический классификатор для Telegram-чата.',
      'Твоя задача: по target-сообщению, краткому контексту и найденным статьям УК РФ решить, есть ли достаточно оснований сохранить событие как возможное нарушение.',
      'Не фантазируй и не расширяй состав преступления. Если не хватает контекста, это uncertain или no_violation.',
      'Используй только статьи из legalReferences. Не добавляй статьи, которых нет в списке.',
      'violation разрешен только если target/context содержит конкретное деяние, угрозу, призыв, самообвинение или опасную инструкцию, подходящие под найденную статью.',
      'Шутки, цитаты, обсуждение закона, новостей, книг, игр, мемов и гипотетические рассуждения не классифицируй как violation без прямого опасного смысла.',
      'Верни строго JSON: {"decision":"violation|no_violation|uncertain","confidence":0..1,"evidence":{"subject":"short","object":"short","intent":"short","contextSummary":"short","whyNotBenign":"short"},"violations":[{"article":"119","subarticle":null,"articleTitle":"...","quote":"exact user quote","punishment":"short","severity":1..10,"confidence":0..1}]}',
    ].join('\n');
    const payload = {
      targetMessageId: input.targetMessageId,
      targetText: input.targetText,
      targetUsername: input.targetUsername,
      contextWindow: input.contextWindow,
      messages: input.messages.map(message => ({
        username: message.username,
        text: message.text,
        relativePosition: message.relativePosition,
        isTarget: message.isTarget,
      })),
      legalReferences: references.slice(0, 5).map(reference => ({
        article: reference.article,
        subarticle: reference.subarticle,
        articleTitle: reference.articleTitle,
        quote: reference.quote,
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

    const usage = parsed?.usage;
    if (usage) {
      getBudgetTracker(this.env).recordUsage(model, 'criminal', {
        promptTokens: usage.prompt_tokens || usage.input_tokens || 0,
        completionTokens: usage.completion_tokens || usage.output_tokens || 0,
        totalTokens: usage.total_tokens || ((usage.input_tokens || 0) + (usage.output_tokens || 0)),
      });
    }

    const raw = isGpt5 ? this.extractOpenAIResponsesText(parsed) : parsed?.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error('OpenAI final judge returned empty content');
    }

    const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch ? jsonMatch[0] : raw) as CriminalFinalJudgeResult;
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
    const allowedReferences = new Map(
      (retrievalResult.legalReferences || []).map(reference => [
        `${reference.article}:${reference.subarticle || ''}`,
        reference,
      ])
    );
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

    return {
      article,
      subarticle,
      articleTitle: this.cleanJudgeText(violation.articleTitle, reference.articleTitle),
      quote: this.cleanJudgeText(violation.quote, input.targetText).slice(0, 500),
      punishment: this.cleanJudgeText(violation.punishment, reference.quote).slice(0, 500),
      severity,
      confidence,
      decision: 'violation',
      evidence,
      targetMessageId: input.targetMessageId,
      contextWindow: input.contextWindow,
    };
  }

  private cleanJudgeText(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
      return fallback;
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized ? normalized.slice(0, 1000) : fallback;
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
    return task.reasons.some(reason => reason !== 'semantic_prefilter' && reason !== 'benign_object_context');
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
      console.error('❌ Error getting cached analysis:', error);
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
      console.error('❌ Error caching analysis:', error);
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
    day?: string
  ): Promise<void> {
    try {
      const storePreviewRaw = (this.env as any).CRIMINAL_STORE_TEXT_PREVIEW;
      const storePreview = typeof storePreviewRaw === 'string' ? storePreviewRaw.toLowerCase() === 'true' : Boolean(storePreviewRaw);
      const previewLenRaw = (this.env as any).CRIMINAL_TEXT_PREVIEW_LENGTH;
      const previewLength = Number.isFinite(Number(previewLenRaw)) && Number(previewLenRaw) > 0 ? Math.floor(Number(previewLenRaw)) : 200;

      // Store violations in database
      for (const violation of violations) {
        const stmt = this.env.DB.prepare(`
          INSERT INTO criminal_violations (
            chat_id, message_id, user_id, article, subarticle, article_title, quote, punishment, 
            severity, confidence, text_preview, decision, evidence_json, target_message_id,
            context_before, context_after, context_total_messages, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
          contextWindow?.totalMessages ?? null
        ).run();
      }

      // Send data to CountersDO for KV storage updates
      if (chatId && userId && violations.length > 0) {
        try {
          const dayToUse = day || new Date().toISOString().slice(0, 10);
          const totalSeverity = violations.reduce((sum, v) => sum + v.severity, 0);

          const countersId = this.env.COUNTERS_DO.idFromName(String(chatId));
          const counters = this.env.COUNTERS_DO.get(countersId);

          const payload = {
            chatId,
            userId,
            username: username || 'unknown',
            day: dayToUse,
            violations,
            totalSeverity
          };

          const response = await counters.fetch('https://do/criminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            console.error('❌ Failed to update criminal counters:', await response.text());
          }
        } catch (error: any) {
          console.error('❌ Error updating criminal counters:', error);
        }
      }
    } catch (error: any) {
      console.error('❌ Error storing violations:', error);
      // Don't throw - storage failure shouldn't break analysis
    }
  }

  private async updateStatistics(result: CriminalAnalysisResult): Promise<void> {
    try {
      // Statistics are updated automatically via database trigger
      // This method can be extended for additional statistics logic
      console.log(`📊 Statistics updated for ${result.violations.length} violations`);
    } catch (error: any) {
      console.error('❌ Error updating statistics:', error);
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
