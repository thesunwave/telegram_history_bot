/**
 * Metrics collection and aggregation system
 */

import { performanceMonitor } from './performance-monitor';
import { logger } from './structured-logger';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'timer';

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface MetricSummary {
  name: string;
  type: MetricType;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  labels?: Record<string, string>;
}

export interface MetricsSnapshot {
  timestamp: number;
  metrics: MetricSummary[];
  systemMetrics: {
    uptime: number;
    memoryUsage: number;
    activeOperations: number;
    errorRate: number;
  };
}

export interface AlertRule {
  name: string;
  metric: string;
  condition: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  threshold: number;
  duration: number; // seconds
  enabled: boolean;
  labels?: Record<string, string>;
}

export interface Alert {
  rule: AlertRule;
  metric: Metric;
  triggeredAt: number;
  resolved?: number;
  status: 'active' | 'resolved';
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private metrics: Map<string, Metric[]> = new Map();
  private alertRules: AlertRule[] = [];
  private activeAlerts: Map<string, Alert> = new Map();
  private startTime: number = Date.now();
  private maxMetricsPerName = 1000;

  private constructor() {
    this.initializeDefaultAlerts();
    
    // Clean up old metrics every 5 minutes
    setInterval(() => this.cleanupOldMetrics(), 5 * 60 * 1000);
    
    // Check alerts every minute
    setInterval(() => this.checkAlerts(), 60 * 1000);
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Record a counter metric
   */
  counter(name: string, value: number = 1, labels?: Record<string, string>): void {
    this.recordMetric({
      name,
      type: 'counter',
      value,
      timestamp: Date.now(),
      labels,
    });
  }

  /**
   * Record a gauge metric
   */
  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.recordMetric({
      name,
      type: 'gauge',
      value,
      timestamp: Date.now(),
      labels,
    });
  }

  /**
   * Record a histogram metric
   */
  histogram(name: string, value: number, labels?: Record<string, string>): void {
    this.recordMetric({
      name,
      type: 'histogram',
      value,
      timestamp: Date.now(),
      labels,
    });
  }

  /**
   * Record a timer metric
   */
  timer(name: string, value: number, labels?: Record<string, string>): void {
    this.recordMetric({
      name,
      type: 'timer',
      value,
      timestamp: Date.now(),
      labels,
    });
  }

  /**
   * Time a function execution
   */
  time<T>(name: string, fn: () => T | Promise<T>, labels?: Record<string, string>): T | Promise<T> {
    const startTime = Date.now();

    const recordTiming = (duration: number) => {
      this.timer(name, duration, labels);
    };

    try {
      const result = fn();

      if (result instanceof Promise) {
        return result
          .then((res) => {
            recordTiming(Date.now() - startTime);
            return res;
          })
          .catch((err) => {
            recordTiming(Date.now() - startTime);
            this.counter(`${name}.error`, 1, labels);
            throw err;
          });
      } else {
        recordTiming(Date.now() - startTime);
        return result;
      }
    } catch (error: unknown) {
      recordTiming(Date.now() - startTime);
      this.counter(`${name}.error`, 1, labels);
      throw error;
    }
  }

  /**
   * Increment a counter
   */
  increment(name: string, labels?: Record<string, string>): void {
    this.counter(name, 1, labels);
  }

  /**
   * Decrement a counter
   */
  decrement(name: string, labels?: Record<string, string>): void {
    this.counter(name, -1, labels);
  }

  /**
   * Set a gauge value
   */
  set(name: string, value: number, labels?: Record<string, string>): void {
    this.gauge(name, value, labels);
  }

  /**
   * Get metric summary
   */
  getMetricSummary(name: string, timeRange?: { start: number; end: number }): MetricSummary | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    let filteredMetrics = metrics;
    if (timeRange) {
      filteredMetrics = metrics.filter(
        m => m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
      );
    }

    if (filteredMetrics.length === 0) {
      return null;
    }

    const values = filteredMetrics.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((acc, val) => acc + val, 0);

    return {
      name,
      type: filteredMetrics[0].type,
      count: values.length,
      sum,
      min: values[0],
      max: values[values.length - 1],
      avg: sum / values.length,
      p50: this.percentile(values, 0.5),
      p95: this.percentile(values, 0.95),
      p99: this.percentile(values, 0.99),
      labels: filteredMetrics[0].labels,
    };
  }

  /**
   * Get all metric summaries
   */
  getAllMetricSummaries(timeRange?: { start: number; end: number }): MetricSummary[] {
    const summaries: MetricSummary[] = [];

    for (const name of this.metrics.keys()) {
      const summary = this.getMetricSummary(name, timeRange);
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get metrics snapshot
   */
  getSnapshot(): MetricsSnapshot {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    return {
      timestamp: now,
      metrics: this.getAllMetricSummaries({ start: oneHourAgo, end: now }),
      systemMetrics: {
        uptime: now - this.startTime,
        memoryUsage: this.getMemoryUsage(),
        activeOperations: performanceMonitor.getActiveOperations().length,
        errorRate: this.calculateErrorRate(),
      },
    };
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.push(rule);
    logger.info('Alert rule added', { ruleName: rule.name, metric: rule.metric });
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(name: string): boolean {
    const index = this.alertRules.findIndex(rule => rule.name === name);
    if (index >= 0) {
      this.alertRules.splice(index, 1);
      logger.info('Alert rule removed', { ruleName: name });
      return true;
    }
    return false;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).filter(alert => alert.status === 'active');
  }

  /**
   * Get all alerts (active and resolved)
   */
  getAllAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Clear resolved alerts
   */
  clearResolvedAlerts(): number {
    const resolved = Array.from(this.activeAlerts.entries())
      .filter(([_, alert]) => alert.status === 'resolved');
    
    for (const [key, _] of resolved) {
      this.activeAlerts.delete(key);
    }

    return resolved.length;
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];
    const summaries = this.getAllMetricSummaries();

    for (const summary of summaries) {
      const metricName = summary.name.replace(/[^a-zA-Z0-9_]/g, '_');
      const labelsStr = summary.labels 
        ? Object.entries(summary.labels).map(([k, v]) => `${k}="${v}"`).join(',')
        : '';
      const labelsPart = labelsStr ? `{${labelsStr}}` : '';

      lines.push(`# HELP ${metricName} ${summary.type} metric`);
      lines.push(`# TYPE ${metricName} ${summary.type}`);
      
      if (summary.type === 'histogram' || summary.type === 'timer') {
        lines.push(`${metricName}_count${labelsPart} ${summary.count}`);
        lines.push(`${metricName}_sum${labelsPart} ${summary.sum}`);
        lines.push(`${metricName}_avg${labelsPart} ${summary.avg}`);
        lines.push(`${metricName}_p50${labelsPart} ${summary.p50}`);
        lines.push(`${metricName}_p95${labelsPart} ${summary.p95}`);
        lines.push(`${metricName}_p99${labelsPart} ${summary.p99}`);
      } else {
        lines.push(`${metricName}${labelsPart} ${summary.sum}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
    logger.info('All metrics cleared');
  }

  /**
   * Get metrics statistics
   */
  getStatistics(): {
    totalMetrics: number;
    uniqueMetricNames: number;
    oldestMetric: number;
    newestMetric: number;
    memoryUsage: number;
  } {
    let totalMetrics = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;

    for (const metrics of this.metrics.values()) {
      totalMetrics += metrics.length;
      
      for (const metric of metrics) {
        if (metric.timestamp < oldestTimestamp) {
          oldestTimestamp = metric.timestamp;
        }
        if (metric.timestamp > newestTimestamp) {
          newestTimestamp = metric.timestamp;
        }
      }
    }

    return {
      totalMetrics,
      uniqueMetricNames: this.metrics.size,
      oldestMetric: oldestTimestamp,
      newestMetric: newestTimestamp,
      memoryUsage: this.getMemoryUsage(),
    };
  }

  /**
   * Record a metric
   */
  private recordMetric(metric: Metric): void {
    const key = this.getMetricKey(metric.name, metric.labels);
    
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    const metrics = this.metrics.get(key)!;
    metrics.push(metric);

    // Keep only recent metrics
    if (metrics.length > this.maxMetricsPerName) {
      metrics.splice(0, metrics.length - this.maxMetricsPerName);
    }
  }

  /**
   * Get metric key for storage
   */
  private getMetricKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }

    const labelPairs = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');

    return `${name}{${labelPairs}}`;
  }

  /**
   * Calculate percentile
   */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    
    const index = Math.ceil(values.length * p) - 1;
    return values[Math.max(0, Math.min(index, values.length - 1))];
  }

  /**
   * Clean up old metrics
   */
  private cleanupOldMetrics(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    let cleaned = 0;

    for (const [key, metrics] of this.metrics.entries()) {
      const filtered = metrics.filter(m => m.timestamp > cutoff);
      
      if (filtered.length !== metrics.length) {
        cleaned += metrics.length - filtered.length;
        
        if (filtered.length === 0) {
          this.metrics.delete(key);
        } else {
          this.metrics.set(key, filtered);
        }
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} old metrics`);
    }
  }

  /**
   * Check alert rules
   */
  private checkAlerts(): void {
    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;

      const summary = this.getMetricSummary(rule.metric);
      if (!summary) continue;

      const value = summary.avg; // Use average for alert evaluation
      const shouldAlert = this.evaluateCondition(value, rule.condition, rule.threshold);
      const alertKey = `${rule.name}_${rule.metric}`;
      const existingAlert = this.activeAlerts.get(alertKey);

      if (shouldAlert && !existingAlert) {
        // Create new alert
        const alert: Alert = {
          rule,
          metric: {
            name: rule.metric,
            type: summary.type,
            value,
            timestamp: Date.now(),
            labels: rule.labels,
          },
          triggeredAt: Date.now(),
          status: 'active',
        };

        this.activeAlerts.set(alertKey, alert);
        logger.warn(`Alert triggered: ${rule.name}`, {
          metric: rule.metric,
          value,
          threshold: rule.threshold,
          condition: rule.condition,
        });

      } else if (!shouldAlert && existingAlert && existingAlert.status === 'active') {
        // Resolve alert
        existingAlert.status = 'resolved';
        existingAlert.resolved = Date.now();
        
        logger.info(`Alert resolved: ${rule.name}`, {
          metric: rule.metric,
          value,
          duration: existingAlert.resolved - existingAlert.triggeredAt,
        });
      }
    }
  }

  /**
   * Evaluate alert condition
   */
  private evaluateCondition(value: number, condition: AlertRule['condition'], threshold: number): boolean {
    switch (condition) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  /**
   * Initialize default alert rules
   */
  private initializeDefaultAlerts(): void {
    this.addAlertRule({
      name: 'high_error_rate',
      metric: 'errors_total',
      condition: 'gt',
      threshold: 10,
      duration: 300, // 5 minutes
      enabled: true,
    });

    this.addAlertRule({
      name: 'slow_response_time',
      metric: 'response_time_ms',
      condition: 'gt',
      threshold: 5000, // 5 seconds
      duration: 300,
      enabled: true,
    });

    this.addAlertRule({
      name: 'high_memory_usage',
      metric: 'memory_usage_bytes',
      condition: 'gt',
      threshold: 100 * 1024 * 1024, // 100MB
      duration: 600, // 10 minutes
      enabled: true,
    });
  }

  /**
   * Get memory usage estimate
   */
  private getMemoryUsage(): number {
    let size = 0;
    
    for (const metrics of this.metrics.values()) {
      size += metrics.length * 200; // Rough estimate of 200 bytes per metric
    }
    
    return size;
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(): number {
    const errorMetrics = this.getMetricSummary('errors_total');
    const totalMetrics = this.getMetricSummary('requests_total');
    
    if (!errorMetrics || !totalMetrics || totalMetrics.sum === 0) {
      return 0;
    }
    
    return errorMetrics.sum / totalMetrics.sum;
  }
}

// Global metrics collector instance
export const metricsCollector = MetricsCollector.getInstance();