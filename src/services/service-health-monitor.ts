/**
 * Service Health Monitor
 * Monitors service health and provides health check capabilities
 */

import type { Env } from '../env';
import type { ServiceHealth } from './base-service';
import { Logger } from '../logger';
import { AppError } from '../utils/errors';

/**
 * Health check status levels
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Service health report
 */
export interface ServiceHealthReport {
  serviceName: string;
  status: HealthStatus;
  health: ServiceHealth;
  responseTime: number;
  timestamp: Date;
}

/**
 * Overall system health report
 */
export interface SystemHealthReport {
  overallStatus: HealthStatus;
  services: ServiceHealthReport[];
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  unknownCount: number;
  totalServices: number;
  timestamp: Date;
}

/**
 * Health monitoring configuration
 */
export interface HealthMonitorConfig {
  checkInterval: number; // milliseconds
  timeout: number; // milliseconds
  retryCount: number;
  retryDelay: number; // milliseconds
  alertThreshold: number; // consecutive failures before alert
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  isHealthy: boolean;
  responseTime: number;
  error?: string;
  details?: Record<string, any>;
}

/**
 * Service health monitor
 */
export class ServiceHealthMonitor {
  private logger: Logger;
  private healthHistory = new Map<string, ServiceHealthReport[]>();
  private alertCounts = new Map<string, number>();
  private monitoringTimer?: NodeJS.Timeout;
  private isMonitoring = false;

  constructor(
    private env: Env,
    private config: HealthMonitorConfig = {
      checkInterval: 60000, // 1 minute
      timeout: 5000, // 5 seconds
      retryCount: 3,
      retryDelay: 1000, // 1 second
      alertThreshold: 3
    }
  ) {
    this.logger = new Logger(env);
  }

  /**
   * Start health monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      this.logger.warn('Health monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    this.logger.info('Starting service health monitoring', {
      interval: this.config.checkInterval,
      timeout: this.config.timeout
    });

    this.monitoringTimer = setInterval(() => {
      this.performHealthChecks().catch(error => {
        this.logger.error('Error during health check cycle', { error });
      });
    }, this.config.checkInterval);
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
    }

    this.logger.info('Stopped service health monitoring');
  }

  /**
   * Check health of a single service
   */
  async checkServiceHealth(
    serviceName: string,
    healthCheckFn: () => Promise<ServiceHealth>
  ): Promise<ServiceHealthReport> {
    const startTime = Date.now();
    
    try {
      // Perform health check with timeout
      const health = await this.withTimeout(
        healthCheckFn(),
        this.config.timeout,
        `Health check timeout for service: ${serviceName}`
      );

      const responseTime = Date.now() - startTime;
      const status = this.determineHealthStatus(health);

      const report: ServiceHealthReport = {
        serviceName,
        status,
        health,
        responseTime,
        timestamp: new Date()
      };

      // Update health history
      this.updateHealthHistory(serviceName, report);

      // Reset alert count if healthy
      if (status === 'healthy') {
        this.alertCounts.set(serviceName, 0);
      } else {
        // Increment alert count
        const currentCount = this.alertCounts.get(serviceName) || 0;
        this.alertCounts.set(serviceName, currentCount + 1);

        // Check if we should alert
        if (currentCount + 1 >= this.config.alertThreshold) {
          this.handleHealthAlert(serviceName, report);
        }
      }

      return report;

    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const report: ServiceHealthReport = {
        serviceName,
        status: 'unhealthy',
        health: {
          isHealthy: false,
          lastCheck: new Date(),
          error: errorMessage
        },
        responseTime,
        timestamp: new Date()
      };

      this.updateHealthHistory(serviceName, report);
      
      // Increment alert count
      const currentCount = this.alertCounts.get(serviceName) || 0;
      this.alertCounts.set(serviceName, currentCount + 1);

      if (currentCount + 1 >= this.config.alertThreshold) {
        this.handleHealthAlert(serviceName, report);
      }

      return report;
    }
  }

  /**
   * Check health of multiple services
   */
  async checkMultipleServices(
    services: Array<{ name: string; healthCheckFn: () => Promise<ServiceHealth> }>
  ): Promise<SystemHealthReport> {
    const reports: ServiceHealthReport[] = [];

    // Check all services in parallel
    const promises = services.map(service =>
      this.checkServiceHealth(service.name, service.healthCheckFn)
    );

    const results = await Promise.allSettled(promises);

    // Process results
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const serviceName = services[i].name;

      if (result.status === 'fulfilled') {
        reports.push(result.value);
      } else {
        // Create error report for failed health check
        reports.push({
          serviceName,
          status: 'unhealthy',
          health: {
            isHealthy: false,
            lastCheck: new Date(),
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
          },
          responseTime: 0,
          timestamp: new Date()
        });
      }
    }

    return this.createSystemHealthReport(reports);
  }

  /**
   * Get health history for a service
   */
  getHealthHistory(serviceName: string, limit = 10): ServiceHealthReport[] {
    const history = this.healthHistory.get(serviceName) || [];
    return history.slice(-limit);
  }

  /**
   * Get current health status for all monitored services
   */
  getCurrentHealthStatus(): Map<string, ServiceHealthReport> {
    const currentStatus = new Map<string, ServiceHealthReport>();

    for (const [serviceName, history] of this.healthHistory.entries()) {
      if (history.length > 0) {
        currentStatus.set(serviceName, history[history.length - 1]);
      }
    }

    return currentStatus;
  }

  /**
   * Clear health history
   */
  clearHealthHistory(serviceName?: string): void {
    if (serviceName) {
      this.healthHistory.delete(serviceName);
      this.alertCounts.delete(serviceName);
    } else {
      this.healthHistory.clear();
      this.alertCounts.clear();
    }
  }

  /**
   * Get monitoring statistics
   */
  getMonitoringStats(): {
    isMonitoring: boolean;
    servicesMonitored: number;
    totalChecks: number;
    averageResponseTime: number;
  } {
    let totalChecks = 0;
    let totalResponseTime = 0;

    for (const history of this.healthHistory.values()) {
      totalChecks += history.length;
      totalResponseTime += history.reduce((sum, report) => sum + report.responseTime, 0);
    }

    return {
      isMonitoring: this.isMonitoring,
      servicesMonitored: this.healthHistory.size,
      totalChecks,
      averageResponseTime: totalChecks > 0 ? totalResponseTime / totalChecks : 0
    };
  }

  /**
   * Perform health checks (called by monitoring timer)
   */
  private async performHealthChecks(): Promise<void> {
    // This would be implemented to check registered services
    // For now, it's a placeholder for the monitoring cycle
    this.logger.debug('Performing scheduled health checks');
  }

  /**
   * Determine health status from health object
   */
  private determineHealthStatus(health: ServiceHealth): HealthStatus {
    if (health.isHealthy) {
      return 'healthy';
    }

    // Check if it's a degraded state (partial functionality)
    if (health.details?.degraded === true) {
      return 'degraded';
    }

    // Check if we have any information
    if (health.error || health.details?.error) {
      return 'unhealthy';
    }

    return 'unknown';
  }

  /**
   * Update health history for a service
   */
  private updateHealthHistory(serviceName: string, report: ServiceHealthReport): void {
    if (!this.healthHistory.has(serviceName)) {
      this.healthHistory.set(serviceName, []);
    }

    const history = this.healthHistory.get(serviceName)!;
    history.push(report);

    // Keep only last 100 entries
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
  }

  /**
   * Handle health alert
   */
  private handleHealthAlert(serviceName: string, report: ServiceHealthReport): void {
    this.logger.error('Service health alert', {
      serviceName,
      status: report.status,
      error: report.health.error,
      consecutiveFailures: this.alertCounts.get(serviceName),
      threshold: this.config.alertThreshold
    });

    // Here you could implement additional alerting mechanisms:
    // - Send notifications
    // - Trigger recovery procedures
    // - Update external monitoring systems
  }

  /**
   * Create system health report
   */
  private createSystemHealthReport(reports: ServiceHealthReport[]): SystemHealthReport {
    const healthyCount = reports.filter(r => r.status === 'healthy').length;
    const degradedCount = reports.filter(r => r.status === 'degraded').length;
    const unhealthyCount = reports.filter(r => r.status === 'unhealthy').length;
    const unknownCount = reports.filter(r => r.status === 'unknown').length;

    let overallStatus: HealthStatus;
    if (unhealthyCount > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedCount > 0) {
      overallStatus = 'degraded';
    } else if (healthyCount === reports.length && reports.length > 0) {
      overallStatus = 'healthy';
    } else {
      overallStatus = 'unknown';
    }

    return {
      overallStatus,
      services: reports,
      healthyCount,
      degradedCount,
      unhealthyCount,
      unknownCount,
      totalServices: reports.length,
      timestamp: new Date()
    };
  }

  /**
   * Execute function with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}