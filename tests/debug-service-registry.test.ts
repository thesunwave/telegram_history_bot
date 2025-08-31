/**
 * Debug test for ServiceRegistry initialization
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServiceRegistry } from '../src/services/service-registry';
import type { Env } from '../src/env';

// Mock all dependencies
vi.mock('../src/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('../src/repositories/violation-repository-adapter', () => ({
  ViolationRepositoryAdapter: vi.fn().mockImplementation(() => ({
    getUserStats: vi.fn(),
    getPeriodStats: vi.fn(),
    getGeneralStats: vi.fn(),
    save: vi.fn()
  }))
}));

vi.mock('../src/repositories/notification-repository', () => ({
  NotificationRepository: vi.fn().mockImplementation(() => ({
    getChatSettings: vi.fn(),
    saveChatSettings: vi.fn()
  }))
}));

vi.mock('../src/message-formatter', () => ({
  MessageFormatter: vi.fn().mockImplementation(() => ({
    formatViolationAnalysis: vi.fn(),
    formatUserStats: vi.fn(),
    formatPeriodStats: vi.fn(),
    formatGeneralStats: vi.fn()
  }))
}));

vi.mock('../src/providers/provider-factory', () => ({
  ProviderFactory: {
    createProvider: vi.fn().mockReturnValue({
      summarize: vi.fn(),
      analyzeProfanity: vi.fn(),
      analyzeCriminalCode: vi.fn(),
      validateConfig: vi.fn(),
      getProviderInfo: vi.fn().mockReturnValue({ name: 'mock', model: 'test' })
    })
  }
}));

const mockEnv: Env = {
  HISTORY: {} as any,
  COUNTERS: {} as any,
  COUNTERS_DO: {} as any,
  MESSAGE_FETCHER_DO: {} as any,
  MESSAGE_AGGREGATOR_DO: {} as any,
  DAY_BLOCK_MANAGER_DO: {} as any,
  CRIMINAL_CODE_ANALYZER_DO: {} as any,
  DB: {} as any,
  AI: {} as any,
  TOKEN: 'test-token',
  SECRET: 'test-secret',
  SUMMARY_MODEL: 'test-model',
  SUMMARY_PROMPT: 'test-prompt'
};

describe('ServiceRegistry Debug', () => {
  const testTimeout = 10000; // 10 seconds max per test

  it('should create ServiceRegistry without initialization', () => {
    const registry = new ServiceRegistry(mockEnv);
    expect(registry).toBeDefined();
    expect(registry.isInitialized()).toBe(false);
  });

  it('should initialize ServiceRegistry', async () => {
    const registry = new ServiceRegistry(mockEnv);
    
    try {
      await registry.initialize();
      expect(registry.isInitialized()).toBe(true);
      await registry.shutdown();
    } catch (error: unknown) {
      console.error('Initialization failed:', error);
      throw error;
    }
  });

  it('should get container', () => {
    const registry = new ServiceRegistry(mockEnv);
    const container = registry.getContainer();
    expect(container).toBeDefined();
  });

  it('should have registered services', () => {
    const registry = new ServiceRegistry(mockEnv);
    const container = registry.getContainer();
    const services = container.getRegisteredServices();
    
    expect(services).toContain('StatisticsService');
    expect(services).toContain('NotificationService');
    expect(services).toContain('MessageFormatter');
    expect(services).toContain('ViolationRepository');
  });
});