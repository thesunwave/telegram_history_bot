/**
 * Пример использования системы автоматических уведомлений
 */

import type { Env } from '../src/env';
import { NotificationService } from '../src/services/notification-service';
import { NotificationRepository } from '../src/repositories/notification-repository';
import type { NotificationType } from '../src/models/notification-settings';

/**
 * Пример настройки автоматических уведомлений для чата
 */
export async function setupChatNotifications(env: Env, chatId: string, adminUserId: string) {
  // Создаем экземпляры сервисов
  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);

  console.log(`🔧 Настройка уведомлений для чата ${chatId}...`);

  try {
    // 1. Включаем общие уведомления для чата
    await service.updateChatSettings(chatId, {
      enabled: true,
      adminOnly: true, // Только администраторы могут изменять настройки
      allowedUsers: [adminUserId] // Разрешаем конкретному пользователю
    }, adminUserId);

    console.log('✅ Общие настройки уведомлений включены');

    // 2. Включаем криминальные репорты (мгновенные)
    await service.enableNotification(chatId, 'criminal_reports', adminUserId);
    await service.updateNotificationSettings(chatId, 'criminal_reports', {
      frequency: 'instant', // Мгновенно при обнаружении
      includeDetails: true,
      maxItemsInReport: 5,
      threshold: 1 // Отправлять при любом нарушении
    }, adminUserId);

    console.log('🚨 Криминальные репорты настроены (мгновенные)');

    // 3. Включаем отчеты о мате (ежедневно в 9:00)
    await service.enableNotification(chatId, 'profanity_reports', adminUserId);
    await service.updateNotificationSettings(chatId, 'profanity_reports', {
      frequency: 'daily',
      time: { hour: 9, minute: 0 },
      includeDetails: false, // Без деталей для краткости
      maxItemsInReport: 10,
      threshold: 5 // Только если больше 5 случаев мата
    }, adminUserId);

    console.log('🤬 Отчеты о мате настроены (ежедневно в 9:00)');

    // 4. Включаем ежедневную сводку (в 20:00)
    await service.enableNotification(chatId, 'daily_summary', adminUserId);
    await service.updateNotificationSettings(chatId, 'daily_summary', {
      frequency: 'daily',
      time: { hour: 20, minute: 0 },
      includeDetails: true,
      maxItemsInReport: 15
    }, adminUserId);

    console.log('📋 Ежедневная сводка настроена (в 20:00)');

    // 5. Включаем еженедельную сводку (понедельник в 10:00)
    await service.enableNotification(chatId, 'weekly_summary', adminUserId);
    await service.updateNotificationSettings(chatId, 'weekly_summary', {
      frequency: 'weekly',
      time: { hour: 10, minute: 0 },
      includeDetails: true,
      maxItemsInReport: 20
    }, adminUserId);

    console.log('📊 Еженедельная сводка настроена (понедельник в 10:00)');

    // 6. Настраиваем тихие часы (с 22:00 до 8:00)
    await service.updateChatSettings(chatId, {
      quietHours: {
        enabled: true,
        startTime: { hour: 22, minute: 0 },
        endTime: { hour: 8, minute: 0 }
      }
    }, adminUserId);

    console.log('🔇 Тихие часы настроены (22:00 - 8:00)');

    // 7. Показываем итоговые настройки
    const finalSettings = await service.getChatSettings(chatId);
    console.log('📋 Итоговые настройки:', JSON.stringify(finalSettings, null, 2));

    return finalSettings;

  } catch (error) {
    console.error('❌ Ошибка при настройке уведомлений:', error);
    throw error;
  }
}

/**
 * Пример планирования уведомления
 */
export async function scheduleTestNotification(env: Env, chatId: string, type: NotificationType) {
  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);

  console.log(`📅 Планирование уведомления ${type} для чата ${chatId}...`);

  try {
    const notificationId = await service.scheduleNotification(chatId, type, {
      testData: 'Это тестовое уведомление',
      timestamp: new Date().toISOString()
    });

    console.log(`✅ Уведомление запланировано с ID: ${notificationId}`);
    return notificationId;

  } catch (error) {
    console.error('❌ Ошибка при планировании уведомления:', error);
    throw error;
  }
}

/**
 * Пример обработки запланированных уведомлений
 */
export async function processNotifications(env: Env) {
  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);

  console.log('🔄 Обработка запланированных уведомлений...');

  try {
    const processedCount = await service.processScheduledNotifications();
    console.log(`✅ Обработано уведомлений: ${processedCount}`);
    return processedCount;

  } catch (error) {
    console.error('❌ Ошибка при обработке уведомлений:', error);
    throw error;
  }
}

/**
 * Пример получения статистики уведомлений
 */
export async function getNotificationStatistics(env: Env, chatId: string) {
  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);

  console.log(`📊 Получение статистики уведомлений для чата ${chatId}...`);

  try {
    const availableTypes = service.getAvailableNotificationTypes();
    const statistics: Record<string, any> = {};

    for (const type of availableTypes) {
      const stats = await service.getNotificationStats(chatId, type);
      statistics[type] = {
        totalSent: stats.totalSent,
        successRate: `${(stats.successRate * 100).toFixed(1)}%`,
        averageResponseTime: `${stats.averageResponseTime}ms`,
        failureCount: stats.failureCount,
        lastSentAt: stats.lastSentAt?.toISOString()
      };
    }

    console.log('📈 Статистика уведомлений:', JSON.stringify(statistics, null, 2));
    return statistics;

  } catch (error) {
    console.error('❌ Ошибка при получении статистики:', error);
    throw error;
  }
}

/**
 * Пример быстрой настройки для нового чата
 */
export async function quickSetupForNewChat(env: Env, chatId: string, adminUserId: string) {
  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);

  console.log(`⚡ Быстрая настройка для нового чата ${chatId}...`);

  try {
    // Включаем только самые важные уведомления
    await service.updateChatSettings(chatId, {
      enabled: true,
      adminOnly: true
    }, adminUserId);

    // Криминальные репорты - мгновенно
    await service.enableNotification(chatId, 'criminal_reports', adminUserId);
    
    // Ежедневная сводка - вечером
    await service.enableNotification(chatId, 'daily_summary', adminUserId);

    // Тихие часы
    await service.updateChatSettings(chatId, {
      quietHours: {
        enabled: true,
        startTime: { hour: 23, minute: 0 },
        endTime: { hour: 7, minute: 0 }
      }
    }, adminUserId);

    console.log('✅ Быстрая настройка завершена');
    
    const settings = await service.getChatSettings(chatId);
    return settings;

  } catch (error) {
    console.error('❌ Ошибка при быстрой настройке:', error);
    throw error;
  }
}

/**
 * Пример отключения всех уведомлений
 */
export async function disableAllNotifications(env: Env, chatId: string, adminUserId: string) {
  const repository = new NotificationRepository(env);
  const service = new NotificationService(env, repository);

  console.log(`❌ Отключение всех уведомлений для чата ${chatId}...`);

  try {
    await service.updateChatSettings(chatId, {
      enabled: false
    }, adminUserId);

    console.log('✅ Все уведомления отключены');

  } catch (error) {
    console.error('❌ Ошибка при отключении уведомлений:', error);
    throw error;
  }
}

/**
 * Пример использования в cron job
 */
export async function cronJobExample(env: Env) {
  console.log('⏰ Запуск cron job для обработки уведомлений...');

  try {
    // 1. Обрабатываем запланированные уведомления
    const processedCount = await processNotifications(env);
    
    // 2. Очищаем старые уведомления (старше 30 дней)
    const repository = new NotificationRepository(env);
    const cleanedCount = await repository.cleanupOldNotifications(30);

    console.log(`✅ Cron job завершен: обработано ${processedCount}, очищено ${cleanedCount}`);
    
    return { processedCount, cleanedCount };

  } catch (error) {
    console.error('❌ Ошибка в cron job:', error);
    throw error;
  }
}