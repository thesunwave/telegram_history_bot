type ProviderType = 'cloudflare' | 'openai' | 'openai-premium' | 'openrouter' | 'legal-rag' | 'mock';

interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
  COUNTERS_DO: DurableObjectNamespace;
  DB: D1Database;
  AI: any;
  LEGAL_RAG_INDEX?: any;
  LEGAL_RAG_INGEST_KEY?: string;
  CRIMINAL_FINAL_JUDGE_ENABLED?: string | boolean;
  CRIMINAL_FINAL_JUDGE_MODEL?: string;
  CRIMINAL_FINAL_JUDGE_MIN_CONFIDENCE?: string | number;
  CRIMINAL_FINAL_JUDGE_MAX_TOKENS?: string | number;
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
  PROFANITY_PROVIDER?: ProviderType;
  CRIMINAL_PROVIDER?: ProviderType;
  PROFANITY_MODEL?: string;
  CRIMINAL_MODEL?: string;
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
