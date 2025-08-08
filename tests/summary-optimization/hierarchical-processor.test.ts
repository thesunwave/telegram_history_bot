/**
 * Unit tests for HierarchicalProcessor
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { HierarchicalProcessor } from "../../src/summary-optimization/hierarchical-processor";
import { TelegramMessage } from "../../src/providers/ai-provider";
import { Env } from "../../src/env";

describe("HierarchicalProcessor", () => {
  let processor: HierarchicalProcessor;
  let mockEnv: Env;
  let mockMessages: TelegramMessage[];

  beforeEach(() => {
    // Create processor instance
    processor = new HierarchicalProcessor();

    // Setup mock environment with proper AI binding
    mockEnv = {
      TELEGRAM_BOT_TOKEN: "test-token",
      KV_NAMESPACE: {} as any,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      AI: {
        run: vi.fn().mockResolvedValue({ response: "Test AI response" }),
      } as any,
      MESSAGE_FETCHER: {} as any,
      MESSAGE_AGGREGATOR: {} as any,
      SUMMARY_PROMPT: "Test final prompt {period} {participants} {totalMessages}",
      SUMMARY_SYSTEM: "Test final system prompt",
      SUMMARY_MODEL: "test-model",
      SUMMARY_MAX_TOKENS: 500,
      SUMMARY_TEMPERATURE: 0.7,
      SUMMARY_TOP_P: 0.9,
      HISTORY: {} as any,
      TOKEN: "test-token",
      SECRET: "test-secret",
    } as unknown as Env;

    // Setup test messages
    mockMessages = [];
    for (let i = 0; i < 50; i++) {
      mockMessages.push({
        username: `user${i % 5}`,
        text: `Message ${i}: Test content`,
        ts: 1704067200 + i * 60,
      });
    }
  });

  describe("process", () => {
    it("should process large message volumes using hierarchical approach", async () => {
      // Setup sequential AI responses
      (mockEnv.AI.run as any)
        .mockResolvedValueOnce({ response: "Chunk 1 summary" })
        .mockResolvedValueOnce({ response: "Chunk 2 summary" })
        .mockResolvedValueOnce({ response: "Final summary" });

      const result = await processor.process(mockMessages, mockEnv);

      expect(result).toBeTruthy();
      expect(typeof result).toBe("string");
      expect(mockEnv.AI.run).toHaveBeenCalled();
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
      (mockEnv.AI.run as any).mockRejectedValueOnce(new Error("AI processing failed"));

      await expect(processor.process(mockMessages, mockEnv)).rejects.toThrow();
    });
  });
});
