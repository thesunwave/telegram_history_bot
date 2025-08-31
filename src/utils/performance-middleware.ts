/**
 * Performance monitoring middleware and decorators
 */

import { performanceMonitor } from './performance-monitor';

/**
 * Decorator for monitoring method performance
 */
export function MonitorPerformance(operationName?: string) {
  return function (target: any, propertyName: string, descriptor?: PropertyDescriptor) {
    // Handle both legacy and modern decorator usage
    if (!descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(target, propertyName) || {
        value: target[propertyName],
        writable: true,
        enumerable: true,
        configurable: true,
      };
    }

    const method = descriptor.value;
    if (typeof method !== 'function') {
      throw new Error(`@MonitorPerformance can only be applied to methods, but ${propertyName} is not a function`);
    }

    const className = target.constructor?.name || 'Unknown';
    const defaultOperationName = `${className}.${propertyName}`;

    descriptor.value = async function (...args: any[]) {
      const perfId = performanceMonitor.startOperation(
        operationName || defaultOperationName,
        {
          className,
          methodName: propertyName,
          argCount: args.length,
        }
      );

      try {
        const result = await method.apply(this, args);
        
        performanceMonitor.endOperation(perfId, {
          success: true,
        });
        
        return result;
      } catch (error: unknown) {
        performanceMonitor.endOperation(perfId, {
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
        });
        
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Wrapper function for monitoring async operations
 */
export async function withPerformanceMonitoring<T>(
  operationName: string,
  operation: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  const perfId = performanceMonitor.startOperation(operationName, context);

  try {
    const result = await operation();
    performanceMonitor.endOperation(perfId);
    return result;
  } catch (error: unknown) {
    performanceMonitor.endOperation(perfId, {
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
    });
    throw error;
  }
}

/**
 * Performance monitoring for HTTP-like operations
 */
export class PerformanceMiddleware {
  /**
   * Monitor Telegram API calls
   */
  static async monitorTelegramAPI<T>(
    method: string,
    operation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    return withPerformanceMonitoring(
      `TelegramAPI.${method}`,
      operation,
      { apiMethod: method, ...context }
    );
  }

  /**
   * Monitor AI provider calls
   */
  static async monitorAIProvider<T>(
    provider: string,
    operation: string,
    aiOperation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    return withPerformanceMonitoring(
      `AIProvider.${provider}.${operation}`,
      aiOperation,
      { provider, operation, ...context }
    );
  }

  /**
   * Monitor message processing operations
   */
  static async monitorMessageProcessing<T>(
    operation: string,
    messageOperation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    return withPerformanceMonitoring(
      `MessageProcessing.${operation}`,
      messageOperation,
      { operation, ...context }
    );
  }

  /**
   * Monitor KV storage operations
   */
  static async monitorKVOperation<T>(
    operation: 'get' | 'put' | 'delete' | 'list',
    kvOperation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    return withPerformanceMonitoring(
      `KV.${operation}`,
      kvOperation,
      { kvOperation: operation, ...context }
    );
  }

  /**
   * Monitor Durable Object operations
   */
  static async monitorDurableObject<T>(
    objectType: string,
    operation: string,
    doOperation: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    return withPerformanceMonitoring(
      `DO.${objectType}.${operation}`,
      doOperation,
      { objectType, operation, ...context }
    );
  }
}

/**
 * Performance monitoring for batch operations
 */
export class BatchPerformanceMonitor {
  private batchId: string;
  private itemCount: number;
  private startTime: number;
  private completedItems: number = 0;
  private failedItems: number = 0;

  constructor(batchOperation: string, itemCount: number, context?: Record<string, unknown>) {
    this.itemCount = itemCount;
    this.startTime = Date.now();
    this.batchId = performanceMonitor.startOperation(
      `Batch.${batchOperation}`,
      { itemCount, ...context }
    );
  }

  /**
   * Mark an item as completed
   */
  itemCompleted(success: boolean = true): void {
    if (success) {
      this.completedItems++;
    } else {
      this.failedItems++;
    }
  }

  /**
   * Complete the batch operation
   */
  complete(): void {
    const duration = Date.now() - this.startTime;
    const successRate = this.itemCount > 0 ? this.completedItems / this.itemCount : 0;

    performanceMonitor.endOperation(this.batchId, {
      itemsProcessed: this.itemCount,
      itemsCompleted: this.completedItems,
      itemsFailed: this.failedItems,
      successRate,
      avgTimePerItem: this.itemCount > 0 ? duration / this.itemCount : 0,
    });
  }

  /**
   * Get current batch progress
   */
  getProgress(): {
    completed: number;
    failed: number;
    total: number;
    successRate: number;
    duration: number;
  } {
    return {
      completed: this.completedItems,
      failed: this.failedItems,
      total: this.itemCount,
      successRate: this.itemCount > 0 ? this.completedItems / this.itemCount : 0,
      duration: Date.now() - this.startTime,
    };
  }
}

/**
 * Performance monitoring for streaming operations
 */
export class StreamPerformanceMonitor {
  private streamId: string;
  private startTime: number;
  private bytesProcessed: number = 0;
  private itemsProcessed: number = 0;

  constructor(streamOperation: string, context?: Record<string, unknown>) {
    this.startTime = Date.now();
    this.streamId = performanceMonitor.startOperation(
      `Stream.${streamOperation}`,
      context
    );
  }

  /**
   * Update stream progress
   */
  updateProgress(bytesProcessed: number, itemsProcessed: number): void {
    this.bytesProcessed = bytesProcessed;
    this.itemsProcessed = itemsProcessed;
  }

  /**
   * Complete the stream operation
   */
  complete(): void {
    const duration = Date.now() - this.startTime;
    const throughputBps = duration > 0 ? this.bytesProcessed / (duration / 1000) : 0;
    const throughputIps = duration > 0 ? this.itemsProcessed / (duration / 1000) : 0;

    performanceMonitor.endOperation(this.streamId, {
      bytesProcessed: this.bytesProcessed,
      itemsProcessed: this.itemsProcessed,
      throughputBytesPerSecond: throughputBps,
      throughputItemsPerSecond: throughputIps,
    });
  }

  /**
   * Get current stream metrics
   */
  getMetrics(): {
    duration: number;
    bytesProcessed: number;
    itemsProcessed: number;
    throughputBps: number;
    throughputIps: number;
  } {
    const duration = Date.now() - this.startTime;
    return {
      duration,
      bytesProcessed: this.bytesProcessed,
      itemsProcessed: this.itemsProcessed,
      throughputBps: duration > 0 ? this.bytesProcessed / (duration / 1000) : 0,
      throughputIps: duration > 0 ? this.itemsProcessed / (duration / 1000) : 0,
    };
  }
}