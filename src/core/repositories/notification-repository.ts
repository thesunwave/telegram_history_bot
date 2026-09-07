/**
 * NotificationRepository для хранения настроек автоматических уведомлений
 * Реализует методы для сохранения и получения настроек уведомлений
 */

import type { Env } from '../env';
import type { 
  ChatNotificationSettings,
  NotificationStats,
  ScheduledNotification,
  NotificationType,
  NotificationResult
} from '../models/notification-settings';
import { 
  NotificationValidationUtils,
  NotificationDataSanitizer,
  validateChatNotificationSettings,
  validateNotificationStats,
  validateScheduledNotification
} from '../models/notification-validation';
import { Logger } from '../logger';

/**
 * Интерфейс репозитория для работы с настройками уведомлений
 */
export interface INotificationRepository {
  // Настройки чата
  getChatSettings(chatId: string): Promise<ChatNotificationSettings | null>;
  saveChatSettings(settings: ChatNotificationSettings): Promise<void>;
  deleteChatSettings(chatId: string): Promise<void>;
  
  // Статистика уведомлений
  getNotificationStats(chatId: string, type: NotificationType): Promise<NotificationStats | null>;
  updateNotificationStats(stats: NotificationStats): Promise<void>;
  recordNotificationResult(chatId: string, type: NotificationType, result: NotificationResult): Promise<void>;
  
  // Запланированные уведомления
  getScheduledNotifications(chatId?: string, status?: ScheduledNotification['status']): Promise<ScheduledNotification[]>;
  saveScheduledNotification(notification: ScheduledNotification): Promise<void>;
  updateScheduledNotification(id: string, updates: Partial<ScheduledNotification>): Promise<void>;
  deleteScheduledNotification(id: string): Promise<void>;
  
  // Утилитарные методы
  getAllChatIds(): Promise<string[]>;
  cleanupOldNotifications(olderThanDays: number): Promise<number>;
}

/**
 * Реализация репозитория для работы с настройками уведомлений в KV Storage
 */
export class NotificationRepository implements INotificationRepository {
  private readonly SETTINGS_PREFIX = 'notification_settings:';
  private readonly STATS_PREFIX = 'notification_stats:';
  private readonly SCHEDULED_PREFIX = 'scheduled_notification:';
  private readonly CHAT_LIST_KEY = 'notification_chat_list';

  constructor(private env: Env) {}

  /**
   * Получить настройки уведомлений для чата
   */
  async getChatSettings(chatId: string): Promise<ChatNotificationSettings | null> {
    try {
      const key = `${this.SETTINGS_PREFIX}${chatId}`;
      const stored = await this.env.HISTORY.get(key);
      
      if (!stored) {
        Logger.debug(this.env, 'No notification settings found for chat', { chatId });
        return null;
      }

      const parsed = JSON.parse(stored);
      
      // Восстанавливаем даты
      if (parsed.createdAt) {
        parsed.createdAt = new Date(parsed.createdAt);
      }
      if (parsed.updatedAt) {
        parsed.updatedAt = new Date(parsed.updatedAt);
      }

      // Санитизируем данные на случай повреждения
      const sanitized = NotificationDataSanitizer.sanitizeChatNotificationSettings(
        parsed, 
        chatId, 
        parsed.updatedBy || 'system'
      );

      Logger.debug(this.env, 'Retrieved notification settings for chat', { 
        chatId, 
        enabled: sanitized.enabled,
        notificationCount: Object.keys(sanitized.notifications).length
      });

      return sanitized;

    } catch (error: any) {
      Logger.error('Failed to get chat notification settings', {
        chatId,
        error: error.message || String(error)
      });
      return null;
    }
  }

  /**
   * Сохранить настройки уведомлений для чата
   */
  async saveChatSettings(settings: ChatNotificationSettings): Promise<void> {
    try {
      // Валидируем настройки
      validateChatNotificationSettings(settings);

      const key = `${this.SETTINGS_PREFIX}${settings.chatId}`;
      const serialized = JSON.stringify(settings);
      
      // Сохраняем с TTL 1 год (настройки должны храниться долго)
      await this.env.HISTORY.put(key, serialized, {
        expirationTtl: 365 * 24 * 60 * 60 // 1 год
      });

      // Добавляем чат в список чатов с настройками
      await this.addChatToList(settings.chatId);

      Logger.debug(this.env, 'Saved notification settings for chat', {
        chatId: settings.chatId,
        enabled: settings.enabled,
        updatedBy: settings.updatedBy
      });

    } catch (error: any) {
      Logger.error('Failed to save chat notification settings', {
        chatId: settings.chatId,
        error: error.message || String(error)
      });
      throw new Error(`Failed to save notification settings: ${error.message}`);
    }
  }

  /**
   * Удалить настройки уведомлений для чата
   */
  async deleteChatSettings(chatId: string): Promise<void> {
    try {
      const key = `${this.SETTINGS_PREFIX}${chatId}`;
      await this.env.HISTORY.delete(key);

      // Удаляем чат из списка
      await this.removeChatFromList(chatId);

      Logger.debug(this.env, 'Deleted notification settings for chat', { chatId });

    } catch (error: any) {
      Logger.error('Failed to delete chat notification settings', {
        chatId,
        error: error.message || String(error)
      });
      throw new Error(`Failed to delete notification settings: ${error.message}`);
    }
  }

  /**
   * Получить статистику уведомлений
   */
  async getNotificationStats(chatId: string, type: NotificationType): Promise<NotificationStats | null> {
    try {
      const key = `${this.STATS_PREFIX}${chatId}:${type}`;
      const stored = await this.env.HISTORY.get(key);
      
      if (!stored) {
        return null;
      }

      const parsed = JSON.parse(stored);
      
      // Восстанавливаем даты
      if (parsed.lastSentAt) {
        parsed.lastSentAt = new Date(parsed.lastSentAt);
      }

      // Валидируем данные
      validateNotificationStats(parsed);

      return parsed;

    } catch (error: any) {
      Logger.error('Failed to get notification stats', {
        chatId,
        type,
        error: error.message || String(error)
      });
      return null;
    }
  }

  /**
   * Обновить статистику уведомлений
   */
  async updateNotificationStats(stats: NotificationStats): Promise<void> {
    try {
      validateNotificationStats(stats);

      const key = `${this.STATS_PREFIX}${stats.chatId}:${stats.notificationType}`;
      const serialized = JSON.stringify(stats);
      
      // Сохраняем с TTL 90 дней
      await this.env.HISTORY.put(key, serialized, {
        expirationTtl: 90 * 24 * 60 * 60 // 90 дней
      });

      Logger.debug(this.env, 'Updated notification stats', {
        chatId: stats.chatId,
        type: stats.notificationType,
        totalSent: stats.totalSent,
        successRate: stats.successRate
      });

    } catch (error: any) {
      Logger.error('Failed to update notification stats', {
        chatId: stats.chatId,
        type: stats.notificationType,
        error: error.message || String(error)
      });
      throw new Error(`Failed to update notification stats: ${error.message}`);
    }
  }

  /**
   * Записать результат отправки уведомления
   */
  async recordNotificationResult(chatId: string, type: NotificationType, result: NotificationResult): Promise<void> {
    try {
      // Получаем текущую статистику
      let stats = await this.getNotificationStats(chatId, type);
      
      if (!stats) {
        stats = NotificationDataSanitizer.createEmptyNotificationStats(chatId, type);
      }

      // Обновляем статистику
      stats.totalSent += 1;
      stats.lastSentAt = result.sentAt;

      if (result.success) {
        // Обновляем среднее время отклика
        const totalResponseTime = stats.averageResponseTime * (stats.totalSent - 1) + result.responseTime;
        stats.averageResponseTime = totalResponseTime / stats.totalSent;
        
        // Обновляем процент успешных отправок
        const successfulSends = Math.round(stats.successRate * (stats.totalSent - 1)) + 1;
        stats.successRate = successfulSends / stats.totalSent;
      } else {
        stats.failureCount += 1;
        stats.lastFailureReason = result.error;
        
        // Обновляем процент успешных отправок
        const successfulSends = Math.round(stats.successRate * (stats.totalSent - 1));
        stats.successRate = successfulSends / stats.totalSent;
      }

      await this.updateNotificationStats(stats);

    } catch (error: any) {
      Logger.error('Failed to record notification result', {
        chatId,
        type,
        success: result.success,
        error: error.message || String(error)
      });
      // Не бросаем ошибку, так как это не критично
    }
  }

  /**
   * Получить запланированные уведомления
   */
  async getScheduledNotifications(chatId?: string, status?: ScheduledNotification['status']): Promise<ScheduledNotification[]> {
    try {
      // Получаем список всех запланированных уведомлений
      const listKey = 'scheduled_notifications_list';
      const listStored = await this.env.HISTORY.get(listKey);
      
      if (!listStored) {
        return [];
      }

      const notificationIds: string[] = JSON.parse(listStored);
      const notifications: ScheduledNotification[] = [];

      // Получаем каждое уведомление
      for (const id of notificationIds) {
        try {
          const key = `${this.SCHEDULED_PREFIX}${id}`;
          const stored = await this.env.HISTORY.get(key);
          
          if (stored) {
            const parsed = JSON.parse(stored);
            
            // Восстанавливаем даты
            if (parsed.scheduledAt) parsed.scheduledAt = new Date(parsed.scheduledAt);
            if (parsed.createdAt) parsed.createdAt = new Date(parsed.createdAt);
            if (parsed.lastAttemptAt) parsed.lastAttemptAt = new Date(parsed.lastAttemptAt);

            // Фильтруем по chatId и status если указаны
            if (chatId && parsed.chatId !== chatId) continue;
            if (status && parsed.status !== status) continue;

            validateScheduledNotification(parsed);
            notifications.push(parsed);
          } else {
            // Запись истекла по TTL или была удалена — убираем id из списка
            await this.removeNotificationFromList(id);
          }
        } catch (error) {
          Logger.error('Failed to parse scheduled notification', { id, error: error.message });
          // Удаляем поврежденное уведомление из списка
          await this.removeNotificationFromList(id);
        }
      }

      return notifications.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

    } catch (error: any) {
      Logger.error('Failed to get scheduled notifications', {
        chatId,
        status,
        error: error.message || String(error)
      });
      return [];
    }
  }

  /**
   * Сохранить запланированное уведомление
   */
  async saveScheduledNotification(notification: ScheduledNotification): Promise<void> {
    try {
      validateScheduledNotification(notification);

      const key = `${this.SCHEDULED_PREFIX}${notification.id}`;
      const serialized = JSON.stringify(notification);
      
      // Вычисляем TTL: время до запланированной отправки + 7 дней на повторы
      const now = Date.now();
      const scheduledTime = notification.scheduledAt.getTime();
      const ttlSeconds = Math.max(
        Math.floor((scheduledTime - now) / 1000) + (7 * 24 * 60 * 60), // +7 дней
        24 * 60 * 60 // минимум 1 день
      );

      await this.env.HISTORY.put(key, serialized, { expirationTtl: ttlSeconds });

      // Добавляем в список запланированных уведомлений
      await this.addNotificationToList(notification.id);

      Logger.debug(this.env, 'Saved scheduled notification', {
        id: notification.id,
        chatId: notification.chatId,
        type: notification.notificationType,
        scheduledAt: notification.scheduledAt.toISOString()
      });

    } catch (error: any) {
      Logger.error('Failed to save scheduled notification', {
        id: notification.id,
        chatId: notification.chatId,
        error: error.message || String(error)
      });
      throw new Error(`Failed to save scheduled notification: ${error.message}`);
    }
  }

  /**
   * Обновить запланированное уведомление
   */
  async updateScheduledNotification(id: string, updates: Partial<ScheduledNotification>): Promise<void> {
    try {
      const key = `${this.SCHEDULED_PREFIX}${id}`;
      const stored = await this.env.HISTORY.get(key);
      
      if (!stored) {
        throw new Error(`Scheduled notification not found: ${id}`);
      }

      const existing = JSON.parse(stored);
      
      // Восстанавливаем даты
      if (existing.scheduledAt) existing.scheduledAt = new Date(existing.scheduledAt);
      if (existing.createdAt) existing.createdAt = new Date(existing.createdAt);
      if (existing.lastAttemptAt) existing.lastAttemptAt = new Date(existing.lastAttemptAt);

      // Применяем обновления
      const updated = { ...existing, ...updates };
      
      // Обновляем даты из updates
      if (updates.scheduledAt) updated.scheduledAt = updates.scheduledAt;
      if (updates.lastAttemptAt) updated.lastAttemptAt = updates.lastAttemptAt;

      validateScheduledNotification(updated);

      const serialized = JSON.stringify(updated);
      
      // Пересчитываем TTL
      const now = Date.now();
      const scheduledTime = updated.scheduledAt.getTime();
      const ttlSeconds = Math.max(
        Math.floor((scheduledTime - now) / 1000) + (7 * 24 * 60 * 60),
        24 * 60 * 60
      );

      await this.env.HISTORY.put(key, serialized, { expirationTtl: ttlSeconds });

      Logger.debug(this.env, 'Updated scheduled notification', {
        id,
        status: updated.status,
        retryCount: updated.retryCount
      });

    } catch (error: any) {
      Logger.error('Failed to update scheduled notification', {
        id,
        error: error.message || String(error)
      });
      throw new Error(`Failed to update scheduled notification: ${error.message}`);
    }
  }

  /**
   * Удалить запланированное уведомление
   */
  async deleteScheduledNotification(id: string): Promise<void> {
    try {
      const key = `${this.SCHEDULED_PREFIX}${id}`;
      await this.env.HISTORY.delete(key);

      // Удаляем из списка
      await this.removeNotificationFromList(id);

      Logger.debug(this.env, 'Deleted scheduled notification', { id });

    } catch (error: any) {
      Logger.error('Failed to delete scheduled notification', {
        id,
        error: error.message || String(error)
      });
      throw new Error(`Failed to delete scheduled notification: ${error.message}`);
    }
  }

  /**
   * Получить список всех чатов с настройками уведомлений
   */
  async getAllChatIds(): Promise<string[]> {
    try {
      const stored = await this.env.HISTORY.get(this.CHAT_LIST_KEY);
      
      if (!stored) {
        return [];
      }

      return JSON.parse(stored);

    } catch (error: any) {
      Logger.error('Failed to get chat list', {
        error: error.message || String(error)
      });
      return [];
    }
  }

  /**
   * Очистить старые уведомления
   */
  async cleanupOldNotifications(olderThanDays: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const notifications = await this.getScheduledNotifications();
      let deletedCount = 0;

      for (const notification of notifications) {
        // Удаляем завершенные уведомления старше указанного срока
        if ((notification.status === 'sent' || notification.status === 'failed' || notification.status === 'cancelled') &&
            notification.createdAt < cutoffDate) {
          
          await this.deleteScheduledNotification(notification.id);
          deletedCount++;
        }
      }

      Logger.debug(this.env, 'Cleaned up old notifications', {
        deletedCount,
        olderThanDays
      });

      return deletedCount;

    } catch (error: any) {
      Logger.error('Failed to cleanup old notifications', {
        olderThanDays,
        error: error.message || String(error)
      });
      return 0;
    }
  }

  /**
   * Добавить чат в список чатов с настройками
   */
  private async addChatToList(chatId: string): Promise<void> {
    try {
      const stored = await this.env.HISTORY.get(this.CHAT_LIST_KEY);
      const chatIds: string[] = stored ? JSON.parse(stored) : [];
      
      if (!chatIds.includes(chatId)) {
        chatIds.push(chatId);
        await this.env.HISTORY.put(this.CHAT_LIST_KEY, JSON.stringify(chatIds), {
          expirationTtl: 365 * 24 * 60 * 60 // 1 год
        });
      }
    } catch (error) {
      Logger.error('Failed to add chat to list', { chatId, error: error.message });
    }
  }

  /**
   * Удалить чат из списка чатов с настройками
   */
  private async removeChatFromList(chatId: string): Promise<void> {
    try {
      const stored = await this.env.HISTORY.get(this.CHAT_LIST_KEY);
      if (!stored) return;

      const chatIds: string[] = JSON.parse(stored);
      const filteredIds = chatIds.filter(id => id !== chatId);
      
      if (filteredIds.length !== chatIds.length) {
        await this.env.HISTORY.put(this.CHAT_LIST_KEY, JSON.stringify(filteredIds), {
          expirationTtl: 365 * 24 * 60 * 60
        });
      }
    } catch (error) {
      Logger.error('Failed to remove chat from list', { chatId, error: error.message });
    }
  }

  /**
   * Добавить уведомление в список запланированных
   */
  private async addNotificationToList(notificationId: string): Promise<void> {
    try {
      const listKey = 'scheduled_notifications_list';
      const stored = await this.env.HISTORY.get(listKey);
      const notificationIds: string[] = stored ? JSON.parse(stored) : [];
      
      if (!notificationIds.includes(notificationId)) {
        notificationIds.push(notificationId);
        await this.env.HISTORY.put(listKey, JSON.stringify(notificationIds), {
          expirationTtl: 365 * 24 * 60 * 60 // 1 год
        });
      }
    } catch (error) {
      Logger.error('Failed to add notification to list', { notificationId, error: error.message });
    }
  }

  /**
   * Удалить уведомление из списка запланированных
   */
  private async removeNotificationFromList(notificationId: string): Promise<void> {
    try {
      const listKey = 'scheduled_notifications_list';
      const stored = await this.env.HISTORY.get(listKey);
      if (!stored) return;

      const notificationIds: string[] = JSON.parse(stored);
      const filteredIds = notificationIds.filter(id => id !== notificationId);
      
      if (filteredIds.length !== notificationIds.length) {
        await this.env.HISTORY.put(listKey, JSON.stringify(filteredIds), {
          expirationTtl: 365 * 24 * 60 * 60
        });
      }
    } catch (error) {
      Logger.error('Failed to remove notification from list', { notificationId, error: error.message });
    }
  }
}