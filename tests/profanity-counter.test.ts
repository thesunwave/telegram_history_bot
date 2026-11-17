import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CountersDO, ProfanityIncrementPayload } from '../src/durable-objects/counters-do';
import { Env } from '../src/core/env';
import { resetProfanityCounters, resetCounters } from '../src/features/stats/stats';
import { createRealD1, seedProfanityWord, seedUserDay } from './helpers/real-d1';
import { withRealCountersDO } from './helpers/real-counters-do';

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
    } as Env;

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
          { word: 'ЗаЁбал', count: 2 },
          { baseForm: 'пиздец', count: 1 }
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

    it('should reject non-positive profanity counts', async () => {
      const invalidPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: -1,
        words: [{ baseForm: 'хуй', count: 1 }]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(invalidPayload)
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(400);
    });

    it('should reject profanity payloads when total count differs from word counts', async () => {
      const invalidPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 4,
        words: [
          { baseForm: 'хуй', count: 2 },
          { baseForm: 'пиздец', count: 1 }
        ]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(invalidPayload)
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(400);
    });

    it('should reject malformed profanity word entries', async () => {
      const invalidPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 1,
        words: [{ baseForm: '', count: 1 }]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(invalidPayload)
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(400);
    });

    it('should reject too-short profanity word fragments', async () => {
      const invalidPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 1,
        words: [{ word: 'н', count: 1 }]
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
    function d1Counters() {
      const d1 = createRealD1();
      const env = withRealCountersDO({ ...mockEnv, DB: d1.db });
      const state = { blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn()) };
      return { d1, counters: new CountersDO(state as any, env) };
    }

    function post(counters: CountersDO, payload: ProfanityIncrementPayload) {
      return counters.fetch(new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(payload)
      }) as any);
    }

    it('should increment user profanity counter', async () => {
      const { d1, counters } = d1Counters();

      await post(counters, {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 3,
        words: [
          { word: 'ЗаЁбал', count: 2 },
          { baseForm: 'пиздец', count: 1 }
        ]
      });

      expect(d1.rows("SELECT profanity_count FROM stats_daily_user WHERE chat_id = 123 AND user_id = 456 AND day = '2025-01-01'"))
        .toEqual([{ profanity_count: 3 }]);
    });

    it('should increment word profanity counters', async () => {
      const { d1, counters } = d1Counters();

      await post(counters, {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 3,
        words: [
          { word: 'ЗаЁбал', count: 2 },
          { baseForm: 'пиздец', count: 1 }
        ]
      });

      expect(d1.rows('SELECT word, count FROM stats_daily_profanity_word WHERE chat_id = 123 ORDER BY word'))
        .toEqual([{ word: 'заебал', count: 2 }, { word: 'пиздец', count: 1 }]);
      expect(d1.rows('SELECT word, user_id, count FROM stats_daily_profanity_word_user WHERE chat_id = 123 ORDER BY word'))
        .toEqual([
          { word: 'заебал', user_id: 456, count: 2 },
          { word: 'пиздец', user_id: 456, count: 1 },
        ]);
    });

    it('should accumulate existing counters', async () => {
      const { d1, counters } = d1Counters();
      seedUserDay(d1, { chatId: 123, userId: 456, day: '2025-01-01', profanity: 5 });
      seedProfanityWord(d1, 123, '2025-01-01', 'хуй', null, 3);

      await post(counters, {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 2,
        words: [
          { baseForm: 'хуй', count: 1 },
          { baseForm: 'заебал', count: 1 }
        ]
      });

      expect(d1.rows("SELECT profanity_count FROM stats_daily_user WHERE chat_id = 123 AND user_id = 456 AND day = '2025-01-01'"))
        .toEqual([{ profanity_count: 7 }]);
      expect(d1.rows('SELECT word, count FROM stats_daily_profanity_word WHERE chat_id = 123 ORDER BY word'))
        .toEqual([{ word: 'заебал', count: 1 }, { word: 'хуй', count: 4 }]);
    });
  });

  describe('Endpoint routing', () => {
    it('should handle /inc endpoint for regular counters', async () => {
      // Create fresh instance with proper mocking
      const mockStorage = new Map<string, string>();
      const mockEnvLocal = {
        ...mockEnv,
        COUNTERS: {
          get: vi.fn((key: string) => Promise.resolve(mockStorage.get(key) || null)),
          put: vi.fn((key: string, value: string) => {
            mockStorage.set(key, value);
            return Promise.resolve();
          }),
          delete: vi.fn((key: string) => {
            mockStorage.delete(key);
            return Promise.resolve();
          }),
          list: vi.fn(() => Promise.resolve({ keys: [], list_complete: true, cacheStatus: null }))
        } as any
      };
      
      const mockStateLocal = {
        blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn())
      } as any;
      
      const countersDOLocal = new CountersDO(mockStateLocal, mockEnvLocal);
      
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

      const response = await countersDOLocal.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should handle /profanity endpoint for profanity counters', async () => {
      // Create fresh instance with proper mocking
      const mockStorage = new Map<string, string>();
      const mockEnvLocal = {
        ...mockEnv,
        COUNTERS: {
          get: vi.fn((key: string) => Promise.resolve(mockStorage.get(key) || null)),
          put: vi.fn((key: string, value: string) => {
            mockStorage.set(key, value);
            return Promise.resolve();
          }),
          delete: vi.fn((key: string) => {
            mockStorage.delete(key);
            return Promise.resolve();
          }),
          list: vi.fn(() => Promise.resolve({ keys: [], list_complete: true, cacheStatus: null }))
        } as any
      };
      
      const mockStateLocal = {
        blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn())
      } as any;
      
      const countersDOLocal = new CountersDO(mockStateLocal, mockEnvLocal);
      
      const payload: ProfanityIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        count: 1,
        words: [{ baseForm: 'хуй', count: 1 }]
      };

      const request = new Request('https://test.com/profanity', {
        method: 'POST',
        body: JSON.stringify(payload)
      }) as any;

      const response = await countersDOLocal.fetch(request);
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
      const d1 = createRealD1();
      const env = withRealCountersDO({ ...mockEnv, DB: d1.db });
      seedUserDay(d1, { chatId: 123, userId: 456, day: '2025-01-01', messages: 4, profanity: 5 });
      seedProfanityWord(d1, 123, '2025-01-01', 'хуй', 456, 5);
      seedUserDay(d1, { chatId: 456, userId: 123, day: '2025-01-01', profanity: 2 });
      seedProfanityWord(d1, 456, '2025-01-01', 'хуй', 123, 2);

      await resetProfanityCounters(env, 123);

      expect(d1.rows('SELECT message_count, profanity_count FROM stats_daily_user WHERE chat_id = 123'))
        .toEqual([{ message_count: 4, profanity_count: 0 }]);
      expect(d1.rows("SELECT count FROM activity WHERE chat_id = 123 AND day = '2025-01-01'"))
        .toEqual([{ count: 4 }]);
      expect(d1.rows('SELECT * FROM stats_daily_profanity_word WHERE chat_id = 123')).toEqual([]);
      expect(d1.rows('SELECT * FROM stats_daily_profanity_word_user WHERE chat_id = 123')).toEqual([]);
      expect(d1.rows('SELECT profanity_count FROM stats_daily_user WHERE chat_id = 456')).toEqual([{ profanity_count: 2 }]);
      expect(d1.rows('SELECT count FROM stats_daily_profanity_word WHERE chat_id = 456')).toEqual([{ count: 2 }]);
    });

    it('should handle empty profanity data gracefully', async () => {
      const d1 = createRealD1();
      await expect(resetProfanityCounters(withRealCountersDO({ ...mockEnv, DB: d1.db }), 123)).resolves.toBeUndefined();
    });

    it('should reset profanity counters when general reset is called', async () => {
      const d1 = createRealD1();
      const env = withRealCountersDO({ ...mockEnv, DB: d1.db });
      seedUserDay(d1, { chatId: 123, userId: 456, day: '2025-01-01', messages: 4, profanity: 5 });
      seedProfanityWord(d1, 123, '2025-01-01', 'хуй', 456, 5);
      seedUserDay(d1, { chatId: 456, userId: 123, day: '2025-01-01', messages: 1, profanity: 2 });

      await resetCounters(env, 123);

      expect(d1.rows('SELECT * FROM stats_daily_user WHERE chat_id = 123')).toEqual([]);
      expect(d1.rows('SELECT * FROM activity WHERE chat_id = 123')).toEqual([]);
      expect(d1.rows('SELECT * FROM stats_daily_profanity_word_user WHERE chat_id = 123')).toEqual([]);
      expect(d1.rows('SELECT profanity_count FROM stats_daily_user WHERE chat_id = 456')).toEqual([{ profanity_count: 2 }]);
    });
  });
});
