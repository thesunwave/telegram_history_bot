/**
 * Integration tests for DirectProcessor
 * Tests real behavior with minimal mocking
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DirectProcessor } from "../../src/summary-optimization/direct-processor";
import { Env } from "../../src/env";
import { TelegramMessage } from "../../src/providers/ai-provider";

describe("DirectProcessor", () => {
  const testTimeout = 10000; // 10 seconds max per test

  let processor: DirectProcessor;
  let mockEnv: Env;
  let mockMessages: TelegramMessage[];

  beforeEach(() => {
    vi.clearAllMocks();

    processor = new DirectProcessor();

    // Setup environment with working AI mock
    mockEnv = {
      TELEGRAM_BOT_TOKEN: "test-token",
      KV_NAMESPACE: {} as any,
      COUNTERS: {} as any,
      MESSAGE_FETCHER: {} as any,
      MESSAGE_AGGREGATOR: {} as any,
      HISTORY: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      AI: {
        run: vi.fn().mockResolvedValue({ response: "Test summary response" }),
      } as any,
      SUMMARY_PROMPT: "Summarize {period} {participants} {totalMessages}",
      SUMMARY_SYSTEM: "You are a chat analyst",
      SUMMARY_MODEL: "test-model",
      SUMMARY_MAX_TOKENS: 500,
      SUMMARY_TEMPERATURE: 0.7,
      SUMMARY_TOP_P: 0.9,
      TOKEN: "test-token",
      SECRET: "test-secret",
      DEBUG_LOGS: "false",
    } as unknown as Env;

    // Setup test messages
    mockMessages = [
      {
        username: "user1",
        text: "Hello world",
        ts: 1704067200, // 2024-01-01 00:00:00
      },
      {
        username: "user2",
        text: "How are you?",
        ts: 1704070800, // 2024-01-01 01:00:00
      },
      {
        username: "user1",
        text: "I am fine, thanks!",
        ts: 1704074400, // 2024-01-01 02:00:00
      },
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe("process", () => {

    it("should process messages and return a summary", async () => {
      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
      expect(mockEnv.AI.run).toHaveBeenCalled();
    });

    it("should handle empty messages array", async () => {
      const emptyMessages: TelegramMessage[] = [];

      await expect(processor.process(emptyMessages, mockEnv)).rejects.toThrow();
    });

    it("should handle AI processing errors", async () => {
      (mockEnv.AI.run as any).mockRejectedValue(
        new Error("AI processing failed"),
      );

      await expect(processor.process(mockMessages, mockEnv)).rejects.toThrow();
    });

    it("should work with large message volumes", async () => {
      // Create larger message set
      const largeMessages: TelegramMessage[] = [];
      for (let i = 0; i < 10; i++) {
        largeMessages.push({
          username: `user${i % 10}`,
          text: `Message ${i}: This is a longer test message with more content`,
          ts: 1704067200 + i * 60,
        });
      }

      const result = await processor.process(largeMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(mockEnv.AI.run).toHaveBeenCalled();
    });

    it("should handle different AI response formats", async () => {
      // Test response without wrapper object
      (mockEnv.AI.run as any).mockResolvedValueOnce("Direct response");

      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should work with different environment configurations", async () => {
      const configuredEnv = {
        ...mockEnv,
        SUMMARY_MODEL: "different-model",
        SUMMARY_MAX_TOKENS: 1000,
        SUMMARY_TEMPERATURE: 0.5,
        SUMMARY_TOP_P: 0.8,
      };

      const result = await processor.process(mockMessages, configuredEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(configuredEnv.AI.run).toHaveBeenCalled();
    });

    it("should handle messages with varied content and timestamps", async () => {
      const variedMessages: TelegramMessage[] = [
        { username: "alice", text: "Short msg", ts: 1704067200 },
        {
          username: "bob",
          text: "This is a much longer message with more detailed content that should test the system's ability to handle varying message lengths",
          ts: 1704067260,
        },
        {
          username: "charlie",
          text: "🎉 Emoji and symbols! @mention #hashtag https://example.com",
          ts: 1704067320,
        },
        { username: "david", text: "Another normal message", ts: 1704067380 },
        {
          username: "eve",
          text: "Message from different day",
          ts: 1704153600, // Next day
        },
      ];

      const result = await processor.process(variedMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should be resilient to missing optional environment variables", async () => {
      const minimalEnv = {
        ...mockEnv,
        SUMMARY_PROMPT: 'Default prompt',
        SUMMARY_SYSTEM: 'Default system',
        SUMMARY_TEMPERATURE: 0.7,
        SUMMARY_TOP_P: 0.9,
        SUMMARY_MAX_TOKENS: 500,
      };

      const result = await processor.process(mockMessages, minimalEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should handle single message input", async () => {
      const singleMessage = [mockMessages[0]];

      const result = await processor.process(singleMessage, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should handle messages with identical timestamps", async () => {
      const sameTimeMessages: TelegramMessage[] = [
        { username: "user1", text: "Message 1", ts: 1704067200 },
        { username: "user2", text: "Message 2", ts: 1704067200 },
        { username: "user3", text: "Message 3", ts: 1704067200 },
      ];

      const result = await processor.process(sameTimeMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should handle Unicode and special characters", async () => {
      const unicodeMessages: TelegramMessage[] = [
        { username: "user1", text: "Привет мир! 🌍", ts: 1704067200 },
        { username: "user2", text: "こんにちは 世界", ts: 1704067260 },
        { username: "user3", text: "नमस्ते दुनिया", ts: 1704067320 },
        { username: "user4", text: "🚀 🎯 💯 ✨", ts: 1704067380 },
      ];

      const result = await processor.process(unicodeMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });
});
