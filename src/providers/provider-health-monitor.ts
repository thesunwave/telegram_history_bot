/**
 * Provider Health Monitor
 * Monitors AI provider health and performance metrics
 */

import type { Env } from '../env';
import type { AIProvider, ProviderInfo } from './ai-provider';
import { Logger } from '../logger';
import { AppError } from '../utils/errors';

/**
 * Provider health status
 */
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Provider performance metrics
 */
export interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastResponseTime: number;
  errorRate: number;
  uptime: number;
  lastHealthCheck: Date;
}

/**
 * Provider health report
 */
export interface ProviderHealthReport {
  providerId: string;
  providerInfo: ProviderInfo;
  status: ProviderHealthStatus;
  metrics: ProviderMetrics;
  lastError?: string;
  capabilities: ProviderCapabilities;
  timestamp: Date;
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  summarization: boolean;
  profanityAnalysis: boolean;
  criminalCodeAnalysis: boolean;
  maxTokens: number;
  supportedLanguages: string[];
  responseFormats: string[];
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  interval: number; // milliseconds
  timeout: number; // milliseconds
  retryCount: number;
  retryDelay: number; // milliseconds
  healthThreshold: number; // success rate threshold (0-1)
  degradedThreshold: number; // success rate threshold for degraded status (0-1)
}

/**
 * Provider health monitor
 */
export class ProviderHealthMonitor {
  private logger: Logger;
  private providers = new Map<string, AIProvider>();
  private metrics = new Map<string, ProviderMetrics>();
  private healthReports = new Map<string, ProviderHealthReport>();
  private monitoringTimer?: NodeJS.Timeout;
  private isMonitoring = false;

  constructor(
    private env: Env,
    private config: HealthCheckConfig = {
      interval: 300000, // 5 minutes
      timeout: 30000, // 30 seconds
      retryCount: 3,
      retryDelay: 5000, // 5 seconds
      healthThreshold: 0.95, // 95% success rate for healthy
      degradedThreshold: 0.80 // 80% success rate for degraded
    }
  ) {
    this.logger = new Logger(env);
  }

  /**
   * Register a provider for monitoring
   */
  registerProvider(providerId: string, provider: AIProvider): void {
    this.providers.set(providerId, provider);
    
    // Initialize metrics
    this.metrics.set(providerId, {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      lastResponseTime: 0,
      errorRate: 0,
      uptime: 1.0,
      lastHealthCheck: new Date()
    });

    this.logger.info(`Registered provider for monitoring: ${providerId}`, {
      providerInfo: provider.getProviderInfo()
    });
  }

  /**
   * Unregister a provider from monitoring
   */
  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.metrics.delete(providerId);
    this.healthReports.delete(providerId);
    
    this.logger.info(`Unregistered provider from monitoring: ${providerId}`);
  }

  /**
   * Start health monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      this.logger.warn('Provider health monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    this.logger.info('Starting provider health monitoring', {
      interval: this.config.interval,
      providersCount: this.providers.size
    });

    // Perform initial health checks
    this.performHealthChecks().catch(error => {
      this.logger.error('Error during initial health checks', { error });
    });

    // Start periodic monitoring
    this.monitoringTimer = setInterval(() => {
      this.performHealthChecks().catch(error => {
        this.logger.error('Error during periodic health checks', { error });
      });
    }, this.config.interval);
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

    this.logger.info('Stopped provider health monitoring');
  }

  /**
   * Record request metrics
   */
  recordRequest(providerId: string, success: boolean, responseTime: number, error?: string): void {
    const metrics = this.metrics.get(providerId);
    if (!metrics) {
      return;
    }

    metrics.totalRequests++;
    metrics.lastResponseTime = responseTime;

    if (success) {
      metrics.successfulRequests++;
    } else {
      metrics.failedRequests++;
    }

    // Update average response time
    metrics.averageResponseTime = (
      (metrics.averageResponseTime * (metrics.totalRequests - 1) + responseTime) / 
      metrics.totalRequests
    );

    // Update error rate
    metrics.errorRate = metrics.failedRequests / metrics.totalRequests;

    // Update uptime (based on recent success rate)
    const recentRequests = Math.min(metrics.totalRequests, 100); // Last 100 requests
    const recentSuccesses = Math.min(metrics.successfulRequests, recentRequests);
    metrics.uptime = recentSuccesses / recentRequests;

    // Update health report if it exists
    const healthReport = this.healthReports.get(providerId);
    if (healthReport) {
      healthReport.metrics = { ...metrics };
      healthReport.status = this.determineHealthStatus(metrics);
      healthReport.timestamp = new Date();
      
      if (!success && error) {
        healthReport.lastError = error;
      }
    }
  }

  /**
   * Get health report for a provider
   */
  getHealthReport(providerId: string): ProviderHealthReport | undefined {
    return this.healthReports.get(providerId);
  }

  /**
   * Get health reports for all providers
   */
  getAllHealthReports(): Map<string, ProviderHealthReport> {
    return new Map(this.healthReports);
  }

  /**
   * Get provider metrics
   */
  getMetrics(providerId: string): ProviderMetrics | undefined {
    return this.metrics.get(providerId);
  }

  /**
   * Get all provider metrics
   */
  getAllMetrics(): Map<string, ProviderMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Check if a provider is healthy
   */
  isProviderHealthy(providerId: string): boolean {
    const report = this.healthReports.get(providerId);
    return report?.status === 'healthy';
  }

  /**
   * Get healthy providers
   */
  getHealthyProviders(): string[] {
    const healthyProviders: string[] = [];
    
    for (const [providerId, report] of this.healthReports.entries()) {
      if (report.status === 'healthy') {
        healthyProviders.push(providerId);
      }
    }
    
    return healthyProviders;
  }

  /**
   * Get best performing provider
   */
  getBestProvider(): string | undefined {
    let bestProvider: string | undefined;
    let bestScore = -1;

    for (const [providerId, report] of this.healthReports.entries()) {
      if (report.status === 'unhealthy') {
        continue;
      }

      // Calculate performance score (higher is better)
      const score = this.calculatePerformanceScore(report.metrics);
      
      if (score > bestScore) {
        bestScore = score;
        bestProvider = providerId;
      }
    }

    return bestProvider;
  }

  /**
   * Reset metrics for a provider
   */
  resetMetrics(providerId: string): void {
    const metrics = this.metrics.get(providerId);
    if (metrics) {
      Object.assign(metrics, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        lastResponseTime: 0,
        errorRate: 0,
        uptime: 1.0,
        lastHealthCheck: new Date()
      });
    }
  }

  /**
   * Perform health checks on all providers
   */
  private async performHealthChecks(): Promise<void> {
    const promises = Array.from(this.providers.entries()).map(([providerId, provider]) =>
      this.checkProviderHealth(providerId, provider)
    );

    await Promise.allSettled(promises);
  }

  /**
   * Check health of a single provider
   */
  private async checkProviderHealth(providerId: string, provider: AIProvider): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Validate provider configuration
      provider.validateConfig();

      // Test basic functionality with a simple request
      const testText = 'test';
      await this.withTimeout(
        provider.analyzeProfanity(testText, this.env),
        this.config.timeout
      );

      const responseTime = Date.now() - startTime;
      this.recordRequest(providerId, true, responseTime);

      // Update health report
      const metrics = this.metrics.get(providerId)!;
      const healthReport: ProviderHealthReport = {
        providerId,
        providerInfo: provider.getProviderInfo(),
        status: this.determineHealthStatus(metrics),
        metrics: { ...metrics },
        capabilities: this.detectCapabilities(provider),
        timestamp: new Date()
      };

      this.healthReports.set(providerId, healthReport);

      this.logger.debug(`Health check passed for provider: ${providerId}`, {
        responseTime,
        status: healthReport.status
      });

    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.recordRequest(providerId, false, responseTime, errorMessage);

      // Update health report
      const metrics = this.metrics.get(providerId)!;
      const healthReport: ProviderHealthReport = {
        providerId,
        providerInfo: provider.getProviderInfo(),
        status: this.determineHealthStatus(metrics),
        metrics: { ...metrics },
        lastError: errorMessage,
        capabilities: this.detectCapabilities(provider),
        timestamp: new Date()
      };

      this.healthReports.set(providerId, healthReport);

      this.logger.warn(`Health check failed for provider: ${providerId}`, {
        error: errorMessage,
        responseTime,
        status: healthReport.status
      });
    }
  }

  /**
   * Determine health status based on metrics
   */
  private determineHealthStatus(metrics: ProviderMetrics): ProviderHealthStatus {
    if (metrics.totalRequests === 0) {
      return 'unknown';
    }

    const successRate = metrics.successfulRequests / metrics.totalRequests;

    if (successRate >= this.config.healthThreshold) {
      return 'healthy';
    } else if (successRate >= this.config.degradedThreshold) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }

  /**
   * Calculate performance score for a provider
   */
  private calculatePerformanceScore(metrics: ProviderMetrics): number {
    if (metrics.totalRequests === 0) {
      return 0;
    }

    const successRate = metrics.successfulRequests / metrics.totalRequests;
    const responseTimeScore = Math.max(0, 1 - (metrics.averageResponseTime / 30000)); // Normalize to 30s max
    
    // Weighted score: 70% success rate, 30% response time
    return (successRate * 0.7) + (responseTimeScore * 0.3);
  }

  /**
   * Detect provider capabilities
   */
  private detectCapabilities(provider: AIProvider): ProviderCapabilities {
    const providerInfo = provider.getProviderInfo();
    
    // Basic capabilities - all providers should support these
    const capabilities: ProviderCapabilities = {
      summarization: true,
      profanityAnalysis: true,
      criminalCodeAnalysis: true,
      maxTokens: 4000, // Default assumption
      supportedLanguages: ['ru', 'en'], // Default assumption
      responseFormats: ['text', 'json']
    };

    // Adjust based on provider type
    if (providerInfo.name === 'openai') {
      capabilities.maxTokens = 8000;
      capabilities.responseFormats = ['text', 'json'];
    } else if (providerInfo.name === 'openai-premium') {
      capabilities.maxTokens = 16000;
      capabilities.responseFormats = ['text', 'json'];
    } else if (providerInfo.name === 'cloudflare') {
      capabilities.maxTokens = 4000;
      capabilities.responseFormats = ['text'];
    }

    return capabilities;
  }

  /**
   * Execute function with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }
}