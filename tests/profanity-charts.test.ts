import { describe, it, expect, beforeEach, vi } from 'vitest';
import { profanityChart } from '../src/stats';
import type { Env } from '../src/env';

// Mock the telegram module
vi.mock('../src/telegram', () => ({
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
}));

import { sendMessage, sendPhoto } from '../src/telegram';

// Mock environment
const createMockEnv = (): Env => ({
  COUNTERS: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [], list_complete: true }),
  } as any,
  HISTORY: {} as any,
  COUNTERS_DO: {} as any,
  DB: {} as any,
  AI: {} as any,
  TOKEN: 'test-token',
  SECRET: 'test-secret',
  SUMMARY_MODEL: 'test-model',
  SUMMARY_PROMPT: 'test-prompt',
  PROFANITY_SYSTEM_PROMPT: 'test-profanity-system-prompt',
  PROFANITY_USER_PROMPT: 'test-profanity-user-prompt',
});

describe('Profanity Charts', () => {
  let env: Env;

  beforeEach(() => {
    env = createMockEnv();
    vi.clearAllMocks();
  });

  describe('profanityChart', () => {
    it('should generate weekly profanity chart with ASCII fallback when no data', async () => {
      // Mock empty KV list response
      const mockList = vi.fn().mockResolvedValue({
        keys: [],
        list_complete: true,
        cursor: undefined,
      });
      env.COUNTERS.list = mockList;

      await profanityChart(env, 123, 'week');

      expect(mockList).toHaveBeenCalledWith({
        prefix: 'profanity:123:',
        cursor: undefined,
      });

      expect(sendMessage).toHaveBeenCalledWith(
        env,
        123,
        'Нет данных о матерной лексике'
      );

      // Should not try to send photo when no data
      expect(sendPhoto).not.toHaveBeenCalled();
    });

    it('should generate weekly profanity chart with data', async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      
      // Create test data for the past week
      const testData: Record<string, string> = {};
      for (let i = 0; i < 7; i++) {
        const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().slice(0, 10);
        testData[`profanity:123:456:${dateStr}`] = String(i + 1); // Increasing count
      }

      const keys = Object.keys(testData).map(name => ({ name }));
      const values = Object.values(testData);

      // Mock KV responses
      const mockList = vi.fn().mockResolvedValue({
        keys,
        list_complete: true,
        cursor: undefined,
      });
      const mockGet = vi.fn().mockImplementation((key: string) => 
        Promise.resolve(testData[key])
      );

      env.COUNTERS.list = mockList;
      env.COUNTERS.get = mockGet;

      await profanityChart(env, 123, 'week');

      expect(mockList).toHaveBeenCalledWith({
        prefix: 'profanity:123:',
        cursor: undefined,
      });

      // Should send ASCII chart
      expect(sendMessage).toHaveBeenCalledWith(
        env,
        123,
        expect.stringContaining('Статистика мата за неделю')
      );

      // Should also try to send QuickChart image
      expect(sendPhoto).toHaveBeenCalledWith(
        env,
        123,
        expect.stringContaining('https://quickchart.io/chart?c=')
      );
    });

    it('should generate monthly profanity chart with weekly aggregation', async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      
      // Create test data for the past month (4 weeks)
      const testData: Record<string, string> = {};
      for (let week = 0; week < 4; week++) {
        for (let day = 0; day < 7; day++) {
          const dayOffset = week * 7 + day;
          const date = new Date(today.getTime() - dayOffset * 24 * 60 * 60 * 1000);
          const dateStr = date.toISOString().slice(0, 10);
          testData[`profanity:123:456:${dateStr}`] = String(week + 1); // Same count per week
        }
      }

      const keys = Object.keys(testData).map(name => ({ name }));
      const values = Object.values(testData);

      // Mock KV responses
      const mockList = vi.fn().mockResolvedValue({
        keys,
        list_complete: true,
        cursor: undefined,
      });
      const mockGet = vi.fn().mockImplementation((key: string) => 
        Promise.resolve(testData[key])
      );

      env.COUNTERS.list = mockList;
      env.COUNTERS.get = mockGet;

      await profanityChart(env, 123, 'month');

      expect(mockList).toHaveBeenCalledWith({
        prefix: 'profanity:123:',
        cursor: undefined,
      });

      // Should send ASCII chart for monthly data
      expect(sendMessage).toHaveBeenCalledWith(
        env,
        123,
        expect.stringContaining('Статистика мата за месяц')
      );

      // Should also try to send QuickChart image
      expect(sendPhoto).toHaveBeenCalledWith(
        env,
        123,
        expect.stringContaining('https://quickchart.io/chart?c=')
      );
    });

    it('should handle QuickChart generation errors gracefully', async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const dateStr = today.toISOString().slice(0, 10);
      
      const testData = {
        [`profanity:123:456:${dateStr}`]: '5'
      };

      const keys = Object.keys(testData).map(name => ({ name }));

      // Mock KV responses
      const mockList = vi.fn().mockResolvedValue({
        keys,
        list_complete: true,
        cursor: undefined,
      });
      const mockGet = vi.fn().mockImplementation((key: string) => 
        Promise.resolve(testData[key])
      );

      env.COUNTERS.list = mockList;
      env.COUNTERS.get = mockGet;

      // Mock sendPhoto to throw an error
      const mockSendPhoto = vi.mocked(sendPhoto);
      mockSendPhoto.mockRejectedValue(new Error('Chart generation failed'));

      await profanityChart(env, 123, 'week');

      // Should still send ASCII chart even if photo fails
      expect(sendMessage).toHaveBeenCalledWith(
        env,
        123,
        expect.stringContaining('Статистика мата за неделю')
      );

      // Should have attempted to send photo
      expect(sendPhoto).toHaveBeenCalled();
    });

    it('should handle paginated KV list responses', async () => {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const dateStr = today.toISOString().slice(0, 10);
      
      const testData1 = {
        [`profanity:123:456:${dateStr}`]: '3'
      };
      const testData2 = {
        [`profanity:123:789:${dateStr}`]: '2'
      };

      // Mock paginated responses
      const mockList = vi.fn()
        .mockResolvedValueOnce({
          keys: Object.keys(testData1).map(name => ({ name })),
          list_complete: false,
          cursor: 'cursor1',
        })
        .mockResolvedValueOnce({
          keys: Object.keys(testData2).map(name => ({ name })),
          list_complete: true,
          cursor: undefined,
        });

      const mockGet = vi.fn().mockImplementation((key: string) => 
        Promise.resolve(testData1[key] || testData2[key])
      );

      env.COUNTERS.list = mockList;
      env.COUNTERS.get = mockGet;

      await profanityChart(env, 123, 'week');

      // Should make two list calls due to pagination
      expect(mockList).toHaveBeenCalledTimes(2);
      expect(mockList).toHaveBeenNthCalledWith(1, {
        prefix: 'profanity:123:',
        cursor: undefined,
      });
      expect(mockList).toHaveBeenNthCalledWith(2, {
        prefix: 'profanity:123:',
        cursor: 'cursor1',
      });

      // Should aggregate data from both pages
      expect(sendMessage).toHaveBeenCalledWith(
        env,
        123,
        expect.stringContaining('Всего: 5') // 3 + 2
      );
    });
  });
});