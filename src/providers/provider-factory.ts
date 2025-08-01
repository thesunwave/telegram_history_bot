import { Env } from "../env";
import { AIProvider } from "./ai-provider";
import { CloudflareAIProvider } from "./cloudflare-provider";
import { OpenAIProvider } from "./openai-provider";

export type ProviderType = 'cloudflare' | 'openai';

export class ProviderFactory {
  private static readonly SUPPORTED_PROVIDERS: ProviderType[] = ['cloudflare', 'openai'];
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
        return new OpenAIProvider(env);
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
}