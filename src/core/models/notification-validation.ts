/**
 * Валидация моделей данных для настроек автоматических уведомлений
 */

import {
  NotificationType,
  NotificationFrequency,
  NotificationTime,
  NotificationTypeSettings,
  ChatNotificationSettings,
  NotificationStats,
  ScheduledNotification,
  NotificationTemplate,
  NotificationContext,
  NotificationResult,
  DEFAULT_NOTIFICATION_SETTINGS
} from './notification-settings';

/**
 * Ошибка валидации уведомлений
 */
export class NotificationValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'NotificationValidationError';
  }
}

/**
 * Валидация типа уведомления
 */
export function validateNotificationType(type: any): type is NotificationType {
  const validTypes: NotificationType[] = [
    'criminal_reports',
    'profanity_reports',
    'activity_summary',
    'daily_summary',
    'weekly_summary',
    'monthly_summary'
  ];
  
  return typeof type === 'string' && validTypes.includes(type as NotificationType);
}

/**
 * Валидация частоты уведомлений
 */
export function validateNotificationFrequency(frequency: any): frequency is NotificationFrequency {
  const validFrequencies: NotificationFrequency[] = ['daily', 'weekly', 'monthly', 'instant'];
  return typeof frequency === 'string' && validFrequencies.includes(frequency as NotificationFrequency);
}

/**
 * Валидация времени уведомления
 */
export function validateNotificationTime(time: any): time is NotificationTime {
  if (!time || typeof time !== 'object') {
    throw new NotificationValidationError('NotificationTime must be an object');
  }

  if (typeof time.hour !== 'number' || time.hour < 0 || time.hour > 23) {
    throw new NotificationValidationError('Hour must be a number between 0 and 23', 'hour');
  }

  if (typeof time.minute !== 'number' || time.minute < 0 || time.minute > 59) {
    throw new NotificationValidationError('Minute must be a number between 0 and 59', 'minute');
  }

  if (time.timezone !== undefined && typeof time.timezone !== 'string') {
    throw new NotificationValidationError('Timezone must be a string or undefined', 'timezone');
  }

  return true;
}

/**
 * Валидация настроек типа уведомления
 */
export function validateNotificationTypeSettings(settings: any): settings is NotificationTypeSettings {
  if (!settings || typeof settings !== 'object') {
    throw new NotificationValidationError('NotificationTypeSettings must be an object');
  }

  if (typeof settings.enabled !== 'boolean') {
    throw new NotificationValidationError('enabled must be a boolean', 'enabled');
  }

  if (!validateNotificationFrequency(settings.frequency)) {
    throw new NotificationValidationError('frequency must be a valid NotificationFrequency', 'frequency');
  }

  if (settings.time !== undefined) {
    try {
      validateNotificationTime(settings.time);
    } catch (error) {
      throw new NotificationValidationError(`Invalid time: ${error.message}`, 'time');
    }
  }

  if (settings.threshold !== undefined && (typeof settings.threshold !== 'number' || settings.threshold < 0)) {
    throw new NotificationValidationError('threshold must be a non-negative number or undefined', 'threshold');
  }

  if (typeof settings.includeDetails !== 'boolean') {
    throw new NotificationValidationError('includeDetails must be a boolean', 'includeDetails');
  }

  if (typeof settings.maxItemsInReport !== 'number' || settings.maxItemsInReport < 1 || settings.maxItemsInReport > 100) {
    throw new NotificationValidationError('maxItemsInReport must be a number between 1 and 100', 'maxItemsInReport');
  }

  return true;
}

/**
 * Валидация настроек уведомлений чата
 */
export function validateChatNotificationSettings(settings: any): settings is ChatNotificationSettings {
  if (!settings || typeof settings !== 'object') {
    throw new NotificationValidationError('ChatNotificationSettings must be an object');
  }

  if (!settings.chatId || typeof settings.chatId !== 'string') {
    throw new NotificationValidationError('chatId must be a non-empty string', 'chatId');
  }

  if (typeof settings.enabled !== 'boolean') {
    throw new NotificationValidationError('enabled must be a boolean', 'enabled');
  }

  if (!(settings.createdAt instanceof Date)) {
    throw new NotificationValidationError('createdAt must be a Date', 'createdAt');
  }

  if (!(settings.updatedAt instanceof Date)) {
    throw new NotificationValidationError('updatedAt must be a Date', 'updatedAt');
  }

  if (!settings.updatedBy || typeof settings.updatedBy !== 'string') {
    throw new NotificationValidationError('updatedBy must be a non-empty string', 'updatedBy');
  }

  if (settings.updatedByName !== undefined && typeof settings.updatedByName !== 'string') {
    throw new NotificationValidationError('updatedByName must be a string or undefined', 'updatedByName');
  }

  if (!settings.notifications || typeof settings.notifications !== 'object') {
    throw new NotificationValidationError('notifications must be an object', 'notifications');
  }

  // Валидируем каждый тип уведомления
  const requiredTypes: NotificationType[] = [
    'criminal_reports',
    'profanity_reports',
    'activity_summary',
    'daily_summary',
    'weekly_summary',
    'monthly_summary'
  ];

  for (const type of requiredTypes) {
    if (!settings.notifications[type]) {
      throw new NotificationValidationError(`Missing notification settings for type: ${type}`, 'notifications');
    }

    try {
      validateNotificationTypeSettings(settings.notifications[type]);
    } catch (error) {
      throw new NotificationValidationError(`Invalid settings for ${type}: ${error.message}`, 'notifications');
    }
  }

  // Валидируем тихие часы
  if (settings.quietHours !== undefined) {
    if (typeof settings.quietHours !== 'object') {
      throw new NotificationValidationError('quietHours must be an object or undefined', 'quietHours');
    }

    if (typeof settings.quietHours.enabled !== 'boolean') {
      throw new NotificationValidationError('quietHours.enabled must be a boolean', 'quietHours.enabled');
    }

    try {
      validateNotificationTime(settings.quietHours.startTime);
      validateNotificationTime(settings.quietHours.endTime);
    } catch (error) {
      throw new NotificationValidationError(`Invalid quietHours time: ${error.message}`, 'quietHours');
    }
  }

  if (typeof settings.adminOnly !== 'boolean') {
    throw new NotificationValidationError('adminOnly must be a boolean', 'adminOnly');
  }

  if (settings.allowedUsers !== undefined) {
    if (!Array.isArray(settings.allowedUsers)) {
      throw new NotificationValidationError('allowedUsers must be an array or undefined', 'allowedUsers');
    }

    for (const userId of settings.allowedUsers) {
      if (typeof userId !== 'string') {
        throw new NotificationValidationError('All allowedUsers must be strings', 'allowedUsers');
      }
    }
  }

  return true;
}

/**
 * Валидация статистики уведомлений
 */
export function validateNotificationStats(stats: any): stats is NotificationStats {
  if (!stats || typeof stats !== 'object') {
    throw new NotificationValidationError('NotificationStats must be an object');
  }

  if (!stats.chatId || typeof stats.chatId !== 'string') {
    throw new NotificationValidationError('chatId must be a non-empty string', 'chatId');
  }

  if (!validateNotificationType(stats.notificationType)) {
    throw new NotificationValidationError('notificationType must be a valid NotificationType', 'notificationType');
  }

  if (typeof stats.totalSent !== 'number' || stats.totalSent < 0) {
    throw new NotificationValidationError('totalSent must be a non-negative number', 'totalSent');
  }

  if (stats.lastSentAt !== undefined && !(stats.lastSentAt instanceof Date)) {
    throw new NotificationValidationError('lastSentAt must be a Date or undefined', 'lastSentAt');
  }

  if (typeof stats.successRate !== 'number' || stats.successRate < 0 || stats.successRate > 1) {
    throw new NotificationValidationError('successRate must be a number between 0 and 1', 'successRate');
  }

  if (typeof stats.averageResponseTime !== 'number' || stats.averageResponseTime < 0) {
    throw new NotificationValidationError('averageResponseTime must be a non-negative number', 'averageResponseTime');
  }

  if (typeof stats.failureCount !== 'number' || stats.failureCount < 0) {
    throw new NotificationValidationError('failureCount must be a non-negative number', 'failureCount');
  }

  if (stats.lastFailureReason !== undefined && typeof stats.lastFailureReason !== 'string') {
    throw new NotificationValidationError('lastFailureReason must be a string or undefined', 'lastFailureReason');
  }

  return true;
}

/**
 * Валидация запланированного уведомления
 */
export function validateScheduledNotification(notification: any): notification is ScheduledNotification {
  if (!notification || typeof notification !== 'object') {
    throw new NotificationValidationError('ScheduledNotification must be an object');
  }

  if (!notification.id || typeof notification.id !== 'string') {
    throw new NotificationValidationError('id must be a non-empty string', 'id');
  }

  if (!notification.chatId || typeof notification.chatId !== 'string') {
    throw new NotificationValidationError('chatId must be a non-empty string', 'chatId');
  }

  if (!validateNotificationType(notification.notificationType)) {
    throw new NotificationValidationError('notificationType must be a valid NotificationType', 'notificationType');
  }

  if (!(notification.scheduledAt instanceof Date)) {
    throw new NotificationValidationError('scheduledAt must be a Date', 'scheduledAt');
  }

  if (!(notification.createdAt instanceof Date)) {
    throw new NotificationValidationError('createdAt must be a Date', 'createdAt');
  }

  const validStatuses = ['pending', 'sent', 'failed', 'cancelled'];
  if (!validStatuses.includes(notification.status)) {
    throw new NotificationValidationError('status must be one of: pending, sent, failed, cancelled', 'status');
  }

  if (typeof notification.retryCount !== 'number' || notification.retryCount < 0) {
    throw new NotificationValidationError('retryCount must be a non-negative number', 'retryCount');
  }

  if (typeof notification.maxRetries !== 'number' || notification.maxRetries < 0) {
    throw new NotificationValidationError('maxRetries must be a non-negative number', 'maxRetries');
  }

  if (notification.lastAttemptAt !== undefined && !(notification.lastAttemptAt instanceof Date)) {
    throw new NotificationValidationError('lastAttemptAt must be a Date or undefined', 'lastAttemptAt');
  }

  if (notification.errorMessage !== undefined && typeof notification.errorMessage !== 'string') {
    throw new NotificationValidationError('errorMessage must be a string or undefined', 'errorMessage');
  }

  return true;
}

/**
 * Валидация шаблона уведомления
 */
export function validateNotificationTemplate(template: any): template is NotificationTemplate {
  if (!template || typeof template !== 'object') {
    throw new NotificationValidationError('NotificationTemplate must be an object');
  }

  if (!validateNotificationType(template.type)) {
    throw new NotificationValidationError('type must be a valid NotificationType', 'type');
  }

  if (!template.title || typeof template.title !== 'string') {
    throw new NotificationValidationError('title must be a non-empty string', 'title');
  }

  if (!template.template || typeof template.template !== 'string') {
    throw new NotificationValidationError('template must be a non-empty string', 'template');
  }

  if (!Array.isArray(template.variables)) {
    throw new NotificationValidationError('variables must be an array', 'variables');
  }

  for (const variable of template.variables) {
    if (typeof variable !== 'string') {
      throw new NotificationValidationError('All variables must be strings', 'variables');
    }
  }

  if (!template.description || typeof template.description !== 'string') {
    throw new NotificationValidationError('description must be a non-empty string', 'description');
  }

  if (typeof template.defaultEnabled !== 'boolean') {
    throw new NotificationValidationError('defaultEnabled must be a boolean', 'defaultEnabled');
  }

  if (!validateNotificationFrequency(template.defaultFrequency)) {
    throw new NotificationValidationError('defaultFrequency must be a valid NotificationFrequency', 'defaultFrequency');
  }

  if (template.defaultTime !== undefined) {
    try {
      validateNotificationTime(template.defaultTime);
    } catch (error) {
      throw new NotificationValidationError(`Invalid defaultTime: ${error.message}`, 'defaultTime');
    }
  }

  if (template.minThreshold !== undefined && (typeof template.minThreshold !== 'number' || template.minThreshold < 0)) {
    throw new NotificationValidationError('minThreshold must be a non-negative number or undefined', 'minThreshold');
  }

  if (template.maxThreshold !== undefined && (typeof template.maxThreshold !== 'number' || template.maxThreshold < 0)) {
    throw new NotificationValidationError('maxThreshold must be a non-negative number or undefined', 'maxThreshold');
  }

  return true;
}

/**
 * Утилитарные функции для валидации и санитизации данных уведомлений
 */
export const NotificationValidationUtils = {
  /**
   * Проверяет, является ли тип уведомления валидным
   */
  isValidNotificationType(type: string): type is NotificationType {
    return validateNotificationType(type);
  },

  /**
   * Проверяет, является ли частота уведомлений валидной
   */
  isValidNotificationFrequency(frequency: string): frequency is NotificationFrequency {
    return validateNotificationFrequency(frequency);
  },

  /**
   * Проверяет, находится ли время в тихих часах
   */
  isInQuietHours(time: Date, quietHours?: ChatNotificationSettings['quietHours']): boolean {
    if (!quietHours || !quietHours.enabled) {
      return false;
    }

    const currentHour = time.getHours();
    const currentMinute = time.getMinutes();
    const currentTimeInMinutes = currentHour * 60 + currentMinute;

    const startTimeInMinutes = quietHours.startTime.hour * 60 + quietHours.startTime.minute;
    const endTimeInMinutes = quietHours.endTime.hour * 60 + quietHours.endTime.minute;

    // Обработка случая, когда тихие часы переходят через полночь
    if (startTimeInMinutes > endTimeInMinutes) {
      return currentTimeInMinutes >= startTimeInMinutes || currentTimeInMinutes <= endTimeInMinutes;
    } else {
      return currentTimeInMinutes >= startTimeInMinutes && currentTimeInMinutes <= endTimeInMinutes;
    }
  },

  /**
   * Вычисляет следующее время отправки уведомления
   */
  calculateNextScheduledTime(frequency: NotificationFrequency, time?: NotificationTime): Date {
    const now = new Date();
    const nextTime = new Date();

    if (frequency === 'instant') {
      return now;
    }

    if (time) {
      nextTime.setHours(time.hour, time.minute, 0, 0);
    } else {
      nextTime.setHours(9, 0, 0, 0); // По умолчанию 9:00
    }

    switch (frequency) {
      case 'daily':
        if (nextTime <= now) {
          nextTime.setDate(nextTime.getDate() + 1);
        }
        break;
      case 'weekly':
        // Отправляем в понедельник
        const daysUntilMonday = (1 - nextTime.getDay() + 7) % 7;
        if (daysUntilMonday === 0 && nextTime <= now) {
          nextTime.setDate(nextTime.getDate() + 7);
        } else {
          nextTime.setDate(nextTime.getDate() + daysUntilMonday);
        }
        break;
      case 'monthly':
        // Отправляем 1 числа каждого месяца
        nextTime.setDate(1);
        if (nextTime <= now) {
          nextTime.setMonth(nextTime.getMonth() + 1);
        }
        break;
    }

    return nextTime;
  },

  /**
   * Санитизирует настройки уведомлений
   */
  sanitizeNotificationTypeSettings(settings: any): NotificationTypeSettings {
    if (!settings || typeof settings !== 'object') {
      return {
        enabled: false,
        frequency: 'daily',
        includeDetails: true,
        maxItemsInReport: 10
      };
    }

    const sanitized: NotificationTypeSettings = {
      enabled: Boolean(settings.enabled),
      frequency: this.isValidNotificationFrequency(settings.frequency) ? settings.frequency : 'daily',
      includeDetails: Boolean(settings.includeDetails),
      maxItemsInReport: Math.max(1, Math.min(100, parseInt(settings.maxItemsInReport) || 10))
    };

    if (settings.time && typeof settings.time === 'object') {
      const hour = Math.max(0, Math.min(23, parseInt(settings.time.hour) || 9));
      const minute = Math.max(0, Math.min(59, parseInt(settings.time.minute) || 0));
      sanitized.time = { hour, minute };
      
      if (settings.time.timezone && typeof settings.time.timezone === 'string') {
        sanitized.time.timezone = settings.time.timezone;
      }
    }

    if (settings.threshold !== undefined) {
      const threshold = parseInt(settings.threshold);
      if (!isNaN(threshold) && threshold >= 0) {
        sanitized.threshold = threshold;
      }
    }

    return sanitized;
  },

  /**
   * Создает настройки уведомлений по умолчанию для чата
   *
   * Возвращает глубокую копию структуры `notifications` (включая вложенные
   * объекты `time`), чтобы возвращаемые настройки не разделяли ссылки с
   * module-level константой `DEFAULT_NOTIFICATION_SETTINGS`. Иначе мутации,
   * выполняемые сервисом (enable/disable) и санитизатором на каждом чтении
   * сохранённых настроек чата, записывались бы через общую ссылку в глобальный
   * дефолт и загрязняли настройки последующих чатов в том же isolate.
   */
  createDefaultChatSettings(chatId: string, updatedBy: string): ChatNotificationSettings {
    const base = DEFAULT_NOTIFICATION_SETTINGS;
    const notifications = {} as ChatNotificationSettings['notifications'];
    for (const key of Object.keys(base.notifications) as NotificationType[]) {
      const source = base.notifications[key];
      const copy: NotificationTypeSettings = { ...source };
      if (source.time) {
        copy.time = { ...source.time };
      }
      notifications[key] = copy;
    }
    return {
      ...base,
      notifications,
      chatId,
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy
    };
  },

  /**
   * Проверяет, может ли пользователь изменять настройки
   */
  canUserModifySettings(userId: string, settings: ChatNotificationSettings): boolean {
    // Если adminOnly отключен, любой может изменять настройки
    if (!settings.adminOnly) {
      return true;
    }

    // Проверяем список разрешенных пользователей
    if (settings.allowedUsers && settings.allowedUsers.includes(userId)) {
      return true;
    }

    // В личных чатах (положительный chatId) пользователь всегда может изменять настройки
    const chatIdNum = parseInt(settings.chatId);
    if (chatIdNum > 0) {
      return true;
    }

    // В групповых чатах (отрицательный chatId) пока разрешаем всем
    // TODO: Добавить реальную проверку на администратора чата через Telegram API
    // Для этого нужно будет делать запрос к getChatMember API
    return true;
  },

  /**
   * Генерирует уникальный ID для запланированного уведомления
   */
  generateNotificationId(chatId: string, type: NotificationType, scheduledAt: Date): string {
    const timestamp = scheduledAt.getTime();
    const hash = this.simpleHash(`${chatId}-${type}-${timestamp}`);
    return `${type}-${chatId}-${timestamp}-${hash}`;
  },

  /**
   * Простая хеш-функция для генерации ID
   */
  simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Конвертируем в 32-битное целое
    }
    return Math.abs(hash).toString(36);
  }
};

/**
 * Функции для санитизации и восстановления данных уведомлений
 */
export const NotificationDataSanitizer = {
  /**
   * Санитизирует настройки чата, восстанавливая поврежденные данные
   */
  sanitizeChatNotificationSettings(settings: any, chatId: string, updatedBy: string): ChatNotificationSettings {
    if (!settings || typeof settings !== 'object') {
      return NotificationValidationUtils.createDefaultChatSettings(chatId, updatedBy);
    }

    const sanitized = NotificationValidationUtils.createDefaultChatSettings(chatId, updatedBy);

    // Копируем валидные поля
    if (typeof settings.enabled === 'boolean') {
      sanitized.enabled = settings.enabled;
    }

    if (settings.createdAt instanceof Date) {
      sanitized.createdAt = settings.createdAt;
    }

    if (settings.updatedAt instanceof Date) {
      sanitized.updatedAt = settings.updatedAt;
    } else {
      sanitized.updatedAt = new Date();
    }

    if (typeof settings.updatedBy === 'string' && settings.updatedBy.trim()) {
      sanitized.updatedBy = settings.updatedBy.trim();
    }

    if (typeof settings.updatedByName === 'string' && settings.updatedByName.trim()) {
      sanitized.updatedByName = settings.updatedByName.trim();
    }

    // Санитизируем настройки уведомлений
    if (settings.notifications && typeof settings.notifications === 'object') {
      for (const type of Object.keys(sanitized.notifications) as NotificationType[]) {
        if (settings.notifications[type]) {
          sanitized.notifications[type] = NotificationValidationUtils.sanitizeNotificationTypeSettings(
            settings.notifications[type]
          );
        }
      }
    }

    // Санитизируем тихие часы
    if (settings.quietHours && typeof settings.quietHours === 'object') {
      sanitized.quietHours = {
        enabled: Boolean(settings.quietHours.enabled),
        startTime: {
          hour: Math.max(0, Math.min(23, parseInt(settings.quietHours.startTime?.hour) || 22)),
          minute: Math.max(0, Math.min(59, parseInt(settings.quietHours.startTime?.minute) || 0))
        },
        endTime: {
          hour: Math.max(0, Math.min(23, parseInt(settings.quietHours.endTime?.hour) || 8)),
          minute: Math.max(0, Math.min(59, parseInt(settings.quietHours.endTime?.minute) || 0))
        }
      };
    }

    if (typeof settings.adminOnly === 'boolean') {
      sanitized.adminOnly = settings.adminOnly;
    }

    if (Array.isArray(settings.allowedUsers)) {
      sanitized.allowedUsers = settings.allowedUsers
        .filter((userId: any) => typeof userId === 'string' && userId.trim())
        .map((userId: string) => userId.trim());
    }

    return sanitized;
  },

  /**
   * Создает пустую статистику уведомлений
   */
  createEmptyNotificationStats(chatId: string, notificationType: NotificationType): NotificationStats {
    return {
      chatId,
      notificationType,
      totalSent: 0,
      successRate: 1.0,
      averageResponseTime: 0,
      failureCount: 0
    };
  },

  /**
   * Санитизирует результат отправки уведомления
   */
  sanitizeNotificationResult(result: any): NotificationResult {
    return {
      success: Boolean(result?.success),
      messageId: typeof result?.messageId === 'string' ? result.messageId : undefined,
      error: typeof result?.error === 'string' ? result.error : undefined,
      sentAt: result?.sentAt instanceof Date ? result.sentAt : new Date(),
      responseTime: typeof result?.responseTime === 'number' && result.responseTime >= 0 ? result.responseTime : 0,
      retryAttempt: typeof result?.retryAttempt === 'number' && result.retryAttempt >= 0 ? result.retryAttempt : 0
    };
  }
};
