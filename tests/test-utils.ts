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

/**
 * Disables all console logging to prevent infinite recursion in tests
 */
export function disableConsoleLogging() {
  const noop = () => {};
  console.log = noop;
  console.debug = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
}

/**
 * Restores original console logging functions
 */
export function restoreConsoleLogging() {
  const originalConsole = console.constructor.prototype;
  console.log = originalConsole.log;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
}

/**
 * Creates a safe mock environment with logging disabled
 */
export function createSafeMockEnv(overrides: Partial<Env> = {}): Env {
  const env = createMockEnv({
    DEBUG_LOGS: "false",
    ...overrides,
  });

  return env;
}
