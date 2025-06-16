export interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
  DB: D1Database;
  AI: any;
  TOKEN: string;
  SECRET: string;
  SUMMARY_MODEL: string;
  SUMMARY_PROMPT: string;
  SUMMARY_CHUNK_SIZE?: number;
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
