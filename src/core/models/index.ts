/**
 * Экспорт всех моделей данных и функций валидации
 */

// Экспорт типов и интерфейсов статистики
export type {
  Violation,
  ViolationAnalysis,
  ViolationCount,
  UserViolationCount,
  UserStats,
  PeriodComparison,
  PeriodStats,
  GeneralStats
} from './statistics';

// Экспорт функций валидации статистики
export {
  ValidationError,
  validateViolation,
  validateViolationAnalysis,
  validateViolationCount,
  validateUserViolationCount,
  validateUserStats,
  validatePeriodComparison,
  validatePeriodStats,
  validateGeneralStats,
  ValidationUtils
} from './validation';

// Экспорт типов и интерфейсов уведомлений
export type {
  NotificationType,
  NotificationFrequency,
  NotificationTime,
  NotificationTypeSettings,
  ChatNotificationSettings,
  NotificationStats,
  ScheduledNotification,
  NotificationTemplate,
  NotificationContext,
  NotificationResult
} from './notification-settings';

export {
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_TEMPLATES
} from './notification-settings';

// Экспорт функций валидации уведомлений
export {
  NotificationValidationError,
  validateNotificationType,
  validateNotificationFrequency,
  validateNotificationTime,
  validateNotificationTypeSettings,
  validateChatNotificationSettings,
  validateNotificationStats,
  validateScheduledNotification,
  validateNotificationTemplate,
  NotificationValidationUtils,
  NotificationDataSanitizer
} from './notification-validation';
