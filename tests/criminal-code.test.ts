import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CountersDO, CriminalIncrementPayload } from '../src/durable-objects/counters-do';
import { Env } from '../src/core/env';
import { resetCriminalCounters } from '../src/features/stats/stats';
import { createRealD1, seedUserDay } from './helpers/real-d1';
import { withRealCountersDO } from './helpers/real-counters-do';

describe('Criminal Code Analysis System', () => {
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
      CRIMINAL_CODE_ANALYZER_DO: {} as any,
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

  describe('CriminalCodeIncrementPayload validation', () => {
    it('should validate correct criminal code payload', async () => {
      const mockStorage = {
        get: vi.fn().mockResolvedValue(0),
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn()
      };
      const mockState = {
        storage: mockStorage,
        blockConcurrencyWhile: vi.fn().mockImplementation((fn) => fn())
      };
      const countersInstance = new CountersDO(mockState as any, mockEnv);

      const payload: CriminalIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        violations: [
          {
            article: '282',
            severity: 5,
            count: 1
          }
        ],
        totalSeverity: 5
      };

      const request = new Request('https://test.com/criminal', {
        method: 'POST',
        body: JSON.stringify(payload)
      }) as any;

      const response = await countersInstance.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should reject invalid criminal code payload', async () => {
      const invalidPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01'
        // missing violations and totalSeverity
      };

      const request = new Request('https://test.com/criminal', {
        method: 'POST',
        body: JSON.stringify(invalidPayload)
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(400);
    });
  });

  describe('Criminal code counter increments', () => {
    function d1Counters() {
      const d1 = createRealD1();
      const env = { ...mockEnv, DB: d1.db };
      const state = { blockConcurrencyWhile: vi.fn((fn: () => Promise<void>) => fn()) };
      return { d1, counters: new CountersDO(state as any, env) };
    }

    function post(counters: CountersDO, payload: CriminalIncrementPayload) {
      return counters.fetch(new Request('http://localhost/criminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }) as any);
    }

    const userRow = (d1: ReturnType<typeof createRealD1>) =>
      d1.rows("SELECT criminal_count, criminal_severity FROM stats_daily_user WHERE chat_id = 123 AND user_id = 456 AND day = '2025-01-01'");

    it('should increment user criminal violation counter', async () => {
      const { d1, counters } = d1Counters();

      const response = await post(counters, {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        violations: [{ article: '282', severity: 5, count: 1 }],
        totalSeverity: 5
      });

      expect(response.status).toBe(200);
      expect(userRow(d1)).toEqual([{ criminal_count: 1, criminal_severity: 5 }]);
    });

    it('should count every violation of a multi-article message', async () => {
      const { d1, counters } = d1Counters();

      const response = await post(counters, {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        violations: [
          { article: '282', severity: 5, count: 1 },
          { article: '319', severity: 3, count: 1 }
        ],
        totalSeverity: 8
      });

      expect(response.status).toBe(200);
      expect(userRow(d1)).toEqual([{ criminal_count: 2, criminal_severity: 8 }]);
    });

    it('should accumulate existing criminal counters', async () => {
      const { d1, counters } = d1Counters();
      seedUserDay(d1, { chatId: 123, userId: 456, day: '2025-01-01', criminal: 3, criminalSeverity: 3 });

      const response = await post(counters, {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        violations: [{ article: '282', severity: 4, count: 1 }],
        totalSeverity: 4
      });

      expect(response.status).toBe(200);
      expect(userRow(d1)).toEqual([{ criminal_count: 4, criminal_severity: 7 }]);
    });
  });

  describe('Endpoint routing', () => {
    it('should route /criminal endpoint correctly', async () => {
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
      };

      const countersInstance = new CountersDO(mockStateLocal, mockEnvLocal);

      const payload: CriminalIncrementPayload = {
        chatId: 123,
        userId: 456,
        username: 'testuser',
        day: '2025-01-01',
        violations: [{
          article: '282',
          severity: 5,
          count: 1
        }],
        totalSeverity: 5
      };

      const request = new Request('http://localhost/criminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }) as any;

      const response = await countersInstance.fetch(request);
      expect(response.status).toBe(200);
    });

    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('https://test.com/unknown', {
        method: 'POST'
      }) as any;

      const response = await countersDO.fetch(request);
      expect(response.status).toBe(404);
    });
  });

  describe('Reset functionality', () => {
    it('should reset criminal counters', async () => {
      const d1 = createRealD1();
      seedUserDay(d1, { chatId: 123, userId: 456, day: '2025-01-01', messages: 2, criminal: 3, criminalSeverity: 9 });

      await resetCriminalCounters(withRealCountersDO({ ...mockEnv, DB: d1.db }), 123);

      expect(d1.rows('SELECT message_count, criminal_count, criminal_severity FROM stats_daily_user WHERE chat_id = 123'))
        .toEqual([{ message_count: 2, criminal_count: 0, criminal_severity: 0 }]);
    });
  });
});