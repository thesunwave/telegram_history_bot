import { Env } from "./env";
import { Logger } from "./logger";
import { AIProvider, ProviderError } from "./providers/ai-provider";
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

export interface ProfanityAnalysisResult {
  hasProfanity: boolean;
  words: Array<{
    word: string;
    baseForm: string;
    confidence: number;
  }>;
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
    try {
      // Limit text length for performance
      const limitedText = this.limitTextLength(text);
      
      // Generate cache key
      const cacheKey = generateCacheKey(limitedText);
      
      // Try to get from cache first
      const cachedResult = await this.getCachedResult(cacheKey, env);
      if (cachedResult) {
        Logger.debug(env, 'Profanity analysis: cache hit', { cacheKey });
        return cachedResult;
      }

      // Perform AI analysis with timeout
      const analysisResult = await this.performAIAnalysis(limitedText, env);
      
      // Convert AI result to our format
      const profanityResult = this.convertAIResult(analysisResult, limitedText);
      
      // Cache the result
      await this.cacheResult(cacheKey, profanityResult, env);
      
      Logger.debug(env, 'Profanity analysis completed', {
        textLength: limitedText.length,
        wordsFound: profanityResult.totalCount,
        cacheKey
      });
      
      return profanityResult;
      
    } catch (error) {
      Logger.error('Profanity analysis failed', error);
      
      // Return empty result on error to not block message processing
      return {
        words: [],
        totalCount: 0
      };
    }
  }

  private limitTextLength(text: string): string {
    if (text.length <= ProfanityAnalyzer.MAX_TEXT_LENGTH) {
      return text;
    }
    
    // Truncate to max length, trying to break at word boundaries
    const truncated = text.substring(0, ProfanityAnalyzer.MAX_TEXT_LENGTH);
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    
    if (lastSpaceIndex > ProfanityAnalyzer.MAX_TEXT_LENGTH * 0.8) {
      return truncated.substring(0, lastSpaceIndex);
    }
    
    return truncated;
  }

  private async getCachedResult(cacheKey: string, env: Env): Promise<ProfanityResult | null> {
    try {
      const cached = await env.COUNTERS.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as ProfanityResult;
      }
    } catch (error) {
      Logger.debug(env, 'Cache retrieval failed', { cacheKey, error });
    }
    return null;
  }

  private async cacheResult(cacheKey: string, result: ProfanityResult, env: Env): Promise<void> {
    try {
      await env.COUNTERS.put(
        cacheKey, 
        JSON.stringify(result), 
        { expirationTtl: ProfanityAnalyzer.CACHE_TTL }
      );
    } catch (error) {
      Logger.debug(env, 'Cache storage failed', { cacheKey, error });
    }
  }

  private async performAIAnalysis(text: string, env: Env): Promise<ProfanityAnalysisResult> {
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Analysis timeout')), ProfanityAnalyzer.ANALYSIS_TIMEOUT);
    });

    try {
      // Race between AI analysis and timeout
      const analysisPromise = this.callAIProvider(text, env);
      const result = await Promise.race([analysisPromise, timeoutPromise]);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'Analysis timeout') {
        Logger.debug(env, 'Profanity analysis timed out', { textLength: text.length });
      }
      throw error;
    }
  }

  private async callAIProvider(text: string, env: Env): Promise<ProfanityAnalysisResult> {
    // This will be implemented in the next task when we extend AI providers
    // For now, return a placeholder implementation
    throw new Error('AI provider integration not yet implemented');
  }

  private convertAIResult(aiResult: ProfanityAnalysisResult, originalText: string): ProfanityResult {
    const words: ProfanityWord[] = [];
    
    for (const aiWord of aiResult.words) {
      // Find positions of the word in the original text
      const positions = this.findWordPositions(originalText, aiWord.word);
      
      if (positions.length > 0) {
        words.push({
          original: aiWord.word,
          baseForm: aiWord.baseForm,
          positions
        });
      }
    }
    
    return {
      words,
      totalCount: words.reduce((sum, word) => sum + word.positions.length, 0)
    };
  }

  private findWordPositions(text: string, word: string): number[] {
    const positions: number[] = [];
    const lowerText = text.toLowerCase();
    const lowerWord = word.toLowerCase();
    
    let index = 0;
    while ((index = lowerText.indexOf(lowerWord, index)) !== -1) {
      positions.push(index);
      index += lowerWord.length;
    }
    
    return positions;
  }
}