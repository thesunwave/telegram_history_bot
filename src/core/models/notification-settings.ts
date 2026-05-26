/**
 * Модели данных для настроек автоматических уведомлений
 * Содержит интерфейсы и типы для управления автоматическими рассылками
 */

/**
 * Типы уведомлений
 */
export type NotificationType =
    | 'criminal_reports'    // Криминальные репорты
    | 'profanity_reports'   // Отчеты о мате
    | 'activity_summary'    // Сводка активности
    | 'daily_summary'       // Ежедневная сводка
    | 'weekly_summary'      // Еженедельная сводка
    | 'monthly_summary';    // Ежемесячная сводка

/**
 * Периодичность отправки уведомлений
 */
export type NotificationFrequency =
    | 'daily'     // Ежедневно
    | 'weekly'    // Еженедельно
    | 'monthly'   // Ежемесячно
    | 'instant';  // Мгновенно (при обнаружении)

/**
 * Время отправки уведомлений
 */
export interface NotificationTime {
    hour: number;    // 0-23
    minute: number;  // 0-59
    timezone?: string; // Часовой пояс (по умолчанию UTC)
}

/**
 * Настройки для конкретного типа уведомлений
 */
export interface NotificationTypeSettings {
    enabled: boolean;                    // Включено ли уведомление
    frequency: NotificationFrequency;    // Периодичность
    time?: NotificationTime;             // Время отправки (для не-мгновенных)
    threshold?: number;                  // Порог для отправки (например, минимальное количество нарушений)
    includeDetails: boolean;             // Включать ли детали в уведомление
    maxItemsInReport: number;            // Максимальное количество элементов в отчете
}

/**
 * Настройки автоматических уведомлений для чата
 */
export interface ChatNotificationSettings {
    chatId: string;                      // ID чата
    enabled: boolean;                    // Общий переключатель уведомлений
    createdAt: Date;                     // Дата создания настроек
    updatedAt: Date;                     // Дата последнего обновления
    updatedBy: string;                   // ID пользователя, который обновил настройки
    updatedByName?: string;              // Отображаемое имя пользователя, который обновил настройки

    // Настройки для каждого типа уведомлений
    notifications: {
        [K in NotificationType]: NotificationTypeSettings;
    };

    // Общие настройки
    quietHours?: {                       // Тихие часы (когда не отправлять уведомления)
        enabled: boolean;
        startTime: NotificationTime;
        endTime: NotificationTime;
    };

    adminOnly: boolean;                  // Только администраторы могут изменять настройки
    allowedUsers?: string[];             // Список пользователей, которые могут изменять настройки
}

/**
 * Статистика отправленных уведомлений
 */
export interface NotificationStats {
    chatId: string;
    notificationType: NotificationType;
    totalSent: number;                   // Общее количество отправленных уведомлений
    lastSentAt?: Date;                   // Дата последней отправки
    successRate: number;                 // Процент успешных отправок (0-1)
    averageResponseTime: number;         // Среднее время отклика в мс
    failureCount: number;                // Количество неудачных попыток
    lastFailureReason?: string;          // Причина последней неудачи
}

/**
 * Запланированное уведомление
 */
export interface ScheduledNotification {
    id: string;                          // Уникальный ID уведомления
    chatId: string;                      // ID чата
    notificationType: NotificationType;  // Тип уведомления
    scheduledAt: Date;                   // Запланированное время отправки
    createdAt: Date;                     // Дата создания
    status: 'pending' | 'sent' | 'failed' | 'cancelled'; // Статус
    retryCount: number;                  // Количество попыток повтора
    maxRetries: number;                  // Максимальное количество попыток
    lastAttemptAt?: Date;                // Дата последней попытки
    errorMessage?: string;               // Сообщение об ошибке
    payload?: any;                       // Дополнительные данные для уведомления
}

/**
 * Шаблон уведомления
 */
export interface NotificationTemplate {
    type: NotificationType;
    title: string;                       // Заголовок уведомления
    template: string;                    // Шаблон сообщения с плейсхолдерами
    variables: string[];                 // Список доступных переменных
    description: string;                 // Описание шаблона
    defaultEnabled: boolean;             // Включен ли по умолчанию
    defaultFrequency: NotificationFrequency; // Частота по умолчанию
    defaultTime?: NotificationTime;      // Время по умолчанию
    minThreshold?: number;               // Минимальный порог
    maxThreshold?: number;               // Максимальный порог
}

/**
 * Контекст для генерации уведомления
 */
export interface NotificationContext {
    chatId: string;
    notificationType: NotificationType;
    period: {
        start: Date;
        end: Date;
    };
    data: any;                           // Данные для уведомления (статистика, нарушения и т.д.)
    settings: NotificationTypeSettings;  // Настройки для данного типа уведомлений
    template: NotificationTemplate;      // Шаблон уведомления
}

/**
 * Результат отправки уведомления
 */
export interface NotificationResult {
    success: boolean;
    messageId?: string;                  // ID отправленного сообщения
    error?: string;                      // Ошибка, если есть
    sentAt: Date;                        // Время отправки
    responseTime: number;                // Время отклика в мс
    retryAttempt: number;                // Номер попытки
}

/**
 * Настройки по умолчанию для новых чатов
 */
export const DEFAULT_NOTIFICATION_SETTINGS: Omit<ChatNotificationSettings, 'chatId' | 'createdAt' | 'updatedAt' | 'updatedBy'> = {
    enabled: false,
    adminOnly: false, // Разрешаем всем пользователям изменять настройки по умолчанию
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
            time: { hour: 9, minute: 0 },
            includeDetails: false,
            maxItemsInReport: 5,
            threshold: 5
        },
        activity_summary: {
            enabled: false,
            frequency: 'daily',
            time: { hour: 18, minute: 0 },
            includeDetails: true,
            maxItemsInReport: 10
        },
        daily_summary: {
            enabled: false,
            frequency: 'daily',
            time: { hour: 20, minute: 0 },
            includeDetails: true,
            maxItemsInReport: 15
        },
        weekly_summary: {
            enabled: false,
            frequency: 'weekly',
            time: { hour: 10, minute: 0 },
            includeDetails: true,
            maxItemsInReport: 20
        },
        monthly_summary: {
            enabled: false,
            frequency: 'monthly',
            time: { hour: 10, minute: 0 },
            includeDetails: true,
            maxItemsInReport: 25
        }
    }
};

/**
 * Шаблоны уведомлений по умолчанию
 */
export const DEFAULT_NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
    {
        type: 'criminal_reports',
        title: '🚨 Обнаружены нарушения УК РФ',
        template: `🚨 *Обнаружены нарушения УК РФ*

📊 *Статистика за период:*
• Всего нарушений: {{totalViolations}}
• Уникальных пользователей: {{uniqueUsers}}
• Средняя серьезность: {{averageSeverity}}/10
• Уровень риска: {{riskLevel}}

{{#if includeDetails}}
📋 *Топ нарушений:*
{{#each topViolations}}
• {{article}}: {{count}} раз (серьезность: {{averageSeverity}}/10)
{{/each}}

👥 *Топ нарушителей:*
{{#each topUsers}}
• @{{username}}: {{count}} нарушений (риск: {{riskLevel}})
{{/each}}
{{/if}}

⏰ Отчет сгенерирован: {{timestamp}}`,
        variables: ['totalViolations', 'uniqueUsers', 'averageSeverity', 'riskLevel', 'topViolations', 'topUsers', 'timestamp'],
        description: 'Уведомление о криминальных нарушениях',
        defaultEnabled: false,
        defaultFrequency: 'instant',
        minThreshold: 1
    },
    {
        type: 'profanity_reports',
        title: '🤬 Отчет о матерной лексике',
        template: `🤬 *Отчет о матерной лексике*

📊 *Статистика за {{period}}:*
• Всего случаев мата: {{totalCount}}
• Уникальных слов: {{uniqueWords}}
• Активных пользователей: {{activeUsers}}

{{#if includeDetails}}
📋 *Топ матерных слов:*
{{#each topWords}}
• {{word}}: {{count}} раз
{{/each}}

👥 *Топ матершинников:*
{{#each topUsers}}
• @{{username}}: {{count}} случаев
{{/each}}
{{/if}}

⏰ Отчет за: {{timestamp}}`,
        variables: ['period', 'totalCount', 'uniqueWords', 'activeUsers', 'topWords', 'topUsers', 'timestamp'],
        description: 'Отчет о использовании матерной лексики',
        defaultEnabled: false,
        defaultFrequency: 'daily',
        defaultTime: { hour: 9, minute: 0 },
        minThreshold: 5
    },
    {
        type: 'activity_summary',
        title: '📈 Сводка активности чата',
        template: `📈 *Сводка активности чата*

📊 *Статистика за {{period}}:*
• Всего сообщений: {{totalMessages}}
• Активных пользователей: {{activeUsers}}
• Среднее сообщений в день: {{avgMessagesPerDay}}
• Пик активности: {{peakHour}}:00

{{#if includeDetails}}
👥 *Топ активных пользователей:*
{{#each topUsers}}
• @{{username}}: {{messageCount}} сообщений
{{/each}}

📅 *Активность по дням:*
{{#each dailyActivity}}
• {{date}}: {{messageCount}} сообщений
{{/each}}
{{/if}}

⏰ Отчет за: {{timestamp}}`,
        variables: ['period', 'totalMessages', 'activeUsers', 'avgMessagesPerDay', 'peakHour', 'topUsers', 'dailyActivity', 'timestamp'],
        description: 'Сводка активности пользователей в чате',
        defaultEnabled: false,
        defaultFrequency: 'daily',
        defaultTime: { hour: 18, minute: 0 }
    },
    {
        type: 'daily_summary',
        title: '📋 Ежедневная сводка',
        template: `📋 *Ежедневная сводка чата*

📊 *Статистика за сегодня:*
• Сообщений: {{totalMessages}}
• Активных пользователей: {{activeUsers}}
• Нарушений УК РФ: {{criminalViolations}}
• Случаев мата: {{profanityCount}}

{{#if includeDetails}}
🏆 *Самые активные:*
{{#each topUsers}}
• @{{username}}: {{messageCount}} сообщений
{{/each}}

{{#if hasViolations}}
⚠️ *Нарушения:*
{{#each violations}}
• {{article}}: {{count}} случаев
{{/each}}
{{/if}}
{{/if}}

⏰ Сводка за: {{date}}`,
        variables: ['totalMessages', 'activeUsers', 'criminalViolations', 'profanityCount', 'topUsers', 'hasViolations', 'violations', 'date'],
        description: 'Ежедневная сводка активности и нарушений',
        defaultEnabled: false,
        defaultFrequency: 'daily',
        defaultTime: { hour: 20, minute: 0 }
    },
    {
        type: 'weekly_summary',
        title: '📊 Еженедельная сводка',
        template: `📊 *Еженедельная сводка чата*

📈 *Статистика за неделю:*
• Сообщений: {{totalMessages}} ({{changeFromLastWeek}}% к прошлой неделе)
• Активных пользователей: {{activeUsers}}
• Нарушений УК РФ: {{criminalViolations}}
• Случаев мата: {{profanityCount}}
• Средняя активность в день: {{avgDaily}}

{{#if includeDetails}}
🏆 *Топ активных за неделю:*
{{#each topUsers}}
• @{{username}}: {{messageCount}} сообщений
{{/each}}

📅 *Активность по дням:*
{{#each dailyStats}}
• {{day}}: {{messages}} сообщений
{{/each}}
{{/if}}

⏰ Период: {{startDate}} - {{endDate}}`,
        variables: ['totalMessages', 'changeFromLastWeek', 'activeUsers', 'criminalViolations', 'profanityCount', 'avgDaily', 'topUsers', 'dailyStats', 'startDate', 'endDate'],
        description: 'Еженедельная сводка с трендами',
        defaultEnabled: false,
        defaultFrequency: 'weekly',
        defaultTime: { hour: 10, minute: 0 }
    },
    {
        type: 'monthly_summary',
        title: '📈 Месячная сводка',
        template: `📈 *Месячная сводка чата*

📊 *Статистика за месяц:*
• Сообщений: {{totalMessages}} ({{changeFromLastMonth}}% к прошлому месяцу)
• Активных пользователей: {{activeUsers}}
• Новых участников: {{newMembers}}
• Нарушений УК РФ: {{criminalViolations}}
• Случаев мата: {{profanityCount}}

{{#if includeDetails}}
🏆 *Топ активных за месяц:*
{{#each topUsers}}
• @{{username}}: {{messageCount}} сообщений ({{percentage}}% от общего)
{{/each}}

📈 *Тренды:*
• Активность: {{activityTrend}}
• Нарушения: {{violationsTrend}}
• Качество общения: {{qualityTrend}}

📅 *Активность по неделям:*
{{#each weeklyStats}}
• Неделя {{week}}: {{messages}} сообщений
{{/each}}
{{/if}}

⏰ Период: {{month}} {{year}}`,
        variables: ['totalMessages', 'changeFromLastMonth', 'activeUsers', 'newMembers', 'criminalViolations', 'profanityCount', 'topUsers', 'activityTrend', 'violationsTrend', 'qualityTrend', 'weeklyStats', 'month', 'year'],
        description: 'Месячная сводка с детальной аналитикой',
        defaultEnabled: false,
        defaultFrequency: 'monthly',
        defaultTime: { hour: 10, minute: 0 }
    }
];
