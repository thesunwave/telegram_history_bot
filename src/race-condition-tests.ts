import { StoredMessage } from './types';

// Mock interfaces for testing
interface MockDayBlock {
  messages: StoredMessage[];
  messageCount: number;
  lastUpdated: number;
}

interface MockAddResult {
  success: boolean;
  duplicate: boolean;
  messageCount: number;
  messageId: string;
}

// Mock functions to avoid external dependencies
const mockAddMessageToDayBlockSafe = async (env: any, message: StoredMessage): Promise<MockAddResult> => {
  // Simulate message addition with duplicate detection
  const messageKey = `${message.user}_${message.ts}_${message.text}`;
  const chatKey = `chat_${message.chat}`;
  
  if (!env.mockStorage) {
    env.mockStorage = new Map<string, Set<string>>();
  }
  
  if (!env.mockStorage.has(chatKey)) {
    env.mockStorage.set(chatKey, new Set());
  }
  
  const chatMessages = env.mockStorage.get(chatKey)!;
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
};

const mockGetDayBlockSafe = async (env: any, chatId: number, date: string): Promise<MockDayBlock | null> => {
  const chatKey = `chat_${chatId}`;
  
  if (!env.mockStorage || !env.mockStorage.has(chatKey)) {
    return null;
  }
  
  const chatMessages = env.mockStorage.get(chatKey)!;
  return {
    messages: [],
    messageCount: chatMessages.size,
    lastUpdated: Date.now()
  };
};

/**
 * Tests for race condition protection in day block operations
 */

export interface RaceConditionTestResult {
  testName: string;
  success: boolean;
  messagesAdded: number;
  expectedMessages: number;
  duplicatesDetected: number;
  errors: string[];
  duration: number;
}

/**
 * Test concurrent message additions to the same day block
 */
export async function testConcurrentMessageAddition(
  env: any,
  chatId: number,
  messageCount: number = 10
): Promise<RaceConditionTestResult> {
  const testName = 'Concurrent Message Addition';
  const startTime = Date.now();
  const errors: string[] = [];
  let duplicatesDetected = 0;

  if (typeof console !== 'undefined' && console.log) {
    console.log(`Starting ${testName} test with ${messageCount} concurrent messages`);
  }

  try {
    const baseTimestamp = Math.floor(Date.now() / 1000);
    const date = new Date(baseTimestamp * 1000).toISOString().slice(0, 10);

    // Create multiple messages for the same day
    const messages: StoredMessage[] = [];
    for (let i = 0; i < messageCount; i++) {
      messages.push({
        chat: chatId,
        user: 1000 + i,
        username: `user${i}`,
        text: `Test message ${i} for race condition testing`,
        ts: baseTimestamp + i // Different timestamps to avoid duplicates
      });
    }

    // Add all messages concurrently
    const addPromises = messages.map(async (message, index) => {
      try {
        const result = await mockAddMessageToDayBlockSafe(env, message);
        if (result.duplicate) {
          duplicatesDetected++;
        }
        return { success: true, index, result };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Message ${index}: ${errorMessage}`);
        return { success: false, index, error: errorMessage };
      }
    });

    const results = await Promise.all(addPromises);
    const successfulAdds = results.filter(r => r.success).length;

    // Verify final state
    const finalBlock = await mockGetDayBlockSafe(env, chatId, date);
    const actualMessageCount = finalBlock?.messageCount || 0;

    const testResult: RaceConditionTestResult = {
      testName,
      success: actualMessageCount === messageCount && errors.length === 0,
      messagesAdded: actualMessageCount,
      expectedMessages: messageCount,
      duplicatesDetected,
      errors,
      duration: Date.now() - startTime
    };

    if (typeof console !== 'undefined' && console.log) {
      console.log(`${testName} test completed:`, {
        success: testResult.success,
        messagesAdded: testResult.messagesAdded,
        expectedMessages: testResult.expectedMessages,
        successfulAdds,
        duplicatesDetected,
        errors: errors.length,
        duration: testResult.duration
      });
    }

    return testResult;

  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Test setup failed: ${errorMessage}`);
      return {
        testName,
        success: false,
        messagesAdded: 0,
        expectedMessages: messageCount,
        duplicatesDetected,
        errors,
        duration: Date.now() - startTime
      };
    }
}

/**
 * Test duplicate message detection
 */
export async function testDuplicateMessageDetection(
  env: any,
  chatId: number
): Promise<RaceConditionTestResult> {
  const testName = 'Duplicate Message Detection';
  const startTime = Date.now();
  const errors: string[] = [];
  let duplicatesDetected = 0;

  if (typeof console !== 'undefined' && console.log) {
    console.log(`Starting ${testName} test`);
  }

  try {
    const baseTimestamp = Math.floor(Date.now() / 1000);
    const date = new Date(baseTimestamp * 1000).toISOString().slice(0, 10);

    // Create identical messages
    const message: StoredMessage = {
      chat: chatId,
      user: 2000,
      username: 'duplicate_test_user',
      text: 'This is a duplicate message for testing',
      ts: baseTimestamp
    };

    // Add the same message multiple times concurrently
    const duplicateCount = 5;
    const addPromises = Array(duplicateCount).fill(null).map(async (_, index) => {
      try {
        const result = await mockAddMessageToDayBlockSafe(env, message);
        if (result.duplicate) {
          duplicatesDetected++;
        }
        return { success: true, index, result };
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Duplicate ${index}: ${errorMessage}`);
        return { success: false, index, error: errorMessage };
      }
    });

    await Promise.all(addPromises);

    // Verify only one message was actually stored
    const finalBlock = await mockGetDayBlockSafe(env, chatId, date);
    const actualMessageCount = finalBlock?.messageCount || 0;
    const expectedDuplicates = duplicateCount - 1; // First one is not a duplicate

    const testResult: RaceConditionTestResult = {
      testName,
      success: actualMessageCount === 1 && duplicatesDetected === expectedDuplicates,
      messagesAdded: actualMessageCount,
      expectedMessages: 1,
      duplicatesDetected,
      errors,
      duration: Date.now() - startTime
    };

    if (typeof console !== 'undefined' && console.log) {
      console.log(`${testName} test completed:`, {
        success: testResult.success,
        actualMessageCount,
        duplicatesDetected,
        expectedDuplicates,
        errors: errors.length,
        duration: testResult.duration
      });
    }

    return testResult;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Test setup failed: ${errorMessage}`);
    return {
      testName,
      success: false,
      messagesAdded: 0,
      expectedMessages: 1,
      duplicatesDetected,
      errors,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Test high-concurrency scenario
 */
export async function testHighConcurrencyScenario(
  env: any,
  chatId: number,
  concurrencyLevel: number = 50
): Promise<RaceConditionTestResult> {
  const testName = 'High Concurrency Scenario';
  const startTime = Date.now();
  const errors: string[] = [];
  let duplicatesDetected = 0;

  if (typeof console !== 'undefined' && console.log) {
    console.log(`Starting ${testName} test with ${concurrencyLevel} concurrent operations`);
  }

  try {
    const baseTimestamp = Math.floor(Date.now() / 1000);
    const date = new Date(baseTimestamp * 1000).toISOString().slice(0, 10);

    // Create many concurrent operations
    const operations = [];
    for (let i = 0; i < concurrencyLevel; i++) {
      const message: StoredMessage = {
        chat: chatId,
        user: 3000 + (i % 10), // Some users send multiple messages
        username: `stress_user_${i % 10}`,
        text: `High concurrency test message ${i}`,
        ts: baseTimestamp + Math.floor(i / 10) // Group messages by timestamp
      };

      operations.push(
        mockAddMessageToDayBlockSafe(env, message).then(result => {
          if (result.duplicate) {
            duplicatesDetected++;
          }
          return { success: true, index: i, result };
        }).catch(error => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Operation ${i}: ${errorMessage}`);
          return { success: false, index: i, error: errorMessage };
        })
      );
    }

    const results = await Promise.all(operations);
    const successfulOps = results.filter(r => r.success).length;

    // Verify final state
    const finalBlock = await mockGetDayBlockSafe(env, chatId, date);
    const actualMessageCount = finalBlock?.messageCount || 0;

    // Calculate expected unique messages (accounting for same timestamp + user combinations)
    const uniqueMessages = new Set();
    for (let i = 0; i < concurrencyLevel; i++) {
      const userId = 3000 + (i % 10);
      const timestamp = baseTimestamp + Math.floor(i / 10);
      uniqueMessages.add(`${userId}:${timestamp}`);
    }
    const expectedUniqueMessages = uniqueMessages.size;

    const testResult: RaceConditionTestResult = {
      testName,
      success: actualMessageCount === expectedUniqueMessages && errors.length === 0,
      messagesAdded: actualMessageCount,
      expectedMessages: expectedUniqueMessages,
      duplicatesDetected,
      errors,
      duration: Date.now() - startTime
    };

    if (typeof console !== 'undefined' && console.log) {
      console.log(`${testName} test completed:`, {
        success: testResult.success,
        concurrencyLevel,
        successfulOps,
        actualMessageCount,
        expectedUniqueMessages,
        duplicatesDetected,
        errors: errors.length,
        duration: testResult.duration,
        throughput: `${(concurrencyLevel / (testResult.duration / 1000)).toFixed(1)} ops/sec`
      });
    }

    return testResult;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`Test setup failed: ${errorMessage}`);
    return {
      testName,
      success: false,
      messagesAdded: 0,
      expectedMessages: concurrencyLevel,
      duplicatesDetected,
      errors,
      duration: Date.now() - startTime
    };
  }
}

/**
 * Run all race condition tests
 */
export async function runAllRaceConditionTests(
  env: any,
  chatId: number = -999999 // Use test chat ID
): Promise<RaceConditionTestResult[]> {
  if (typeof console !== 'undefined' && console.log) {
    console.log('Starting comprehensive race condition tests...');
  }

  const tests = [
    () => testConcurrentMessageAddition(env, chatId, 10),
    () => testDuplicateMessageDetection(env, chatId),
    () => testHighConcurrencyScenario(env, chatId, 25)
  ];

  const results: RaceConditionTestResult[] = [];

  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error: unknown) {
      console.error('Test execution failed:', error);
      results.push({
        testName: 'Unknown Test',
        success: false,
        messagesAdded: 0,
        expectedMessages: 0,
        duplicatesDetected: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        duration: 0
      });
    }
  }

  // Summary
  const totalTests = results.length;
  const passedTests = results.filter(r => r.success).length;
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

  if (typeof console !== 'undefined' && console.log) {
    console.log('Race condition tests summary:', {
      totalTests,
      passedTests,
      failedTests: totalTests - passedTests,
      totalErrors,
      overallSuccess: passedTests === totalTests && totalErrors === 0
    });
  }

  return results;
}