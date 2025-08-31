/**
 * Performance monitoring service for tracking application performance
 */

import { performanceMonitor, PerformanceReport, PerformanceAlert } from '../utils/performance-monitor';
import { DatabasePerformanceMonitor } from '../utils/database-performance';
import { BaseService } from './base-service';
import type { Env } from '../env';

export interface PerformanceServiceConfig {
  enableDetailedMetrics: boolean;
  alertThresholds: {
    slowOperation: number;
    verySlowOperation: number;
    highErrorRate: number;
  };
  reportingInterval: number;
  maxMetricsHistory: number;
}

export interface SystemPerformanceMetrics {
  uptime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  operationMetrics: {
    totalOperations: number;
    averageResponseTime: number;
    errorRate: number;
    slowOperations: number;
  };
  databaseMetrics: {
    totalQueries: number;
    averageQueryTime: number;
    slowQueries: number;
    errorRate: number;
  };
}

export class PerformanceService extends BaseService {
  private config: PerformanceServiceConfig;
  private startTime: number;
  private reportingTimer?: NodeJS.Timeout;

  constructor(env: Env, config?: Partial<PerformanceServiceConfig>) {
    super(env);
    this.startTime = Date.now();
    
    this.config = {
      enableDetailedMetrics: config?.enableDetailedMetrics ?? true,
      alertThresholds: {
        slowOperation: config?.alertThresholds?.slowOperation ?? 1000,
        verySlowOperation: config?.alertThresholds?.verySlowOperation ?? 5000,
        highErrorRate: config?.alertThresholds?.highErrorRate ?? 0.05,
      },
      reportingInterval: config?.reportingInterval ?? 300000, // 5 minutes
      maxMetricsHistory: config?.maxMetricsHistory ?? 1000,
      ...config,
    };

    if (this.config.enableDetailedMetrics) {
      this.startPeriodicReporting();
    }
  }

  /**
   * Get current system performance metrics
   */
  getSystemMetrics(): SystemPerformanceMetrics {
    const performanceReport = performanceMonitor.getPerformanceReport(60); // Last hour
    const dbSummary = DatabasePerformanceMonitor.getPerformanceSummary();
    
    // Calculate operation metrics
    let totalOperations = 0;
    let totalDuration = 0;
    let totalErrors = 0;
    let slowOperations = 0;

    for (const [operation, metrics] of Object.entries(performanceReport.operations)) {
      totalOperations += metrics.count;
      totalDuration += metrics.avgDuration * metrics.count;
      totalErrors += metrics.errorRate * metrics.count;
      
      if (metrics.avgDuration > this.config.alertThresholds.slowOperation) {
        slowOperations++;
      }
    }

    return {
      uptime: Date.now() - this.startTime,
      memoryUsage: {
        used: performanceReport.systemMetrics.memoryUsage || 0,
        total: 1000, // Placeholder - would need actual memory info
        percentage: (performanceReport.systemMetrics.memoryUsage || 0) / 1000,
      },
      operationMetrics: {
        totalOperations,
        averageResponseTime: totalOperations > 0 ? totalDuration / totalOperations : 0,
        errorRate: totalOperations > 0 ? totalErrors / totalOperations : 0,
        slowOperations,
      },
      databaseMetrics: {
        totalQueries: dbSummary.totalQueries,
        averageQueryTime: dbSummary.avgDuration,
        slowQueries: dbSummary.slowQueries,
        errorRate: dbSummary.errorRate,
      },
    };
  }

  /**
   * Get performance report for a specific time period
   */
  getPerformanceReport(periodMinutes: number = 60): PerformanceReport {
    return performanceMonitor.getPerformanceReport(periodMinutes);
  }

  /**
   * Get database performance metrics
   */
  getDatabaseMetrics() {
    return {
      summary: DatabasePerformanceMonitor.getPerformanceSummary(),
      recentQueries: DatabasePerformanceMonitor.getRecentQueries(20),
      slowQueries: DatabasePerformanceMonitor.getSlowQueries(this.config.alertThresholds.slowOperation),
      operationMetrics: DatabasePerformanceMonitor.getAllMetrics(),
    };
  }

  /**
   * Get active operations
   */
  getActiveOperations() {
    return performanceMonitor.getActiveOperations();
  }

  /**
   * Get recent performance alerts
   */
  getRecentAlerts(periodMinutes: number = 60): PerformanceAlert[] {
    const report = performanceMonitor.getPerformanceReport(periodMinutes);
    return report.alerts;
  }

  /**
   * Check system health based on performance metrics
   */
  checkSystemHealth(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    metrics: SystemPerformanceMetrics;
  } {
    const metrics = this.getSystemMetrics();
    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';

    // Check error rates
    if (metrics.operationMetrics.errorRate > this.config.alertThresholds.highErrorRate) {
      issues.push(`High operation error rate: ${(metrics.operationMetrics.errorRate * 100).toFixed(2)}%`);
      status = 'warning';
    }

    if (metrics.databaseMetrics.errorRate > this.config.alertThresholds.highErrorRate) {
      issues.push(`High database error rate: ${(metrics.databaseMetrics.errorRate * 100).toFixed(2)}%`);
      status = 'warning';
    }

    // Check response times
    if (metrics.operationMetrics.averageResponseTime > this.config.alertThresholds.verySlowOperation) {
      issues.push(`Very slow average response time: ${metrics.operationMetrics.averageResponseTime}ms`);
      status = 'critical';
    } else if (metrics.operationMetrics.averageResponseTime > this.config.alertThresholds.slowOperation) {
      issues.push(`Slow average response time: ${metrics.operationMetrics.averageResponseTime}ms`);
      if (status === 'healthy') status = 'warning';
    }

    // Check database performance
    if (metrics.databaseMetrics.averageQueryTime > this.config.alertThresholds.verySlowOperation) {
      issues.push(`Very slow database queries: ${metrics.databaseMetrics.averageQueryTime}ms`);
      status = 'critical';
    } else if (metrics.databaseMetrics.averageQueryTime > this.config.alertThresholds.slowOperation) {
      issues.push(`Slow database queries: ${metrics.databaseMetrics.averageQueryTime}ms`);
      if (status === 'healthy') status = 'warning';
    }

    // Check memory usage
    if (metrics.memoryUsage.percentage > 0.9) {
      issues.push(`High memory usage: ${(metrics.memoryUsage.percentage * 100).toFixed(2)}%`);
      status = 'critical';
    } else if (metrics.memoryUsage.percentage > 0.8) {
      issues.push(`Elevated memory usage: ${(metrics.memoryUsage.percentage * 100).toFixed(2)}%`);
      if (status === 'healthy') status = 'warning';
    }

    return {
      status,
      issues,
      metrics,
    };
  }

  /**
   * Generate performance report for logging/monitoring
   */
  generatePerformanceReport(): string {
    const health = this.checkSystemHealth();
    const dbMetrics = this.getDatabaseMetrics();
    const activeOps = this.getActiveOperations();

    const report = [
      '=== PERFORMANCE REPORT ===',
      `Status: ${health.status.toUpperCase()}`,
      `Uptime: ${Math.round(health.metrics.uptime / 1000 / 60)} minutes`,
      '',
      '--- Operation Metrics ---',
      `Total Operations: ${health.metrics.operationMetrics.totalOperations}`,
      `Average Response Time: ${health.metrics.operationMetrics.averageResponseTime.toFixed(2)}ms`,
      `Error Rate: ${(health.metrics.operationMetrics.errorRate * 100).toFixed(2)}%`,
      `Slow Operations: ${health.metrics.operationMetrics.slowOperations}`,
      '',
      '--- Database Metrics ---',
      `Total Queries: ${health.metrics.databaseMetrics.totalQueries}`,
      `Average Query Time: ${health.metrics.databaseMetrics.averageQueryTime.toFixed(2)}ms`,
      `Slow Queries: ${health.metrics.databaseMetrics.slowQueries}`,
      `DB Error Rate: ${(health.metrics.databaseMetrics.errorRate * 100).toFixed(2)}%`,
      '',
      '--- Active Operations ---',
      `Active Operations: ${activeOps.length}`,
      ...activeOps.slice(0, 5).map(op => 
        `  ${op.operation} (${Date.now() - op.startTime}ms running)`
      ),
      '',
      '--- Issues ---',
      ...health.issues.map(issue => `  ⚠️  ${issue}`),
      '',
      '--- Top Slow Operations ---',
      ...dbMetrics.summary.topSlowOperations.slice(0, 5).map(op =>
        `  ${op.operation}: ${op.avgDuration.toFixed(2)}ms avg (${op.count} calls)`
      ),
    ];

    if (health.issues.length === 0) {
      report.push('✅ No performance issues detected');
    }

    return report.join('\n');
  }

  /**
   * Start periodic performance reporting
   */
  private startPeriodicReporting(): void {
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
    }

    this.reportingTimer = setInterval(() => {
      const report = this.generatePerformanceReport();
      console.log(report);
    }, this.config.reportingInterval);
  }

  /**
   * Stop periodic reporting
   */
  stopPeriodicReporting(): void {
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
      this.reportingTimer = undefined;
    }
  }

  /**
   * Clear all performance metrics (useful for testing)
   */
  clearMetrics(): void {
    DatabasePerformanceMonitor.clearMetrics();
    // Note: performanceMonitor doesn't have a clear method, but we could add one
  }

  async initialize(): Promise<void> {
    console.log('PerformanceService initialized');
  }

  async cleanup(): Promise<void> {
    this.stopPeriodicReporting();
    console.log('PerformanceService cleaned up');
  }
}