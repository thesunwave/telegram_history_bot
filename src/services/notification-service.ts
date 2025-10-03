/**
 * NotificationService для управления автоматическими уведомлениями
 * Предоставляет методы для настройки, планирования и отправки уведомлений
 */

import type { Env } from '../env';
import type { 
  ChatNotificationSettings,
  NotificationStats,
  ScheduledNotification,
  NotificationType,
  NotificationResult,
  NotificationContext,
  NotificationTemplate,
  NotificationTypeSettings
} from '../models/notification-settings';
import { DEFAULT_NOTIFICATION_TEMPLATES } from '../models/notification-settings';
import type { INotificationRepository } from '../repositories/notification-repository';
import { 
  NotificationValidationUtils,
  NotificationDataSanitizer
} from '../models/notification-validation';
import { BaseService, type ServiceConfig } from './base-service';
import { sendMessage } from '../telegram';

/**
 * Интерфейс сервиса уведомлений
 */
export interface INotificationService {
  // Управление настройками
  getChatSettings(chatId: string): Promise<ChatNotificationSettings | null>;
  updateChatSettings(chatId: string, updates: Partial<ChatNotificationSettings>, updatedBy: string): Promise<ChatNotificationSettings>;
  resetChatSettings(chatId: string, updatedBy: string): Promise<ChatNotificationSettings>;
  
  // Управление типами уведомлений
  enableNotification(chatId: string, type: NotificationType, updatedBy: string): Promise<void>;
  disableNotification(chatId: string, type: NotificationType, updatedBy: string): Promise<void>;
  updateNotificationSettings(chatId: string, type: NotificationType, settings: Partial<NotificationTypeSettings>, updatedBy: string): Promise<void>;
  
  // Планирование и отправка
  scheduleNotification(chatId: string, type: NotificationType, data?: any): Promise<string>;
  sendNotification(context: NotificationContext): Promise<NotificationResult>;
  processScheduledNotifications(): Promise<number>;
  
  // Статистика
  getNotificationStats(chatId: string, type: NotificationType): Promise<NotificationStats>;
  
  // Утилитарные методы
  canUserModifySettings(userId: string, chatId: string): Promise<boolean>;
  getAvailableNotificationTypes(): NotificationType[];
  getNotificationTemplate(type: NotificationType): NotificationTemplate | null;
}

/**
 * Реализация сервиса уведомлений
 */
export class NotificationService extends BaseService implements INotificationService {
  constructor(
    env: Env,
    private notificationRepository: INotificationRepository
  ) {
    const config: ServiceConfig = {
      name: 'NotificationService',
      version: '1.0.0',
      description: 'Service for managing automatic notifications',
      dependencies: ['NotificationRepository'],
      healthCheckInterval: 120000 // 2 minutes
    };
    super(env, config);
  }

  /**
   * Получить настройки уведомлений для чата
   */
  async getChatSettings(chatId: string): Promise<ChatNotificationSettings | null> {
    try {
      const settings = await this.notificationRepository.getChatSettings(chatId);
      return settings || null;
    } catch (error: unknown) {
      this.log('error', 'Failed to get chat notification settings', {
        chatId,
        error: error.message || String(error)
      });
      return null;
    }
  }

  /**
   * Обновить настройки уведомлений для чата
   */
  async updateChatSettings(
    chatId: string, 
    updates: Partial<ChatNotificationSettings>, 
    updatedBy: string
  ): Promise<ChatNotificationSettings> {
    try {
      // Получаем текущие настройки или создаем новые
      let currentSettings = await this.notificationRepository.getChatSettings(chatId);
      
      if (!currentSettings) {
        currentSettings = NotificationValidationUtils.createDefaultChatSettings(chatId, updatedBy);
      }

      // Применяем обновления
      const updatedSettings: ChatNotificationSettings = {
        ...currentSettings,
        ...updates,
        chatId, // Убеждаемся, что chatId не изменился
        updatedAt: new Date(),
        updatedBy
      };

      // Сохраняем обновленные настройки
      await this.notificationRepository.saveChatSettings(updatedSettings);

      this.log('debug', 'Updated chat notification settings', {
        chatId,
        updatedBy,
        enabled: updatedSettings.enabled
      });

      return updatedSettings;

    } catch (error: unknown) {
      this.log('error', 'Failed to update chat notification settings', {
        chatId,
        updatedBy,
        error: error.message || String(error)
      });
      throw new Error(`Failed to update notification settings: ${error.message}`);
    }
  }

  /**
   * Сбросить настройки уведомлений к значениям по умолчанию
   */
  async resetChatSettings(chatId: string, updatedBy: string): Promise<ChatNotificationSettings> {
    try {
      const defaultSettings = NotificationValidationUtils.createDefaultChatSettings(chatId, updatedBy);
      await this.notificationRepository.saveChatSettings(defaultSettings);

      this.log('debug', 'Reset chat notification settings to defaults', {
        chatId,
        updatedBy
      });

      return defaultSettings;

    } catch (error: unknown) {
      this.log('error', 'Failed to reset chat notification settings', {
        chatId,
        updatedBy,
        error: error.message || String(error)
      });
      throw new Error(`Failed to reset notification settings: ${error.message}`);
    }
  }

  /**
   * Включить уведомление определенного типа
   */
  async enableNotification(chatId: string, type: NotificationType, updatedBy: string): Promise<void> {
    try {
      const settings = await this.getChatSettings(chatId) || 
        NotificationValidationUtils.createDefaultChatSettings(chatId, updatedBy);

      settings.notifications[type].enabled = true;
      settings.updatedAt = new Date();
      settings.updatedBy = updatedBy;

      await this.notificationRepository.saveChatSettings(settings);

      this.log('debug', 'Enabled notification type', {
        chatId,
        type,
        updatedBy
      });

    } catch (error: unknown) {
      this.log('error', 'Failed to enable notification', {
        chatId,
        type,
        updatedBy,
        error: error.message || String(error)
      });
      throw new Error(`Failed to enable notification: ${error.message}`);
    }
  }

  /**
   * Отключить уведомление определенного типа
   */
  async disableNotification(chatId: string, type: NotificationType, updatedBy: string): Promise<void> {
    try {
      const settings = await this.getChatSettings(chatId);
      
      if (!settings) {
        // Если настроек нет, создаем их с отключенным уведомлением
        const defaultSettings = NotificationValidationUtils.createDefaultChatSettings(chatId, updatedBy);
        defaultSettings.notifications[type].enabled = false;
        await this.notificationRepository.saveChatSettings(defaultSettings);
        return;
      }

      settings.notifications[type].enabled = false;
      settings.updatedAt = new Date();
      settings.updatedBy = updatedBy;

      await this.notificationRepository.saveChatSettings(settings);

      this.log('debug', 'Disabled notification type', {
        chatId,
        type,
        updatedBy
      });

    } catch (error: unknown) {
      this.log('error', 'Failed to disable notification', {
        chatId,
        type,
        updatedBy,
        error: error.message || String(error)
      });
      throw new Error(`Failed to disable notification: ${error.message}`);
    }
  }

  /**
   * Обновить настройки конкретного типа уведомлений
   */
  async updateNotificationSettings(
    chatId: string, 
    type: NotificationType, 
    settingsUpdate: Partial<NotificationTypeSettings>, 
    updatedBy: string
  ): Promise<void> {
    try {
      const chatSettings = await this.getChatSettings(chatId) || 
        NotificationValidationUtils.createDefaultChatSettings(chatId, updatedBy);

      // Обновляем настройки конкретного типа
      chatSettings.notifications[type] = {
        ...chatSettings.notifications[type],
        ...settingsUpdate
      };

      chatSettings.updatedAt = new Date();
      chatSettings.updatedBy = updatedBy;

      await this.notificationRepository.saveChatSettings(chatSettings);

      this.log('debug', 'Updated notification type settings', {
        chatId,
        type,
        updatedBy,
        enabled: chatSettings.notifications[type].enabled,
        frequency: chatSettings.notifications[type].frequency
      });

    } catch (error: unknown) {
      this.log('error', 'Failed to update notification type settings', {
        chatId,
        type,
        updatedBy,
        error: error.message || String(error)
      });
      throw new Error(`Failed to update notification type settings: ${error.message}`);
    }
  }

  /**
   * Запланировать уведомление
   */
  async scheduleNotification(chatId: string, type: NotificationType, data?: any): Promise<string> {
    try {
      const settings = await this.getChatSettings(chatId);
      
      if (!settings || !settings.enabled || !settings.notifications[type].enabled) {
        throw new Error('Notifications are disabled for this chat or type');
      }

      const typeSettings = settings.notifications[type];
      const scheduledAt = NotificationValidationUtils.calculateNextScheduledTime(
        typeSettings.frequency,
        typeSettings.time
      );

      // Проверяем тихие часы
      if (NotificationValidationUtils.isInQuietHours(scheduledAt, settings.quietHours)) {
        // Переносим на время после тихих часов
        const adjustedTime = this.adjustForQuietHours(scheduledAt, settings.quietHours!);
        scheduledAt.setTime(adjustedTime.getTime());
      }

      const notification: ScheduledNotification = {
        id: NotificationValidationUtils.generateNotificationId(chatId, type, scheduledAt),
        chatId,
        notificationType: type,
        scheduledAt,
        createdAt: new Date(),
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
        payload: data
      };

      await this.notificationRepository.saveScheduledNotification(notification);

      this.log('debug', 'Scheduled notification', {
        id: notification.id,
        chatId,
        type,
        scheduledAt: scheduledAt.toISOString()
      });

      return notification.id;

    } catch (error: unknown) {
      this.log('error', 'Failed to schedule notification', {
        chatId,
        type,
        error: error.message || String(error)
      });
      throw new Error(`Failed to schedule notification: ${error.message}`);
    }
  }

  /**
   * Отправить уведомление
   */
  async sendNotification(context: NotificationContext): Promise<NotificationResult> {
    const startTime = Date.now();
    
    try {
      const template = this.getNotificationTemplate(context.notificationType);
      
      if (!template) {
        throw new Error(`Template not found for notification type: ${context.notificationType}`);
      }

      // Генерируем сообщение из шаблона
      const message = this.generateMessageFromTemplate(template, context);

      // Отправляем сообщение
      const messageId = await sendMessage(this.env, parseInt(context.chatId), message);

      const result: NotificationResult = {
        success: true,
        messageId: messageId?.toString(),
        sentAt: new Date(),
        responseTime: Date.now() - startTime,
        retryAttempt: 0
      };

      // Записываем результат в статистику
      await this.notificationRepository.recordNotificationResult(
        context.chatId,
        context.notificationType,
        result
      );

      this.log('debug', 'Notification sent successfully', {
        chatId: context.chatId,
        type: context.notificationType,
        messageId: result.messageId,
        responseTime: result.responseTime
      });

      return result;

    } catch (error: unknown) {
      const result: NotificationResult = {
        success: false,
        error: error.message || String(error),
        sentAt: new Date(),
        responseTime: Date.now() - startTime,
        retryAttempt: 0
      };

      // Записываем результат в статистику
      await this.notificationRepository.recordNotificationResult(
        context.chatId,
        context.notificationType,
        result
      );

      this.log('error', 'Failed to send notification', {
        chatId: context.chatId,
        type: context.notificationType,
        error: error.message || String(error),
        responseTime: result.responseTime
      });

      return result;
    }
  }

  /**
   * Обработать запланированные уведомления
   */
  async processScheduledNotifications(): Promise<number> {
    try {
      const now = new Date();
      const pendingNotifications = await this.notificationRepository.getScheduledNotifications(undefined, 'pending');
      
      let processedCount = 0;

      for (const notification of pendingNotifications) {
        // Проверяем, пришло ли время отправки
        if (notification.scheduledAt <= now) {
          try {
            await this.processScheduledNotification(notification);
            processedCount++;
          } catch (error: unknown) {
            this.log('error', 'Failed to process scheduled notification', {
              id: notification.id,
              chatId: notification.chatId,
              type: notification.notificationType,
              error: error.message || String(error)
            });
          }
        }
      }

      if (processedCount > 0) {
        this.log('debug', 'Processed scheduled notifications', {
          processedCount,
          totalPending: pendingNotifications.length
        });
      }

      return processedCount;

    } catch (error: unknown) {
      this.log('error', 'Failed to process scheduled notifications', {
        error: error.message || String(error)
      });
      return 0;
    }
  }

  /**
   * Получить статистику уведомлений
   */
  async getNotificationStats(chatId: string, type: NotificationType): Promise<NotificationStats> {
    try {
      const stats = await this.notificationRepository.getNotificationStats(chatId, type);
      
      if (!stats) {
        return NotificationDataSanitizer.createEmptyNotificationStats(chatId, type);
      }

      return stats;

    } catch (error: unknown) {
      this.log('error', 'Failed to get notification stats', {
        chatId,
        type,
        error: error.message || String(error)
      });
      return NotificationDataSanitizer.createEmptyNotificationStats(chatId, type);
    }
  }

  /**
   * Проверить, может ли пользователь изменять настройки
   */
  async canUserModifySettings(userId: string, chatId: string): Promise<boolean> {
    try {
      const settings = await this.getChatSettings(chatId);
      
      if (!settings) {
        return true; // Если настроек нет, любой может создать их
      }

      return NotificationValidationUtils.canUserModifySettings(userId, settings);

    } catch (error: unknown) {
      this.log('error', 'Failed to check user permissions', {
        userId,
        chatId,
        error: error.message || String(error)
      });
      return false; // В случае ошибки запрещаем изменения
    }
  }

  /**
   * Получить список доступных типов уведомлений
   */
  getAvailableNotificationTypes(): NotificationType[] {
    return [
      'criminal_reports',
      'profanity_reports',
      'activity_summary',
      'daily_summary',
      'weekly_summary',
      'monthly_summary'
    ];
  }

  /**
   * Получить шаблон уведомления
   */
  getNotificationTemplate(type: NotificationType): NotificationTemplate | null {
    return DEFAULT_NOTIFICATION_TEMPLATES.find(template => template.type === type) || null;
  }

  /**
   * Обработать конкретное запланированное уведомление
   */
  private async processScheduledNotification(notification: ScheduledNotification): Promise<void> {
    try {
      // Получаем настройки чата
      const settings = await this.getChatSettings(notification.chatId);
      
      if (!settings || !settings.enabled || !settings.notifications[notification.notificationType].enabled) {
        // Уведомления отключены, отменяем
        await this.notificationRepository.updateScheduledNotification(notification.id, {
          status: 'cancelled',
          lastAttemptAt: new Date(),
          errorMessage: 'Notifications disabled'
        });
        return;
      }

      // Получаем данные для уведомления
      const data = await this.collectNotificationData(notification);
      
      // Создаем контекст для отправки
      const context: NotificationContext = {
        chatId: notification.chatId,
        notificationType: notification.notificationType,
        period: this.calculatePeriod(notification.notificationType),
        data,
        settings: settings.notifications[notification.notificationType],
        template: this.getNotificationTemplate(notification.notificationType)!
      };

      // Отправляем уведомление
      const result = await this.sendNotification(context);

      if (result.success) {
        // Успешно отправлено
        await this.notificationRepository.updateScheduledNotification(notification.id, {
          status: 'sent',
          lastAttemptAt: new Date()
        });

        // Планируем следующее уведомление для повторяющихся типов
        if (settings.notifications[notification.notificationType].frequency !== 'instant') {
          await this.scheduleNotification(notification.chatId, notification.notificationType, notification.payload);
        }
      } else {
        // Ошибка отправки
        const newRetryCount = notification.retryCount + 1;
        
        if (newRetryCount >= notification.maxRetries) {
          // Превышено максимальное количество попыток
          await this.notificationRepository.updateScheduledNotification(notification.id, {
            status: 'failed',
            lastAttemptAt: new Date(),
            retryCount: newRetryCount,
            errorMessage: result.error
          });
        } else {
          // Планируем повтор через 1 час
          const nextAttempt = new Date();
          nextAttempt.setHours(nextAttempt.getHours() + 1);
          
          await this.notificationRepository.updateScheduledNotification(notification.id, {
            scheduledAt: nextAttempt,
            lastAttemptAt: new Date(),
            retryCount: newRetryCount,
            errorMessage: result.error
          });
        }
      }

    } catch (error: unknown) {
      this.log('error', 'Failed to process scheduled notification', {
        id: notification.id,
        chatId: notification.chatId,
        type: notification.notificationType,
        error: error.message || String(error)
      });

      // Обновляем статус на failed
      await this.notificationRepository.updateScheduledNotification(notification.id, {
        status: 'failed',
        lastAttemptAt: new Date(),
        retryCount: notification.retryCount + 1,
        errorMessage: error.message || String(error)
      });
    }
  }

  /**
   * Собрать данные для уведомления
   */
  private async collectNotificationData(notification: ScheduledNotification): Promise<any> {
    // TODO: Реализовать сбор данных в зависимости от типа уведомления
    // Здесь будет интеграция с существующими сервисами статистики
    
    switch (notification.notificationType) {
      case 'criminal_reports':
        // Собираем данные о криминальных нарушениях
        return { placeholder: 'criminal_data' };
      
      case 'profanity_reports':
        // Собираем данные о мате
        return { placeholder: 'profanity_data' };
      
      case 'activity_summary':
      case 'daily_summary':
      case 'weekly_summary':
      case 'monthly_summary':
        // Собираем данные об активности
        return { placeholder: 'activity_data' };
      
      default:
        return {};
    }
  }

  /**
   * Вычислить период для уведомления
   */
  private calculatePeriod(type: NotificationType): { start: Date; end: Date } {
    const end = new Date();
    const start = new Date();

    switch (type) {
      case 'daily_summary':
        start.setDate(start.getDate() - 1);
        break;
      case 'weekly_summary':
        start.setDate(start.getDate() - 7);
        break;
      case 'monthly_summary':
        start.setMonth(start.getMonth() - 1);
        break;
      default:
        start.setDate(start.getDate() - 1);
    }

    return { start, end };
  }

  /**
   * Скорректировать время с учетом тихих часов
   */
  private adjustForQuietHours(scheduledTime: Date, quietHours: NonNullable<ChatNotificationSettings['quietHours']>): Date {
    const adjusted = new Date(scheduledTime);
    
    // Если время попадает в тихие часы, переносим на время окончания тихих часов
    if (NotificationValidationUtils.isInQuietHours(scheduledTime, quietHours)) {
      adjusted.setHours(quietHours.endTime.hour, quietHours.endTime.minute, 0, 0);
      
      // Если это уже прошло сегодня, переносим на завтра
      if (adjusted <= new Date()) {
        adjusted.setDate(adjusted.getDate() + 1);
      }
    }

    return adjusted;
  }

  /**
   * Генерировать сообщение из шаблона
   */
  private generateMessageFromTemplate(template: NotificationTemplate, context: NotificationContext): string {
    // TODO: Реализовать полноценный шаблонизатор
    // Пока возвращаем простую заглушку
    
    let message = template.template;
    
    // Простая замена переменных
    message = message.replace(/\{\{timestamp\}\}/g, new Date().toLocaleString('ru-RU'));
    message = message.replace(/\{\{chatId\}\}/g, context.chatId);
    
    return message;
  }

  /**
   * Service initialization
   */
  protected async onInitialize(): Promise<void> {
    this.log('info', 'Initializing NotificationService');
    
    // Verify repository connection
    if (!this.notificationRepository) {
      throw this.createError('MISSING_DEPENDENCY', 'NotificationRepository is required');
    }

    // Validate notification templates
    const availableTypes = this.getAvailableNotificationTypes();
    for (const type of availableTypes) {
      const template = this.getNotificationTemplate(type);
      if (!template) {
        this.log('warn', `No template found for notification type: ${type}`);
      }
    }
  }

  /**
   * Service shutdown
   */
  protected async onShutdown(): Promise<void> {
    this.log('info', 'Shutting down NotificationService');
    // Cancel any pending scheduled notifications processing
    // This would be implemented if we had background processing
  }

  /**
   * Health check implementation
   */
  protected async onHealthCheck(): Promise<boolean> {
    try {
      // Test repository connectivity
      if (!this.notificationRepository) {
        return false;
      }

      // Test basic functionality by checking if we can get available types
      const types = this.getAvailableNotificationTypes();
      return types.length > 0;
    } catch (error: unknown) {
      this.log('error', 'Health check failed', { error });
      return false;
    }
  }

  /**
   * Configuration validation
   */
  protected async onValidateConfig(): Promise<boolean> {
    try {
      // Validate that we have required dependencies
      if (!this.notificationRepository) {
        return false;
      }

      // Validate that we have notification templates
      const availableTypes = this.getAvailableNotificationTypes();
      if (availableTypes.length === 0) {
        return false;
      }

      // Validate that templates exist for all types
      for (const type of availableTypes) {
        const template = this.getNotificationTemplate(type);
        if (!template) {
          this.log('warn', `Missing template for notification type: ${type}`);
        }
      }

      return true;
    } catch (error: unknown) {
      this.log('error', 'Configuration validation failed', { error });
      return false;
    }
  }
}