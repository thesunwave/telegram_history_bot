/**
 * Provider Manager
 * Manages multiple AI providers with failover, load balancing, and health monitoring
 */

import type { Env } from '../env';
import type { 
  AIProvider, 
  SummaryRequest, 
  SummaryOptions, 
  ProfanityAnalysisResult, 
  CriminalAnalysisResult,
  ProviderInfo
} from './ai-provider';
import { ProviderFactory, type ProviderType } from './provider-factory';
import { ProviderHealthMonitor, type ProviderHealthReport } from './provider-health-monitor';
import { Logger } from '../logger';
import { AppError } from '../utils/errors';

/**
 * Provider configuration
 */
export interface ProviderConfig {
  type: ProviderType;
  priority: number; // Higher number = higher priority
  weight: number; // For load balancing (0-1)
  enabled: boolean;
  maxRetries: number;
  timeout: number; // milliseconds
}

/**
 * Failover strategy
 */
export type FailoverStrategy = 'priority' | 'round-robin' | 'performance' | 'random';

/**
 * Provider manager configuration
 */
export interface ProviderManagerConfig {
  providers: ProviderConfig[];
  failoverStrategy: FailoverStrategy;
  maxRetries: number;
  retryDelay: number; // milliseconds
  enableHealthMonitoring: boolean;
  healthCheckInterval: number; // milliseconds
}

/**
 * Request context for provider selection
 */
export interface RequestContext {
  operation: 'summarize' | 'analyzeProfanity' | 'analyzeCriminalCode';
  priority: 'low' | 'medium' | 'high';
  timeout?: number;
  retryCount?: number;
}

/**
 * Provider execution result
 */
export interface ProviderExecutionResult<T> {
  result: T;
  providerId: string;
  responseTime: number;
  retryCount: number;
  errors: string[];
}

/**
 * Provider Manager
 */
export class ProviderManager {
  private logger: Logger;
  private providers = new Map<string, AIProvider>();
  private configs = new Map<string, ProviderConfig>();
  private healthMonitor: ProviderHealthMonitor;
  private roundRobinIndex = 0;
  private initialized = false;

  constructor(
    private env: Env,
    private config: ProviderManagerConfig
  ) {
    this.logger = new Logger(env);
    this.healthMonitor = new ProviderHealthMonitor(env);
  }

  /**
   * Initialize the provider manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new AppError('PROVIDER_MANAGER_ALREADY_INITIALIZED', 'Provider manager is already initialized');
    }

    try {
      this.logger.info('Initializing provider manager', {
        providersCount: this.config.providers.length,
        failoverStrategy: this.config.failoverStrategy,
        healthMonitoring: this.config.enableHealthMonitoring
      });

      // Initialize providers
      for (const providerConfig of this.config.providers) {
        if (!providerConfig.enabled) {
          continue;
        }

        try {
          const provider = ProviderFactory.createProvider(this.env);
          const providerId = this.generateProviderId(providerConfig.type);
          
          // Validate provider configuration
          provider.validateConfig();
          
          this.providers.set(providerId, provider);
          this.configs.set(providerId, providerConfig);
          
          // Register with health monitor
          if (this.config.enableHealthMonitoring) {
            this.healthMonitor.registerProvider(providerId, provider);
          }

          this.logger.info(`Initialized provider: ${providerId}`, {
            type: providerConfig.type,
            priority: providerConfig.priority,
            weight: providerConfig.weight
          });

        } catch (error: unknown) {
          this.logger.error(`Failed to initialize provider: ${providerConfig.type}`, {
            error: error instanceof Error ? error.message : String(error)
          });
          
          // Continue with other providers instead of failing completely
          continue;
        }
      }

      if (this.providers.size === 0) {
        throw new AppError('NO_PROVIDERS_AVAILABLE', 'No providers could be initialized');
      }

      // Start health monitoring
      if (this.config.enableHealthMonitoring) {
        this.healthMonitor.startMonitoring();
      }

      this.initialized = true;
      this.logger.info('Provider manager initialized successfully', {
        activeProviders: this.providers.size
      });

    } catch (error: unknown) {
      throw new AppError(
        'PROVIDER_MANAGER_INITIALIZATION_FAILED',
        'Failed to initialize provider manager',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Shutdown the provider manager
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Shutting down provider manager');

    // Stop health monitoring
    if (this.config.enableHealthMonitoring) {
      this.healthMonitor.stopMonitoring();
    }

    // Clear providers
    this.providers.clear();
    this.configs.clear();

    this.initialized = false;
    this.logger.info('Provider manager shut down successfully');
  }

  /**
   * Execute summarization with failover
   */
  async summarize(
    request: SummaryRequest, 
    options: SummaryOptions, 
    context?: RequestContext
  ): Promise<ProviderExecutionResult<string>> {
    return this.executeWithFailover(
      'summarize',
      async (provider) => provider.summarize(request, options, this.env),
      context
    );
  }

  /**
   * Execute profanity analysis with failover
   */
  async analyzeProfanity(
    text: string, 
    context?: RequestContext
  ): Promise<ProviderExecutionResult<ProfanityAnalysisResult>> {
    return this.executeWithFailover(
      'analyzeProfanity',
      async (provider) => provider.analyzeProfanity(text, this.env),
      context
    );
  }

  /**
   * Execute criminal code analysis with failover
   */
  async analyzeCriminalCode(
    text: string, 
    context?: RequestContext
  ): Promise<ProviderExecutionResult<CriminalAnalysisResult>> {
    return this.executeWithFailover(
      'analyzeCriminalCode',
      async (provider) => provider.analyzeCriminalCode(text, this.env),
      context
    );
  }

  /**
   * Get provider health reports
   */
  getHealthReports(): Map<string, ProviderHealthReport> {
    return this.healthMonitor.getAllHealthReports();
  }

  /**
   * Get provider information
   */
  getProviderInfo(): Map<string, ProviderInfo> {
    const info = new Map<string, ProviderInfo>();
    
    for (const [providerId, provider] of this.providers.entries()) {
      info.set(providerId, provider.getProviderInfo());
    }
    
    return info;
  }

  /**
   * Get active providers
   */
  getActiveProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if provider manager is healthy
   */
  isHealthy(): boolean {
    if (!this.initialized) {
      return false;
    }

    const healthyProviders = this.healthMonitor.getHealthyProviders();
    return healthyProviders.length > 0;
  }

  /**
   * Execute operation with failover
   */
  private async executeWithFailover<T>(
    operation: string,
    executor: (provider: AIProvider) => Promise<T>,
    context?: RequestContext
  ): Promise<ProviderExecutionResult<T>> {
    if (!this.initialized) {
      throw new AppError('PROVIDER_MANAGER_NOT_INITIALIZED', 'Provider manager is not initialized');
    }

    const maxRetries = context?.retryCount ?? this.config.maxRetries;
    const errors: string[] = [];
    let retryCount = 0;

    while (retryCount <= maxRetries) {
      const providerId = this.selectProvider(context);
      
      if (!providerId) {
        throw new AppError('NO_PROVIDER_AVAILABLE', 'No healthy provider available', { errors });
      }

      const provider = this.providers.get(providerId)!;
      const startTime = Date.now();

      try {
        this.logger.debug(`Executing ${operation} with provider: ${providerId}`, {
          retryCount,
          maxRetries
        });

        const result = await this.withTimeout(
          executor(provider),
          context?.timeout ?? this.configs.get(providerId)?.timeout ?? 30000
        );

        const responseTime = Date.now() - startTime;

        // Record successful request
        if (this.config.enableHealthMonitoring) {
          this.healthMonitor.recordRequest(providerId, true, responseTime);
        }

        this.logger.debug(`Successfully executed ${operation} with provider: ${providerId}`, {
          responseTime,
          retryCount
        });

        return {
          result,
          providerId,
          responseTime,
          retryCount,
          errors
        };

      } catch (error: unknown) {
        const responseTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`${providerId}: ${errorMessage}`);

        // Record failed request
        if (this.config.enableHealthMonitoring) {
          this.healthMonitor.recordRequest(providerId, false, responseTime, errorMessage);
        }

        this.logger.warn(`Failed to execute ${operation} with provider: ${providerId}`, {
          error: errorMessage,
          responseTime,
          retryCount,
          maxRetries
        });

        retryCount++;

        // Wait before retry (except for last attempt)
        if (retryCount <= maxRetries) {
          await this.delay(this.config.retryDelay);
        }
      }
    }

    throw new AppError(
      'ALL_PROVIDERS_FAILED',
      `All providers failed for operation: ${operation}`,
      { errors, retryCount }
    );
  }

  /**
   * Select provider based on strategy
   */
  private selectProvider(context?: RequestContext): string | undefined {
    const availableProviders = Array.from(this.providers.keys());
    
    if (availableProviders.length === 0) {
      return undefined;
    }

    // Filter out unhealthy providers if health monitoring is enabled
    let candidateProviders = availableProviders;
    if (this.config.enableHealthMonitoring) {
      const healthyProviders = this.healthMonitor.getHealthyProviders();
      if (healthyProviders.length > 0) {
        candidateProviders = healthyProviders;
      }
      // If no healthy providers, fall back to all providers
    }

    switch (this.config.failoverStrategy) {
      case 'priority':
        return this.selectByPriority(candidateProviders);
      
      case 'round-robin':
        return this.selectRoundRobin(candidateProviders);
      
      case 'performance':
        return this.selectByPerformance(candidateProviders);
      
      case 'random':
        return this.selectRandom(candidateProviders);
      
      default:
        return candidateProviders[0];
    }
  }

  /**
   * Select provider by priority
   */
  private selectByPriority(providers: string[]): string {
    let bestProvider = providers[0];
    let highestPriority = this.configs.get(bestProvider)?.priority ?? 0;

    for (const providerId of providers) {
      const priority = this.configs.get(providerId)?.priority ?? 0;
      if (priority > highestPriority) {
        highestPriority = priority;
        bestProvider = providerId;
      }
    }

    return bestProvider;
  }

  /**
   * Select provider using round-robin
   */
  private selectRoundRobin(providers: string[]): string {
    const provider = providers[this.roundRobinIndex % providers.length];
    this.roundRobinIndex = (this.roundRobinIndex + 1) % providers.length;
    return provider;
  }

  /**
   * Select provider by performance
   */
  private selectByPerformance(providers: string[]): string {
    if (!this.config.enableHealthMonitoring) {
      return this.selectByPriority(providers);
    }

    const bestProvider = this.healthMonitor.getBestProvider();
    return bestProvider && providers.includes(bestProvider) ? bestProvider : providers[0];
  }

  /**
   * Select provider randomly
   */
  private selectRandom(providers: string[]): string {
    const randomIndex = Math.floor(Math.random() * providers.length);
    return providers[randomIndex];
  }

  /**
   * Generate provider ID
   */
  private generateProviderId(type: ProviderType): string {
    const timestamp = Date.now();
    return `${type}-${timestamp}`;
  }

  /**
   * Execute function with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Operation timeout')), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create default configuration
   */
  static createDefaultConfig(): ProviderManagerConfig {
    return {
      providers: [
        {
          type: 'cloudflare',
          priority: 1,
          weight: 0.6,
          enabled: true,
          maxRetries: 3,
          timeout: 30000
        },
        {
          type: 'openai',
          priority: 2,
          weight: 0.4,
          enabled: true,
          maxRetries: 3,
          timeout: 30000
        }
      ],
      failoverStrategy: 'priority',
      maxRetries: 3,
      retryDelay: 1000,
      enableHealthMonitoring: true,
      healthCheckInterval: 300000 // 5 minutes
    };
  }
}