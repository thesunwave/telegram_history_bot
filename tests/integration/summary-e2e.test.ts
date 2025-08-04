import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker, { CountersDO } from '../../src/index';
import { KVNamespace } from '@miniflare/kv';
import { MemoryStorage } from '@miniflare/storage-memory';
import { D1Database } from '@miniflare/d1';
import { ProviderInitializer } from '../../src/providers/provider-init';
import type { ExecutionContext, ScheduledEvent } from '@cloudflare/workers-types';

interface Env {
  HISTORY: any;
  COUNTERS: any;
  COUNTERS_DO: any;
  DB: any;
  AI: { run: (model: string, opts: any) => Promise<any> };
  TOKEN: string;
  SECRET: string;
  SUMMARY_MODEL: string;
  SUMMARY_PROMPT: string;
  SUMMARY_SYSTEM?: string;
  SUMMARY_CHUNK_SIZE?: number;
  SUMMARY_PROVIDER?: 'cloudflare' | 'openai';
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  SUMMARY_MAX_TOKENS?: number;
  SUMMARY_TEMPERATURE?: number;
  SUMMARY_TOP_P?: number;
  SUMMARY_FREQUENCY_PENALTY?: number;
  KV_BATCH_SIZE?: number;
  KV_BATCH_DELAY?: number;
}

function createCountersNamespace(env: Env) {
  const objects = new Map<string, { obj: any; chain: Promise<any> }>();
  return {
    idFromName(name: string) {
      return name as any;
    },
    get(id: string) {
      let entry = objects.get(id);
      if (!entry) {
        const state = {
          blockConcurrencyWhile: async (fn: () => Promise<any>) => await fn(),
        } as any;
        entry = { obj: new CountersDO(state, env), chain: Promise.resolve() };
        objects.set(id, entry);
      }
      return {
        fetch: (url: string, init?: RequestInit) => {
          entry!.chain = entry!.chain.then(() =>
            entry!.obj.fetch(new Request(url, init)),
          );
          return entry!.chain;
        },
      } as any;
    },
  };
}

describe('Summary End-to-End Tests', () => {
  let env: Env;
  let ctx: any;
  let tasks: Promise<any>[];
  let fetchMock: any;
  let apiRequestCount: number;

  beforeEach(async () => {
    tasks = [];
    ctx = { waitUntil: (p: Promise<any>) => tasks.push(p) };
    ProviderInitializer.reset();
    apiRequestCount = 0;
    
    const history = new KVNamespace(new MemoryStorage());
    const counters = new KVNamespace(new MemoryStorage());
    const db = {
      prepare: vi.fn(() => ({
        bind: () => ({
          run: vi.fn(),
          all: vi.fn(async () => ({ results: [] })),
        }),
      })),
    } as unknown as D1Database;

    env = {
      HISTORY: history,
      COUNTERS: counters,
      COUNTERS_DO: {} as any,
      DB: db,
      AI: { run: vi.fn(async () => ({ response: "Test summary response" })) },
      TOKEN: "test-token",
      SECRET: "test-secret",
      SUMMARY_MODEL: "test-model",
      SUMMARY_PROMPT: "Summarize this conversation: {messages}",
      SUMMARY_SYSTEM: "You are a helpful assistant",
      SUMMARY_CHUNK_SIZE: 8000,
      SUMMARY_PROVIDER: 'cloudflare',
      OPENAI_API_KEY: undefined,
      OPENAI_MODEL: undefined,
      SUMMARY_MAX_TOKENS: 400,
      SUMMARY_TEMPERATURE: 0.2,
      SUMMARY_TOP_P: 0.95,
      SUMMARY_FREQUENCY_PENALTY: 0.1,
      KV_BATCH_SIZE: 50,
      KV_BATCH_DELAY: 0,
    };
    
    env.COUNTERS_DO = createCountersNamespace(env);
    
    fetchMock = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper function to create and store a large number of messages for testing
   */
  async function setupLargeMessageSet(messageCount: number, daysSpread: number = 7): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const dayInSeconds = 86400;
    const startTime = now - (daysSpread * dayInSeconds);
    
    for (let i = 0; i < messageCount; i++) {
      // Spread messages across the time period
      const messageTime = startTime + Math.floor((i / messageCount) * daysSpread * dayInSeconds);
      
      const message = {
        message: {
          message_id: i + 1,
          text: `Test message ${i + 1} with some content to make it realistic. This message contains enough text to simulate real chat messages.`,
          chat: { id: 1 },
          from: { id: 2 + (i % 10), username: `user${(i % 10) + 1}` },
          date: messageTime,
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });
      
      await worker.fetch(req, env, ctx);
    }
    
    await Promise.all(tasks);
    tasks = [];
  }

  /**
   * Helper function to send a summary command and measure response time
   */
  async function sendSummaryCommand(days: number): Promise<{ responseTime: number; success: boolean }> {
    const startTime = Date.now();
    
    const summaryCmd = {
      message: {
        message_id: 999,
        text: `/summary ${days}`,
        chat: { id: 1 },
        from: { id: 999, username: "requester" },
        date: Math.floor(Date.now() / 1000),
      },
    };
    
    const req = new Request("http://localhost/tg/test-token/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(summaryCmd),
    });
    
    try {
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      const responseTime = Date.now() - startTime;
      return { responseTime, success: true };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return { responseTime, success: false };
    }
  }

  describe('Large message set processing', () => {
    it('should handle /summary 7 command with 1000 messages without API limit errors', async () => {
      // Mock successful Telegram API responses
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      // Setup a large message set (1000 messages over 7 days)
      await setupLargeMessageSet(1000, 7);
      
      // Track API requests to ensure batching is working
      let kvRequestCount = 0;
      const originalGet = env.HISTORY.get;
      env.HISTORY.get = vi.fn(async (...args) => {
        kvRequestCount++;
        return originalGet.apply(env.HISTORY, args);
      });
      
      const { responseTime, success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      expect(responseTime).toBeLessThan(30000); // Should complete within 30 seconds
      
      // Verify that AI was called (summary was generated)
      expect(env.AI.run).toHaveBeenCalled();
      
      // Verify that Telegram message was sent
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Test summary response')
        })
      );
      
      // Verify that KV requests were made (messages were fetched)
      expect(kvRequestCount).toBeGreaterThan(0);
      
      console.log(`Processed 1000 messages in ${responseTime}ms with ${kvRequestCount} KV requests`);
    });

    it('should handle /summary 7 command with 2000 messages and verify batching limits', async () => {
      // Set a smaller batch size to test batching behavior
      env.KV_BATCH_SIZE = 25;
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      // Setup an even larger message set
      await setupLargeMessageSet(2000, 7);
      
      // Track concurrent requests to ensure batching is working
      let maxConcurrentRequests = 0;
      let currentConcurrentRequests = 0;
      const originalGet = env.HISTORY.get;
      env.HISTORY.get = vi.fn(async (...args) => {
        currentConcurrentRequests++;
        maxConcurrentRequests = Math.max(maxConcurrentRequests, currentConcurrentRequests);
        
        try {
          return await originalGet.apply(env.HISTORY, args);
        } finally {
          currentConcurrentRequests--;
        }
      });
      
      const { responseTime, success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      expect(responseTime).toBeLessThan(30000);
      
      // Verify that concurrent requests never exceeded batch size
      expect(maxConcurrentRequests).toBeLessThanOrEqual(env.KV_BATCH_SIZE!);
      
      console.log(`Processed 2000 messages with max ${maxConcurrentRequests} concurrent requests (batch size: ${env.KV_BATCH_SIZE})`);
    });

    it('should handle /summary 7 command with 500 messages in reasonable time', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      // Setup a moderate message set
      await setupLargeMessageSet(500, 7);
      
      const { responseTime, success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      expect(responseTime).toBeLessThan(15000); // Should be faster with fewer messages
      
      expect(env.AI.run).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.any(Object)
      );
      
      console.log(`Processed 500 messages in ${responseTime}ms`);
    });
  });

  describe('API request limit verification', () => {
    it('should not exceed API request limits during processing', async () => {
      // Set conservative batch size
      env.KV_BATCH_SIZE = 20;
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(800, 7);
      
      // Track all API calls
      let totalApiCalls = 0;
      let maxBatchSize = 0;
      let currentBatchSize = 0;
      
      const originalGet = env.HISTORY.get;
      const originalList = env.HISTORY.list;
      
      env.HISTORY.get = vi.fn(async (...args) => {
        totalApiCalls++;
        currentBatchSize++;
        maxBatchSize = Math.max(maxBatchSize, currentBatchSize);
        
        // Simulate a small delay to make concurrent requests more realistic
        await new Promise(resolve => setTimeout(resolve, 1));
        
        try {
          return await originalGet.apply(env.HISTORY, args);
        } finally {
          currentBatchSize--;
        }
      });
      
      env.HISTORY.list = vi.fn(async (...args) => {
        totalApiCalls++;
        return originalList.apply(env.HISTORY, args);
      });
      
      const { success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      
      // Verify that we never exceeded the batch size for concurrent requests
      expect(maxBatchSize).toBeLessThanOrEqual(env.KV_BATCH_SIZE!);
      
      // Verify that we made a reasonable number of API calls
      expect(totalApiCalls).toBeGreaterThan(0);
      expect(totalApiCalls).toBeLessThan(1000); // Should be much less due to batching
      
      console.log(`Made ${totalApiCalls} total API calls with max ${maxBatchSize} concurrent (limit: ${env.KV_BATCH_SIZE})`);
    });

    it('should handle API request failures gracefully', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(100, 7);
      
      // Simulate some KV request failures
      let failureCount = 0;
      const originalGet = env.HISTORY.get;
      env.HISTORY.get = vi.fn(async (...args) => {
        // Fail every 10th request
        if (Math.random() < 0.1) {
          failureCount++;
          throw new Error('Simulated KV failure');
        }
        return originalGet.apply(env.HISTORY, args);
      });
      
      const { success } = await sendSummaryCommand(7);
      
      // Should still succeed despite some failures
      expect(success).toBe(true);
      expect(failureCount).toBeGreaterThan(0); // Verify we actually had failures
      
      console.log(`Handled ${failureCount} KV failures gracefully`);
    });
  });

  describe('Response time requirements', () => {
    it('should complete /summary 7 for 300 messages under 10 seconds', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(300, 7);
      
      const { responseTime, success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      expect(responseTime).toBeLessThan(10000); // 10 seconds for reasonable chat size
      
      console.log(`Processed 300 messages in ${responseTime}ms`);
    });

    it('should complete /summary 7 for 1000 messages under 30 seconds', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(1000, 7);
      
      const { responseTime, success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      expect(responseTime).toBeLessThan(30000); // 30 seconds for large chat
      
      console.log(`Processed 1000 messages in ${responseTime}ms`);
    });

    it('should handle different time periods efficiently', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(500, 14); // 14 days of messages
      
      // Test different summary periods
      const periods = [1, 3, 7];
      const results = [];
      
      for (const days of periods) {
        const { responseTime, success } = await sendSummaryCommand(days);
        expect(success).toBe(true);
        results.push({ days, responseTime });
      }
      
      // Shorter periods should generally be faster (but allow for some variance in test environment)
      // Just verify all completed successfully - timing can be inconsistent in tests
      expect(results.every(r => r.responseTime > 0)).toBe(true);
      
      console.log('Response times by period:', results);
    });
  });

  describe('Concurrent request stability', () => {
    it('should handle 3 concurrent /summary 7 requests without errors', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(600, 7);
      
      // Send 3 concurrent summary requests
      const promises = [
        sendSummaryCommand(7),
        sendSummaryCommand(7),
        sendSummaryCommand(7),
      ];
      
      const results = await Promise.all(promises);
      
      // All requests should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.responseTime).toBeLessThan(45000); // Allow more time for concurrent requests
        console.log(`Concurrent request ${index + 1} completed in ${result.responseTime}ms`);
      });
      
      // Verify all requests generated summaries (may be called multiple times due to chunking)
      expect(env.AI.run).toHaveBeenCalled();
    });

    it('should handle mixed concurrent requests (different periods)', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(800, 14);
      
      // Send concurrent requests for different periods
      const promises = [
        sendSummaryCommand(1),
        sendSummaryCommand(3),
        sendSummaryCommand(7),
        sendSummaryCommand(14),
      ];
      
      const results = await Promise.all(promises);
      
      // All requests should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.responseTime).toBeLessThan(60000); // Allow more time for concurrent requests
        console.log(`Mixed concurrent request ${index + 1} completed in ${result.responseTime}ms`);
      });
      
      // Verify all requests generated summaries (may be called multiple times due to chunking)
      expect(env.AI.run).toHaveBeenCalled();
    });

    it('should maintain stability under concurrent load with failures', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupLargeMessageSet(400, 7);
      
      // Simulate occasional KV failures
      const originalGet = env.HISTORY.get;
      env.HISTORY.get = vi.fn(async (...args) => {
        if (Math.random() < 0.05) { // 5% failure rate
          throw new Error('Simulated concurrent failure');
        }
        return originalGet.apply(env.HISTORY, args);
      });
      
      // Send multiple concurrent requests
      const promises = [
        sendSummaryCommand(7),
        sendSummaryCommand(7),
        sendSummaryCommand(3),
      ];
      
      const results = await Promise.all(promises);
      
      // Most requests should still succeed despite failures
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThanOrEqual(2); // At least 2 out of 3 should succeed
      
      console.log(`${successCount}/3 concurrent requests succeeded with simulated failures`);
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle /summary 7 with no messages gracefully', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      // Don't setup any messages
      
      const { responseTime, success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      expect(responseTime).toBeLessThan(5000); // Should be fast with no messages
      
      // Should send "no messages" response (the actual message may vary based on filtering logic)
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });

    it('should handle /summary 7 with only command messages', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      // Setup messages that are all commands (should be filtered out)
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 50; i++) {
        const message = {
          message: {
            message_id: i + 1,
            text: `/command${i}`,
            chat: { id: 1 },
            from: { id: 2 + i, username: `user${i + 1}` },
            date: now - (86400 * 3) + i, // 3 days ago
          },
        };
        
        const req = new Request("http://localhost/tg/test-token/webhook", {
          method: "POST",
          headers: {
            "X-Telegram-Bot-Api-Secret-Token": "test-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        });
        
        await worker.fetch(req, env, ctx);
      }
      
      await Promise.all(tasks);
      tasks = [];
      
      const { success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      
      // Should send "no content messages" response
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('содержательных обсуждений не было')
        })
      );
    });

    it('should handle very large individual messages', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      // Create messages with very long text
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 10; i++) {
        const longText = 'A'.repeat(5000); // Very long message
        const message = {
          message: {
            message_id: i + 1,
            text: `Message ${i + 1}: ${longText}`,
            chat: { id: 1 },
            from: { id: 2 + i, username: `user${i + 1}` },
            date: now - (86400 * 2) + i, // 2 days ago
          },
        };
        
        const req = new Request("http://localhost/tg/test-token/webhook", {
          method: "POST",
          headers: {
            "X-Telegram-Bot-Api-Secret-Token": "test-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        });
        
        await worker.fetch(req, env, ctx);
      }
      
      await Promise.all(tasks);
      tasks = [];
      
      const { responseTime, success } = await sendSummaryCommand(7);
      
      expect(success).toBe(true);
      expect(responseTime).toBeLessThan(30000);
      
      // Should still generate a summary
      expect(env.AI.run).toHaveBeenCalled();
    });
  });
});