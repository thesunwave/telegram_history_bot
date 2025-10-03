/**
 * Base Service Interface and Implementation
 * Provides common functionality for all services including health checks and lifecycle management
 */

import type { Env } from '../env';
import type { ManagedService, ServiceLifecycleHooks } from './di-container';
import { BaseAppError } from '../utils/errors';
import { Logger } from '../logger';

/**
 * Service health status
 */
export interface ServiceHealth {
  isHealthy: boolean;
  lastCheck: Date;
  details?: Record<string, any>;
  error?: string;
}

/**
 * Service configuration interface
 */
export interface ServiceConfig {
  name: string;
  version?: string;
  description?: string;
  dependencies?: string[];
  healthCheckInterval?: number; // in milliseconds
}

/**
 * Base service interface that all services should implement
 */
export interface IBaseService extends ManagedService {
  readonly config: ServiceConfig;
  readonly health: ServiceHealth;
  
  // Lifecycle methods
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Health check
  checkHealth(): Promise<ServiceHealth>;
  
  // Configuration validation
  validateConfig(): Promise<boolean>;
}

/**
 * Abstract base service implementation
 */
export abstract class BaseService implements IBaseService {
  protected env: Env;
  protected logger: Logger;
  private _health: ServiceHealth;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(
    env: Env,
    public readonly config: ServiceConfig
  ) {
    this.env = env;
    try {
      this.logger = new Logger(env);
    } catch (error: unknown) {
      // Fallback to console logging if Logger initialization fails
      this.logger = {
        debug: (msg: string, data?: any) => {
          if (typeof console !== 'undefined' && console.debug) console.debug(msg, data);
        },
        info: (msg: string, data?: any) => {
          if (typeof console !== 'undefined' && console.info) console.info(msg, data);
        },
        warn: (msg: string, data?: any) => {
          if (typeof console !== 'undefined' && console.warn) console.warn(msg, data);
        },
        error: (msg: string, data?: any) => {
          if (typeof console !== 'undefined' && console.error) console.error(msg, data);
        }
      } as any;
    }
    this._health = {
      isHealthy: false,
      lastCheck: new Date(),
      details: {}
    };
  }

  /**
   * Service name for DI container
   */
  get serviceName(): string {
    return this.config.name;
  }

  /**
   * Current health status
   */
  get health(): ServiceHealth {
    return { ...this._health };
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    try {
      this.logger.debug(`Initializing service: ${this.serviceName}`);
      
      // Validate configuration
      const isConfigValid = await this.validateConfig();
      if (!isConfigValid) {
        throw new BaseAppError(
          'INVALID_SERVICE_CONFIG',
          `Invalid configuration for service: ${this.serviceName}`,
          { context: { serviceName: this.serviceName, config: this.config } }
        );
      }

      // Perform service-specific initialization
      await this.onInitialize();

      // Start health check timer if interval is specified
      if (this.config.healthCheckInterval && this.config.healthCheckInterval > 0) {
        this.startHealthCheckTimer();
      }

      // Initial health check
      await this.checkHealth();

      this.logger.info(`Service initialized successfully: ${this.serviceName}`);
    } catch (error: unknown) {
      this.logger.error(`Failed to initialize service: ${this.serviceName}`, { error });
      throw error;
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    try {
      this.logger.debug(`Shutting down service: ${this.serviceName}`);

      // Stop health check timer
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = undefined;
      }

      // Perform service-specific cleanup
      await this.onShutdown();

      // Update health status
      this._health = {
        isHealthy: false,
        lastCheck: new Date(),
        details: { status: 'shutdown' }
      };

      this.logger.info(`Service shut down successfully: ${this.serviceName}`);
    } catch (error: unknown) {
      this.logger.error(`Error during service shutdown: ${this.serviceName}`, { error });
      throw error;
    }
  }

  /**
   * Perform health check
   */
  async checkHealth(): Promise<ServiceHealth> {
    try {
      const startTime = Date.now();
      
      // Perform service-specific health check
      const isHealthy = await this.onHealthCheck();
      
      const responseTime = Date.now() - startTime;
      
      this._health = {
        isHealthy,
        lastCheck: new Date(),
        details: {
          responseTime,
          version: this.config.version,
          dependencies: this.config.dependencies
        }
      };

      if (!isHealthy) {
        this.logger.warn(`Health check failed for service: ${this.serviceName}`, {
          responseTime,
          details: this._health.details
        });
      }

    } catch (error: unknown) {
      this._health = {
        isHealthy: false,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : String(error),
        details: {
          error: error instanceof Error ? error.stack : String(error)
        }
      };

      this.logger.error(`Health check error for service: ${this.serviceName}`, { error });
    }

    return this.health;
  }

  /**
   * Validate service configuration
   */
  async validateConfig(): Promise<boolean> {
    try {
      // Basic validation
      if (!this.config.name || typeof this.config.name !== 'string') {
        return false;
      }

      // Perform service-specific validation
      return await this.onValidateConfig();
    } catch (error: unknown) {
      this.logger.error(`Configuration validation failed for service: ${this.serviceName}`, { error });
      return false;
    }
  }

  /**
   * Lifecycle hook: called during service initialization
   */
  protected abstract onInitialize(): Promise<void>;

  /**
   * Lifecycle hook: called during service shutdown
   */
  protected abstract onShutdown(): Promise<void>;

  /**
   * Lifecycle hook: called during health check
   */
  protected abstract onHealthCheck(): Promise<boolean>;

  /**
   * Lifecycle hook: called during configuration validation
   */
  protected abstract onValidateConfig(): Promise<boolean>;

  /**
   * DI Container lifecycle hooks
   */
  async onInit(): Promise<void> {
    await this.initialize();
  }

  async onDestroy(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Start periodic health check timer
   */
  private startHealthCheckTimer(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.checkHealth();
      } catch (error: unknown) {
        this.logger.error(`Periodic health check failed for service: ${this.serviceName}`, { error });
      }
    }, this.config.healthCheckInterval!);
  }

  /**
   * Create error with service context
   */
  protected createError(code: string, message: string, details?: Record<string, any>): BaseAppError {
    return new BaseAppError(code, message, {
      context: {
        serviceName: this.serviceName,
        ...details
      }
    });
  }

  /**
   * Log with service context
   */
  protected log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: Record<string, any>): void {
    const contextData = {
      service: this.serviceName,
      ...data
    };

    switch (level) {
      case 'debug':
        this.logger.debug(message, contextData);
        break;
      case 'info':
        this.logger.info(message, contextData);
        break;
      case 'warn':
        this.logger.warn(message, contextData);
        break;
      case 'error':
        this.logger.error(message, contextData);
        break;
    }
  }
}

/**
 * Simple service implementation for services that don't need complex lifecycle management
 */
export abstract class SimpleService extends BaseService {
  constructor(env: Env, name: string, version?: string) {
    super(env, {
      name,
      version: version || '1.0.0',
      description: `${name} service`
    });
  }

  protected async onInitialize(): Promise<void> {
    // Default implementation - override if needed
  }

  protected async onShutdown(): Promise<void> {
    // Default implementation - override if needed
  }

  protected async onHealthCheck(): Promise<boolean> {
    // Default implementation - always healthy
    return true;
  }

  protected async onValidateConfig(): Promise<boolean> {
    // Default implementation - always valid
    return true;
  }
}