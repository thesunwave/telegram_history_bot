/**
 * Unit tests for DirectProcessor
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { DirectProcessor } from "../../src/summary-optimization/direct-processor";
import { Env } from "../../src/env";
import { TelegramMessage } from "../../src/providers/ai-provider";

describe("DirectProcessor", () => {
  let processor: DirectProcessor;
  let mockEnv: Env;
  let mockMessages: TelegramMessage[];

  beforeEach(() => {
    // Create processor instance
    processor = new DirectProcessor();

    // Setup mock environment with proper AI binding
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
      SUMMARY_PROMPT: "Test prompt {period} {participants} {totalMessages}",
      SUMMARY_SYSTEM: "Test system prompt",
      SUMMARY_MODEL: "test-model",
      SUMMARY_MAX_TOKENS: 500,
      SUMMARY_TEMPERATURE: 0.7,
      SUMMARY_TOP_P: 0.9,
      TOKEN: "test-token",
      SECRET: "test-secret",
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

  describe("process", () => {
    it("should process messages and return summary", async () => {
      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(mockEnv.AI.run).toHaveBeenCalled();
    });

    it("should handle empty messages array", async () => {
      const emptyMessages: TelegramMessage[] = [];

      await expect(processor.process(emptyMessages, mockEnv)).rejects.toThrow();
    });

    it("should handle AI errors gracefully", async () => {
      (mockEnv.AI.run as any).mockRejectedValueOnce(
        new Error("AI processing failed"),
      );

      await expect(processor.process(mockMessages, mockEnv)).rejects.toThrow();
    });
  });
});
