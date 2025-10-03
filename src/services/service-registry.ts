/**
 * Service Registry
 * Central registry for all application services with dependency injection
 */

import type { Env } from '../env';
import { DIContainer } from './di-container';
import { StatisticsService, type IStatisticsService } from './statistics-service';
import { NotificationService, type INotificationService } from './notification-service';
import { ViolationRepositoryAdapter, type IViolationRepository } from '../repositories/violation-repository-adapter';
import { NotificationRepository, type INotificationRepository } from '../repositories/notification-repository';
import { MessageFormatter, type IMessageFormatter } from '../message-formatter';
import { ProviderFactory } from '../providers/provider-factory';
import type { AIProvider } from '../providers/ai-provider';
import { ServiceHealthMonitor, type SystemHealthReport } from './service-health-monitor';
import { ServiceConfigValidator, type ConfigValidationResult } from './service-config-validator';
import { BaseAppError } from '../utils/errors';

/**
 * Service names for dependency injection
 */
export const SERVICE_NAMES = {
  // Core services
  STATISTICS_SERVICE: 'StatisticsService',
  NOTIFICATION_SERVICE: 'NotificationService',
  MESSAGE_FORMATTER: 'MessageFormatter',
  
  // Repositories
  VIOLATION_REPOSITORY: 'ViolationRepository',
  NOTIFICATION_REPOSITORY: 'NotificationRepository',
  
  // Providers
  AI_PROVIDER: 'AIProvider',
  
  // Infrastructure
  DI_CONTAINER: 'DIContainer',
  ENV: 'Env'
} as const;

/**
 * Service registry with dependency injection container
 */
export class ServiceRegistry {
  private container: DIContainer;
  private healthMonitor: ServiceHealthMonitor;
  private initialized = false;

  constructor(private env: Env) {
    this.container = new DIContainer(env);
    this.healthMonitor = new ServiceHealthMonitor(env);
    this.registerServices();
  }

  /**
   * Get the DI container
   */
  getContainer(): DIContainer {
    return this.container;
  }

  /**
   * Initialize all services
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new BaseAppError(
        'REGISTRY_ALREADY_INITIALIZED',
        'Service registry is already initialized'
      );
    }

    try {
      await this.container.initialize();
      this.initialized = true;
    } catch (error: unknown) {
      throw new BaseAppError(
        'REGISTRY_INITIALIZATION_FAILED',
        'Failed to initialize service registry',
        { context: { error: error instanceof Error ? error.message : String(error) } }
      );
    }
  }

  /**
   * Shutdown all services
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      // Stop health monitoring first
      this.stopHealthMonitoring();
      
      // Shutdown services
      await this.container.shutdown();
      this.initialized = false;
    } catch (error: unknown) {
      throw new BaseAppError(
        'REGISTRY_SHUTDOWN_FAILED',
        'Failed to shutdown service registry',
        { context: { error: error instanceof Error ? error.message : String(error) } }
      );
    }
  }

  /**
   * Perform health check on all services
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    if (!this.initialized) {
      throw new BaseAppError(
        'REGISTRY_NOT_INITIALIZED',
        'Service registry is not initialized'
      );
    }

    return await this.container.healthCheck();
  }

  /**
   * Get comprehensive health report
   */
  async getHealthReport(): Promise<SystemHealthReport> {
    if (!this.initialized) {
      throw new BaseAppError(
        'REGISTRY_NOT_INITIALIZED',
        'Service registry is not initialized'
      );
    }

    const services = [
      {
        name: SERVICE_NAMES.STATISTICS_SERVICE,
        healthCheckFn: async () => {
          const service = this.getStatisticsService();
          return service.checkHealth();
        }
      },
      {
        name: SERVICE_NAMES.NOTIFICATION_SERVICE,
        healthCheckFn: async () => {
          const service = this.getNotificationService();
          return service.checkHealth();
        }
      }
    ];

    return await this.healthMonitor.checkMultipleServices(services);
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring(): void {
    this.healthMonitor.startMonitoring();
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    this.healthMonitor.stopMonitoring();
  }

  /**
   * Validate service configurations
   */
  validateConfigurations(): Map<string, ConfigValidationResult> {
    const results = new Map<string, ConfigValidationResult>();

    // Validate statistics service
    const statsService = this.container.resolve<StatisticsService>(SERVICE_NAMES.STATISTICS_SERVICE);
    const statsRequirements = ServiceConfigValidator.createRequirements('statistics');
    const statsResult = ServiceConfigValidator.validate(statsService.config, this.env, statsRequirements);
    results.set(SERVICE_NAMES.STATISTICS_SERVICE, statsResult);

    // Validate notification service
    const notificationService = this.container.resolve<NotificationService>(SERVICE_NAMES.NOTIFICATION_SERVICE);
    const notificationRequirements = ServiceConfigValidator.createRequirements('notification');
    const notificationResult = ServiceConfigValidator.validate(notificationService.config, this.env, notificationRequirements);
    results.set(SERVICE_NAMES.NOTIFICATION_SERVICE, notificationResult);

    return results;
  }

  /**
   * Get a service by name
   */
  getService<T>(serviceName: string): T {
    if (!this.initialized) {
      throw new BaseAppError(
        'REGISTRY_NOT_INITIALIZED',
        'Service registry is not initialized'
      );
    }

    return this.container.resolve<T>(serviceName);
  }

  /**
   * Get statistics service
   */
  getStatisticsService(): IStatisticsService {
    return this.getService<IStatisticsService>(SERVICE_NAMES.STATISTICS_SERVICE);
  }

  /**
   * Get notification service
   */
  getNotificationService(): INotificationService {
    return this.getService<INotificationService>(SERVICE_NAMES.NOTIFICATION_SERVICE);
  }

  /**
   * Get message formatter
   */
  getMessageFormatter(): IMessageFormatter {
    return this.getService<IMessageFormatter>(SERVICE_NAMES.MESSAGE_FORMATTER);
  }

  /**
   * Get violation repository
   */
  getViolationRepository(): IViolationRepository {
    return this.getService<IViolationRepository>(SERVICE_NAMES.VIOLATION_REPOSITORY);
  }

  /**
   * Get notification repository
   */
  getNotificationRepository(): INotificationRepository {
    return this.getService<INotificationRepository>(SERVICE_NAMES.NOTIFICATION_REPOSITORY);
  }

  /**
   * Get AI provider
   */
  getAIProvider(): AIProvider {
    return this.getService<AIProvider>(SERVICE_NAMES.AI_PROVIDER);
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Register all services with the DI container
   */
  private registerServices(): void {
    // Register environment
    this.container.registerSingleton(
      SERVICE_NAMES.ENV,
      () => this.env
    );

    // Register AI Provider
    this.container.registerSingleton(
      SERVICE_NAMES.AI_PROVIDER,
      (container) => {
        const env = container.resolve<Env>(SERVICE_NAMES.ENV);
        return ProviderFactory.createProvider(env);
      },
      [SERVICE_NAMES.ENV]
    );

    // Register repositories
    this.container.registerSingleton(
      SERVICE_NAMES.VIOLATION_REPOSITORY,
      (container) => {
        const env = container.resolve<Env>(SERVICE_NAMES.ENV);
        return new ViolationRepositoryAdapter(env);
      },
      [SERVICE_NAMES.ENV]
    );

    this.container.registerSingleton(
      SERVICE_NAMES.NOTIFICATION_REPOSITORY,
      (container) => {
        const env = container.resolve<Env>(SERVICE_NAMES.ENV);
        return new NotificationRepository(env);
      },
      [SERVICE_NAMES.ENV]
    );

    // Register message formatter
    this.container.registerSingleton(
      SERVICE_NAMES.MESSAGE_FORMATTER,
      () => new MessageFormatter()
    );

    // Register services
    this.container.registerSingleton(
      SERVICE_NAMES.STATISTICS_SERVICE,
      (container) => {
        const env = container.resolve<Env>(SERVICE_NAMES.ENV);
        const violationRepository = container.resolve<IViolationRepository>(SERVICE_NAMES.VIOLATION_REPOSITORY);
        return new StatisticsService(env, violationRepository);
      },
      [SERVICE_NAMES.ENV, SERVICE_NAMES.VIOLATION_REPOSITORY]
    );

    this.container.registerSingleton(
      SERVICE_NAMES.NOTIFICATION_SERVICE,
      (container) => {
        const env = container.resolve<Env>(SERVICE_NAMES.ENV);
        const notificationRepository = container.resolve<INotificationRepository>(SERVICE_NAMES.NOTIFICATION_REPOSITORY);
        return new NotificationService(env, notificationRepository);
      },
      [SERVICE_NAMES.ENV, SERVICE_NAMES.NOTIFICATION_REPOSITORY]
    );
  }

  /**
   * Create a new service registry instance
   */
  static create(env: Env): ServiceRegistry {
    return new ServiceRegistry(env);
  }

  /**
   * Create and initialize a service registry
   */
  static async createAndInitialize(env: Env): Promise<ServiceRegistry> {
    const registry = new ServiceRegistry(env);
    await registry.initialize();
    return registry;
  }
}