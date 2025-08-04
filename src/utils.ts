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
 * Processes an array of items in controlled batches to avoid overwhelming APIs
 * with too many concurrent requests.
 * 
 * @param items - Array of items to process
 * @param processor - Async function to process each item
 * @param options - Configuration for batch processing
 * @returns Promise resolving to array of results (excluding failed items)
 */
export async function processBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: BatchProcessorOptions
): Promise<R[]> {
  const { batchSize, delayBetweenBatches = 0 } = options;
  const results: R[] = [];
  const totalItems = items.length;
  const totalBatches = Math.ceil(totalItems / batchSize);
  
  console.log(`Starting batch processing: ${totalItems} items in ${totalBatches} batches of size ${batchSize}`);
  
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
          console.error(`Failed to process item ${i + index + 1}/${totalItems}:`, error);
          return { success: false, error, index };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Collect successful results and count failures
      let batchFailures = 0;
      for (const batchResult of batchResults) {
        if (batchResult.success) {
          results.push(batchResult.result as R);
        } else {
          batchFailures++;
          failedItems++;
        }
      }
      
      processedItems += batch.length;
      const batchDuration = Date.now() - batchStartTime;
      
      console.log(
        `Batch ${batchNumber} completed in ${batchDuration}ms: ` +
        `${batch.length - batchFailures}/${batch.length} successful, ` +
        `${batchFailures} failed`
      );
      
      // Add delay between batches if configured
      if (delayBetweenBatches > 0 && batchNumber < totalBatches) {
        console.log(`Waiting ${delayBetweenBatches}ms before next batch`);
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
      
    } catch (error) {
      console.error(`Batch ${batchNumber} failed completely:`, error);
      failedItems += batch.length;
      // Continue processing remaining batches even if one batch fails completely
    }
  }
  
  const totalDuration = Date.now() - startTime;
  const successRate = ((processedItems - failedItems) / totalItems * 100).toFixed(1);
  
  console.log(
    `Batch processing completed in ${totalDuration}ms: ` +
    `${results.length}/${totalItems} successful (${successRate}%), ` +
    `${failedItems} failed`
  );
  
  return results;
}
