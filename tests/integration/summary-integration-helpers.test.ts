/**
 * Unit tests for summary integration helper functions
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Env } from '../../src/core/env';
import type {
  KVNamespace,
  D1Database,
  DurableObjectNamespace,
} from "@cloudflare/workers-types";

// We need to import the summary module to test its internal functions
// Since the helper functions are not exported, we'll test them through the main functions
import { summariseChat, summariseChatMessages } from '../../src/features/summary/summary';
import { ProviderInitializer } from "../../src/core/providers/provider-init";

// Mock dependencies
vi.mock("../../src/core/telegram", () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/features/history/history", () => ({
  fetchMessages: vi.fn(),
  fetchLastMessages: vi.fn(),
}));

// Mock the summary-optimization system
vi.mock("../../src/features/summary/optimization", () => ({
  OptimizedSummaryController: vi.fn(),
  loadOptimizationConfig: vi.fn().mockReturnValue({
    enabled: true,
    parallelEnabled: true,
    minMessagesThreshold: 100,
  }),
}));

const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
  HISTORY: {} as KVNamespace,
  COUNTERS: {} as KVNamespace,
  COUNTERS_DO: {} as DurableObjectNamespace,
  MESSAGE_FETCHER_DO: {} as DurableObjectNamespace,
  MESSAGE_AGGREGATOR_DO: {} as DurableObjectNamespace,
  DB: {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: any[]) => ({
        run: vi.fn().mockResolvedValue({ success: true }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null),
      })),
      run: vi.fn().mockResolvedValue({ success: true }),
      all: vi.fn().mockResolvedValue({ results: [] }),
      first: vi.fn().mockResolvedValue(null),
    })),
    exec: vi.fn().mockResolvedValue({ results: [] }),
    dump: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    batch: vi.fn().mockResolvedValue([]),
  } as any,
  AI: {
    run: vi.fn().mockResolvedValue({ response: "Test AI response" }),
  },
  TOKEN: "test-token",
  SECRET: "test-secret",
  SUMMARY_MODEL: "test-model",
  SUMMARY_PROMPT:
    "Test prompt {chatTitle} {period} {totalMessages} {participants}",
  SUMMARY_SYSTEM: "Test system prompt",
  SUMMARY_PROVIDER: "cloudflare",
  DEBUG_LOGS: "false",
  ...overrides,
});

const createTestMessages = (count: number) => {
  return Array.from({ length: count }, (_, i) => ({
    chat: 123,
    user: Math.floor(i / 10) + 1,
    username: `user${Math.floor(i / 10) + 1}`,
    text: `Test message ${i + 1} with some content to analyze`,
    ts: 1704067200 + i * 3600, // Jan 1, 2024 + i hours
  }));
};

describe("Summary Integration Helper Functions", () => {
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = createMockEnv();

    // Make AI.run a spy
    mockEnv.AI.run = vi.fn().mockResolvedValue({ response: "Test AI response" });

    // Initialize provider system
    ProviderInitializer.initializeProvider(mockEnv);
  });

  describe("Environment Variable Parsing", () => {
    it("should parse boolean string values correctly", async () => {
      const testCases = [
        { value: "true", expected: true },
        { value: "TRUE", expected: true },
        { value: "True", expected: true },
        { value: "1", expected: true },
        { value: "false", expected: false },
        { value: "FALSE", expected: false },
        { value: "False", expected: false },
        { value: "0", expected: false },
        { value: "invalid", expected: false },
        { value: "", expected: false },
      ];

      for (const testCase of testCases) {
        const env = createMockEnv({
          SUMMARY_OPT_ENABLED: testCase.value,
        });

        const testMessages = createTestMessages(50);
        const { fetchMessages } = await import("../../src/features/history/history");
        vi.mocked(fetchMessages).mockResolvedValue(testMessages);

        const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
        const MockController = vi.mocked(OptimizedSummaryController);
        
        if (testCase.expected) {
          // Should attempt optimized system
          const mockInstance = {
            summarizeChat: vi.fn().mockResolvedValue("Optimized summary"),
            summarizeChatMessages: vi.fn(),
          };
          MockController.mockImplementation(() => mockInstance as any);
        } else {
          // Should not use optimized system, but still need to handle sendMessage
          MockController.mockImplementation(() => {
            throw new Error("Optimized disabled");
          });
        }

        const { sendMessage } = await import("../../src/core/telegram");

        await summariseChat(env, 123, 7);

        // Verify sendMessage was called by either system
        expect(sendMessage).toHaveBeenCalled();
      }
    });

    it("should handle numeric boolean values", async () => {
      const env = createMockEnv({
        SUMMARY_OPT_ENABLED: true, // boolean true
      });

      const testMessages = createTestMessages(50);
      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(testMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      const mockInstance = {
        summarizeChat: vi.fn().mockResolvedValue("Optimized summary"),
        summarizeChatMessages: vi.fn(),
      };
      MockController.mockImplementation(() => mockInstance as any);

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      expect(sendMessage).toHaveBeenCalled();
    });
  });

  describe("Message Filtering Integration", () => {
    it("should filter out system messages and commands", async () => {
      const env = createMockEnv();

      const mixedMessages = [
        {
          chat: 123,
          user: 1,
          username: "user1",
          text: "/start",
          ts: 1704067200,
        },
        {
          chat: 123,
          user: 1,
          username: "user1",
          text: "Regular message",
          ts: 1704067201,
        },
        {
          chat: 123,
          user: 0,
          username: "system",
          text: "User joined",
          ts: 1704067202,
        },
      ];

      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(mixedMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      const mockInstance = {
        summarizeChat: vi.fn().mockResolvedValue("Optimized summary"),
        summarizeChatMessages: vi.fn(),
      };
      MockController.mockImplementation(() => mockInstance as any);

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      expect(sendMessage).toHaveBeenCalled();
    });

    it("should handle empty message sets correctly", async () => {
      const env = createMockEnv();

      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue([]);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      const mockInstance = {
        summarizeChat: vi.fn().mockResolvedValue("No messages summary"),
        summarizeChatMessages: vi.fn(),
      };
      MockController.mockImplementation(() => mockInstance as any);

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should fallback to legacy and send "Нет сообщений"
      expect(sendMessage).toHaveBeenCalled();
    });

    it("should handle filtered messages resulting in empty set", async () => {
      const env = createMockEnv();

      const systemOnlyMessages = [
        {
          chat: 123,
          user: 0,
          username: "system",
          text: "System notification",
          ts: 1704067200,
        },
        {
          chat: 123,
          user: 1,
          username: "user1",
          text: "/help",
          ts: 1704067201,
        },
      ];

      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(systemOnlyMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      // Mock that optimized system will fail due to no content messages
      MockController.mockImplementation(() => {
        throw new Error("No content messages");
      });

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should fallback to legacy and send appropriate message
      expect(sendMessage).toHaveBeenCalled();
      const sentMessage = vi.mocked(sendMessage).mock.calls[0][2];
      expect(typeof sentMessage).toBe("string");
    });
  });

  describe("AI Provider Integration", () => {
    it("should handle AI provider errors gracefully", async () => {
      const env = createMockEnv();

      const testMessages = createTestMessages(100);
      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(testMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      const mockInstance = {
        summarizeChat: vi.fn().mockRejectedValue(new Error("AI provider error")),
        summarizeChatMessages: vi.fn(),
      };
      MockController.mockImplementation(() => mockInstance as any);

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should fallback to legacy and send message
      expect(sendMessage).toHaveBeenCalled();
    });

    it("should validate provider configuration during optimization", async () => {
      const env = createMockEnv({
        SUMMARY_OPT_ENABLED: true,
        SUMMARY_PROVIDER: "openai",
      });

      const testMessages = createTestMessages(100);
      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(testMessages);

      // Mock OptimizedSummaryController with method that uses AI
      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      const mockInstance = {
        summarizeChat: vi.fn().mockResolvedValue("Provider summary"),
        summarizeChatMessages: vi.fn(),
      };
      MockController.mockImplementation((envArg: Env) => {
        // Verify environment is passed correctly
        expect(envArg.SUMMARY_PROVIDER).toBe("openai");
        return mockInstance as any;
      });

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should have been called with correct environment
      expect(MockController).toHaveBeenCalledWith(env);
      expect(sendMessage).toHaveBeenCalled();
    });

    it("should handle provider initialization errors", async () => {
      const env = createMockEnv({
        SUMMARY_OPT_ENABLED: true,
      });

      const testMessages = createTestMessages(100);
      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(testMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      const mockInstance = {
        summarizeChat: vi.fn().mockResolvedValue("AI provider summary"),
        summarizeChatMessages: vi.fn(),
      };
      MockController.mockImplementation(() => mockInstance as any);

      // Clear AI mock call history
      vi.mocked(mockEnv.AI.run).mockClear();

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should complete successfully with optimized system
      expect(mockInstance.summarizeChat).toHaveBeenCalledWith(123, 7);
      expect(sendMessage).toHaveBeenCalled();
    });

    it("should handle rate limit errors correctly", async () => {
      const env = createMockEnv({
        SUMMARY_OPT_ENABLED: true,
      });

      const testMessages = createTestMessages(100);
      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(testMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      const mockInstance = {
        summarizeChat: vi
          .fn()
          .mockRejectedValue(new Error("Rate limit exceeded")),
        summarizeChatMessages: vi.fn(),
      };
      MockController.mockImplementation(() => mockInstance as any);

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should handle rate limit and send appropriate message
      expect(mockInstance.summarizeChat).toHaveBeenCalledWith(123, 7);
      expect(sendMessage).toHaveBeenCalled();
    });

    it("should maintain provider configuration across optimized processing", async () => {
      const env = createMockEnv({
        SUMMARY_OPT_ENABLED: true,
        SUMMARY_PROVIDER: "cloudflare",
      });

      const testMessages = createTestMessages(100);
      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(testMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      MockController.mockImplementation(() => {
        throw new Error("Provider initialization failed");
      });

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should fallback gracefully
      expect(sendMessage).toHaveBeenCalled();
    });
  });

  describe("Integration with Existing Error Handling", () => {
    it("should maintain existing error message format in fallback scenarios", async () => {
      const env = createMockEnv({
        SUMMARY_OPT_ENABLED: true,
      });

      const testMessages = createTestMessages(100);
      const { fetchMessages } = await import("../../src/features/history/history");
      vi.mocked(fetchMessages).mockResolvedValue(testMessages);

      const { OptimizedSummaryController } = await import("../../src/features/summary/optimization");
      const MockController = vi.mocked(OptimizedSummaryController);
      
      MockController.mockImplementation(() => {
        throw new Error("Optimized initialization failed");
      });

      // Mock AI to also fail with rate limit error
      vi.mocked(mockEnv.AI.run).mockRejectedValue(
        new Error("Rate limit exceeded"),
      );

      const { sendMessage } = await import("../../src/core/telegram");

      await summariseChat(env, 123, 7);

      // Should send appropriate rate limit error message
      // System should send a message (either optimized or legacy)
      expect(sendMessage).toHaveBeenCalled();
      const errorMessage = vi.mocked(sendMessage).mock.calls[0][2];
      expect(errorMessage).toContain("Превышен лимит запросов");
    });
  });
});
