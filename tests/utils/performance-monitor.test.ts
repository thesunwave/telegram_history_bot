/**
 * Tests for performance monitoring system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { performanceMonitor, PerformanceMonitor } from '../../src/utils/performance-monitor';
import { DatabasePerformanceMonitor } from '../../src/utils/database-performance';
import { PerformanceService } from '../../src/services/performance-service';
import { MonitorPerformance, withPerformanceMonitoring, BatchPerformanceMonitor } from '../../src/utils/performance-middleware';
import { MockEnvironmentFactory } from '../mocks/mock-environment';

describe('PerformanceMonitor', () => {
  const testTimeout = 300; // reduced from 20000ms

  beforeEach(() => {
    // Clear any existing metrics
    const monitor = PerformanceMonitor.getInstance();
    // Reset internal state if needed
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Operation Tracking', () => {

    it('should track operation start and end', async () => {
      const operationId = performanceMonitor.startOperation('test_operation', {
        testContext: 'value'
      });

      expect(operationId).toBeDefined();
      expect(typeof operationId).toBe('string');

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));

      const metric = performanceMonitor.endOperation(operationId, {
        success: true
      });

      expect(metric).toBeDefined();
      expect(metric?.operation).toBe('test_operation');
      expect(metric?.duration).toBeGreaterThan(0);
      expect(metric?.context?.testContext).toBe('value');
    });

    it('should handle missing operation IDs gracefully', () => {
      const result = performanceMonitor.endOperation('non-existent-id');
      expect(result).toBeNull();
    });

    it('should track multiple concurrent operations', async () => {
      const op1 = performanceMonitor.startOperation('operation_1');
      const op2 = performanceMonitor.startOperation('operation_2');
      const op3 = performanceMonitor.startOperation('operation_3');

      await new Promise(resolve => setTimeout(resolve, 5));

      const metric1 = performanceMonitor.endOperation(op1);
      const metric2 = performanceMonitor.endOperation(op2);
      const metric3 = performanceMonitor.endOperation(op3);

      expect(metric1?.operation).toBe('operation_1');
      expect(metric2?.operation).toBe('operation_2');
      expect(metric3?.operation).toBe('operation_3');
    });
  });

  describe('Performance Reports', () => {

    it('should generate performance reports', async () => {
      // Create some test operations
      const operations = ['op1', 'op2', 'op3'];
      
      for (const op of operations) {
        const id = performanceMonitor.startOperation(op);
        await new Promise(resolve => setTimeout(resolve, Math.random() * 20));
        performanceMonitor.endOperation(id);
      }

      const report = performanceMonitor.getPerformanceReport(1); // Last minute

      expect(report).toBeDefined();
      expect(report.operations).toBeDefined();
      expect(Object.keys(report.operations).length).toBeGreaterThan(0);
    });

    it('should calculate performance statistics correctly', async () => {
      const operationName = 'test_stats_operation';
      const durations = [100, 200, 300, 400, 500];

      // Create operations with known durations
      for (const duration of durations) {
        const id = performanceMonitor.startOperation(operationName);
        await new Promise(resolve => setTimeout(resolve, duration));
        performanceMonitor.endOperation(id);
      }

      const report = performanceMonitor.getPerformanceReport(1);
      const opStats = report.operations[operationName];

      expect(opStats).toBeDefined();
      expect(opStats.count).toBe(durations.length);
      expect(opStats.avgDuration).toBeGreaterThan(0);
      expect(opStats.minDuration).toBeGreaterThan(0);
      expect(opStats.maxDuration).toBeGreaterThan(opStats.minDuration);
    });
  });

  describe('Performance Alerts', () => {

    it('should generate alerts for slow operations', async () => {
      const id = performanceMonitor.startOperation('slow_operation');
      
      // Simulate a slow operation (over 1 second)
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      performanceMonitor.endOperation(id);

      const report = performanceMonitor.getPerformanceReport(1);
      expect(report.alerts.length).toBeGreaterThan(0);
      
      const slowAlert = report.alerts.find(alert => alert.type === 'SLOW_QUERY');
      expect(slowAlert).toBeDefined();
    });
  });

  describe('Active Operations', () => {

    it('should track active operations', () => {
      const id1 = performanceMonitor.startOperation('active_op_1');
      const id2 = performanceMonitor.startOperation('active_op_2');

      const activeOps = performanceMonitor.getActiveOperations();
      expect(activeOps.length).toBe(2);
      expect(activeOps.some(op => op.operation === 'active_op_1')).toBe(true);
      expect(activeOps.some(op => op.operation === 'active_op_2')).toBe(true);

      performanceMonitor.endOperation(id1);
      
      const activeOpsAfter = performanceMonitor.getActiveOperations();
      expect(activeOpsAfter.length).toBe(1);
      expect(activeOpsAfter[0].operation).toBe('active_op_2');

      performanceMonitor.endOperation(id2);
    });
  });
});

describe('DatabasePerformanceMonitor', () => {

  beforeEach(() => {
    DatabasePerformanceMonitor.clearMetrics();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('Database Operation Monitoring', () => {

    it('should monitor database operations', async () => {
      const mockQuery = 'SELECT * FROM test_table WHERE id = ?';
      const mockParams = [123];

      const result = await DatabasePerformanceMonitor.monitorDatabaseOperation(
        'test_select',
        'SELECT',
        mockQuery,
        mockParams,
        async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          return { results: [{ id: 123, name: 'test' }], success: true };
        },
        { testContext: 'database_test' }
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);

      const metrics = DatabasePerformanceMonitor.getOperationMetrics('test_select');
      expect(metrics).toBeDefined();
      expect(metrics?.queryCount).toBe(1);
      expect(metrics?.avgDuration).toBeGreaterThan(0);
    });

    it('should handle database operation errors', async () => {
      const mockError = new Error('Database connection failed');

      await expect(
        DatabasePerformanceMonitor.monitorDatabaseOperation(
          'test_error',
          'SELECT',
          'SELECT * FROM test',
          [],
          async () => {
            throw mockError;
          }
        )
      ).rejects.toThrow('Database connection failed');

      const metrics = DatabasePerformanceMonitor.getOperationMetrics('test_error');
      expect(metrics?.errorCount).toBe(1);
    });

    it('should track slow queries', async () => {
      await DatabasePerformanceMonitor.monitorDatabaseOperation(
        'slow_query',
        'SELECT',
        'SELECT * FROM large_table',
        [],
        async () => {
          await new Promise(resolve => setTimeout(resolve, 1100)); // Slow query
          return { results: [], success: true };
        }
      );

      const slowQueries = DatabasePerformanceMonitor.getSlowQueries(1000);
      expect(slowQueries.length).toBe(1);
      expect(slowQueries[0].duration).toBeGreaterThan(1000);
    });
  });

  describe('Performance Summary', () => {

    it('should generate performance summary', async () => {
      // Create multiple operations
      const operations = [
        { name: 'select_users', type: 'SELECT' as const, duration: 100 },
        { name: 'insert_user', type: 'INSERT' as const, duration: 200 },
        { name: 'update_user', type: 'UPDATE' as const, duration: 150 },
      ];

      for (const op of operations) {
        await DatabasePerformanceMonitor.monitorDatabaseOperation(
          op.name,
          op.type,
          `${op.type} query`,
          [],
          async () => {
            await new Promise(resolve => setTimeout(resolve, op.duration));
            return { results: [], success: true };
          }
        );
      }

      const summary = DatabasePerformanceMonitor.getPerformanceSummary();
      expect(summary.totalQueries).toBe(3);
      expect(summary.avgDuration).toBeGreaterThan(0);
      expect(summary.topSlowOperations.length).toBeGreaterThan(0);
    });
  });
});

describe('PerformanceService', () => {

  let performanceService: PerformanceService;

  beforeEach(() => {
    const env = MockEnvironmentFactory.createBasicEnvironment();
    performanceService = new PerformanceService(env, {
      enableDetailedMetrics: false, // Disable periodic reporting for tests
    });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });
  });

  afterEach(async () => {
    await performanceService.cleanup();
  });

  describe('System Metrics', () => {

    it('should get system metrics', async () => {
      // Add small delay to ensure uptime > 0
      await new Promise(resolve => setTimeout(resolve, 1));
      
      const metrics = performanceService.getSystemMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.uptime).toBeGreaterThan(0);
      expect(metrics.operationMetrics).toBeDefined();
      expect(metrics.databaseMetrics).toBeDefined();
      expect(metrics.memoryUsage).toBeDefined();
    });

    it('should check system health', () => {
      const health = performanceService.checkSystemHealth();

      expect(health).toBeDefined();
      expect(health.status).toMatch(/healthy|warning|critical/);
      expect(Array.isArray(health.issues)).toBe(true);
      expect(health.metrics).toBeDefined();
    });
  });

  describe('Performance Reporting', () => {

    it('should generate performance report', () => {
      const report = performanceService.generatePerformanceReport();

      expect(typeof report).toBe('string');
      expect(report).toContain('PERFORMANCE REPORT');
      expect(report).toContain('Operation Metrics');
      expect(report).toContain('Database Metrics');
    });
  });
});

describe('Performance Middleware', () => {

  describe('MonitorPerformance Decorator', () => {

    it('should monitor decorated methods', async () => {
      class TestClass {
        async testMethod(delay: number): Promise<string> {
          await new Promise(resolve => setTimeout(resolve, delay));
          return 'success';
        }
      }

      // Apply decorator manually for testing
      const testInstance = new TestClass();
      const originalMethod = testInstance.testMethod;
      
      // Wrap method with performance monitoring
      testInstance.testMethod = async function(delay: number) {
        return withPerformanceMonitoring(
          'custom_operation',
          () => originalMethod.call(this, delay)
        );
      };

      const result = await testInstance.testMethod(50);
      expect(result).toBe('success');

      const report = performanceMonitor.getPerformanceReport(1);
      expect(report.operations['custom_operation']).toBeDefined();
    });

    it('should handle errors in monitored methods', async () => {
      const errorMethod = async () => {
        throw new Error('Test error');
      };

      await expect(
        withPerformanceMonitoring('error_method', errorMethod)
      ).rejects.toThrow('Test error');

      const report = performanceMonitor.getPerformanceReport(1);
      const operation = report.operations['error_method'];
      expect(operation).toBeDefined();
      expect(operation.errorRate).toBeGreaterThan(0);
    });
  });

  describe('withPerformanceMonitoring', () => {

    it('should monitor wrapped operations', async () => {
      const result = await withPerformanceMonitoring(
        'wrapped_operation',
        async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return 'wrapped_result';
        },
        { testContext: 'wrapper_test' }
      );

      expect(result).toBe('wrapped_result');

      const report = performanceMonitor.getPerformanceReport(1);
      expect(report.operations['wrapped_operation']).toBeDefined();
    });

    it('should handle errors in wrapped operations', async () => {
      await expect(
        withPerformanceMonitoring(
          'error_operation',
          async () => {
            throw new Error('Wrapped error');
          }
        )
      ).rejects.toThrow('Wrapped error');

      const report = performanceMonitor.getPerformanceReport(1);
      const operation = report.operations['error_operation'];
      expect(operation).toBeDefined();
      expect(operation.errorRate).toBeGreaterThan(0);
    });
  });

  describe('BatchPerformanceMonitor', () => {

    it('should monitor batch operations', async () => {
      const batchMonitor = new BatchPerformanceMonitor('test_batch', 5, {
        batchType: 'test'
      });

      // Simulate processing items
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        batchMonitor.itemCompleted(i < 4); // Last item fails
      }

      const progress = batchMonitor.getProgress();
      expect(progress.completed).toBe(4);
      expect(progress.failed).toBe(1);
      expect(progress.total).toBe(5);
      expect(progress.successRate).toBe(0.8);

      batchMonitor.complete();

      const report = performanceMonitor.getPerformanceReport(1);
      expect(report.operations['Batch.test_batch']).toBeDefined();
    });
  });
});

describe('Integration Tests', () => {

  it('should work together across all monitoring components', async () => {
    const env = MockEnvironmentFactory.createBasicEnvironment();
    const performanceService = new PerformanceService(env, {
      enableDetailedMetrics: false,
    });

    // Simulate various operations
    const dbResult = await DatabasePerformanceMonitor.monitorDatabaseOperation(
      'integration_test',
      'SELECT',
      'SELECT * FROM integration_test',
      [],
      async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { results: [{ id: 1 }], success: true };
      }
    );

    const wrappedResult = await withPerformanceMonitoring(
      'integration_wrapped',
      async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'integration_success';
      }
    );

    // Check that all metrics are captured
    const systemMetrics = performanceService.getSystemMetrics();
    const dbMetrics = performanceService.getDatabaseMetrics();
    const performanceReport = performanceService.getPerformanceReport();

    expect(systemMetrics.operationMetrics.totalOperations).toBeGreaterThan(0);
    expect(dbMetrics.summary.totalQueries).toBeGreaterThan(0);
    expect(Object.keys(performanceReport.operations).length).toBeGreaterThan(0);

    await performanceService.cleanup();
  });
});
