/**
 * Structured logging system with correlation IDs and metrics collection
 */

import { performanceMonitor } from './performance-monitor';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  context?: Record<string, unknown>;
  metadata?: {
    source?: string;
    userId?: string;
    chatId?: string;
    operation?: string;
    duration?: number;
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
  };
}

export interface LoggerConfig {
  level: LogLevel;
  enableCorrelationIds: boolean;
  enableMetrics: boolean;
  enableConsoleOutput: boolean;
  enableStructuredOutput: boolean;
  maxLogEntries: number;
  correlationIdHeader?: string;
}

export interface LogMetrics {
  totalLogs: number;
  logsByLevel: Record<LogLevel, number>;
  errorRate: number;
  recentErrors: LogEntry[];
  topSources: Array<{ source: string; count: number }>;
  averageLogSize: number;
}

export class StructuredLogger {
  private static instance: StructuredLogger;
  private config: LoggerConfig;
  private logEntries: LogEntry[] = [];
  private correlationIdCounter = 0;
  private currentCorrelationId?: string;
  private metrics: LogMetrics;

  private constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: config?.level ?? 'info',
      enableCorrelationIds: config?.enableCorrelationIds ?? true,
      enableMetrics: config?.enableMetrics ?? true,
      enableConsoleOutput: config?.enableConsoleOutput ?? true,
      enableStructuredOutput: config?.enableStructuredOutput ?? true,
      maxLogEntries: config?.maxLogEntries ?? 1000,
      correlationIdHeader: config?.correlationIdHeader ?? 'x-correlation-id',
    };

    this.metrics = {
      totalLogs: 0,
      logsByLevel: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
        fatal: 0,
      },
      errorRate: 0,
      recentErrors: [],
      topSources: [],
      averageLogSize: 0,
    };
  }

  static getInstance(config?: Partial<LoggerConfig>): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger(config);
    }
    return StructuredLogger.instance;
  }

  /**
   * Set correlation ID for current context
   */
  setCorrelationId(correlationId: string): void {
    this.currentCorrelationId = correlationId;
  }

  /**
   * Generate new correlation ID
   */
  generateCorrelationId(): string {
    const timestamp = Date.now().toString(36);
    const counter = (++this.correlationIdCounter).toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    return `${timestamp}-${counter}-${random}`;
  }

  /**
   * Get current correlation ID or generate new one
   */
  getCorrelationId(): string {
    if (!this.currentCorrelationId && this.config.enableCorrelationIds) {
      this.currentCorrelationId = this.generateCorrelationId();
    }
    return this.currentCorrelationId || 'no-correlation-id';
  }

  /**
   * Clear current correlation ID
   */
  clearCorrelationId(): void {
    this.currentCorrelationId = undefined;
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>, metadata?: LogEntry['metadata']): void {
    this.log('debug', message, context, metadata);
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>, metadata?: LogEntry['metadata']): void {
    this.log('info', message, context, metadata);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>, metadata?: LogEntry['metadata']): void {
    this.log('warn', message, context, metadata);
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, context?: Record<string, unknown>, metadata?: LogEntry['metadata']): void {
    const errorMetadata = error ? {
      ...metadata,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    } : metadata;

    this.log('error', message, context, errorMetadata);
  }

  /**
   * Log fatal message
   */
  fatal(message: string, error?: Error, context?: Record<string, unknown>, metadata?: LogEntry['metadata']): void {
    const errorMetadata = error ? {
      ...metadata,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    } : metadata;

    this.log('fatal', message, context, errorMetadata);
  }

  /**
   * Log operation with performance tracking
   */
  logOperation<T>(
    operation: string,
    fn: () => T | Promise<T>,
    context?: Record<string, unknown>
  ): T | Promise<T> {
    const correlationId = this.getCorrelationId();
    const startTime = Date.now();

    this.info(`Starting operation: ${operation}`, context, {
      operation,
      source: 'operation-logger',
    });

    const handleResult = (result: T, duration: number) => {
      this.info(`Completed operation: ${operation}`, context, {
        operation,
        duration,
        source: 'operation-logger',
      });
      return result;
    };

    const handleError = (error: Error, duration: number) => {
      this.error(`Failed operation: ${operation}`, error, context, {
        operation,
        duration,
        source: 'operation-logger',
      });
      throw error;
    };

    try {
      const result = fn();

      if (result instanceof Promise) {
        return result
          .then((res) => {
            const duration = Date.now() - startTime;
            return handleResult(res, duration);
          })
          .catch((err) => {
            const duration = Date.now() - startTime;
            return handleError(err, duration);
          });
      } else {
        const duration = Date.now() - startTime;
        return handleResult(result, duration);
      }
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      return handleError(error as Error, duration);
    }
  }

  /**
   * Create child logger with additional context
   */
  child(context: Record<string, unknown>, metadata?: LogEntry['metadata']): ChildLogger {
    return new ChildLogger(this, context, metadata);
  }

  /**
   * Get log metrics
   */
  getMetrics(): LogMetrics {
    this.updateMetrics();
    return { ...this.metrics };
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count: number = 100, level?: LogLevel): LogEntry[] {
    let logs = this.logEntries.slice(-count);
    
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    return logs;
  }

  /**
   * Search logs by criteria
   */
  searchLogs(criteria: {
    message?: string;
    level?: LogLevel;
    correlationId?: string;
    source?: string;
    timeRange?: { start: Date; end: Date };
  }): LogEntry[] {
    return this.logEntries.filter(entry => {
      if (criteria.message && !entry.message.includes(criteria.message)) {
        return false;
      }
      
      if (criteria.level && entry.level !== criteria.level) {
        return false;
      }
      
      if (criteria.correlationId && entry.correlationId !== criteria.correlationId) {
        return false;
      }
      
      if (criteria.source && entry.metadata?.source !== criteria.source) {
        return false;
      }
      
      if (criteria.timeRange) {
        const entryTime = new Date(entry.timestamp);
        if (entryTime < criteria.timeRange.start || entryTime > criteria.timeRange.end) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * Clear log entries
   */
  clearLogs(): void {
    this.logEntries = [];
    this.resetMetrics();
  }

  /**
   * Export logs as JSON
   */
  exportLogs(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      const headers = ['timestamp', 'level', 'message', 'correlationId', 'source', 'userId', 'chatId'];
      const rows = this.logEntries.map(entry => [
        entry.timestamp,
        entry.level,
        entry.message.replace(/"/g, '""'),
        entry.correlationId || '',
        entry.metadata?.source || '',
        entry.metadata?.userId || '',
        entry.metadata?.chatId || '',
      ]);
      
      return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }
    
    return JSON.stringify(this.logEntries, null, 2);
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    metadata?: LogEntry['metadata']
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: this.config.enableCorrelationIds ? this.getCorrelationId() : undefined,
      context,
      metadata,
    };

    // Store log entry
    this.logEntries.push(entry);
    
    // Maintain max entries limit
    if (this.logEntries.length > this.config.maxLogEntries) {
      this.logEntries = this.logEntries.slice(-this.config.maxLogEntries);
    }

    // Update metrics
    if (this.config.enableMetrics) {
      this.updateLogMetrics(entry);
    }

    // Output to console
    if (this.config.enableConsoleOutput) {
      this.outputToConsole(entry);
    }
  }

  /**
   * Check if should log at this level
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const logLevelIndex = levels.indexOf(level);
    
    return logLevelIndex >= currentLevelIndex;
  }

  /**
   * Output log entry to console
   */
  private outputToConsole(entry: LogEntry): void {
    if (this.config.enableStructuredOutput) {
      const output = {
        ...entry,
        context: entry.context ? JSON.stringify(entry.context) : undefined,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : undefined,
      };
      
      if (typeof console !== 'undefined') {
        switch (entry.level) {
          case 'debug':
            if (console.debug) console.debug(JSON.stringify(output));
            break;
          case 'info':
            if (console.info) console.info(JSON.stringify(output));
            break;
          case 'warn':
            if (console.warn) console.warn(JSON.stringify(output));
            break;
          case 'error':
          case 'fatal':
            if (console.error) console.error(JSON.stringify(output));
            break;
        }
      }
    } else {
      const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}]`;
      const correlationPart = entry.correlationId ? ` [${entry.correlationId}]` : '';
      const contextPart = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
      
      const message = `${prefix}${correlationPart} ${entry.message}${contextPart}`;
      
      if (typeof console !== 'undefined') {
        switch (entry.level) {
          case 'debug':
            if (console.debug) console.debug(message);
            break;
          case 'info':
            if (console.info) console.info(message);
            break;
          case 'warn':
            if (console.warn) console.warn(message);
            break;
          case 'error':
          case 'fatal':
            if (console.error) console.error(message);
            break;
        }
      }
    }
  }

  /**
   * Update log metrics
   */
  private updateLogMetrics(entry: LogEntry): void {
    this.metrics.totalLogs++;
    this.metrics.logsByLevel[entry.level]++;
    
    // Track errors
    if (entry.level === 'error' || entry.level === 'fatal') {
      this.metrics.recentErrors.push(entry);
      if (this.metrics.recentErrors.length > 100) {
        this.metrics.recentErrors = this.metrics.recentErrors.slice(-100);
      }
    }
    
    // Update error rate
    const errorCount = this.metrics.logsByLevel.error + this.metrics.logsByLevel.fatal;
    this.metrics.errorRate = this.metrics.totalLogs > 0 ? errorCount / this.metrics.totalLogs : 0;
    
    // Update average log size
    const entrySize = JSON.stringify(entry).length;
    this.metrics.averageLogSize = (this.metrics.averageLogSize * (this.metrics.totalLogs - 1) + entrySize) / this.metrics.totalLogs;
  }

  /**
   * Update comprehensive metrics
   */
  private updateMetrics(): void {
    // Update top sources
    const sourceCounts = new Map<string, number>();
    
    for (const entry of this.logEntries) {
      const source = entry.metadata?.source || 'unknown';
      sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    }
    
    this.metrics.topSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /**
   * Reset metrics
   */
  private resetMetrics(): void {
    this.metrics = {
      totalLogs: 0,
      logsByLevel: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
        fatal: 0,
      },
      errorRate: 0,
      recentErrors: [],
      topSources: [],
      averageLogSize: 0,
    };
  }
}

/**
 * Child logger with inherited context
 */
export class ChildLogger {
  constructor(
    private parent: StructuredLogger,
    private context: Record<string, unknown>,
    private metadata?: LogEntry['metadata']
  ) {}

  debug(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.debug(message, { ...this.context, ...additionalContext }, this.metadata);
  }

  info(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.info(message, { ...this.context, ...additionalContext }, this.metadata);
  }

  warn(message: string, additionalContext?: Record<string, unknown>): void {
    this.parent.warn(message, { ...this.context, ...additionalContext }, this.metadata);
  }

  error(message: string, error?: Error, additionalContext?: Record<string, unknown>): void {
    this.parent.error(message, error, { ...this.context, ...additionalContext }, this.metadata);
  }

  fatal(message: string, error?: Error, additionalContext?: Record<string, unknown>): void {
    this.parent.fatal(message, error, { ...this.context, ...additionalContext }, this.metadata);
  }

  child(additionalContext: Record<string, unknown>): ChildLogger {
    return new ChildLogger(
      this.parent,
      { ...this.context, ...additionalContext },
      this.metadata
    );
  }
}

// Global logger instance
export const logger = StructuredLogger.getInstance();