/**
 * Tests for ServiceRegistry
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ServiceRegistry } from '../../src/services/service-registry';
import type { Env } from '../../src/env';

// Mock environment
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

// Mock the dependencies
vi.mock('../../src/repositories/violation-repository-adapter', () => ({
  ViolationRepositoryAdapter: vi.fn().mockImplementation(() => ({
    getUserStats: vi.fn(),
    getPeriodStats: vi.fn(),
    getGeneralStats: vi.fn(),
    save: vi.fn()
  }))
}));

vi.mock('../../src/repositories/notification-repository', () => ({
  NotificationRepository: vi.fn().mockImplementation(() => ({
    getChatSettings: vi.fn(),
    saveChatSettings: vi.fn()
  }))
}));

vi.mock('../../src/message-formatter', () => ({
  MessageFormatter: vi.fn().mockImplementation(() => ({
    formatViolationAnalysis: vi.fn(),
    formatUserStats: vi.fn(),
    formatPeriodStats: vi.fn(),
    formatGeneralStats: vi.fn()
  }))
}));

vi.mock('../../src/providers/provider-factory', () => ({
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

describe('ServiceRegistry', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let registry: ServiceRegistry;

  beforeEach(() => {
    registry = new ServiceRegistry(mockEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it('should create service registry', () => {
    expect(registry).toBeDefined();
    expect(registry.isInitialized()).toBe(false);
  });

  it('should have container available', () => {
    const container = registry.getContainer();
    expect(container).toBeDefined();
  });

  it('should check registered services', () => {
    const container = registry.getContainer();
    const registeredServices = container.getRegisteredServices();
    
    // Should have registered the core services
    expect(registeredServices).toContain('StatisticsService');
    expect(registeredServices).toContain('NotificationService');
    expect(registeredServices).toContain('MessageFormatter');
  });

  it('should throw error when getting services before initialization', () => {
    expect(() => registry.getStatisticsService()).toThrow();
  });

  it('should handle shutdown when not initialized', async () => {
    // Should not throw error when shutting down uninitialized registry
    await expect(registry.shutdown()).resolves.not.toThrow();
  });
});