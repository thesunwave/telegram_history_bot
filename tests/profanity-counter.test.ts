import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CountersDO, ProfanityIncrementPayload } from '../src/counters-do';
import { Env } from '../src/env';

describe('Profanity Counter System', () => {
  let countersDO: CountersDO;
  let mockState: any;
  let mockEnv: Env;

  beforeEach(() => {
    // Mock KV storage
    const mockKV = new Map<string, string>();
    
    mockEnv = {
      COUNTERS: {
        get: vi.fn((key: string) => Promise.resolve(mockKV.get(key) || null)),
        put: vi.fn((key: string, value: string) => {
          mockKV.set(key, value);
          return Promise.resolve();
        }),
        delete: vi.fn((key: string) => {
          mockKV.delete(key);
          return Promise.resolve();
        }),
        list: vi.fn(() => Promise.resolve({ keys: [], list_complete: true }))
      } as any,
      HISTORY: {} as any,
      COUNTERS_DO: {} as any,
      DB: null as any,
      AI: {} as any,
      TOKEN: 'test-token',
      SECRET: 'test-secret',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'test-prompt'
    };

    mockState = {
      blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn())
    };

    countersDO = new CountersDO(mockState, mockEnv);
  });

  describe('ProfanityIncrementPayload validation', () => {
    it('should validate correct profanity payload', async () => {
      const payload: ProfanityIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 3,
        words: [
          { baseForm: 'word1', count: 2 },
          { baseForm: 'word2', count: 1 }
        ]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should reject invalid profanity payload', async () => {
      const invalidPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01'
        // missing count and words
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(invalidPayload)
      });

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(400);
    });
  });

  describe('Profanity counter increments', () => {
    it('should increment user profanity counter', async () => {
      const payload: ProfanityIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 3,
        words: [
          { baseForm: 'word1', count: 2 },
          { baseForm: 'word2', count: 1 }
        ]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      await countersDO.fetch(request);

      // Check that user profanity counter was incremented
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'user:456',
        'testuser'
      );
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity:123:456:2025-01-01',
        '3'
      );
    });

    it('should increment word profanity counters', async () => {
      const payload: ProfanityIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 3,
        words: [
          { baseForm: 'word1', count: 2 },
          { baseForm: 'word2', count: 1 }
        ]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      await countersDO.fetch(request);

      // Check that word counters were incremented
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word1:2025-01-01',
        '2'
      );
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word2:2025-01-01',
        '1'
      );
    });

    it('should accumulate existing counters', async () => {
      // Set up existing counters
      const mockKV = new Map([
        ['profanity:123:456:2025-01-01', '5'],
        ['profanity_words:123:word1:2025-01-01', '3']
      ]);
      
      mockEnv.COUNTERS.get = vi.fn((key: string) => 
        Promise.resolve(mockKV.get(key) || null)
      );

      const payload: ProfanityIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 2,
        words: [
          { baseForm: 'word1', count: 1 },
          { baseForm: 'word3', count: 1 }
        ]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      await countersDO.fetch(request);

      // Check that counters were accumulated
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity:123:456:2025-01-01',
        '7' // 5 + 2
      );
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word1:2025-01-01',
        '4' // 3 + 1
      );
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word3:2025-01-01',
        '1' // new word
      );
    });
  });

  describe('Endpoint routing', () => {
    it('should handle /inc endpoint for regular counters', async () => {
      const payload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01'
      };

      const request = new Request('https://test.com/inc', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should handle /profanity endpoint for profanity counters', async () => {
      const payload: ProfanityIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 1,
        words: [{ baseForm: 'word1', count: 1 }]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('https://test.com/unknown', {
        method: 'POST',
        body: JSON.stringify({})
      });

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(404);
    });

    it('should return 405 for non-POST methods', async () => {
      const request = new Request('https://test.com/profanity', {
        method: 'GET'
      });

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(405);
    });
  });
});