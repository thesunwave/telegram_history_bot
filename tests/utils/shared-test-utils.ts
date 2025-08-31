/**
 * Shared Test Utilities and Helper Functions
 * Provides common utilities used across all test files
 */

import { vi } from 'vitest';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { createMockD1Database, createMockKVNamespace, createMockEnv } from '../test-utils';
import type { Env } from '../../src/env';

/**
 * Test data generators for common test scenarios
 */
export class TestDataGenerators {
  /**
   * Generate random string
   */
  static randomString(length: number = 10): string {
    return Math.random().toString(36).substring(2, 2 + length);
  }

  /**
   * Generate random number in range
   */
  static randomNumber(min: number = 0, max: number = 100): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Generate random date within range
   */
  static randomDate(daysBack: number = 30): Date {
    const now = new Date();
    const pastTime = now.getTime() - (daysBack * 24 * 60 * 60 * 1000);
    const randomTime = pastTime + Math.random() * (now.getTime() - pastTime);
    return new Date(randomTime);
  }

  /**
   * Generate random user ID
   */
  static randomUserId(): number {
    return Math.floor(Math.random() * 1000000) + 100000;
  }

  /**
   * Generate random chat ID (negative for groups)
   */
  static randomChatId(): number {
    return -Math.floor(Math.random() * 1000000000) - 1000000000;
  }

  /**
   * Generate random message ID
   */
  static randomMessageId(): number {
    return Math.floor(Math.random() * 1000000) + 1;
  }

  /**
   * Generate test email
   */
  static testEmail(domain: string = 'test.com'): string {
    return `test-${this.randomString(8)}@${domain}`;
  }

  /**
   * Generate test username
   */
  static testUsername(): string {
    return `testuser_${this.randomString(6)}`;
  }

  /**
   * Generate test message text
   */
  static testMessage(): string {
    const messages = [
      'Hello, how are you?',
      'This is a test message',
      'Good morning everyone',
      'What\'s the weather like today?',
      'I hope everyone is doing well',
      'Let\'s discuss the latest news',
      'Has anyone seen the new movie?',
      'The meeting is scheduled for tomorrow'
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  /**
   * Generate test violation message
   */
  static testViolationMessage(): string {
    const violations = [
      'This contains hate speech',
      'Threatening language detected',
      'Discriminatory content found',
      'Extremist propaganda identified',
      'Incitement to violence detected'
    ];
    return violations[Math.floor(Math.random() * violations.length)];
  }
}

/**
 * Test assertion helpers
 */
export class TestAssertions {
  /**
   * Assert that a value is defined and not null
   */
  static assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
    if (value === null || value === undefined) {
      throw new Error(message || 'Expected value to be defined');
    }
  }

  /**
   * Assert that an array has expected length
   */
  static assertArrayLength<T>(array: T[], expectedLength: number, message?: string): void {
    if (array.length !== expectedLength) {
      throw new Error(
        message || `Expected array length ${expectedLength}, got ${array.length}`
      );
    }
  }

  /**
   * Assert that an object has expected properties
   */
  static assertHasProperties(obj: any, properties: string[], message?: string): void {
    const missing = properties.filter(prop => !(prop in obj));
    if (missing.length > 0) {
      throw new Error(
        message || `Object missing properties: ${missing.join(', ')}`
      );
    }
  }

  /**
   * Assert that a value is within expected range
   */
  static assertInRange(value: number, min: number, max: number, message?: string): void {
    if (value < min || value > max) {
      throw new Error(
        message || `Expected value ${value} to be between ${min} and ${max}`
      );
    }
  }

  /**
   * Assert that a string matches pattern
   */
  static assertMatches(value: string, pattern: RegExp, message?: string): void {
    if (!pattern.test(value)) {
      throw new Error(
        message || `Expected "${value}" to match pattern ${pattern}`
      );
    }
  }

  /**
   * Assert that a promise rejects with expected error
   */
  static async assertRejects(
    promise: Promise<any>,
    expectedError?: string | RegExp,
    message?: string
  ): Promise<void> {
    try {
      await promise;
      throw new Error(message || 'Expected promise to reject');
    } catch (error: unknown) {
      if (expectedError) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (typeof expectedError === 'string') {
          if (!errorMessage.includes(expectedError)) {
            throw new Error(`Expected error to contain "${expectedError}", got "${errorMessage}"`);
          }
        } else if (!expectedError.test(errorMessage)) {
          throw new Error(`Expected error to match ${expectedError}, got "${errorMessage}"`);
        }
      }
    }
  }

  /**
   * Assert that a function throws with expected error
   */
  static assertThrows(
    fn: () => any,
    expectedError?: string | RegExp,
    message?: string
  ): void {
    try {
      fn();
      throw new Error(message || 'Expected function to throw');
    } catch (error: unknown) {
      if (expectedError) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (typeof expectedError === 'string') {
          if (!errorMessage.includes(expectedError)) {
            throw new Error(`Expected error to contain "${expectedError}", got "${errorMessage}"`);
          }
        } else if (!expectedError.test(errorMessage)) {
          throw new Error(`Expected error to match ${expectedError}, got "${errorMessage}"`);
        }
      }
    }
  }
}

/**
 * Test timing utilities
 */
export class TestTiming {
  /**
   * Wait for specified duration
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for condition to be true
   */
  static async waitFor(
    condition: () => boolean | Promise<boolean>,
    timeout: number = 5000,
    interval: number = 100
  ): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return;
      }
      await this.wait(interval);
    }
    
    throw new Error(`Condition not met within ${timeout}ms`);
  }

  /**
   * Measure execution time
   */
  static async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;
    return { result, duration };
  }

  /**
   * Create timeout promise
   */
  static timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
      )
    ]);
  }
}

/**
 * Mock factory for creating various types of mocks
 */
export class MockFactory {
  /**
   * Create mock function with call tracking
   */
  static createMockFunction<T extends (...args: any[]) => any>(
    implementation?: T
  ): T & { calls: Parameters<T>[]; results: ReturnType<T>[] } {
    const calls: Parameters<T>[] = [];
    const results: ReturnType<T>[] = [];
    
    const mockFn = vi.fn((...args: Parameters<T>) => {
      calls.push(args);
      const result = implementation ? implementation(...args) : undefined;
      results.push(result);
      return result;
    }) as any;
    
    mockFn.calls = calls;
    mockFn.results = results;
    
    return mockFn;
  }

  /**
   * Create mock object with specified methods
   */
  static createMockObject<T extends Record<string, any>>(
    methods: Partial<T> = {}
  ): T {
    const mock = {} as T;
    
    for (const [key, value] of Object.entries(methods)) {
      if (typeof value === 'function') {
        mock[key as keyof T] = vi.fn(value) as any;
      } else {
        mock[key as keyof T] = value;
      }
    }
    
    return mock;
  }

  /**
   * Create mock with automatic method generation
   */
  static createAutoMock<T>(prototype: any): T {
    const mock = {} as T;
    const proto = prototype.prototype || prototype;
    
    Object.getOwnPropertyNames(proto).forEach(name => {
      if (name !== 'constructor' && typeof proto[name] === 'function') {
        (mock as any)[name] = vi.fn();
      }
    });
    
    return mock;
  }

  /**
   * Create spy on object method
   */
  static createSpy<T extends Record<string, any>, K extends keyof T>(
    object: T,
    method: K
  ): T[K] {
    return vi.spyOn(object, method);
  }
}

/**
 * Test environment builders
 */
export class TestEnvironmentBuilder {
  private env: Partial<Env> = {};
  private mocks: Record<string, any> = {};

  /**
   * Set database mock
   */
  withDatabase(db?: D1Database): this {
    this.env.DB = db || createMockD1Database();
    return this;
  }

  /**
   * Set KV namespace mock
   */
  withKV(kv?: KVNamespace): this {
    this.env.HISTORY = kv || createMockKVNamespace();
    this.env.COUNTERS = kv || createMockKVNamespace();
    return this;
  }

  /**
   * Set AI mock
   */
  withAI(responses: Record<string, any> = {}): this {
    this.env.AI = {
      run: vi.fn().mockImplementation((model: string, options: any) => {
        const key = `${model}-${JSON.stringify(options)}`;
        return Promise.resolve(responses[key] || { response: 'Mock AI response' });
      })
    } as any;
    return this;
  }

  /**
   * Set environment variables
   */
  withEnvVars(vars: Partial<Env>): this {
    Object.assign(this.env, vars);
    return this;
  }

  /**
   * Add custom mock
   */
  withMock(name: string, mock: any): this {
    this.mocks[name] = mock;
    return this;
  }

  /**
   * Build the environment
   */
  build(): Env & Record<string, any> {
    const baseEnv = createMockEnv(this.env);
    return { ...baseEnv, ...this.mocks };
  }
}

/**
 * Test scenario builders
 */
export class TestScenarioBuilder {
  /**
   * Build high-activity scenario
   */
  static buildHighActivityScenario() {
    return new TestEnvironmentBuilder()
      .withDatabase()
      .withKV()
      .withAI({
        'violation-analysis': { hasViolations: true, violations: [{ article: '282', severity: 8 }] },
        'profanity-analysis': { hasProfanity: true, severity: 7 }
      })
      .withEnvVars({
        TOKEN: 'test-token',
        SECRET: 'test-secret'
      });
  }

  /**
   * Build low-activity scenario
   */
  static buildLowActivityScenario() {
    return new TestEnvironmentBuilder()
      .withDatabase()
      .withKV()
      .withAI({
        'violation-analysis': { hasViolations: false, violations: [] },
        'profanity-analysis': { hasProfanity: false, severity: 0 }
      })
      .withEnvVars({
        TOKEN: 'test-token',
        SECRET: 'test-secret'
      });
  }

  /**
   * Build error scenario
   */
  static buildErrorScenario() {
    const db = createMockD1Database();
    const kv = createMockKVNamespace();
    
    // Make operations fail
    (db.prepare as any).mockImplementation(() => ({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockRejectedValue(new Error('Database error')),
        all: vi.fn().mockRejectedValue(new Error('Database error')),
        first: vi.fn().mockRejectedValue(new Error('Database error'))
      })
    }));
    
    (kv.get as any).mockRejectedValue(new Error('KV error'));
    (kv.put as any).mockRejectedValue(new Error('KV error'));
    
    return new TestEnvironmentBuilder()
      .withDatabase(db)
      .withKV(kv)
      .withAI()
      .withEnvVars({
        TOKEN: 'test-token',
        SECRET: 'test-secret'
      });
  }
}

/**
 * Test validation utilities
 */
export class TestValidation {
  /**
   * Validate test result structure
   */
  static validateResult(result: any, expectedStructure: any): boolean {
    return this.validateStructure(result, expectedStructure);
  }

  /**
   * Validate object structure recursively
   */
  private static validateStructure(obj: any, structure: any): boolean {
    if (typeof structure !== 'object' || structure === null) {
      return typeof obj === typeof structure;
    }

    if (Array.isArray(structure)) {
      if (!Array.isArray(obj)) return false;
      if (structure.length === 0) return true;
      return obj.every(item => this.validateStructure(item, structure[0]));
    }

    for (const key in structure) {
      if (!(key in obj)) return false;
      if (!this.validateStructure(obj[key], structure[key])) return false;
    }

    return true;
  }

  /**
   * Validate API response format
   */
  static validateApiResponse(response: any): boolean {
    return (
      typeof response === 'object' &&
      response !== null &&
      'success' in response &&
      typeof response.success === 'boolean'
    );
  }

  /**
   * Validate database result format
   */
  static validateDatabaseResult(result: any): boolean {
    return (
      typeof result === 'object' &&
      result !== null &&
      'results' in result &&
      Array.isArray(result.results)
    );
  }
}

/**
 * Comprehensive test utilities factory
 */
export class TestUtils {
  static readonly Data = TestDataGenerators;
  static readonly Assert = TestAssertions;
  static readonly Timing = TestTiming;
  static readonly Mock = MockFactory;
  static readonly Environment = TestEnvironmentBuilder;
  static readonly Scenario = TestScenarioBuilder;
  static readonly Validation = TestValidation;

  /**
   * Create complete test setup
   */
  static createTestSetup(scenario: 'basic' | 'high-activity' | 'low-activity' | 'error' = 'basic') {
    let builder;
    
    switch (scenario) {
      case 'high-activity':
        builder = this.Scenario.buildHighActivityScenario();
        break;
      case 'low-activity':
        builder = this.Scenario.buildLowActivityScenario();
        break;
      case 'error':
        builder = this.Scenario.buildErrorScenario();
        break;
      default:
        builder = new this.Environment();
    }
    
    return {
      env: builder.build(),
      data: {
        userId: this.Data.randomUserId(),
        chatId: this.Data.randomChatId(),
        messageId: this.Data.randomMessageId(),
        message: this.Data.testMessage()
      },
      helpers: {
        wait: this.Timing.wait,
        waitFor: this.Timing.waitFor,
        measureTime: this.Timing.measureTime,
        assertDefined: this.Assert.assertDefined,
        assertArrayLength: this.Assert.assertArrayLength
      }
    };
  }

  /**
   * Create test with automatic cleanup
   */
  static async withTestSetup<T>(
    scenario: 'basic' | 'high-activity' | 'low-activity' | 'error',
    testFn: (setup: ReturnType<typeof TestUtils.createTestSetup>) => Promise<T>
  ): Promise<T> {
    const setup = this.createTestSetup(scenario);
    
    try {
      return await testFn(setup);
    } finally {
      // Cleanup mocks
      vi.clearAllMocks();
    }
  }
}