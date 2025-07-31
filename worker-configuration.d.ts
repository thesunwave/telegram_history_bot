interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
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
  UPDATES?: Queue;
}

interface Queue {
  send(message: string | ArrayBuffer): Promise<void>;
}

interface QueueMessage<Data = unknown> {
  body: Data;
  ack(): Promise<void>;
  retry(): Promise<void>;
}

interface QueueMessageBatch<Data = unknown> {
  messages: QueueMessage<Data>[];
  ackAll(): Promise<void>;
  retryAll(): Promise<void>;
}
