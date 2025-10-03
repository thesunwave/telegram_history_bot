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
  CriminalViolation,
  CriminalViolationStats,
  CriminalAnalysisCache
} from './env';
import type { DurableObjectState } from '@cloudflare/workers-types';
import type { AIProvider } from './providers/ai-provider';

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
      const mod = await import('./providers/provider-factory');
      const PF = (mod as any).ProviderFactory || mod;
      this.aiProvider = await PF.createProvider(this.env);
      console.log('✅ CriminalCodeAnalyzerDO initialized successfully');
    } catch (error: unknown) {
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
        return this.state.blockConcurrencyWhile(async () => {
          return await this.handleAnalyzeRequest(request);
        });
      }

      // 📊 Batch analysis
      if (path === '/batch-analyze' && request.method === 'POST') {
        return this.state.blockConcurrencyWhile(async () => {
          return await this.handleBatchAnalyzeRequest(request);
        });
      }

      // 📈 Get statistics
      if (path === '/stats' && request.method === 'GET') {
        return await this.handleStatsRequest(request);
      }

      // 🗑️ Clear cache
      if (path === '/clear-cache' && request.method === 'POST') {
        return this.state.blockConcurrencyWhile(async () => {
          return await this.handleClearCacheRequest(request);
        });
      }

      return new Response('Not Found', { status: 404 });
    } catch (error: unknown) {
      console.error('❌ CriminalCodeAnalyzerDO fetch error:', error);
      // Best-effort fallback for analyze path to avoid failing the request
      try {
        const url = new URL(request.url);
        if (url.pathname === '/analyze' && request.method === 'POST') {
          return await this.handleAnalyzeRequest(request);
        }
      } catch {}
      return new Response(
        JSON.stringify({ error: 'Internal server error', details: (error as any)?.message || String(error) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ========================================
  // 🔍 SINGLE MESSAGE ANALYSIS
  // ========================================

  private async handleAnalyzeRequest(request: Request): Promise<Response> {
    try {
      let body: CriminalAnalysisRequest;
      try {
        body = await request.json();
      } catch (jsonError) {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON in request body' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      const { text, chatId, messageId, userId, forceRefresh = false, day } = body;

      // Debug guardrails to aid test diagnostics
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[CriminalDO] analyze request parsed', { hasText: !!text, chatId, userId, forceRefresh });
      }

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

      if ((this.env as any).CRIMINAL_CODE_MAX_TEXT_LENGTH ?
          text.length > (this.env as any).CRIMINAL_CODE_MAX_TEXT_LENGTH :
          text.length > (this.env as any).CRIMINAL_MAX_TEXT_LENGTH) {
        return new Response(
          JSON.stringify({ 
            error: 'Text too long', 
            maxLength: (this.env as any).CRIMINAL_CODE_MAX_TEXT_LENGTH ?? (this.env as any).CRIMINAL_MAX_TEXT_LENGTH
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 🔍 Check cache first; analysis errors are handled inside performAnalysis (returns safe empty result)
      let result: CriminalAnalysisResult;
      if (!forceRefresh) {
        const cached = await this.getCachedAnalysis(text);
        if (cached) {
          console.log('📋 Using cached criminal code analysis');
          result = cached;
        } else {
          if (typeof console !== 'undefined' && console.debug) console.debug('[CriminalDO] cache miss, performing analysis');
          result = await this.performAnalysis(text);
          try { await this.cacheAnalysis(text, result); } catch {}
        }
      } else {
        if (typeof console !== 'undefined' && console.debug) console.debug('[CriminalDO] force refresh, performing analysis');
        result = await this.performAnalysis(text);
        try { await this.cacheAnalysis(text, result); } catch {}
      }

      // 💾 Store violation in database if found (best-effort, never fail request)
      if (result.hasViolations && result.violations.length > 0) {
        try {
          await this.storeViolations(result.violations, chatId, messageId, userId, text, body.username, day);
          await this.updateStatistics(result);
        } catch (storageError) {
          console.error('⚠️ Failed to persist violations/statistics:', (storageError as any)?.message || String(storageError));
          // continue
        }
      }

      return new Response(
        JSON.stringify(result),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error: unknown) {
      console.error('❌ Error in handleAnalyzeRequest:', error);
      // Graceful degradation: attempt to return analysis result instead of 500 whenever possible
      try {
        const body = await request.json().catch(() => null) as any;
        const text = body?.text;
        if (typeof text === 'string' && text.trim().length > 0) {
          // Create fresh provider instance to avoid initialization issues
          try {
            const mod = await import('./providers/provider-factory');
            const PF = (mod as any).ProviderFactory || mod;
            const freshProvider = await PF.createProvider(this.env as any);
            const result = await freshProvider.analyzeCriminalCode(text, this.env);
            return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
          } catch (innerErr) {
            // Final safe fallback: empty result
            const safeResult = {
              hasViolations: false,
              violations: [],
              totalSeverity: 0,
              riskLevel: 'low',
              analysisTimestamp: Date.now()
            };
            return new Response(JSON.stringify(safeResult), { headers: { 'Content-Type': 'application/json' } });
          }
        }
      } catch {}
      return new Response(
        JSON.stringify({ error: 'Analysis failed', details: (error as any)?.message || String(error) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ========================================
  // 📊 BATCH ANALYSIS
  // ========================================

  private async handleBatchAnalyzeRequest(request: Request): Promise<Response> {
    try {
      const body: CriminalBatchAnalysisRequest = await request.json();
      const { messages, forceRefresh = false } = body;

      if (!messages || messages.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Messages array is required' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if ((this.env as any).CRIMINAL_CODE_BATCH_SIZE ?
          messages.length > (this.env as any).CRIMINAL_CODE_BATCH_SIZE :
          messages.length > (this.env as any).CRIMINAL_BATCH_SIZE) {
        return new Response(
          JSON.stringify({ 
            error: 'Too many messages', 
            maxBatchSize: (this.env as any).CRIMINAL_CODE_BATCH_SIZE ?? (this.env as any).CRIMINAL_BATCH_SIZE 
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const results: Array<CriminalAnalysisResult & { messageId?: number; chatId?: number }> = [];
      
      for (const message of messages) {
        if (!message.text || message.text.trim().length === 0) {
          continue;
        }

        if ((this.env as any).CRIMINAL_CODE_MAX_TEXT_LENGTH ?
            message.text.length > (this.env as any).CRIMINAL_CODE_MAX_TEXT_LENGTH :
            message.text.length > (this.env as any).CRIMINAL_MAX_TEXT_LENGTH) {
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
    } catch (error: unknown) {
      console.error('❌ Error in handleBatchAnalyzeRequest:', error);
      return new Response(
        JSON.stringify({ error: 'Batch analysis failed', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
      console.log(`✅ Analysis completed: ${result.hasViolations ? result.violations.length + ' violations found' : 'no violations'}`);
      return result;
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
            chat_id, message_id, user_id, article, subarticle, quote, punishment, 
            severity, confidence, text_preview, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `);
        const textPreview = storePreview && text ? text.substring(0, previewLength) : null;
        
        await stmt.bind(
          chatId || null,
          messageId || null,
          userId || null,
          violation.article,
          violation.subarticle || null,
          violation.quote,
          violation.punishment,
          violation.severity,
          violation.confidence,
          textPreview
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
        } catch (error: unknown) {
          console.error('❌ Error updating criminal counters:', error);
        }
      }
    } catch (error: unknown) {
      console.error('❌ Error storing violations:', error);
      // Don't throw - storage failure shouldn't break analysis
    }
  }

  private async updateStatistics(result: CriminalAnalysisResult): Promise<void> {
    try {
      // Statistics are updated automatically via database trigger
      // This method can be extended for additional statistics logic
      console.log(`📊 Statistics updated for ${result.violations.length} violations`);
    } catch (error: unknown) {
      console.error('❌ Error updating statistics:', error);
    }
  }

  // ========================================
  // 🛠️ UTILITY METHODS
  // ========================================

  private async hashText(text: string): Promise<string> {
    const normalized = (text || '').trim().toLowerCase();
    try {
      if (typeof crypto !== 'undefined' && (crypto as any).subtle?.digest && typeof TextEncoder !== 'undefined') {
        const encoder = new TextEncoder();
        const data = encoder.encode(normalized);
        const hashBuffer = await (crypto as any).subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch {
      // Fallback to non-crypto hash below
    }

    // Fallback: non-cryptographic hash for environments without WebCrypto (e.g., Node tests)
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    }
    return Math.abs(hash >>> 0).toString(16);
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
