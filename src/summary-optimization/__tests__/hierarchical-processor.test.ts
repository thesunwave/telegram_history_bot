/**
 * Unit tests for HierarchicalProcessor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HierarchicalProcessor } from '../hierarchical-processor';
import { TelegramMessage } from '../../providers/ai-provider';
import { Env } from '../../env';
import { ProviderFactory } from '../../providers/provider-factory';
import { loadOptimizationConfig } from '../config';
import { ContextOptimizer } from '../context-optimizer';

// Mock modules
vi.mock('../../providers/provider-factory');
vi.mock('../config');
vi.mock('../context-optimizer');
vi.mock('../../logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn()
  },
  PerformanceTracker: {
    start: vi.fn(() => 'test-tracker-id'),
    end: vi.fn(),
    cleanup: vi.fn()
  }
}));

describe('HierarchicalProcessor', () => {
  let processor: HierarchicalProcessor;
  let mockEnv: Env;
  let mockMessages: TelegramMessage[];
  let mockProvider: any;
  let mockConfig: any;
  let mockContextOptimizer: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create processor instance
    processor = new HierarchicalProcessor();

    // Setup mock environment
    mockEnv = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      KV_NAMESPACE: {} as any,
      COUNTERS: {} as any,
      MESSAGE_FETCHER: {} as any,
      MESSAGE_AGGREGATOR: {} as any,
      SUMMARY_PROMPT: 'Test final prompt {period} {participants} {totalMessages}',
      SUMMARY_SYSTEM: 'Test final system prompt',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_MAX_TOKENS: 500,
      SUMMARY_TEMPERATURE: 0.7,
      SUMMARY_TOP_P: 0.9
    } as Env;

    // Setup mock messages (large volume for hierarchical processing)
    mockMessages = [];
    for (let i = 0; i < 100; i++) {
      mockMessages.push({
        username: `user${i % 5}`,
        text: `Message ${i}: This is a longer message text to simulate real chat content with more tokens`,
        ts: 1704067200 + i * 60 // Messages spread over time
      });
    }

    // Setup mock configuration
    mockConfig = {
      contextManagement: {
        maxTokensPerRequest: 8000,
        preprocessingMaxTokens: 4000,
        finalMaxTokens: 6000,
        tokenEstimationFactor: 1.2
      },
      parallelProcessing: {
        enabled: true,
        minMessagesThreshold: 100,
        maxWorkers: 5,
        workerBatchSize: 50,
        workerTimeout: 30000
      },
      hierarchicalProcessing: {
        enabled: true,
        chunkSizeThreshold: 5000,
        preprocessingPrompt: 'Summarize chunk {chunkNumber} of {totalChunks} with {messageCount} messages',
        maxPreprocessingChunks: 10
      },
      monitoring: {
        enableDetailedMetrics: true,
        logPerformanceInsights: true,
        trackTokenUsage: true
      }
    };

    // Setup mock context optimizer
    mockContextOptimizer = {
      estimateTokens: vi.fn((messages) => messages.length * 50), // Mock 50 tokens per message
      optimizeForContext: vi.fn((messages) => messages),
      createOptimalChunks: vi.fn((messages, maxTokens) => {
        // Create 3 chunks for testing
        const chunkSize = Math.ceil(messages.length / 3);
        const chunks = [];
        for (let i = 0; i < messages.length; i += chunkSize) {
          chunks.push(messages.slice(i, i + chunkSize));
        }
        return chunks;
      })
    };

    // Setup mock provider
    mockProvider = {
      summarize: vi.fn()
        .mockResolvedValueOnce('Intermediate summary 1') // First chunk
        .mockResolvedValueOnce('Intermediate summary 2') // Second chunk
        .mockResolvedValueOnce('Intermediate summary 3') // Third chunk
        .mockResolvedValueOnce('Final combined summary'), // Final summary
      analyzeProfanity: vi.fn(),
      validateConfig: vi.fn(),
      getProviderInfo: vi.fn(() => ({ name: 'test', model: 'test-model' }))
    };

    // Configure mocks
    (loadOptimizationConfig as any).mockReturnValue(mockConfig);
    (ProviderFactory.createProvider as any).mockReturnValue(mockProvider);
    (ContextOptimizer as any).mockImplementation(() => mockContextOptimizer);
  });

  describe('process', () => {
    it('should process large message volumes using hierarchical approach', async () => {
      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBe('Final combined summary');
      expect(loadOptimizationConfig).toHaveBeenCalledWith(mockEnv);
      expect(ProviderFactory.createProvider).toHaveBeenCalledWith(mockEnv);
      
      // Should create chunks
      expect(mockContextOptimizer.createOptimalChunks).toHaveBeenCalledWith(
        mockMessages,
        mockConfig.contextManagement.preprocessingMaxTokens
      );
      
      // Should call summarize for each chunk + final summary
      expect(mockProvider.summarize).toHaveBeenCalledTimes(4); // 3 chunks + 1 final
    });

    it('should handle two-stage processing correctly', async () => {
      await processor.process(mockMessages, mockEnv);

      const summarizeCalls = mockProvider.summarize.mock.calls;
      
      // First 3 calls should be preprocessing
      for (let i = 0; i < 3; i++) {
        const request = summarizeCalls[i][0];
        expect(request.systemPrompt).toContain('предварительной обработки');
        expect(request.userPrompt).toContain(`chunk ${i + 1} of 3`);
        expect(request.limitNote).toContain(`Предобработка части ${i + 1} из 3`);
      }
      
      // Last call should be final processing
      const finalRequest = summarizeCalls[3][0];
      // System prompt can be either from env or default
      expect(finalRequest.systemPrompt).toBeTruthy();
      expect(finalRequest.limitNote).toContain('Финальная обработка');
      expect(finalRequest.messages).toHaveLength(3); // 3 intermediate results
    });

    it('should use simplified prompts for preprocessing', async () => {
      await processor.process(mockMessages, mockEnv);

      const preprocessingCalls = mockProvider.summarize.mock.calls.slice(0, 3);
      
      preprocessingCalls.forEach((call, index) => {
        const options = call[1];
        // Preprocessing should use reduced tokens and lower temperature
        expect(options.temperature).toBe(0.3);
        expect(options.maxTokens).toBeLessThanOrEqual(
          mockConfig.contextManagement.preprocessingMaxTokens * 0.6
        );
      });
    });

    it('should use full prompts for final summary', async () => {
      await processor.process(mockMessages, mockEnv);

      const finalCall = mockProvider.summarize.mock.calls[3];
      const request = finalCall[0];
      const options = finalCall[1];
      
      // Final summary should have user's prompt with placeholders replaced
      expect(request.userPrompt).toContain('5 чел.'); // 5 unique users
      expect(request.userPrompt).toContain('100'); // Total messages
      
      // Should use higher max tokens for final summary
      expect(options.maxTokens).toBeGreaterThan(mockEnv.SUMMARY_MAX_TOKENS);
    });

    it('should handle chunk processing errors gracefully', async () => {
      // Reset mock and set up specific behavior for this test
      vi.clearAllMocks();
      (loadOptimizationConfig as any).mockReturnValue(mockConfig);
      (ProviderFactory.createProvider as any).mockReturnValue(mockProvider);
      (ContextOptimizer as any).mockImplementation(() => mockContextOptimizer);
      
      // Mock one chunk failing
      mockProvider.summarize = vi.fn()
        .mockResolvedValueOnce('Intermediate summary 1')
        .mockRejectedValueOnce(new Error('Chunk 2 failed'))
        .mockResolvedValueOnce('Intermediate summary 3')
        .mockResolvedValueOnce('Final summary with partial results');

      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBe('Final summary with partial results');
      
      // Should continue processing despite one chunk failure
      const finalCall = mockProvider.summarize.mock.calls[3];
      const syntheticMessages = finalCall[0].messages;
      
      // Should have 3 messages (including error placeholder)
      expect(syntheticMessages).toHaveLength(3);
      expect(syntheticMessages[1].text).toContain('Ошибка обработки части 2');
    });

    it('should create synthetic messages from intermediate results', async () => {
      await processor.process(mockMessages, mockEnv);

      const finalCall = mockProvider.summarize.mock.calls[3];
      const syntheticMessages = finalCall[0].messages;
      
      expect(syntheticMessages).toHaveLength(3);
      expect(syntheticMessages[0]).toEqual({
        username: 'Часть 1',
        text: 'Intermediate summary 1',
        ts: mockMessages[0].ts
      });
      expect(syntheticMessages[1]).toEqual({
        username: 'Часть 2',
        text: 'Intermediate summary 2',
        ts: mockMessages[0].ts + 1
      });
      expect(syntheticMessages[2]).toEqual({
        username: 'Часть 3',
        text: 'Intermediate summary 3',
        ts: mockMessages[0].ts + 2
      });
    });

    it('should track performance metrics', async () => {
      const { PerformanceTracker } = await import('../../logger');
      
      await processor.process(mockMessages, mockEnv);

      expect(PerformanceTracker.start).toHaveBeenCalledWith(
        'hierarchicalProcessor',
        'process',
        { messageCount: 100 }
      );
      
      expect(PerformanceTracker.end).toHaveBeenCalledWith(
        'test-tracker-id',
        expect.objectContaining({
          messageCount: 100,
          chunkCount: 3,
          preprocessingDuration: expect.any(Number),
          finalProcessingDuration: expect.any(Number),
          success: true
        })
      );
    });

    it('should log detailed debug information', async () => {
      const { Logger } = await import('../../logger');
      
      await processor.process(mockMessages, mockEnv);

      // Should log chunking info
      expect(Logger.debug).toHaveBeenCalledWith(
        mockEnv,
        'HierarchicalProcessor: Messages chunked for preprocessing',
        expect.objectContaining({
          originalCount: 100,
          chunkCount: 3,
          chunksInfo: expect.any(Array)
        })
      );

      // Should log preprocessing completion
      expect(Logger.debug).toHaveBeenCalledWith(
        mockEnv,
        'HierarchicalProcessor: Preprocessing completed',
        expect.any(Object)
      );

      // Should log final processing
      expect(Logger.debug).toHaveBeenCalledWith(
        mockEnv,
        'HierarchicalProcessor: Final processing completed',
        expect.any(Object)
      );
    });

    it('should handle empty messages array', async () => {
      const emptyMessages: TelegramMessage[] = [];
      
      // Mock empty chunks
      mockContextOptimizer.createOptimalChunks.mockReturnValue([]);

      // No chunks means no intermediate results, but should handle gracefully
      mockProvider.summarize.mockResolvedValueOnce('Empty summary');

      await expect(processor.process(emptyMessages, mockEnv))
        .rejects.toThrow(); // Should throw because no messages to process
    });

    it('should handle single chunk scenario', async () => {
      const smallMessages = mockMessages.slice(0, 10);
      
      // Reset mock and set up specific behavior for this test
      vi.clearAllMocks();
      (loadOptimizationConfig as any).mockReturnValue(mockConfig);
      (ProviderFactory.createProvider as any).mockReturnValue(mockProvider);
      (ContextOptimizer as any).mockImplementation(() => mockContextOptimizer);
      
      // Mock single chunk
      mockContextOptimizer.createOptimalChunks.mockReturnValue([smallMessages]);
      
      mockProvider.summarize = vi.fn()
        .mockResolvedValueOnce('Single chunk summary')
        .mockResolvedValueOnce('Final summary from single chunk');

      const result = await processor.process(smallMessages, mockEnv);

      expect(result).toBe('Final summary from single chunk');
      expect(mockProvider.summarize).toHaveBeenCalledTimes(2); // 1 chunk + 1 final
    });

    it('should apply correct options for different providers', async () => {
      // Test with OpenAI provider
      const openaiEnv = {
        ...mockEnv,
        SUMMARY_PROVIDER: 'openai',
        OPENAI_MAX_TOKENS: 600
      } as any;

      await processor.process(mockMessages, openaiEnv);

      const preprocessingOptions = mockProvider.summarize.mock.calls[0][1];
      const finalOptions = mockProvider.summarize.mock.calls[3][1];
      
      // Preprocessing should use reduced tokens
      expect(preprocessingOptions.maxTokens).toBeLessThanOrEqual(400);
      
      // Final should use increased tokens
      expect(finalOptions.maxTokens).toBe(900); // 600 * 1.5
    });

    it('should add context note to final summary', async () => {
      await processor.process(mockMessages, mockEnv);

      const finalCall = mockProvider.summarize.mock.calls[3];
      const request = finalCall[0];
      
      // Should include hierarchical processing context
      expect(request.userPrompt).toContain('Обработано через иерархическую суммаризацию');
      expect(request.userPrompt).toContain('Исходных сообщений: 100');
      expect(request.userPrompt).toContain('Промежуточных частей: 3');
    });

    it('should handle provider errors in final stage', async () => {
      // Reset mock and set up specific behavior for this test
      vi.clearAllMocks();
      (loadOptimizationConfig as any).mockReturnValue(mockConfig);
      (ProviderFactory.createProvider as any).mockReturnValue(mockProvider);
      (ContextOptimizer as any).mockImplementation(() => mockContextOptimizer);
      
      mockProvider.summarize = vi.fn()
        .mockResolvedValueOnce('Intermediate 1')
        .mockResolvedValueOnce('Intermediate 2')
        .mockResolvedValueOnce('Intermediate 3')
        .mockRejectedValueOnce(new Error('Final processing failed'));

      await expect(processor.process(mockMessages, mockEnv))
        .rejects.toThrow('Final processing failed');

      const { PerformanceTracker } = await import('../../logger');
      expect(PerformanceTracker.end).toHaveBeenCalledWith(
        'test-tracker-id',
        expect.objectContaining({
          success: false,
          error: 'Final processing failed'
        })
      );
    });
  });
});
