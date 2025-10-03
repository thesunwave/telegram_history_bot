/**
 * Comprehensive performance monitoring system for database operations and major functions
 */

export interface PerformanceMetric {
  id: string;
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  context?: Record<string, unknown>;
  metadata?: {
    queryType?: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
    rowsAffected?: number;
    cacheHit?: boolean;
    retryCount?: number;
    errorType?: string;
    result?: string;
    success?: boolean;
    itemsProcessed?: number;
    bytesProcessed?: number;
  };
}

export interface PerformanceAlert {
  type: 'SLOW_QUERY' | 'HIGH_ERROR_RATE' | 'MEMORY_LEAK' | 'TIMEOUT';
  operation: string;
  threshold: number;
  actualValue: number;
  timestamp: number;
  context?: Record<string, unknown>;
}

export interface PerformanceReport {
  period: {
    start: number;
    end: number;
  };
  operations: {
    [operation: string]: {
      count: number;
      avgDuration: number;
      minDuration: number;
      maxDuration: number;
      errorRate: number;
      p95Duration: number;
      p99Duration: number;
    };
  };
  alerts: PerformanceAlert[];
  systemMetrics: {
    memoryUsage?: number;
    activeConnections?: number;
    cacheHitRate?: number;
  };
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, PerformanceMetric> = new Map();
  private completedMetrics: PerformanceMetric[] = [];
  private alerts: PerformanceAlert[] = [];
  
  // Performance thresholds
  private readonly thresholds = {
    SLOW_QUERY: 1000, // 1 second
    VERY_SLOW_QUERY: 5000, // 5 seconds
    HIGH_ERROR_RATE: 0.05, // 5%
    MAX_ACTIVE_OPERATIONS: 100,
    MEMORY_LEAK_THRESHOLD: 1000, // 1000 active metrics
  };

  private constructor() {
    // Note: Cleanup will be handled manually in Cloudflare Workers environment
    // setInterval is not allowed in global scope
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Start tracking a performance metric
   */
  startOperation(operation: string, context?: Record<string, unknown>): string {
    const id = `${operation}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const metric: PerformanceMetric = {
      id,
      operation,
      startTime: Date.now(),
      context,
    };

    this.metrics.set(id, metric);

    // Check for potential memory leaks
    if (this.metrics.size > this.thresholds.MEMORY_LEAK_THRESHOLD) {
      this.addAlert({
        type: 'MEMORY_LEAK',
        operation: 'SYSTEM',
        threshold: this.thresholds.MEMORY_LEAK_THRESHOLD,
        actualValue: this.metrics.size,
        timestamp: Date.now(),
        context: { activeMetrics: this.metrics.size },
      });
    }

    return id;
  }

  /**
   * End tracking a performance metric
   */
  endOperation(
    id: string, 
    metadata?: PerformanceMetric['metadata'],
    context?: Record<string, unknown>
  ): PerformanceMetric | null {
    const metric = this.metrics.get(id);
    if (!metric) {
      console.warn(`[PERF_MONITOR] No active metric found for ID: ${id}`);
      return null;
    }

    metric.endTime = Date.now();
    metric.duration = metric.endTime - metric.startTime;
    metric.metadata = { ...metric.metadata, ...metadata };
    metric.context = { ...metric.context, ...context };

    // Move to completed metrics
    this.completedMetrics.push(metric);
    this.metrics.delete(id);

    // Check for performance alerts
    this.checkPerformanceAlerts(metric);

    // Log performance data
    this.logPerformanceData(metric);

    return metric;
  }

  /**
   * Track database operation performance
   */
  async trackDatabaseOperation<T>(
    operation: string,
    queryType: PerformanceMetric['metadata']['queryType'],
    dbOperation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const id = this.startOperation(`DB_${operation}`, context);
    let result: T;
    let error: Error | null = null;

    try {
      result = await dbOperation();
      
      // Extract metadata from result if it's a D1 result
      const metadata: PerformanceMetric['metadata'] = {
        queryType: queryType || 'SELECT',
      };

      if (result && typeof result === 'object' && 'meta' in result) {
        const d1Result = result as any;
        metadata.rowsAffected = d1Result.meta?.rows_read || d1Result.meta?.rows_written || 0;
      }

      this.endOperation(id, metadata);
      return result;
    } catch (err) {
      error = err as Error;
      this.endOperation(id, {
        queryType: queryType || 'SELECT',
        errorType: error.constructor.name,
      }, { error: error.message });
      throw err;
    }
  }

  /**
   * Get performance report for a time period
   */
  getPerformanceReport(periodMinutes: number = 60): PerformanceReport {
    const now = Date.now();
    const periodStart = now - (periodMinutes * 60 * 1000);
    
    const periodMetrics = this.completedMetrics.filter(
      m => m.startTime >= periodStart && m.endTime
    );

    const operations: PerformanceReport['operations'] = {};

    // Group metrics by operation
    for (const metric of periodMetrics) {
      if (!operations[metric.operation]) {
        operations[metric.operation] = {
          count: 0,
          avgDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
          errorRate: 0,
          p95Duration: 0,
          p99Duration: 0,
        };
      }

      const op = operations[metric.operation];
      op.count++;
      
      if (metric.duration) {
        op.minDuration = Math.min(op.minDuration, metric.duration);
        op.maxDuration = Math.max(op.maxDuration, metric.duration);
      }

      if (metric.metadata?.errorType) {
        op.errorRate++;
      }
    }

    // Calculate averages and percentiles
    for (const [operationName, op] of Object.entries(operations)) {
      const operationMetrics = periodMetrics
        .filter(m => m.operation === operationName && m.duration)
        .map(m => m.duration!)
        .sort((a, b) => a - b);

      if (operationMetrics.length > 0) {
        op.avgDuration = operationMetrics.reduce((sum, d) => sum + d, 0) / operationMetrics.length;
        op.p95Duration = operationMetrics[Math.floor(operationMetrics.length * 0.95)] || 0;
        op.p99Duration = operationMetrics[Math.floor(operationMetrics.length * 0.99)] || 0;
      }

      op.errorRate = op.errorRate / op.count;
    }

    return {
      period: {
        start: periodStart,
        end: now,
      },
      operations,
      alerts: this.alerts.filter(a => a.timestamp >= periodStart),
      systemMetrics: {
        activeConnections: this.metrics.size,
        memoryUsage: this.completedMetrics.length,
      },
    };
  }

  /**
   * Get current active operations
   */
  getActiveOperations(): PerformanceMetric[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Clear old metrics to prevent memory leaks
   */
  private cleanupStaleMetrics(): void {
    const now = Date.now();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    // Clean up stale active metrics
    for (const [id, metric] of this.metrics.entries()) {
      if (now - metric.startTime > staleThreshold) {
        console.warn(`[PERF_MONITOR] Cleaning up stale metric: ${metric.operation} (${id})`);
        this.metrics.delete(id);
      }
    }

    // Keep only last 1000 completed metrics
    if (this.completedMetrics.length > 1000) {
      this.completedMetrics = this.completedMetrics.slice(-1000);
    }

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }
  }

  /**
   * Check for performance alerts
   */
  private checkPerformanceAlerts(metric: PerformanceMetric): void {
    if (typeof metric.duration !== 'number') return;

    // Slow query alert
    if (metric.duration > this.thresholds.SLOW_QUERY) {
      this.addAlert({
        type: 'SLOW_QUERY',
        operation: metric.operation,
        threshold: this.thresholds.SLOW_QUERY,
        actualValue: metric.duration,
        timestamp: Date.now(),
        context: metric.context
      });
    }

    // Timeout alert
    if (metric.duration > this.thresholds.VERY_SLOW_QUERY) {
      this.addAlert({
        type: 'TIMEOUT',
        operation: metric.operation,
        threshold: this.thresholds.VERY_SLOW_QUERY,
        actualValue: metric.duration,
        timestamp: Date.now(),
        context: metric.context
      });
    }
  }

  /**
   * Add performance alert
   */
  private addAlert(alert: PerformanceAlert): void {
    this.alerts.push(alert);

    // Log critical alerts
    if (alert.type === 'TIMEOUT' || alert.type === 'MEMORY_LEAK') {
      // eslint-disable-next-line no-console
      console.error(`[PERF_ALERT] ${alert.type}: ${alert.operation} - ${alert.actualValue} (threshold: ${alert.threshold})`, alert.context);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[PERF_ALERT] ${alert.type}: ${alert.operation} - ${alert.actualValue} (threshold: ${alert.threshold})`, alert.context);
    }
  }

  /**
   * Log performance data
   */
  private logPerformanceData(metric: PerformanceMetric): void {
    if (process.env.NODE_ENV === 'test') return;

    const logData = {
      operation: metric.operation,
      duration: metric.duration,
      startTime: new Date(metric.startTime).toISOString(),
      endTime: metric.endTime ? new Date(metric.endTime).toISOString() : undefined,
      context: metric.context,
      metadata: metric.metadata
    };

    if (typeof metric.duration === 'number' && metric.duration > this.thresholds.SLOW_QUERY) {
      // eslint-disable-next-line no-console
      console.warn(`[PERF_MONITOR] Slow operation: ${metric.operation} (${metric.duration}ms)`, logData);
    } else {
      console.log(`[PERF_MONITOR] Operation completed: ${metric.operation} (${metric.duration}ms)`, logData);
    }
  }
}

// Singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance();