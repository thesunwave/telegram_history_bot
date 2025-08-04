import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processBatches, BatchProcessorOptions } from '../src/utils';

describe('processBatches', () => {
  beforeEach(() => {
    // Clear console mocks before each test
    vi.clearAllMocks();
    // Mock console.log and console.error to avoid noise in test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should process items in batches of specified size', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 3 };

    const results = await processBatches(items, processor, options);

    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(processor).toHaveBeenCalledTimes(10);
  });

  it('should handle batch size of 1', async () => {
    const items = [1, 2, 3];
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 1 };

    const results = await processBatches(items, processor, options);

    expect(results).toEqual([2, 4, 6]);
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it('should handle batch size larger than array length', async () => {
    const items = [1, 2, 3];
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 10 };

    const results = await processBatches(items, processor, options);

    expect(results).toEqual([2, 4, 6]);
    expect(processor).toHaveBeenCalledTimes(3);
  });

  it('should handle empty array', async () => {
    const items: number[] = [];
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 5 };

    const results = await processBatches(items, processor, options);

    expect(results).toEqual([]);
    expect(processor).not.toHaveBeenCalled();
  });

  it('should handle individual item failures gracefully', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = vi.fn().mockImplementation(async (item: number) => {
      if (item === 3) {
        throw new Error('Item 3 failed');
      }
      return item * 2;
    });
    const options: BatchProcessorOptions = { batchSize: 2 };

    const results = await processBatches(items, processor, options);

    // Should return results for successful items only
    expect(results).toEqual([2, 4, 8, 10]);
    expect(processor).toHaveBeenCalledTimes(5);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to process item'),
      expect.any(Error)
    );
  });

  it('should continue processing after batch failures', async () => {
    const items = [1, 2, 3, 4, 5, 6];
    let callCount = 0;
    const processor = vi.fn().mockImplementation(async (item: number) => {
      callCount++;
      // Make the second batch (items 3, 4) fail completely by throwing in Promise.all
      if (item === 3 || item === 4) {
        throw new Error(`Item ${item} failed`);
      }
      return item * 2;
    });
    const options: BatchProcessorOptions = { batchSize: 2 };

    const results = await processBatches(items, processor, options);

    // Should get results from batches 1 and 3, but not batch 2
    expect(results).toEqual([2, 4, 10, 12]);
    expect(processor).toHaveBeenCalledTimes(6);
  });

  it('should respect delay between batches', async () => {
    const items = [1, 2, 3, 4];
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 2, delayBetweenBatches: 100 };

    const startTime = Date.now();
    const results = await processBatches(items, processor, options);
    const endTime = Date.now();

    expect(results).toEqual([2, 4, 6, 8]);
    // Should take at least 100ms due to delay (allowing some tolerance for test execution)
    expect(endTime - startTime).toBeGreaterThanOrEqual(90);
  });

  it('should not add delay after the last batch', async () => {
    const items = [1, 2];
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 2, delayBetweenBatches: 100 };

    const startTime = Date.now();
    const results = await processBatches(items, processor, options);
    const endTime = Date.now();

    expect(results).toEqual([2, 4]);
    // Should not wait after the last batch, so should be fast
    expect(endTime - startTime).toBeLessThan(50);
  });

  it('should provide detailed logging', async () => {
    const items = [1, 2, 3, 4, 5];
    const processor = vi.fn().mockImplementation(async (item: number) => {
      if (item === 3) throw new Error('Test error');
      return item * 2;
    });
    const options: BatchProcessorOptions = { batchSize: 2 };

    await processBatches(items, processor, options);

    // Verify logging calls
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Starting batch processing: 5 items in 3 batches')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Processing batch 1/3 with 2 items')
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Batch processing completed')
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to process item'),
      expect.any(Error)
    );
  });

  it('should maintain correct order of results', async () => {
    const items = [5, 1, 3, 2, 4];
    const processor = vi.fn().mockImplementation(async (item: number) => {
      // Add random delay to simulate real async operations
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
      return item * 2;
    });
    const options: BatchProcessorOptions = { batchSize: 2 };

    const results = await processBatches(items, processor, options);

    // Results should maintain the original order
    expect(results).toEqual([10, 2, 6, 4, 8]);
  });

  it('should handle mixed success and failure in same batch', async () => {
    const items = [1, 2, 3, 4];
    const processor = vi.fn().mockImplementation(async (item: number) => {
      if (item % 2 === 0) {
        throw new Error(`Even number ${item} failed`);
      }
      return item * 2;
    });
    const options: BatchProcessorOptions = { batchSize: 4 };

    const results = await processBatches(items, processor, options);

    // Should only get results for odd numbers (1, 3)
    expect(results).toEqual([2, 6]);
    expect(processor).toHaveBeenCalledTimes(4);
    expect(console.error).toHaveBeenCalledTimes(2); // For items 2 and 4
  });

  it('should handle batch size of 10', async () => {
    const items = Array.from({ length: 25 }, (_, i) => i + 1); // [1, 2, 3, ..., 25]
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 10 };

    const results = await processBatches(items, processor, options);

    const expected = items.map(x => x * 2);
    expect(results).toEqual(expected);
    expect(processor).toHaveBeenCalledTimes(25);
    // Should process in 3 batches: 10, 10, 5
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('25 items in 3 batches of size 10')
    );
  });

  it('should handle batch size of 50', async () => {
    const items = Array.from({ length: 120 }, (_, i) => i + 1); // [1, 2, 3, ..., 120]
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 50 };

    const results = await processBatches(items, processor, options);

    const expected = items.map(x => x * 2);
    expect(results).toEqual(expected);
    expect(processor).toHaveBeenCalledTimes(120);
    // Should process in 3 batches: 50, 50, 20
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('120 items in 3 batches of size 50')
    );
  });

  it('should handle batch size of 100', async () => {
    const items = Array.from({ length: 250 }, (_, i) => i + 1); // [1, 2, 3, ..., 250]
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 100 };

    const results = await processBatches(items, processor, options);

    const expected = items.map(x => x * 2);
    expect(results).toEqual(expected);
    expect(processor).toHaveBeenCalledTimes(250);
    // Should process in 3 batches: 100, 100, 50
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('250 items in 3 batches of size 100')
    );
  });

  it('should handle single-item batches correctly', async () => {
    const items = [42];
    const processor = vi.fn().mockImplementation(async (item: number) => item * 2);
    const options: BatchProcessorOptions = { batchSize: 1 };

    const results = await processBatches(items, processor, options);

    expect(results).toEqual([84]);
    expect(processor).toHaveBeenCalledTimes(1);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('1 items in 1 batches of size 1')
    );
  });
});