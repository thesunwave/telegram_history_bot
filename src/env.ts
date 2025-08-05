export type ProviderType = 'cloudflare' | 'openai' | 'openai-premium';

export interface Env {
  HISTORY: import("@cloudflare/workers-types").KVNamespace;
  COUNTERS: import("@cloudflare/workers-types").KVNamespace;
  COUNTERS_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
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
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  DEBUG_LOGS?: string;
  KV_BATCH_SIZE?: number;
  KV_BATCH_DELAY?: number;
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

export const DAY = 86400;
export const TELEGRAM_LIMIT = 4096;
export const LOG_ID_RADIX = 36;
export const DEFAULT_SUMMARY_CHUNK_SIZE = 8000;
export const MAX_LAST_MESSAGES = 40;
export const WEEK_DAYS = 6; // lookback days for weekly stats
export const MONTH_DAYS = 27; // lookback days for monthly stats
export const DEFAULT_KV_BATCH_SIZE = 50; // Conservative default for KV request batching
export const DEFAULT_KV_BATCH_DELAY = 0; // No delay between batches by default
