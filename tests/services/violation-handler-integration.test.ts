/**
 * Integration tests for ViolationHandler with DI system
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ViolationHandler } from '../../src/violation-handler';
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

// Mock all dependencies
vi.mock('../../src/logger', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

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
    formatViolationAnalysis: vi.fn().mockReturnValue('formatted message'),
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

describe('ViolationHandler Integration with DI', () => {
  const testTimeout = 10000; // 10 seconds max per test

  it('should create ViolationHandler with backward compatibility (no DI)', async () => {
    // Test backward compatibility - should work without DI
    const handler = await ViolationHandler.createWithoutDI(mockEnv);
    expect(handler).toBeDefined();
  });

  it('should create ViolationHandler with service registry', async () => {
    // Test with DI system
    const registry = new ServiceRegistry(mockEnv);
    await registry.initialize();
    const handler = ViolationHandler.createWithRegistry(mockEnv, registry);
    
    expect(handler).toBeDefined();
    
    await registry.shutdown();
  });

  it('should format violation message using DI services', async () => {
    // Create handler with DI
    const registry = new ServiceRegistry(mockEnv);
    await registry.initialize();
    const handler = ViolationHandler.createWithRegistry(mockEnv, registry);
    
    const mockAnalysis = {
      hasViolations: false,
      violations: [],
      totalSeverity: 0,
      riskLevel: 'low' as const,
      analysisTimestamp: Date.now()
    };

    // Should not throw and should return formatted message
    const result = await handler.formatViolationMessage(mockAnalysis);
    expect(typeof result).toBe('string');
    
    await registry.shutdown();
  });

  it('should handle service registry initialization', async () => {
    const registry = new ServiceRegistry(mockEnv);
    
    // Should have registered services
    const container = registry.getContainer();
    const registeredServices = container.getRegisteredServices();
    
    expect(registeredServices).toContain('StatisticsService');
    expect(registeredServices).toContain('NotificationService');
    expect(registeredServices).toContain('MessageFormatter');
  });
});