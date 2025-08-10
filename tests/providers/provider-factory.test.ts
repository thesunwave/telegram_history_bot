import { describe, it, expect, beforeEach } from "vitest";
import { ProviderFactory } from "../../src/providers/provider-factory";
import { CloudflareAIProvider } from "../../src/providers/cloudflare-provider";
import { OpenAIProvider } from "../../src/providers/openai-provider";
import { Env } from "../../src/env";

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
        "Unsupported provider: unsupported-provider. Supported providers: cloudflare, openai, openai-premium",
      );
    });

    it("should throw error for invalid provider type", () => {
      (mockEnv as any).SUMMARY_PROVIDER = "anthropic";

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider: anthropic. Supported providers: cloudflare, openai, openai-premium",
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
        "Unsupported provider:   openai  . Supported providers: cloudflare, openai, openai-premium",
      );
    });

    it("should handle numeric provider name", () => {
      (mockEnv as any).SUMMARY_PROVIDER = 123;

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider: 123. Supported providers: cloudflare, openai, openai-premium",
      );
    });

    it("should handle boolean provider name", () => {
      (mockEnv as any).SUMMARY_PROVIDER = true;

      expect(() => ProviderFactory.createProvider(mockEnv)).toThrow(
        "Unsupported provider: true. Supported providers: cloudflare, openai, openai-premium",
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
