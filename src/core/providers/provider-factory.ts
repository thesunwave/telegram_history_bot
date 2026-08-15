import { Env } from "../env";
import { AIProvider } from "./ai-provider";
import { CloudflareAIProvider } from "./cloudflare-provider";
import { LegalRagProvider } from "./legal-rag-provider";
import { OpenAIProvider } from "./openai-provider";
import { OpenRouterProvider } from "./openrouter-provider";
import { MockProvider } from "./mock-provider";

export type ProviderType = 'cloudflare' | 'openai' | 'openrouter' | 'legal-rag' | 'mock';
export type ProviderCapability = 'summary' | 'profanity' | 'criminal';

export class ProviderFactory {
  private static readonly SUPPORTED_PROVIDERS: ProviderType[] = ['cloudflare', 'openai', 'openrouter', 'legal-rag', 'mock'];
  private static readonly DEFAULT_PROVIDER: ProviderType = 'cloudflare';
  private static readonly PROVIDER_ENV_BY_CAPABILITY: Record<ProviderCapability, string> = {
    summary: 'SUMMARY_PROVIDER',
    profanity: 'PROFANITY_PROVIDER',
    criminal: 'CRIMINAL_PROVIDER',
  };
  private static readonly MODEL_ENV_BY_CAPABILITY: Record<ProviderCapability, string> = {
    summary: 'SUMMARY_MODEL',
    profanity: 'PROFANITY_MODEL',
    criminal: 'CRIMINAL_MODEL',
  };

  /**
   * Creates an AI provider instance based on capability-specific configuration.
   * Falls back to SUMMARY_PROVIDER when a dedicated provider is not configured.
   * @param env - Environment configuration object
   * @param capability - Feature that will use the provider (defaults to "summary")
   * @returns AIProvider instance
   * @throws Error if provider type is unsupported
   */
  static createProvider(env: Env, capability: ProviderCapability = 'summary'): AIProvider {
    const providerType = this.getProviderType(env, capability);
    const modelOverride = this.getModelOverride(env, capability);

    this.validateProviderType(providerType);

    switch (providerType as ProviderType) {
      case 'cloudflare':
        return new CloudflareAIProvider(env, modelOverride);
      case 'openai':
        return new OpenAIProvider(env, modelOverride);
      case 'openrouter':
        return new OpenRouterProvider(env, modelOverride);
      case 'legal-rag':
        return new LegalRagProvider(env);
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
   * @param capability - Feature that will use the provider
   * @returns ProviderType
   */
  private static getProviderType(env: Env, capability: ProviderCapability): string {
    const providerKey = this.PROVIDER_ENV_BY_CAPABILITY[capability];
    const envProvider = (env as any)[providerKey] ?? (env as any).SUMMARY_PROVIDER;

    if (!envProvider) {
      return this.DEFAULT_PROVIDER;
    }

    // Convert to string and lowercase for case-insensitive comparison
    return String(envProvider).toLowerCase();
  }

  /**
   * Gets model override for capability if configured.
   * @param env - Environment configuration object
   * @param capability - Feature that will use the provider
   */
  private static getModelOverride(env: Env, capability: ProviderCapability): string | undefined {
    // Summary already uses provider-specific model settings; keep overrides for specialized flows
    if (capability === 'summary') {
      return undefined;
    }
    const modelKey = this.MODEL_ENV_BY_CAPABILITY[capability];
    const override = (env as any)[modelKey];
    if (typeof override === 'string' && override.trim().length > 0) {
      return override.trim();
    }
    return undefined;
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
