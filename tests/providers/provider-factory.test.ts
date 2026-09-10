import { describe, it, expect, beforeEach } from "vitest";
import { ProviderFactory } from "../../src/core/providers/provider-factory";
import { CloudflareAIProvider } from "../../src/core/providers/cloudflare-provider";
import { LegalRagProvider } from "../../src/core/providers/legal-rag-provider";
import { OpenAIProvider } from "../../src/core/providers/openai-provider";
import { OpenRouterProvider } from "../../src/core/providers/openrouter-provider";
import { Env } from '../../src/core/env';

describe("ProviderFactory", () => {
  let mockEnv: Env;

  beforeEach(() => {
    mockEnv = {
      AI: {
        run: () => Promise.resolve({ response: "test response" }),
      } as any,
      SUMMARY_MODEL: "test-model",
      SUMMARY_PROMPT: "Test prompt",
      SUMMARY_SYSTEM: "Test system",
      SUMMARY_MAX_TOKENS: 500,
      SUMMARY_TEMPERATURE: 0.7,
      SUMMARY_TOP_P: 0.9,
      HISTORY: {} as any,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      LEGAL_RAG_INDEX: { query: () => Promise.resolve({ matches: [] }) } as any,
      TOKEN: "test-token",
      SECRET: "test-secret",
    } as Env;
  });

  describe("createProvider", () => {
    it('should create CloudflareAIProvider when SUMMARY_PROVIDER is "cloudflare"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = "cloudflare";

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(provider.getProviderInfo().name).toBe("cloudflare");
    });

    it('should create OpenAIProvider when SUMMARY_PROVIDER is "openai"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = "openai";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getProviderInfo().name).toBe("openai");
    });

    it('should create OpenAIProvider with premium when SUMMARY_PROVIDER is "openai-premium"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = "openai-premium";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getProviderInfo().name).toBe("openai-premium");
    });

    it('should create OpenRouterProvider when SUMMARY_PROVIDER is "openrouter"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = "openrouter";
      (mockEnv as any).OPENROUTER_API_KEY = "test-key";

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(OpenRouterProvider);
      expect(provider.getProviderInfo().name).toBe("openrouter");
    });

    it('should create LegalRagProvider when CRIMINAL_PROVIDER is "legal-rag"', () => {
      (mockEnv as any).SUMMARY_PROVIDER = "cloudflare";
      (mockEnv as any).CRIMINAL_PROVIDER = "legal-rag";

      const provider = ProviderFactory.createProvider(mockEnv, "criminal");

      expect(provider).toBeInstanceOf(LegalRagProvider);
      expect(provider.getProviderInfo().name).toBe("legal-rag");
    });

    it("should create CloudflareAIProvider when SUMMARY_PROVIDER is undefined (default fallback)", () => {
      // SUMMARY_PROVIDER is not set, should default to cloudflare
      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(provider.getProviderInfo().name).toBe("cloudflare");
    });

    it("should create CloudflareAIProvider when SUMMARY_PROVIDER is empty string (default fallback)", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "";

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(provider.getProviderInfo().name).toBe("cloudflare");
    });

    it("should handle case-insensitive provider names", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "OPENAI";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getProviderInfo().name).toBe("openai");
    });

    it("should handle mixed case provider names", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "CloudFlare";

      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(provider.getProviderInfo().name).toBe("cloudflare");
    });

    it("should throw error for unsupported provider type", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "unsupported-provider";

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider: unsupported-provider. Supported providers: cloudflare, openai, openai-premium, openrouter, legal-rag, mock",
      );
    });

    it("should throw error for invalid provider type", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "anthropic";

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider: anthropic. Supported providers: cloudflare, openai, openai-premium, openrouter, legal-rag, mock",
      );
    });

    it("should throw error for null provider type", () => {
      (mockEnv as any).SUMMARY_PROVIDER = null;

      // null should be treated as falsy and default to cloudflare
      const provider = ProviderFactory.createProvider(mockEnv);

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(provider.getProviderInfo().name).toBe("cloudflare");
    });
  });

  describe("getSupportedProviders", () => {
    it("should return array of supported provider types", () => {
      const supportedProviders = ProviderFactory.getSupportedProviders();

      expect(supportedProviders).toEqual([
        "cloudflare",
        "openai",
        "openai-premium",
        "openrouter",
        "legal-rag",
        "mock",
      ]);
      expect(Array.isArray(supportedProviders)).toBe(true);
    });

    it("should return a copy of the supported providers array", () => {
      const supportedProviders1 = ProviderFactory.getSupportedProviders();
      const supportedProviders2 = ProviderFactory.getSupportedProviders();

      expect(supportedProviders1).not.toBe(supportedProviders2);
      expect(supportedProviders1).toEqual(supportedProviders2);
    });
  });

  describe("getDefaultProvider", () => {
    it('should return "cloudflare" as default provider', () => {
      const defaultProvider = ProviderFactory.getDefaultProvider();

      expect(defaultProvider).toBe("cloudflare");
    });
  });

  describe("provider validation and edge cases", () => {
    it("should validate cloudflare provider configuration", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "cloudflare";

      const provider = ProviderFactory.createProvider(mockEnv);

      // Should not throw when validating config
      expect(() => provider.validateConfig()).not.toThrow();
    });

    it("should handle whitespace in provider name", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "  openai  ";

      // Should fail because we don't trim whitespace
      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider:   openai  . Supported providers: cloudflare, openai, openai-premium, openrouter, legal-rag, mock",
      );
    });

    it("should handle numeric provider name", () => {
      (mockEnv as any).SUMMARY_PROVIDER = 123;

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider: 123. Supported providers: cloudflare, openai, openai-premium, openrouter, legal-rag, mock",
      );
    });

    it("should handle boolean provider name", () => {
      (mockEnv as any).SUMMARY_PROVIDER = true;

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider: true. Supported providers: cloudflare, openai, openai-premium, openrouter, legal-rag, mock",
      );
    });

    it("should create working providers that can get provider info", () => {
      const cloudflareProvider = ProviderFactory.createProvider(mockEnv);
      const info1 = cloudflareProvider.getProviderInfo();

      expect(info1).toHaveProperty("name");
      expect(info1).toHaveProperty("model");
      expect(info1.name).toBe("cloudflare");
      expect(info1.model).toBe("test-model");

      (mockEnv as any).SUMMARY_PROVIDER = "openai";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      const openaiProvider = ProviderFactory.createProvider(mockEnv);
      const info2 = openaiProvider.getProviderInfo();

      expect(info2).toHaveProperty("name");
      expect(info2).toHaveProperty("model");
      expect(info2.name).toBe("openai");
    });

    it("should use capability-specific provider when configured", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "cloudflare";
      (mockEnv as any).PROFANITY_PROVIDER = "openai";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      const provider = ProviderFactory.createProvider(mockEnv, "profanity");

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getProviderInfo().name).toBe("openai");
    });

    it("should apply capability-specific model override", () => {
      (mockEnv as any).PROFANITY_PROVIDER = "openai";
      (mockEnv as any).PROFANITY_MODEL = "gpt-4.1";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      const provider = ProviderFactory.createProvider(mockEnv, "profanity");

      expect(provider.getProviderInfo().model).toBe("gpt-4.1");
    });

    it("should fall back to SUMMARY_PROVIDER when capability-specific provider is empty string", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "openai";
      (mockEnv as any).OPENAI_API_KEY = "test-key";
      (mockEnv as any).CRIMINAL_PROVIDER = "";

      const provider = ProviderFactory.createProvider(mockEnv, "criminal");

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(provider.getProviderInfo().name).toBe("openai");
    });

    it("should default to cloudflare when capability var and SUMMARY_PROVIDER are both empty/unset", () => {
      (mockEnv as any).CRIMINAL_PROVIDER = "";

      const provider = ProviderFactory.createProvider(mockEnv, "criminal");

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(provider.getProviderInfo().name).toBe("cloudflare");
    });

    it("should handle missing required configuration gracefully", () => {
      // Test with missing AI binding for Cloudflare
      const envWithoutAI = {
        ...mockEnv,
        AI: undefined,
      } as any;

      const provider = ProviderFactory.createProvider(envWithoutAI);

      expect(() => provider.validateConfig()).toThrow(
        "AI binding is required for Cloudflare provider",
      );
    });
  });
});
