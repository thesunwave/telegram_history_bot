/**
 * Mock Service Implementations
 * Provides comprehensive mock implementations for all services
 */

import { vi } from 'vitest';
import type { BaseService } from '../../src/services/base-service';
import type { NotificationService } from '../../src/services/notification-service';
import type { ServiceRegistry } from '../../src/services/service-registry';
import { ServiceFixtures } from '../fixtures/service-fixtures';

/**
 * Mock Base Service implementation
 */
export class MockBaseService implements Partial<BaseService> {
  public name: string;
  public version: string;
  public isInitialized: boolean = false;
  public isHealthy: boolean = true;

  // Mock methods
  public initialize = vi.fn().mockResolvedValue({ success: true });
  public shutdown = vi.fn().mockResolvedValue({ success: true });
  public getHealth = vi.fn().mockImplementation(() => 
    Promise.resolve(ServiceFixtures.Health.createHealthyStatus(this.name))
  );
  public getMetrics = vi.fn().mockImplementation(() =>
    Promise.resolve(ServiceFixtures.Metrics.createServiceMetrics(this.name))
  );
  public getConfig = vi.fn().mockResolvedValue({});
  public updateConfig = vi.fn().mockResolvedValue({ success: true });

  constructor(name: string = 'mock-service', version: string = '1.0.0') {
    this.name = name;
    this.version = version;
  }

  /**
   * Make service unhealthy for testing
   */
  makeUnhealthy(): void {
    this.isHealthy = false;
    this.getHealth.mockResolvedValue(
      ServiceFixtures.Health.createUnhealthyStatus(this.name)
    );
  }

  /**
   * Make service healthy for testing
   */
  makeHealthy(): void {
    this.isHealthy = true;
    this.getHealth.mockResolvedValue(
      ServiceFixtures.Health.createHealthyStatus(this.name)
    );
  }

  /**
   * Simulate service failure
   */
  simulateFailure(error: string = 'Service failure'): void {
    this.isHealthy = false;
    this.initialize.mockRejectedValue(new Error(error));
    this.getHealth.mockRejectedValue(new Error(error));
    this.getMetrics.mockRejectedValue(new Error(error));
  }

  /**
   * Reset all mocks
   */
  resetMocks(): void {
    vi.clearAllMocks();
    this.isInitialized = false;
    this.isHealthy = true;
  }
}

/**
 * Mock Notification Service implementation
 */
export class MockNotificationService extends MockBaseService implements Partial<NotificationService> {
  private telegramAPI?: any;

  public sendNotification = vi.fn().mockImplementation(async (request: any) => {
    const startTime = Date.now();
    
    try {
      // Generate proper message from template or type
       const template = request.template || request.type;
       const message = this.generateMessage(template, request.data);
      
      // Simulate Telegram API call
       if (this.telegramAPI) {
         const result = await this.telegramAPI.sendMessage({
           chat_id: request.chatId,
           text: message
         });
         
         if (!result.ok) {
           return {
             success: false,
             error: result.description || 'Telegram API error',
             sentAt: new Date(),
             responseTime: Date.now() - startTime
           };
         }
         
         return {
           success: true,
           messageId: result.result?.message_id || 'mock-message-id-123',
           sentAt: new Date(),
           responseTime: Date.now() - startTime
         };
       }
      
      return {
        success: true,
        messageId: 'mock-message-id-123',
        sentAt: new Date(),
        responseTime: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Notification failed',
        sentAt: new Date(),
        responseTime: Date.now() - startTime
      };
    }
  });

  private generateMessage(template: string, data: any): string {
     if (template === 'daily-summary' || template === 'daily_summary') {
       return `📋 *Ежедневная сводка*\n\nВсего нарушений: ${data.totalViolations}\nДата: ${data.date}`;
     }
     return 'Mock notification message';
   }

  public scheduleNotification = vi.fn().mockImplementation((notification: any) => {
    return Promise.resolve({
      id: 'mock-scheduled-id',
      scheduledAt: notification.scheduledAt,
      status: 'pending' as const
    });
  });

  public cancelNotification = vi.fn().mockResolvedValue(true);

  public getNotificationStats = vi.fn().mockResolvedValue(
    ServiceFixtures.Metrics.createServiceMetrics('notification-service')
  );

  public updateSettings = vi.fn().mockResolvedValue({ success: true });

  public getSettings = vi.fn().mockResolvedValue({
    enabled: true,
    maxRetries: 3,
    timeout: 30000
  });

  constructor() {
    super('notification-service', '1.0.0');
  }

  /**
   * Set telegram API instance for integration
   */
  setTelegramAPI(telegramAPI: any): void {
    this.telegramAPI = telegramAPI;
  }

  /**
   * Simulate notification failure
   */
  simulateNotificationFailure(error: string = 'Notification failed'): void {
    this.sendNotification.mockResolvedValue({
      success: false,
      error,
      sentAt: new Date(),
      responseTime: 1000
    });
  }

  /**
   * Simulate rate limiting
   */
  simulateRateLimit(): void {
    this.sendNotification.mockRejectedValue(new Error('Rate limit exceeded'));
  }

  /**
   * Get notification call history
   */
  getNotificationHistory(): any[] {
    return this.sendNotification.mock.calls;
  }
}

/**
 * Mock Service Registry implementation
 */
export class MockServiceRegistry implements Partial<ServiceRegistry> {
  private services = new Map<string, any>();
  
  public register = vi.fn().mockImplementation((name: string, service: any) => {
    this.services.set(name, service);
    return Promise.resolve();
  });

  public unregister = vi.fn().mockImplementation((name: string) => {
    this.services.delete(name);
    return Promise.resolve();
  });

  public get = vi.fn().mockImplementation((name: string) => {
    return this.services.get(name) || null;
  });

  public getAll = vi.fn().mockImplementation(() => {
    return Array.from(this.services.entries()).map(([name, service]) => ({
      name,
      service,
      status: 'active',
      registeredAt: new Date()
    }));
  });

  public getHealthStatus = vi.fn().mockImplementation(async () => {
    const services = Array.from(this.services.entries());
    const healthStatus: Record<string, any> = {};
    
    for (const [name, service] of services) {
      if (service && service.getHealth) {
        try {
          healthStatus[name] = await service.getHealth();
        } catch (error) {
          healthStatus[name] = ServiceFixtures.Health.createUnhealthyStatus(name);
        }
      } else {
        healthStatus[name] = ServiceFixtures.Health.createHealthyStatus(name);
      }
    }
    
    return healthStatus;
  });

  public startHealthMonitoring = vi.fn().mockResolvedValue({ success: true });
  public stopHealthMonitoring = vi.fn().mockResolvedValue({ success: true });

  /**
   * Add mock service to registry
   */
  addMockService(name: string, service?: any): void {
    const mockService = service || new MockBaseService(name);
    this.services.set(name, mockService);
  }

  /**
   * Remove all services
   */
  clearServices(): void {
    this.services.clear();
  }

  /**
   * Get registered service names
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Simulate service registry failure
   */
  simulateRegistryFailure(error: string = 'Registry failure'): void {
    this.register.mockRejectedValue(new Error(error));
    this.get.mockRejectedValue(new Error(error));
    this.getAll.mockRejectedValue(new Error(error));
  }
}

/**
 * Mock Violation Handler Service
 */
export class MockViolationHandlerService extends MockBaseService {
  public analyzeMessage = vi.fn().mockResolvedValue({
    hasViolations: false,
    violations: [],
    totalSeverity: 0,
    riskLevel: 'low',
    analysisTimestamp: new Date().toISOString()
  });

  public processViolation = vi.fn().mockImplementation(async (data: any) => {
    // Check if service is healthy before processing
    if (!this.isHealthy) {
      throw new Error('Service is unhealthy');
    }
    
    // Simulate updating statistics when processing violation
    const statisticsService = this.getStatisticsService?.();
    if (statisticsService && statisticsService.updateUserStats) {
      await statisticsService.updateUserStats(data.userId, data.chatId, data.violation);
    }
    
    // Send notification for critical violations
    let notified = false;
    if (data.violation && data.violation.severity >= 8) {
      const notificationService = this.getNotificationService?.();
      if (notificationService && notificationService.sendNotification) {
        await notificationService.sendNotification({
          chatId: data.chatId.toString(),
          type: 'violation_alert',
          data: { violation: data.violation }
        });
        notified = true;
      }
    }
    
    return {
      processed: true,
      stored: true,
      notified
    };
  });
  
  private getStatisticsService?: () => any;
  private getNotificationService?: () => any;

  public getViolationStats = vi.fn().mockResolvedValue({
    totalViolations: 0,
    averageSeverity: 0,
    riskLevel: 'low'
  });

  constructor() {
    super('violation-handler', '1.0.0');
  }

  /**
   * Set statistics service for integration
   */
  setStatisticsService(service: any): void {
    this.getStatisticsService = () => service;
  }

  /**
   * Set notification service for integration
   */
  setNotificationService(service: any): void {
    this.getNotificationService = () => service;
  }

  /**
   * Simulate violation detection
   */
  simulateViolationDetection(violations: any[] = []): void {
    this.analyzeMessage.mockResolvedValue({
      hasViolations: violations.length > 0,
      violations,
      totalSeverity: violations.reduce((sum, v) => sum + v.severity, 0),
      riskLevel: violations.length > 0 ? 'high' : 'low',
      analysisTimestamp: new Date().toISOString()
    });
  }

  /**
   * Simulate analysis failure
   */
  simulateAnalysisFailure(error: string = 'Analysis failed'): void {
    this.analyzeMessage.mockRejectedValue(new Error(error));
  }

  /**
   * Override makeHealthy to restore analyzeMessage mock
   */
  makeHealthy(): void {
    super.makeHealthy();
    this.analyzeMessage.mockResolvedValue({
      hasViolations: false,
      violations: [],
      totalSeverity: 0,
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString()
    });
  }
}

/**
 * Mock Statistics Service
 */
export class MockStatisticsService extends MockBaseService {
  private userStats = new Map<string, any>();
  private chatStats = new Map<string, any>();
  
  public getUserStats = vi.fn().mockImplementation((userId: number, chatId: number) => {
    const key = `${userId}:${chatId}`;
    return Promise.resolve(this.userStats.get(key) || {
      userId: userId.toString(),
      chatId: chatId.toString(),
      totalViolations: 0,
      violationsByArticle: [],
      averageSeverity: 0,
      riskLevel: 'low'
    });
  });

  public getChatStats = vi.fn().mockImplementation((chatId: number) => {
    return Promise.resolve(this.chatStats.get(chatId.toString()) || {
      chatId: chatId.toString(),
      totalViolations: 0,
      topViolations: [],
      topUsers: [],
      overallRiskLevel: 'low',
      averageSeverity: 0,
      criticalViolations: []
    });
  });

  public getPeriodStats = vi.fn().mockImplementation((chatId: number, startDate: Date, endDate: Date) => {
    return Promise.resolve({
      chatId: chatId.toString(),
      startDate,
      endDate,
      totalViolations: 0,
      violationsByArticle: [],
      averageSeverity: 0,
      uniqueUsers: 0
    });
  });

  public aggregateStats = vi.fn().mockResolvedValue({ success: true });
  
  public updateUserStats = vi.fn().mockImplementation((userId: number, chatId: number, violation: any) => {
    const key = `${userId}:${chatId}`;
    const current = this.userStats.get(key) || {
      userId: userId.toString(),
      chatId: chatId.toString(),
      totalViolations: 0,
      violationsByArticle: [],
      averageSeverity: 0,
      riskLevel: 'low'
    };
    
    current.totalViolations += 1;
    current.averageSeverity = (current.averageSeverity + violation.severity) / 2;
    
    // Add violation to violationsByArticle
    if (violation.article) {
      current.violationsByArticle.push({
        article: violation.article,
        count: 1,
        severity: violation.severity
      });
    }
    
    // Update risk level based on severity and count
    if (violation.severity >= 8 || current.totalViolations >= 3) {
      current.riskLevel = 'high';
    } else if (violation.severity >= 5 || current.totalViolations >= 1) {
      current.riskLevel = 'medium';
    } else {
      current.riskLevel = 'low';
    }
    
    this.userStats.set(key, current);
    
    // Also update chat stats
    const chatKey = chatId.toString();
    const chatCurrent = this.chatStats.get(chatKey) || {
      chatId: chatKey,
      totalViolations: 0,
      topViolations: [],
      topUsers: [],
      overallRiskLevel: 'low',
      averageSeverity: 0,
      criticalViolations: []
    };
    
    chatCurrent.totalViolations += 1;
    chatCurrent.averageSeverity = (chatCurrent.averageSeverity + violation.severity) / 2;
    chatCurrent.overallRiskLevel = chatCurrent.totalViolations > 10 ? 'high' : 'medium';
    
    // Update topUsers list
    const existingUserIndex = chatCurrent.topUsers.findIndex((u: any) => u.userId === userId.toString());
    if (existingUserIndex >= 0) {
      chatCurrent.topUsers[existingUserIndex].violationCount += 1;
    } else {
      chatCurrent.topUsers.push({
        userId: userId.toString(),
        violationCount: 1,
        riskLevel: current.riskLevel
      });
    }
    
    // Sort topUsers by violation count
    chatCurrent.topUsers.sort((a: any, b: any) => b.violationCount - a.violationCount);
    chatCurrent.topUsers = chatCurrent.topUsers.slice(0, 10); // Keep top 10
    
    this.chatStats.set(chatKey, chatCurrent);
    
    return Promise.resolve();
  });

  constructor() {
    super('statistics-service', '1.0.0');
  }

  /**
   * Simulate high activity stats
   */
  simulateHighActivity(): void {
    this.getUserStats.mockResolvedValue({
      userId: '123456',
      chatId: '-1001234567890',
      totalViolations: 25,
      violationsByArticle: [
        { article: '282', count: 15, averageSeverity: 7 },
        { article: '213', count: 10, averageSeverity: 5 }
      ],
      averageSeverity: 6.2,
      riskLevel: 'high'
    });

    this.getChatStats.mockResolvedValue({
      chatId: '-1001234567890',
      totalViolations: 150,
      topViolations: [
        { article: '282', count: 75, averageSeverity: 7 },
        { article: '213', count: 45, averageSeverity: 5 }
      ],
      topUsers: [
        { userId: '123456', count: 25, averageSeverity: 6.2, riskLevel: 'high' }
      ],
      overallRiskLevel: 'high',
      averageSeverity: 6.5,
      criticalViolations: []
    });
  }
}

/**
 * Mock Provider Manager Service
 */
export class MockProviderManagerService extends MockBaseService {
  public getProvider = vi.fn().mockResolvedValue({
    id: 'mock-provider',
    type: 'openai',
    status: 'healthy',
    capabilities: ['violation-analysis', 'profanity-detection']
  });

  public getAllProviders = vi.fn().mockResolvedValue([
    {
      id: 'openai-provider',
      type: 'openai',
      status: 'healthy',
      capabilities: ['violation-analysis', 'profanity-detection', 'summary-generation']
    },
    {
      id: 'cloudflare-provider',
      type: 'cloudflare',
      status: 'healthy',
      capabilities: ['violation-analysis', 'summary-generation']
    }
  ]);

  public executeRequest = vi.fn().mockResolvedValue({
    success: true,
    result: 'Mock provider response',
    providerId: 'mock-provider',
    responseTime: 150
  });

  public getProviderHealth = vi.fn().mockImplementation((providerId: string) => {
    return Promise.resolve({
      providerId,
      status: 'healthy',
      responseTime: 150,
      successRate: 0.95,
      lastCheck: new Date()
    });
  });

  constructor() {
    super('provider-manager', '1.0.0');
  }

  /**
   * Simulate provider failure
   */
  simulateProviderFailure(providerId: string = 'mock-provider'): void {
    this.executeRequest.mockRejectedValue(new Error(`Provider ${providerId} failed`));
    this.getProviderHealth.mockResolvedValue({
      providerId,
      status: 'unhealthy',
      responseTime: 5000,
      successRate: 0.1,
      lastCheck: new Date(),
      lastError: 'Provider connection failed'
    });
  }

  /**
   * Simulate rate limiting
   */
  simulateRateLimit(): void {
    this.executeRequest.mockRejectedValue(new Error('Rate limit exceeded'));
  }
}

/**
 * Service Mock Factory
 */
export class ServiceMockFactory {
  private static mocks = new Map<string, any>();

  /**
   * Create mock service by type
   */
  static createMockService(type: string, name?: string): any {
    switch (type) {
      case 'base':
        return new MockBaseService(name);
      case 'notification':
        return new MockNotificationService();
      case 'violation-handler':
        return new MockViolationHandlerService();
      case 'statistics':
        return new MockStatisticsService();
      case 'provider-manager':
        return new MockProviderManagerService();
      case 'registry':
        return new MockServiceRegistry();
      default:
        return new MockBaseService(name || type);
    }
  }

  /**
   * Get or create mock service
   */
  static getMockService(type: string, name?: string): any {
    const key = name || type;
    if (!this.mocks.has(key)) {
      this.mocks.set(key, this.createMockService(type, name));
    }
    return this.mocks.get(key);
  }

  /**
   * Register custom mock
   */
  static registerMock(name: string, mock: any): void {
    this.mocks.set(name, mock);
  }

  /**
   * Clear all mocks
   */
  static clearAllMocks(): void {
    this.mocks.forEach(mock => {
      if (mock.resetMocks) {
        mock.resetMocks();
      }
    });
    this.mocks.clear();
  }

  /**
   * Create complete service ecosystem mock
   */
  static createServiceEcosystem(): {
    registry: MockServiceRegistry;
    services: Record<string, any>;
  } {
    const registry = new MockServiceRegistry();
    const services = {
      'notification-service': new MockNotificationService(),
      'violation-handler': new MockViolationHandlerService(),
      'statistics-service': new MockStatisticsService(),
      'provider-manager': new MockProviderManagerService()
    };

    // Link services together
    const violationHandler = services['violation-handler'] as MockViolationHandlerService;
    const statisticsService = services['statistics-service'] as MockStatisticsService;
    const notificationService = services['notification-service'] as MockNotificationService;
    
    // Allow violation handler to access other services
    (violationHandler as any).getStatisticsService = () => statisticsService;
    (violationHandler as any).getNotificationService = () => notificationService;

    // Register all services
    Object.entries(services).forEach(([name, service]) => {
      registry.addMockService(name, service);
    });

    return { registry, services };
  }

  /**
   * Create service ecosystem with specific scenario
   */
  static createScenarioEcosystem(scenario: 'healthy' | 'unhealthy' | 'mixed' | 'high-load') {
    const { registry, services } = this.createServiceEcosystem();

    switch (scenario) {
      case 'unhealthy':
        Object.values(services).forEach((service: any) => {
          if (service.makeUnhealthy) {
            service.makeUnhealthy();
          }
        });
        break;

      case 'mixed':
        // Make some services unhealthy
        (services['violation-handler'] as MockViolationHandlerService).makeUnhealthy();
        (services['statistics-service'] as MockStatisticsService).simulateHighActivity();
        break;

      case 'high-load':
        (services['statistics-service'] as MockStatisticsService).simulateHighActivity();
        (services['violation-handler'] as MockViolationHandlerService).simulateViolationDetection([
          { article: '282', severity: 8 },
          { article: '213', severity: 6 }
        ]);
        break;

      case 'healthy':
      default:
        // All services are healthy by default
        break;
    }

    return { registry, services };
  }
}

/**
 * Service test helpers
 */
export class ServiceTestHelpers {
  /**
   * Wait for service to be ready
   */
  static async waitForServiceReady(service: any, timeout: number = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const health = await service.getHealth();
        if (health.status === 'healthy') {
          return;
        }
      } catch (error: unknown) {
        // Service not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Service did not become ready within timeout');
  }

  /**
   * Verify service calls
   */
  static verifyServiceCalls(service: any, expectedCalls: Record<string, number>): void {
    Object.entries(expectedCalls).forEach(([method, count]) => {
      if (service[method] && service[method].mock) {
        const actualCalls = service[method].mock.calls.length;
        if (actualCalls !== count) {
          throw new Error(`Expected ${count} calls to ${method}, got ${actualCalls}`);
        }
      }
    });
  }

  /**
   * Reset all service mocks
   */
  static resetServiceMocks(services: Record<string, any>): void {
    Object.values(services).forEach(service => {
      if (service.resetMocks) {
        service.resetMocks();
      }
    });
  }
}