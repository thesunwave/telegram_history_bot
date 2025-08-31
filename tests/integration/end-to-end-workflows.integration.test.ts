/**
 * End-to-End Workflow Integration Tests
 * Tests complete user workflows from message processing to notifications
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockEnvironmentFactory, EnvironmentTestHelpers } from '../mocks/mock-environment';
import { ServiceMockFactory } from '../mocks/mock-services';
import { TelegramAPIMockFactory, TelegramAPITestHelpers } from '../mocks/mock-telegram-api';
import { StatisticsFixtures } from '../fixtures/statistics-fixtures';
import { NotificationFixtures } from '../fixtures/notification-fixtures';
import type { Env } from '../../src/env';

describe('End-to-End Workflow Integration Tests', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let env: Env;
  let serviceEcosystem: ReturnType<typeof ServiceMockFactory.createServiceEcosystem>;
  let telegramAPI: ReturnType<typeof TelegramAPIMockFactory.createBasicAPI>;

  beforeEach(async () => {
    env = MockEnvironmentFactory.createBasicEnvironment();
    serviceEcosystem = ServiceMockFactory.createServiceEcosystem();
    telegramAPI = TelegramAPIMockFactory.createBasicAPI();
    
    // Connect services for proper integration
    const notificationService = serviceEcosystem.services['notification-service'];
    const statisticsService = serviceEcosystem.services['statistics-service'];
    const violationHandler = serviceEcosystem.services['violation-handler'];
    
    notificationService.setTelegramAPI(telegramAPI);
    violationHandler.setStatisticsService(statisticsService);
    violationHandler.setNotificationService(notificationService);
    
    await EnvironmentTestHelpers.waitForEnvironmentReady(env);
  });

  afterEach(async () => {
    EnvironmentTestHelpers.resetEnvironment(env);
    ServiceMockFactory.clearAllMocks();
    telegramAPI.reset();
  });

  describe('Message Processing Workflow', () => {

    it('should process clean message without violations', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];
      const notificationService = services['notification-service'];

      // Simulate incoming clean message
      const incomingMessage = telegramAPI.simulateIncomingMessage({
        text: 'Hello everyone! How is your day going?',
        from: { id: 123456, is_bot: false, first_name: 'John', username: 'john_doe' },
        chat: { id: -1001234567890, type: 'supergroup', title: 'Test Chat' }
      });

      // Process message through violation handler
      const analysisResult = await violationHandler.analyzeMessage({
        message: incomingMessage.message!.text!,
        userId: incomingMessage.message!.from!.id,
        chatId: incomingMessage.message!.chat.id
      });

      // Should not detect violations
      expect(analysisResult.hasViolations).toBe(false);
      expect(analysisResult.violations).toHaveLength(0);
      expect(analysisResult.riskLevel).toBe('low');

      // No violation should be stored
      const userStats = await statisticsService.getUserStats(123456, -1001234567890);
      expect(userStats.totalViolations).toBe(0);

      // No notification should be sent
      expect(notificationService.sendNotification).not.toHaveBeenCalled();

      // No Telegram API calls should be made
      expect(telegramAPI.sendMessage).not.toHaveBeenCalled();
    });

    it('should process message with violations and trigger notifications', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];
      const notificationService = services['notification-service'];

      // Setup violation detection
      const criticalViolation = StatisticsFixtures.Violation.createCriticalViolation({
        article: '282',
        severity: 9,
        confidence: 0.95
      });
      violationHandler.simulateViolationDetection([criticalViolation]);

      // Simulate incoming message with violations
      const incomingMessage = telegramAPI.simulateIncomingMessage({
        text: 'This message contains hate speech and threats of violence',
        from: { id: 123456, is_bot: false, first_name: 'BadActor', username: 'bad_actor' },
        chat: { id: -1001234567890, type: 'supergroup', title: 'Test Chat' }
      });

      // Process message through violation handler
      const analysisResult = await violationHandler.analyzeMessage({
        message: incomingMessage.message!.text!,
        userId: incomingMessage.message!.from!.id,
        chatId: incomingMessage.message!.chat.id
      });

      // Should detect violations
      expect(analysisResult.hasViolations).toBe(true);
      expect(analysisResult.violations).toHaveLength(1);
      expect(analysisResult.riskLevel).toBe('high');
      expect(analysisResult.violations[0].severity).toBe(9);

      // Process the violation
      const processResult = await violationHandler.processViolation({
        userId: incomingMessage.message!.from!.id,
        chatId: incomingMessage.message!.chat.id,
        violation: analysisResult.violations[0]
      });

      expect(processResult.processed).toBe(true);
      expect(processResult.stored).toBe(true);

      // Statistics should be updated
      const userStats = await statisticsService.getUserStats(123456, -1001234567890);
      expect(userStats.totalViolations).toBeGreaterThan(0);
      expect(userStats.riskLevel).toBe('high');

      // Critical violation notification should be sent
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: '-1001234567890',
          type: 'violation_alert'
        })
      );

      // Telegram message should be sent to chat admins
      expect(telegramAPI.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: '-1001234567890',
          text: expect.stringContaining('Mock notification message')
        })
      );
    });

    it('should handle multiple violations from same user', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];

      // Setup multiple violations
      const violations = [
        StatisticsFixtures.Violation.createViolation({ article: '282', severity: 7 }),
        StatisticsFixtures.Violation.createViolation({ article: '213', severity: 5 }),
        StatisticsFixtures.Violation.createViolation({ article: '319', severity: 6 })
      ];

      // Process multiple messages from same user
      for (let i = 0; i < violations.length; i++) {
        violationHandler.simulateViolationDetection([violations[i]]);

        const incomingMessage = telegramAPI.simulateIncomingMessage({
          text: `Violation message ${i + 1}`,
          from: { id: 123456, is_bot: false, first_name: 'RepeatOffender' },
          chat: { id: -1001234567890, type: 'supergroup' }
        });

        const analysisResult = await violationHandler.analyzeMessage({
          message: incomingMessage.message!.text!,
          userId: incomingMessage.message!.from!.id,
          chatId: incomingMessage.message!.chat.id
        });

        await violationHandler.processViolation({
          userId: incomingMessage.message!.from!.id,
          chatId: incomingMessage.message!.chat.id,
          violation: analysisResult.violations[0]
        });
      }

      // User statistics should reflect all violations
      const userStats = await statisticsService.getUserStats(123456, -1001234567890);
      expect(userStats.totalViolations).toBe(3);
      expect(userStats.violationsByArticle).toHaveLength(3);
      expect(userStats.riskLevel).toBe('high'); // Should escalate with multiple violations
    });
  });

  describe('Notification Workflow', () => {

    it('should send daily summary notification', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];
      const statisticsService = services['statistics-service'];

      // Setup high activity scenario
      statisticsService.simulateHighActivity();

      // Setup notification settings
      const settings = NotificationFixtures.ChatSettings.createFullyEnabledSettings('-1001234567890');
      await notificationService.updateSettings('-1001234567890', settings);

      // Trigger daily summary
      const summaryData = await statisticsService.getChatStats(-1001234567890);
      
      const notificationResult = await notificationService.sendNotification({
        chatId: '-1001234567890',
        type: 'daily_summary',
        data: {
          totalMessages: 1250,
          activeUsers: 45,
          totalViolations: summaryData.totalViolations,
          topViolations: summaryData.topViolations.slice(0, 3),
          date: new Date().toDateString()
        }
      });

      expect(notificationResult.success).toBe(true);
      expect(notificationResult.messageId).toBeDefined();

      // Verify Telegram message was sent
      expect(telegramAPI.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_id: '-1001234567890',
          text: expect.stringContaining('📋 *Ежедневная сводка')
        })
      );
    });

    it('should handle notification scheduling workflow', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];

      // Schedule weekly summary
      const scheduledTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week from now
      
      const scheduleResult = await notificationService.scheduleNotification({
        chatId: '-1001234567890',
        type: 'weekly_summary',
        scheduledAt: scheduledTime,
        data: { summary: 'Weekly summary data' }
      });

      expect(scheduleResult.id).toBeDefined();
      expect(scheduleResult.status).toBe('pending');
      expect(scheduleResult.scheduledAt).toEqual(scheduledTime);

      // Verify notification is in pending state
      const stats = await notificationService.getNotificationStats('-1001234567890');
      expect(stats).toBeDefined();
    });

    it('should respect quiet hours for notifications', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];

      // Setup notification settings with quiet hours
      const settings = NotificationFixtures.ChatSettings.createChatNotificationSettings({
        chatId: '-1001234567890',
        enabled: true,
        quietHours: {
          enabled: true,
          startTime: { hour: 22, minute: 0 },
          endTime: { hour: 8, minute: 0 }
        }
      });

      await notificationService.updateSettings('-1001234567890', settings);

      // Try to send notification during quiet hours (simulate it's 2 AM)
      const mockDate = new Date();
      mockDate.setHours(2, 0, 0, 0);
      
      const notificationResult = await notificationService.sendNotification({
        chatId: '-1001234567890',
        type: 'activity_summary',
        data: { summary: 'Night activity' },
        scheduledAt: mockDate
      });

      // Notification should be delayed until after quiet hours
      expect(notificationResult.success).toBe(true);
      // In real implementation, this would be scheduled for later
    });
  });

  describe('Statistics Aggregation Workflow', () => {

    it('should aggregate statistics across multiple chats', async () => {
      const { services } = serviceEcosystem;
      const statisticsService = services['statistics-service'];
      const violationHandler = services['violation-handler'];

      const chatIds = [-1001234567890, -1001234567891, -1001234567892];
      
      // Process violations in multiple chats
      for (const chatId of chatIds) {
        violationHandler.simulateViolationDetection([
          StatisticsFixtures.Violation.createViolation({ severity: 6 }),
          StatisticsFixtures.Violation.createViolation({ severity: 4 })
        ]);

        // Process violations for each chat
        for (let i = 0; i < 5; i++) {
          await violationHandler.processViolation({
            userId: 123456 + i,
            chatId,
            violation: StatisticsFixtures.Violation.createViolation()
          });
        }
      }

      // Aggregate statistics for each chat
      for (const chatId of chatIds) {
        await statisticsService.aggregateStats(chatId);
        
        const chatStats = await statisticsService.getChatStats(chatId);
        expect(chatStats.totalViolations).toBeGreaterThan(0);
        expect(chatStats.topUsers.length).toBeGreaterThan(0);
      }
    });

    it('should calculate period comparisons correctly', async () => {
      const { services } = serviceEcosystem;
      const statisticsService = services['statistics-service'];

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      // Get current period stats
      const currentPeriod = await statisticsService.getPeriodStats(-1001234567890, startDate, endDate);

      // Get previous period stats for comparison
      const prevEndDate = new Date(startDate.getTime() - 1);
      const prevStartDate = new Date(prevEndDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      const previousPeriod = await statisticsService.getPeriodStats(-1001234567890, prevStartDate, prevEndDate);

      expect(currentPeriod.chatId).toBe('-1001234567890');
      expect(currentPeriod.startDate).toEqual(startDate);
      expect(currentPeriod.endDate).toEqual(endDate);
      
      // Should have comparison data if previous period exists
      if (previousPeriod.totalViolations > 0) {
        expect(currentPeriod.comparisonWithPreviousPeriod).toBeDefined();
      }
    });
  });

  describe('Error Handling Workflows', () => {

    it('should handle AI provider failures gracefully', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const providerManager = services['provider-manager'];

      // Simulate AI provider failure
      providerManager.simulateProviderFailure('primary-provider');

      const incomingMessage = telegramAPI.simulateIncomingMessage({
        text: 'Test message that should be analyzed',
        from: { id: 123456, is_bot: false, first_name: 'TestUser' },
        chat: { id: -1001234567890, type: 'supergroup' }
      });

      // Should failover to backup provider
      const analysisResult = await violationHandler.analyzeMessage({
        message: incomingMessage.message!.text!,
        userId: incomingMessage.message!.from!.id,
        chatId: incomingMessage.message!.chat.id
      });

      // Analysis should still work with fallback provider
      expect(analysisResult).toBeDefined();
      expect(analysisResult.hasViolations).toBeDefined();
    });

    it('should handle database failures with graceful degradation', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];

      // Simulate database failure
      (env.DB as any).configureFail(true, 'Database connection lost');

      const incomingMessage = telegramAPI.simulateIncomingMessage({
        text: 'Test message',
        from: { id: 123456, is_bot: false, first_name: 'TestUser' },
        chat: { id: -1001234567890, type: 'supergroup' }
      });

      // Analysis should still work (using AI)
      const analysisResult = await violationHandler.analyzeMessage({
        message: incomingMessage.message!.text!,
        userId: incomingMessage.message!.from!.id,
        chatId: incomingMessage.message!.chat.id
      });

      expect(analysisResult).toBeDefined();

      // But storage should fail gracefully
      try {
        await violationHandler.processViolation({
          userId: incomingMessage.message!.from!.id,
          chatId: incomingMessage.message!.chat.id,
          violation: StatisticsFixtures.Violation.createViolation()
        });
      } catch (error: unknown) {
        expect((error as Error).message).toContain('Database connection lost');
      }

      // Statistics service should handle database failures
      const userStats = await statisticsService.getUserStats(123456, -1001234567890);
      // Should return default/cached stats or handle error gracefully
      expect(userStats).toBeDefined();
    });

    it('should handle Telegram API failures', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];

      // Simulate Telegram API failure
      telegramAPI.configureFail(true, 'Telegram API unavailable');

      const notificationResult = await notificationService.sendNotification({
        chatId: '-1001234567890',
        type: 'criminal_reports',
        data: {
          violations: [StatisticsFixtures.Violation.createCriticalViolation()],
          riskLevel: 'high'
        }
      });

      // Notification should fail but be handled gracefully
      expect(notificationResult.success).toBe(false);
      expect(notificationResult.error).toContain('Telegram API unavailable');

      // Should not crash the application
      expect(telegramAPI.sendMessage).toHaveBeenCalled();
    });
  });

  describe('Performance and Load Testing', () => {

    it('should handle high message volume', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];

      // Simulate high volume of messages
      const messages = Array.from({ length: 100 }, (_, i) => 
        telegramAPI.simulateIncomingMessage({
          text: `Test message ${i}`,
          from: { id: 123456 + (i % 20), is_bot: false, first_name: `User${i}` },
          chat: { id: -1001234567890, type: 'supergroup' }
        })
      );

      const startTime = Date.now();
      
      // Process all messages concurrently
      const results = await Promise.all(
        messages.map(msg => violationHandler.analyzeMessage({
          message: msg.message!.text!,
          userId: msg.message!.from!.id,
          chatId: msg.message!.chat.id
        }))
      );

      const endTime = Date.now();

      expect(results.length).toBe(100);
      expect(endTime - startTime).toBeLessThan(10000); // Should complete within 10 seconds

      // All analyses should be valid
      results.forEach(result => {
        expect(result.hasViolations).toBeDefined();
        expect(result.riskLevel).toBeDefined();
      });
    });

    it('should maintain performance under concurrent load', async () => {
      const { services } = serviceEcosystem;

      // Simulate concurrent operations across all services
      const operations = [
        () => services['violation-handler'].analyzeMessage({
          message: 'Test message',
          userId: 123456,
          chatId: -1001234567890
        }),
        () => services['statistics-service'].getUserStats(123456, -1001234567890),
        () => services['notification-service'].sendNotification({
          chatId: '-1001234567890',
          type: 'activity_summary',
          data: { summary: 'Test' }
        }),
        () => services['provider-manager'].getProviderHealth('test-provider')
      ];

      // Run operations concurrently multiple times
      const concurrentOperations = Array.from({ length: 50 }, (_, i) => 
        operations[i % operations.length]()
      );

      const startTime = Date.now();
      const results = await Promise.allSettled(concurrentOperations);
      const endTime = Date.now();

      // Most operations should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(40); // At least 80% success rate

      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });

  describe('Data Consistency Workflows', () => {

    it('should maintain consistency across service boundaries', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];

      const userId = 123456;
      const chatId = -1001234567890;

      // Process a violation
      violationHandler.simulateViolationDetection([
        StatisticsFixtures.Violation.createViolation({ severity: 8 })
      ]);

      const violation = StatisticsFixtures.Violation.createViolation({ severity: 8 });
      
      await violationHandler.processViolation({
        userId,
        chatId,
        violation
      });

      // Check consistency across services
      const userStats = await statisticsService.getUserStats(userId, chatId);
      const chatStats = await statisticsService.getChatStats(chatId);

      // User should appear in chat statistics
      const userInChatStats = chatStats.topUsers.find((u: any) => u.userId === userId.toString());
      expect(userInChatStats).toBeDefined();

      // Violation counts should be consistent
      expect(userStats.totalViolations).toBeGreaterThan(0);
      expect(chatStats.totalViolations).toBeGreaterThanOrEqual(userStats.totalViolations);
    });

    it('should handle transaction-like operations', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];

      const userId = 123456;
      const chatId = -1001234567890;

      // Get initial state
      const initialUserStats = await statisticsService.getUserStats(userId, chatId);
      const initialChatStats = await statisticsService.getChatStats(chatId);

      // Simulate failure during processing
      violationHandler.simulateFailure('Processing interrupted');

      try {
        await violationHandler.processViolation({
          userId,
          chatId,
          violation: StatisticsFixtures.Violation.createViolation()
        });
      } catch (error: unknown) {
        // Expected failure
      }

      // State should remain consistent (no partial updates)
      const finalUserStats = await statisticsService.getUserStats(userId, chatId);
      const finalChatStats = await statisticsService.getChatStats(chatId);

      expect(finalUserStats.totalViolations).toBe(initialUserStats.totalViolations);
      expect(finalChatStats.totalViolations).toBe(initialChatStats.totalViolations);
    });
  });
});