/**
 * Test Isolation Manager
 * Provides test isolation mechanisms to prevent data conflicts between tests
 */

import type { D1Database } from '@cloudflare/workers-types';
import { TestFixtureManager } from './test-fixture-manager';
import { TestMigrationRunner } from './test-migration-runner';
import { DatabaseHealthMonitor } from './database-health-monitor';

export interface IsolationConfig {
  /** Isolation level */
  level: 'test' | 'suite' | 'file' | 'global';
  /** Cleanup strategy */
  cleanupStrategy: 'truncate' | 'drop' | 'rollback' | 'recreate';
  /** Whether to verify cleanup */
  verifyCleanup: boolean;
  /** Maximum cleanup time in milliseconds */
  maxCleanupTime: number;
  /** Whether to enable parallel test execution */
  enableParallelExecution: boolean;
  /** Database prefix for isolation */
  databasePrefix?: string;
}

export interface IsolationContext {
  /** Context ID */
  id: string;
  /** Context type */
  type: 'test' | 'suite' | 'file';
  /** Context name */
  name: string;
  /** Parent context ID */
  parentId?: string;
  /** Database instance for this context */
  database: D1Database;
  /** Fixture manager for this context */
  fixtureManager: TestFixtureManager;
  /** Migration runner for this context */
  migrationRunner: TestMigrationRunner;
  /** Health monitor for this context */
  healthMonitor: DatabaseHealthMonitor;
  /** Context creation time */
  createdAt: Date;
  /** Whether context is active */
  isActive: boolean;
}

export interface IsolationResult {
  /** Context that was isolated */
  context: IsolationContext;
  /** Setup time in milliseconds */
  setupTime: number;
  /** Whether isolation was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

export interface CleanupVerification {
  /** Whether cleanup was complete */
  isComplete: boolean;
  /** Remaining data by table */
  remainingData: Record<string, number>;
  /** Cleanup issues */
  issues: string[];
  /** Verification time */
  verificationTime: number;
}

/**
 * Test Isolation Manager
 * Manages test isolation to prevent data conflicts and ensure test independence
 */
export class TestIsolationManager {
  private config: IsolationConfig;
  private contexts: Map<string, IsolationContext> = new Map();
  private activeContexts: Set<string> = new Set();
  private cleanupQueue: string[] = [];
  private isShuttingDown: boolean = false;

  constructor(config: Partial<IsolationConfig> = {}) {
    this.config = {
      level: 'test',
      cleanupStrategy: 'truncate',
      verifyCleanup: true,
      maxCleanupTime: 30000, // 30 seconds
      enableParallelExecution: false,
      ...config
    };

    // Register cleanup on process exit
    this.registerCleanupHandlers();
  }

  /**
   * Create isolated context for test execution
   */
  async createIsolatedContext(
    contextType: 'test' | 'suite' | 'file',
    contextName: string,
    database: D1Database,
    parentContextId?: string
  ): Promise<IsolationResult> {
    const startTime = Date.now();
    const contextId = this.generateContextId(contextType, contextName);

    try {
      // Check if context already exists
      if (this.contexts.has(contextId)) {
        const existingContext = this.contexts.get(contextId)!;
        if (existingContext.isActive) {
          return {
            context: existingContext,
            setupTime: 0,
            success: true
          };
        }
      }

      // Create isolated database if needed
      const isolatedDatabase = await this.createIsolatedDatabase(database, contextId);

      // Initialize components for this context
      const fixtureManager = new TestFixtureManager(isolatedDatabase, false);
      const migrationRunner = new TestMigrationRunner(isolatedDatabase);
      const healthMonitor = new DatabaseHealthMonitor(isolatedDatabase);

      // Create context
      const context: IsolationContext = {
        id: contextId,
        type: contextType,
        name: contextName,
        parentId: parentContextId,
        database: isolatedDatabase,
        fixtureManager,
        migrationRunner,
        healthMonitor,
        createdAt: new Date(),
        isActive: true
      };

      // Setup database for this context
      await this.setupContextDatabase(context);

      // Register context
      this.contexts.set(contextId, context);
      this.activeContexts.add(contextId);

      const setupTime = Date.now() - startTime;
      
      return {
        context,
        setupTime,
        success: true
      };
    } catch (error: unknown) {
      const setupTime = Date.now() - startTime;
      
      return {
        context: {} as IsolationContext,
        setupTime,
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get isolated context
   */
  getContext(contextId: string): IsolationContext | undefined {
    return this.contexts.get(contextId);
  }

  /**
   * Clean up isolated context
   */
  async cleanupContext(contextId: string): Promise<{
    success: boolean;
    cleanupTime: number;
    verification?: CleanupVerification;
    error?: string;
  }> {
    const startTime = Date.now();
    const context = this.contexts.get(contextId);

    if (!context) {
      return {
        success: false,
        cleanupTime: 0,
        error: `Context not found: ${contextId}`
      };
    }

    try {
      // Perform cleanup based on strategy
      await this.performContextCleanup(context);

      // Verify cleanup if enabled
      let verification: CleanupVerification | undefined;
      if (this.config.verifyCleanup) {
        verification = await this.verifyContextCleanup(context);
      }

      // Deactivate context
      context.isActive = false;
      this.activeContexts.delete(contextId);

      // Cleanup components
      context.healthMonitor.cleanup();

      const cleanupTime = Date.now() - startTime;

      return {
        success: true,
        cleanupTime,
        verification
      };
    } catch (error: unknown) {
      const cleanupTime = Date.now() - startTime;
      
      return {
        success: false,
        cleanupTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Clean up all active contexts
   */
  async cleanupAllContexts(): Promise<{
    totalContexts: number;
    successfulCleanups: number;
    failedCleanups: number;
    totalTime: number;
    errors: string[];
  }> {
    const startTime = Date.now();
    const activeContextIds = Array.from(this.activeContexts);
    const errors: string[] = [];
    let successfulCleanups = 0;
    let failedCleanups = 0;

    for (const contextId of activeContextIds) {
      try {
        const result = await this.cleanupContext(contextId);
        if (result.success) {
          successfulCleanups++;
        } else {
          failedCleanups++;
          if (result.error) {
            errors.push(`${contextId}: ${result.error}`);
          }
        }
      } catch (error: unknown) {
        failedCleanups++;
        errors.push(`${contextId}: ${(error as Error).message}`);
      }
    }

    const totalTime = Date.now() - startTime;

    return {
      totalContexts: activeContextIds.length,
      successfulCleanups,
      failedCleanups,
      totalTime,
      errors
    };
  }

  /**
   * Get isolation status
   */
  getIsolationStatus(): {
    totalContexts: number;
    activeContexts: number;
    contextsByType: Record<string, number>;
    oldestContext?: Date;
    newestContext?: Date;
  } {
    const contextsByType: Record<string, number> = {};
    let oldestContext: Date | undefined;
    let newestContext: Date | undefined;

    for (const context of this.contexts.values()) {
      contextsByType[context.type] = (contextsByType[context.type] || 0) + 1;
      
      if (!oldestContext || context.createdAt < oldestContext) {
        oldestContext = context.createdAt;
      }
      
      if (!newestContext || context.createdAt > newestContext) {
        newestContext = context.createdAt;
      }
    }

    return {
      totalContexts: this.contexts.size,
      activeContexts: this.activeContexts.size,
      contextsByType,
      oldestContext,
      newestContext
    };
  }

  /**
   * Force cleanup of stale contexts
   */
  async forceCleanupStaleContexts(maxAgeMs: number = 300000): Promise<{
    staleContexts: number;
    cleanedUp: number;
    errors: string[];
  }> {
    const now = Date.now();
    const staleContextIds: string[] = [];
    const errors: string[] = [];
    let cleanedUp = 0;

    // Find stale contexts
    for (const [contextId, context] of this.contexts) {
      if (now - context.createdAt.getTime() > maxAgeMs) {
        staleContextIds.push(contextId);
      }
    }

    // Clean up stale contexts
    for (const contextId of staleContextIds) {
      try {
        const result = await this.cleanupContext(contextId);
        if (result.success) {
          cleanedUp++;
        } else if (result.error) {
          errors.push(`${contextId}: ${result.error}`);
        }
      } catch (error: unknown) {
        errors.push(`${contextId}: ${(error as Error).message}`);
      }
    }

    return {
      staleContexts: staleContextIds.length,
      cleanedUp,
      errors
    };
  }

  /**
   * Shutdown isolation manager
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    // Clean up all active contexts
    await this.cleanupAllContexts();
    
    // Clear all data
    this.contexts.clear();
    this.activeContexts.clear();
    this.cleanupQueue = [];
  }

  // Private methods

  /**
   * Generate unique context ID
   */
  private generateContextId(contextType: string, contextName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${contextType}-${contextName}-${timestamp}-${random}`;
  }

  /**
   * Create isolated database instance
   */
  private async createIsolatedDatabase(database: D1Database, contextId: string): Promise<D1Database> {
    // For mock databases, we can return the same instance
    // In a real implementation, you might create separate database connections
    // or use database prefixes/schemas for isolation
    return database;
  }

  /**
   * Setup database for context
   */
  private async setupContextDatabase(context: IsolationContext): Promise<void> {
    // Initialize migration system
    await context.migrationRunner.initialize();
    
    // Run migrations if needed
    const migrationStatus = await context.migrationRunner.getMigrationStatus();
    if (migrationStatus.pendingMigrations.length > 0) {
      await context.migrationRunner.runMigrations();
    }

    // Start health monitoring
    context.healthMonitor.startMonitoring(60000); // Check every minute
  }

  /**
   * Perform context cleanup based on strategy
   */
  private async performContextCleanup(context: IsolationContext): Promise<void> {
    switch (this.config.cleanupStrategy) {
      case 'truncate':
        await context.fixtureManager.cleanupAllTables();
        break;

      case 'drop':
        await context.fixtureManager.cleanupAllTables();
        await context.migrationRunner.cleanup();
        break;

      case 'rollback':
        await context.migrationRunner.resetDatabase();
        break;

      case 'recreate':
        await context.migrationRunner.resetDatabase();
        await context.migrationRunner.runMigrations();
        break;

      default:
        throw new Error(`Unknown cleanup strategy: ${this.config.cleanupStrategy}`);
    }
  }

  /**
   * Verify context cleanup
   */
  private async verifyContextCleanup(context: IsolationContext): Promise<CleanupVerification> {
    const startTime = Date.now();
    
    try {
      const verification = await context.fixtureManager.verifyCleanup();
      const verificationTime = Date.now() - startTime;

      return {
        isComplete: verification.isComplete,
        remainingData: verification.remainingRecords,
        issues: verification.issues,
        verificationTime
      };
    } catch (error: unknown) {
      const verificationTime = Date.now() - startTime;
      
      return {
        isComplete: false,
        remainingData: {},
        issues: [`Verification failed: ${(error as Error).message}`],
        verificationTime
      };
    }
  }

  /**
   * Register cleanup handlers for process exit
   */
  private registerCleanupHandlers(): void {
    // Handle process exit
    process.on('exit', () => {
      if (!this.isShuttingDown) {
        // Synchronous cleanup only
        console.log('TestIsolationManager: Process exiting, cleaning up contexts...');
      }
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('TestIsolationManager: Received SIGINT, shutting down...');
      await this.shutdown();
      process.exit(0);
    });

    // Handle SIGTERM
    process.on('SIGTERM', async () => {
      console.log('TestIsolationManager: Received SIGTERM, shutting down...');
      await this.shutdown();
      process.exit(0);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('TestIsolationManager: Uncaught exception, shutting down...', error);
      await this.shutdown();
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason) => {
      console.error('TestIsolationManager: Unhandled rejection, shutting down...', reason);
      await this.shutdown();
      process.exit(1);
    });
  }
}

/**
 * Test Isolation Manager Factory
 */
export class TestIsolationManagerFactory {
  /**
   * Create isolation manager with default configuration
   */
  static createDefault(): TestIsolationManager {
    return new TestIsolationManager();
  }

  /**
   * Create isolation manager for CI environment
   */
  static createForCI(): TestIsolationManager {
    return new TestIsolationManager({
      level: 'suite',
      cleanupStrategy: 'drop',
      verifyCleanup: true,
      maxCleanupTime: 60000, // 1 minute for CI
      enableParallelExecution: false // Disable parallel for CI stability
    });
  }

  /**
   * Create isolation manager for local development
   */
  static createForLocal(): TestIsolationManager {
    return new TestIsolationManager({
      level: 'test',
      cleanupStrategy: 'truncate',
      verifyCleanup: true,
      maxCleanupTime: 15000, // 15 seconds for local
      enableParallelExecution: true // Enable parallel for local speed
    });
  }

  /**
   * Create isolation manager for parallel testing
   */
  static createForParallel(): TestIsolationManager {
    return new TestIsolationManager({
      level: 'test',
      cleanupStrategy: 'recreate',
      verifyCleanup: true,
      maxCleanupTime: 30000,
      enableParallelExecution: true,
      databasePrefix: 'parallel_test_'
    });
  }

  /**
   * Create isolation manager with custom configuration
   */
  static createWithConfig(config: Partial<IsolationConfig>): TestIsolationManager {
    return new TestIsolationManager(config);
  }
}

/**
 * Test Isolation Utilities
 */
export class TestIsolationUtils {
  /**
   * Create isolated test environment
   */
  static async withIsolatedTest<T>(
    testName: string,
    database: D1Database,
    testFn: (context: IsolationContext) => Promise<T>,
    config?: Partial<IsolationConfig>
  ): Promise<T> {
    const isolationManager = new TestIsolationManager(config);
    
    try {
      const result = await isolationManager.createIsolatedContext('test', testName, database);
      
      if (!result.success) {
        throw new Error(`Failed to create isolated context: ${result.error}`);
      }

      return await testFn(result.context);
    } finally {
      await isolationManager.shutdown();
    }
  }

  /**
   * Create isolated test suite environment
   */
  static async withIsolatedSuite<T>(
    suiteName: string,
    database: D1Database,
    suiteFn: (context: IsolationContext) => Promise<T>,
    config?: Partial<IsolationConfig>
  ): Promise<T> {
    const isolationManager = new TestIsolationManager(config);
    
    try {
      const result = await isolationManager.createIsolatedContext('suite', suiteName, database);
      
      if (!result.success) {
        throw new Error(`Failed to create isolated context: ${result.error}`);
      }

      return await suiteFn(result.context);
    } finally {
      await isolationManager.shutdown();
    }
  }
}