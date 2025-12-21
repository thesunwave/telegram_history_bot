import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runAllRaceConditionTests } from '../src/core/tests/race-condition-tests';
import { createSafeMockEnv } from './test-utils';

// Mock Logger
vi.mock('../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// Track messages for duplicate detection
const messageTracker = new Map<string, Set<string>>();

// Mock day-block-manager functions
vi.mock('../src/day-block-manager', () => ({
  addMessageToDayBlockSafe: vi.fn().mockImplementation(async (env, message) => {
    const chatKey = `${message.chat}`;
    const messageKey = `${message.user}_${message.ts}_${message.text}`;
    
    if (!messageTracker.has(chatKey)) {
      messageTracker.set(chatKey, new Set());
    }
    
    const chatMessages = messageTracker.get(chatKey)!;
    const isDuplicate = chatMessages.has(messageKey);
    
    if (!isDuplicate) {
      chatMessages.add(messageKey);
    }
    
    return {
      success: true,
      duplicate: isDuplicate,
      messageCount: chatMessages.size,
      messageId: messageKey
    };
  }),
  getDayBlockSafe: vi.fn().mockImplementation(async (env, chatId, date) => {
    const chatKey = `${chatId}`;
    const chatMessages = messageTracker.get(chatKey);
    return {
      messages: [],
      messageCount: chatMessages ? chatMessages.size : 0,
      lastUpdated: Date.now()
    };
  })
}));

describe('Race Condition Tests', () => {
  const mockEnv = createSafeMockEnv();

  beforeEach(() => {
    // Clear message tracker before each test
    messageTracker.clear();
  });
  
  it('should run all race condition tests without throwing errors', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(3); // We expect 3 tests
    
    // Check that all tests have the expected structure
    results.forEach(result => {
      expect(result).toHaveProperty('testName');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('messagesAdded');
      expect(result).toHaveProperty('expectedMessages');
      expect(result).toHaveProperty('duplicatesDetected');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('duration');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  }, 30000);

  it('should include concurrent message addition test', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    const concurrentTest = results.find(r => r.testName.includes('Concurrent'));
    
    expect(concurrentTest).toBeDefined();
    expect(concurrentTest?.testName).toBe('Concurrent Message Addition');
    expect(typeof concurrentTest?.duration).toBe('number');
  }, 30000);

  it('should include duplicate message detection test', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    const duplicateTest = results.find(r => r.testName.includes('Duplicate'));
    
    expect(duplicateTest).toBeDefined();
    expect(duplicateTest?.testName).toBe('Duplicate Message Detection');
    expect(typeof duplicateTest?.duplicatesDetected).toBe('number');
  }, 30000);

  it('should include high concurrency scenario test', async () => {
    const results = await runAllRaceConditionTests(mockEnv, -999999);
    const highConcurrencyTest = results.find(r => r.testName.includes('High Concurrency'));
    
    expect(highConcurrencyTest).toBeDefined();
    expect(highConcurrencyTest?.testName).toBe('High Concurrency Scenario');
    expect(Array.isArray(highConcurrencyTest?.errors)).toBe(true);
  }, 60000); // 60 second timeout for high concurrency test
});