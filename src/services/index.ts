/**
 * Экспорт всех сервисов
 */

// Core services
export { StatisticsService, type IStatisticsService } from './statistics-service';
export { NotificationService, type INotificationService } from './notification-service';
export { ValidationService, type ValidationServiceConfig } from './validation-service';

// Service infrastructure
export { BaseService, SimpleService, type IBaseService, type ServiceConfig, type ServiceHealth } from './base-service';
export { DIContainer, type ServiceRegistration, type ServiceConfig as DIServiceConfig, type ServiceLifecycle, type ServiceLifecycleHooks, type ManagedService } from './di-container';
export { ServiceRegistry, SERVICE_NAMES } from './service-registry';
export { ServiceHealthMonitor, type ServiceHealthReport, type SystemHealthReport, type HealthStatus, type HealthMonitorConfig } from './service-health-monitor';
export { ServiceConfigValidator, type ConfigValidationResult, type ServiceConfigRequirements } from './service-config-validator';