export type ProviderType = "cloudflare" | "openai" | "openai-premium";

export interface Env {
  HISTORY: import("@cloudflare/workers-types").KVNamespace;
  COUNTERS: import("@cloudflare/workers-types").KVNamespace;
  COUNTERS_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  MESSAGE_FETCHER_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  MESSAGE_AGGREGATOR_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  // Added DayBlockManager Durable Object binding
  DAY_BLOCK_MANAGER_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  DB: import("@cloudflare/workers-types").D1Database;
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
  SUMMARY_SEED?: number;
  SUMMARY_PROVIDER?: ProviderType;
  PROFANITY_SYSTEM_PROMPT?: string;
  PROFANITY_USER_PROMPT?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  DEBUG_LOGS?: string;
  KV_BATCH_SIZE?: number;
  KV_BATCH_DELAY?: number;
  LARGE_DATASET_BATCH_SIZE?: number;
  LARGE_DATASET_BATCH_DELAY?: number;
  VERY_LARGE_DATASET_BATCH_SIZE?: number;
  VERY_LARGE_DATASET_BATCH_DELAY?: number;
  ADMIN_USER_ID?: string;

  // Optimized summary system configuration
  SUMMARY_OPT_ENABLED?: string | boolean;
  SUMMARY_OPT_PARALLEL_ENABLED?: string | boolean;
  SUMMARY_OPT_MIN_MESSAGES_THRESHOLD?: string | number;
  SUMMARY_OPT_MAX_WORKERS?: string | number;
  SUMMARY_OPT_WORKER_BATCH_SIZE?: string | number;
  SUMMARY_OPT_WORKER_TIMEOUT?: string | number;
  SUMMARY_OPT_MAX_TOKENS_PER_REQUEST?: string | number;
  SUMMARY_OPT_PREPROCESSING_MAX_TOKENS?: string | number;
  SUMMARY_OPT_FINAL_MAX_TOKENS?: string | number;
  SUMMARY_OPT_TOKEN_ESTIMATION_FACTOR?: string | number;
  SUMMARY_OPT_HIERARCHICAL_ENABLED?: string | boolean;
  SUMMARY_OPT_CHUNK_SIZE_THRESHOLD?: string | number;
  SUMMARY_OPT_PREPROCESSING_PROMPT?: string;
  SUMMARY_OPT_MAX_PREPROCESSING_CHUNKS?: string | number;
  SUMMARY_OPT_ENABLE_DETAILED_METRICS?: string | boolean;
  SUMMARY_OPT_LOG_PERFORMANCE_INSIGHTS?: string | boolean;
  SUMMARY_OPT_TRACK_TOKEN_USAGE?: string | boolean;
}

export interface DurableObjectId {}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export interface StoredMessage {
  chat: number;
  user: number;
  username: string;
  text: string;
  ts: number;
}

export interface DayBlock {
  date: string; // YYYY-MM-DD format
  chatId: number;
  messages: StoredMessage[];
  messageCount: number;
  lastUpdated: number;
  version: number; // For optimistic locking
  checksum?: string; // For data integrity verification
}

export const DAY = 86400;
export const TELEGRAM_LIMIT = 4096;
export const LOG_ID_RADIX = 36;
export const DEFAULT_SUMMARY_CHUNK_SIZE = 8000;
export const MAX_LAST_MESSAGES = 40;
export const WEEK_DAYS = 6; // lookback days for weekly stats
export const MONTH_DAYS = 27; // lookback days for monthly stats
export const DEFAULT_KV_BATCH_SIZE = 50; // Conservative default for KV request batching
export const DEFAULT_KV_BATCH_DELAY = 0; // No delay between batches by default
export const LARGE_DATASET_BATCH_SIZE = 25; // More conservative batch size for large datasets
export const LARGE_DATASET_BATCH_DELAY = 200; // Minimum delay for large datasets
export const VERY_LARGE_DATASET_BATCH_SIZE = 15; // Very conservative batch size for very large datasets  
export const VERY_LARGE_DATASET_BATCH_DELAY = 500; // Longer delay for very large datasets
