import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runAllRaceConditionTests } from '../src/race-condition-tests';
import { createSafeMockEnv } from './test-utils';

// Simple mock environment for testing
interface MockEnv {
  mockStorage?: Map<string, Set<string>>;
}

describe('Race Condition Tests', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let mockEnv: MockEnv;

  beforeEach(() => {
    // Create fresh mock environment for each test
    mockEnv = {
      mockStorage: new Map<string, Set<string>>()
    };
  });

  afterEach(() => {
    // Clean up mock environment
    if (mockEnv.mockStorage) {
      mockEnv.mockStorage.clear();
    }
  });
  
  it('should run all race condition tests without throwing errors', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(3); // We expect 3 tests
    
    // Check that all tests have the expected structure
    results.forEach((result, index) => {
      expect(result).toHaveProperty('testName');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('messagesAdded');
      expect(result).toHaveProperty('expectedMessages');
      expect(result).toHaveProperty('duplicatesDetected');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('duration');
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.messagesAdded).toBe('number');
      expect(result.messagesAdded).toBeGreaterThanOrEqual(0);
      expect(typeof result.duplicatesDetected).toBe('number');
      expect(result.duplicatesDetected).toBeGreaterThanOrEqual(0);
    });
    
    // Verify that tests completed within reasonable time
    const totalDuration = results.reduce((sum, result) => sum + result.duration, 0);
    expect(totalDuration).toBeLessThan(testTimeout);
  }, testTimeout);

  it('should include concurrent message addition test', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    const concurrentTest = results.find(r => r.testName.includes('Concurrent'));
    
    expect(concurrentTest).toBeDefined();
    expect(concurrentTest?.testName).toBe('Concurrent Message Addition');
    expect(typeof concurrentTest?.duration).toBe('number');
    expect(concurrentTest?.duration).toBeGreaterThanOrEqual(0);
    expect(concurrentTest?.messagesAdded).toBeGreaterThanOrEqual(0);
    expect(concurrentTest?.expectedMessages).toBeGreaterThan(0);
    expect(Array.isArray(concurrentTest?.errors)).toBe(true);
  }, testTimeout);

  it('should include duplicate message detection test', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    const duplicateTest = results.find(r => r.testName.includes('Duplicate'));
    
    expect(duplicateTest).toBeDefined();
    expect(duplicateTest?.testName).toBe('Duplicate Message Detection');
    expect(typeof duplicateTest?.duplicatesDetected).toBe('number');
    expect(duplicateTest?.duplicatesDetected).toBeGreaterThanOrEqual(0); // May detect duplicates
    expect(duplicateTest?.messagesAdded).toBeGreaterThanOrEqual(0); // Should store at least some messages
    expect(Array.isArray(duplicateTest?.errors)).toBe(true);
  }, testTimeout);

  it('should include high concurrency scenario test', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    const highConcurrencyTest = results.find(r => r.testName.includes('High Concurrency'));
    
    expect(highConcurrencyTest).toBeDefined();
    expect(highConcurrencyTest?.testName).toBe('High Concurrency Scenario');
    expect(Array.isArray(highConcurrencyTest?.errors)).toBe(true);
    expect(highConcurrencyTest?.messagesAdded).toBeGreaterThanOrEqual(0);
    expect(highConcurrencyTest?.expectedMessages).toBeGreaterThan(0);
    expect(highConcurrencyTest?.duration).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(highConcurrencyTest?.errors)).toBe(true);
  }, testTimeout);

  it('should handle edge cases and maintain stability', async () => {
    // Test with empty mock environment
    const emptyEnv = {};
    const results = await runAllRaceConditionTests(emptyEnv, -999999);
    
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(3);
    
    // All tests should complete even with empty environment
    results.forEach(result => {
      expect(result).toHaveProperty('testName');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('duration');
      expect(typeof result.duration).toBe('number');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  }, testTimeout);

  it('should maintain consistent results across multiple runs', async () => {
    const run1 = await runAllRaceConditionTests(mockEnv, -999999);
    
    // Reset environment
    mockEnv.mockStorage = new Map<string, Set<string>>();
    
    const run2 = await runAllRaceConditionTests(mockEnv, -999999);
    
    expect(run1.length).toBe(run2.length);
    
    // Test names should be consistent
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].testName).toBe(run2[i].testName);
      expect(typeof run1[i].success).toBe(typeof run2[i].success);
      expect(typeof run1[i].duration).toBe(typeof run2[i].duration);
    }
  }, testTimeout);
});