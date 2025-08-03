import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFactory, ProviderType } from '../../src/providers/provider-factory';
import { CloudflareAIProvider } from '../../src/providers/cloudflare-provider';
import { OpenAIProvider } from '../../src/providers/openai-provider';
import { Env } from '../../src/env';

// Mock the provider classes
vi.mock('../../src/providers/cloudflare-provider');
vi.mock('../../src/providers/openai-provider');

describe('ProviderFactory', () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockEnv = {
      AI: {} as any,
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'Test prompt',
      SUMMARY_SYSTEM: 'Test system',
      HISTORY: {} as any,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      TOKEN: 'test-token',
      SECRET: 'test-secret'
    };
  });

  describe('createProvider', () => {
    it('should create CloudflareAIProvider when SUMMARY_PROVIDER is "cloudflare"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 'cloudflare';

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(CloudflareAIProvider).toHaveBeenCalledWith(mockEnv);
      expect(provider).toBeInstanceOf(CloudflareAIProvider);
    });

    it('should create OpenAIProvider when SUMMARY_PROVIDER is "openai"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 'openai';

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(OpenAIProvider).toHaveBeenCalledWith(mockEnv, 'standard');
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should create OpenAIProvider with premium when SUMMARY_PROVIDER is "openai-premium"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 'openai-premium';

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(OpenAIProvider).toHaveBeenCalledWith(mockEnv, 'premium');
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should create CloudflareAIProvider when SUMMARY_PROVIDER is undefined (default fallback)', () => {
      // SUMMARY_PROVIDER is not set, should default to cloudflare
      const provider = ProviderFactory.createProvider(mockEnv);

      expect(CloudflareAIProvider).toHaveBeenCalledWith(mockEnv);
      expect(provider).toBeInstanceOf(CloudflareAIProvider);
    });

    it('should create CloudflareAIProvider when SUMMARY_PROVIDER is empty string (default fallback)', () => {
      (mockEnv as any).SUMMARY_PROVIDER = '';

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(CloudflareAIProvider).toHaveBeenCalledWith(mockEnv);
      expect(provider).toBeInstanceOf(CloudflareAIProvider);
    });

    it('should handle case-insensitive provider names', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 'OPENAI';

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(OpenAIProvider).toHaveBeenCalledWith(mockEnv, 'standard');
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should handle mixed case provider names', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 'CloudFlare';

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(CloudflareAIProvider).toHaveBeenCalledWith(mockEnv);
      expect(provider).toBeInstanceOf(CloudflareAIProvider);
    });

    it('should throw error for unsupported provider type', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 'unsupported-provider';

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        'Unsupported provider: unsupported-provider. Supported providers: cloudflare, openai, openai-premium'
      );
    });

    it('should throw error for invalid provider type', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 'anthropic';

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        'Unsupported provider: anthropic. Supported providers: cloudflare, openai, openai-premium'
      );
    });

    it('should throw error for null provider type', () => {
      (mockEnv as any).SUMMARY_PROVIDER = null;

      // null should be treated as falsy and default to cloudflare
      const provider = ProviderFactory.createProvider(mockEnv);

      expect(CloudflareAIProvider).toHaveBeenCalledWith(mockEnv);
      expect(provider).toBeInstanceOf(CloudflareAIProvider);
    });
  });

  describe('getSupportedProviders', () => {
    it('should return array of supported provider types', () => {
      const supportedProviders = ProviderFactory.getSupportedProviders();

      expect(supportedProviders).toEqual(['cloudflare', 'openai', 'openai-premium']);
      expect(Array.isArray(supportedProviders)).toBe(true);
    });

    it('should return a copy of the supported providers array', () => {
      const supportedProviders1 = ProviderFactory.getSupportedProviders();
      const supportedProviders2 = ProviderFactory.getSupportedProviders();

      expect(supportedProviders1).not.toBe(supportedProviders2);
      expect(supportedProviders1).toEqual(supportedProviders2);
    });
  });

  describe('getDefaultProvider', () => {
    it('should return "cloudflare" as default provider', () => {
      const defaultProvider = ProviderFactory.getDefaultProvider();

      expect(defaultProvider).toBe('cloudflare');
    });
  });

  describe('provider type validation', () => {
    it('should validate all supported provider types', () => {
      const supportedProviders: ProviderType[] = ['cloudflare', 'openai'];

      supportedProviders.forEach(providerType => {
        (mockEnv as any).SUMMARY_PROVIDER = providerType;
        
        expect(() => ProviderFactory.createProvider(mockEnv)).not.toThrow();
      });
    });

    it('should reject unsupported provider types', () => {
      const unsupportedProviders = ['anthropic', 'cohere', 'huggingface', 'invalid'];

      unsupportedProviders.forEach(providerType => {
        (mockEnv as any).SUMMARY_PROVIDER = providerType;
        
        expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
          `Unsupported provider: ${providerType}. Supported providers: cloudflare, openai`
        );
      });
    });
  });

  describe('edge cases', () => {
    it('should handle whitespace in provider name', () => {
      (mockEnv as any).SUMMARY_PROVIDER = '  openai  ';

      // This should fail because we don't trim whitespace
      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        'Unsupported provider:   openai  . Supported providers: cloudflare, openai'
      );
    });

    it('should handle numeric provider name', () => {
      (mockEnv as any).SUMMARY_PROVIDER = 123;

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        'Unsupported provider: 123. Supported providers: cloudflare, openai'
      );
    });

    it('should handle boolean provider name', () => {
      (mockEnv as any).SUMMARY_PROVIDER = true;

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        'Unsupported provider: true. Supported providers: cloudflare, openai'
      );
    });
  });
});