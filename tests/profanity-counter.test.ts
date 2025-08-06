import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CountersDO, ProfanityIncrementPayload } from '../src/counters-do';
import { Env } from '../src/env';
import { resetProfanityCounters, resetCounters } from '../src/stats';

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
        list: vi.fn(() => Promise.resolve({ keys: [], list_complete: true, cacheStatus: null }))
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
      }) as any;

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
      }) as any;

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
      }) as any;

      await countersDO.fetch(request);

      // Check that user profanity counter was incremented
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'user:456',
        'testuser'
      ) as any;
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity:123:456:2025-01-01',
        '3'
      ) as any;
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
      }) as any;

      await countersDO.fetch(request);

      // Check that word counters were incremented
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word1:2025-01-01',
        '2'
      ) as any;
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word2:2025-01-01',
        '1'
      ) as any;
    });

    it('should accumulate existing counters', async () => {
      // Set up existing counters
      const mockKV = new Map([
        ['profanity:123:456:2025-01-01', '5'],
        ['profanity_words:123:word1:2025-01-01', '3']
      ]);
      
      mockEnv.COUNTERS.get = vi.fn().mockImplementation((key: string) => 
        Promise.resolve(mockKV.get(key) || null)
      ) as any;

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
      }) as any;

      await countersDO.fetch(request);

      // Check that counters were accumulated
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity:123:456:2025-01-01',
        '7' // 5 + 2
      ) as any;
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word1:2025-01-01',
        '4' // 3 + 1
      ) as any;
      expect(mockEnv.COUNTERS.put).toHaveBeenCalledWith(
        'profanity_words:123:word3:2025-01-01',
        '1' // new word
      ) as any;
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
      }) as any;

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
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('https://test.com/unknown', {
        method: 'POST',
        body: JSON.stringify({})
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(404);
    });

    it('should return 405 for non-POST methods', async () => {
      const request = new Request('https://test.com/profanity', {
        method: 'GET'
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(405);
    });
  });

  describe('Profanity reset functionality', () => {
    it('should reset only profanity counters for a chat', async () => {
      // Set up test data with both regular and profanity counters
      const mockKV = new Map([
        // Regular counters (should not be deleted)
        ['stats:123:456:2025-01-01', '10'],
        ['stats:123:789:2025-01-01', '5'],
        ['activity:123:2025-01-01', '15'],
        ['user:456', 'user1'],
        ['user:789', 'user2'],
        
        // Profanity counters (should be deleted)
        ['profanity:123:456:2025-01-01', '3'],
        ['profanity:123:789:2025-01-01', '2'],
        ['profanity_words:123:word1:2025-01-01', '2'],
        ['profanity_words:123:word2:2025-01-01', '1'],
        
        // Other chat profanity counters (should not be deleted)
        ['profanity:456:123:2025-01-01', '1'],
        ['profanity_words:456:word1:2025-01-01', '1']
      ]);

      // Mock the list method to return keys based on prefix
      mockEnv.COUNTERS.list = vi.fn().mockImplementation((options: any) => {
        const prefix = options.prefix;
        const matchingKeys = Array.from(mockKV.keys())
          .filter(key => key.startsWith(prefix))
          .map(name => ({ name }));
        
        return Promise.resolve({
          keys: matchingKeys,
          list_complete: true, cacheStatus: null
        }) as any;
      }) as any;

      mockEnv.COUNTERS.get = vi.fn().mockImplementation((key: string) => 
        Promise.resolve(mockKV.get(key) || null)
      ) as any;

      mockEnv.COUNTERS.delete = vi.fn((key: string) => {
        mockKV.delete(key);
        return Promise.resolve();
      }) as any;

      // Call resetProfanityCounters
      await resetProfanityCounters(mockEnv, 123);

      // Verify that only profanity counters for chat 123 were deleted
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity:123:456:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity:123:789:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity_words:123:word1:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity_words:123:word2:2025-01-01');

      // Verify that regular counters and other chat counters were NOT deleted
      expect(mockEnv.COUNTERS.delete).not.toHaveBeenCalledWith('stats:123:456:2025-01-01');
      expect(mockEnv.COUNTERS.delete).not.toHaveBeenCalledWith('activity:123:2025-01-01');
      expect(mockEnv.COUNTERS.delete).not.toHaveBeenCalledWith('profanity:456:123:2025-01-01');
      expect(mockEnv.COUNTERS.delete).not.toHaveBeenCalledWith('profanity_words:456:word1:2025-01-01');

      // Verify that list was called with correct prefixes
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'profanity:123:', cursor: undefined });
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'profanity_words:123:', cursor: undefined });
    });

    it('should handle empty profanity data gracefully', async () => {
      // Mock empty list responses
      mockEnv.COUNTERS.list = vi.fn().mockImplementation(() => Promise.resolve({
        keys: [],
        list_complete: true,
        cacheStatus: null
      }));

      // Should not throw an error
      await expect(resetProfanityCounters(mockEnv, 123)).resolves.not.toThrow();
      
      // Should still call list with correct prefixes
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'profanity:123:', cursor: undefined });
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'profanity_words:123:', cursor: undefined });
    });

    it('should reset profanity counters when general reset is called', async () => {
      // Set up test data with all types of counters
      const mockKV = new Map([
        // Regular counters (should be deleted)
        ['stats:123:456:2025-01-01', '10'],
        ['stats:123:789:2025-01-01', '5'],
        ['activity:123:2025-01-01', '15'],
        
        // Profanity counters (should also be deleted)
        ['profanity:123:456:2025-01-01', '3'],
        ['profanity:123:789:2025-01-01', '2'],
        ['profanity_words:123:word1:2025-01-01', '2'],
        ['profanity_words:123:word2:2025-01-01', '1'],
        
        // Other chat counters (should not be deleted)
        ['stats:456:123:2025-01-01', '1'],
        ['profanity:456:123:2025-01-01', '1']
      ]);

      // Mock the list method to return keys based on prefix
      mockEnv.COUNTERS.list = vi.fn().mockImplementation((options: any) => {
        const prefix = options.prefix;
        const matchingKeys = Array.from(mockKV.keys())
          .filter(key => key.startsWith(prefix))
          .map(name => ({ name }));
        
        return Promise.resolve({
          keys: matchingKeys,
          list_complete: true, cacheStatus: null
        }) as any;
      }) as any;

      mockEnv.COUNTERS.get = vi.fn().mockImplementation((key: string) => 
        Promise.resolve(mockKV.get(key) || null)
      ) as any;

      mockEnv.COUNTERS.delete = vi.fn((key: string) => {
        mockKV.delete(key);
        return Promise.resolve();
      }) as any;

      // Call general resetCounters
      await resetCounters(mockEnv, 123);

      // Verify that all counters for chat 123 were deleted (including profanity)
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('stats:123:456:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('stats:123:789:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('activity:123:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity:123:456:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity:123:789:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity_words:123:word1:2025-01-01');
      expect(mockEnv.COUNTERS.delete).toHaveBeenCalledWith('profanity_words:123:word2:2025-01-01');

      // Verify that other chat counters were NOT deleted
      expect(mockEnv.COUNTERS.delete).not.toHaveBeenCalledWith('stats:456:123:2025-01-01');
      expect(mockEnv.COUNTERS.delete).not.toHaveBeenCalledWith('profanity:456:123:2025-01-01');

      // Verify that list was called with all the correct prefixes
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'stats:123:', cursor: undefined });
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'activity:123:', cursor: undefined });
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'profanity:123:', cursor: undefined });
      expect(mockEnv.COUNTERS.list).toHaveBeenCalledWith({ prefix: 'profanity_words:123:', cursor: undefined });
    });
  });
});