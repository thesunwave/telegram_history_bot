/**
 * Тесты для NotificationService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from '../src/core/services/notification-service';
import { NotificationRepository } from '../src/core/repositories/notification-repository';
import type { Env } from '../src/core/env';
import type { ChatNotificationSettings, NotificationType } from '../src/models/notification-settings';

// Мокаем зависимости
vi.mock('../src/core/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue('123')
}));

vi.mock('../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  }
}));

describe('NotificationService', () => {
  let service: NotificationService;
  let mockRepository: NotificationRepository;
  let mockEnv: Env;

  beforeEach(() => {
    // Создаем мок окружения
    mockEnv = {
      HISTORY: {
        get: vi.fn(),
        put: vi.fn(),
        delete: vi.fn()
      }
    } as any;

    // Создаем мок репозитория
    mockRepository = {
      getChatSettings: vi.fn(),
      saveChatSettings: vi.fn(),
      deleteChatSettings: vi.fn(),
      getNotificationStats: vi.fn(),
      updateNotificationStats: vi.fn(),
      recordNotificationResult: vi.fn(),
      getScheduledNotifications: vi.fn(),
      saveScheduledNotification: vi.fn(),
      updateScheduledNotification: vi.fn(),
      deleteScheduledNotification: vi.fn(),
      getAllChatIds: vi.fn(),
      cleanupOldNotifications: vi.fn()
    } as any;

    service = new NotificationService(mockEnv, mockRepository);
  });

  describe('getChatSettings', () => {
    it('should return null when no settings exist', async () => {
      vi.mocked(mockRepository.getChatSettings).mockResolvedValue(null);

      const result = await service.getChatSettings('123');

      expect(result).toBeNull();
      expect(mockRepository.getChatSettings).toHaveBeenCalledWith('123');
    });

    it('should return settings when they exist', async () => {
      const mockSettings: ChatNotificationSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user123',
        notifications: {
          criminal_reports: {
            enabled: true,
            frequency: 'instant',
            includeDetails: true,
            maxItemsInReport: 10,
            threshold: 1
          },
          profanity_reports: {
            enabled: false,
            frequency: 'daily',
            includeDetails: false,
            maxItemsInReport: 5
          },
          activity_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 10
          },
          daily_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 15
          },
          weekly_summary: {
            enabled: false,
            frequency: 'weekly',
            includeDetails: true,
            maxItemsInReport: 20
          },
          monthly_summary: {
            enabled: false,
            frequency: 'monthly',
            includeDetails: true,
            maxItemsInReport: 25
          }
        },
        adminOnly: true
      };

      vi.mocked(mockRepository.getChatSettings).mockResolvedValue(mockSettings);

      const result = await service.getChatSettings('123');

      expect(result).toEqual(mockSettings);
      expect(mockRepository.getChatSettings).toHaveBeenCalledWith('123');
    });
  });

  describe('enableNotification', () => {
    it('should enable notification type', async () => {
      const mockSettings: ChatNotificationSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user123',
        notifications: {
          criminal_reports: {
            enabled: false,
            frequency: 'instant',
            includeDetails: true,
            maxItemsInReport: 10,
            threshold: 1
          },
          profanity_reports: {
            enabled: false,
            frequency: 'daily',
            includeDetails: false,
            maxItemsInReport: 5
          },
          activity_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 10
          },
          daily_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 15
          },
          weekly_summary: {
            enabled: false,
            frequency: 'weekly',
            includeDetails: true,
            maxItemsInReport: 20
          },
          monthly_summary: {
            enabled: false,
            frequency: 'monthly',
            includeDetails: true,
            maxItemsInReport: 25
          }
        },
        adminOnly: true
      };

      vi.mocked(mockRepository.getChatSettings).mockResolvedValue(mockSettings);
      vi.mocked(mockRepository.saveChatSettings).mockResolvedValue(undefined);

      await service.enableNotification('123', 'criminal_reports', 'user123');

      expect(mockRepository.saveChatSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '123',
          notifications: expect.objectContaining({
            criminal_reports: expect.objectContaining({
              enabled: true
            })
          })
        })
      );
    });

    it('should create default settings if none exist', async () => {
      vi.mocked(mockRepository.getChatSettings).mockResolvedValue(null);
      vi.mocked(mockRepository.saveChatSettings).mockResolvedValue(undefined);

      await service.enableNotification('123', 'criminal_reports', 'user123');

      expect(mockRepository.saveChatSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '123',
          notifications: expect.objectContaining({
            criminal_reports: expect.objectContaining({
              enabled: true
            })
          })
        })
      );
    });
  });

  describe('disableNotification', () => {
    it('should disable notification type', async () => {
      const mockSettings: ChatNotificationSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user123',
        notifications: {
          criminal_reports: {
            enabled: true,
            frequency: 'instant',
            includeDetails: true,
            maxItemsInReport: 10,
            threshold: 1
          },
          profanity_reports: {
            enabled: false,
            frequency: 'daily',
            includeDetails: false,
            maxItemsInReport: 5
          },
          activity_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 10
          },
          daily_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 15
          },
          weekly_summary: {
            enabled: false,
            frequency: 'weekly',
            includeDetails: true,
            maxItemsInReport: 20
          },
          monthly_summary: {
            enabled: false,
            frequency: 'monthly',
            includeDetails: true,
            maxItemsInReport: 25
          }
        },
        adminOnly: true
      };

      vi.mocked(mockRepository.getChatSettings).mockResolvedValue(mockSettings);
      vi.mocked(mockRepository.saveChatSettings).mockResolvedValue(undefined);

      await service.disableNotification('123', 'criminal_reports', 'user123');

      expect(mockRepository.saveChatSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '123',
          notifications: expect.objectContaining({
            criminal_reports: expect.objectContaining({
              enabled: false
            })
          })
        })
      );
    });
  });

  describe('getAvailableNotificationTypes', () => {
    it('should return all available notification types', () => {
      const types = service.getAvailableNotificationTypes();

      expect(types).toEqual([
        'criminal_reports',
        'profanity_reports',
        'activity_summary',
        'daily_summary',
        'weekly_summary',
        'monthly_summary'
      ]);
    });
  });

  describe('getNotificationTemplate', () => {
    it('should return template for valid type', () => {
      const template = service.getNotificationTemplate('criminal_reports');

      expect(template).toBeDefined();
      expect(template?.type).toBe('criminal_reports');
      expect(template?.title).toBeDefined();
      expect(template?.template).toBeDefined();
    });

    it('should return null for invalid type', () => {
      const template = service.getNotificationTemplate('invalid_type' as NotificationType);

      expect(template).toBeNull();
    });
  });

  describe('scheduleNotification', () => {
    it('should throw error when notifications are disabled', async () => {
      const mockSettings: ChatNotificationSettings = {
        chatId: '123',
        enabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user123',
        notifications: {
          criminal_reports: {
            enabled: false,
            frequency: 'instant',
            includeDetails: true,
            maxItemsInReport: 10,
            threshold: 1
          },
          profanity_reports: {
            enabled: false,
            frequency: 'daily',
            includeDetails: false,
            maxItemsInReport: 5
          },
          activity_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 10
          },
          daily_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 15
          },
          weekly_summary: {
            enabled: false,
            frequency: 'weekly',
            includeDetails: true,
            maxItemsInReport: 20
          },
          monthly_summary: {
            enabled: false,
            frequency: 'monthly',
            includeDetails: true,
            maxItemsInReport: 25
          }
        },
        adminOnly: true
      };

      vi.mocked(mockRepository.getChatSettings).mockResolvedValue(mockSettings);

      await expect(service.scheduleNotification('123', 'criminal_reports'))
        .rejects.toThrow('Notifications are disabled for this chat or type');
    });

    it('should schedule notification when enabled', async () => {
      const mockSettings: ChatNotificationSettings = {
        chatId: '123',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user123',
        notifications: {
          criminal_reports: {
            enabled: true,
            frequency: 'instant',
            includeDetails: true,
            maxItemsInReport: 10,
            threshold: 1
          },
          profanity_reports: {
            enabled: false,
            frequency: 'daily',
            includeDetails: false,
            maxItemsInReport: 5
          },
          activity_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 10
          },
          daily_summary: {
            enabled: false,
            frequency: 'daily',
            includeDetails: true,
            maxItemsInReport: 15
          },
          weekly_summary: {
            enabled: false,
            frequency: 'weekly',
            includeDetails: true,
            maxItemsInReport: 20
          },
          monthly_summary: {
            enabled: false,
            frequency: 'monthly',
            includeDetails: true,
            maxItemsInReport: 25
          }
        },
        adminOnly: true
      };

      vi.mocked(mockRepository.getChatSettings).mockResolvedValue(mockSettings);
      vi.mocked(mockRepository.saveScheduledNotification).mockResolvedValue(undefined);

      const notificationId = await service.scheduleNotification('123', 'criminal_reports');

      expect(notificationId).toBeDefined();
      expect(typeof notificationId).toBe('string');
      expect(mockRepository.saveScheduledNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '123',
          notificationType: 'criminal_reports',
          status: 'pending'
        })
      );
    });
  });
});