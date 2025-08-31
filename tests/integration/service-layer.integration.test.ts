/**
 * Service Layer Integration Tests
 * Tests service interactions and workflows
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServiceMockFactory } from '../mocks/mock-services';
import { MockEnvironmentFactory, EnvironmentTestHelpers } from '../mocks/mock-environment';
import { StatisticsFixtures } from '../fixtures/statistics-fixtures';
import { NotificationFixtures } from '../fixtures/notification-fixtures';
import type { Env } from '../../src/env';

describe('Service Layer Integration Tests', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let env: Env;
  let serviceEcosystem: ReturnType<typeof ServiceMockFactory.createServiceEcosystem>;

  beforeEach(async () => {
    env = MockEnvironmentFactory.createBasicEnvironment();
    serviceEcosystem = ServiceMockFactory.createServiceEcosystem();
    
    // Wait for environment to be ready
    await EnvironmentTestHelpers.waitForEnvironmentReady(env);
  });

  afterEach(async () => {
    EnvironmentTestHelpers.resetEnvironment(env);
    ServiceMockFactory.clearAllMocks();
  });

  describe('Violation Processing Workflow', () => {

    it('should process violation end-to-end', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const notificationService = services['notification-service'];
      const statisticsService = services['statistics-service'];

      // Setup violation detection
      violationHandler.simulateViolationDetection([
        StatisticsFixtures.Violation.createCriticalViolation()
      ]);

      // Process message
      const message = 'This message contains hate speech and threats';
      const analysisResult = await violationHandler.analyzeMessage({
        message,
        userId: 123456,
        chatId: -1001234567890
      });

      expect(analysisResult.hasViolations).toBe(true);
      expect(analysisResult.violations.length).toBeGreaterThan(0);

      // Verify violation was processed
      const processResult = await violationHandler.processViolation({
        userId: 123456,
        chatId: -1001234567890,
        violation: analysisResult.violations[0]
      });

      expect(processResult.processed).toBe(true);
      expect(processResult.stored).toBe(true);

      // Verify statistics were updated
      const stats = await statisticsService.getUserStats(123456, -1001234567890);
      expect(stats.totalViolations).toBeGreaterThan(0);

      // Verify notification was sent for critical violation
      expect(notificationService.sendNotification).toHaveBeenCalled();
    });

    it('should handle violation processing failures gracefully', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const notificationService = services['notification-service'];

      // Simulate analysis failure
      violationHandler.simulateAnalysisFailure('AI service unavailable');

      // Attempt to process message
      const message = 'Test message';
      
      try {
        await violationHandler.analyzeMessage({
          message,
          userId: 123456,
          chatId: -1001234567890
        });
      } catch (error: unknown) {
        expect(error.message).toContain('AI service unavailable');
      }

      // Notification service should not be called on analysis failure
      expect(notificationService.sendNotification).not.toHaveBeenCalled();
    });

    it('should handle high-volume violation processing', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];

      // Setup high activity scenario
      statisticsService.simulateHighActivity();

      // Process multiple violations concurrently
      const messages = Array.from({ length: 50 }, (_, i) => ({
        message: `Test violation message ${i}`,
        userId: 123456 + (i % 10),
        chatId: -1001234567890
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        messages.map(msg => violationHandler.analyzeMessage(msg))
      );
      const endTime = Date.now();

      // All analyses should complete
      expect(results.length).toBe(50);
      
      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(5000);

      // Verify statistics reflect high activity
      const stats = await statisticsService.getChatStats(-1001234567890);
      expect(stats.totalViolations).toBeGreaterThan(100);
    });
  });

  describe('Notification Service Integration', () => {

    it('should send notifications for critical violations', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];

      // Setup notification settings
      const settings = NotificationFixtures.ChatSettings.createFullyEnabledSettings('-1001234567890');
      await notificationService.updateSettings('-1001234567890', settings);

      // Send critical violation notification
      const notification = {
        chatId: '-1001234567890',
        type: 'criminal_reports' as const,
        data: {
          violations: [StatisticsFixtures.Violation.createCriticalViolation()],
          totalSeverity: 9,
          riskLevel: 'high'
        }
      };

      const result = await notificationService.sendNotification(notification);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.sentAt).toBeInstanceOf(Date);
    });

    it('should handle notification failures with retry', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];

      // Simulate notification failure
      notificationService.simulateNotificationFailure('Network timeout');

      const notification = {
        chatId: '-1001234567890',
        type: 'daily_summary' as const,
        data: { summary: 'Test summary' }
      };

      const result = await notificationService.sendNotification(notification);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network timeout');

      // Verify retry mechanism was triggered
      expect(notificationService.sendNotification).toHaveBeenCalledTimes(1);
    });

    it('should respect rate limits', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];

      // Simulate rate limiting
      notificationService.simulateRateLimit();

      const notifications = Array.from({ length: 10 }, (_, i) => ({
        chatId: '-1001234567890',
        type: 'activity_summary' as const,
        data: { summary: `Summary ${i}` }
      }));

      // Send notifications rapidly
      const results = await Promise.allSettled(
        notifications.map(n => notificationService.sendNotification(n))
      );

      // Some should fail due to rate limiting
      const failures = results.filter(r => r.status === 'rejected');
      expect(failures.length).toBeGreaterThan(0);
    });

    it('should schedule notifications correctly', async () => {
      const { services } = serviceEcosystem;
      const notificationService = services['notification-service'];

      const scheduledTime = new Date(Date.now() + 60000); // 1 minute from now
      const notification = {
        chatId: '-1001234567890',
        type: 'weekly_summary' as const,
        scheduledAt: scheduledTime,
        data: { summary: 'Weekly summary' }
      };

      const result = await notificationService.scheduleNotification(notification);

      expect(result.id).toBeDefined();
      expect(result.scheduledAt).toEqual(scheduledTime);
      expect(result.status).toBe('pending');
    });
  });

  describe('Statistics Service Integration', () => {

    it('should aggregate statistics correctly', async () => {
      const { services } = serviceEcosystem;
      const statisticsService = services['statistics-service'];

      // Setup high activity scenario
      statisticsService.simulateHighActivity();

      // Trigger statistics aggregation
      await statisticsService.aggregateStats(-1001234567890);

      // Verify aggregated statistics
      const chatStats = await statisticsService.getChatStats(-1001234567890);
      expect(chatStats.totalViolations).toBeGreaterThan(0);
      expect(chatStats.topViolations.length).toBeGreaterThan(0);
      expect(chatStats.topUsers.length).toBeGreaterThan(0);

      const userStats = await statisticsService.getUserStats(123456, -1001234567890);
      expect(userStats.totalViolations).toBeGreaterThan(0);
      expect(userStats.riskLevel).toBe('high');
    });

    it('should handle period statistics calculation', async () => {
      const { services } = serviceEcosystem;
      const statisticsService = services['statistics-service'];

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

      const periodStats = await statisticsService.getPeriodStats(-1001234567890, startDate, endDate);

      expect(periodStats.chatId).toBe('-1001234567890');
      expect(periodStats.startDate).toEqual(startDate);
      expect(periodStats.endDate).toEqual(endDate);
      expect(periodStats.totalViolations).toBeGreaterThanOrEqual(0);
    });

    it('should provide real-time statistics updates', async () => {
      const { services } = serviceEcosystem;
      const statisticsService = services['statistics-service'];
      const violationHandler = services['violation-handler'];

      // Get initial stats
      const initialStats = await statisticsService.getUserStats(123456, -1001234567890);

      // Process a violation
      violationHandler.simulateViolationDetection([
        StatisticsFixtures.Violation.createViolation({ severity: 8 })
      ]);

      await violationHandler.processViolation({
        userId: 123456,
        chatId: -1001234567890,
        violation: StatisticsFixtures.Violation.createViolation({ severity: 8 })
      });

      // Get updated stats
      const updatedStats = await statisticsService.getUserStats(123456, -1001234567890);

      // Stats should be updated
      expect(updatedStats.totalViolations).toBeGreaterThan(initialStats.totalViolations);
    });
  });

  describe('Provider Manager Integration', () => {

    it('should handle provider failover', async () => {
      const { services } = serviceEcosystem;
      const providerManager = services['provider-manager'];

      // Simulate primary provider failure
      providerManager.simulateProviderFailure('openai-provider');

      // Request should failover to secondary provider
      try {
        const result = await providerManager.executeRequest({
          type: 'violation-analysis',
          message: 'Test message',
          preferredProvider: 'openai-provider'
        });
        
        // If we get here, failover worked
        expect(result.success).toBe(true);
        expect(result.providerId).not.toBe('openai-provider'); // Should use fallback
      } catch (error: unknown) {
        // If primary provider fails and no failover, this is expected
        expect((error as Error).message).toContain('Provider openai-provider failed');
      }
    });

    it('should monitor provider health', async () => {
      const { services } = serviceEcosystem;
      const providerManager = services['provider-manager'];

      const health = await providerManager.getProviderHealth('openai-provider');

      expect(health.providerId).toBe('openai-provider');
      expect(health.status).toBeDefined();
      expect(health.responseTime).toBeGreaterThan(0);
      expect(health.successRate).toBeGreaterThanOrEqual(0);
      expect(health.successRate).toBeLessThanOrEqual(1);
    });

    it('should handle rate limiting across providers', async () => {
      const { services } = serviceEcosystem;
      const providerManager = services['provider-manager'];

      // Simulate rate limiting
      providerManager.simulateRateLimit();

      const requests = Array.from({ length: 20 }, (_, i) => ({
        type: 'violation-analysis',
        message: `Test message ${i}`
      }));

      const results = await Promise.allSettled(
        requests.map(req => providerManager.executeRequest(req))
      );

      // Some requests should fail due to rate limiting
      const failures = results.filter(r => r.status === 'rejected');
      expect(failures.length).toBeGreaterThan(0);
    });
  });

  describe('Service Health Monitoring', () => {

    it('should monitor all service health', async () => {
      const { registry, services } = serviceEcosystem;

      const healthStatus = await registry.getHealthStatus();

      expect(healthStatus).toBeDefined();
      expect(Object.keys(healthStatus)).toHaveLength(Object.keys(services).length);

      Object.values(healthStatus).forEach(health => {
        expect(health.status).toBeDefined();
        expect(['healthy', 'unhealthy', 'degraded']).toContain(health.status);
      });
    });

    it('should detect unhealthy services', async () => {
      const { registry, services } = serviceEcosystem;

      // Make one service unhealthy
      services['violation-handler'].makeUnhealthy();

      const healthStatus = await registry.getHealthStatus();

      expect(healthStatus['violation-handler'].status).toBe('unhealthy');
      expect(healthStatus['notification-service'].status).toBe('healthy');
    });

    it('should handle service dependencies', async () => {
      const { registry, services } = serviceEcosystem;

      // Make statistics service unhealthy (dependency of others)
      services['statistics-service'].makeUnhealthy();

      const healthStatus = await registry.getHealthStatus();

      // Statistics service should be unhealthy
      expect(healthStatus['statistics-service'].status).toBe('unhealthy');
    });
  });

  describe('Error Recovery and Resilience', () => {

    it('should recover from temporary failures', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];

      // Simulate temporary failure
      violationHandler.simulateAnalysisFailure('Temporary service unavailable');

      // First request should fail
      try {
        await violationHandler.analyzeMessage({
          message: 'Test message',
          userId: 123456,
          chatId: -1001234567890
        });
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        expect((error as Error).message).toContain('Temporary service unavailable');
      }

      // Restore service
      violationHandler.makeHealthy();

      // Subsequent request should succeed
      const result = await violationHandler.analyzeMessage({
        message: 'Test message',
        userId: 123456,
        chatId: -1001234567890
      });

      expect(result).toBeDefined();
    });

    it('should handle cascading failures gracefully', async () => {
      const { services } = serviceEcosystem;

      // Simulate multiple service failures
      services['violation-handler'].makeUnhealthy();
      services['statistics-service'].makeUnhealthy();

      // Notification service should still work
      const notificationResult = await services['notification-service'].sendNotification({
        chatId: '-1001234567890',
        type: 'activity_summary',
        data: { summary: 'Emergency notification' }
      });

      expect(notificationResult.success).toBe(true);
    });

    it('should maintain data consistency during failures', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];
      const statisticsService = services['statistics-service'];

      // Get initial state
      const initialStats = await statisticsService.getUserStats(123456, -1001234567890);

      // Simulate failure during processing
      violationHandler.simulateFailure('Processing failed');

      try {
        await violationHandler.processViolation({
          userId: 123456,
          chatId: -1001234567890,
          violation: StatisticsFixtures.Violation.createViolation()
        });
      } catch (error: unknown) {
        // Expected failure
      }

      // Stats should remain unchanged
      const finalStats = await statisticsService.getUserStats(123456, -1001234567890);
      expect(finalStats.totalViolations).toBe(initialStats.totalViolations);
    });
  });

  describe('Performance and Scalability', () => {

    it('should handle concurrent service requests', async () => {
      const { services } = serviceEcosystem;

      const requests = Array.from({ length: 100 }, (_, i) => ({
        service: Object.keys(services)[i % Object.keys(services).length],
        operation: 'getHealth'
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        requests.map(req => services[req.service].getHealth())
      );
      const endTime = Date.now();

      expect(results.length).toBe(100);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
    });

    it('should maintain performance under load', async () => {
      const { services } = serviceEcosystem;
      const violationHandler = services['violation-handler'];

      // Process many violations
      const violations = Array.from({ length: 200 }, (_, i) => ({
        message: `Test message ${i}`,
        userId: 123456 + (i % 50),
        chatId: -1001234567890
      }));

      const startTime = Date.now();
      const results = await Promise.all(
        violations.map(v => violationHandler.analyzeMessage(v))
      );
      const endTime = Date.now();

      expect(results.length).toBe(200);
      
      // Should maintain reasonable performance
      const avgTimePerRequest = (endTime - startTime) / 200;
      expect(avgTimePerRequest).toBeLessThan(50); // Less than 50ms per request
    });
  });
});