/**
 * Tests for DIContainer
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DIContainer } from '../../src/services/di-container';
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

describe('DIContainer', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer(mockEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it('should register and resolve singleton services', () => {
    // Register a simple service
    container.registerSingleton('TestService', () => ({ name: 'test' }));

    // Resolve the service
    const service1 = container.resolve('TestService');
    const service2 = container.resolve('TestService');

    expect(service1).toEqual({ name: 'test' });
    expect(service1).toBe(service2); // Should be the same instance
  }, testTimeout);

  it('should register and resolve transient services', () => {
    // Register a transient service
    container.registerTransient('TransientService', () => ({ id: Math.random() }));

    // Resolve the service multiple times
    const service1 = container.resolve('TransientService');
    const service2 = container.resolve('TransientService');

    expect(service1).not.toBe(service2); // Should be different instances
    expect(service1.id).not.toBe(service2.id);
  }, testTimeout);

  it('should handle dependencies correctly', () => {
    // Register dependency
    container.registerSingleton('Dependency', () => ({ value: 'dependency' }));

    // Register service with dependency
    container.registerSingleton('ServiceWithDep', (container) => {
      const dep = container.resolve('Dependency');
      return { dependency: dep };
    }, ['Dependency']);

    // Resolve service
    const service = container.resolve('ServiceWithDep');
    expect(service.dependency).toEqual({ value: 'dependency' });
  }, testTimeout);

  it('should throw error for unregistered service', () => {
    expect(() => container.resolve('NonExistentService')).toThrow();
  }, testTimeout);

  it('should check if service is registered', () => {
    container.registerSingleton('TestService', () => ({}));

    expect(container.isRegistered('TestService')).toBe(true);
    expect(container.isRegistered('NonExistentService')).toBe(false);
  }, testTimeout);

  it('should return list of registered services', () => {
    container.registerSingleton('Service1', () => ({}));
    container.registerSingleton('Service2', () => ({}));

    const services = container.getRegisteredServices();
    expect(services).toContain('Service1');
    expect(services).toContain('Service2');
    expect(services).toHaveLength(2);
  }, testTimeout);
});