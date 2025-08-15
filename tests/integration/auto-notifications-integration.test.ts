/**
 * Интеграционные тесты для команды автоматических уведомлений
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleUpdate } from '../../src/update';
import type { Env } from '../../src/env';

// Мокаем зависимости
vi.mock('../../src/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue('123')
}));

vi.mock('../../src/logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  }
}));

describe('Auto Notifications Integration', () => {
  let mockEnv: Env;

  beforeEach(() => {
    // Создаем мок окружения
    mockEnv = {
      HISTORY: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined)
      },
      TOKEN: 'test_token',
      SECRET: 'test_secret'
    } as any;

    // Очищаем все моки
    vi.clearAllMocks();
  });

  describe('/auto_notifications command', () => {
    it('should handle status command for new chat', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications status',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что была попытка отправить сообщение
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Уведомления не настроены для этого чата')
      );
    });

    it('should handle enable command', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications enable',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что настройки были сохранены
      expect(mockEnv.HISTORY.put).toHaveBeenCalled();

      // Проверяем, что было отправлено подтверждение
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Автоматические уведомления включены')
      );
    });

    it('should handle enable command for specific type', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications enable criminal_reports',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что настройки были сохранены
      expect(mockEnv.HISTORY.put).toHaveBeenCalled();

      // Проверяем, что было отправлено подтверждение
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Криминальные репорты')
      );
    });

    it('should handle disable command', async () => {
      // Сначала создаем настройки
      const existingSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: '456',
        notifications: {
          criminal_reports: { enabled: true, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        },
        adminOnly: false // Разрешаем всем пользователям изменять настройки
      };

      // Настраиваем мок для возврата существующих настроек при первом вызове
      vi.mocked(mockEnv.HISTORY.get)
        .mockResolvedValueOnce(JSON.stringify(existingSettings)) // Для getChatSettings
        .mockResolvedValueOnce(JSON.stringify(existingSettings)); // Для canUserModifySettings

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications disable',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что настройки были обновлены
      expect(mockEnv.HISTORY.put).toHaveBeenCalled();

      // Проверяем, что было отправлено подтверждение
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Автоматические уведомления отключены')
      );
    });

    it('should handle types command', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications types',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что был отправлен список типов
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Доступные типы уведомлений')
      );
    });

    it('should handle stats command', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications stats',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что была отправлена статистика
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Статистика уведомлений')
      );
    });

    it('should handle invalid subcommand', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications invalid',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что было отправлено сообщение об ошибке
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Неизвестная подкоманда')
      );
    });

    it('should allow access with new permission system', async () => {
      // Создаем настройки с ограниченным доступом (но теперь система разрешает всем)
      const existingSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: '999', // Другой пользователь
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        },
        adminOnly: true,
        allowedUsers: ['999'] // Только другой пользователь в списке
      };

      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue(JSON.stringify(existingSettings));

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' }, // Пользователь не в списке allowedUsers
        text: '/auto_notifications enable criminal_reports',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что пользователь теперь может включать уведомления (новая логика прав)
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Криминальные репорты')
      );
    });

    it('should handle invalid notification type', async () => {
      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications enable invalid_type',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что было отправлено сообщение об ошибке
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Неизвестный тип уведомлений')
      );
    });

    it('should show current settings when they exist', async () => {
      const existingSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: '456',
        notifications: {
          criminal_reports: { enabled: true, frequency: 'instant', includeDetails: true, maxItemsInReport: 10, threshold: 1 },
          profanity_reports: { enabled: true, frequency: 'daily', time: { hour: 9, minute: 0 }, includeDetails: false, maxItemsInReport: 5, threshold: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        },
        adminOnly: true,
        quietHours: {
          enabled: true,
          startTime: { hour: 22, minute: 0 },
          endTime: { hour: 8, minute: 0 }
        }
      };

      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue(JSON.stringify(existingSettings));

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications status',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что были показаны настройки
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringMatching(/Автоматические уведомления.*Включены.*Криминальные репорты.*Отчеты о мате.*Тихие часы/s)
      );
    });
  });

  describe('Error handling', () => {
    it('should handle repository errors gracefully', async () => {
      // Мокаем ошибку в KV Storage для операции записи
      vi.mocked(mockEnv.HISTORY.put).mockRejectedValue(new Error('KV Storage error'));

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications enable',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что было отправлено сообщение об ошибке
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Ошибка при выполнении команды')
      );
    });

    it('should handle malformed stored data', async () => {
      // Мокаем поврежденные данные
      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue('invalid json');

      const mockMessage = {
        chat: { id: 123 },
        from: { id: 456, username: 'testuser' },
        text: '/auto_notifications status',
        date: Math.floor(Date.now() / 1000)
      };

      await handleUpdate(mockMessage, mockEnv);

      // Проверяем, что система обработала ошибку и показала сообщение для нового чата
      const { sendMessage } = await import('../../src/telegram');
      expect(sendMessage).toHaveBeenCalledWith(
        mockEnv,
        123,
        expect.stringContaining('Уведомления не настроены для этого чата')
      );
    });
  });
});