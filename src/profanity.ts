import { Env } from "./env";
import { Logger } from "./logger";
import { AIProvider, ProfanityAnalysisResult } from "./providers/ai-provider";
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

// Main profanity analyzer class
export class ProfanityAnalyzer {
  private static readonly CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds
  private static readonly MAX_TEXT_LENGTH = 1000; // Limit analysis to first 1000 characters
  private static readonly ANALYSIS_TIMEOUT = 50; // 50ms timeout for analysis

  constructor(private aiProvider: AIProvider) {}

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
        cacheTTL: ProfanityAnalyzer.CACHE_TTL
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
          cacheEfficiency: 'high'
        });
        Logger.log('Profanity detection event: cache hit', {
          wordsFound: cachedResult.totalCount,
          duration: totalDuration,
          cacheRetrievalTime: timings.cacheRetrieval
        });
        return cachedResult;
      }

      Logger.debug(env, 'Profanity analysis: cache miss, proceeding with AI analysis', {
        cacheKey: cacheKey.substring(0, 20) + '...',
        cacheRetrievalTime: timings.cacheRetrieval
      });

      // Perform AI analysis with timeout
      const aiAnalysisStart = Date.now();
      const analysisResult = await this.performAIAnalysis(limitedText, env);
      timings.aiAnalysis = Date.now() - aiAnalysisStart;
      
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
        conversionTime: timings.resultConversion
      });
      
      return profanityResult;
      
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      timings.total = totalDuration;
      
      Logger.error('Profanity analysis: failed with detailed error context', {
        textLength,
        duration: totalDuration,
        timings,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorPhase: this.determineErrorPhase(timings),
        partialTimings: timings
      });
      
      // Return empty result on error to not block message processing
      return {
        words: [],
        totalCount: 0
      };
    }
  }

  private determineErrorPhase(timings: Record<string, number>): string {
    if (timings.aiAnalysis) return 'ai-analysis';
    if (timings.cacheRetrieval) return 'cache-retrieval';
    if (timings.textLimiting) return 'text-processing';
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
      
      const putStart = Date.now();
      await env.COUNTERS.put(
        cacheKey, 
        serializedResult, 
        { expirationTtl: ProfanityAnalyzer.CACHE_TTL }
      );
      const putTime = Date.now() - putStart;
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
        storageEfficiency: totalStorageTime < 20 ? 'excellent' : totalStorageTime < 100 ? 'good' : 'slow'
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

  private async performAIAnalysis(text: string, env: Env): Promise<ProfanityAnalysisResult> {
    const startTime = Date.now();
    
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
      const analysisPromise = this.callAIProvider(text, env);
      const result = await Promise.race([analysisPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      Logger.debug(env, 'Profanity AI analysis: completed', {
        duration,
        wordsFound: result.words.length,
        hasProfanity: result.hasProfanity
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      if (error instanceof Error && error.message === 'Analysis timeout') {
        Logger.error('Profanity AI analysis: timeout', { 
          textLength: text.length, 
          duration,
          timeout: ProfanityAnalyzer.ANALYSIS_TIMEOUT
        });
      } else {
        Logger.error('Profanity AI analysis: failed', {
          textLength: text.length,
          duration,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
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