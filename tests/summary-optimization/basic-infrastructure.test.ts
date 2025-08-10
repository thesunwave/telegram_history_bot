/**
 * Tests for basic optimized summarization infrastructure
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  loadOptimizationConfig, 
  getDefaultConfig,
  OptimizedStrategySelector,
  OptimizedSummaryController 
} from '../../src/summary-optimization';
import { Env } from '../../src/env';

// Mock environment for testing
const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
  HISTORY: {} as any,
  COUNTERS: {} as any,
  COUNTERS_DO: {} as any,
  MESSAGE_FETCHER_DO: {} as any,
  MESSAGE_AGGREGATOR_DO: {} as any,
  DB: {} as any,
  AI: {} as any,
  TOKEN: 'test-token',
  SECRET: 'test-secret',
  SUMMARY_MODEL: 'test-model',
  SUMMARY_PROMPT: 'Test prompt',
  SUMMARY_SYSTEM: 'Test system',
  DEBUG_LOGS: 'true',
  ...overrides
});

describe('Summary Optimization Infrastructure', () => {
  let mockEnv: Env;

  beforeEach(() => {
    mockEnv = createMockEnv();
  });

  describe('Configuration', () => {
    it('should load default configuration', () => {
      const config = loadOptimizationConfig(mockEnv);
      
      expect(config).toBeDefined();
      expect(config.parallelProcessing).toBeDefined();
      expect(config.contextManagement).toBeDefined();
      expect(config.hierarchicalProcessing).toBeDefined();
      expect(config.monitoring).toBeDefined();
    });

    it('should use environment variables when provided', () => {
      const envWithOverrides = createMockEnv({
        SUMMARY_OPT_MAX_WORKERS: '10' as any,
        SUMMARY_OPT_PARALLEL_ENABLED: 'false' as any,
        SUMMARY_OPT_MAX_TOKENS_PER_REQUEST: '100000' as any
      });

      const config = loadOptimizationConfig(envWithOverrides);
      
      expect(config.parallelProcessing.maxWorkers).toBe(10);
      expect(config.parallelProcessing.enabled).toBe(false);
      expect(config.contextManagement.maxTokensPerRequest).toBe(100000);
    });

    it('should validate configuration values', () => {
      const envWithInvalidValues = createMockEnv({
        SUMMARY_OPT_MAX_WORKERS: '100' as any // Too high
      });

      expect(() => loadOptimizationConfig(envWithInvalidValues)).toThrow();
    });

    it('should return default configuration', () => {
      const defaultConfig = getDefaultConfig();
      
      expect(defaultConfig.parallelProcessing.enabled).toBe(true);
      expect(defaultConfig.parallelProcessing.maxWorkers).toBe(5);
      expect(defaultConfig.contextManagement.maxTokensPerRequest).toBe(120000);
    });
  });

  describe('Strategy Selector', () => {
    let strategySelector: OptimizedStrategySelector;

    beforeEach(() => {
      const config = loadOptimizationConfig(mockEnv);
      strategySelector = new OptimizedStrategySelector(config, mockEnv);
    });

    it('should determine when to use parallel processing', () => {
      expect(strategySelector.shouldUseParallelProcessing(50)).toBe(false);
      expect(strategySelector.shouldUseParallelProcessing(150)).toBe(true);
    });

    it('should determine when to use hierarchical processing', () => {
      expect(strategySelector.shouldUseHierarchicalProcessing(50000)).toBe(false);
      expect(strategySelector.shouldUseHierarchicalProcessing(100000)).toBe(true);
    });

    it('should calculate optimal worker count', () => {
      expect(strategySelector.getOptimalWorkerCount(50)).toBe(1);
      expect(strategySelector.getOptimalWorkerCount(200)).toBe(4);
      expect(strategySelector.getOptimalWorkerCount(1000)).toBe(5); // Capped at max
    });

    it('should select appropriate strategy', () => {
      expect(strategySelector.selectStrategy(50, 10000)).toBe('direct');
      expect(strategySelector.selectStrategy(200, 50000)).toBe('parallel');
      expect(strategySelector.selectStrategy(500, 100000)).toBe('hierarchical');
    });

    it('should provide strategy explanation', () => {
      const explanation = strategySelector.explainStrategySelection(200, 50000);
      
      expect(explanation.strategy).toBe('parallel');
      expect(explanation.reasoning).toBeInstanceOf(Array);
      expect(explanation.reasoning.length).toBeGreaterThan(0);
      expect(explanation.metrics.messageCount).toBe(200);
      expect(explanation.metrics.estimatedTokens).toBe(50000);
    });
  });

  describe('Summary Controller', () => {
    let controller: OptimizedSummaryController;

    beforeEach(() => {
      controller = new OptimizedSummaryController(mockEnv);
    });

    it('should initialize with configuration', () => {
      expect(controller).toBeDefined();
      
      const config = controller.getConfig();
      expect(config).toBeDefined();
      expect(config.parallelProcessing).toBeDefined();
    });

    it('should provide strategy explanation', () => {
      const explanation = controller.explainStrategy(200, 50000);
      
      expect(explanation).toBeDefined();
      expect(explanation.strategy).toBeDefined();
      expect(explanation.reasoning).toBeInstanceOf(Array);
    });

    // Note: We can't easily test the actual summarization methods without mocking
    // the entire legacy system, which would be complex. These will be tested
    // in integration tests once the full system is implemented.
  });

  describe('Type Safety', () => {
    it('should have proper TypeScript types', () => {
      const config = loadOptimizationConfig(mockEnv);
      
      // These should compile without errors if types are correct
      const parallelEnabled: boolean = config.parallelProcessing.enabled;
      const maxTokens: number = config.contextManagement.maxTokensPerRequest;
      const preprocessingPrompt: string = config.hierarchicalProcessing.preprocessingPrompt;
      
      expect(typeof parallelEnabled).toBe('boolean');
      expect(typeof maxTokens).toBe('number');
      expect(typeof preprocessingPrompt).toBe('string');
    });
  });
});