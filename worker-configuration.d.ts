type ProviderType = 'cloudflare' | 'openai';

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
  SUMMARY_PROVIDER?: ProviderType;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

interface DurableObjectId {}
interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
