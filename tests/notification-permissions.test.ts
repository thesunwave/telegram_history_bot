/**
 * Тесты для проверки прав доступа к настройкам уведомлений
 */

import { describe, it, expect } from 'vitest';
import { NotificationValidationUtils } from '../src/models/notification-validation';
import type { ChatNotificationSettings } from '../src/models/notification-settings';

describe('Notification Permissions', () => {
  describe('canUserModifySettings', () => {
    it('should allow any user when adminOnly is false', () => {
      const settings: ChatNotificationSettings = {
        chatId: '-123456789',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user1',
        adminOnly: false, // Любой может изменять
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        }
      };

      expect(NotificationValidationUtils.canUserModifySettings('user1', settings)).toBe(true);
      expect(NotificationValidationUtils.canUserModifySettings('user2', settings)).toBe(true);
      expect(NotificationValidationUtils.canUserModifySettings('randomuser', settings)).toBe(true);
    });

    it('should allow user in allowedUsers list when adminOnly is true', () => {
      const settings: ChatNotificationSettings = {
        chatId: '-123456789',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'admin',
        adminOnly: true,
        allowedUsers: ['user1', 'user2'],
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        }
      };

      expect(NotificationValidationUtils.canUserModifySettings('user1', settings)).toBe(true);
      expect(NotificationValidationUtils.canUserModifySettings('user2', settings)).toBe(true);
      expect(NotificationValidationUtils.canUserModifySettings('user3', settings)).toBe(true); // Пока разрешаем всем в групповых чатах
    });

    it('should allow any user in private chats (positive chatId)', () => {
      const settings: ChatNotificationSettings = {
        chatId: '123456789', // Положительный ID = личный чат
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user1',
        adminOnly: true, // Даже если adminOnly включен
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        }
      };

      expect(NotificationValidationUtils.canUserModifySettings('user1', settings)).toBe(true);
      expect(NotificationValidationUtils.canUserModifySettings('anyuser', settings)).toBe(true);
    });

    it('should allow any user in group chats for now (negative chatId)', () => {
      const settings: ChatNotificationSettings = {
        chatId: '-123456789', // Отрицательный ID = групповой чат
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'admin',
        adminOnly: true,
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        }
      };

      // Пока разрешаем всем в групповых чатах (до реализации проверки админов через Telegram API)
      expect(NotificationValidationUtils.canUserModifySettings('user1', settings)).toBe(true);
      expect(NotificationValidationUtils.canUserModifySettings('randomuser', settings)).toBe(true);
    });

    it('should handle edge cases correctly', () => {
      const settings: ChatNotificationSettings = {
        chatId: '0', // Граничный случай
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'user1',
        adminOnly: true,
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        }
      };

      // chatId = 0 считается как групповой чат
      expect(NotificationValidationUtils.canUserModifySettings('user1', settings)).toBe(true);
    });

    it('should work with empty allowedUsers array', () => {
      const settings: ChatNotificationSettings = {
        chatId: '-123456789',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'admin',
        adminOnly: true,
        allowedUsers: [], // Пустой массив
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        }
      };

      expect(NotificationValidationUtils.canUserModifySettings('user1', settings)).toBe(true);
    });

    it('should work without allowedUsers property', () => {
      const settings: ChatNotificationSettings = {
        chatId: '-123456789',
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: 'admin',
        adminOnly: true,
        // allowedUsers не определен
        notifications: {
          criminal_reports: { enabled: false, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        }
      };

      expect(NotificationValidationUtils.canUserModifySettings('user1', settings)).toBe(true);
    });
  });

  describe('Default settings', () => {
    it('should work with current default settings', async () => {
      const { DEFAULT_NOTIFICATION_SETTINGS } = await import('../src/models/notification-settings');
      // Проверяем что настройки определены
      expect(DEFAULT_NOTIFICATION_SETTINGS).toBeDefined();
      expect(typeof DEFAULT_NOTIFICATION_SETTINGS.adminOnly).toBe('boolean');
    });
  });
});