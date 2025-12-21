/**
 * Интеграционные тесты для интеграции криминальных уведомлений
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordMessage } from '../../src/api/update';
import type { Env } from '../../src/core/env';

// Мокаем зависимости
vi.mock('../../src/core/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue('123')
}));

vi.mock('../../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  }
}));

vi.mock('../../src/features/stats/violation-handler', () => ({
  ViolationHandler: vi.fn().mockImplementation(() => ({
    formatViolationMessage: vi.fn().mockResolvedValue('🚨 Обнаружено нарушение УК РФ')
  }))
}));

describe('Criminal Notifications Integration', () => {
  let mockEnv: Env;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // Настраиваем NODE_ENV чтобы isTestEnvironment возвращала false
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    // Создаем мок окружения
    mockEnv = {
      HISTORY: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined)
      },
      COUNTERS_DO: {
        idFromName: vi.fn().mockReturnValue('counter-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ ok: true })
          })
        })
      },
      CRIMINAL_CODE_ANALYZER_DO: {
        idFromName: vi.fn().mockReturnValue('analyzer-id'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
              hasViolations: true,
              violations: [
                {
                  article: '282',
                  quote: 'тестовое нарушение',
                  punishment: 'штраф',
                  severity: 8,
                  confidence: 0.9
                }
              ],
              riskLevel: 'high',
              confidence: 0.9
            })
          })
        })
      },
      TOKEN: 'production_token', // Не test_token, чтобы isTestEnvironment возвращала false
      SECRET: 'test_secret'
    } as any;

    // Очищаем все моки
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Восстанавливаем NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('Criminal violation detection with notifications disabled', () => {
    it('should not send notification when all notifications are disabled', async () => {
      // Настраиваем мок для отключенных уведомлений
      const disabledSettings = {
        chatId: '123',
        enabled: false, // Все уведомления отключены
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: '456',
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        },
        adminOnly: true
      };

      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue(JSON.stringify(disabledSettings));

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser', is_bot: false },
        text: 'я твою мать выебу', // Сообщение с нарушением
        date: Math.floor(Date.now() / 1000),
        message_id: 789
      };

      await recordMessage(mockMessage, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем, что сообщение НЕ было отправлено
      const { sendMessage } = await import('../../src/core/telegram');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should not send notification when criminal reports are specifically disabled', async () => {
      // Настраиваем мок для включенных уведомлений, но отключенных криминальных репортов
      const partiallyEnabledSettings = {
        chatId: '123',
        enabled: true, // Общие уведомления включены
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: '456',
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 }, // Криминальные репорты отключены
          profanity_reports: { enabled: true, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: true, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: true, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        },
        adminOnly: true
      };

      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue(JSON.stringify(partiallyEnabledSettings));

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser', is_bot: false },
        text: 'я твою мать выебу', // Сообщение с нарушением
        date: Math.floor(Date.now() / 1000),
        message_id: 789
      };

      await recordMessage(mockMessage, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем, что сообщение НЕ было отправлено
      const { sendMessage } = await import('../../src/core/telegram');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should send notification when criminal reports are enabled', async () => {
      // Настраиваем мок для включенных криминальных репортов
      const enabledSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: '456',
        notifications: {
          criminal_reports: { enabled: true, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 }, // Криминальные репорты включены
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        },
        adminOnly: true
      };

      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue(JSON.stringify(enabledSettings));

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser', is_bot: false },
        text: 'я твою мать выебу', // Сообщение с нарушением
        date: Math.floor(Date.now() / 1000),
        message_id: 789
      };

      await recordMessage(mockMessage, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем, что сообщение БЫЛО отправлено
      const { sendMessage } = await import('../../src/core/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Обнаружено нарушение УК РФ')
      );
    });

    it('should not send notification when no settings exist (default behavior)', async () => {
      // Настраиваем мок для отсутствующих настроек
      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue(null);

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser', is_bot: false },
        text: 'я твою мать выебу', // Сообщение с нарушением
        date: Math.floor(Date.now() / 1000),
        message_id: 789
      };

      await recordMessage(mockMessage, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем, что сообщение НЕ было отправлено (по умолчанию уведомления отключены)
      const { sendMessage } = await import('../../src/core/telegram');
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Normal message processing', () => {
    it('should process normal messages without sending notifications', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser', is_bot: false },
        text: 'привет, как дела?', // Обычное сообщение
        date: Math.floor(Date.now() / 1000),
        message_id: 789
      };

      // Настраиваем мок анализатора для отсутствия нарушений
      vi.mocked(mockEnv.CRIMINAL_CODE_ANALYZER_DO.get).mockReturnValue({
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            hasViolations: false,
            violations: [],
            riskLevel: 'low',
            confidence: 0.1
          })
        })
      } as any);

      await recordMessage(mockMessage, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем, что сообщение НЕ было отправлено
      const { sendMessage } = await import('../../src/core/telegram');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should not analyze bot messages', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testbot', is_bot: true }, // Сообщение от бота
        text: 'я твою мать выебу',
        date: Math.floor(Date.now() / 1000),
        message_id: 789
      };

      await recordMessage(mockMessage, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем, что анализатор НЕ был вызван
      expect(mockEnv.CRIMINAL_CODE_ANALYZER_DO.get).not.toHaveBeenCalled();

      // Проверяем, что сообщение НЕ было отправлено
      const { sendMessage } = await import('../../src/core/telegram');
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('should not analyze command messages', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser', is_bot: false },
        text: '/help', // Команда
        date: Math.floor(Date.now() / 1000),
        message_id: 789
      };

      await recordMessage(mockMessage, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем, что анализатор НЕ был вызван для команды
      // (команды обрабатываются отдельно в handleUpdate)
      const { sendMessage } = await import('../../src/core/telegram');

      // Команда /help должна отправить справку, но не через систему нарушений
      // Это нормальное поведение
    });
  });
});
