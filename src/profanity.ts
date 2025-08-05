import { Env } from "./env";
import { Logger } from "./logger";
import { hashText } from "./utils";

// Core interfaces for profanity detection
export interface ProfanityWord {
  original: string;    // Найденное слово в тексте
  baseForm: string;    // Базовая форма для группировки
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
  private static readonly CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds
  private static readonly MAX_TEXT_LENGTH = 1000; // Limit analysis to first 1000 characters
  private static readonly ANALYSIS_TIMEOUT = 50; // 50ms timeout for analysis
  
  // Cache management
  private static readonly MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB max cache size
  private static readonly MAX_CACHE_ENTRIES = 10000; // Max 10k entries
  private static readonly CACHE_CLEANUP_THRESHOLD = 0.8; // Cleanup when 80% full
  
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
  private batchTimeout: NodeJS.Timeout | null = null;
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
  private counterBatchTimeout: NodeJS.Timeout | null = null;

  constructor() {}

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
    
    // Reset failure count if enough time has passed since last success
    if (now - previousLastSuccessTime > ProfanityAnalyzer.CIRCUIT_BREAKER_RESET_TIMEOUT) {
      const previousFailures = this.circuitBreakerState.failures;
      this.circuitBreakerState.failures = 0;
      
      if (previousFailures > 0) {
        Logger.log('Profanity circuit breaker: reset failure count after successful period', {
          previousFailures,
          resetTimeout: ProfanityAnalyzer.CIRCUIT_BREAKER_RESET_TIMEOUT,
          timeSinceLastSuccess: now - previousLastSuccessTime
        });
      }
    }
    
    if (wasOpen) {
      Logger.log('Profanity circuit breaker: circuit closed after successful request', {
        previousFailures: this.circuitBreakerState.failures,
        recoveryTime: now - this.circuitBreakerState.lastFailureTime
      });
    }
  }

  private recordAIFailure(): void {
    const now = Date.now();
    this.circuitBreakerState.failures++;
    this.circuitBreakerState.lastFailureTime = now;
    
    Logger.log('Profanity circuit breaker: recorded AI failure', {
      failureCount: this.circuitBreakerState.failures,
      threshold: ProfanityAnalyzer.CIRCUIT_BREAKER_FAILURE_THRESHOLD,
      willOpenCircuit: this.circuitBreakerState.failures >= ProfanityAnalyzer.CIRCUIT_BREAKER_FAILURE_THRESHOLD
    });
  }

  async analyzeMessage(text: string, env: Env): Promise<ProfanityResult> {
    const startTime = Date.now();
    const textLength = text.length;
    const timings: Record<string, number> = {};
    
    try {
      Logger.debug(env, 'Profanity analysis: detailed process started', {
        textLength,
        truncated: textLength > ProfanityAnalyzer.MAX_TEXT_LENGTH,
        maxLength: ProfanityAnalyzer.MAX_TEXT_LENGTH,
        timeout: ProfanityAnalyzer.ANALYSIS_TIMEOUT,
        cacheEnabled: true,
        cacheTTL: ProfanityAnalyzer.CACHE_TTL,
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
        keyLength: cacheKey.length,
        generationTime: timings.cacheKeyGeneration
      });
      
      // Try to get from cache first
      const cacheRetrievalStart = Date.now();
      const cachedResult = await this.getCachedResult(cacheKey, env);
      timings.cacheRetrieval = Date.now() - cacheRetrievalStart;
      
      if (cachedResult) {
        const totalDuration = Date.now() - startTime;
        Logger.debug(env, 'Profanity analysis: cache hit with detailed timing', { 
          cacheKey: cacheKey.substring(0, 20) + '...', 
          totalDuration,
          timings,
          wordsFound: cachedResult.totalCount,
          cacheEfficiency: 'high',
          memoryCacheStats: {
            entries: this.cacheEntries.size,
            size: this.currentCacheSize
          }
        });
        Logger.log('Profanity detection event: cache hit', {
          wordsFound: cachedResult.totalCount,
          duration: totalDuration,
          cacheRetrievalTime: timings.cacheRetrieval,
          fromMemory: this.cacheEntries.has(cacheKey)
        });
        return cachedResult;
      }

      Logger.debug(env, 'Profanity analysis: cache miss, proceeding with AI analysis', {
        cacheKey: cacheKey.substring(0, 20) + '...',
        cacheRetrievalTime: timings.cacheRetrieval
      });

      // Check circuit breaker before AI analysis
      if (this.isCircuitBreakerOpen()) {
        Logger.log('Profanity analysis: skipped due to circuit breaker', {
          failureCount: this.circuitBreakerState.failures,
          timeSinceLastFailure: Date.now() - this.circuitBreakerState.lastFailureTime,
          circuitTimeout: ProfanityAnalyzer.CIRCUIT_BREAKER_TIMEOUT
        });
        
        // Return empty result when circuit is open
        return {
          words: [],
          totalCount: 0
        };
      }

      // Perform AI analysis with timeout and batching
      const aiAnalysisStart = Date.now();
      const analysisResult = await this.performAIAnalysis(limitedText, env);
      timings.aiAnalysis = Date.now() - aiAnalysisStart;
      
      // Record successful AI analysis
      this.recordAISuccess();
      
      // Convert AI result to our format
      const conversionStart = Date.now();
      const profanityResult = this.convertAIResult(analysisResult, limitedText);
      timings.resultConversion = Date.now() - conversionStart;
      
      // Cache the result
      const cacheStorageStart = Date.now();
      await this.cacheResult(cacheKey, profanityResult, env);
      timings.cacheStorage = Date.now() - cacheStorageStart;
      
      const totalDuration = Date.now() - startTime;
      timings.total = totalDuration;
      
      Logger.debug(env, 'Profanity analysis: completed with detailed performance metrics', {
        textLength: limitedText.length,
        wordsFound: profanityResult.totalCount,
        uniqueWords: profanityResult.words.length,
        cacheKey: cacheKey.substring(0, 20) + '...',
        timings,
        memoryCacheStats: {
          entries: this.cacheEntries.size,
          size: this.currentCacheSize
        },
        performanceBreakdown: {
          textProcessing: ((timings.textLimiting + timings.cacheKeyGeneration) / totalDuration * 100).toFixed(1) + '%',
          cacheOperations: ((timings.cacheRetrieval + timings.cacheStorage) / totalDuration * 100).toFixed(1) + '%',
          aiAnalysis: (timings.aiAnalysis / totalDuration * 100).toFixed(1) + '%',
          resultProcessing: (timings.resultConversion / totalDuration * 100).toFixed(1) + '%'
        }
      });

      Logger.log('Profanity detection event: analysis completed', {
        wordsFound: profanityResult.totalCount,
        uniqueWords: profanityResult.words.length,
        duration: totalDuration,
        fromCache: false,
        aiAnalysisTime: timings.aiAnalysis,
        conversionTime: timings.resultConversion,
        memoryCacheStats: {
          entries: this.cacheEntries.size,
          size: this.currentCacheSize
        }
      });
      
      return profanityResult;
      
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      timings.total = totalDuration;
      
      // Record AI failure if error occurred during AI analysis phase
      const errorPhase = this.determineErrorPhase(timings);
      if (errorPhase === 'ai-analysis') {
        this.recordAIFailure();
      }
      
      Logger.error('Profanity analysis: failed with detailed error context', {
        textLength,
        duration: totalDuration,
        timings,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorPhase,
        partialTimings: timings,
        circuitBreakerState: {
          failures: this.circuitBreakerState.failures,
          isOpen: this.circuitBreakerState.isOpen,
          timeSinceLastFailure: Date.now() - this.circuitBreakerState.lastFailureTime
        },
        memoryCacheStats: {
          entries: this.cacheEntries.size,
          size: this.currentCacheSize
        }
      });
      
      // Return empty result on error to not block message processing
      return {
        words: [],
        totalCount: 0
      };
    }
  }

  private determineErrorPhase(timings: Record<string, number>): string {
    // If we have cache retrieval timing, we got past cache check
    if (timings.cacheRetrieval !== undefined) {
      // If we don't have AI analysis timing, error occurred during AI analysis
      if (timings.aiAnalysis === undefined) {
        return 'ai-analysis';
      }
      // If we have AI analysis timing, error occurred after AI analysis
      return 'result-processing';
    }
    if (timings.textLimiting !== undefined) return 'text-processing';
    return 'initialization';
  }

  private limitTextLength(text: string): string {
    if (text.length <= ProfanityAnalyzer.MAX_TEXT_LENGTH) {
      return text;
    }
    
    // Truncate to max length, trying to break at word boundaries
    const truncated = text.substring(0, ProfanityAnalyzer.MAX_TEXT_LENGTH);
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    
    const result = lastSpaceIndex > ProfanityAnalyzer.MAX_TEXT_LENGTH * 0.8 
      ? truncated.substring(0, lastSpaceIndex)
      : truncated;
    
    Logger.debug({} as any, 'Profanity analysis: text length limiting', {
      originalLength: text.length,
      maxLength: ProfanityAnalyzer.MAX_TEXT_LENGTH,
      truncatedLength: result.length,
      wordBoundaryUsed: lastSpaceIndex > ProfanityAnalyzer.MAX_TEXT_LENGTH * 0.8,
      lastSpaceIndex
    });
    
    return result;
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
          reason: 'key-not-found'
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
    const storageStart = Date.now();
    
    try {
      const serializedResult = JSON.stringify(result);
      const serializationTime = Date.now() - storageStart;
      
      // Store in KV storage
      const putStart = Date.now();
      await env.COUNTERS.put(
        cacheKey, 
        serializedResult, 
        { expirationTtl: ProfanityAnalyzer.CACHE_TTL }
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
        ttl: ProfanityAnalyzer.CACHE_TTL,
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

  private async performAIAnalysis(text: string, env: Env): Promise<ProfanityResult> {
    // Check if we should use batching
    if (ProfanityAnalyzer.BATCH_SIZE > 1) {
      return await this.performBatchAIAnalysis(text, env);
    }

    return await this.performSingleAIAnalysis(text, env);
  }

  private async performSingleAIAnalysis(text: string, env: Env): Promise<ProfanityResult> {
    const startTime = Date.now();
    
    const prompt = `Analyze the following text for profanity and inappropriate language. Return a JSON object with:
1. "words": an array of objects, each containing:
   - "word": the profane word found
   - "severity": severity level ("low", "medium", "high")
   - "category": category of profanity ("general", "sexual", "violence", "discriminatory", "religious")
   - "position": character position in the text
2. "totalCount": total number of profane words found

Text: "${text}"

Example response format:
{
  "words": [
    {"word": "damn", "severity": "low", "category": "general", "position": 15}
  ],
  "totalCount": 1
}

If no profanity is found, return {"words": [], "totalCount": 0}. Only include actual profanity, not mild language or common expressions. Be accurate and conservative in detection.`;

    const messages = [
      { role: 'system' as const, content: 'You are a profanity detection system. Analyze text and return structured JSON data about any profanity found. Be accurate and conservative in detection.' },
      { role: 'user' as const, content: prompt }
    ];

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Analysis timeout')), ProfanityAnalyzer.ANALYSIS_TIMEOUT);
    });

    try {
      Logger.debug(env, 'Profanity AI analysis: starting', {
        textLength: text.length,
        timeout: ProfanityAnalyzer.ANALYSIS_TIMEOUT
      });

      // Race between AI analysis and timeout
      const analysisPromise = Promise.race([
        env.AI.run('@cf/meta/llama-2-7b-chat-int8', { messages }),
        timeoutPromise
      ]);

      const response = await analysisPromise;
      
      if (!response || typeof response.response !== 'string') {
        throw new Error('Invalid AI response format');
      }

      const result = JSON.parse(response.response);
      if (!result || !Array.isArray(result.words) || typeof result.totalCount !== 'number') {
        throw new Error('Invalid response structure');
      }

      // Convert to ProfanityWord format
      const profanityWords: ProfanityWord[] = result.words.map((word: any) => ({
        original: word.word,
        baseForm: word.word, // For now, use word as base form
        positions: [word.position || 0]
      }));

      const finalResult: ProfanityResult = {
        words: profanityWords,
        totalCount: result.totalCount
      };
      
      const duration = Date.now() - startTime;
      Logger.debug(env, 'Profanity AI analysis: completed', {
        duration,
        wordsFound: finalResult.totalCount,
        uniqueWords: finalResult.words.length
      });
      
      return finalResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      if (error instanceof Error && error.message === 'Analysis timeout') {
        Logger.error('Profanity AI analysis: timeout', { 
          textLength: text.length, 
          duration,
          timeout: ProfanityAnalyzer.ANALYSIS_TIMEOUT,
          circuitBreakerFailures: this.circuitBreakerState.failures
        });
      } else {
        Logger.error('Profanity AI analysis: failed', {
          textLength: text.length,
          duration,
          error: error instanceof Error ? error.message : String(error),
          circuitBreakerFailures: this.circuitBreakerState.failures
        });
      }
      throw error;
    }
  }

  private performBatchAIAnalysis(text: string, env: Env): Promise<ProfanityResult> {
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
          this.processBatch(env);
        }, ProfanityAnalyzer.BATCH_TIMEOUT);
      }

      // Process batch immediately if we've reached the batch size
      if (this.batchQueue.length >= ProfanityAnalyzer.BATCH_SIZE) {
        if (this.batchTimeout) {
          clearTimeout(this.batchTimeout);
          this.batchTimeout = null;
        }
        this.processBatch(env);
      }
    });
  }

  private async processBatch(env: Env): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const batch = this.batchQueue.splice(0, ProfanityAnalyzer.BATCH_SIZE);
    this.batchTimeout = null;

    try {
      Logger.log('Processing AI analysis batch', {
        batchSize: batch.length,
        totalQueued: this.batchQueue.length
      });

      const batchPrompt = `Analyze the following texts for profanity and inappropriate language. Return a JSON array where each element corresponds to one text input. Each element should have:
1. "words": an array of objects, each containing:
   - "word": the profane word found
   - "severity": severity level ("low", "medium", "high")
   - "category": category of profanity ("general", "sexual", "violence", "discriminatory", "religious")
   - "position": character position in the text
2. "totalCount": total number of profane words found

Texts to analyze (separated by [TEXT_SEPARATOR]):
${batch.map((req, index) => `[TEXT_${index}]: "${req.text}"`).join('\n[TEXT_SEPARATOR]\n')}

Example response format:
[
  {
    "words": [
      {"word": "damn", "severity": "low", "category": "general", "position": 15}
    ],
    "totalCount": 1
  },
  {
    "words": [],
    "totalCount": 0
  }
]

If no profanity is found in a text, return {"words": [], "totalCount": 0}. Only include actual profanity, not mild language or common expressions. Be accurate and conservative in detection.`;

      const messages = [
        { role: 'system' as const, content: 'You are a profanity detection system. Analyze multiple texts and return structured JSON data about any profanity found. Be accurate and conservative in detection.' },
        { role: 'user' as const, content: batchPrompt }
      ];

      const response = await Promise.race([
        env.AI.run('@cf/meta/llama-2-7b-chat-int8', { messages }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('AI analysis timeout')), ProfanityAnalyzer.ANALYSIS_TIMEOUT)
        )
      ]);

      if (!response || typeof response.response !== 'string') {
        throw new Error('Invalid AI response format');
      }

      const results = JSON.parse(response.response);
      if (!Array.isArray(results) || results.length !== batch.length) {
        throw new Error('Invalid batch response structure');
      }

      // Resolve all batch requests
      batch.forEach((request, index) => {
        const result = results[index];
        if (result && Array.isArray(result.words) && typeof result.totalCount === 'number') {
          // Convert to ProfanityWord format
          const profanityWords: ProfanityWord[] = result.words.map((word: any) => ({
            original: word.word,
            baseForm: word.word, // For now, use word as base form
            positions: [word.position || 0]
          }));
          
          request.resolve({
            words: profanityWords,
            totalCount: result.totalCount
          });
        } else {
          request.reject(new Error('Invalid result format for batch item'));
        }
      });

    } catch (error) {
      Logger.error('Batch AI analysis failed', { error, batchSize: batch.length });
      // Reject all batch requests
      batch.forEach(request => request.reject(error));
    }
  }

  private async callAIProvider(text: string, env: Env): Promise<ProfanityAnalysisResult> {
    try {
      Logger.debug(env, 'Profanity AI provider: calling', {
        provider: this.aiProvider.constructor.name,
        textLength: text.length
      });
      
      const result = await this.aiProvider.analyzeProfanity(text, env);
      
      Logger.debug(env, 'Profanity AI provider: success', {
        provider: this.aiProvider.constructor.name,
        hasProfanity: result.hasProfanity,
        wordsFound: result.words.length
      });
      
      return result;
    } catch (error) {
      Logger.error('Profanity AI provider: failed', {
        provider: this.aiProvider.constructor.name,
        textLength: text.length,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  private convertAIResult(aiResult: ProfanityAnalysisResult, originalText: string): ProfanityResult {
    const startTime = Date.now();
    const words: ProfanityWord[] = [];
    
    Logger.debug({} as any, 'Profanity analysis: converting AI result', {
      aiWordsCount: aiResult.words.length,
      hasProfanity: aiResult.hasProfanity,
      textLength: originalText.length
    });
    
    for (const aiWord of aiResult.words) {
      // Find positions of the word in the original text
      const positions = this.findWordPositions(originalText, aiWord.word);
      
      Logger.debug({} as any, 'Profanity analysis: word position search', {
        word: aiWord.word.substring(0, 3) + '***', // Censor in debug logs
        baseForm: aiWord.baseForm.substring(0, 3) + '***',
        confidence: aiWord.confidence,
        positionsFound: positions.length,
        positions: positions.slice(0, 5) // Limit positions in debug log
      });
      
      if (positions.length > 0) {
        words.push({
          original: aiWord.word,
          baseForm: aiWord.baseForm,
          positions
        });
      }
    }
    
    const totalCount = words.reduce((sum, word) => sum + word.positions.length, 0);
    const duration = Date.now() - startTime;
    
    Logger.debug({} as any, 'Profanity analysis: AI result conversion completed', {
      duration,
      inputWordsCount: aiResult.words.length,
      outputWordsCount: words.length,
      totalOccurrences: totalCount,
      wordsWithPositions: words.map(w => ({
        baseForm: w.baseForm.substring(0, 3) + '***',
        occurrences: w.positions.length
      }))
    });
    
    return {
      words,
      totalCount
    };
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