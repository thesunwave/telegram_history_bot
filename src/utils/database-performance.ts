/**
 * Database performance monitoring utilities
 */

import { performanceMonitor, PerformanceMetric } from './performance-monitor';

export interface DatabasePerformanceMetrics {
  queryCount: number;
  totalDuration: number;
  avgDuration: number;
  slowQueries: number;
  errorCount: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface QueryPerformanceData {
  query: string;
  parameters?: unknown[];
  duration: number;
  rowsAffected?: number;
  error?: string;
  cacheHit?: boolean;
}

export class DatabasePerformanceMonitor {
  private static queryMetrics: Map<string, DatabasePerformanceMetrics> = new Map();
  private static recentQueries: QueryPerformanceData[] = [];
  private static readonly MAX_RECENT_QUERIES = 100;

  /**
   * Monitor a database operation with automatic performance tracking
   */
  static async monitorDatabaseOperation<T>(
    operationName: string,
    queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE',
    query: string,
    parameters: unknown[],
    operation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now();
    let result: T;
    let error: Error | null = null;
    let rowsAffected = 0;

    try {
      result = await performanceMonitor.trackDatabaseOperation(
        operationName,
        queryType,
        operation,
        { query: this.sanitizeQuery(query), paramCount: parameters.length, ...context }
      );

      // Extract rows affected from D1 result
      if (result && typeof result === 'object' && 'meta' in result) {
        const d1Result = result as any;
        rowsAffected = d1Result.meta?.rows_read || d1Result.meta?.rows_written || 0;
      }

      return result;
    } catch (err) {
      error = err as Error;
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      
      // Record query performance data
      this.recordQueryPerformance({
        query: this.sanitizeQuery(query),
        parameters: this.sanitizeParameters(parameters),
        duration,
        rowsAffected,
        error: error?.message,
      });

      // Update operation metrics
      this.updateOperationMetrics(operationName, duration, !!error);
    }
  }

  /**
   * Get performance metrics for a specific operation
   */
  static getOperationMetrics(operationName: string): DatabasePerformanceMetrics | null {
    return this.queryMetrics.get(operationName) || null;
  }

  /**
   * Get all operation metrics
   */
  static getAllMetrics(): Map<string, DatabasePerformanceMetrics> {
    return new Map(this.queryMetrics);
  }

  /**
   * Get recent query performance data
   */
  static getRecentQueries(limit: number = 50): QueryPerformanceData[] {
    return this.recentQueries.slice(-limit);
  }

  /**
   * Get slow queries (above threshold)
   */
  static getSlowQueries(thresholdMs: number = 1000): QueryPerformanceData[] {
    return this.recentQueries.filter(q => q.duration > thresholdMs);
  }

  /**
   * Get database performance summary
   */
  static getPerformanceSummary(): {
    totalQueries: number;
    avgDuration: number;
    slowQueries: number;
    errorRate: number;
    topSlowOperations: Array<{ operation: string; avgDuration: number; count: number }>;
  } {
    let totalQueries = 0;
    let totalDuration = 0;
    let totalSlowQueries = 0;
    let totalErrors = 0;

    const operations: Array<{ operation: string; avgDuration: number; count: number }> = [];

    for (const [operation, metrics] of this.queryMetrics.entries()) {
      totalQueries += metrics.queryCount;
      totalDuration += metrics.totalDuration;
      totalSlowQueries += metrics.slowQueries;
      totalErrors += metrics.errorCount;

      operations.push({
        operation,
        avgDuration: metrics.avgDuration,
        count: metrics.queryCount,
      });
    }

    // Sort by average duration
    operations.sort((a, b) => b.avgDuration - a.avgDuration);

    return {
      totalQueries,
      avgDuration: totalQueries > 0 ? totalDuration / totalQueries : 0,
      slowQueries: totalSlowQueries,
      errorRate: totalQueries > 0 ? totalErrors / totalQueries : 0,
      topSlowOperations: operations.slice(0, 10),
    };
  }

  /**
   * Clear performance metrics (useful for testing)
   */
  static clearMetrics(): void {
    this.queryMetrics.clear();
    this.recentQueries = [];
  }

  /**
   * Record query performance data
   */
  private static recordQueryPerformance(data: QueryPerformanceData): void {
    this.recentQueries.push(data);
    
    // Keep only recent queries
    if (this.recentQueries.length > this.MAX_RECENT_QUERIES) {
      this.recentQueries = this.recentQueries.slice(-this.MAX_RECENT_QUERIES);
    }
  }

  /**
   * Update operation metrics
   */
  private static updateOperationMetrics(
    operationName: string,
    duration: number,
    hasError: boolean
  ): void {
    let metrics = this.queryMetrics.get(operationName);
    
    if (!metrics) {
      metrics = {
        queryCount: 0,
        totalDuration: 0,
        avgDuration: 0,
        slowQueries: 0,
        errorCount: 0,
        cacheHits: 0,
        cacheMisses: 0,
      };
      this.queryMetrics.set(operationName, metrics);
    }

    metrics.queryCount++;
    metrics.totalDuration += duration;
    metrics.avgDuration = metrics.totalDuration / metrics.queryCount;

    if (duration > 1000) { // 1 second threshold
      metrics.slowQueries++;
    }

    if (hasError) {
      metrics.errorCount++;
    }
  }

  /**
   * Sanitize query for logging (remove sensitive data)
   */
  private static sanitizeQuery(query: string): string {
    // Remove potential sensitive data patterns
    return query
      .replace(/\b\d{10,}\b/g, '[USER_ID]') // Replace long numbers (likely user IDs)
      .replace(/('[^']*')/g, '[STRING]') // Replace string literals
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Sanitize parameters for logging
   */
  private static sanitizeParameters(parameters: unknown[]): unknown[] {
    return parameters.map(param => {
      if (typeof param === 'string' && param.length > 100) {
        return `[LONG_STRING:${param.length}]`;
      }
      if (typeof param === 'number' && param > 1000000) {
        return '[LARGE_NUMBER]';
      }
      return param;
    });
  }
}

/**
 * Decorator for monitoring database methods
 */
export function MonitorDatabaseOperation(operationName: string, queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE') {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const context = {
        className: target.constructor.name,
        methodName: propertyName,
        argCount: args.length,
      };

      return DatabasePerformanceMonitor.monitorDatabaseOperation(
        `${target.constructor.name}.${operationName}`,
        queryType,
        'N/A', // Query will be logged by the actual implementation
        [],
        () => method.apply(this, args),
        context
      );
    };

    return descriptor;
  };
}