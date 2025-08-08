import { Env } from './env';

/**
 * Performance tracking utilities for monitoring function execution times
 */
export interface PerformanceMetrics {
  functionName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  chatId?: string;
  additionalData?: any;
}

export class PerformanceTracker {
  private static activeTrackers = new Map<string, PerformanceMetrics>();

  static start(functionName: string, chatId?: string, additionalData?: any): string {
    const trackerId = `${functionName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const metrics: PerformanceMetrics = {
      functionName,
      startTime: Date.now(),
      chatId,
      additionalData
    };
    
    this.activeTrackers.set(trackerId, metrics);
    
    console.log(`[PERF_TRACKER] Started tracking ${functionName}${chatId ? ` for chat ${chatId}` : ''}`, {
      trackerId,
      startTime: new Date(metrics.startTime).toISOString(),
      additionalData
    });
    
    return trackerId;
  }

  static end(trackerId: string, additionalData?: any): PerformanceMetrics | null {
    const metrics = this.activeTrackers.get(trackerId);
    if (!metrics) {
      console.warn(`[PERF_TRACKER] No active tracker found for ID: ${trackerId}`);
      return null;
    }

    metrics.endTime = Date.now();
    metrics.duration = metrics.endTime - metrics.startTime;
    
    if (additionalData) {
      metrics.additionalData = { ...metrics.additionalData, ...additionalData };
    }

    console.log(`[PERF_TRACKER] Completed ${metrics.functionName}${metrics.chatId ? ` for chat ${metrics.chatId}` : ''} in ${metrics.duration}ms`, {
      trackerId,
      duration: metrics.duration,
      startTime: new Date(metrics.startTime).toISOString(),
      endTime: new Date(metrics.endTime).toISOString(),
      additionalData: metrics.additionalData
    });

    this.activeTrackers.delete(trackerId);
    return metrics;
  }

  static getActiveTrackers(): Map<string, PerformanceMetrics> {
    return new Map(this.activeTrackers);
  }

  static cleanup(): void {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    
    for (const [trackerId, metrics] of this.activeTrackers.entries()) {
      if (now - metrics.startTime > staleThreshold) {
        console.warn(`[PERF_TRACKER] Cleaning up stale tracker: ${metrics.functionName} (${trackerId}), started ${Math.round((now - metrics.startTime) / 1000)}s ago`);
        this.activeTrackers.delete(trackerId);
      }
    }
  }
}

export class Logger {
  private static isDebugEnabled(env: Env): boolean {
    return env.DEBUG_LOGS === 'true' || env.DEBUG_LOGS === '1';
  }

  static debug(env: Env, message: string, data?: any): void {
    if (this.isDebugEnabled(env)) {
      if (data) {
        console.debug(message, data);
      } else {
        console.debug(message);
      }
    }
  }

  static log(message: string, data?: any): void {
    if (data) {
      console.log(message, data);
    } else {
      console.log(message);
    }
  }

  static warn(message: string, data?: any): void {
    if (data) {
      console.warn(message, data);
    } else {
      console.warn(message);
    }
  }

  static error(message: string, data?: any): void {
    if (data) {
      console.error(message, data);
    } else {
      console.error(message);
    }
  }

  /**
   * Log API request patterns for optimization analysis
   */
  static logApiRequestPattern(env: Env, operation: string, data: {
    requestCount: number;
    duration: number;
    successRate: number;
    errorTypes?: string[];
    batchSize?: number;
    chatId?: string;
  }): void {
    console.log(`[API_PATTERN] ${operation}`, {
      timestamp: new Date().toISOString(),
      operation,
      requestCount: data.requestCount,
      duration: data.duration,
      requestsPerSecond: data.duration > 0 ? (data.requestCount / (data.duration / 1000)).toFixed(2) : '0',
      successRate: `${data.successRate.toFixed(1)}%`,
      errorTypes: data.errorTypes || [],
      batchSize: data.batchSize,
      chatId: data.chatId,
      efficiency: data.batchSize && data.duration > 0 ? 
        `${(data.batchSize / (data.duration / 1000)).toFixed(1)} items/s` : 'N/A'
    });
  }

  /**
   * Log performance insights for function execution
   */
  static logPerformanceInsight(env: Env, functionName: string, data: {
    duration: number;
    itemsProcessed?: number;
    memoryUsage?: number;
    chatId?: string;
    stage?: string;
    insights?: string[];
  }): void {
    const insights = data.insights || [];
    
    // Add automatic insights based on performance data
    if (data.duration > 30000) {
      insights.push('SLOW_EXECUTION');
    }
    if (data.itemsProcessed && data.duration > 0) {
      const rate = data.itemsProcessed / (data.duration / 1000);
      if (rate < 10) {
        insights.push('LOW_THROUGHPUT');
      } else if (rate > 100) {
        insights.push('HIGH_THROUGHPUT');
      }
    }

    console.log(`[PERF_INSIGHT] ${functionName}${data.stage ? `_${data.stage}` : ''}`, {
      timestamp: new Date().toISOString(),
      functionName,
      stage: data.stage,
      duration: data.duration,
      itemsProcessed: data.itemsProcessed,
      throughput: data.itemsProcessed && data.duration > 0 ? 
        `${(data.itemsProcessed / (data.duration / 1000)).toFixed(1)} items/s` : 'N/A',
      memoryUsage: data.memoryUsage,
      chatId: data.chatId,
      insights,
      performanceGrade: this.calculatePerformanceGrade(data.duration, data.itemsProcessed)
    });
  }

  private static calculatePerformanceGrade(duration: number, itemsProcessed?: number): string {
    if (duration < 1000) return 'EXCELLENT';
    if (duration < 5000) return 'GOOD';
    if (duration < 15000) return 'FAIR';
    if (duration < 30000) return 'POOR';
    return 'CRITICAL';
  }
}