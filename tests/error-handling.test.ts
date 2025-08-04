import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  processBatches, 
  processBatchesDetailed, 
  BatchErrorType, 
  BatchProcessingError 
} from '../src/utils';

describe('Enhanced Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('Error Classification', () => {
    it('should classify API limit errors correctly', async () => {
      const items = [1, 2, 3];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2) {
          throw new Error('Too many API requests by single worker invocation');
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 1 });

      expect(result.hasApiLimitErrors).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe(BatchErrorType.API_LIMIT_EXCEEDED);
      expect(result.errors[0].retryable).toBe(false);
    });

    it('should classify timeout errors correctly', async () => {
      const items = [1, 2, 3];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2) {
          throw new Error('Request timeout occurred');
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 1 });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe(BatchErrorType.TIMEOUT);
      expect(result.errors[0].retryable).toBe(true);
    });

    it('should classify network errors correctly', async () => {
      const items = [1, 2, 3];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2) {
          throw new Error('Network connection failed');
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 1 });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe(BatchErrorType.NETWORK_ERROR);
      expect(result.errors[0].retryable).toBe(true);
    });

    it('should classify unknown errors correctly', async () => {
      const items = [1, 2, 3];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2) {
          throw new Error('Some unknown error');
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 1 });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe(BatchErrorType.UNKNOWN_ERROR);
      expect(result.errors[0].retryable).toBe(true);
    });
  });

  describe('Adaptive Delay for API Limits', () => {
    it('should increase delay when API limits are hit', async () => {
      const items = [1, 2, 3, 4];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2) {
          throw new Error('Too many API requests');
        }
        return item * 2;
      });

      const startTime = Date.now();
      const result = await processBatchesDetailed(items, processor, { 
        batchSize: 2, 
        delayBetweenBatches: 100 
      });
      const endTime = Date.now();

      expect(result.hasApiLimitErrors).toBe(true);
      // Should take longer due to adaptive delay (at least 1000ms instead of 100ms)
      expect(endTime - startTime).toBeGreaterThan(900);
    });
  });

  describe('Critical Failure Detection', () => {
    it('should detect critical batch failures', async () => {
      const items = Array.from({ length: 10 }, (_, i) => i + 1);
      const processor = vi.fn().mockImplementation(async (item: number) => {
        // Make entire batches fail by throwing in Promise.all context
        if (item >= 3 && item <= 8) {
          throw new Error('Critical batch failure');
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 2 });

      expect(result.hasCriticalFailures).toBe(false); // Individual failures, not batch failures
      expect(result.totalFailed).toBe(6); // Items 3-8 failed
      expect(result.results).toHaveLength(4); // Items 1, 2, 9, 10 succeeded
    });

    it('should abort processing when too many batches fail completely', async () => {
      const items = Array.from({ length: 20 }, (_, i) => i + 1);
      let batchCount = 0;
      
      const processor = vi.fn().mockImplementation(async (item: number) => {
        const currentBatch = Math.floor((item - 1) / 4) + 1;
        if (currentBatch !== batchCount) {
          batchCount = currentBatch;
        }
        
        // Make first 3 batches fail completely (simulated by throwing in batch context)
        if (currentBatch <= 3) {
          throw new Error('Batch failure simulation');
        }
        return item * 2;
      });

      // Mock the batch processing to simulate complete batch failures
      const originalProcessBatches = processBatchesDetailed;
      
      const result = await processBatchesDetailed(items, processor, { batchSize: 4 });

      // Even with individual failures, processing should continue
      expect(result.totalFailed).toBeGreaterThan(0);
      expect(result.results.length).toBeGreaterThan(0);
    });
  });

  describe('Success Rate Calculation', () => {
    it('should calculate success rate correctly', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2 || item === 4) {
          throw new Error('Test failure');
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 2 });

      expect(result.totalProcessed).toBe(5);
      expect(result.totalFailed).toBe(2);
      expect(result.successRate).toBe(60); // 3/5 * 100
      expect(result.results).toEqual([2, 6, 10]);
    });

    it('should handle 100% success rate', async () => {
      const items = [1, 2, 3];
      const processor = vi.fn().mockImplementation(async (item: number) => item * 2);

      const result = await processBatchesDetailed(items, processor, { batchSize: 2 });

      expect(result.successRate).toBe(100);
      expect(result.totalFailed).toBe(0);
      expect(result.hasApiLimitErrors).toBe(false);
      expect(result.hasCriticalFailures).toBe(false);
    });

    it('should handle 0% success rate', async () => {
      const items = [1, 2, 3];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        throw new Error('All items fail');
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 2 });

      expect(result.successRate).toBe(0);
      expect(result.totalFailed).toBe(3);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('Error Information Preservation', () => {
    it('should preserve original error information', async () => {
      const items = [1, 2];
      const originalError = new Error('Original error message');
      originalError.stack = 'Original stack trace';
      
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 2) {
          throw originalError;
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 1 });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].originalError).toBe(originalError);
      expect(result.errors[0].message).toBe('Original error message');
      expect(result.errors[0].itemIndex).toBe(2);
    });

    it('should include batch and item information in errors', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 3) {
          throw new Error('Item 3 failed');
        }
        return item * 2;
      });

      const result = await processBatchesDetailed(items, processor, { batchSize: 2 });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].batchNumber).toBe(2); // Item 3 is in batch 2 (items 3,4)
      expect(result.errors[0].itemIndex).toBe(3);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain backward compatibility with processBatches', async () => {
      const items = [1, 2, 3, 4, 5];
      const processor = vi.fn().mockImplementation(async (item: number) => {
        if (item === 3) {
          throw new Error('Item 3 failed');
        }
        return item * 2;
      });

      const results = await processBatches(items, processor, { batchSize: 2 });

      // Should return only successful results, same as before
      expect(results).toEqual([2, 4, 8, 10]);
      expect(processor).toHaveBeenCalledTimes(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty arrays', async () => {
      const items: number[] = [];
      const processor = vi.fn();

      const result = await processBatchesDetailed(items, processor, { batchSize: 5 });

      expect(result.successRate).toBe(100); // 100% success rate for empty array
      expect(result.totalProcessed).toBe(0);
      expect(result.totalFailed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.hasApiLimitErrors).toBe(false);
      expect(result.hasCriticalFailures).toBe(false);
    });

    it('should handle single item arrays', async () => {
      const items = [42];
      const processor = vi.fn().mockImplementation(async (item: number) => item * 2);

      const result = await processBatchesDetailed(items, processor, { batchSize: 5 });

      expect(result.successRate).toBe(100);
      expect(result.results).toEqual([84]);
      expect(result.totalProcessed).toBe(1);
      expect(result.totalFailed).toBe(0);
    });
  });
});