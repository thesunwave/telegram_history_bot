import { describe, it, expect, beforeEach, vi } from "vitest";
import { ProviderInitializer } from "../../src/providers/provider-init";
import { CloudflareAIProvider } from "../../src/providers/cloudflare-provider";
import { OpenAIProvider } from "../../src/providers/openai-provider";
import { Env } from "../../src/env";

// Mock console methods to capture logs
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();
const mockConsoleWarn = vi.fn();

vi.stubGlobal("console", {
  log: mockConsoleLog,
  error: mockConsoleError,
  warn: mockConsoleWarn,
  debug: vi.fn(),
});

describe("ProviderInitializer", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    ProviderInitializer.reset();

    mockEnv = {
      SUMMARY_PROVIDER: "cloudflare",
      SUMMARY_MODEL: "test-model",
      AI: {
        run: vi.fn().mockResolvedValue({ response: "Test summary response" }),
      } as any,
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
      DEBUG_LOGS: "false",
    } as Env;
  });

  describe("initializeProvider", () => {
    it("should initialize Cloudflare provider successfully", async () => {
      const provider = await ProviderInitializer.initializeProvider(mockEnv);

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "Provider initialization started",
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "Provider initialization completed",
        expect.any(Object),
      );
    });

    it("should initialize OpenAI provider successfully", async () => {
      (mockEnv as any).SUMMARY_PROVIDER = "openai";
      (mockEnv as any).OPENAI_API_KEY = "test-api-key";

      const provider = await ProviderInitializer.initializeProvider(mockEnv);

      expect(provider).toBeInstanceOf(OpenAIProvider);
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
    });

    it("should handle missing AI binding gracefully", async () => {
      const envWithoutAI = {
        ...mockEnv,
        AI: undefined,
      } as any;

      await expect(
        ProviderInitializer.initializeProvider(envWithoutAI),
      ).rejects.toThrow("Provider initialization failed");

      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
      expect(mockConsoleError).toHaveBeenCalledWith(
        "Provider initialization failed",
        expect.any(Object),
      );
    });

    it("should handle missing model configuration", async () => {
      const envWithoutModel = {
        ...mockEnv,
        SUMMARY_MODEL: undefined,
      } as any;

      await expect(
        ProviderInitializer.initializeProvider(envWithoutModel),
      ).rejects.toThrow("Provider initialization failed");

      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
    });

    it("should handle invalid provider type", async () => {
      (mockEnv as any).SUMMARY_PROVIDER = "invalid-provider";

      await expect(
        ProviderInitializer.initializeProvider(mockEnv),
      ).rejects.toThrow("Provider initialization failed");

      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
    });
  });

  describe("getProvider", () => {
    it("should return initialized provider", async () => {
      // First initialize
      const initializedProvider =
        await ProviderInitializer.initializeProvider(mockEnv);

      // Then get the same instance
      const retrievedProvider = ProviderInitializer.getProvider(mockEnv);

      expect(retrievedProvider).toBe(initializedProvider);
      expect(retrievedProvider).toBeInstanceOf(CloudflareAIProvider);
    });

    it("should perform lazy initialization if not initialized", () => {
      // Don't initialize first
      const provider = ProviderInitializer.getProvider(mockEnv);

      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        "Provider not initialized, performing lazy initialization",
      );
    });

    it("should return different provider types based on configuration", () => {
      // Test Cloudflare
      const cloudflareProvider = ProviderInitializer.getProvider(mockEnv);
      expect(cloudflareProvider).toBeInstanceOf(CloudflareAIProvider);

      // Reset and test OpenAI
      ProviderInitializer.reset();
      (mockEnv as any).SUMMARY_PROVIDER = "openai";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      const openaiProvider = ProviderInitializer.getProvider(mockEnv);
      expect(openaiProvider).toBeInstanceOf(OpenAIProvider);
    });
  });

  describe("isProviderInitialized", () => {
    it("should return false when not initialized", () => {
      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
    });

    it("should return true when initialized", async () => {
      await ProviderInitializer.initializeProvider(mockEnv);
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
    });

    it("should return true after lazy initialization", () => {
      ProviderInitializer.getProvider(mockEnv);
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
    });
  });

  describe("reset", () => {
    it("should reset provider state", async () => {
      // Initialize first
      await ProviderInitializer.initializeProvider(mockEnv);
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);

      // Reset
      ProviderInitializer.reset();
      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
    });

    it("should allow re-initialization after reset", async () => {
      // Initialize, reset, and initialize again
      await ProviderInitializer.initializeProvider(mockEnv);
      ProviderInitializer.reset();

      const provider = await ProviderInitializer.initializeProvider(mockEnv);
      expect(provider).toBeInstanceOf(CloudflareAIProvider);
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
    });
  });

  describe("logProviderInfo", () => {
    it("should log provider information when initialized", async () => {
      await ProviderInitializer.initializeProvider(mockEnv);

      ProviderInitializer.logProviderInfo(mockEnv);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        "Active provider information",
        expect.objectContaining({
          provider: "cloudflare",
          model: "test-model",
          initialized: true,
        }),
      );
    });

    it("should handle logging when not initialized", () => {
      // Should perform lazy initialization and then log
      ProviderInitializer.logProviderInfo(mockEnv);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        "Active provider information",
        expect.objectContaining({
          provider: "cloudflare",
          initialized: true,
        }),
      );
    });

    it("should handle provider creation errors during logging", () => {
      const envWithError = {
        ...mockEnv,
        AI: undefined,
      } as any;

      ProviderInitializer.logProviderInfo(envWithError);

      expect(mockConsoleError).toHaveBeenCalledWith(
        "Failed to log provider information",
        expect.objectContaining({
          initialized: false,
        }),
      );
    });
  });

  describe("provider functionality validation", () => {
    it("should create provider that can validate its own config", async () => {
      const provider = await ProviderInitializer.initializeProvider(mockEnv);

      expect(() => provider.validateConfig()).not.toThrow();
    });

    it("should create provider with correct info", async () => {
      const provider = await ProviderInitializer.initializeProvider(mockEnv);
      const info = provider.getProviderInfo();

      expect(info).toHaveProperty("name");
      expect(info).toHaveProperty("model");
      expect(info.name).toBe("cloudflare");
      expect(info.model).toBe("test-model");
    });

    it("should work with different provider configurations", async () => {
      // Test Cloudflare
      let provider = await ProviderInitializer.initializeProvider(mockEnv);
      expect(provider.getProviderInfo().name).toBe("cloudflare");

      // Reset and test OpenAI
      ProviderInitializer.reset();
      (mockEnv as any).SUMMARY_PROVIDER = "openai";
      (mockEnv as any).OPENAI_API_KEY = "test-key";

      provider = await ProviderInitializer.initializeProvider(mockEnv);
      expect(provider.getProviderInfo().name).toBe("openai");
    });
  });
});
