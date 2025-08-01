export interface Env {
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
