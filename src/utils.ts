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
  
  console.log(`Starting batch processing: ${totalItems} items in ${totalBatches} batches of size ${batchSize}`);
  
  let processedItems = 0;
  let failedItems = 0;
  let apiLimitErrors = 0;
  let criticalBatchFailures = 0;
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
      
      for (const batchResult of batchResults) {
        if (batchResult.success) {
          results.push(batchResult.result as R);
        } else {
          batchFailures++;
          failedItems++;
          errors.push(batchResult.error as BatchProcessingError);
          
          if ((batchResult.error as BatchProcessingError).type === BatchErrorType.API_LIMIT_EXCEEDED) {
            batchApiLimitErrors++;
            apiLimitErrors++;
          }
        }
      }
      
      processedItems += batch.length;
      const batchDuration = Date.now() - batchStartTime;
      
      console.log(
        `Batch ${batchNumber} completed in ${batchDuration}ms: ` +
        `${batch.length - batchFailures}/${batch.length} successful, ` +
        `${batchFailures} failed` +
        (batchApiLimitErrors > 0 ? `, ${batchApiLimitErrors} API limit errors` : '')
      );
      
      // If we're hitting API limits, increase delay for subsequent batches
      if (batchApiLimitErrors > 0 && batchNumber < totalBatches) {
        const adaptiveDelay = Math.max(delayBetweenBatches, 1000); // At least 1 second
        console.log(`API limits detected, increasing delay to ${adaptiveDelay}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, adaptiveDelay));
      } else if (delayBetweenBatches > 0 && batchNumber < totalBatches) {
        console.log(`Waiting ${delayBetweenBatches}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
      
    } catch (error) {
      // Entire batch failed - this is a critical failure
      const batchError = createBatchError(error, batchNumber);
      console.error(`Batch ${batchNumber} failed completely:`, {
        error: batchError.message,
        type: batchError.type,
        batchSize: batch.length
      });
      
      errors.push(batchError);
      failedItems += batch.length;
      criticalBatchFailures++;
      
      // If too many batches are failing completely, we might want to abort
      if (criticalBatchFailures >= Math.ceil(totalBatches * 0.5)) {
        console.error(`Too many critical batch failures (${criticalBatchFailures}/${totalBatches}), aborting remaining batches`);
        break;
      }
      
      // Continue processing remaining batches even if one batch fails completely
    }
  }
  
  const totalDuration = Date.now() - startTime;
  const successRate = totalItems > 0 ? ((processedItems - failedItems) / totalItems * 100) : 100;
  const hasApiLimitErrors = apiLimitErrors > 0;
  const hasCriticalFailures = criticalBatchFailures > 0;
  
  console.log(
    `Batch processing completed in ${totalDuration}ms: ` +
    `${results.length}/${totalItems} successful (${successRate.toFixed(1)}%), ` +
    `${failedItems} failed` +
    (hasApiLimitErrors ? `, ${apiLimitErrors} API limit errors` : '') +
    (hasCriticalFailures ? `, ${criticalBatchFailures} critical batch failures` : '')
  );
  
  return {
    results,
    totalProcessed: processedItems,
    totalFailed: failedItems,
    successRate,
    errors,
    hasApiLimitErrors,
    hasCriticalFailures
  };
}
