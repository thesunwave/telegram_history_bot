/**
 * Test Isolation Utilities
 * Provides mechanisms for isolating tests and preventing interference
 */

import { vi } from 'vitest';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { createMockD1Database, createMockKVNamespace } from '../test-utils';

/**
 * Test isolation manager for ensuring clean test environments
 */
export class TestIsolationManager {
  private static instance: TestIsolationManager;
  private testStates: Map<string, any> = new Map();
  private cleanupFunctions: Map<string, (() => Promise<void>)[]> = new Map();

  private constructor() {}

  static getInstance(): TestIsolationManager {
    if (!TestIsolationManager.instance) {
      TestIsolationManager.instance = new TestIsolationManager();
    }
    return TestIsolationManager.instance;
  }

  /**
   * Create isolated test environment
   */
  async createIsolatedEnvironment(testId: string): Promise<{
    db: D1Database;
    kv: KVNamespace;
    cleanup: () => Promise<void>;
  }> {
    const db = createMockD1Database();
    const kv = createMockKVNamespace();
    const cleanupFunctions: (() => Promise<void>)[] = [];

    // Store test state
    this.testStates.set(testId, { db, kv });
    this.cleanupFunctions.set(testId, cleanupFunctions);

    const cleanup = async () => {
      // Execute all cleanup functions
      const cleanups = this.cleanupFunctions.get(testId) || [];
      await Promise.all(cleanups.map(fn => fn()));
      
      // Clear test state
      this.testStates.delete(testId);
      this.cleanupFunctions.delete(testId);
      
      // Reset mocks
      vi.clearAllMocks();
    };

    return { db, kv, cleanup };
  }

  /**
   * Register cleanup function for a test
   */
  registerCleanup(testId: string, cleanupFn: () => Promise<void>): void {
    const cleanups = this.cleanupFunctions.get(testId) || [];
    cleanups.push(cleanupFn);
    this.cleanupFunctions.set(testId, cleanups);
  }

  /**
   * Get test state
   */
  getTestState(testId: string): any {
    return this.testStates.get(testId);
  }

  /**
   * Clear all test states (for global cleanup)
   */
  async clearAllTestStates(): Promise<void> {
    const allCleanups = Array.from(this.cleanupFunctions.values()).flat();
    await Promise.all(allCleanups.map(fn => fn()));
    
    this.testStates.clear();
    this.cleanupFunctions.clear();
    vi.clearAllMocks();
  }
}

/**
 * Test environment factory for creating isolated test environments
 */
export class TestEnvironmentFactory {
  /**
   * Create isolated test environment with automatic cleanup
   */
  static async createIsolatedEnvironment(testName: string) {
    const isolationManager = TestIsolationManager.getInstance();
    const testId = `${testName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return isolationManager.createIsolatedEnvironment(testId);
  }

  /**
   * Create environment with pre-seeded data
   */
  static async createSeededEnvironment(
    testName: string,
    seedData: {
      dbData?: any[];
      kvData?: Record<string, string>;
    } = {}
  ) {
    const { db, kv, cleanup } = await this.createIsolatedEnvironment(testName);
    
    // Seed database data
    if (seedData.dbData) {
      const mockPrepare = db.prepare as any;
      mockPrepare.mockImplementation((query: string) => ({
        bind: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({ results: seedData.dbData }),
          first: vi.fn().mockResolvedValue(seedData.dbData?.[0] || null),
          run: vi.fn().mockResolvedValue({ success: true })
        }),
        all: vi.fn().mockResolvedValue({ results: seedData.dbData }),
        first: vi.fn().mockResolvedValue(seedData.dbData?.[0] || null),
        run: vi.fn().mockResolvedValue({ success: true })
      }));
    }

    // Seed KV data
    if (seedData.kvData) {
      const mockGet = kv.get as any;
      mockGet.mockImplementation((key: string) => {
        return Promise.resolve(seedData.kvData?.[key] || null);
      });
    }

    return { db, kv, cleanup };
  }

  /**
   * Create environment for specific test scenario
   */
  static async createScenarioEnvironment(
    testName: string,
    scenario: 'empty' | 'basic' | 'complex' | 'error-prone'
  ) {
    switch (scenario) {
      case 'empty':
        return this.createIsolatedEnvironment(testName);
        
      case 'basic':
        return this.createSeededEnvironment(testName, {
          dbData: [
            { id: 1, user_id: 123456, chat_id: -1001234567890, article: '282', severity: 5 }
          ],
          kvData: {
            'test-key': 'test-value'
          }
        });
        
      case 'complex':
        return this.createSeededEnvironment(testName, {
          dbData: Array.from({ length: 50 }, (_, i) => ({
            id: i + 1,
            user_id: 123456 + (i % 10),
            chat_id: -1001234567890,
            article: ['282', '213', '319'][i % 3],
            severity: Math.floor(Math.random() * 10) + 1
          })),
          kvData: Object.fromEntries(
            Array.from({ length: 20 }, (_, i) => [`key-${i}`, `value-${i}`])
          )
        });
        
      case 'error-prone':
        const { db, kv, cleanup } = await this.createIsolatedEnvironment(testName);
        
        // Make operations fail randomly
        const mockPrepare = db.prepare as any;
        mockPrepare.mockImplementation(() => ({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockImplementation(() => {
              if (Math.random() < 0.3) {
                return Promise.reject(new Error('Database error'));
              }
              return Promise.resolve({ results: [] });
            }),
            first: vi.fn().mockImplementation(() => {
              if (Math.random() < 0.3) {
                return Promise.reject(new Error('Database error'));
              }
              return Promise.resolve(null);
            }),
            run: vi.fn().mockImplementation(() => {
              if (Math.random() < 0.3) {
                return Promise.reject(new Error('Database error'));
              }
              return Promise.resolve({ success: true });
            })
          })
        }));
        
        const mockGet = kv.get as any;
        mockGet.mockImplementation(() => {
          if (Math.random() < 0.3) {
            return Promise.reject(new Error('KV error'));
          }
          return Promise.resolve(null);
        });
        
        return { db, kv, cleanup };
        
      default:
        return this.createIsolatedEnvironment(testName);
    }
  }
}

/**
 * Test state manager for managing test data and state
 */
export class TestStateManager {
  private states: Map<string, any> = new Map();

  /**
   * Save test state
   */
  saveState(key: string, state: any): void {
    this.states.set(key, JSON.parse(JSON.stringify(state))); // Deep clone
  }

  /**
   * Load test state
   */
  loadState(key: string): any {
    const state = this.states.get(key);
    return state ? JSON.parse(JSON.stringify(state)) : null; // Deep clone
  }

  /**
   * Clear specific state
   */
  clearState(key: string): void {
    this.states.delete(key);
  }

  /**
   * Clear all states
   */
  clearAllStates(): void {
    this.states.clear();
  }

  /**
   * Create state snapshot
   */
  createSnapshot(key: string): string {
    const state = this.states.get(key);
    return state ? JSON.stringify(state) : '';
  }

  /**
   * Restore from snapshot
   */
  restoreFromSnapshot(key: string, snapshot: string): void {
    try {
      const state = JSON.parse(snapshot);
      this.states.set(key, state);
    } catch (error: unknown) {
      console.error('Failed to restore from snapshot:', error);
    }
  }
}

/**
 * Mock reset utilities for cleaning up mocks between tests
 */
export class MockResetManager {
  private static registeredMocks: Set<any> = new Set();

  /**
   * Register a mock for automatic cleanup
   */
  static registerMock(mock: any): void {
    this.registeredMocks.add(mock);
  }

  /**
   * Reset all registered mocks
   */
  static resetAllMocks(): void {
    this.registeredMocks.forEach(mock => {
      if (mock.mockReset) {
        mock.mockReset();
      } else if (mock.mockClear) {
        mock.mockClear();
      }
    });
  }

  /**
   * Clear all registered mocks
   */
  static clearAllMocks(): void {
    this.registeredMocks.forEach(mock => {
      if (mock.mockClear) {
        mock.mockClear();
      }
    });
  }

  /**
   * Restore all registered mocks
   */
  static restoreAllMocks(): void {
    this.registeredMocks.forEach(mock => {
      if (mock.mockRestore) {
        mock.mockRestore();
      }
    });
    this.registeredMocks.clear();
  }
}

/**
 * Test timeout manager for handling test timeouts
 */
export class TestTimeoutManager {
  private timeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Set timeout for a test
   */
  setTimeout(testId: string, callback: () => void, delay: number): void {
    this.clearTimeout(testId); // Clear existing timeout
    const timeout = setTimeout(callback, delay);
    this.timeouts.set(testId, timeout);
  }

  /**
   * Clear timeout for a test
   */
  clearTimeout(testId: string): void {
    const timeout = this.timeouts.get(testId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(testId);
    }
  }

  /**
   * Clear all timeouts
   */
  clearAllTimeouts(): void {
    this.timeouts.forEach(timeout => clearTimeout(timeout));
    this.timeouts.clear();
  }
}

/**
 * Test resource manager for managing test resources
 */
export class TestResourceManager {
  private resources: Map<string, any> = new Map();
  private cleanupFunctions: Map<string, () => Promise<void>> = new Map();

  /**
   * Register a resource with cleanup function
   */
  registerResource(id: string, resource: any, cleanup: () => Promise<void>): void {
    this.resources.set(id, resource);
    this.cleanupFunctions.set(id, cleanup);
  }

  /**
   * Get a resource
   */
  getResource(id: string): any {
    return this.resources.get(id);
  }

  /**
   * Cleanup a specific resource
   */
  async cleanupResource(id: string): Promise<void> {
    const cleanup = this.cleanupFunctions.get(id);
    if (cleanup) {
      await cleanup();
    }
    this.resources.delete(id);
    this.cleanupFunctions.delete(id);
  }

  /**
   * Cleanup all resources
   */
  async cleanupAllResources(): Promise<void> {
    const cleanupPromises = Array.from(this.cleanupFunctions.values()).map(fn => fn());
    await Promise.all(cleanupPromises);
    
    this.resources.clear();
    this.cleanupFunctions.clear();
  }
}

/**
 * Comprehensive test isolation utilities
 */
export class TestIsolationUtils {
  private static isolationManager = TestIsolationManager.getInstance();
  private static stateManager = new TestStateManager();
  private static timeoutManager = new TestTimeoutManager();
  private static resourceManager = new TestResourceManager();

  /**
   * Create fully isolated test environment
   */
  static async createIsolatedTest(testName: string) {
    const environment = await TestEnvironmentFactory.createIsolatedEnvironment(testName);
    
    return {
      ...environment,
      saveState: (key: string, state: any) => this.stateManager.saveState(key, state),
      loadState: (key: string) => this.stateManager.loadState(key),
      setTimeout: (callback: () => void, delay: number) => 
        this.timeoutManager.setTimeout(testName, callback, delay),
      registerResource: (id: string, resource: any, cleanup: () => Promise<void>) =>
        this.resourceManager.registerResource(id, resource, cleanup),
      cleanup: async () => {
        await environment.cleanup();
        await this.resourceManager.cleanupAllResources();
        this.timeoutManager.clearAllTimeouts();
        this.stateManager.clearAllStates();
        MockResetManager.resetAllMocks();
      }
    };
  }

  /**
   * Global cleanup for all tests
   */
  static async globalCleanup(): Promise<void> {
    await this.isolationManager.clearAllTestStates();
    await this.resourceManager.cleanupAllResources();
    this.timeoutManager.clearAllTimeouts();
    this.stateManager.clearAllStates();
    MockResetManager.restoreAllMocks();
  }

  /**
   * Setup test hooks for automatic cleanup
   */
  static setupTestHooks() {
    // This would be used in test setup files
    return {
      beforeEach: async () => {
        MockResetManager.resetAllMocks();
      },
      afterEach: async () => {
        MockResetManager.clearAllMocks();
      },
      afterAll: async () => {
        await this.globalCleanup();
      }
    };
  }
}

/**
 * Test isolation decorators and helpers
 */
export function withIsolation(testName: string) {
  return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args: any[]) {
      const isolatedTest = await TestIsolationUtils.createIsolatedTest(testName);
      
      try {
        return await originalMethod.apply(this, [isolatedTest, ...args]);
      } finally {
        await isolatedTest.cleanup();
      }
    };
    
    return descriptor;
  };
}

/**
 * Helper function for creating isolated test environments
 */
export async function createIsolatedTestEnvironment(testName: string) {
  return TestIsolationUtils.createIsolatedTest(testName);
}

/**
 * Helper function for test cleanup
 */
export async function cleanupTestEnvironment() {
  await TestIsolationUtils.globalCleanup();
}