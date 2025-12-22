import worker from "../src/index";
import { Env, DEFAULT_KV_BATCH_SIZE, DEFAULT_KV_BATCH_DELAY } from "../src/core/env";
import { KVNamespace } from "@miniflare/kv";
import { MemoryStorage } from "@miniflare/storage-memory";
import type {
  KVNamespace as CloudflareKVNamespace,
  DurableObjectNamespace,
  DurableObjectId,
  DurableObjectStub,
  D1Database,
} from "@cloudflare/workers-types";
import { vi } from "vitest";

export const testWorker = {
  fetch: worker.fetch,
  scheduled: worker.scheduled,
};

/**
 * Creates a mock KVNamespace with proper typing
 */
export function createMockKVNamespace(): CloudflareKVNamespace {
  const realKV = new KVNamespace(new MemoryStorage());
  
  return {
    get: vi.fn().mockImplementation((key: string, options?: any) => realKV.get(key, options)),
    put: vi.fn().mockImplementation((key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: any) => 
      realKV.put(key, value, options)
    ),
    delete: vi.fn().mockImplementation((key: string) => realKV.delete(key)),
    list: vi.fn().mockImplementation((options?: any) => realKV.list(options)),
    getWithMetadata: vi.fn().mockImplementation((key: string, options?: any) => realKV.getWithMetadata(key, options)),
  } as CloudflareKVNamespace;
}

/**
 * Creates a mock DurableObjectStub with proper typing
 */
export function createMockDurableObjectStub(): DurableObjectStub {
  // Provide only fetch, cast via unknown to satisfy extended interface requirements
  return {
    fetch: vi.fn().mockResolvedValue(new Response("ok", { status: 200 })),
  } as unknown as DurableObjectStub;
}

/**
 * Creates a mock DurableObjectId with proper typing
 */
export function createMockDurableObjectId(): DurableObjectId {
  return {
    toString: () => "test-id",
    equals: vi.fn().mockReturnValue(false),
  } as DurableObjectId;
}

/**
 * Creates a mock DurableObjectNamespace with proper typing
 */
export function createMockDurableObjectNamespace(): DurableObjectNamespace {
  const ns = {
    idFromName: vi.fn().mockImplementation(() => createMockDurableObjectId()),
    idFromString: vi.fn().mockImplementation(() => createMockDurableObjectId()),
    newUniqueId: vi.fn().mockImplementation(() => createMockDurableObjectId()),
    get: vi.fn().mockImplementation(() => createMockDurableObjectStub()),
    getByName: vi.fn().mockImplementation(() => createMockDurableObjectStub()),
    jurisdiction: "smart",
  } as any;
  return ns as DurableObjectNamespace;
}

/**
 * Creates a mock D1Database with proper typing
 */
export function createMockD1Database(): D1Database {
  const db: any = {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      bind: vi.fn().mockImplementation((...params: any[]) => ({
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
  };
  db.withSession = vi.fn(async (cb: any) => cb(db));
  return db as D1Database;
}

/**
 * Creates a mock AI binding with proper typing
 */
export function createMockAI() {
  return {
    run: vi.fn().mockResolvedValue({ response: "Test AI response" }),
  };
}

/**
 * Creates a mock environment with all required fields for testing
 */
export function createMockEnv(overrides: Partial<Env> = {}): Env {
  const defaultEnv: Env = {
    HISTORY: createMockKVNamespace(),
    COUNTERS: createMockKVNamespace(),
    COUNTERS_DO: createMockDurableObjectNamespace(),
    MESSAGE_FETCHER_DO: createMockDurableObjectNamespace(),
    MESSAGE_AGGREGATOR_DO: createMockDurableObjectNamespace(),
    DAY_BLOCK_MANAGER_DO: createMockDurableObjectNamespace(),
    DB: createMockD1Database(),
    AI: createMockAI(),
    TOKEN: "test-token",
    SECRET: "test-secret",
    SUMMARY_MODEL: "test-model",
    CRIMINAL_PROVIDER: "mock",
    SUMMARY_PROMPT: "Test prompt",
    KV_BATCH_SIZE: DEFAULT_KV_BATCH_SIZE,
    KV_BATCH_DELAY: DEFAULT_KV_BATCH_DELAY,
    LARGE_DATASET_BATCH_DELAY: 0,
    VERY_LARGE_DATASET_BATCH_DELAY: 0,
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
 * Creates a mock Durable Object state with proper typing
 */
export function createMockState() {
  return {
    blockConcurrencyWhile: vi.fn((fn: () => Promise<any>) => fn()),
    storage: {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    },
  };
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
