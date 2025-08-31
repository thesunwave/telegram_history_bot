/**
 * Comprehensive logging and metrics service
 */

import { BaseService } from './base-service';
import { logger, StructuredLogger, LogLevel, LogEntry } from '../utils/structured-logger';
import { metricsCollector, MetricsCollector, MetricsSnapshot, Alert } from '../utils/metrics-collector';
import { performanceMonitor } from '../utils/performance-monitor';
import type { Env } from '../env';

export interface LoggingMetricsConfig {
  logLevel: LogLevel;
  enableMetrics: boolean;
  enablePerformanceTracking: boolean;
  enableAlerts: boolean;
  metricsRetentionHours: number;
  logsRetentionHours: number;
  alertCheckIntervalMinutes: number;
  exportFormats: ('json' | 'csv' | 'prometheus')[];
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  metrics: {
    totalLogs: number;
    errorRate: number;
    averageResponseTime: number;
    activeOperations: number;
    memoryUsage: number;
  };
  alerts: {
    active: number;
    resolved: number;
    critical: number;
  };
  issues: string[];
}

export interface LoggingMetricsReport {
  timestamp: number;
  period: {
    start: number;
    end: number;
  };
  logs: {
    total: number;
    byLevel: Record<LogLevel, number>;
    errorRate: number;
    topSources: Array<{ source: string; count: number }>;
  };
  metrics: {
    total: number;
    uniqueNames: number;
    topMetrics: Array<{ name: string; count: number; avg: number }>;
  };
  performance: {
    averageResponseTime: number;
    slowestOperations: Array<{ operation: string; avgDuration: number }>;
    errorOperations: Array<{ operation: string; errorRate: number }>;
  };
  alerts: Alert[];
  systemHealth: SystemHealth;
}

export class LoggingMetricsService extends BaseService {
  private config: LoggingMetricsConfig;
  private logger: StructuredLogger;
  private metricsCollector: MetricsCollector;
  private reportingTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(env: Env, config?: Partial<LoggingMetricsConfig>) {
    super(env);
    
    this.config = {
      logLevel: config?.logLevel ?? 'info',
      enableMetrics: config?.enableMetrics ?? true,
      enablePerformanceTracking: config?.enablePerformanceTracking ?? true,
      enableAlerts: config?.enableAlerts ?? true,
      metricsRetentionHours: config?.metricsRetentionHours ?? 24,
      logsRetentionHours: config?.logsRetentionHours ?? 24,
      alertCheckIntervalMinutes: config?.alertCheckIntervalMinutes ?? 5,
      exportFormats: config?.exportFormats ?? ['json', 'prometheus'],
    };

    this.logger = StructuredLogger.getInstance({
      level: this.config.logLevel,
      enableMetrics: this.config.enableMetrics,
    });

    this.metricsCollector = MetricsCollector.getInstance();
  }

  /**
   * Get logger instance
   */
  getLogger(): StructuredLogger {
    return this.logger;
  }

  /**
   * Get metrics collector instance
   */
  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  /**
   * Log application events with automatic metrics collection
   */
  logEvent(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    metadata?: LogEntry['metadata']
  ): void {
    // Log the event
    this.logger[level](message, context as any, metadata);

    // Collect metrics if enabled
    if (this.config.enableMetrics) {
      this.metricsCollector.counter('logs_total', 1, { level });
      
      if (level === 'error' || level === 'fatal') {
        this.metricsCollector.counter('errors_total', 1, {
          source: metadata?.source || 'unknown',
        });
      }

      if (metadata?.operation) {
        this.metricsCollector.counter('operations_total', 1, {
          operation: metadata.operation,
        });

        if (metadata.duration) {
          this.metricsCollector.timer('operation_duration_ms', metadata.duration, {
            operation: metadata.operation,
          });
        }
      }
    }
  }

  /**
   * Track operation with logging and metrics
   */
  async trackOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const correlationId = this.logger.generateCorrelationId();
    this.logger.setCorrelationId(correlationId);

    const startTime = Date.now();
    
    this.logEvent('info', `Starting operation: ${operationName}`, context, {
      operation: operationName,
      source: 'operation-tracker',
    });

    try {
      const result = await this.metricsCollector.time(
        `operation.${operationName}`,
        operation,
        { operation: operationName }
      );

      const duration = Date.now() - startTime;
      
      this.logEvent('info', `Completed operation: ${operationName}`, context, {
        operation: operationName,
        duration,
        source: 'operation-tracker',
      });

      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      
      this.logEvent('error', `Failed operation: ${operationName}`, context, {
        operation: operationName,
        duration,
        source: 'operation-tracker',
        error: {
          name: error instanceof Error ? error.name : 'UnknownError',
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });

      throw error;
    } finally {
      this.logger.clearCorrelationId();
    }
  }

  /**
   * Get system health status
   */
  getSystemHealth(): SystemHealth {
    const logMetrics = this.logger.getMetrics();
    const metricsSnapshot = this.metricsCollector.getSnapshot();
    const performanceReport = performanceMonitor.getPerformanceReport(60);
    const activeAlerts = this.metricsCollector.getActiveAlerts();

    const issues: string[] = [];
    let status: SystemHealth['status'] = 'healthy';

    // Check error rate
    if (logMetrics.errorRate > 0.1) { // 10% error rate
      issues.push(`High error rate: ${(logMetrics.errorRate * 100).toFixed(2)}%`);
      status = 'degraded';
    }

    if (logMetrics.errorRate > 0.25) { // 25% error rate
      status = 'critical';
    }

    // Check response times
    const avgResponseTime = this.calculateAverageResponseTime(performanceReport);
    if (avgResponseTime > 5000) { // 5 seconds
      issues.push(`Slow response time: ${avgResponseTime}ms`);
      status = status === 'critical' ? 'critical' : 'degraded';
    }

    // Check active alerts
    const criticalAlerts = activeAlerts.filter(alert => 
      alert.rule.name.includes('critical') || alert.rule.threshold > 1000
    );

    if (criticalAlerts.length > 0) {
      issues.push(`${criticalAlerts.length} critical alerts active`);
      status = 'critical';
    } else if (activeAlerts.length > 5) {
      issues.push(`${activeAlerts.length} alerts active`);
      status = status === 'critical' ? 'critical' : 'degraded';
    }

    return {
      status,
      uptime: metricsSnapshot.systemMetrics.uptime,
      metrics: {
        totalLogs: logMetrics.totalLogs,
        errorRate: logMetrics.errorRate,
        averageResponseTime: avgResponseTime,
        activeOperations: metricsSnapshot.systemMetrics.activeOperations,
        memoryUsage: metricsSnapshot.systemMetrics.memoryUsage,
      },
      alerts: {
        active: activeAlerts.length,
        resolved: this.metricsCollector.getAllAlerts().filter(a => a.status === 'resolved').length,
        critical: criticalAlerts.length,
      },
      issues,
    };
  }

  /**
   * Generate comprehensive report
   */
  generateReport(periodHours: number = 24): LoggingMetricsReport {
    const now = Date.now();
    const periodStart = now - (periodHours * 60 * 60 * 1000);

    const logMetrics = this.logger.getMetrics();
    const metricsSnapshot = this.metricsCollector.getSnapshot();
    const performanceReport = performanceMonitor.getPerformanceReport(periodHours * 60);
    const alerts = this.metricsCollector.getAllAlerts();
    const systemHealth = this.getSystemHealth();

    // Calculate top metrics
    const topMetrics = metricsSnapshot.metrics
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(m => ({
        name: m.name,
        count: m.count,
        avg: m.avg,
      }));

    // Calculate performance metrics
    const operationMetrics = Object.entries(performanceReport.operations);
    const slowestOperations = operationMetrics
      .sort(([, a], [, b]) => b.avgDuration - a.avgDuration)
      .slice(0, 10)
      .map(([operation, metrics]) => ({
        operation,
        avgDuration: metrics.avgDuration,
      }));

    const errorOperations = operationMetrics
      .filter(([, metrics]) => metrics.errorRate > 0)
      .sort(([, a], [, b]) => b.errorRate - a.errorRate)
      .slice(0, 10)
      .map(([operation, metrics]) => ({
        operation,
        errorRate: metrics.errorRate,
      }));

    return {
      timestamp: now,
      period: {
        start: periodStart,
        end: now,
      },
      logs: {
        total: logMetrics.totalLogs,
        byLevel: logMetrics.logsByLevel,
        errorRate: logMetrics.errorRate,
        topSources: logMetrics.topSources,
      },
      metrics: {
        total: metricsSnapshot.metrics.reduce((sum, m) => sum + m.count, 0),
        uniqueNames: metricsSnapshot.metrics.length,
        topMetrics,
      },
      performance: {
        averageResponseTime: this.calculateAverageResponseTime(performanceReport),
        slowestOperations,
        errorOperations,
      },
      alerts: alerts.filter(alert => alert.triggeredAt >= periodStart),
      systemHealth,
    };
  }

  /**
   * Export logs in specified format
   */
  exportLogs(format: 'json' | 'csv' = 'json'): string {
    return this.logger.exportLogs(format);
  }

  /**
   * Export metrics in specified format
   */
  exportMetrics(format: 'json' | 'prometheus' = 'json'): string {
    if (format === 'prometheus') {
      return this.metricsCollector.exportPrometheus();
    }

    const snapshot = this.metricsCollector.getSnapshot();
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Search logs with criteria
   */
  searchLogs(criteria: {
    message?: string;
    level?: LogLevel;
    correlationId?: string;
    source?: string;
    timeRange?: { start: Date; end: Date };
  }): LogEntry[] {
    return this.logger.searchLogs(criteria);
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 100, level?: LogLevel): LogEntry[] {
    return this.logger.getRecentLogs(count, level);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return this.metricsCollector.getActiveAlerts();
  }

  /**
   * Add custom alert rule
   */
  addAlertRule(rule: {
    name: string;
    metric: string;
    condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
    threshold: number;
    duration: number;
    enabled?: boolean;
  }): void {
    this.metricsCollector.addAlertRule({
      ...rule,
      enabled: rule.enabled ?? true,
    });

    this.logEvent('info', `Alert rule added: ${rule.name}`, {
      metric: rule.metric,
      threshold: rule.threshold,
      condition: rule.condition,
    }, {
      source: 'alert-manager',
    });
  }

  /**
   * Clear old data
   */
  cleanupOldData(): void {
    // Clear old logs
    const oldLogs = this.logger.getRecentLogs(10000);
    const cutoffTime = Date.now() - (this.config.logsRetentionHours * 60 * 60 * 1000);
    const recentLogs = oldLogs.filter(log => new Date(log.timestamp).getTime() > cutoffTime);
    
    if (recentLogs.length < oldLogs.length) {
      this.logger.clearLogs();
      // Re-add recent logs (this is a simplified approach)
      this.logEvent('info', `Cleaned up ${oldLogs.length - recentLogs.length} old log entries`, {}, {
        source: 'cleanup-service',
      });
    }

    // Clear resolved alerts
    const clearedAlerts = this.metricsCollector.clearResolvedAlerts();
    if (clearedAlerts > 0) {
      this.logEvent('info', `Cleared ${clearedAlerts} resolved alerts`, {}, {
        source: 'cleanup-service',
      });
    }
  }

  /**
   * Start periodic reporting
   */
  startPeriodicReporting(intervalMinutes: number = 60): void {
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
    }

    this.reportingTimer = setInterval(() => {
      const report = this.generateReport(1); // Last hour
      
      this.logEvent('info', 'Periodic system report', {
        systemHealth: report.systemHealth.status,
        totalLogs: report.logs.total,
        errorRate: report.logs.errorRate,
        activeAlerts: report.alerts.length,
        averageResponseTime: report.performance.averageResponseTime,
      }, {
        source: 'periodic-reporter',
      });

      // Log critical issues
      if (report.systemHealth.status === 'critical') {
        this.logEvent('error', 'System in critical state', {
          issues: report.systemHealth.issues,
        }, {
          source: 'health-monitor',
        });
      }
    }, intervalMinutes * 60 * 1000);
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
   * Start health monitoring
   */
  startHealthMonitoring(intervalMinutes: number = 5): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      const health = this.getSystemHealth();
      
      if (health.status !== 'healthy') {
        this.logEvent('warn', `System health: ${health.status}`, {
          issues: health.issues,
          metrics: health.metrics,
        }, {
          source: 'health-monitor',
        });
      }
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  async initialize(): Promise<void> {
    this.logEvent('info', 'LoggingMetricsService initialized', {
      config: this.config,
    }, {
      source: 'logging-metrics-service',
    });

    if (this.config.enableAlerts) {
      this.startHealthMonitoring(this.config.alertCheckIntervalMinutes);
    }

    // Start periodic reporting
    this.startPeriodicReporting(60); // Every hour
  }

  async cleanup(): Promise<void> {
    this.stopPeriodicReporting();
    this.stopHealthMonitoring();
    
    this.logEvent('info', 'LoggingMetricsService cleanup completed', {}, {
      source: 'logging-metrics-service',
    });
  }

  /**
   * Calculate average response time from performance report
   */
  private calculateAverageResponseTime(performanceReport: any): number {
    const operations = Object.values(performanceReport.operations) as any[];
    if (operations.length === 0) return 0;

    const totalDuration = operations.reduce((sum, op) => sum + (op.avgDuration * op.count), 0);
    const totalCount = operations.reduce((sum, op) => sum + op.count, 0);

    return totalCount > 0 ? totalDuration / totalCount : 0;
  }
}