/**
 * Parallel Test Runner
 * Manages parallel test execution with database isolation
 */

import type { D1Database } from '@cloudflare/workers-types';
import { TestIsolationManager, IsolationContext } from './test-isolation-manager';
import { TestDatabaseManager } from './test-database-manager';
import { DatabaseErrorHandler } from './database-error-handler';

export interface ParallelTestConfig {
  /** Maximum number of parallel workers */
  maxWorkers: number;
  /** Test timeout in milliseconds */
  testTimeout: number;
  /** Worker timeout in milliseconds */
  workerTimeout: number;
  /** Whether to enable database isolation per test */
  enableDatabaseIsolation: boolean;
  /** Whether to enable retry on failure */
  enableRetry: boolean;
  /** Maximum retry attempts */
  maxRetryAttempts: number;
  /** Retry delay in milliseconds */
  retryDelay: number;
}

export interface TestJob {
  /** Unique job ID */
  id: string;
  /** Test name */
  name: string;
  /** Test function */
  testFn: (context: IsolationContext) => Promise<void>;
  /** Test timeout override */
  timeout?: number;
  /** Test dependencies (other test IDs that must complete first) */
  dependencies: string[];
  /** Test priority (higher = more important) */
  priority: number;
  /** Whether this test requires database isolation */
  requiresIsolation: boolean;
}

export interface TestResult {
  /** Test job */
  job: TestJob;
  /** Test status */
  status: 'pending' | 'running' | 'passed' | 'failed' | 'timeout' | 'skipped';
  /** Start time */
  startTime?: Date;
  /** End time */
  endTime?: Date;
  /** Execution time in milliseconds */
  executionTime?: number;
  /** Worker ID that executed the test */
  workerId?: string;
  /** Error if test failed */
  error?: Error;
  /** Retry attempt number */
  retryAttempt: number;
  /** Database context used */
  databaseContext?: IsolationContext;
}

export interface WorkerStatus {
  /** Worker ID */
  id: string;
  /** Worker status */
  status: 'idle' | 'busy' | 'error' | 'shutdown';
  /** Current test being executed */
  currentTest?: TestJob;
  /** Tests completed by this worker */
  testsCompleted: number;
  /** Tests failed by this worker */
  testsFailed: number;
  /** Worker start time */
  startTime: Date;
  /** Last activity time */
  lastActivity: Date;
  /** Database context for this worker */
  databaseContext?: IsolationContext;
}

export interface ParallelTestSummary {
  /** Total tests */
  totalTests: number;
  /** Passed tests */
  passedTests: number;
  /** Failed tests */
  failedTests: number;
  /** Skipped tests */
  skippedTests: number;
  /** Timeout tests */
  timeoutTests: number;
  /** Total execution time */
  totalExecutionTime: number;
  /** Average test time */
  averageTestTime: number;
  /** Workers used */
  workersUsed: number;
  /** Retry attempts made */
  retryAttempts: number;
}

/**
 * Parallel Test Runner
 * Executes tests in parallel with proper database isolation
 */
export class ParallelTestRunner {
  private config: ParallelTestConfig;
  private database: D1Database;
  private isolationManager: TestIsolationManager;
  private errorHandler: DatabaseErrorHandler;
  private workers: Map<string, WorkerStatus> = new Map();
  private testQueue: TestJob[] = [];
  private runningTests: Map<string, TestResult> = new Map();
  private completedTests: Map<string, TestResult> = new Map();
  private isRunning: boolean = false;
  private startTime?: Date;
  private endTime?: Date;

  constructor(
    database: D1Database,
    config: Partial<ParallelTestConfig> = {}
  ) {
    this.database = database;
    this.config = {
      maxWorkers: 4,
      testTimeout: 5000, // Reduced from 30000ms
      workerTimeout: 10000, // Reduced from 60000ms
      enableDatabaseIsolation: true,
      enableRetry: true,
      maxRetryAttempts: 2,
      retryDelay: 500, // Reduced from 1000ms
      ...config
    };

    this.isolationManager = new TestIsolationManager({
      level: 'test',
      cleanupStrategy: 'truncate',
      verifyCleanup: true,
      enableParallelExecution: true
    });

    this.errorHandler = new DatabaseErrorHandler({
      maxAttempts: this.config.maxRetryAttempts,
      initialDelay: this.config.retryDelay
    });
  }

  /**
   * Add test to the queue
   */
  addTest(test: Omit<TestJob, 'id'>): string {
    const testId = this.generateTestId(test.name);
    const testJob: TestJob = {
      id: testId,
      ...test
    };

    this.testQueue.push(testJob);
    return testId;
  }

  /**
   * Add multiple tests to the queue
   */
  addTests(tests: Array<Omit<TestJob, 'id'>>): string[] {
    return tests.map(test => this.addTest(test));
  }

  /**
   * Run all queued tests in parallel
   */
  async runTests(): Promise<ParallelTestSummary> {
    if (this.isRunning) {
      throw new Error('Test runner is already running');
    }

    this.isRunning = true;
    this.startTime = new Date();

    try {
      // Initialize workers
      await this.initializeWorkers();

      // Sort tests by priority and dependencies
      const sortedTests = this.sortTestsByPriorityAndDependencies();

      // Execute tests
      await this.executeTests(sortedTests);

      // Wait for all tests to complete
      await this.waitForCompletion();

      this.endTime = new Date();
      return this.generateSummary();
    } finally {
      await this.cleanup();
      this.isRunning = false;
    }
  }

  /**
   * Get current test status
   */
  getStatus(): {
    isRunning: boolean;
    queuedTests: number;
    runningTests: number;
    completedTests: number;
    workers: WorkerStatus[];
  } {
    return {
      isRunning: this.isRunning,
      queuedTests: this.testQueue.length,
      runningTests: this.runningTests.size,
      completedTests: this.completedTests.size,
      workers: Array.from(this.workers.values())
    };
  }

  /**
   * Stop test execution
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Cancel running tests
    for (const [testId, result] of this.runningTests) {
      result.status = 'skipped';
      result.endTime = new Date();
      this.completedTests.set(testId, result);
    }
    
    this.runningTests.clear();
    await this.cleanup();
  }

  // Private methods

  /**
   * Generate unique test ID
   */
  private generateTestId(testName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `test-${testName.replace(/[^a-zA-Z0-9]/g, '-')}-${timestamp}-${random}`;
  }

  /**
   * Initialize worker pool
   */
  private async initializeWorkers(): Promise<void> {
    for (let i = 0; i < this.config.maxWorkers; i++) {
      const workerId = `worker-${i + 1}`;
      
      let databaseContext: IsolationContext | undefined;
      
      if (this.config.enableDatabaseIsolation) {
        const isolationResult = await this.isolationManager.createIsolatedContext(
          'test',
          `worker-${workerId}`,
          this.database
        );
        
        if (isolationResult.success) {
          databaseContext = isolationResult.context;
        }
      }

      const worker: WorkerStatus = {
        id: workerId,
        status: 'idle',
        testsCompleted: 0,
        testsFailed: 0,
        startTime: new Date(),
        lastActivity: new Date(),
        databaseContext
      };

      this.workers.set(workerId, worker);
    }
  }

  /**
   * Sort tests by priority and dependencies
   */
  private sortTestsByPriorityAndDependencies(): TestJob[] {
    // Simple topological sort with priority
    const sorted: TestJob[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (test: TestJob) => {
      if (visiting.has(test.id)) {
        throw new Error(`Circular dependency detected involving test: ${test.name}`);
      }
      
      if (visited.has(test.id)) {
        return;
      }

      visiting.add(test.id);

      // Visit dependencies first
      for (const depId of test.dependencies) {
        const depTest = this.testQueue.find(t => t.id === depId);
        if (depTest) {
          visit(depTest);
        }
      }

      visiting.delete(test.id);
      visited.add(test.id);
      sorted.push(test);
    };

    // Sort by priority first, then visit
    const prioritySorted = [...this.testQueue].sort((a, b) => b.priority - a.priority);
    
    for (const test of prioritySorted) {
      visit(test);
    }

    return sorted;
  }

  /**
   * Execute tests using worker pool
   */
  private async executeTests(tests: TestJob[]): Promise<void> {
    this.testQueue = tests;

    while (this.testQueue.length > 0 && this.isRunning) {
      // Find available worker
      const availableWorker = this.findAvailableWorker();
      
      if (!availableWorker) {
        // Wait a bit and try again
        await this.sleep(100);
        continue;
      }

      // Find next test that can run
      const nextTest = this.findNextRunnableTest();
      
      if (!nextTest) {
        // No runnable tests, wait for dependencies
        await this.sleep(100);
        continue;
      }

      // Remove test from queue and start execution
      this.testQueue = this.testQueue.filter(t => t.id !== nextTest.id);
      await this.executeTest(nextTest, availableWorker);
    }
  }

  /**
   * Find available worker
   */
  private findAvailableWorker(): WorkerStatus | undefined {
    return Array.from(this.workers.values()).find(worker => worker.status === 'idle');
  }

  /**
   * Find next runnable test (dependencies satisfied)
   */
  private findNextRunnableTest(): TestJob | undefined {
    return this.testQueue.find(test => {
      // Check if all dependencies are completed
      return test.dependencies.every(depId => 
        this.completedTests.has(depId) && 
        this.completedTests.get(depId)!.status === 'passed'
      );
    });
  }

  /**
   * Execute a single test
   */
  private async executeTest(test: TestJob, worker: WorkerStatus): Promise<void> {
    const testResult: TestResult = {
      job: test,
      status: 'running',
      startTime: new Date(),
      workerId: worker.id,
      retryAttempt: 0,
      databaseContext: worker.databaseContext
    };

    this.runningTests.set(test.id, testResult);
    worker.status = 'busy';
    worker.currentTest = test;
    worker.lastActivity = new Date();

    // Execute test asynchronously
    this.executeTestAsync(test, worker, testResult);
  }

  /**
   * Execute test asynchronously
   */
  private async executeTestAsync(
    test: TestJob,
    worker: WorkerStatus,
    testResult: TestResult
  ): Promise<void> {
    try {
      const timeout = test.timeout || this.config.testTimeout;
      
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Test timeout')), timeout);
      });

      // Execute test with timeout
      const testPromise = this.executeTestWithContext(test, worker.databaseContext);
      
      await Promise.race([testPromise, timeoutPromise]);

      // Test passed
      testResult.status = 'passed';
      testResult.endTime = new Date();
      testResult.executionTime = testResult.endTime.getTime() - testResult.startTime!.getTime();
      
      worker.testsCompleted++;
    } catch (error: unknown) {
      // Test failed
      testResult.status = error.message === 'Test timeout' ? 'timeout' : 'failed';
      testResult.error = error as Error;
      testResult.endTime = new Date();
      testResult.executionTime = testResult.endTime.getTime() - testResult.startTime!.getTime();
      
      worker.testsFailed++;

      // Retry if enabled and not a timeout
      if (this.config.enableRetry && 
          testResult.status === 'failed' && 
          testResult.retryAttempt < this.config.maxRetryAttempts) {
        
        await this.retryTest(test, worker, testResult);
        return;
      }
    } finally {
      // Clean up worker
      worker.status = 'idle';
      worker.currentTest = undefined;
      worker.lastActivity = new Date();

      // Move test to completed
      this.runningTests.delete(test.id);
      this.completedTests.set(test.id, testResult);
    }
  }

  /**
   * Execute test with database context
   */
  private async executeTestWithContext(
    test: TestJob,
    databaseContext?: IsolationContext
  ): Promise<void> {
    if (test.requiresIsolation && databaseContext) {
      // Execute with isolated database context
      await test.testFn(databaseContext);
    } else {
      // Create temporary context for test
      const tempContext: IsolationContext = {
        id: `temp-${test.id}`,
        type: 'test',
        name: test.name,
        database: this.database,
        fixtureManager: {} as any,
        migrationRunner: {} as any,
        healthMonitor: {} as any,
        createdAt: new Date(),
        isActive: true
      };
      
      await test.testFn(tempContext);
    }
  }

  /**
   * Retry failed test
   */
  private async retryTest(
    test: TestJob,
    worker: WorkerStatus,
    testResult: TestResult
  ): Promise<void> {
    testResult.retryAttempt++;
    testResult.status = 'running';
    testResult.startTime = new Date();
    testResult.error = undefined;

    // Wait before retry
    await this.sleep(this.config.retryDelay);

    // Execute again
    await this.executeTestAsync(test, worker, testResult);
  }

  /**
   * Wait for all tests to complete
   */
  private async waitForCompletion(): Promise<void> {
    while (this.runningTests.size > 0 && this.isRunning) {
      await this.sleep(100);
    }
  }

  /**
   * Generate test summary
   */
  private generateSummary(): ParallelTestSummary {
    const results = Array.from(this.completedTests.values());
    const totalExecutionTime = this.endTime && this.startTime 
      ? this.endTime.getTime() - this.startTime.getTime()
      : 0;

    const passedTests = results.filter(r => r.status === 'passed').length;
    const failedTests = results.filter(r => r.status === 'failed').length;
    const skippedTests = results.filter(r => r.status === 'skipped').length;
    const timeoutTests = results.filter(r => r.status === 'timeout').length;
    
    const totalTestTime = results.reduce((sum, r) => sum + (r.executionTime || 0), 0);
    const averageTestTime = results.length > 0 ? totalTestTime / results.length : 0;
    
    const retryAttempts = results.reduce((sum, r) => sum + r.retryAttempt, 0);

    return {
      totalTests: results.length,
      passedTests,
      failedTests,
      skippedTests,
      timeoutTests,
      totalExecutionTime,
      averageTestTime,
      workersUsed: this.workers.size,
      retryAttempts
    };
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    // Shutdown workers
    for (const worker of this.workers.values()) {
      worker.status = 'shutdown';
      
      if (worker.databaseContext) {
        await this.isolationManager.cleanupContext(worker.databaseContext.id);
      }
    }

    // Shutdown isolation manager
    await this.isolationManager.shutdown();

    // Clear collections
    this.workers.clear();
    this.testQueue = [];
    this.runningTests.clear();
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Parallel Test Runner Factory
 */
export class ParallelTestRunnerFactory {
  /**
   * Create parallel test runner with default configuration
   */
  static createDefault(database: D1Database): ParallelTestRunner {
    return new ParallelTestRunner(database);
  }

  /**
   * Create parallel test runner for CI environment
   */
  static createForCI(database: D1Database): ParallelTestRunner {
    return new ParallelTestRunner(database, {
      maxWorkers: 2, // Fewer workers for CI stability
      testTimeout: 8000, // Reduced from 15000ms
      workerTimeout: 15000, // Reduced from 30000ms
      enableDatabaseIsolation: true,
      enableRetry: true,
      maxRetryAttempts: 3, // More retries for CI
      retryDelay: 1000 // Reduced from 2000ms
    });
  }

  /**
   * Create parallel test runner for local development
   */
  static createForLocal(database: D1Database): ParallelTestRunner {
    return new ParallelTestRunner(database, {
      maxWorkers: 4, // More workers for local speed
      testTimeout: 5000, // Reduced from 10000ms
      workerTimeout: 10000, // Reduced from 20000ms
      enableDatabaseIsolation: true,
      enableRetry: true,
      maxRetryAttempts: 2,
      retryDelay: 500 // Reduced from 1000ms
    });
  }

  /**
   * Create parallel test runner with custom configuration
   */
  static createWithConfig(
    database: D1Database,
    config: Partial<ParallelTestConfig>
  ): ParallelTestRunner {
    return new ParallelTestRunner(database, config);
  }
}