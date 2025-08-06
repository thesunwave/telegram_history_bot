/**
 * Context Optimizer for managing token usage and message chunking
 * 
 * This module provides functionality to:
 * - Estimate token count in messages
 * - Optimize messages to fit within context limits
 * - Create optimal chunks for hierarchical processing
 */

import { TelegramMessage } from '../providers/ai-provider';
import { SummaryOptimizationConfig } from './types';
import { Logger } from '../logger';

export interface TokenEstimation {
  totalTokens: number;
  messageTokens: number[];
  averageTokensPerMessage: number;
  maxTokensInMessage: number;
}

export interface OptimizationResult {
  optimizedMessages: TelegramMessage[];
  removedCount: number;
  tokensSaved: number;
  strategy: 'none' | 'truncate_oldest' | 'truncate_newest' | 'remove_short' | 'smart_sampling';
}

export interface ChunkingResult {
  chunks: TelegramMessage[][];
  totalChunks: number;
  averageTokensPerChunk: number;
  maxTokensInChunk: number;
  metadata: {
    originalMessageCount: number;
    totalTokens: number;
    chunkingStrategy: 'sequential' | 'balanced' | 'priority_based';
  };
}

export class ContextOptimizer {
  private config: SummaryOptimizationConfig;
  
  constructor(config: SummaryOptimizationConfig) {
    this.config = config;
  }

  /**
   * Estimates the number of tokens in a collection of messages
   * Uses a heuristic approach based on character count and message structure
   */
  estimateTokens(messages: TelegramMessage[]): number {
    if (!messages || messages.length === 0) {
      return 0;
    }

    let totalTokens = 0;
    
    for (const message of messages) {
      totalTokens += this.estimateMessageTokens(message);
    }

    // Apply estimation factor from config to account for prompt overhead
    const adjustedTokens = Math.round(totalTokens * this.config.contextManagement.tokenEstimationFactor);
    
    return adjustedTokens;
  }

  /**
   * Provides detailed token estimation with per-message breakdown
   */
  estimateTokensDetailed(messages: TelegramMessage[]): TokenEstimation {
    if (!messages || messages.length === 0) {
      return {
        totalTokens: 0,
        messageTokens: [],
        averageTokensPerMessage: 0,
        maxTokensInMessage: 0
      };
    }

    const messageTokens = messages.map(msg => this.estimateMessageTokens(msg));
    const totalTokens = messageTokens.reduce((sum, tokens) => sum + tokens, 0);
    const adjustedTotal = Math.round(totalTokens * this.config.contextManagement.tokenEstimationFactor);
    
    return {
      totalTokens: adjustedTotal,
      messageTokens,
      averageTokensPerMessage: totalTokens / messages.length,
      maxTokensInMessage: Math.max(...messageTokens)
    };
  }

  /**
   * Optimizes messages to fit within the specified token limit
   * Uses various strategies to reduce token count while preserving important content
   */
  optimizeForContext(messages: TelegramMessage[], maxTokens: number): TelegramMessage[] {
    if (!messages || messages.length === 0) {
      return [];
    }

    const currentTokens = this.estimateTokens(messages);
    
    if (currentTokens <= maxTokens) {
      return messages; // No optimization needed
    }

    // Try different optimization strategies in order of preference
    const strategies: Array<(msgs: TelegramMessage[], target: number) => OptimizationResult> = [
      this.removeShortMessages.bind(this),
      this.truncateOldestMessages.bind(this),
      this.smartSampling.bind(this),
      this.truncateNewestMessages.bind(this)
    ];

    let optimizedMessages = [...messages];
    let bestResult: OptimizationResult | null = null;

    for (const strategy of strategies) {
      const result = strategy(optimizedMessages, maxTokens);
      const resultTokens = this.estimateTokens(result.optimizedMessages);
      
      if (resultTokens <= maxTokens) {
        bestResult = result;
        break;
      }
    }

    if (!bestResult) {
      // Fallback: aggressive truncation to fit within limits
      bestResult = this.aggressiveTruncation(messages, maxTokens);
    }

    return bestResult.optimizedMessages;
  }

  /**
   * Creates optimal chunks for hierarchical processing
   * Balances chunk sizes while respecting message boundaries
   */
  createOptimalChunks(messages: TelegramMessage[], maxTokens: number): TelegramMessage[][] {
    if (!messages || messages.length === 0) {
      return [];
    }

    const chunks: TelegramMessage[][] = [];
    let currentChunk: TelegramMessage[] = [];
    let currentChunkTokens = 0;

    // Reserve some tokens for prompt overhead
    const effectiveMaxTokens = Math.floor(maxTokens * 0.9);

    for (const message of messages) {
      const messageTokens = this.estimateMessageTokens(message);
      
      // If adding this message would exceed the limit, start a new chunk
      if (currentChunkTokens + messageTokens > effectiveMaxTokens && currentChunk.length > 0) {
        chunks.push([...currentChunk]);
        currentChunk = [message];
        currentChunkTokens = messageTokens;
      } else {
        currentChunk.push(message);
        currentChunkTokens += messageTokens;
      }
    }

    // Add the last chunk if it has messages
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    // If we have too many chunks, try to balance them
    if (chunks.length > this.config.hierarchicalProcessing.maxPreprocessingChunks) {
      return this.balanceChunks(chunks, maxTokens);
    }

    return chunks;
  }

  /**
   * Creates chunks with detailed metadata for analysis
   */
  createOptimalChunksDetailed(messages: TelegramMessage[], maxTokens: number): ChunkingResult {
    const chunks = this.createOptimalChunks(messages, maxTokens);
    
    if (chunks.length === 0) {
      return {
        chunks: [],
        totalChunks: 0,
        averageTokensPerChunk: 0,
        maxTokensInChunk: 0,
        metadata: {
          originalMessageCount: messages.length,
          totalTokens: this.estimateTokens(messages),
          chunkingStrategy: 'sequential'
        }
      };
    }

    const chunkTokens = chunks.map(chunk => this.estimateTokens(chunk));
    const totalTokens = this.estimateTokens(messages);
    
    return {
      chunks,
      totalChunks: chunks.length,
      averageTokensPerChunk: chunkTokens.reduce((sum, tokens) => sum + tokens, 0) / chunks.length,
      maxTokensInChunk: Math.max(...chunkTokens),
      metadata: {
        originalMessageCount: messages.length,
        totalTokens,
        chunkingStrategy: chunks.length > this.config.hierarchicalProcessing.maxPreprocessingChunks ? 'balanced' : 'sequential'
      }
    };
  }

  /**
   * Estimates tokens for a single message
   * Uses character-based heuristics with adjustments for username and timestamp
   */
  private estimateMessageTokens(message: TelegramMessage): number {
    if (!message.text) {
      return 5; // Minimal tokens for username and timestamp
    }

    // Base estimation: ~4 characters per token for Russian text
    const textTokens = Math.ceil(message.text.length / 4);
    
    // Add tokens for username (typically 1-3 tokens)
    const usernameTokens = Math.ceil(message.username.length / 4) + 1;
    
    // Add tokens for timestamp formatting (typically 2-3 tokens)
    const timestampTokens = 3;
    
    // Add tokens for message structure/formatting
    const structureTokens = 2;
    
    return textTokens + usernameTokens + timestampTokens + structureTokens;
  }

  /**
   * Removes short messages that contribute little to context
   */
  private removeShortMessages(messages: TelegramMessage[], maxTokens: number): OptimizationResult {
    const shortMessageThreshold = 10; // Remove messages shorter than 10 characters
    const originalTokens = this.estimateTokens(messages);
    
    const filteredMessages = messages.filter(msg => 
      msg.text && msg.text.length >= shortMessageThreshold
    );
    
    const newTokens = this.estimateTokens(filteredMessages);
    
    return {
      optimizedMessages: filteredMessages,
      removedCount: messages.length - filteredMessages.length,
      tokensSaved: originalTokens - newTokens,
      strategy: 'remove_short'
    };
  }

  /**
   * Truncates oldest messages to fit within token limit
   */
  private truncateOldestMessages(messages: TelegramMessage[], maxTokens: number): OptimizationResult {
    const sortedMessages = [...messages].sort((a, b) => b.ts - a.ts); // Newest first
    const originalTokens = this.estimateTokens(messages);
    
    let currentTokens = 0;
    const keptMessages: TelegramMessage[] = [];
    
    for (const message of sortedMessages) {
      const messageTokens = this.estimateMessageTokens(message);
      if (currentTokens + messageTokens <= maxTokens) {
        keptMessages.push(message);
        currentTokens += messageTokens;
      } else {
        break;
      }
    }
    
    // Sort back to chronological order
    const finalMessages = keptMessages.sort((a, b) => a.ts - b.ts);
    
    return {
      optimizedMessages: finalMessages,
      removedCount: messages.length - finalMessages.length,
      tokensSaved: originalTokens - currentTokens,
      strategy: 'truncate_oldest'
    };
  }

  /**
   * Truncates newest messages to fit within token limit
   */
  private truncateNewestMessages(messages: TelegramMessage[], maxTokens: number): OptimizationResult {
    const sortedMessages = [...messages].sort((a, b) => a.ts - b.ts); // Oldest first
    const originalTokens = this.estimateTokens(messages);
    
    let currentTokens = 0;
    const keptMessages: TelegramMessage[] = [];
    
    for (const message of sortedMessages) {
      const messageTokens = this.estimateMessageTokens(message);
      if (currentTokens + messageTokens <= maxTokens) {
        keptMessages.push(message);
        currentTokens += messageTokens;
      } else {
        break;
      }
    }
    
    return {
      optimizedMessages: keptMessages,
      removedCount: messages.length - keptMessages.length,
      tokensSaved: originalTokens - currentTokens,
      strategy: 'truncate_newest'
    };
  }

  /**
   * Smart sampling that preserves message distribution across time
   */
  private smartSampling(messages: TelegramMessage[], maxTokens: number): OptimizationResult {
    if (messages.length === 0) {
      return {
        optimizedMessages: [],
        removedCount: 0,
        tokensSaved: 0,
        strategy: 'smart_sampling'
      };
    }

    const originalTokens = this.estimateTokens(messages);
    const targetRatio = maxTokens / originalTokens;
    
    if (targetRatio >= 1) {
      return {
        optimizedMessages: messages,
        removedCount: 0,
        tokensSaved: 0,
        strategy: 'none'
      };
    }

    // Sort messages by timestamp
    const sortedMessages = [...messages].sort((a, b) => a.ts - b.ts);
    
    // Calculate sampling interval
    const samplingInterval = Math.ceil(1 / targetRatio);
    
    const sampledMessages: TelegramMessage[] = [];
    for (let i = 0; i < sortedMessages.length; i += samplingInterval) {
      sampledMessages.push(sortedMessages[i]);
    }
    
    // If we still have too many tokens, fall back to truncation
    const sampledTokens = this.estimateTokens(sampledMessages);
    if (sampledTokens > maxTokens) {
      return this.truncateOldestMessages(sampledMessages, maxTokens);
    }
    
    return {
      optimizedMessages: sampledMessages,
      removedCount: messages.length - sampledMessages.length,
      tokensSaved: originalTokens - sampledTokens,
      strategy: 'smart_sampling'
    };
  }

  /**
   * Aggressive truncation as a last resort
   */
  private aggressiveTruncation(messages: TelegramMessage[], maxTokens: number): OptimizationResult {
    const originalTokens = this.estimateTokens(messages);
    
    // Take only the most recent messages that fit
    const sortedMessages = [...messages].sort((a, b) => b.ts - a.ts);
    
    let currentTokens = 0;
    const keptMessages: TelegramMessage[] = [];
    
    for (const message of sortedMessages) {
      const messageTokens = this.estimateMessageTokens(message);
      if (currentTokens + messageTokens <= maxTokens * 0.8) { // Leave some buffer
        keptMessages.push(message);
        currentTokens += messageTokens;
      }
    }
    
    // Sort back to chronological order
    const finalMessages = keptMessages.sort((a, b) => a.ts - b.ts);
    
    return {
      optimizedMessages: finalMessages,
      removedCount: messages.length - finalMessages.length,
      tokensSaved: originalTokens - currentTokens,
      strategy: 'truncate_oldest'
    };
  }

  /**
   * Balances chunks when there are too many
   */
  private balanceChunks(chunks: TelegramMessage[][], maxTokens: number): TelegramMessage[][] {
    const maxChunks = this.config.hierarchicalProcessing.maxPreprocessingChunks;
    
    if (chunks.length <= maxChunks) {
      return chunks;
    }

    // Merge chunks to reduce total count
    const balancedChunks: TelegramMessage[][] = [];
    const chunksPerGroup = Math.ceil(chunks.length / maxChunks);
    
    for (let i = 0; i < chunks.length; i += chunksPerGroup) {
      const groupChunks = chunks.slice(i, i + chunksPerGroup);
      const mergedChunk = groupChunks.flat();
      
      // If merged chunk is too large, split it but limit the number of sub-chunks
      if (this.estimateTokens(mergedChunk) > maxTokens) {
        const subChunks = this.createSequentialChunks(mergedChunk, maxTokens);
        balancedChunks.push(...subChunks);
      } else {
        balancedChunks.push(mergedChunk);
      }
    }
    
    // If we still have too many chunks, take only the first maxChunks
    if (balancedChunks.length > maxChunks) {
      return balancedChunks.slice(0, maxChunks);
    }
    
    return balancedChunks;
  }

  /**
   * Creates sequential chunks without recursive balancing
   */
  private createSequentialChunks(messages: TelegramMessage[], maxTokens: number): TelegramMessage[][] {
    const chunks: TelegramMessage[][] = [];
    let currentChunk: TelegramMessage[] = [];
    let currentChunkTokens = 0;

    // Reserve some tokens for prompt overhead
    const effectiveMaxTokens = Math.floor(maxTokens * 0.9);

    for (const message of messages) {
      const messageTokens = this.estimateMessageTokens(message);
      
      // If adding this message would exceed the limit, start a new chunk
      if (currentChunkTokens + messageTokens > effectiveMaxTokens && currentChunk.length > 0) {
        chunks.push([...currentChunk]);
        currentChunk = [message];
        currentChunkTokens = messageTokens;
      } else {
        currentChunk.push(message);
        currentChunkTokens += messageTokens;
      }
    }

    // Add the last chunk if it has messages
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}

/**
 * Factory function to create a ContextOptimizer with default configuration
 */
export function createContextOptimizer(config: SummaryOptimizationConfig): ContextOptimizer {
  return new ContextOptimizer(config);
}