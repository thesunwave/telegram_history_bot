/**
 * Mock Environment Implementation
 * Provides comprehensive mock environment for testing
 */

import { vi } from 'vitest';
import type { Env } from '../../src/env';
import { MockD1Database, DatabaseMockFactory } from './mock-database';
import { MockKVStorage, KVMockFactory } from './mock-kv-storage';
import { MockCloudflareAI, AIProviderMockFactory } from './mock-ai-providers';
import { MockDurableObjectNamespace, DurableObjectMockFactory } from './mock-durable-objects';

/**
 * Mock Environment Factory
 */
export class MockEnvironmentFactory {
  /**
   * Create basic mock environment
   */
  static createBasicEnvironment(): Env {
    return {
      // Database
      DB: DatabaseMockFactory.createRealisticDatabase(),
      
      // KV Namespaces
      HISTORY: KVMockFactory.createRealisticKV(),
      COUNTERS: KVMockFactory.createRealisticKV(),
      
      // Durable Objects
      COUNTERS_DO: DurableObjectMockFactory.createNamespace(),
      MESSAGE_FETCHER_DO: DurableObjectMockFactory.createNamespace(),
      MESSAGE_AGGREGATOR_DO: DurableObjectMockFactory.createNamespace(),
      DAY_BLOCK_MANAGER_DO: DurableObjectMockFactory.createNamespace(),
      
      // AI Provider
      AI: AIProviderMockFactory.createCloudflareAI(),
      
      // Environment Variables
      TOKEN: 'test-bot-token',
      SECRET: 'test-secret-key',
      SUMMARY_MODEL: '@cf/meta/llama-2-7b-chat-int8',
      SUMMARY_PROMPT: 'Test summary prompt',
      KV_BATCH_SIZE: 100,
      KV_BATCH_DELAY: 50,
      LARGE_DATASET_BATCH_DELAY: 100,
      VERY_LARGE_DATASET_BATCH_DELAY: 200
    };
  }

  /**
   * Create empty mock environment
   */
  static createEmptyEnvironment(): Env {
    return {
      // Database
      DB: DatabaseMockFactory.createEmptyDatabase(),
      
      // KV Namespaces
      HISTORY: KVMockFactory.createEmptyKV(),
      COUNTERS: KVMockFactory.createEmptyKV(),
      
      // Durable Objects
      COUNTERS_DO: DurableObjectMockFactory.createNamespace(),
      MESSAGE_FETCHER_DO: DurableObjectMockFactory.createNamespace(),
      MESSAGE_AGGREGATOR_DO: DurableObjectMockFactory.createNamespace(),
      DAY_BLOCK_MANAGER_DO: DurableObjectMockFactory.createNamespace(),
      
      // AI Provider
      AI: AIProviderMockFactory.createCloudflareAI(),
      
      // Environment Variables
      TOKEN: 'test-bot-token',
      SECRET: 'test-secret-key',
      SUMMARY_MODEL: '@cf/meta/llama-2-7b-chat-int8',
      SUMMARY_PROMPT: 'Test summary prompt',
      KV_BATCH_SIZE: 100,
      KV_BATCH_DELAY: 50,
      LARGE_DATASET_BATCH_DELAY: 100,
      VERY_LARGE_DATASET_BATCH_DELAY: 200
    };
  }

  /**
   * Create high-activity mock environment
   */
  static createHighActivityEnvironment(): Env {
    return {
      // Database
      DB: DatabaseMockFactory.createHighActivityDatabase(),
      
      // KV Namespaces
      HISTORY: KVMockFactory.createHighActivityKV(),
      COUNTERS: KVMockFactory.createHighActivityKV(),
      
      // Durable Objects
      COUNTERS_DO: DurableObjectMockFactory.createScenarioNamespace('healthy'),
      MESSAGE_FETCHER_DO: DurableObjectMockFactory.createScenarioNamespace('healthy'),
      MESSAGE_AGGREGATOR_DO: DurableObjectMockFactory.createScenarioNamespace('healthy'),
      DAY_BLOCK_MANAGER_DO: DurableObjectMockFactory.createScenarioNamespace('healthy'),
      
      // AI Provider
      AI: AIProviderMockFactory.createCloudflareAI(),
      
      // Environment Variables
      TOKEN: 'test-bot-token',
      SECRET: 'test-secret-key',
      SUMMARY_MODEL: '@cf/meta/llama-2-7b-chat-int8',
      SUMMARY_PROMPT: 'Test summary prompt',
      KV_BATCH_SIZE: 100,
      KV_BATCH_DELAY: 50,
      LARGE_DATASET_BATCH_DELAY: 100,
      VERY_LARGE_DATASET_BATCH_DELAY: 200
    };
  }

  /**
   * Create failing mock environment
   */
  static createFailingEnvironment(): Env {
    return {
      // Database
      DB: DatabaseMockFactory.createFailingDatabase(),
      
      // KV Namespaces
      HISTORY: KVMockFactory.createFailingKV(),
      COUNTERS: KVMockFactory.createFailingKV(),
      
      // Durable Objects
      COUNTERS_DO: DurableObjectMockFactory.createScenarioNamespace('failing'),
      MESSAGE_FETCHER_DO: DurableObjectMockFactory.createScenarioNamespace('failing'),
      MESSAGE_AGGREGATOR_DO: DurableObjectMockFactory.createScenarioNamespace('failing'),
      DAY_BLOCK_MANAGER_DO: DurableObjectMockFactory.createScenarioNamespace('failing'),
      
      // AI Provider
      AI: AIProviderMockFactory.createScenarioProvider('cloudflare', 'failing'),
      
      // Environment Variables
      TOKEN: 'test-bot-token',
      SECRET: 'test-secret-key',
      SUMMARY_MODEL: '@cf/meta/llama-2-7b-chat-int8',
      SUMMARY_PROMPT: 'Test summary prompt',
      KV_BATCH_SIZE: 100,
      KV_BATCH_DELAY: 50,
      LARGE_DATASET_BATCH_DELAY: 100,
      VERY_LARGE_DATASET_BATCH_DELAY: 200
    };
  }

  /**
   * Create slow mock environment
   */
  static createSlowEnvironment(): Env {
    return {
      // Database
      DB: DatabaseMockFactory.createSlowDatabase(),
      
      // KV Namespaces
      HISTORY: KVMockFactory.createSlowKV(),
      COUNTERS: KVMockFactory.createSlowKV(),
      
      // Durable Objects
      COUNTERS_DO: DurableObjectMockFactory.createScenarioNamespace('slow'),
      MESSAGE_FETCHER_DO: DurableObjectMockFactory.createScenarioNamespace('slow'),
      MESSAGE_AGGREGATOR_DO: DurableObjectMockFactory.createScenarioNamespace('slow'),
      DAY_BLOCK_MANAGER_DO: DurableObjectMockFactory.createScenarioNamespace('slow'),
      
      // AI Provider
      AI: AIProviderMockFactory.createScenarioProvider('cloudflare', 'slow'),
      
      // Environment Variables
      TOKEN: 'test-bot-token',
      SECRET: 'test-secret-key',
      SUMMARY_MODEL: '@cf/meta/llama-2-7b-chat-int8',
      SUMMARY_PROMPT: 'Test summary prompt',
      KV_BATCH_SIZE: 100,
      KV_BATCH_DELAY: 50,
      LARGE_DATASET_BATCH_DELAY: 100,
      VERY_LARGE_DATASET_BATCH_DELAY: 200
    };
  }

  /**
   * Create mixed scenario environment
   */
  static createMixedEnvironment(): Env {
    return {
      // Database - healthy
      DB: DatabaseMockFactory.createRealisticDatabase(),
      
      // KV Namespaces - one healthy, one slow
      HISTORY: KVMockFactory.createRealisticKV(),
      COUNTERS: KVMockFactory.createSlowKV(500),
      
      // Durable Objects - mixed scenarios
      COUNTERS_DO: DurableObjectMockFactory.createScenarioNamespace('healthy'),
      MESSAGE_FETCHER_DO: DurableObjectMockFactory.createScenarioNamespace('slow'),
      MESSAGE_AGGREGATOR_DO: DurableObjectMockFactory.createScenarioNamespace('healthy'),
      DAY_BLOCK_MANAGER_DO: DurableObjectMockFactory.createScenarioNamespace('mixed'),
      
      // AI Provider - healthy
      AI: AIProviderMockFactory.createCloudflareAI(),
      
      // Environment Variables
      TOKEN: 'test-bot-token',
      SECRET: 'test-secret-key',
      SUMMARY_MODEL: '@cf/meta/llama-2-7b-chat-int8',
      SUMMARY_PROMPT: 'Test summary prompt',
      KV_BATCH_SIZE: 100,
      KV_BATCH_DELAY: 50,
      LARGE_DATASET_BATCH_DELAY: 100,
      VERY_LARGE_DATASET_BATCH_DELAY: 200
    };
  }

  /**
   * Create environment with specific scenario
   */
  static createScenarioEnvironment(scenario: 'basic' | 'empty' | 'high-activity' | 'failing' | 'slow' | 'mixed'): Env {
    switch (scenario) {
      case 'empty':
        return this.createEmptyEnvironment();
      case 'high-activity':
        return this.createHighActivityEnvironment();
      case 'failing':
        return this.createFailingEnvironment();
      case 'slow':
        return this.createSlowEnvironment();
      case 'mixed':
        return this.createMixedEnvironment();
      case 'basic':
      default:
        return this.createBasicEnvironment();
    }
  }

  /**
   * Create custom environment with specific components
   */
  static createCustomEnvironment(config: {
    database?: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow';
    kv?: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow';
    durableObjects?: 'healthy' | 'failing' | 'slow' | 'mixed';
    ai?: 'healthy' | 'failing' | 'slow' | 'rate-limited';
    envVars?: Partial<Env>;
  }): Env {
    const baseEnv = this.createBasicEnvironment();

    // Configure database
    if (config.database) {
      baseEnv.DB = DatabaseMockFactory.createScenarioDatabase(config.database);
    }

    // Configure KV
    if (config.kv) {
      baseEnv.HISTORY = KVMockFactory.createScenarioKV(config.kv);
      baseEnv.COUNTERS = KVMockFactory.createScenarioKV(config.kv);
    }

    // Configure Durable Objects
    if (config.durableObjects) {
      baseEnv.COUNTERS_DO = DurableObjectMockFactory.createScenarioNamespace(config.durableObjects);
      baseEnv.MESSAGE_FETCHER_DO = DurableObjectMockFactory.createScenarioNamespace(config.durableObjects);
      baseEnv.MESSAGE_AGGREGATOR_DO = DurableObjectMockFactory.createScenarioNamespace(config.durableObjects);
      baseEnv.DAY_BLOCK_MANAGER_DO = DurableObjectMockFactory.createScenarioNamespace(config.durableObjects);
    }

    // Configure AI
    if (config.ai) {
      baseEnv.AI = AIProviderMockFactory.createScenarioProvider('cloudflare', config.ai);
    }

    // Override environment variables
    if (config.envVars) {
      Object.assign(baseEnv, config.envVars);
    }

    return baseEnv;
  }
}

/**
 * Environment test helpers
 */
export class EnvironmentTestHelpers {
  /**
   * Reset all mocks in environment
   */
  static resetEnvironment(env: Env): void {
    // Reset database
    if (env.DB instanceof MockD1Database) {
      env.DB.reset();
    }

    // Reset KV namespaces
    if (env.HISTORY instanceof MockKVStorage) {
      env.HISTORY.reset();
    }
    if (env.COUNTERS instanceof MockKVStorage) {
      env.COUNTERS.reset();
    }

    // Reset Durable Objects
    if (env.COUNTERS_DO instanceof MockDurableObjectNamespace) {
      env.COUNTERS_DO.reset();
    }
    if (env.MESSAGE_FETCHER_DO instanceof MockDurableObjectNamespace) {
      env.MESSAGE_FETCHER_DO.reset();
    }
    if (env.MESSAGE_AGGREGATOR_DO instanceof MockDurableObjectNamespace) {
      env.MESSAGE_AGGREGATOR_DO.reset();
    }
    if (env.DAY_BLOCK_MANAGER_DO instanceof MockDurableObjectNamespace) {
      env.DAY_BLOCK_MANAGER_DO.reset();
    }

    // Reset AI provider
    if (env.AI instanceof MockCloudflareAI) {
      env.AI.reset();
    }

    // Clear all vi mocks
    vi.clearAllMocks();
  }

  /**
   * Verify environment health
   */
  static async verifyEnvironmentHealth(env: Env): Promise<{
    database: boolean;
    kv: boolean;
    durableObjects: boolean;
    ai: boolean;
  }> {
    const health = {
      database: true,
      kv: true,
      durableObjects: true,
      ai: true
    };

    // Check database
    try {
      await env.DB.prepare('SELECT 1').first();
    } catch (error: unknown) {
      health.database = false;
    }

    // Check KV
    try {
      await env.HISTORY.get('test-key');
      await env.COUNTERS.get('test-key');
    } catch (error: unknown) {
      health.kv = false;
    }

    // Check Durable Objects
    try {
      const id = env.COUNTERS_DO.newUniqueId();
      const stub = env.COUNTERS_DO.get(id);
      await stub.fetch(new Request('https://test.com/health'));
    } catch (error: unknown) {
      health.durableObjects = false;
    }

    // Check AI
    try {
      await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
        messages: [{ role: 'user', content: 'test' }]
      });
    } catch (error: unknown) {
      health.ai = false;
    }

    return health;
  }

  /**
   * Get environment statistics
   */
  static getEnvironmentStats(env: Env): {
    database: any;
    kv: any;
    durableObjects: any;
    ai: any;
  } {
    const stats = {
      database: null,
      kv: null,
      durableObjects: null,
      ai: null
    };

    // Database stats
    if (env.DB instanceof MockD1Database) {
      stats.database = {
        queryCount: env.DB.getQueryCount(),
        dataSize: Object.keys(env.DB.getData('criminal_violations')).length
      };
    }

    // KV stats
    if (env.HISTORY instanceof MockKVStorage && env.COUNTERS instanceof MockKVStorage) {
      stats.kv = {
        historyOperations: env.HISTORY.getOperationCount(),
        countersOperations: env.COUNTERS.getOperationCount(),
        historyKeys: env.HISTORY.getKeyCount(),
        countersKeys: env.COUNTERS.getKeyCount()
      };
    }

    // Durable Objects stats
    if (env.COUNTERS_DO instanceof MockDurableObjectNamespace) {
      stats.durableObjects = {
        countersStubs: env.COUNTERS_DO.getAllStubs().length,
        totalRequests: env.COUNTERS_DO.getAllStubs().reduce((sum, stub) => sum + stub.getRequestCount(), 0)
      };
    }

    // AI stats
    if (env.AI instanceof MockCloudflareAI) {
      stats.ai = {
        requestCount: env.AI.getRequestCount()
      };
    }

    return stats;
  }

  /**
   * Create environment with test scenario
   */
  static async withTestEnvironment<T>(
    scenario: 'basic' | 'empty' | 'high-activity' | 'failing' | 'slow' | 'mixed',
    testFn: (env: Env) => Promise<T>
  ): Promise<T> {
    const env = MockEnvironmentFactory.createScenarioEnvironment(scenario);
    
    try {
      return await testFn(env);
    } finally {
      this.resetEnvironment(env);
    }
  }

  /**
   * Create custom environment with test scenario
   */
  static async withCustomEnvironment<T>(
    config: {
      database?: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow';
      kv?: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow';
      durableObjects?: 'healthy' | 'failing' | 'slow' | 'mixed';
      ai?: 'healthy' | 'failing' | 'slow' | 'rate-limited';
      envVars?: Partial<Env>;
    },
    testFn: (env: Env) => Promise<T>
  ): Promise<T> {
    const env = MockEnvironmentFactory.createCustomEnvironment(config);
    
    try {
      return await testFn(env);
    } finally {
      this.resetEnvironment(env);
    }
  }

  /**
   * Wait for environment to be ready
   */
  static async waitForEnvironmentReady(env: Env, timeout: number = 10000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const health = await this.verifyEnvironmentHealth(env);
      
      if (health.database && health.kv && health.durableObjects && health.ai) {
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Environment did not become ready within timeout');
  }

  /**
   * Seed environment with test data
   */
  static seedEnvironment(env: Env, scenario: 'basic' | 'high-activity' | 'mixed'): void {
    // Seed database
    if (env.DB instanceof MockD1Database) {
      const violations = scenario === 'high-activity' 
        ? DatabaseMockFactory.createHighActivityDatabase().getData('criminal_violations')
        : DatabaseMockFactory.createRealisticDatabase().getData('criminal_violations');
      env.DB.seedData('criminal_violations', violations);
    }

    // Seed KV
    if (env.HISTORY instanceof MockKVStorage && env.COUNTERS instanceof MockKVStorage) {
      const kvData = scenario === 'high-activity'
        ? KVMockFactory.createHighActivityKV()
        : KVMockFactory.createRealisticKV();
      
      // Copy data from template KV to environment KV
      const historyData = kvData.getAllData();
      historyData.forEach((item, key) => {
        env.HISTORY.setData(key, item.value, item.metadata, item.expiration);
      });
      
      const countersData = kvData.getAllData();
      countersData.forEach((item, key) => {
        env.COUNTERS.setData(key, item.value, item.metadata, item.expiration);
      });
    }
  }
}