/**
 * Unit tests for DirectProcessor
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DirectProcessor } from '../direct-processor';
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

describe('DirectProcessor', () => {
  let processor: DirectProcessor;
  let mockEnv: Env;
  let mockMessages: TelegramMessage[];
  let mockProvider: any;
  let mockConfig: any;
  let mockContextOptimizer: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create processor instance
    processor = new DirectProcessor();

    // Setup mock environment
    mockEnv = {
      TELEGRAM_BOT_TOKEN: 'test-token',
      KV_NAMESPACE: {} as any,
      COUNTERS: {} as any,
      MESSAGE_FETCHER: {} as any,
      MESSAGE_AGGREGATOR: {} as any,
      SUMMARY_PROMPT: 'Test prompt {period} {participants} {totalMessages}',
      SUMMARY_SYSTEM: 'Test system prompt',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_MAX_TOKENS: 500,
      SUMMARY_TEMPERATURE: 0.7,
      SUMMARY_TOP_P: 0.9
    } as Env;

    // Setup mock messages
    mockMessages = [
      {
        username: 'user1',
        text: 'Hello world',
        ts: 1704067200 // 2024-01-01 00:00:00
      },
      {
        username: 'user2',
        text: 'How are you?',
        ts: 1704070800 // 2024-01-01 01:00:00
      },
      {
        username: 'user1',
        text: 'I am fine, thanks!',
        ts: 1704074400 // 2024-01-01 02:00:00
      }
    ];

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
        preprocessingPrompt: 'Summarize this chunk',
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
      estimateTokens: vi.fn(() => 500),
      optimizeForContext: vi.fn((messages) => messages),
      createOptimalChunks: vi.fn()
    };

    // Setup mock provider
    mockProvider = {
      summarize: vi.fn(() => Promise.resolve('Test summary result')),
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
    it('should process messages successfully', async () => {
      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBe('Test summary result');
      expect(loadOptimizationConfig).toHaveBeenCalledWith(mockEnv);
      expect(ProviderFactory.createProvider).toHaveBeenCalledWith(mockEnv);
      expect(mockProvider.summarize).toHaveBeenCalled();
    });

    it('should optimize messages when they exceed token limit', async () => {
      // Mock high token count
      mockContextOptimizer.estimateTokens.mockReturnValue(10000);
      
      // Mock optimization to remove some messages
      const optimizedMessages = mockMessages.slice(0, 2);
      mockContextOptimizer.optimizeForContext.mockReturnValue(optimizedMessages);

      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBe('Test summary result');
      expect(mockContextOptimizer.optimizeForContext).toHaveBeenCalledWith(
        mockMessages,
        mockConfig.contextManagement.maxTokensPerRequest
      );
      
      // Verify that the optimized messages were used
      const summaryCall = mockProvider.summarize.mock.calls[0];
      expect(summaryCall[0].messages).toEqual(optimizedMessages);
    });

    it('should handle empty messages array', async () => {
      const emptyMessages: TelegramMessage[] = [];
      
      // Mock to return empty array for empty input
      mockContextOptimizer.estimateTokens.mockReturnValue(0);
      mockContextOptimizer.optimizeForContext.mockReturnValue([]);

      await expect(processor.process(emptyMessages, mockEnv))
        .rejects.toThrow();
    });

    it('should build correct summary request', async () => {
      await processor.process(mockMessages, mockEnv);

      const summaryCall = mockProvider.summarize.mock.calls[0];
      const summaryRequest = summaryCall[0];

      expect(summaryRequest).toHaveProperty('messages', mockMessages);
      expect(summaryRequest).toHaveProperty('systemPrompt', 'Test system prompt');
      expect(summaryRequest).toHaveProperty('userPrompt');
      expect(summaryRequest).toHaveProperty('limitNote');
      
      // Check that placeholders are replaced
      expect(summaryRequest.userPrompt).toContain('01.01.2024'); // Date formatting
      expect(summaryRequest.userPrompt).toContain('2 чел.'); // Participants
      expect(summaryRequest.userPrompt).toContain('3'); // Total messages
    });

    it('should use default prompts when not configured', async () => {
      const envWithoutPrompts = {
        ...mockEnv,
        SUMMARY_PROMPT: undefined,
        SUMMARY_SYSTEM: undefined
      } as Env;

      await processor.process(mockMessages, envWithoutPrompts);

      const summaryCall = mockProvider.summarize.mock.calls[0];
      const summaryRequest = summaryCall[0];

      // Should have default prompts
      expect(summaryRequest.systemPrompt).toContain('аналитик чатов');
      expect(summaryRequest.userPrompt).toContain('ОСНОВНЫЕ ТЕМЫ');
    });

    it('should build correct AI options for different providers', async () => {
      // Test Cloudflare provider
      const cloudflareEnv = {
        ...mockEnv,
        SUMMARY_PROVIDER: 'cloudflare',
        CLOUDFLARE_MAX_TOKENS: 400,
        CLOUDFLARE_TEMPERATURE: 0.5,
        CLOUDFLARE_TOP_P: 0.95
      } as any;

      await processor.process(mockMessages, cloudflareEnv);

      let aiOptions = mockProvider.summarize.mock.calls[0][1];
      expect(aiOptions).toEqual({
        maxTokens: 400,
        temperature: 0.5,
        topP: 0.95
      });

      // Reset mock
      vi.clearAllMocks();
      (loadOptimizationConfig as any).mockReturnValue(mockConfig);
      (ProviderFactory.createProvider as any).mockReturnValue(mockProvider);
      (ContextOptimizer as any).mockImplementation(() => mockContextOptimizer);

      // Test OpenAI provider
      const openaiEnv = {
        ...mockEnv,
        SUMMARY_PROVIDER: 'openai',
        OPENAI_MAX_TOKENS: 600,
        OPENAI_TEMPERATURE: 0.3,
        OPENAI_TOP_P: 0.85,
        OPENAI_FREQUENCY_PENALTY: 0.5
      } as any;

      await processor.process(mockMessages, openaiEnv);

      aiOptions = mockProvider.summarize.mock.calls[0][1];
      expect(aiOptions).toEqual({
        maxTokens: 600,
        temperature: 0.3,
        topP: 0.85,
        frequencyPenalty: 0.5
      });
    });

    it('should handle provider errors gracefully', async () => {
      const error = new Error('Provider error');
      mockProvider.summarize.mockRejectedValue(error);

      await expect(processor.process(mockMessages, mockEnv))
        .rejects.toThrow('Provider error');
    });

    it('should track performance metrics', async () => {
      const { PerformanceTracker } = await import('../../logger');
      
      await processor.process(mockMessages, mockEnv);

      expect(PerformanceTracker.start).toHaveBeenCalledWith(
        'directProcessor',
        'process',
        { messageCount: 3 }
      );
      
      expect(PerformanceTracker.end).toHaveBeenCalledWith(
        'test-tracker-id',
        expect.objectContaining({
          messageCount: 3,
          estimatedTokens: 500,
          processingDuration: expect.any(Number),
          success: true
        })
      );
    });

    it('should track performance metrics on error', async () => {
      const { PerformanceTracker } = await import('../../logger');
      const error = new Error('Test error');
      mockProvider.summarize.mockRejectedValue(error);

      await expect(processor.process(mockMessages, mockEnv))
        .rejects.toThrow('Test error');

      expect(PerformanceTracker.end).toHaveBeenCalledWith(
        'test-tracker-id',
        expect.objectContaining({
          messageCount: 3,
          success: false,
          error: 'Test error'
        })
      );
    });

    it('should log debug information during processing', async () => {
      const { Logger } = await import('../../logger');
      
      await processor.process(mockMessages, mockEnv);

      expect(Logger.debug).toHaveBeenCalledWith(
        mockEnv,
        'DirectProcessor: Starting direct processing',
        expect.any(Object)
      );
      
      expect(Logger.debug).toHaveBeenCalledWith(
        mockEnv,
        'DirectProcessor: Token estimation',
        expect.any(Object)
      );
      
      expect(Logger.debug).toHaveBeenCalledWith(
        mockEnv,
        'DirectProcessor: Processing completed',
        expect.any(Object)
      );
    });

    it('should handle messages with different timestamp formats', async () => {
      const messagesWithVariedTimestamps = [
        {
          username: 'user1',
          text: 'Message 1',
          ts: 1704067200 // 2024-01-01 00:00:00
        },
        {
          username: 'user2',
          text: 'Message 2',
          ts: 1704153600 // 2024-01-02 00:00:00
        },
        {
          username: 'user3',
          text: 'Message 3',
          ts: 1704240000 // 2024-01-03 00:00:00
        }
      ];

      await processor.process(messagesWithVariedTimestamps, mockEnv);

      const summaryCall = mockProvider.summarize.mock.calls[0];
      const summaryRequest = summaryCall[0];

      // Should handle multi-day period correctly
      expect(summaryRequest.userPrompt).toContain('01.01.2024'); // Start date
      expect(summaryRequest.userPrompt).toContain('03.01.2024'); // End date
      expect(summaryRequest.userPrompt).toContain('2 дн.'); // Duration
    });

    it('should handle single-day messages correctly', async () => {
      const sameDayMessages = [
        {
          username: 'user1',
          text: 'Morning message',
          ts: 1704067200 // 2024-01-01 00:00:00
        },
        {
          username: 'user2',
          text: 'Afternoon message',
          ts: 1704088800 // 2024-01-01 06:00:00
        }
      ];

      await processor.process(sameDayMessages, mockEnv);

      const summaryCall = mockProvider.summarize.mock.calls[0];
      const summaryRequest = summaryCall[0];

      // Should indicate same day
      expect(summaryRequest.userPrompt).toContain('в тот же день');
    });
  });
});
