import { Env } from "../../core/env";
import { Logger } from "../../core/logger";
import { hashText } from "../../core/utils";
import { ProfanityAnalysisResult, AIProvider } from "../../core/providers/ai-provider";
import { ProviderFactory } from "../../core/providers/provider-factory";
import {
  countNormalizedProfanityTokens,
  normalizeProfanityWord,
} from "./local-detector";

// Core interfaces for profanity detection
export interface ProfanityWord {
  original: string;    // Найденное слово в тексте
  word: string;        // Нормализованная словоформа для статистики
  baseForm: string;    // Базовая форма/семейство, если вернул провайдер
  positions: number[]; // Позиции в тексте
}

export interface ProfanityResult {
  words: ProfanityWord[];
  totalCount: number;
}



// Cache key generation
export function generateCacheKey(text: string): string {
  const textHash = hashText(text);
  return `profanity_cache:${textHash}`;
}

// Cache entry with metadata for LRU
interface CacheEntry {
  result: ProfanityResult;
  timestamp: number;
  size: number;
  accessCount: number;
  lastAccess: number;
}

// Batching support for AI requests
interface BatchRequest {
  text: string;
  resolve: (result: ProfanityResult) => void;
  reject: (error: any) => void;
}

// Circuit breaker state for tracking AI failures
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  isOpen: boolean;
  lastSuccessTime: number;
}

// Main profanity analyzer class
export class ProfanityAnalyzer {
  // TTL is now configured via env variables, defaults to 4 hours
  private static readonly MAX_TEXT_LENGTH = 1000; // Limit analysis to first 1000 characters
  private static readonly ANALYSIS_TIMEOUT = 10000; // 10 seconds timeout for analysis

  // Cache management - more aggressive limits
  private static readonly MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB max cache size (reduced from 50MB)
  private static readonly MAX_CACHE_ENTRIES = 5000; // Max 5k entries (reduced from 10k)
  private static readonly CACHE_CLEANUP_THRESHOLD = 0.7; // Cleanup when 70% full (more aggressive)

  // Batching configuration
  private static readonly BATCH_SIZE = 5; // Max 5 messages per batch
  private static readonly BATCH_TIMEOUT = 10; // 10ms batch timeout

  // Circuit breaker configuration
  private static readonly CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5; // Open circuit after 5 failures
  private static readonly CIRCUIT_BREAKER_TIMEOUT = 60 * 1000; // 1 minute timeout when circuit is open
  private static readonly CIRCUIT_BREAKER_RESET_TIMEOUT = 5 * 60 * 1000; // Reset failure count after 5 minutes of success

  private static readonly COUNTER_BATCH_SIZE = 25;
  private static readonly COUNTER_BATCH_TIMEOUT_MS = 50;

  private circuitBreakerState: CircuitBreakerState = {
    failures: 0,
    lastFailureTime: 0,
    isOpen: false,
    lastSuccessTime: Date.now()
  };

  // Batching state
  private batchQueue: BatchRequest[] = [];
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private currentCacheSize = 0;
  private cacheEntries = new Map<string, CacheEntry>();
  private counterBatchQueue: Array<{
    type: 'activity' | 'profanity';
    chatId: number;
    userId: number;
    username: string;
    day: string;
    count: number;
    words?: Record<string, number>;
  }> = [];
  private counterBatchTimeout: ReturnType<typeof setTimeout> | null = null;
  private aiProvider: AIProvider | null = null;

  constructor(aiProvider?: AIProvider) {
    this.aiProvider = aiProvider || null;
  }

  private getCacheTTL(env: Env): number {
    // TTL in seconds, prefer env var, fallback to 4 hours
    const raw = (env as any).PROFANITY_ANALYSIS_CACHE_TTL;
    const ttl = typeof raw === 'string' ? parseInt(raw, 10) : typeof raw === 'number' ? raw : 4 * 60 * 60;
    // Ensure positive integer seconds
    const safe = Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : 4 * 60 * 60;
    return safe;
  }

  private isCircuitBreakerOpen(): boolean {
    const now = Date.now();

    // If circuit is open, check if timeout has passed
    if (this.circuitBreakerState.isOpen) {
      if (now - this.circuitBreakerState.lastFailureTime > ProfanityAnalyzer.CIRCUIT_BREAKER_TIMEOUT) {
        // Try to close the circuit (half-open state)
        this.circuitBreakerState.isOpen = false;
        Logger.log('Profanity circuit breaker: attempting to close circuit', {
          failureCount: this.circuitBreakerState.failures,
          timeoutDuration: ProfanityAnalyzer.CIRCUIT_BREAKER_TIMEOUT,
          timeSinceLastFailure: now - this.circuitBreakerState.lastFailureTime
        });
        return false;
      }
      return true;
    }

    // Check if we should open the circuit due to too many failures
    if (this.circuitBreakerState.failures >= ProfanityAnalyzer.CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.circuitBreakerState.isOpen = true;
      Logger.log('Profanity circuit breaker: opening circuit due to failures', {
        failureCount: this.circuitBreakerState.failures,
        threshold: ProfanityAnalyzer.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
        timeoutDuration: ProfanityAnalyzer.CIRCUIT_BREAKER_TIMEOUT
      });
      return true;
    }

    return false;
  }

  private recordAISuccess(): void {
    const now = Date.now();
    const wasOpen = this.circuitBreakerState.isOpen;
    const previousLastSuccessTime = this.circuitBreakerState.lastSuccessTime;

    // Reset circuit breaker state on success
    this.circuitBreakerState.isOpen = false;
    this.circuitBreakerState.lastSuccessTime = now;

    // If successful after timeout, we can consider reducing failures
    if (now - this.circuitBreakerState.lastFailureTime > ProfanityAnalyzer.CIRCUIT_BREAKER_RESET_TIMEOUT) {
      if (this.circuitBreakerState.failures > 0) {
        Logger.log('Profanity circuit breaker: resetting failure count due to sustained success', {
          previousFailures: this.circuitBreakerState.failures,
          resetTimeout: ProfanityAnalyzer.CIRCUIT_BREAKER_RESET_TIMEOUT,
          successDuration: now - this.circuitBreakerState.lastFailureTime,
          circuitWasPreviouslyOpen: wasOpen
        });
        this.circuitBreakerState.failures = 0;
      }
    }

    if (wasOpen) {
      Logger.log('Profanity circuit breaker: successfully closed circuit', {
        previousFailures: this.circuitBreakerState.failures,
        currentFailures: this.circuitBreakerState.failures,
        timeSinceLastSuccess: now - previousLastSuccessTime,
        circuitCloseTime: now
      });
    }
  }

  private recordAIFailure(): void {
    this.circuitBreakerState.failures++;
    this.circuitBreakerState.lastFailureTime = Date.now();

    Logger.log('Profanity circuit breaker: recorded AI failure', {
      failureCount: this.circuitBreakerState.failures,
      threshold: ProfanityAnalyzer.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      willOpenCircuit: this.circuitBreakerState.failures >= ProfanityAnalyzer.CIRCUIT_BREAKER_FAILURE_THRESHOLD
    });
  }

  async analyzeMessage(text: string, env: Env, aiProvider?: AIProvider): Promise<ProfanityResult> {
    const startTime = Date.now();
    const textLength = text.length;
    const timings: Record<string, number> = {};

    // Determine which provider to use
    const provider = this.aiProvider || aiProvider;
    if (!provider) {
      throw new Error('AIProvider is required for profanity analysis. Pass it to constructor or analyzeMessage method.');
    }

    try {
      Logger.debug(env, 'Profanity analysis: detailed process started', {
        textLength,
        truncated: textLength > ProfanityAnalyzer.MAX_TEXT_LENGTH,
        maxLength: ProfanityAnalyzer.MAX_TEXT_LENGTH,
        timeout: ProfanityAnalyzer.ANALYSIS_TIMEOUT,
        cacheEnabled: true,
        cacheTTL: this.getCacheTTL(env),
        batchingEnabled: true,
        maxBatchSize: ProfanityAnalyzer.BATCH_SIZE,
        batchTimeout: ProfanityAnalyzer.BATCH_TIMEOUT
      });

      // Limit text length for performance
      const textLimitStart = Date.now();
      const limitedText = this.limitTextLength(text);
      timings.textLimiting = Date.now() - textLimitStart;

      if (limitedText.length < textLength) {
        Logger.log('Profanity analysis: text truncated for performance', {
          originalLength: textLength,
          truncatedLength: limitedText.length,
          truncationRatio: limitedText.length / textLength
        });
      }

      // Generate cache key
      const cacheKeyStart = Date.now();
      const cacheKey = generateCacheKey(limitedText);
      timings.cacheKeyGeneration = Date.now() - cacheKeyStart;

      Logger.debug(env, 'Profanity analysis: cache key generated', {
        cacheKey: cacheKey.substring(0, 20) + '...',
        keyGenerationTime: timings.cacheKeyGeneration
      });

      // Try to get cached result
      const cacheCheckStart = Date.now();
      const cachedResult = await this.getCachedResult(cacheKey, env);
      timings.cacheCheck = Date.now() - cacheCheckStart;

      if (cachedResult) {
        const normalizedCachedResult = this.normalizeAnalysisResult(limitedText, {
          hasProfanity: cachedResult.totalCount > 0,
          words: cachedResult.words.map(word => ({
            word: word.word || word.original,
            baseForm: word.baseForm,
            confidence: 1,
          })),
        });
        const totalDuration = Date.now() - startTime;
        Logger.debug(env, 'Profanity analysis: completed from cache', {
          totalDuration,
          cacheCheckTime: timings.cacheCheck,
          wordsFound: normalizedCachedResult.totalCount,
          uniqueWords: normalizedCachedResult.words.length,
          cacheEfficiency: 'cache-hit',
          performanceRating: totalDuration < 100 ? 'excellent' : totalDuration < 500 ? 'good' : 'acceptable'
        });
        return normalizedCachedResult;
      }

      // Check circuit breaker
      if (this.isCircuitBreakerOpen()) {
        const circuitBreakerDuration = Date.now() - startTime;
        Logger.log('Profanity analysis: circuit breaker is open, returning empty result', {
          duration: circuitBreakerDuration,
          failures: this.circuitBreakerState.failures,
          lastFailureTime: this.circuitBreakerState.lastFailureTime
        });

        const emptyResult: ProfanityResult = { words: [], totalCount: 0 };
        return emptyResult;
      }

      // Perform AI analysis
      const analysisStart = Date.now();
      const profanityResult = await this.performAIAnalysis(limitedText, env, provider);
      timings.aiAnalysis = Date.now() - analysisStart;

      // Record success
      this.recordAISuccess();

      // Cache the result
      const cacheStorageStart = Date.now();
      await this.cacheResult(cacheKey, profanityResult, env);
      timings.cacheStorage = Date.now() - cacheStorageStart;

      const totalDuration = Date.now() - startTime;

      Logger.log('Profanity analysis: completed with detailed metrics', {
        totalDuration,
        textLength,
        limitedTextLength: limitedText.length,
        wordsFound: profanityResult.totalCount,
        uniqueWords: profanityResult.words.length,
        cacheHit: false,
        timings: {
          textLimiting: timings.textLimiting,
          cacheKeyGeneration: timings.cacheKeyGeneration,
          cacheCheck: timings.cacheCheck,
          aiAnalysis: timings.aiAnalysis,
          cacheStorage: timings.cacheStorage
        },
        performanceBreakdown: {
          cacheCheckPercentage: (timings.cacheCheck / totalDuration * 100).toFixed(1) + '%',
          aiAnalysisPercentage: (timings.aiAnalysis / totalDuration * 100).toFixed(1) + '%',
          cacheStoragePercentage: (timings.cacheStorage / totalDuration * 100).toFixed(1) + '%'
        },
        performanceRating: totalDuration < 1000 ? 'excellent' : totalDuration < 3000 ? 'good' : totalDuration < 7000 ? 'acceptable' : 'slow'
      });

      return profanityResult;

    } catch (error) {
      const totalDuration = Date.now() - startTime;

      // Record failure
      this.recordAIFailure();

      // Determine error phase for better troubleshooting
      const errorPhase = this.determineErrorPhase(timings);

      Logger.error('Profanity analysis: failed with detailed error information', {
        error: error instanceof Error ? error.message : String(error),
        textLength,
        totalDuration,
        errorPhase,
        timings: {
          textLimiting: timings.textLimiting || null,
          cacheKeyGeneration: timings.cacheKeyGeneration || null,
          cacheCheck: timings.cacheCheck || null,
          aiAnalysis: timings.aiAnalysis || null,
          cacheStorage: timings.cacheStorage || null
        },
        circuitBreakerState: {
          failures: this.circuitBreakerState.failures,
          isOpen: this.circuitBreakerState.isOpen,
          lastFailureTime: this.circuitBreakerState.lastFailureTime
        },
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        stack: error instanceof Error ? error.stack?.substring(0, 200) : null
      });

      // Return empty result on error to prevent blocking
      return { words: [], totalCount: 0 };
    }
  }

  private determineErrorPhase(timings: Record<string, number>): string {
    if (!timings.cacheCheck) return 'cache-check';
    if (!timings.aiAnalysis) return 'ai-analysis';
    if (!timings.cacheStorage) return 'cache-storage';
    return 'unknown';
  }

  private limitTextLength(text: string): string {
    if (text.length <= ProfanityAnalyzer.MAX_TEXT_LENGTH) {
      return text;
    }

    // Try to cut at a word boundary near the limit
    const truncated = text.substring(0, ProfanityAnalyzer.MAX_TEXT_LENGTH);
    const lastSpaceIndex = truncated.lastIndexOf(' ');

    if (lastSpaceIndex > ProfanityAnalyzer.MAX_TEXT_LENGTH * 0.8) {
      // If we found a space reasonably close to the end, cut there
      return truncated.substring(0, lastSpaceIndex);
    } else {
      // Otherwise just cut at the character limit
      return truncated;
    }
  }

  private async getCachedResult(cacheKey: string, env: Env): Promise<ProfanityResult | null> {
    const retrievalStart = Date.now();

    try {
      const cached = await env.COUNTERS.get(cacheKey);
      const retrievalTime = Date.now() - retrievalStart;

      if (cached) {
        const parseStart = Date.now();
        const result = JSON.parse(cached) as ProfanityResult;
        const parseTime = Date.now() - parseStart;

        Logger.debug(env, 'Profanity cache: hit with detailed metrics', {
          cacheKey: cacheKey.substring(0, 20) + '...',
          retrievalTime,
          parseTime,
          resultSize: cached.length,
          wordsInCache: result.words.length,
          totalCountInCache: result.totalCount,
          cacheEfficiency: retrievalTime < 10 ? 'excellent' : retrievalTime < 50 ? 'good' : 'slow'
        });

        return result;
      } else {
        Logger.debug(env, 'Profanity cache: miss with timing', {
          cacheKey: cacheKey.substring(0, 20) + '...',
          retrievalTime,
          reason: 'key-not-found-or-empty-result'
        });
      }
    } catch (error) {
      const retrievalTime = Date.now() - retrievalStart;

      Logger.error('Profanity cache: retrieval failed with detailed error', {
        cacheKey: cacheKey.substring(0, 20) + '...',
        retrievalTime,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
        reason: 'retrieval-error'
      });
    }
    return null;
  }

  private async cacheResult(cacheKey: string, result: ProfanityResult, env: Env): Promise<void> {
    // Don't cache empty results - no point in storing clean text analysis
    if (result.totalCount === 0 || result.words.length === 0) {
      Logger.debug(env, 'Profanity cache: skipping empty result', {
        cacheKey: cacheKey.substring(0, 20) + '...',
        reason: 'no-profanity-found',
        wordsFound: result.totalCount
      });
      return;
    }

    const storageStart = Date.now();

    try {
      const serializedResult = JSON.stringify(result);
      const serializationTime = Date.now() - storageStart;

      // Store in KV storage
      const putStart = Date.now();
      await env.COUNTERS.put(
        cacheKey,
        serializedResult,
        { expirationTtl: this.getCacheTTL(env) }
      );
      const putTime = Date.now() - putStart;

      // Store in memory cache
      const entry: CacheEntry = {
        result,
        timestamp: Date.now(),
        size: serializedResult.length,
        accessCount: 1,
        lastAccess: Date.now()
      };

      this.cacheEntries.set(cacheKey, entry);
      this.currentCacheSize += entry.size;

      // Check if cleanup is needed
      if (this.currentCacheSize > ProfanityAnalyzer.MAX_CACHE_SIZE * ProfanityAnalyzer.CACHE_CLEANUP_THRESHOLD ||
        this.cacheEntries.size > ProfanityAnalyzer.MAX_CACHE_ENTRIES * ProfanityAnalyzer.CACHE_CLEANUP_THRESHOLD) {
        this.performLRUCleanup();
      }

      const totalStorageTime = Date.now() - storageStart;

      Logger.debug(env, 'Profanity cache: stored result with detailed metrics', {
        cacheKey: cacheKey.substring(0, 20) + '...',
        wordsFound: result.totalCount,
        uniqueWords: result.words.length,
        ttl: this.getCacheTTL(env),
        serializedSize: serializedResult.length,
        serializationTime,
        putTime,
        totalStorageTime,
        storageEfficiency: totalStorageTime < 20 ? 'excellent' : totalStorageTime < 100 ? 'good' : 'slow',
        memoryCacheSize: this.currentCacheSize,
        memoryCacheEntries: this.cacheEntries.size
      });
    } catch (error) {
      const totalStorageTime = Date.now() - storageStart;

      Logger.error('Profanity cache: storage failed with detailed error', {
        cacheKey: cacheKey.substring(0, 20) + '...',
        wordsToStore: result.totalCount,
        uniqueWordsToStore: result.words.length,
        storageTime: totalStorageTime,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
    }
  }

  private performLRUCleanup(): void {
    const startTime = Date.now();
    const initialSize = this.cacheEntries.size;
    const initialBytes = this.currentCacheSize;

    // Sort entries by access pattern (least recently used first)
    const entries = Array.from(this.cacheEntries.entries());
    entries.sort(([, a], [, b]) => {
      // Priority: access count (lower first), then last access time (older first)
      if (a.accessCount !== b.accessCount) {
        return a.accessCount - b.accessCount;
      }
      return a.lastAccess - b.lastAccess;
    });

    // Remove 20% of entries
    const toRemove = Math.ceil(entries.length * 0.2);
    const removedEntries = entries.slice(0, toRemove);

    for (const [key, entry] of removedEntries) {
      this.cacheEntries.delete(key);
      this.currentCacheSize -= entry.size;
    }

    const cleanupTime = Date.now() - startTime;

    Logger.debug({} as any, 'Profanity cache: LRU cleanup completed', {
      initialEntries: initialSize,
      initialBytes,
      removedEntries: removedEntries.length,
      removedBytes: removedEntries.reduce((sum, [, entry]) => sum + entry.size, 0),
      finalEntries: this.cacheEntries.size,
      finalBytes: this.currentCacheSize,
      cleanupTime,
      efficiency: cleanupTime < 10 ? 'excellent' : cleanupTime < 50 ? 'good' : 'slow'
    });
  }

  private async performAIAnalysis(text: string, env: Env, aiProvider: AIProvider): Promise<ProfanityResult> {
    // Check if we should use batching
    if (ProfanityAnalyzer.BATCH_SIZE > 1) {
      return await this.performBatchAIAnalysis(text, env, aiProvider);
    }

    return await this.performSingleAIAnalysis(text, env, aiProvider);
  }

  private normalizeAnalysisResult(text: string, analysisResult: ProfanityAnalysisResult): ProfanityResult {
    const tokenCounts = countNormalizedProfanityTokens(text);
    const wordsByForm = new Map<string, ProfanityWord>();

    for (const rawWord of analysisResult.words || []) {
      const candidate = this.extractCandidateWord(rawWord);
      if (!candidate) {
        continue;
      }

      const normalizedWord = normalizeProfanityWord(candidate);
      if (!normalizedWord) {
        continue;
      }

      const count = tokenCounts.get(normalizedWord) || 0;
      if (count <= 0 || wordsByForm.has(normalizedWord)) {
        continue;
      }

      const baseForm = typeof rawWord.baseForm === 'string' && rawWord.baseForm.trim()
        ? rawWord.baseForm.trim()
        : normalizedWord;

      wordsByForm.set(normalizedWord, {
        original: candidate,
        word: normalizedWord,
        baseForm,
        positions: Array.from({ length: count }, (_, index) => index),
      });
    }

    const words = Array.from(wordsByForm.values());
    return {
      words,
      totalCount: words.reduce((sum, word) => sum + word.positions.length, 0),
    };
  }

  private extractCandidateWord(rawWord: ProfanityAnalysisResult['words'][number] | any): string | null {
    if (typeof rawWord === 'string') {
      return rawWord;
    }
    if (!rawWord || typeof rawWord !== 'object') {
      return null;
    }
    if (typeof rawWord.word === 'string' && rawWord.word.trim()) {
      return rawWord.word;
    }
    if (typeof rawWord.original === 'string' && rawWord.original.trim()) {
      return rawWord.original;
    }
    return null;
  }

  private async performSingleAIAnalysis(text: string, env: Env, aiProvider: AIProvider): Promise<ProfanityResult> {
    const startTime = Date.now();

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Analysis timeout')), ProfanityAnalyzer.ANALYSIS_TIMEOUT);
    });

    try {
      Logger.debug(env, 'Profanity AI analysis: starting with provider', {
        textLength: text.length,
        timeout: ProfanityAnalyzer.ANALYSIS_TIMEOUT,
        provider: aiProvider.getProviderInfo().name
      });

      // Race between AI analysis and timeout
      const analysisPromise = Promise.race([
        aiProvider.analyzeProfanity(text, env),
        timeoutPromise
      ]);

      const analysisResult = await analysisPromise;
      const finalResult = this.normalizeAnalysisResult(text, analysisResult);

      const duration = Date.now() - startTime;
      Logger.debug(env, 'Profanity AI analysis: completed via provider', {
        duration,
        provider: aiProvider.getProviderInfo().name,
        wordsFound: finalResult.totalCount,
        uniqueWords: finalResult.words.length,
        performanceRating: duration < 1000 ? 'excellent' : duration < 3000 ? 'good' : duration < 7000 ? 'acceptable' : 'slow',
        timeoutUtilization: (duration / ProfanityAnalyzer.ANALYSIS_TIMEOUT * 100).toFixed(1) + '%'
      });

      return finalResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      if (error instanceof Error && error.message === 'Analysis timeout') {
        Logger.error('Profanity AI analysis: timeout exceeded - this indicates AI API is slow or unavailable', {
          textLength: text.length,
          duration,
          provider: aiProvider.getProviderInfo().name,
          timeoutThreshold: ProfanityAnalyzer.ANALYSIS_TIMEOUT,
          circuitBreakerFailures: this.circuitBreakerState.failures,
          timeoutRatio: (duration / ProfanityAnalyzer.ANALYSIS_TIMEOUT * 100).toFixed(1) + '%',
          recommendation: 'Check AI provider status or increase timeout if this persists'
        });
      } else {
        Logger.error('Profanity AI analysis: failed via provider', {
          textLength: text.length,
          duration,
          provider: aiProvider.getProviderInfo().name,
          error: error instanceof Error ? error.message : String(error),
          circuitBreakerFailures: this.circuitBreakerState.failures
        });
      }
      throw error;
    }
  }

  private performBatchAIAnalysis(text: string, env: Env, aiProvider: AIProvider): Promise<ProfanityResult> {
    return new Promise((resolve, reject) => {
      const request: BatchRequest = {
        text,
        resolve,
        reject
      };

      this.batchQueue.push(request);

      // Start batch timeout if not already running
      if (!this.batchTimeout) {
        this.batchTimeout = setTimeout(() => {
          this.processBatch(env, aiProvider);
        }, ProfanityAnalyzer.BATCH_TIMEOUT);
      }

      // Process batch immediately if we've reached the batch size
      if (this.batchQueue.length >= ProfanityAnalyzer.BATCH_SIZE) {
        if (this.batchTimeout) {
          clearTimeout(this.batchTimeout);
          this.batchTimeout = null;
        }
        this.processBatch(env, aiProvider);
      }
    });
  }

  private async processBatch(env: Env, aiProvider: AIProvider): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const batch = this.batchQueue.splice(0, ProfanityAnalyzer.BATCH_SIZE);
    this.batchTimeout = null;

    try {
      Logger.log('Processing AI analysis batch via provider', {
        batchSize: batch.length,
        totalQueued: this.batchQueue.length,
        provider: aiProvider.getProviderInfo().name
      });

      // For batch processing, we'll process each text individually through the provider
      // This is simpler than trying to extend all providers to support batch analysis
      const results: ProfanityResult[] = [];

      for (let i = 0; i < batch.length; i++) {
        try {
          const analysisResult = await Promise.race([
            aiProvider.analyzeProfanity(batch[i].text, env),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('AI analysis timeout')), ProfanityAnalyzer.ANALYSIS_TIMEOUT)
            )
          ]);

          results.push(this.normalizeAnalysisResult(batch[i].text, analysisResult));
        } catch (error) {
          Logger.error('Batch item analysis failed', {
            itemIndex: i,
            textLength: batch[i].text.length,
            error: error instanceof Error ? error.message : String(error)
          });
          results.push({ words: [], totalCount: 0 });
        }
      }

      // Resolve all batch requests
      batch.forEach((request, index) => {
        request.resolve(results[index]);
      });

    } catch (error) {
      Logger.error('Batch AI analysis failed via provider', {
        error: error instanceof Error ? error.message : String(error),
        batchSize: batch.length,
        provider: aiProvider.getProviderInfo().name
      });
      // Reject all batch requests
      batch.forEach(request => request.reject(error));
    }
  }

  private findWordPositions(text: string, word: string): number[] {
    const startTime = Date.now();
    const positions: number[] = [];
    const lowerText = text.toLowerCase();
    const lowerWord = word.toLowerCase();

    let index = 0;
    let searchCount = 0;
    while ((index = lowerText.indexOf(lowerWord, index)) !== -1) {
      positions.push(index);
      index += lowerWord.length;
      searchCount++;

      // Prevent infinite loops in case of very short words
      if (searchCount > 100) {
        Logger.debug({} as any, 'Profanity analysis: word search limit reached', {
          word: word.substring(0, 3) + '***',
          searchCount,
          positionsFound: positions.length
        });
        break;
      }
    }

    const duration = Date.now() - startTime;

    if (duration > 5) { // Only log if search took more than 5ms
      Logger.debug({} as any, 'Profanity analysis: word position search performance', {
        word: word.substring(0, 3) + '***',
        textLength: text.length,
        wordLength: word.length,
        positionsFound: positions.length,
        searchIterations: searchCount,
        duration
      });
    }

    return positions;
  }
}
