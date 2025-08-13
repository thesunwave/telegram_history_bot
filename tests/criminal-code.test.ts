import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CountersDO, CriminalIncrementPayload } from '../src/counters-do';
import { Env } from '../src/env';
import { resetCriminalCounters } from '../src/stats';

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
      MESSAGE_FETCHER_DO: {} as any,
      MESSAGE_AGGREGATOR_DO: {} as any,
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
    it('should increment user criminal violation counter', async () => {
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
        violations: [
          {
            article: '282',
            severity: 5,
            count: 1
          }
        ],
        totalSeverity: 5
      };

      const request = new Request('http://localhost/criminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }) as any;

      const response = await countersInstance.fetch(request);
      expect(response.status).toBe(200);

      // Check that criminal counters were stored in COUNTERS
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledTimes(3);
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenNthCalledWith(1, 'criminal:123:456:2025-01-01', '1');
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenNthCalledWith(2, 'criminal_severity:123:456:2025-01-01', '5');
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenNthCalledWith(3, 'criminal_article:123:282:2025-01-01', '1');
    });

    it('should increment article-specific counters', async () => {
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
        violations: [
          {
            article: '282',
            severity: 5,
            count: 1
          },
          {
            article: '319',
            severity: 3,
            count: 1
          }
        ],
        totalSeverity: 8
      };

      const request = new Request('http://localhost/criminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }) as any;

      const response = await countersInstance.fetch(request);
      expect(response.status).toBe(200);

      // Check that article-specific counters were stored
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledTimes(4); // user count + severity + 2 articles
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledWith('criminal:123:456:2025-01-01', '2'); // violations.length = 2
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledWith('criminal_severity:123:456:2025-01-01', '8');
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledWith('criminal_article:123:282:2025-01-01', '1');
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledWith('criminal_article:123:319:2025-01-01', '1');
     });

    it('should accumulate existing criminal counters', async () => {
      // Mock existing counter value in COUNTERS
      const mockStorage = new Map<string, string>();
      mockStorage.set('criminal:123:456:2025-01-01', '3');
      mockStorage.set('criminal_severity:123:456:2025-01-01', '3');
      mockStorage.set('criminal_article:123:282:2025-01-01', '3');
      
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
      // Should accumulate: existing 3 + new 5 = 8 (totalSeverity), user count: 3 + 1 = 4 (violations.length)
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledTimes(3);
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledWith('criminal:123:456:2025-01-01', '4'); // 3 + violations.length(1) = 4
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledWith('criminal_severity:123:456:2025-01-01', '8'); // 3 + 5 = 8
      expect(mockEnvLocal.COUNTERS.put).toHaveBeenCalledWith('criminal_article:123:282:2025-01-01', '4'); // 3 + 1 = 4
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
      const mockDB = {
        prepare: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({ success: true })
        })
      };

      await resetCriminalCounters(mockEnv, mockDB as any);

      expect(mockEnv.COUNTERS.list).toHaveBeenCalled();
    });
  });
});