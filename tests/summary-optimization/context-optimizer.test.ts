/**
 * Unit tests for ContextOptimizer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ContextOptimizer, createContextOptimizer } from '../../src/features/summary/optimization/context-optimizer';
import { SummaryOptimizationConfig } from '../../src/features/summary/optimization/types';
import { TelegramMessage } from '../../src/core/providers/ai-provider';

describe('ContextOptimizer', () => {
  let optimizer: ContextOptimizer;
  let config: SummaryOptimizationConfig;
  let sampleMessages: TelegramMessage[];

  beforeEach(() => {
    config = {
      parallelProcessing: {
        enabled: true,
        minMessagesThreshold: 100,
        maxWorkers: 4,
        workerBatchSize: 25,
        workerTimeout: 30000,
        minCoverageRatio: 0.5
      },
      contextManagement: {
        maxTokensPerRequest: 4000,
        preprocessingMaxTokens: 2000,
        finalMaxTokens: 4000,
        tokenEstimationFactor: 1.0 // Use 1.0 as base for testing
      },
      hierarchicalProcessing: {
        enabled: true,
        chunkSizeThreshold: 2000,
        preprocessingPrompt: 'Summarize the following messages:',
        maxPreprocessingChunks: 5
      },
      monitoring: {
        enableDetailedMetrics: true,
        logPerformanceInsights: true,
        trackTokenUsage: true
      }
    };

    optimizer = new ContextOptimizer(config);

    // Create sample messages for testing
    sampleMessages = [
      {
        username: 'user1',
        text: 'Короткое сообщение',
        ts: 1000
      },
      {
        username: 'user2',
        text: 'Это более длинное сообщение с большим количеством текста для тестирования алгоритмов оптимизации контекста',
        ts: 2000
      },
      {
        username: 'user3',
        text: 'Среднее сообщение для тестов',
        ts: 3000
      },
      {
        username: 'user4',
        text: 'Очень длинное сообщение с множеством слов и символов, которое должно занимать значительное количество токенов в контексте и использоваться для проверки различных стратегий оптимизации',
        ts: 4000
      },
      {
        username: 'user5',
        text: 'Еще одно сообщение',
        ts: 5000
      }
    ];
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty message array', () => {
      expect(optimizer.estimateTokens([])).toBe(0);
    });

    it('should return 0 for null/undefined input', () => {
      expect(optimizer.estimateTokens(null as any)).toBe(0);
      expect(optimizer.estimateTokens(undefined as any)).toBe(0);
    });

    it('should estimate tokens for single message', () => {
      const message: TelegramMessage = {
        username: 'test',
        text: 'Тестовое сообщение',
        ts: 1000
      };

      const tokens = optimizer.estimateTokens([message]);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(50); // Reasonable upper bound for short message
    });

    it('should estimate more tokens for longer messages', () => {
      const shortMessage: TelegramMessage = {
        username: 'user',
        text: 'Короткий текст',
        ts: 1000
      };

      const longMessage: TelegramMessage = {
        username: 'user',
        text: 'Очень длинный текст с множеством слов и символов, который должен занимать значительно больше токенов чем короткое сообщение',
        ts: 2000
      };

      const shortTokens = optimizer.estimateTokens([shortMessage]);
      const longTokens = optimizer.estimateTokens([longMessage]);

      expect(longTokens).toBeGreaterThan(shortTokens);
    });

    it('should apply token estimation factor from config', () => {
      const message: TelegramMessage = {
        username: 'test',
        text: 'Тестовое сообщение для проверки фактора оценки токенов',
        ts: 1000
      };

      // Create optimizer with different estimation factor
      const configWithFactor = JSON.parse(JSON.stringify(config)); // Deep copy
      configWithFactor.contextManagement.tokenEstimationFactor = 2.0; // Use a larger factor
      const optimizerWithFactor = new ContextOptimizer(configWithFactor);

      const normalTokens = optimizer.estimateTokens([message]);
      const factorTokens = optimizerWithFactor.estimateTokens([message]);



      expect(factorTokens).toBeGreaterThan(normalTokens);
    });
  });

  describe('estimateTokensDetailed', () => {
    it('should return detailed estimation for empty array', () => {
      const result = optimizer.estimateTokensDetailed([]);

      expect(result.totalTokens).toBe(0);
      expect(result.messageTokens).toEqual([]);
      expect(result.averageTokensPerMessage).toBe(0);
      expect(result.maxTokensInMessage).toBe(0);
    });

    it('should provide detailed breakdown for multiple messages', () => {
      const result = optimizer.estimateTokensDetailed(sampleMessages);

      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.messageTokens).toHaveLength(sampleMessages.length);
      expect(result.averageTokensPerMessage).toBeGreaterThan(0);
      expect(result.maxTokensInMessage).toBeGreaterThan(0);
      expect(result.maxTokensInMessage).toBeGreaterThanOrEqual(result.averageTokensPerMessage);
    });

    it('should have consistent token counts', () => {
      const detailed = optimizer.estimateTokensDetailed(sampleMessages);
      const simple = optimizer.estimateTokens(sampleMessages);

      expect(detailed.totalTokens).toBe(simple);
    });
  });

  describe('optimizeForContext', () => {
    it('should return empty array for empty input', () => {
      const result = optimizer.optimizeForContext([], 1000);
      expect(result).toEqual([]);
    });

    it('should return original messages if they fit within limit', () => {
      const result = optimizer.optimizeForContext(sampleMessages, 10000);
      expect(result).toHaveLength(sampleMessages.length);
    });

    it('should reduce message count when over token limit', () => {
      const result = optimizer.optimizeForContext(sampleMessages, 50);
      expect(result.length).toBeLessThan(sampleMessages.length);
    });

    it('should preserve message chronological order', () => {
      const result = optimizer.optimizeForContext(sampleMessages, 200);

      for (let i = 1; i < result.length; i++) {
        expect(result[i].ts).toBeGreaterThanOrEqual(result[i - 1].ts);
      }
    });

    it('should fit within token limit after optimization', () => {
      const maxTokens = 100;
      const result = optimizer.optimizeForContext(sampleMessages, maxTokens);
      const resultTokens = optimizer.estimateTokens(result);

      expect(resultTokens).toBeLessThanOrEqual(maxTokens);
    });

    it('should handle very restrictive token limits', () => {
      const result = optimizer.optimizeForContext(sampleMessages, 10);
      const resultTokens = optimizer.estimateTokens(result);

      expect(resultTokens).toBeLessThanOrEqual(10);
    });
  });

  describe('createOptimalChunks', () => {
    it('should return empty array for empty input', () => {
      const result = optimizer.createOptimalChunks([], 1000);
      expect(result).toEqual([]);
    });

    it('should create single chunk if messages fit', () => {
      const result = optimizer.createOptimalChunks(sampleMessages, 10000);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(sampleMessages.length);
    });

    it('should create multiple chunks when needed', () => {
      const result = optimizer.createOptimalChunks(sampleMessages, 50);
      expect(result.length).toBeGreaterThan(1);
    });

    it('should respect chunk token limits', () => {
      const maxTokens = 100;
      const result = optimizer.createOptimalChunks(sampleMessages, maxTokens);

      for (const chunk of result) {
        const chunkTokens = optimizer.estimateTokens(chunk);
        expect(chunkTokens).toBeLessThanOrEqual(maxTokens);
      }
    });

    it('should preserve all messages across chunks', () => {
      const result = optimizer.createOptimalChunks(sampleMessages, 100);
      const totalMessages = result.reduce((sum, chunk) => sum + chunk.length, 0);

      expect(totalMessages).toBe(sampleMessages.length);
    });

    it('should maintain chronological order within chunks', () => {
      const result = optimizer.createOptimalChunks(sampleMessages, 100);

      for (const chunk of result) {
        for (let i = 1; i < chunk.length; i++) {
          expect(chunk[i].ts).toBeGreaterThanOrEqual(chunk[i - 1].ts);
        }
      }
    });

    it('should preserve all messages when chunk count exceeds max preprocessing chunks', () => {
      const manyMessages: TelegramMessage[] = [];
      for (let i = 0; i < 100; i++) {
        manyMessages.push({
          username: `user${i}`,
          text: `Message ${i} with some content`,
          ts: i * 1000
        });
      }

      const result = optimizer.createOptimalChunks(manyMessages, 20); // Smaller token limit to force more chunks

      // maxPreprocessingChunks is a merge target, not a hard truncation: once
      // the total tokens exceed maxChunks * effectiveMaxTokens the chunk count
      // cannot be reduced to the cap without dropping messages. Every message
      // must survive chunking (previously the trailing/newest messages were
      // silently discarded via slice(0, maxChunks)).
      const totalMessages = result.reduce((sum, chunk) => sum + chunk.length, 0);
      expect(totalMessages).toBe(manyMessages.length);

      const returnedTexts = new Set(result.flat().map((m) => m.text));
      for (const m of manyMessages) {
        expect(returnedTexts.has(m.text)).toBe(true);
      }
      expect(returnedTexts.has(manyMessages[manyMessages.length - 1].text)).toBe(true);

      for (const chunk of result) {
        expect(chunk.length).toBeGreaterThan(0);
      }
    });
  });

  describe('createOptimalChunksDetailed', () => {
    it('should provide detailed metadata for empty input', () => {
      const result = optimizer.createOptimalChunksDetailed([], 1000);

      expect(result.chunks).toEqual([]);
      expect(result.totalChunks).toBe(0);
      expect(result.averageTokensPerChunk).toBe(0);
      expect(result.maxTokensInChunk).toBe(0);
      expect(result.metadata.originalMessageCount).toBe(0);
      expect(result.metadata.totalTokens).toBe(0);
    });

    it('should provide accurate metadata for chunked messages', () => {
      const result = optimizer.createOptimalChunksDetailed(sampleMessages, 100);

      expect(result.totalChunks).toBe(result.chunks.length);
      expect(result.metadata.originalMessageCount).toBe(sampleMessages.length);
      expect(result.metadata.totalTokens).toBeGreaterThan(0);
      expect(result.averageTokensPerChunk).toBeGreaterThan(0);
      expect(result.maxTokensInChunk).toBeGreaterThanOrEqual(result.averageTokensPerChunk);
    });

    it('should indicate correct chunking strategy', () => {
      const smallResult = optimizer.createOptimalChunksDetailed(sampleMessages, 10000);
      expect(smallResult.metadata.chunkingStrategy).toBe('sequential');

      const manyMessages: TelegramMessage[] = [];
      for (let i = 0; i < 50; i++) {
        manyMessages.push({
          username: `user${i}`,
          text: `Message ${i}`,
          ts: i * 1000
        });
      }

      const largeResult = optimizer.createOptimalChunksDetailed(manyMessages, 20);
      // Should use balanced strategy when exceeding max chunks
      if (largeResult.totalChunks > config.hierarchicalProcessing.maxPreprocessingChunks) {
        expect(largeResult.metadata.chunkingStrategy).toBe('balanced');
      }
    });
  });

  describe('createContextOptimizer factory', () => {
    it('should create optimizer with provided config', () => {
      const createdOptimizer = createContextOptimizer(config);
      expect(createdOptimizer).toBeInstanceOf(ContextOptimizer);
    });

    it('should use config values correctly', () => {
      const customConfig = JSON.parse(JSON.stringify(config)); // Deep copy
      customConfig.contextManagement.tokenEstimationFactor = 2.0;

      const customOptimizer = createContextOptimizer(customConfig);
      const message: TelegramMessage = {
        username: 'test',
        text: 'Test message for checking configuration factor usage',
        ts: 1000
      };

      const normalTokens = optimizer.estimateTokens([message]);
      const customTokens = customOptimizer.estimateTokens([message]);

      expect(customTokens).toBeGreaterThan(normalTokens);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle messages with empty text', () => {
      const messagesWithEmpty: TelegramMessage[] = [
        { username: 'user1', text: '', ts: 1000 },
        { username: 'user2', text: 'Normal message', ts: 2000 },
        { username: 'user3', text: '', ts: 3000 }
      ];

      const tokens = optimizer.estimateTokens(messagesWithEmpty);
      expect(tokens).toBeGreaterThan(0);

      const optimized = optimizer.optimizeForContext(messagesWithEmpty, 100);
      expect(optimized.length).toBeLessThanOrEqual(messagesWithEmpty.length);

      const chunks = optimizer.createOptimalChunks(messagesWithEmpty, 100);
      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should handle messages with very long usernames', () => {
      const messageWithLongUsername: TelegramMessage = {
        username: 'very_long_username_that_should_be_handled_correctly_by_the_optimizer',
        text: 'Short text',
        ts: 1000
      };

      const tokens = optimizer.estimateTokens([messageWithLongUsername]);
      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle single message that exceeds token limit', () => {
      const veryLongMessage: TelegramMessage = {
        username: 'user',
        text: 'Очень длинное сообщение '.repeat(100), // Very long repeated text
        ts: 1000
      };

      const optimized = optimizer.optimizeForContext([veryLongMessage], 50);
      const chunks = optimizer.createOptimalChunks([veryLongMessage], 50);

      // Should handle gracefully without crashing
      expect(Array.isArray(optimized)).toBe(true);
      expect(Array.isArray(chunks)).toBe(true);
    });

    it('should handle zero token limit gracefully', () => {
      const optimized = optimizer.optimizeForContext(sampleMessages, 0);
      const chunks = optimizer.createOptimalChunks(sampleMessages, 0);

      expect(Array.isArray(optimized)).toBe(true);
      expect(Array.isArray(chunks)).toBe(true);
    });
  });

  describe('optimization strategies', () => {
    it('should prefer removing short messages first', () => {
      const mixedMessages: TelegramMessage[] = [
        { username: 'user1', text: 'ok', ts: 1000 }, // Very short
        { username: 'user2', text: 'Длинное сообщение с содержательным текстом', ts: 2000 },
        { username: 'user3', text: 'да', ts: 3000 }, // Very short
        { username: 'user4', text: 'Еще одно длинное и содержательное сообщение', ts: 4000 }
      ];

      const optimized = optimizer.optimizeForContext(mixedMessages, 150);

      // Should prefer keeping longer, more meaningful messages
      const hasLongMessages = optimized.some(msg => msg.text.length > 20);
      expect(hasLongMessages).toBe(true);
    });

    it('should maintain temporal distribution in smart sampling', () => {
      const timeSpreadMessages: TelegramMessage[] = [];
      for (let i = 0; i < 20; i++) {
        timeSpreadMessages.push({
          username: `user${i}`,
          text: `Message ${i} with some content to test sampling`,
          ts: i * 3600 * 1000 // One hour apart
        });
      }

      const optimized = optimizer.optimizeForContext(timeSpreadMessages, 200);

      if (optimized.length > 1) {
        // Should have messages from different time periods
        const timeSpan = optimized[optimized.length - 1].ts - optimized[0].ts;
        expect(timeSpan).toBeGreaterThan(0);
      }
    });
  });
});