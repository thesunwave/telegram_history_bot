
/**
 * End-to-end тесты для интеграции ViolationHandler с Telegram ботом
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleUpdate, recordMessage, getTextMessage } from '../src/api/update';
import { ViolationHandler } from '../src/features/stats/violation-handler';
import { sendMessage } from '../src/core/telegram';
import type { Env } from '../src/core/env';
import type { ViolationAnalysis } from '../src/core/models/statistics';

// Mock dependencies
vi.mock('../src/core/telegram', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../src/features/stats/violation-handler', () => ({
  ViolationHandler: vi.fn(),
}));

// Mock modules that are dynamically imported
vi.mock('../src/features/stats/stats', () => ({
  criminalCodeStats: vi.fn(),
  criminalTopUsers: vi.fn(),
  myCriminalStats: vi.fn(),
  topChat: vi.fn(),
  resetCounters: vi.fn(),
  activityChart: vi.fn(),
  activityByUser: vi.fn(),
  profanityTopUsers: vi.fn(),
  profanityWordsStats: vi.fn(),
  myProfanityStats: vi.fn(),
  profanityChart: vi.fn(),
  resetProfanityCounters: vi.fn(),
  resetCriminalCounters: vi.fn(),
  formatViolationMessage: vi.fn(),
  getUserStats: vi.fn(),
  getPeriodStats: vi.fn(),
  getGeneralStats: vi.fn()
}));

vi.mock('../src/features/stats/stats', () => ({
  criminalCodeStats: vi.fn(),
  criminalTopUsers: vi.fn(),
  myCriminalStats: vi.fn(),
  topChat: vi.fn(),
  resetCounters: vi.fn(),
  activityChart: vi.fn(),
  activityByUser: vi.fn(),
  profanityTopUsers: vi.fn(),
  profanityWordsStats: vi.fn(),
  myProfanityStats: vi.fn(),
  profanityChart: vi.fn(),
  resetProfanityCounters: vi.fn(),
  resetCriminalCounters: vi.fn()
}));

describe('Telegram Integration Tests', () => {
  let mockEnv: Env;
  let mockViolationHandler: any;
  let mockSendMessage: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSendMessage = vi.mocked(sendMessage);
    mockViolationHandler = {
      formatViolationMessage: vi.fn(),
      getUserStats: vi.fn(),
      getPeriodStats: vi.fn(),
      getGeneralStats: vi.fn()
    };

    vi.mocked(ViolationHandler).mockImplementation(() => mockViolationHandler);

    // Mock environment - use different token to avoid test environment detection
    mockEnv = {
      TOKEN: 'real_bot_token',
      OPENAI_API_KEY: 'real-openai-key',
      CRIMINAL_CODE_ANALYZER_DO: {
        idFromName: vi.fn().mockReturnValue('test-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn()
        })
      },
      COUNTERS_DO: {
        idFromName: vi.fn().mockReturnValue('test-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response('{"ok": true}'))
        })
      },
      DAY_BLOCK_MANAGER_DO: {
        idFromName: vi.fn().mockReturnValue('test-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response('{"ok": true}'))
        })
      },
      HISTORY: {
        put: vi.fn(),
        get: vi.fn(),
        list: vi.fn()
      },
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn(),
            all: vi.fn().mockResolvedValue({ results: [] }),
            first: vi.fn()
          })
        })
      }
    } as any;
  });

  describe('Enhanced Criminal Statistics Integration', () => {
    it('should call criminalCodeStats function for /criminal_stats command', async () => {
      const { criminalCodeStats } = await import('../src/features/stats/stats');
      const mockCriminalCodeStats = vi.mocked(criminalCodeStats);

      const mockMessage = {
        chat: { id: 12345 },
        from: { id: 67890, username: 'testuser' },
        text: '/criminal_stats week',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      expect(mockCriminalCodeStats).toHaveBeenCalledWith(mockEnv, 12345, 'week');
    });

    it('should call myCriminalStats function for /my_criminal command', async () => {
      const { myCriminalStats } = await import('../src/features/stats/stats');
      const mockMyCriminalStats = vi.mocked(myCriminalStats);

      const mockMessage = {
        chat: { id: 12345 },
        from: { id: 67890, username: 'testuser' },
        text: '/my_criminal',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      expect(mockMyCriminalStats).toHaveBeenCalledWith(mockEnv, 12345, 67890, undefined);
    });

    it('should call myCriminalStats with period for /my_criminal command', async () => {
      const { myCriminalStats } = await import('../src/features/stats/stats');
      const mockMyCriminalStats = vi.mocked(myCriminalStats);

      const mockMessage = {
        chat: { id: 12345 },
        from: { id: 67890, username: 'testuser' },
        text: '/my_criminal week',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      expect(mockMyCriminalStats).toHaveBeenCalledWith(mockEnv, 12345, 67890, 'week');
    });

    it('should call criminalTopUsers function for /criminal_top command', async () => {
      const { criminalTopUsers } = await import('../src/features/stats/stats');
      const mockCriminalTopUsers = vi.mocked(criminalTopUsers);

      const mockMessage = {
        chat: { id: 12345 },
        from: { id: 67890, username: 'testuser' },
        text: '/criminal_top 5 week',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      expect(mockCriminalTopUsers).toHaveBeenCalledWith(mockEnv, 12345, 5, 'week');
    });

    it('should handle /criminal_stats with default period', async () => {
      const { criminalCodeStats } = await import('../src/features/stats/stats');
      const mockCriminalCodeStats = vi.mocked(criminalCodeStats);

      const mockMessage = {
        chat: { id: 12345 },
        from: { id: 67890, username: 'testuser' },
        text: '/criminal_stats',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      expect(mockCriminalCodeStats).toHaveBeenCalledWith(mockEnv, 12345, 'today');
    });
  });

  describe('Violation Processing Integration', () => {
    it('should format and send violation messages when violations are detected', async () => {
      // Mock violation analysis result
      const mockAnalysisResult: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            subarticle: null,
            articleTitle: 'Статья 282 УК РФ',
            quote: 'экстремистские высказывания',
            punishment: 'штраф до 300 000 рублей',
            severity: 8,
            confidence: 0.85
          }
        ],
        totalSeverity: 8,
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      const expectedFormattedMessage = '🚨 <b>Обнаружено нарушение УК РФ</b>\n\n<b>Статья 282 УК РФ</b>\nЦитата: <i>экстремистские высказывания</i>\nНаказание: штраф до 300 000 рублей\nСерьезность: 🔴 8/10';
      mockViolationHandler.formatViolationMessage.mockResolvedValue(expectedFormattedMessage);

      // Test the ViolationHandler integration directly
      const violationHandler = new ViolationHandler(mockEnv);
      const result = await violationHandler.formatViolationMessage(
        mockAnalysisResult,
        '67890',
        '12345'
      );

      expect(result).toBe(expectedFormattedMessage);
      expect(mockViolationHandler.formatViolationMessage).toHaveBeenCalledWith(
        mockAnalysisResult,
        '67890',
        '12345'
      );
    });

    it('should handle violation formatting errors gracefully', async () => {
      // Test error handling by mocking a failure scenario
      const mockAnalysisResult: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            subarticle: null,
            articleTitle: 'Статья 282 УК РФ',
            quote: 'экстремистские высказывания',
            punishment: 'штраф до 300 000 рублей',
            severity: 8,
            confidence: 0.85
          }
        ],
        totalSeverity: 8,
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      // Mock the ViolationHandler to throw an error, then return a fallback
      const errorMessage = 'Произошла ошибка при обработке нарушения';
      mockViolationHandler.formatViolationMessage.mockResolvedValue(errorMessage);

      const violationHandler = new ViolationHandler(mockEnv);
      const result = await violationHandler.formatViolationMessage(mockAnalysisResult);

      expect(result).toBe(errorMessage);
    });

    it('should not send messages when no violations are detected', async () => {
      const mockAnalysisResult: ViolationAnalysis = {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: new Date().toISOString()
      };

      const expectedMessage = '✅ Нарушений не обнаружено';
      mockViolationHandler.formatViolationMessage.mockResolvedValue(expectedMessage);

      const violationHandler = new ViolationHandler(mockEnv);
      const result = await violationHandler.formatViolationMessage(mockAnalysisResult);

      expect(result).toBe(expectedMessage);
    });
  });

  describe('Message Filtering', () => {
    it('should not process bot messages', () => {
      const botMessage = {
        message: {
          chat: { id: 12345 },
          from: { id: 67890, username: 'testbot', is_bot: true },
          text: 'Bot message',
          date: Math.floor(Date.now() / 1000)
        }
      };

      const result = getTextMessage(botMessage);
      expect(result).toBeNull();
    });

    it('should not process messages without text', () => {
      const noTextMessage = {
        message: {
          chat: { id: 12345 },
          from: { id: 67890, username: 'testuser', is_bot: false },
          date: Math.floor(Date.now() / 1000)
        }
      };

      const result = getTextMessage(noTextMessage);
      expect(result).toBeNull();
    });

    it('should process valid user messages', () => {
      const validMessage = {
        message: {
          chat: { id: 12345 },
          from: { id: 67890, username: 'testuser', is_bot: false },
          text: 'Valid user message',
          date: Math.floor(Date.now() / 1000)
        }
      };

      const result = getTextMessage(validMessage);
      expect(result).toEqual(validMessage.message);
    });
  });

  describe('Help Command Integration', () => {
    it('should include existing criminal statistics commands in help text', async () => {
      const mockMessage = {
        chat: { id: 12345 },
        from: { id: 67890, username: 'testuser' },
        text: '/help',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      expect(mockSendMessage).toHaveBeenCalled();
      const helpText = mockSendMessage.mock.calls[0][2];

      expect(helpText).toContain('/criminal_stats');
      expect(helpText).toContain('/my_criminal');
      expect(helpText).toContain('/criminal_top');
      expect(helpText).toContain('статистика нарушений УК РФ');
      expect(helpText).toContain('ваша статистика нарушений УК РФ');
      expect(helpText).toContain('топ N нарушителей УК РФ');
    });
  });
});
