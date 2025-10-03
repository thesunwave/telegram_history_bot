/**
 * Mock KV Storage Implementation
 * Provides comprehensive mock KVNamespace for testing
 */

import { vi } from 'vitest';
import type { KVNamespace, KVNamespaceListResult, KVNamespaceGetWithMetadataResult } from '@cloudflare/workers-types';

/**
 * Mock KV Storage Implementation
 */
export class MockKVStorage implements KVNamespace {
  private storage = new Map<string, { value: string; metadata?: any; expiration?: number }>();
  private shouldFail = false;
  private failureError = 'KV operation failed';
  private operationDelay = 0;
  private operationLog: Array<{ operation: string; key: string; timestamp: Date }> = [];

  // Mock functions for testing
  public get = vi.fn().mockImplementation(async (key: string, typeOrOptions?: string | any) => {
    await this.simulateDelay();
    this.logOperation('get', key);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const item = this.storage.get(key);
    if (!item) return null;

    // Check expiration
    if (item.expiration && Date.now() > item.expiration) {
      this.storage.delete(key);
      return null;
    }

    // Handle different return types
    // If second parameter is a string, it's the type (Cloudflare KV API)
    const type = typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions?.type;
    
    if (type === 'json') {
      try {
        return JSON.parse(item.value);
      } catch {
        return null;
      }
    }

    if (type === 'arrayBuffer') {
      return new TextEncoder().encode(item.value).buffer;
    }

    if (type === 'stream') {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(item.value));
          controller.close();
        }
      });
    }

    return item.value;
  });

  public getWithMetadata = vi.fn().mockImplementation(async (key: string, options?: any): Promise<KVNamespaceGetWithMetadataResult<any, any>> => {
    await this.simulateDelay();
    this.logOperation('getWithMetadata', key);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const item = this.storage.get(key);
    if (!item) {
      return { value: null, metadata: null };
    }

    // Check expiration
    if (item.expiration && Date.now() > item.expiration) {
      this.storage.delete(key);
      return { value: null, metadata: null };
    }

    let value = item.value;
    if (options?.type === 'json') {
      try {
        value = JSON.parse(item.value);
      } catch {
        value = null;
      }
    }

    return {
      value,
      metadata: item.metadata || null
    };
  });

  public put = vi.fn().mockImplementation(async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: any) => {
    await this.simulateDelay();
    this.logOperation('put', key);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    let stringValue: string;
    
    if (typeof value === 'string') {
      stringValue = value;
    } else if (value instanceof ArrayBuffer) {
      stringValue = new TextDecoder().decode(value);
    } else if (value instanceof ReadableStream) {
      // For testing purposes, we'll simulate reading the stream
      stringValue = 'stream-content';
    } else {
      stringValue = new TextDecoder().decode(value as ArrayBufferView);
    }

    const item: { value: string; metadata?: any; expiration?: number } = {
      value: stringValue
    };

    if (options?.metadata) {
      item.metadata = options.metadata;
    }

    if (options?.expirationTtl) {
      item.expiration = Date.now() + (options.expirationTtl * 1000);
    } else if (options?.expiration) {
      item.expiration = options.expiration * 1000;
    }

    this.storage.set(key, item);
    return undefined;
  });

  public delete = vi.fn().mockImplementation(async (key: string) => {
    await this.simulateDelay();
    this.logOperation('delete', key);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const existed = this.storage.has(key);
    this.storage.delete(key);
    return undefined;
  });

  public list = vi.fn().mockImplementation(async (options?: any): Promise<KVNamespaceListResult<any, string>> => {
    await this.simulateDelay();
    this.logOperation('list', options?.prefix || '*');

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    let keys = Array.from(this.storage.keys());

    // Apply prefix filter
    if (options?.prefix) {
      keys = keys.filter(key => key.startsWith(options.prefix));
    }

    // Apply cursor (simple implementation)
    if (options?.cursor) {
      const cursorIndex = keys.indexOf(options.cursor);
      if (cursorIndex >= 0) {
        keys = keys.slice(cursorIndex + 1);
      }
    }

    // Apply limit
    let list_complete = true;
    if (options?.limit && keys.length > options.limit) {
      keys = keys.slice(0, options.limit);
      list_complete = false;
    }

    const keyObjects = keys.map(name => {
      const item = this.storage.get(name)!;
      return {
        name,
        expiration: item.expiration ? Math.floor(item.expiration / 1000) : undefined,
        metadata: item.metadata
      };
    });

    return {
      keys: keyObjects,
      list_complete,
      cursor: list_complete ? undefined : keys[keys.length - 1]
    };
  });

  /**
   * Simulate operation delay
   */
  private async simulateDelay(): Promise<void> {
    if (this.operationDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.operationDelay));
    }
  }

  /**
   * Log operation for testing
   */
  private logOperation(operation: string, key: string): void {
    this.operationLog.push({ operation, key, timestamp: new Date() });
  }

  /**
   * Set data directly (for testing setup)
   */
  setData(key: string, value: string, metadata?: any, expirationTtl?: number): void {
    const item: { value: string; metadata?: any; expiration?: number } = { value };
    
    if (metadata) {
      item.metadata = metadata;
    }
    
    if (expirationTtl) {
      item.expiration = Date.now() + (expirationTtl * 1000);
    }
    
    this.storage.set(key, item);
  }

  /**
   * Get all data (for testing verification)
   */
  getAllData(): Map<string, { value: string; metadata?: any; expiration?: number }> {
    return new Map(this.storage);
  }

  /**
   * Clear all data
   */
  clearData(): void {
    this.storage.clear();
    this.operationLog = [];
  }

  /**
   * Configure failure mode
   */
  configureFail(shouldFail: boolean, error: string = 'KV operation failed'): void {
    this.shouldFail = shouldFail;
    this.failureError = error;
  }

  /**
   * Configure operation delay
   */
  configureDelay(delay: number): void {
    this.operationDelay = delay;
  }

  /**
   * Get operation log
   */
  getOperationLog(): Array<{ operation: string; key: string; timestamp: Date }> {
    return [...this.operationLog];
  }

  /**
   * Clear operation log
   */
  clearOperationLog(): void {
    this.operationLog = [];
  }

  /**
   * Get operation count
   */
  getOperationCount(): number {
    return this.operationLog.length;
  }

  /**
   * Check if key exists
   */
  hasKey(key: string): boolean {
    const item = this.storage.get(key);
    if (!item) return false;
    
    // Check expiration
    if (item.expiration && Date.now() > item.expiration) {
      this.storage.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Get key count
   */
  getKeyCount(): number {
    // Clean up expired keys first
    const now = Date.now();
    for (const [key, item] of this.storage.entries()) {
      if (item.expiration && now > item.expiration) {
        this.storage.delete(key);
      }
    }
    return this.storage.size;
  }

  /**
   * Reset all mocks and data
   */
  reset(): void {
    this.clearData();
    this.shouldFail = false;
    this.operationDelay = 0;
    vi.clearAllMocks();
  }
}

/**
 * KV Mock Factory
 */
export class KVMockFactory {
  /**
   * Create empty KV storage
   */
  static createEmptyKV(): MockKVStorage {
    return new MockKVStorage();
  }

  /**
   * Create KV with realistic test data
   */
  static createRealisticKV(): MockKVStorage {
    const kv = new MockKVStorage();
    
    // Add some realistic test data
    kv.setData('chat:-1001234567890:settings', JSON.stringify({
      notifications: true,
      language: 'ru',
      timezone: 'UTC'
    }));
    
    kv.setData('user:123456:stats', JSON.stringify({
      totalViolations: 5,
      lastViolation: new Date().toISOString(),
      riskLevel: 'medium'
    }));
    
    kv.setData('summary:chat:-1001234567890:2024-01-15', 'Daily chat summary content');
    
    kv.setData('counters:chat:-1001234567890:violations', '25');
    kv.setData('counters:chat:-1001234567890:messages', '1250');
    
    return kv;
  }

  /**
   * Create KV with high activity data
   */
  static createHighActivityKV(): MockKVStorage {
    const kv = new MockKVStorage();
    
    // Add high activity data
    for (let i = 0; i < 100; i++) {
      kv.setData(`user:${123456 + i}:violations`, `${Math.floor(Math.random() * 20) + 5}`);
      kv.setData(`user:${123456 + i}:profanity`, `${Math.floor(Math.random() * 50) + 10}`);
    }
    
    // Add chat summaries for multiple days
    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      kv.setData(`summary:chat:-1001234567890:${dateStr}`, `Summary for ${dateStr}`);
    }
    
    return kv;
  }

  /**
   * Create KV that fails operations
   */
  static createFailingKV(error: string = 'KV service unavailable'): MockKVStorage {
    const kv = new MockKVStorage();
    kv.configureFail(true, error);
    return kv;
  }

  /**
   * Create slow KV for performance testing
   */
  static createSlowKV(delay: number = 1000): MockKVStorage {
    const kv = new MockKVStorage();
    kv.configureDelay(delay);
    return kv;
  }

  /**
   * Create KV with expiring data
   */
  static createExpiringKV(): MockKVStorage {
    const kv = new MockKVStorage();
    
    // Add data with short expiration
    kv.setData('temp:data1', 'expires soon', undefined, 1); // 1 second
    kv.setData('temp:data2', 'expires later', undefined, 60); // 1 minute
    kv.setData('permanent:data', 'never expires');
    
    return kv;
  }

  /**
   * Create KV with specific scenario
   */
  static createScenarioKV(scenario: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow' | 'expiring'): MockKVStorage {
    switch (scenario) {
      case 'empty':
        return this.createEmptyKV();
      case 'realistic':
        return this.createRealisticKV();
      case 'high-activity':
        return this.createHighActivityKV();
      case 'failing':
        return this.createFailingKV();
      case 'slow':
        return this.createSlowKV();
      case 'expiring':
        return this.createExpiringKV();
      default:
        return this.createEmptyKV();
    }
  }
}

/**
 * KV test helpers
 */
export class KVTestHelpers {
  /**
   * Verify operation was performed
   */
  static verifyOperation(kv: MockKVStorage, operation: string, key?: string): boolean {
    const log = kv.getOperationLog();
    return log.some(entry => {
      if (key) {
        return entry.operation === operation && entry.key === key;
      }
      return entry.operation === operation;
    });
  }

  /**
   * Get operations matching criteria
   */
  static getOperationsMatching(kv: MockKVStorage, operation?: string, keyPattern?: string | RegExp): Array<{ operation: string; key: string; timestamp: Date }> {
    const log = kv.getOperationLog();
    return log.filter(entry => {
      if (operation && entry.operation !== operation) {
        return false;
      }
      
      if (keyPattern) {
        if (typeof keyPattern === 'string') {
          return entry.key.includes(keyPattern);
        }
        return keyPattern.test(entry.key);
      }
      
      return true;
    });
  }

  /**
   * Assert operation count
   */
  static assertOperationCount(kv: MockKVStorage, expectedCount: number): void {
    const actualCount = kv.getOperationCount();
    if (actualCount !== expectedCount) {
      throw new Error(`Expected ${expectedCount} operations, got ${actualCount}`);
    }
  }

  /**
   * Assert key exists
   */
  static assertKeyExists(kv: MockKVStorage, key: string): void {
    if (!kv.hasKey(key)) {
      throw new Error(`Expected key "${key}" to exist`);
    }
  }

  /**
   * Assert key does not exist
   */
  static assertKeyNotExists(kv: MockKVStorage, key: string): void {
    if (kv.hasKey(key)) {
      throw new Error(`Expected key "${key}" to not exist`);
    }
  }

  /**
   * Assert key count
   */
  static assertKeyCount(kv: MockKVStorage, expectedCount: number): void {
    const actualCount = kv.getKeyCount();
    if (actualCount !== expectedCount) {
      throw new Error(`Expected ${expectedCount} keys, got ${actualCount}`);
    }
  }

  /**
   * Wait for key to expire
   */
  static async waitForExpiration(kv: MockKVStorage, key: string, timeout: number = 5000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (!kv.hasKey(key)) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error(`Key "${key}" did not expire within ${timeout}ms`);
  }

  /**
   * Create KV with test scenario
   */
  static async withTestKV<T>(
    scenario: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow' | 'expiring',
    testFn: (kv: MockKVStorage) => Promise<T>
  ): Promise<T> {
    const kv = KVMockFactory.createScenarioKV(scenario);
    
    try {
      return await testFn(kv);
    } finally {
      kv.reset();
    }
  }

  /**
   * Seed KV with test data
   */
  static seedKV(kv: MockKVStorage, data: Record<string, any>): void {
    Object.entries(data).forEach(([key, value]) => {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
      kv.setData(key, stringValue);
    });
  }

  /**
   * Create KV namespace pair (HISTORY and COUNTERS)
   */
  static createKVNamespacePair(scenario: 'empty' | 'realistic' | 'high-activity' = 'realistic'): {
    HISTORY: MockKVStorage;
    COUNTERS: MockKVStorage;
  } {
    const HISTORY = KVMockFactory.createScenarioKV(scenario);
    const COUNTERS = KVMockFactory.createScenarioKV(scenario);
    
    if (scenario === 'realistic') {
      // Add specific data for each namespace
      this.seedKV(HISTORY, {
        'chat:-1001234567890:2024-01-15': JSON.stringify([
          { id: 1, text: 'Hello', userId: 123456, timestamp: Date.now() - 3600000 },
          { id: 2, text: 'Hi there', userId: 789012, timestamp: Date.now() - 1800000 }
        ]),
        'summary:chat:-1001234567890:2024-01-15': 'Friendly conversation'
      });
      
      this.seedKV(COUNTERS, {
        'user:123456:violations': '5',
        'user:123456:profanity': '12',
        'chat:-1001234567890:total_violations': '25',
        'chat:-1001234567890:total_messages': '1250'
      });
    }
    
    return { HISTORY, COUNTERS };
  }
}