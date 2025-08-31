/**
 * Notification Model Test Fixtures
 * Provides realistic test data generators for notification models
 */

import type {
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
} from '../../src/models/notification-settings';

/**
 * Generate realistic notification time data
 */
export class NotificationTimeFixtures {
  /**
   * Create a notification time
   */
  static createNotificationTime(overrides: Partial<NotificationTime> = {}): NotificationTime {
    return {
      hour: Math.floor(Math.random() * 24),
      minute: Math.floor(Math.random() * 60),
      timezone: 'UTC',
      ...overrides
    };
  }

  /**
   * Create business hours time (9 AM - 6 PM)
   */
  static createBusinessHoursTime(): NotificationTime {
    return {
      hour: 9 + Math.floor(Math.random() * 9), // 9-17
      minute: Math.floor(Math.random() * 60),
      timezone: 'UTC'
    };
  }

  /**
   * Create evening time (6 PM - 10 PM)
   */
  static createEveningTime(): NotificationTime {
    return {
      hour: 18 + Math.floor(Math.random() * 4), // 18-21
      minute: Math.floor(Math.random() * 60),
      timezone: 'UTC'
    };
  }

  /**
   * Create morning time (6 AM - 10 AM)
   */
  static createMorningTime(): NotificationTime {
    return {
      hour: 6 + Math.floor(Math.random() * 4), // 6-9
      minute: Math.floor(Math.random() * 60),
      timezone: 'UTC'
    };
  }
}

/**
 * Generate realistic notification type settings
 */
export class NotificationTypeSettingsFixtures {
  /**
   * Create notification type settings
   */
  static createNotificationTypeSettings(overrides: Partial<NotificationTypeSettings> = {}): NotificationTypeSettings {
    const frequencies: NotificationFrequency[] = ['daily', 'weekly', 'monthly', 'instant'];
    const frequency = frequencies[Math.floor(Math.random() * frequencies.length)];
    
    return {
      enabled: Math.random() > 0.5,
      frequency,
      time: frequency !== 'instant' ? NotificationTimeFixtures.createNotificationTime() : undefined,
      threshold: Math.floor(Math.random() * 10) + 1,
      includeDetails: Math.random() > 0.3,
      maxItemsInReport: Math.floor(Math.random() * 20) + 5,
      ...overrides
    };
  }

  /**
   * Create enabled instant notification settings
   */
  static createInstantSettings(): NotificationTypeSettings {
    return this.createNotificationTypeSettings({
      enabled: true,
      frequency: 'instant',
      time: undefined,
      threshold: 1,
      includeDetails: true,
      maxItemsInReport: 10
    });
  }

  /**
   * Create daily notification settings
   */
  static createDailySettings(): NotificationTypeSettings {
    return this.createNotificationTypeSettings({
      enabled: true,
      frequency: 'daily',
      time: NotificationTimeFixtures.createEveningTime(),
      includeDetails: true,
      maxItemsInReport: 15
    });
  }

  /**
   * Create weekly notification settings
   */
  static createWeeklySettings(): NotificationTypeSettings {
    return this.createNotificationTypeSettings({
      enabled: true,
      frequency: 'weekly',
      time: NotificationTimeFixtures.createMorningTime(),
      includeDetails: true,
      maxItemsInReport: 20
    });
  }

  /**
   * Create disabled notification settings
   */
  static createDisabledSettings(): NotificationTypeSettings {
    return this.createNotificationTypeSettings({
      enabled: false,
      frequency: 'daily',
      includeDetails: false,
      maxItemsInReport: 5
    });
  }
}

/**
 * Generate realistic chat notification settings
 */
export class ChatNotificationSettingsFixtures {
  private static readonly NOTIFICATION_TYPES: NotificationType[] = [
    'criminal_reports',
    'profanity_reports',
    'activity_summary',
    'daily_summary',
    'weekly_summary',
    'monthly_summary'
  ];

  /**
   * Create chat notification settings
   */
  static createChatNotificationSettings(overrides: Partial<ChatNotificationSettings> = {}): ChatNotificationSettings {
    const chatId = `${Math.floor(Math.random() * -1000000)}`;
    const userId = `${Math.floor(Math.random() * 1000000)}`;
    const now = new Date();
    
    const notifications = {} as ChatNotificationSettings['notifications'];
    this.NOTIFICATION_TYPES.forEach(type => {
      notifications[type] = NotificationTypeSettingsFixtures.createNotificationTypeSettings();
    });

    return {
      chatId,
      enabled: Math.random() > 0.3,
      createdAt: new Date(now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Within last 30 days
      updatedAt: now,
      updatedBy: userId,
      notifications,
      quietHours: Math.random() > 0.7 ? {
        enabled: true,
        startTime: { hour: 22, minute: 0 },
        endTime: { hour: 8, minute: 0 }
      } : undefined,
      adminOnly: Math.random() > 0.6,
      allowedUsers: Math.random() > 0.8 ? [userId, `${Math.floor(Math.random() * 1000000)}`] : undefined,
      ...overrides
    };
  }

  /**
   * Create fully enabled settings
   */
  static createFullyEnabledSettings(chatId: string): ChatNotificationSettings {
    const notifications = {} as ChatNotificationSettings['notifications'];
    notifications.criminal_reports = NotificationTypeSettingsFixtures.createInstantSettings();
    notifications.profanity_reports = NotificationTypeSettingsFixtures.createDailySettings();
    notifications.activity_summary = NotificationTypeSettingsFixtures.createDailySettings();
    notifications.daily_summary = NotificationTypeSettingsFixtures.createDailySettings();
    notifications.weekly_summary = NotificationTypeSettingsFixtures.createWeeklySettings();
    notifications.monthly_summary = NotificationTypeSettingsFixtures.createNotificationTypeSettings({
      enabled: true,
      frequency: 'monthly',
      time: { hour: 10, minute: 0 }
    });

    return this.createChatNotificationSettings({
      chatId,
      enabled: true,
      notifications,
      adminOnly: false
    });
  }

  /**
   * Create fully disabled settings
   */
  static createFullyDisabledSettings(chatId: string): ChatNotificationSettings {
    const notifications = {} as ChatNotificationSettings['notifications'];
    this.NOTIFICATION_TYPES.forEach(type => {
      notifications[type] = NotificationTypeSettingsFixtures.createDisabledSettings();
    });

    return this.createChatNotificationSettings({
      chatId,
      enabled: false,
      notifications
    });
  }

  /**
   * Create admin-only settings
   */
  static createAdminOnlySettings(chatId: string, adminUserId: string): ChatNotificationSettings {
    return this.createChatNotificationSettings({
      chatId,
      enabled: true,
      adminOnly: true,
      updatedBy: adminUserId,
      allowedUsers: [adminUserId]
    });
  }
}

/**
 * Generate realistic notification stats
 */
export class NotificationStatsFixtures {
  /**
   * Create notification stats
   */
  static createNotificationStats(overrides: Partial<NotificationStats> = {}): NotificationStats {
    const types: NotificationType[] = ['criminal_reports', 'profanity_reports', 'activity_summary', 'daily_summary', 'weekly_summary', 'monthly_summary'];
    const notificationType = types[Math.floor(Math.random() * types.length)];
    const totalSent = Math.floor(Math.random() * 100) + 1;
    const failureCount = Math.floor(Math.random() * Math.max(1, totalSent * 0.1));
    
    return {
      chatId: `${Math.floor(Math.random() * -1000000)}`,
      notificationType,
      totalSent,
      lastSentAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Within last week
      successRate: (totalSent - failureCount) / totalSent,
      averageResponseTime: Math.floor(Math.random() * 2000) + 100, // 100-2100ms
      failureCount,
      lastFailureReason: failureCount > 0 ? 'Network timeout' : undefined,
      ...overrides
    };
  }

  /**
   * Create high-performance stats
   */
  static createHighPerformanceStats(): NotificationStats {
    return this.createNotificationStats({
      totalSent: Math.floor(Math.random() * 200) + 100,
      successRate: 0.95 + Math.random() * 0.05, // 95-100%
      averageResponseTime: Math.floor(Math.random() * 500) + 100, // 100-600ms
      failureCount: Math.floor(Math.random() * 3), // 0-2 failures
      lastFailureReason: undefined
    });
  }

  /**
   * Create poor-performance stats
   */
  static createPoorPerformanceStats(): NotificationStats {
    const totalSent = Math.floor(Math.random() * 50) + 20;
    const failureCount = Math.floor(totalSent * 0.3); // 30% failure rate
    
    return this.createNotificationStats({
      totalSent,
      successRate: (totalSent - failureCount) / totalSent,
      averageResponseTime: Math.floor(Math.random() * 3000) + 2000, // 2-5s
      failureCount,
      lastFailureReason: 'API rate limit exceeded'
    });
  }
}

/**
 * Generate realistic scheduled notification data
 */
export class ScheduledNotificationFixtures {
  /**
   * Create scheduled notification
   */
  static createScheduledNotification(overrides: Partial<ScheduledNotification> = {}): ScheduledNotification {
    const types: NotificationType[] = ['criminal_reports', 'profanity_reports', 'activity_summary', 'daily_summary', 'weekly_summary', 'monthly_summary'];
    const statuses: ScheduledNotification['status'][] = ['pending', 'sent', 'failed', 'cancelled'];
    const now = new Date();
    
    return {
      id: `notification_${Math.random().toString(36).substr(2, 9)}`,
      chatId: `${Math.floor(Math.random() * -1000000)}`,
      notificationType: types[Math.floor(Math.random() * types.length)],
      scheduledAt: new Date(now.getTime() + Math.random() * 24 * 60 * 60 * 1000), // Within next 24 hours
      createdAt: new Date(now.getTime() - Math.random() * 60 * 60 * 1000), // Within last hour
      status: statuses[Math.floor(Math.random() * statuses.length)],
      retryCount: Math.floor(Math.random() * 3),
      maxRetries: 3,
      lastAttemptAt: Math.random() > 0.5 ? new Date(now.getTime() - Math.random() * 30 * 60 * 1000) : undefined,
      errorMessage: Math.random() > 0.7 ? 'Failed to send message' : undefined,
      payload: { testData: 'sample payload' },
      ...overrides
    };
  }

  /**
   * Create pending notification
   */
  static createPendingNotification(): ScheduledNotification {
    return this.createScheduledNotification({
      status: 'pending',
      retryCount: 0,
      lastAttemptAt: undefined,
      errorMessage: undefined
    });
  }

  /**
   * Create sent notification
   */
  static createSentNotification(): ScheduledNotification {
    return this.createScheduledNotification({
      status: 'sent',
      retryCount: 0,
      lastAttemptAt: new Date(),
      errorMessage: undefined
    });
  }

  /**
   * Create failed notification
   */
  static createFailedNotification(): ScheduledNotification {
    return this.createScheduledNotification({
      status: 'failed',
      retryCount: 3,
      lastAttemptAt: new Date(),
      errorMessage: 'Maximum retry attempts exceeded'
    });
  }

  /**
   * Create cancelled notification
   */
  static createCancelledNotification(): ScheduledNotification {
    return this.createScheduledNotification({
      status: 'cancelled',
      retryCount: 0,
      errorMessage: 'Cancelled by user'
    });
  }
}

/**
 * Generate realistic notification template data
 */
export class NotificationTemplateFixtures {
  /**
   * Create notification template
   */
  static createNotificationTemplate(overrides: Partial<NotificationTemplate> = {}): NotificationTemplate {
    const types: NotificationType[] = ['criminal_reports', 'profanity_reports', 'activity_summary', 'daily_summary', 'weekly_summary', 'monthly_summary'];
    const type = types[Math.floor(Math.random() * types.length)];
    
    return {
      type,
      title: `Test ${type} Template`,
      template: `Test template for {{type}} with {{count}} items`,
      variables: ['type', 'count', 'timestamp'],
      description: `Test template for ${type} notifications`,
      defaultEnabled: Math.random() > 0.5,
      defaultFrequency: 'daily',
      defaultTime: NotificationTimeFixtures.createNotificationTime(),
      minThreshold: Math.floor(Math.random() * 5) + 1,
      maxThreshold: Math.floor(Math.random() * 50) + 10,
      ...overrides
    };
  }

  /**
   * Create criminal reports template
   */
  static createCriminalReportsTemplate(): NotificationTemplate {
    return this.createNotificationTemplate({
      type: 'criminal_reports',
      title: '🚨 Criminal Violations Detected',
      template: `🚨 *Criminal Violations Detected*

📊 *Statistics:*
• Total violations: {{totalViolations}}
• Risk level: {{riskLevel}}
• Average severity: {{averageSeverity}}/10

⏰ Report generated: {{timestamp}}`,
      variables: ['totalViolations', 'riskLevel', 'averageSeverity', 'timestamp'],
      description: 'Template for criminal violation notifications',
      defaultEnabled: true,
      defaultFrequency: 'instant',
      minThreshold: 1
    });
  }

  /**
   * Create daily summary template
   */
  static createDailySummaryTemplate(): NotificationTemplate {
    return this.createNotificationTemplate({
      type: 'daily_summary',
      title: '📋 Daily Summary',
      template: `📋 *Daily Summary*

📊 *Today's Statistics:*
• Messages: {{totalMessages}}
• Active users: {{activeUsers}}
• Violations: {{totalViolations}}

⏰ Summary for: {{date}}`,
      variables: ['totalMessages', 'activeUsers', 'totalViolations', 'date'],
      description: 'Template for daily summary notifications',
      defaultEnabled: false,
      defaultFrequency: 'daily',
      defaultTime: { hour: 20, minute: 0 }
    });
  }
}

/**
 * Generate realistic notification context data
 */
export class NotificationContextFixtures {
  /**
   * Create notification context
   */
  static createNotificationContext(overrides: Partial<NotificationContext> = {}): NotificationContext {
    const types: NotificationType[] = ['criminal_reports', 'profanity_reports', 'activity_summary', 'daily_summary', 'weekly_summary', 'monthly_summary'];
    const type = types[Math.floor(Math.random() * types.length)];
    const now = new Date();
    
    return {
      chatId: `${Math.floor(Math.random() * -1000000)}`,
      notificationType: type,
      period: {
        start: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 24 hours ago
        end: now
      },
      data: {
        totalViolations: Math.floor(Math.random() * 20),
        averageSeverity: Math.floor(Math.random() * 10) + 1,
        riskLevel: 'medium'
      },
      settings: NotificationTypeSettingsFixtures.createNotificationTypeSettings(),
      template: NotificationTemplateFixtures.createNotificationTemplate({ type }),
      ...overrides
    };
  }

  /**
   * Create criminal reports context
   */
  static createCriminalReportsContext(): NotificationContext {
    return this.createNotificationContext({
      notificationType: 'criminal_reports',
      data: {
        totalViolations: Math.floor(Math.random() * 10) + 1,
        averageSeverity: Math.floor(Math.random() * 5) + 6, // 6-10
        riskLevel: 'high',
        violations: ['Article 282', 'Article 213']
      },
      settings: NotificationTypeSettingsFixtures.createInstantSettings(),
      template: NotificationTemplateFixtures.createCriminalReportsTemplate()
    });
  }

  /**
   * Create daily summary context
   */
  static createDailySummaryContext(): NotificationContext {
    return this.createNotificationContext({
      notificationType: 'daily_summary',
      data: {
        totalMessages: Math.floor(Math.random() * 200) + 50,
        activeUsers: Math.floor(Math.random() * 20) + 5,
        totalViolations: Math.floor(Math.random() * 5),
        date: new Date().toDateString()
      },
      settings: NotificationTypeSettingsFixtures.createDailySettings(),
      template: NotificationTemplateFixtures.createDailySummaryTemplate()
    });
  }
}

/**
 * Generate realistic notification result data
 */
export class NotificationResultFixtures {
  /**
   * Create notification result
   */
  static createNotificationResult(overrides: Partial<NotificationResult> = {}): NotificationResult {
    const success = Math.random() > 0.2; // 80% success rate
    
    return {
      success,
      messageId: success ? `msg_${Math.random().toString(36).substr(2, 9)}` : undefined,
      error: success ? undefined : 'Failed to send notification',
      sentAt: new Date(),
      responseTime: Math.floor(Math.random() * 2000) + 100, // 100-2100ms
      retryAttempt: Math.floor(Math.random() * 3) + 1,
      ...overrides
    };
  }

  /**
   * Create successful result
   */
  static createSuccessResult(): NotificationResult {
    return this.createNotificationResult({
      success: true,
      messageId: `msg_${Math.random().toString(36).substr(2, 9)}`,
      error: undefined,
      responseTime: Math.floor(Math.random() * 1000) + 100, // 100-1100ms
      retryAttempt: 1
    });
  }

  /**
   * Create failed result
   */
  static createFailedResult(): NotificationResult {
    return this.createNotificationResult({
      success: false,
      messageId: undefined,
      error: 'Network timeout',
      responseTime: 5000,
      retryAttempt: 3
    });
  }

  /**
   * Create rate limited result
   */
  static createRateLimitedResult(): NotificationResult {
    return this.createNotificationResult({
      success: false,
      messageId: undefined,
      error: 'Rate limit exceeded',
      responseTime: 1000,
      retryAttempt: 2
    });
  }
}

/**
 * Comprehensive notification fixtures factory
 */
export class NotificationFixtures {
  static readonly Time = NotificationTimeFixtures;
  static readonly TypeSettings = NotificationTypeSettingsFixtures;
  static readonly ChatSettings = ChatNotificationSettingsFixtures;
  static readonly Stats = NotificationStatsFixtures;
  static readonly Scheduled = ScheduledNotificationFixtures;
  static readonly Template = NotificationTemplateFixtures;
  static readonly Context = NotificationContextFixtures;
  static readonly Result = NotificationResultFixtures;

  /**
   * Create a complete notification dataset for testing
   */
  static createCompleteDataset(chatId: string = '-1001234567890') {
    const settings = ChatNotificationSettingsFixtures.createChatNotificationSettings({ chatId });
    const stats = NotificationStatsFixtures.createNotificationStats({ chatId });
    const scheduled = ScheduledNotificationFixtures.createScheduledNotification({ chatId });
    const template = NotificationTemplateFixtures.createNotificationTemplate();
    const context = NotificationContextFixtures.createNotificationContext({ chatId });
    const result = NotificationResultFixtures.createNotificationResult();

    return {
      settings,
      stats,
      scheduled,
      template,
      context,
      result
    };
  }

  /**
   * Create test data for specific notification scenarios
   */
  static createScenarioData(scenario: 'active' | 'disabled' | 'admin-only' | 'high-volume', chatId: string = '-1001234567890') {
    switch (scenario) {
      case 'active':
        return {
          settings: ChatNotificationSettingsFixtures.createFullyEnabledSettings(chatId),
          stats: NotificationStatsFixtures.createHighPerformanceStats(),
          scheduled: ScheduledNotificationFixtures.createPendingNotification(),
          result: NotificationResultFixtures.createSuccessResult()
        };

      case 'disabled':
        return {
          settings: ChatNotificationSettingsFixtures.createFullyDisabledSettings(chatId),
          stats: NotificationStatsFixtures.createNotificationStats({ totalSent: 0 }),
          scheduled: ScheduledNotificationFixtures.createCancelledNotification(),
          result: NotificationResultFixtures.createFailedResult()
        };

      case 'admin-only':
        return {
          settings: ChatNotificationSettingsFixtures.createAdminOnlySettings(chatId, '123456'),
          stats: NotificationStatsFixtures.createNotificationStats(),
          scheduled: ScheduledNotificationFixtures.createPendingNotification(),
          result: NotificationResultFixtures.createSuccessResult()
        };

      case 'high-volume':
        return {
          settings: ChatNotificationSettingsFixtures.createFullyEnabledSettings(chatId),
          stats: NotificationStatsFixtures.createNotificationStats({ totalSent: 1000 }),
          scheduled: ScheduledNotificationFixtures.createScheduledNotification(),
          result: NotificationResultFixtures.createRateLimitedResult()
        };

      default:
        return this.createCompleteDataset(chatId);
    }
  }
}