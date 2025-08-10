import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OptimizedSummaryController } from '../src/summary-optimization/summary-controller';
import { Env } from '../src/env';

describe('Simple Optimized System Test', () => {
  let mockEnv: Env;

  beforeEach(() => {
    const now = Math.floor(Date.now() / 1000);
    const recentTime1 = now - 3600; // 1 час назад
    const recentTime2 = now - 7200; // 2 часа назад
    const recentTime3 = now - 10800; // 3 часа назад
    
    mockEnv = {
      HISTORY: {
        list: vi.fn().mockResolvedValue({
          keys: [
            { name: `msg:123:${recentTime1}` },
            { name: `msg:123:${recentTime2}` },
            { name: `msg:123:${recentTime3}` }
          ]
        }),
        get: vi.fn().mockImplementation((key) => {
          console.log('🔍 HISTORY.get called with key:', key);
          // Each key should return a single message (already parsed when using { type: 'json' })
          if (key.includes(recentTime1.toString())) {
            const message = { text: 'Привет, как дела?', date: recentTime1, ts: recentTime1 };
            console.log('📦 Returning message:', message);
            return Promise.resolve(message);
          } else if (key.includes(recentTime2.toString())) {
            const message = { text: 'Хорошо, а у тебя?', date: recentTime2, ts: recentTime2 };
            console.log('📦 Returning message:', message);
            return Promise.resolve(message);
          } else if (key.includes(recentTime3.toString())) {
            const message = { text: 'Обсуждаем важные вопросы проекта', date: recentTime3, ts: recentTime3 };
            console.log('📦 Returning message:', message);
            return Promise.resolve(message);
          }
          return Promise.resolve(null);
        })
      },
      AI: {
        run: vi.fn().mockResolvedValue('Тестовая суммаризация')
      },
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'Test prompt',
      TOKEN: 'test-token'
    } as any;
  });

  it('should create controller without errors', () => {
    expect(() => {
      const controller = new OptimizedSummaryController(mockEnv);
      expect(controller).toBeDefined();
    }).not.toThrow();
  });

  it('should have summarizeChat method', async () => {
    const controller = new OptimizedSummaryController(mockEnv);
    expect(typeof controller.summarizeChat).toBe('function');
  });

  it('should call summarizeChat without throwing', async () => {
    const controller = new OptimizedSummaryController(mockEnv);
    
    try {
      const result = await controller.summarizeChat(123, 7);
      console.log('✅ Result:', result);
      console.log('📊 Type:', typeof result);
      console.log('📞 HISTORY.list calls:', (mockEnv.HISTORY.list as any).mock.calls.length);
      console.log('📞 HISTORY.get calls:', (mockEnv.HISTORY.get as any).mock.calls.length);
      console.log('📞 AI.run calls:', mockEnv.AI.run.mock.calls.length);
      expect(result).toBeDefined();
    } catch (error) {
      console.error('❌ Error:', error);
      throw error;
    }
  });
});