import { Env } from "../env";
import { AIProvider } from "./ai-provider";
import { CloudflareAIProvider } from "./cloudflare-provider";
import { OpenAIProvider } from "./openai-provider";
import { MockProvider } from "./mock-provider";
import { BaseAppError } from "../utils/errors";

export type ProviderType = 'cloudflare' | 'openai' | 'openai-premium' | 'mock';

/**
 * Provider configuration validation result
 */
export interface ProviderConfigValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  requiredEnvVars: string[];
  optionalEnvVars: string[];
}

export class ProviderFactory {
  private static readonly SUPPORTED_PROVIDERS: ProviderType[] = ['cloudflare', 'openai', 'openai-premium'];
  private static readonly DEFAULT_PROVIDER: ProviderType = 'cloudflare';

  /**
   * Creates an AI provider instance based on the SUMMARY_PROVIDER environment variable
   * @param env - Environment configuration object
   * @returns AIProvider instance
   * @throws Error if provider type is unsupported
   */
  static createProvider(env: Env): AIProvider {
    const providerType = this.getProviderType(env);
    
    this.validateProviderType(providerType);
    
    switch (providerType as ProviderType) {
      case 'cloudflare':
        return new CloudflareAIProvider(env);
      case 'openai':
        return new OpenAIProvider(env, 'standard');
      case 'openai-premium':
        return new OpenAIProvider(env, 'premium');
      case 'mock':
        return new MockProvider();
      default:
        // This should never happen due to validation, but TypeScript requires it
        throw new Error(`Unsupported provider: ${providerType}`);
    }
  }

  /**
   * Gets the provider type from environment, with fallback to default
   * @param env - Environment configuration object
   * @returns ProviderType
   */
  private static getProviderType(env: Env): string {
    const envProvider = (env as any).SUMMARY_PROVIDER;
    
    if (!envProvider) {
      return this.DEFAULT_PROVIDER;
    }
    
    // Convert to string and lowercase for case-insensitive comparison
    return String(envProvider).toLowerCase();
  }

  /**
   * Validates that the provider type is supported
   * @param providerType - Provider type to validate
   * @throws Error if provider type is not supported
   */
  private static validateProviderType(providerType: string): void {
    if (!this.SUPPORTED_PROVIDERS.includes(providerType as ProviderType)) {
      throw new Error(
        `Unsupported provider: ${providerType}. Supported providers: ${this.SUPPORTED_PROVIDERS.join(', ')}`
      );
    }
  }

  /**
   * Gets the list of supported provider types
   * @returns Array of supported provider types
   */
  static getSupportedProviders(): ProviderType[] {
    return [...this.SUPPORTED_PROVIDERS];
  }

  /**
   * Gets the default provider type
   * @returns Default provider type
   */
  static getDefaultProvider(): ProviderType {
    return this.DEFAULT_PROVIDER;
  }

  /**
   * Validate provider configuration
   * @param providerType - Provider type to validate
   * @param env - Environment configuration object
   * @returns Validation result
   */
  static validateProviderConfig(providerType: ProviderType, env: Env): ProviderConfigValidation {
    const result: ProviderConfigValidation = {
      isValid: true,
      errors: [],
      warnings: [],
      requiredEnvVars: [],
      optionalEnvVars: []
    };

    switch (providerType) {
      case 'cloudflare':
        result.requiredEnvVars = ['AI'];
        result.optionalEnvVars = ['CLOUDFLARE_MODEL', 'SUMMARY_MODEL'];
        
        if (!(env as any).AI) {
          result.errors.push('AI binding is required for Cloudflare provider');
          result.isValid = false;
        }
        
        const cloudflareModel = (env as any).CLOUDFLARE_MODEL || (env as any).SUMMARY_MODEL;
        if (!cloudflareModel) {
          result.errors.push('CLOUDFLARE_MODEL or SUMMARY_MODEL is required for Cloudflare provider');
          result.isValid = false;
        }
        break;

      case 'openai':
        result.requiredEnvVars = ['OPENAI_API_KEY'];
        result.optionalEnvVars = ['OPENAI_MODEL'];
        
        if (!(env as any).OPENAI_API_KEY) {
          result.errors.push('OPENAI_API_KEY is required for OpenAI provider');
          result.isValid = false;
        }
        break;

      case 'openai-premium':
        result.requiredEnvVars = ['OPENAI_PREMIUM_API_KEY', 'OPENAI_API_KEY'];
        result.optionalEnvVars = ['OPENAI_PREMIUM_MODEL', 'OPENAI_MODEL'];
        
        const premiumKey = (env as any).OPENAI_PREMIUM_API_KEY || (env as any).OPENAI_API_KEY;
        if (!premiumKey) {
          result.errors.push('OPENAI_PREMIUM_API_KEY or OPENAI_API_KEY is required for OpenAI premium provider');
          result.isValid = false;
        }
        break;

      case 'mock':
        // Mock provider doesn't require any configuration
        break;

      default:
        result.errors.push(`Unsupported provider type: ${providerType}`);
        result.isValid = false;
    }

    return result;
  }

  /**
   * Validate all supported providers
   * @param env - Environment configuration object
   * @returns Map of provider types to validation results
   */
  static validateAllProviders(env: Env): Map<ProviderType, ProviderConfigValidation> {
    const results = new Map<ProviderType, ProviderConfigValidation>();
    
    for (const providerType of this.SUPPORTED_PROVIDERS) {
      results.set(providerType, this.validateProviderConfig(providerType, env));
    }
    
    return results;
  }

  /**
   * Get available providers (those with valid configuration)
   * @param env - Environment configuration object
   * @returns Array of available provider types
   */
  static getAvailableProviders(env: Env): ProviderType[] {
    const availableProviders: ProviderType[] = [];
    
    for (const providerType of this.SUPPORTED_PROVIDERS) {
      const validation = this.validateProviderConfig(providerType, env);
      if (validation.isValid) {
        availableProviders.push(providerType);
      }
    }
    
    return availableProviders;
  }

  /**
   * Create provider with validation
   * @param env - Environment configuration object
   * @param providerType - Optional provider type (defaults to env.SUMMARY_PROVIDER)
   * @returns AIProvider instance
   * @throws BaseAppError if provider configuration is invalid
   */
  static createProviderWithValidation(env: Env, providerType?: ProviderType): AIProvider {
    const type = providerType || this.getProviderType(env);
    
    // Validate configuration before creating provider
    const validation = this.validateProviderConfig(type as ProviderType, env);
    if (!validation.isValid) {
      throw new BaseAppError(
        'INVALID_PROVIDER_CONFIG',
        `Invalid configuration for provider '${type}'`,
        { 
          context: {
            providerType: type,
            errors: validation.errors,
            requiredEnvVars: validation.requiredEnvVars
          }
        }
      );
    }
    
    return this.createProvider(env);
  }

  /**
   * Get provider capabilities
   * @param providerType - Provider type
   * @returns Provider capabilities information
   */
  static getProviderCapabilities(providerType: ProviderType): {
    maxTokens: number;
    supportedOperations: string[];
    responseFormats: string[];
    costTier: 'free' | 'paid' | 'premium';
  } {
    switch (providerType) {
      case 'cloudflare':
        return {
          maxTokens: 4000,
          supportedOperations: ['summarize', 'analyzeProfanity', 'analyzeCriminalCode'],
          responseFormats: ['text'],
          costTier: 'free'
        };
      
      case 'openai':
        return {
          maxTokens: 8000,
          supportedOperations: ['summarize', 'analyzeProfanity', 'analyzeCriminalCode'],
          responseFormats: ['text', 'json'],
          costTier: 'paid'
        };
      
      case 'openai-premium':
        return {
          maxTokens: 16000,
          supportedOperations: ['summarize', 'analyzeProfanity', 'analyzeCriminalCode'],
          responseFormats: ['text', 'json'],
          costTier: 'premium'
        };
      
      case 'mock':
        return {
          maxTokens: 1000,
          supportedOperations: ['summarize', 'analyzeProfanity', 'analyzeCriminalCode'],
          responseFormats: ['text', 'json'],
          costTier: 'free'
        };
      
      default:
        return {
          maxTokens: 0,
          supportedOperations: [],
          responseFormats: [],
          costTier: 'free'
        };
    }
  }
}