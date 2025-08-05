export function chunkText(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += limit) {
    parts.push(chars.slice(i, i + limit).join(''));
  }
  return parts.length ? parts : [''];
}

export function truncateText(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('');
}

/**
 * Configuration options for batch processing
 */
export interface BatchProcessorOptions {
  batchSize: number;
  delayBetweenBatches?: number;
}

/**
 * Error types that can occur during batch processing
 */
export enum BatchErrorType {
  API_LIMIT_EXCEEDED = 'API_LIMIT_EXCEEDED',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Enhanced error information for batch processing failures
 */
export interface BatchProcessingError extends Error {
  type: BatchErrorType;
  batchNumber?: number;
  itemIndex?: number;
  originalError?: Error;
  retryable?: boolean;
}

/**
 * Result of batch processing with detailed error information
 */
export interface BatchProcessingResult<R> {
  results: R[];
  totalProcessed: number;
  totalFailed: number;
  successRate: number;
  errors: BatchProcessingError[];
  hasApiLimitErrors: boolean;
  hasCriticalFailures: boolean;
  metrics: BatchProcessingMetrics;
}

/**
 * Creates a BatchProcessingError with proper classification
 */
function createBatchError(
  error: any, 
  batchNumber?: number, 
  itemIndex?: number
): BatchProcessingError {
  const message = error.message || String(error);
  let type = BatchErrorType.UNKNOWN_ERROR;
  let retryable = true;

  // Classify error types based on common patterns
  if (message.includes('Too many API requests') || 
      message.includes('rate limit') || 
      message.includes('429')) {
    type = BatchErrorType.API_LIMIT_EXCEEDED;
    retryable = false; // Don't retry immediately on rate limits
  } else if (message.includes('timeout') || 
             message.includes('TIMEOUT') ||
             message.includes('Request timeout')) {
    type = BatchErrorType.TIMEOUT;
    retryable = true;
  } else if (message.includes('network') || 
             message.includes('fetch') ||
             message.includes('connection')) {
    type = BatchErrorType.NETWORK_ERROR;
    retryable = true;
  }

  const batchError = new Error(message) as BatchProcessingError;
  batchError.name = 'BatchProcessingError';
  batchError.type = type;
  batchError.batchNumber = batchNumber;
  batchError.itemIndex = itemIndex;
  batchError.originalError = error;
  batchError.retryable = retryable;

  return batchError;
}

/**
 * Batch processing metrics for monitoring and optimization
 */
export interface BatchProcessingMetrics {
  totalItems: number;
  totalBatches: number;
  batchSize: number;
  totalDuration: number;
  averageBatchDuration: number;
  successfulItems: number;
  failedItems: number;
  successRate: number;
  apiLimitErrors: number;
  timeoutErrors: number;
  networkErrors: number;
  unknownErrors: number;
  criticalBatchFailures: number;
  requestsPerSecond: number;
  batchDurations: number[];
  errorsByBatch: { batchNumber: number; errorCount: number; errorTypes: string[] }[];
}

/**
 * Processes an array of items in controlled batches to avoid overwhelming APIs
 * with too many concurrent requests. Enhanced with detailed error handling and
 * graceful degradation for partial failures.
 * 
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param options - Configuration for batch processing
 * @returns Promise resolving to detailed batch processing result
 */
export async function processBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: BatchProcessorOptions
): Promise<R[]> {
  const result = await processBatchesDetailed(items, processor, options);
  return result.results;
}

/**
 * Enhanced version of processBatches that returns detailed error information
 * for better error handling and monitoring.
 */
export async function processBatchesDetailed<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: BatchProcessorOptions
): Promise<BatchProcessingResult<R>> {
  const { batchSize, delayBetweenBatches = 0 } = options;
  const results: R[] = [];
  const errors: BatchProcessingError[] = [];
  const totalItems = items.length;
  const totalBatches = Math.ceil(totalItems / batchSize);
  
  // Enhanced metrics tracking
  const batchDurations: number[] = [];
  const errorsByBatch: { batchNumber: number; errorCount: number; errorTypes: string[] }[] = [];
  let apiLimitErrors = 0;
  let timeoutErrors = 0;
  let networkErrors = 0;
  let unknownErrors = 0;
  let criticalBatchFailures = 0;
  
  console.log(`[BATCH_METRICS] Starting batch processing: ${totalItems} items in ${totalBatches} batches of size ${batchSize}`);
  
  let processedItems = 0;
  let failedItems = 0;
  const startTime = Date.now();

  for (let i = 0; i < items.length; i += batchSize) {
    const batchNumber = Math.floor(i / batchSize) + 1;
    const batch = items.slice(i, i + batchSize);
    const batchStartTime = Date.now();
    
    console.log(`Processing batch ${batchNumber}/${totalBatches} with ${batch.length} items`);
    
    try {
      // Process all items in the current batch concurrently
      const batchPromises = batch.map(async (item, index) => {
        try {
          const result = await processor(item);
          return { success: true, result, index };
        } catch (error) {
          const batchError = createBatchError(error, batchNumber, i + index + 1);
          console.error(`Failed to process item ${i + index + 1}/${totalItems}:`, {
            error: batchError.message,
            type: batchError.type,
            retryable: batchError.retryable
          });
          return { success: false, error: batchError, index };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Collect successful results and categorize failures
      let batchFailures = 0;
      let batchApiLimitErrors = 0;
      let batchTimeoutErrors = 0;
      let batchNetworkErrors = 0;
      let batchUnknownErrors = 0;
      const batchErrorTypes: string[] = [];
      
      for (const batchResult of batchResults) {
        if (batchResult.success) {
          results.push(batchResult.result as R);
        } else {
          batchFailures++;
          failedItems++;
          const error = batchResult.error as BatchProcessingError;
          errors.push(error);
          batchErrorTypes.push(error.type);
          
          // Categorize errors for detailed metrics
          switch (error.type) {
            case BatchErrorType.API_LIMIT_EXCEEDED:
              batchApiLimitErrors++;
              apiLimitErrors++;
              break;
            case BatchErrorType.TIMEOUT:
              batchTimeoutErrors++;
              timeoutErrors++;
              break;
            case BatchErrorType.NETWORK_ERROR:
              batchNetworkErrors++;
              networkErrors++;
              break;
            default:
              batchUnknownErrors++;
              unknownErrors++;
              break;
          }
        }
      }
      
      processedItems += batch.length;
      const batchDuration = Date.now() - batchStartTime;
      batchDurations.push(batchDuration);
      
      // Track errors by batch for pattern analysis
      if (batchFailures > 0) {
        errorsByBatch.push({
          batchNumber,
          errorCount: batchFailures,
          errorTypes: [...new Set(batchErrorTypes)] // Remove duplicates
        });
      }
      
      // Enhanced batch completion logging
      console.log(
        `[BATCH_METRICS] Batch ${batchNumber}/${totalBatches} completed in ${batchDuration}ms: ` +
        `${batch.length - batchFailures}/${batch.length} successful (${((batch.length - batchFailures) / batch.length * 100).toFixed(1)}%), ` +
        `${batchFailures} failed` +
        (batchApiLimitErrors > 0 ? `, API_LIMIT: ${batchApiLimitErrors}` : '') +
        (batchTimeoutErrors > 0 ? `, TIMEOUT: ${batchTimeoutErrors}` : '') +
        (batchNetworkErrors > 0 ? `, NETWORK: ${batchNetworkErrors}` : '') +
        (batchUnknownErrors > 0 ? `, UNKNOWN: ${batchUnknownErrors}` : '') +
        `, rate: ${(batch.length / (batchDuration / 1000)).toFixed(1)} req/s`
      );
      
      // If we're hitting API limits, increase delay for subsequent batches
      if (batchApiLimitErrors > 0 && batchNumber < totalBatches) {
        const adaptiveDelay = Math.max(delayBetweenBatches, 1000); // At least 1 second
        console.log(`[BATCH_METRICS] API limits detected, increasing delay to ${adaptiveDelay}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
      } else if (delayBetweenBatches > 0 && batchNumber < totalBatches) {
        console.log(`[BATCH_METRICS] Waiting ${delayBetweenBatches}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
      
    } catch (error) {
      // Entire batch failed - this is a critical failure
      const batchError = createBatchError(error, batchNumber);
      const batchDuration = Date.now() - batchStartTime;
      batchDurations.push(batchDuration);
      
      console.error(`[BATCH_METRICS] Batch ${batchNumber} failed completely in ${batchDuration}ms:`, {
        error: batchError.message,
        type: batchError.type,
        batchSize: batch.length,
        batchNumber,
        totalBatchesProcessed: batchNumber,
        remainingBatches: totalBatches - batchNumber
      });
      
      errors.push(batchError);
      failedItems += batch.length;
      criticalBatchFailures++;
      
      // Track critical batch failure for pattern analysis
      errorsByBatch.push({
        batchNumber,
        errorCount: batch.length,
        errorTypes: [batchError.type]
      });
      
      // Categorize the critical error
      switch (batchError.type) {
        case BatchErrorType.API_LIMIT_EXCEEDED:
          apiLimitErrors += batch.length;
          break;
        case BatchErrorType.TIMEOUT:
          timeoutErrors += batch.length;
          break;
        case BatchErrorType.NETWORK_ERROR:
          networkErrors += batch.length;
          break;
        default:
          unknownErrors += batch.length;
          break;
      }
      
      // If too many batches are failing completely, we might want to abort
      if (criticalBatchFailures >= Math.ceil(totalBatches * 0.5)) {
        console.error(`[BATCH_METRICS] Too many critical batch failures (${criticalBatchFailures}/${totalBatches}), aborting remaining batches`);
        break;
      }
      
      // Continue processing remaining batches even if one batch fails completely
    }
  }
  
  const totalDuration = Date.now() - startTime;
  const successRate = totalItems > 0 ? ((processedItems - failedItems) / totalItems * 100) : 100;
  const hasApiLimitErrors = apiLimitErrors > 0;
  const hasCriticalFailures = criticalBatchFailures > 0;
  const averageBatchDuration = batchDurations.length > 0 ? batchDurations.reduce((a, b) => a + b, 0) / batchDurations.length : 0;
  const requestsPerSecond = totalDuration > 0 ? (processedItems / (totalDuration / 1000)) : 0;
  
  // Create comprehensive metrics
  const metrics: BatchProcessingMetrics = {
    totalItems,
    totalBatches,
    batchSize,
    totalDuration,
    averageBatchDuration,
    successfulItems: results.length,
    failedItems,
    successRate,
    apiLimitErrors,
    timeoutErrors,
    networkErrors,
    unknownErrors,
    criticalBatchFailures,
    requestsPerSecond,
    batchDurations,
    errorsByBatch
  };
  
  // Enhanced completion logging with detailed metrics
  console.log(
    `[BATCH_METRICS] Batch processing completed in ${totalDuration}ms: ` +
    `${results.length}/${totalItems} successful (${successRate.toFixed(1)}%), ` +
    `${failedItems} failed, ` +
    `avg batch: ${averageBatchDuration.toFixed(0)}ms, ` +
    `rate: ${requestsPerSecond.toFixed(1)} req/s` +
    (hasApiLimitErrors ? `, API_LIMIT: ${apiLimitErrors}` : '') +
    (timeoutErrors > 0 ? `, TIMEOUT: ${timeoutErrors}` : '') +
    (networkErrors > 0 ? `, NETWORK: ${networkErrors}` : '') +
    (unknownErrors > 0 ? `, UNKNOWN: ${unknownErrors}` : '') +
    (hasCriticalFailures ? `, critical batches: ${criticalBatchFailures}` : '')
  );
  
  // Log detailed error patterns if there are failures
  if (failedItems > 0) {
    console.log(`[BATCH_METRICS] Error patterns:`, {
      errorsByBatch: errorsByBatch.slice(0, 5), // Log first 5 batches with errors
      errorDistribution: {
        apiLimit: `${apiLimitErrors} (${(apiLimitErrors / failedItems * 100).toFixed(1)}%)`,
        timeout: `${timeoutErrors} (${(timeoutErrors / failedItems * 100).toFixed(1)}%)`,
        network: `${networkErrors} (${(networkErrors / failedItems * 100).toFixed(1)}%)`,
        unknown: `${unknownErrors} (${(unknownErrors / failedItems * 100).toFixed(1)}%)`
      },
      batchFailureRate: `${criticalBatchFailures}/${totalBatches} (${(criticalBatchFailures / totalBatches * 100).toFixed(1)}%)`
    });
  }
  
  // Log performance insights
  if (batchDurations.length > 0) {
    const minDuration = Math.min(...batchDurations);
    const maxDuration = Math.max(...batchDurations);
    const medianDuration = batchDurations.sort((a, b) => a - b)[Math.floor(batchDurations.length / 2)];
    
    console.log(`[BATCH_METRICS] Performance insights:`, {
      batchDurationRange: `${minDuration}-${maxDuration}ms`,
      medianBatchDuration: `${medianDuration}ms`,
      slowBatches: batchDurations.filter(d => d > averageBatchDuration * 2).length,
      fastBatches: batchDurations.filter(d => d < averageBatchDuration * 0.5).length,
      consistencyScore: `${(100 - (maxDuration - minDuration) / averageBatchDuration * 100).toFixed(1)}%`
    });
  }
  
  return {
    results,
    totalProcessed: processedItems,
    totalFailed: failedItems,
    successRate,
    errors,
    hasApiLimitErrors,
    hasCriticalFailures,
    metrics
  };
}
