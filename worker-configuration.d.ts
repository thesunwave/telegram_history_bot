interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
  COUNTERS_DO: DurableObjectNamespace;
  DB: D1Database;
  AI: any;
  TOKEN: string;
  SECRET: string;
  SUMMARY_MODEL: string;
  SUMMARY_PROMPT: string;
  SUMMARY_SYSTEM?: string;
  SUMMARY_CHUNK_SIZE?: number;
  SUMMARY_MAX_TOKENS?: number;
  SUMMARY_TEMPERATURE?: number;
  SUMMARY_TOP_P?: number;
  SUMMARY_FREQUENCY_PENALTY?: number;
}

interface DurableObjectId {}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface DurableObjectStorage {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string }): Promise<Map<string, string>>;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  get<T>(key: string, options: { type: 'json' }): Promise<T | null>;
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; cursor?: string }>;
}

interface D1Database {
  prepare(query: string): any;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}

interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
  waitUntil(promise: Promise<any>): void;
}
