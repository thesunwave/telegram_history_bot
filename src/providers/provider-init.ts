import { Env } from "../env";
import { AIProvider, ProviderError } from "./ai-provider";
import { ProviderFactory } from "./provider-factory";

/**
 * Provider initialization and validation utilities
 */
export class ProviderInitializer {
  private static instance: AIProvider | null = null;
  private static isInitialized = false;

  /**
   * Initialize and validate the AI provider on application startup
   * @param env - Environment configuration
   * @returns Promise<AIProvider> - Initialized and validated provider
   * @throws Error if provider initialization or validation fails
   */
  static async initializeProvider(env: Env): Promise<AIProvider> {
    try {
      console.log("Provider initialization started");
      
      // Create provider instance
      const provider = ProviderFactory.createProvider(env);
      const providerInfo = provider.getProviderInfo();
      
      console.log("Provider created", {
        provider: providerInfo.name,
        model: providerInfo.model,
        version: providerInfo.version,
      });
      
      // Validate provider configuration
      provider.validateConfig();
      
      console.log("Provider configuration validated successfully", {
        provider: providerInfo.name,
        model: providerInfo.model,
      });
      
      // Cache the initialized provider
      this.instance = provider;
      this.isInitialized = true;
      
      console.log("Provider initialization completed", {
        provider: providerInfo.name,
        model: providerInfo.model,
        supportedProviders: ProviderFactory.getSupportedProviders(),
        defaultProvider: ProviderFactory.getDefaultProvider(),
      });
      
      return provider;
    } catch (error: any) {
      const errorMessage = error instanceof ProviderError 
        ? `Provider error (${error.provider}): ${error.message}`
        : `Provider initialization failed: ${error.message || String(error)}`;
      
      console.error("Provider initialization failed", {
        error: errorMessage,
        stack: error.stack,
        supportedProviders: ProviderFactory.getSupportedProviders(),
        defaultProvider: ProviderFactory.getDefaultProvider(),
      });
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Get the initialized provider instance
   * @param env - Environment configuration (used for lazy initialization if needed)
   * @returns AIProvider instance
   * @throws Error if provider is not initialized
   */
  static getProvider(env: Env): AIProvider {
    if (!this.isInitialized || !this.instance) {
      console.warn("Provider not initialized, performing lazy initialization");
      // For backward compatibility, create provider on-demand
      // This should ideally not happen if proper initialization is done
      return ProviderFactory.createProvider(env);
    }
    
    return this.instance;
  }

  /**
   * Check if provider is initialized
   * @returns boolean indicating initialization status
   */
  static isProviderInitialized(): boolean {
    return this.isInitialized && this.instance !== null;
  }

  /**
   * Reset provider state (mainly for testing)
   */
  static reset(): void {
    this.instance = null;
    this.isInitialized = false;
  }

  /**
   * Log current provider information
   * @param env - Environment configuration
   */
  static logProviderInfo(env: Env): void {
    try {
      const provider = this.getProvider(env);
      const providerInfo = provider.getProviderInfo();
      
      console.log("Active provider information", {
        provider: providerInfo.name,
        model: providerInfo.model,
        version: providerInfo.version,
        initialized: this.isInitialized,
      });
    } catch (error: any) {
      console.error("Failed to log provider information", {
        error: error.message || String(error),
        initialized: this.isInitialized,
      });
    }
  }
}