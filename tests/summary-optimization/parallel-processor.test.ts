/**
 * Tests for ParallelProcessor
 *
 * Covers the parallel chunk-and-aggregate summary strategy, focusing on the
 * coverage-ratio gate that surfaces severe partial chunk failure as a throw
 * (so the controller's legacy fallback can run) and on the coverage indicator
 * propagated into the aggregation prompt.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ParallelProcessor } from "../../src/features/summary/optimization/parallel-processor";
import { loadOptimizationConfig } from "../../src/features/summary/optimization/config";
import { TelegramMessage } from "../../src/core/providers/ai-provider";
import { Env } from "../../src/core/env";

const createMessages = (count: number): TelegramMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    username: `user${i % 5}`,
    text: `Message ${i + 1}: some test content`,
    ts: 1704067200 + i * 60,
  }));

const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
  TELEGRAM_BOT_TOKEN: "test-token",
  KV_NAMESPACE: {} as any,
  COUNTERS: {} as any,
  COUNTERS_DO: {} as any,
  DB: {} as any,
  AI: { run: vi.fn() } as any,
  MESSAGE_FETCHER: {} as any,
  MESSAGE_AGGREGATOR: {} as any,
  HISTORY: {} as any,
  SUMMARY_PROMPT:
    "Test prompt {chatTitle} {period} {totalMessages} {participants} {limitMessages}",
  SUMMARY_SYSTEM: "Test system prompt",
  SUMMARY_MODEL: "test-model",
  SUMMARY_MAX_TOKENS: 500,
  SUMMARY_TEMPERATURE: 0.1,
  SUMMARY_TOP_P: 0.9,
  TOKEN: "test-token",
  SECRET: "test-secret",
  DEBUG_LOGS: "false",
  ...overrides,
} as unknown as Env);

interface RunMockOpts {
  totalChunks: number;
  failCount: number;
  aggregationResult?: string;
  envOverrides?: Partial<Env>;
}

function setupRun(opts: RunMockOpts) {
  let callCount = 0;
  const run = vi.fn(async (_model: string, _aiOptions: any) => {
    const idx = callCount++;
    if (idx < opts.totalChunks) {
      if (idx < opts.failCount) {
        throw new Error("OpenAI API rate limit exceeded");
      }
      return { response: `chunk ${idx} summary` };
    }
    return { response: opts.aggregationResult ?? "AGGREGATED FINAL SUMMARY" };
  });
  const env = createMockEnv({ AI: { run } as any, ...opts.envOverrides });
  return { env, run };
}

describe("ParallelProcessor", () => {
  let processor: ParallelProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new ParallelProcessor();
  });

  describe("coverage gate", () => {
    it("throws when all chunks fail (zero survivors)", async () => {
      const messages = createMessages(50);
      const { env, run } = setupRun({
        totalChunks: 10,
        failCount: 10,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      await expect(processor.process(messages, env)).rejects.toThrow(
        /All parallel chunks failed to produce a summary/,
      );
      expect(run.mock.calls.length).toBe(10);
    });

    it("throws when survivor coverage collapses below the threshold (2/20 from the report)", async () => {
      const messages = createMessages(1000);
      const { env, run } = setupRun({
        totalChunks: 20,
        failCount: 18,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "50" } as any,
      });

      let caught: Error | undefined;
      try {
        await processor.process(messages, env, { chatId: 42 });
      } catch (e) {
        caught = e as Error;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught!.message).toMatch(/coverage collapsed/);
      expect(caught!.message).toContain("2/20 chunks succeeded");
      expect(caught!.message).toMatch(/10\.0% below minimum 50\.0%/);
      expect(run.mock.calls.length).toBe(20);
    });

    it("throws when a single survivor covers too little (1/20)", async () => {
      const messages = createMessages(1000);
      const { env, run } = setupRun({
        totalChunks: 20,
        failCount: 19,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "50" } as any,
      });

      await expect(processor.process(messages, env)).rejects.toThrow(
        /coverage collapsed/,
      );
      expect(run.mock.calls.length).toBe(20);
    });

    it("uses message coverage when the final chunk is much smaller", async () => {
      const messages = createMessages(51);
      const { env, run } = setupRun({
        totalChunks: 2,
        failCount: 1,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "50" } as any,
      });

      await expect(processor.process(messages, env)).rejects.toThrow(
        /1\/2 chunks succeeded.*~1\/51 messages.*2\.0% below minimum 50\.0%/,
      );
      expect(run.mock.calls.length).toBe(2);
    });

    it("does NOT throw at the exact threshold boundary (5/10) and aggregates", async () => {
      const messages = createMessages(50);
      const { env, run } = setupRun({
        totalChunks: 10,
        failCount: 5,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      const result = await processor.process(messages, env);
      expect(result).toBe(
        "⚠️ Неполное покрытие: 5/10 частичных сводок (~25 из 50 сообщений).\n\n" +
          "AGGREGATED FINAL SUMMARY",
      );
      expect(run.mock.calls.length).toBe(11);
    });

    it("throws just below the boundary (4/10)", async () => {
      const messages = createMessages(50);
      const { env, run } = setupRun({
        totalChunks: 10,
        failCount: 6,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      await expect(processor.process(messages, env)).rejects.toThrow(
        /4\/10 chunks succeeded.*40\.0% below minimum 50\.0%/,
      );
      expect(run.mock.calls.length).toBe(10);
    });

    it("coverage-collapse error propagates so callers (SummaryController) can fall back", async () => {
      const messages = createMessages(50);
      const { env } = setupRun({
        totalChunks: 10,
        failCount: 8,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      let caught: unknown;
      try {
        await processor.process(messages, env);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/coverage collapsed/);
    });
  });

  describe("configurable threshold", () => {
    it("honours a higher configured threshold (0.7): 6/10 throws, 7/10 aggregates", async () => {
      const messages = createMessages(50);
      const envOverrides = {
        SUMMARY_OPT_WORKER_BATCH_SIZE: "5",
        SUMMARY_OPT_MIN_CHUNK_COVERAGE: "0.7",
      } as any;

      const fail6 = setupRun({ totalChunks: 10, failCount: 4, envOverrides });
      await expect(processor.process(messages, fail6.env)).rejects.toThrow(
        /6\/10 chunks succeeded.*60\.0% below minimum 70\.0%/,
      );

      const fail3 = setupRun({ totalChunks: 10, failCount: 3, envOverrides });
      const result = await processor.process(messages, fail3.env);
      expect(result).toBe(
        "⚠️ Неполное покрытие: 7/10 частичных сводок (~35 из 50 сообщений).\n\n" +
          "AGGREGATED FINAL SUMMARY",
      );
      expect(fail3.run.mock.calls.length).toBe(11);
    });

    it("parses SUMMARY_OPT_MIN_CHUNK_COVERAGE as a float (string and number)", () => {
      const envStr = createMockEnv({ SUMMARY_OPT_MIN_CHUNK_COVERAGE: "0.7" } as any);
      expect(loadOptimizationConfig(envStr).parallelProcessing.minCoverageRatio).toBe(0.7);

      const envNum = createMockEnv({ SUMMARY_OPT_MIN_CHUNK_COVERAGE: 0.25 } as any);
      expect(loadOptimizationConfig(envNum).parallelProcessing.minCoverageRatio).toBe(0.25);
    });

    it("rejects invalid SUMMARY_OPT_MIN_CHUNK_COVERAGE values", () => {
      const tooLow = createMockEnv({ SUMMARY_OPT_MIN_CHUNK_COVERAGE: "0" } as any);
      expect(() => loadOptimizationConfig(tooLow)).toThrow(
        /SUMMARY_OPT_MIN_CHUNK_COVERAGE must be between 0\.01 and 1/,
      );

      const tooHigh = createMockEnv({ SUMMARY_OPT_MIN_CHUNK_COVERAGE: "1.5" } as any);
      expect(() => loadOptimizationConfig(tooHigh)).toThrow(
        /SUMMARY_OPT_MIN_CHUNK_COVERAGE must be between 0\.01 and 1/,
      );
    });

    it("defaults to 0.5 when SUMMARY_OPT_MIN_CHUNK_COVERAGE is not set", () => {
      const env = createMockEnv();
      expect(loadOptimizationConfig(env).parallelProcessing.minCoverageRatio).toBe(0.5);
    });
  });

  describe("aggregation prompt coverage indicator", () => {
    const aggregationPrompt = (run: any, totalChunks: number): string =>
      run.mock.calls[totalChunks][1].prompt as string;

    it("full coverage: includes N/N and covered=asked, no partial warning", async () => {
      const messages = createMessages(50);
      const { env, run } = setupRun({
        totalChunks: 10,
        failCount: 0,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      const result = await processor.process(messages, env);
      expect(result).toBe("AGGREGATED FINAL SUMMARY");
      expect(run.mock.calls.length).toBe(11);

      const prompt = aggregationPrompt(run, 10);
      expect(prompt).toContain("ℹ️ Покрытие: 10/10 частичных сводок");
      expect(prompt).toContain("~50 из 50 сообщений");
      expect(prompt).not.toContain("Покрытие неполное");
    });

    it("partial coverage above threshold: includes survivor/total and a partial warning", async () => {
      const messages = createMessages(50);
      const { env, run } = setupRun({
        totalChunks: 10,
        failCount: 3,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      const result = await processor.process(messages, env);
      expect(result).toBe(
        "⚠️ Неполное покрытие: 7/10 частичных сводок (~35 из 50 сообщений).\n\n" +
          "AGGREGATED FINAL SUMMARY",
      );

      const prompt = aggregationPrompt(run, 10);
      expect(prompt).toContain("ℹ️ Покрытие: 7/10 частичных сводок");
      expect(prompt).toContain("~35 из 50 сообщений");
      expect(prompt).toContain("Покрытие неполное");
    });

    it("aggregation is NOT invoked when coverage collapses", async () => {
      const messages = createMessages(50);
      const { env, run } = setupRun({
        totalChunks: 10,
        failCount: 7,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      await expect(processor.process(messages, env)).rejects.toThrow();
      expect(run.mock.calls.length).toBe(10);
    });
  });

  describe("lone-survivor path", () => {
    it("warns when a single surviving chunk has adequate but partial coverage (1/2)", async () => {
      const messages = createMessages(10);
      const { env, run } = setupRun({
        totalChunks: 2,
        failCount: 1,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      const result = await processor.process(messages, env);
      expect(result).toBe(
        "⚠️ Неполное покрытие: 1/2 частичных сводок (~5 из 10 сообщений).\n\n" +
          "chunk 1 summary",
      );
      expect(run.mock.calls.length).toBe(2);
    });

    it("throws when the lone survivor covers too little (1/10)", async () => {
      const messages = createMessages(50);
      const { env, run } = setupRun({
        totalChunks: 10,
        failCount: 9,
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      await expect(processor.process(messages, env)).rejects.toThrow(
        /coverage collapsed/,
      );
      expect(run.mock.calls.length).toBe(10);
    });
  });

  describe("happy path", () => {
    it("aggregates all chunk summaries into a final summary", async () => {
      const messages = createMessages(20);
      const { env, run } = setupRun({
        totalChunks: 4,
        failCount: 0,
        aggregationResult: "FINAL COMBINED SUMMARY",
        envOverrides: { SUMMARY_OPT_WORKER_BATCH_SIZE: "5" } as any,
      });

      const result = await processor.process(messages, env, { chatId: 7 });
      expect(result).toBe("FINAL COMBINED SUMMARY");
      expect(run.mock.calls.length).toBe(5);
      expect(typeof result).toBe("string");
    });
  });
});
