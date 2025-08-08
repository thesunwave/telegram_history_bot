import worker from "../src/index";
import { Env, DEFAULT_KV_BATCH_SIZE, DEFAULT_KV_BATCH_DELAY } from "../src/env";
import { KVNamespace } from "@miniflare/kv";
import { MemoryStorage } from "@miniflare/storage-memory";

export const testWorker = {
  fetch: worker.fetch,
  scheduled: worker.scheduled,
};

/**
 * Creates a mock environment with all required fields for testing
 */
export function createMockEnv(overrides: Partial<Env> = {}): Env {
  const history = new KVNamespace(new MemoryStorage());

  const defaultEnv: Env = {
    HISTORY: history as any,
    COUNTERS: {} as any,
    COUNTERS_DO: {} as any,
    MESSAGE_FETCHER_DO: {} as any,
    DB: {} as any,
    AI: {} as any,
    TOKEN: "test-token",
    SECRET: "test-secret",
    SUMMARY_MODEL: "test-model",
    SUMMARY_PROMPT: "Test prompt",
    KV_BATCH_SIZE: DEFAULT_KV_BATCH_SIZE,
    KV_BATCH_DELAY: DEFAULT_KV_BATCH_DELAY,
  };

  return { ...defaultEnv, ...overrides };
}
