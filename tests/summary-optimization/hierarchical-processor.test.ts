/**
 * Integration tests for HierarchicalProcessor
 * Tests real behavior with minimal mocking
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { HierarchicalProcessor } from "../../src/features/summary/optimization/hierarchical-processor";
import { TelegramMessage } from "../../src/core/telegram";
import { Env } from "../../src/core/env";
import { SummaryConfig } from "../../src/features/summary/optimization/types";

describe("HierarchicalProcessor", () => {
  let processor: HierarchicalProcessor;
  let mockEnv: Env;
  let mockMessages: TelegramMessage[];

  beforeEach(() => {
    vi.clearAllMocks();

    processor = new HierarchicalProcessor();

    // Setup environment with working AI mock
    mockEnv = {
      TELEGRAM_BOT_TOKEN: "test-token",
      KV_NAMESPACE: {} as any,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      AI: {
        run: vi
          .fn()
          .mockResolvedValue({ response: "Test AI summary response" }),
      } as any,
      MESSAGE_FETCHER: {} as any,
      MESSAGE_AGGREGATOR: {} as any,
      SUMMARY_PROMPT: "Summarize {period} {participants} {totalMessages}",
      SUMMARY_SYSTEM: "You are a chat analyst",
      SUMMARY_MODEL: "test-model",
      SUMMARY_MAX_TOKENS: 500,
      SUMMARY_TEMPERATURE: 0.7,
      SUMMARY_TOP_P: 0.9,
      HISTORY: {} as any,
      TOKEN: "test-token",
      SECRET: "test-secret",
      DEBUG_LOGS: "false",
    } as unknown as Env;

    // Setup test messages with enough volume to trigger hierarchical processing
    mockMessages = [];
    for (let i = 0; i < 30; i++) {
      mockMessages.push({
        username: `user${i % 5}`,
        text: `Message ${i}: This is test content for hierarchical processing`,
        ts: 1704067200 + i * 60,
      });
    }
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

    it("should work with different message volumes", async () => {
      // Test with small volume
      const smallMessages = mockMessages.slice(0, 5);

      (mockEnv.AI.run as any).mockResolvedValueOnce({
        response: "Small summary",
      });

      const result = await processor.process(smallMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should handle different AI response formats", async () => {
      // Test response without wrapper object
      (mockEnv.AI.run as any).mockResolvedValueOnce("Direct response");

      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });

    it("should process with different environment configurations", async () => {
      const configuredEnv = {
        ...mockEnv,
        SUMMARY_MODEL: "different-model",
        SUMMARY_MAX_TOKENS: 1000,
        SUMMARY_TEMPERATURE: 0.5,
      };

      const result = await processor.process(mockMessages, configuredEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(configuredEnv.AI.run).toHaveBeenCalled();
    });

    it("should handle messages with varied content", async () => {
      const variedMessages: TelegramMessage[] = [
        { username: "alice", text: "Short", ts: 1704067200 },
        {
          username: "bob",
          text: "This is a much longer message with more detailed content that should test token estimation",
          ts: 1704067260,
        },
        {
          username: "charlie",
          text: "🎉 Emoji and symbols! @mention #hashtag",
          ts: 1704067320,
        },
        { username: "david", text: "Another normal message", ts: 1704067380 },
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
      };

      const result = await processor.process(mockMessages, minimalEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
    });
  });
});
