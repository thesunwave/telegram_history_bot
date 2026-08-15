export type ProviderType = "cloudflare" | "openai" | "openrouter" | "legal-rag" | "mock";

export interface Env {
  HISTORY: import("@cloudflare/workers-types").KVNamespace;
  COUNTERS: import("@cloudflare/workers-types").KVNamespace;
  COUNTERS_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  MESSAGE_FETCHER_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  MESSAGE_AGGREGATOR_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  // Added DayBlockManager Durable Object binding
  DAY_BLOCK_MANAGER_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  CRIMINAL_CODE_ANALYZER_DO: import("@cloudflare/workers-types").DurableObjectNamespace;
  DB: import("@cloudflare/workers-types").D1Database;
  AI: any;
  LEGAL_RAG_INDEX?: any;
  ENVIRONMENT?: string;
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
  PROFANITY_PROVIDER?: ProviderType;
  CRIMINAL_PROVIDER?: ProviderType;
  PROFANITY_MODEL?: string;
  CRIMINAL_MODEL?: string;
  PROFANITY_SYSTEM_PROMPT?: string;
  PROFANITY_USER_PROMPT?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_MAX_TOKENS?: string | number;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_REFERER?: string;
  OPENROUTER_TITLE?: string;
  DEBUG_LOGS?: string;
  KV_BATCH_SIZE?: number;
  KV_BATCH_DELAY?: number;
  LARGE_DATASET_BATCH_SIZE?: number;
  LARGE_DATASET_BATCH_DELAY?: number;
  VERY_LARGE_DATASET_BATCH_SIZE?: number;
  VERY_LARGE_DATASET_BATCH_DELAY?: number;
  ADMIN_USER_ID?: string;
  TELEGRAM_BOT_USERNAME?: string;
  DRY_RUN?: string;

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
  SUMMARY_OPT_OUTPUT_TOKENS?: string | number;

  // Cache TTL configuration (in seconds)
  CRIMINAL_ANALYSIS_CACHE_TTL?: string | number;
  PROFANITY_ANALYSIS_CACHE_TTL?: string | number;
  MESSAGE_BLOCK_CACHE_TTL?: string | number;

  // Feature Toggles
  ENABLE_CRIMINAL_ANALYSIS?: string | boolean;
  ENABLE_PROFANITY_ANALYSIS?: string | boolean;
  ENABLE_PROFANITY_FROM_CRIMINAL_PREFILTER?: string | boolean;
  ENABLE_SUMMARY?: string | boolean;
  ENABLE_ACTIVITY_TRACKING?: string | boolean;

  // Text preview configuration
  CRIMINAL_STORE_TEXT_PREVIEW?: string | boolean;
  CRIMINAL_TEXT_PREVIEW_LENGTH?: string | number;
  CRIMINAL_QUEUE_BATCH_SIZE?: string | number;
  CRIMINAL_QUEUE_MAX_DELAY_MS?: string | number;
  CRIMINAL_OPENROUTER_MIN_INTERVAL_MS?: string | number;
  CRIMINAL_OPENROUTER_DAILY_SOFT_CAP?: string | number;
  CRIMINAL_PREFILTER_DAILY_CAP?: string | number;
  LEGAL_RAG_DAILY_QUERY_CAP?: string | number;
  LEGAL_RAG_TOP_K?: string | number;
  LEGAL_RAG_MIN_SCORE?: string | number;
  LEGAL_RAG_LAW_CODE?: string;
  LEGAL_RAG_EMBEDDING_MODEL?: string;
  LEGAL_RAG_INGEST_KEY?: string;
  CRIMINAL_FINAL_JUDGE_ENABLED?: string | boolean;
  CRIMINAL_FINAL_JUDGE_MODEL?: string;
  CRIMINAL_FINAL_JUDGE_MIN_CONFIDENCE?: string | number;
  CRIMINAL_FINAL_JUDGE_MIN_RAG_SCORE?: string | number;
  CRIMINAL_FINAL_JUDGE_MIN_QUALITY_REFERENCES?: string | number;
  CRIMINAL_FINAL_JUDGE_CONTEXT_BEFORE?: string | number;
  CRIMINAL_FINAL_JUDGE_CONTEXT_AFTER?: string | number;
  CRIMINAL_FINAL_JUDGE_MAX_REFERENCES?: string | number;
  CRIMINAL_FINAL_JUDGE_MAX_REFERENCE_CHARS?: string | number;
  CRIMINAL_FINAL_JUDGE_MAX_TOKENS?: string | number;
  CRIMINAL_CONTEXT_BEFORE?: string | number;
  CRIMINAL_CONTEXT_AFTER?: string | number;
  CRIMINAL_AI_PREFILTER_ENABLED?: string | boolean;
  CRIMINAL_PREFILTER_MODEL?: string;
  CRIMINAL_PREFILTER_MIN_CONFIDENCE?: string | number;
  CRIMINAL_PREFILTER_MAX_TOKENS?: string | number;
  CRIMINAL_PREFILTER_CACHE_ENABLED?: string | boolean;
  CRIMINAL_PREFILTER_CACHE_TTL?: string | number;
  CRIMINAL_PREFILTER_CACHE_VERSION?: string;
  CRIMINAL_PREFILTER_BATCH_ENABLED?: string | boolean;
  CRIMINAL_PREFILTER_BATCH_SIZE?: string | number;

  // ========================================
  // 💰 LLM BUDGET CONFIGURATION (ADR-001)
  // ========================================
  // Model role mappings
  LLM_NANO_MODEL?: string;        // Default: 'gpt-4.1-nano'
  LLM_MINI_MODEL?: string;        // Default: 'gpt-4.1-mini'
  LLM_HEAVY_MODEL?: string;       // Default: 'gpt-4.1' (reserved)

  // Token soft limits (per month)
  NANO_TOKENS_SOFT_LIMIT?: string | number;  // Default: 20_000_000
  MINI_TOKENS_SOFT_LIMIT?: string | number;  // Default: 3_000_000

  // Budget tracking KV key prefix
  LLM_BUDGET_KV_KEY?: string;     // Default: 'llm_budget'
}

export interface DurableObjectId { }

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
  messageId?: number;
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
export const MAX_LAST_MESSAGES = 1000;
export const WEEK_DAYS = 6; // lookback days for weekly stats
export const MONTH_DAYS = 27; // lookback days for monthly stats
export const DEFAULT_KV_BATCH_SIZE = 50; // Conservative default for KV request batching
export const DEFAULT_KV_BATCH_DELAY = 0; // No delay between batches by default
export const LARGE_DATASET_BATCH_SIZE = 25; // More conservative batch size for large datasets
export const LARGE_DATASET_BATCH_DELAY = 200; // Minimum delay for large datasets
export const VERY_LARGE_DATASET_BATCH_SIZE = 15; // Very conservative batch size for very large datasets  
export const VERY_LARGE_DATASET_BATCH_DELAY = 500; // Longer delay for very large datasets

// Batch processing constants
export const BATCH_SIZE = 50;
export const MAX_BATCH_SIZE = 100;
export const BATCH_TIMEOUT = 30000; // 30 seconds

// ========================================
// 🏛️ CRIMINAL CODE ANALYSIS TYPES
// ========================================

// Criminal violation found in text analysis
export interface CriminalViolation {
  article: string;          // УК РФ article number only (e.g., "282")
  subarticle: string | null; // Subarticle if exists (e.g., "1" for "282.1"), null otherwise
  articleTitle: string;     // Article title/name
  quote: string;            // Exact quote from text that violates the law
  punishment: string;       // Possible punishment description
  severity: number;         // Severity level 1-10
  confidence: number;       // AI confidence 0.0-1.0
  evidence?: CriminalViolationEvidence;
  decision?: CriminalDecision;
  targetMessageId?: number;
  contextWindow?: CriminalContextWindow;
}

export interface LegalReferenceHit {
  article: string;
  subarticle: string | null;
  articleTitle: string;
  quote: string;
  sourceUrl: string | null;
  lawCode: string;
  score: number;
  vectorId: string;
}

// Result of criminal code analysis
export interface CriminalAnalysisResult {
  hasViolations: boolean;
  violations: CriminalViolation[];
  totalSeverity: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  analysisTimestamp: number;
  decision?: CriminalDecision;
  evidence?: CriminalViolationEvidence;
  targetMessageId?: number;
  contextWindow?: CriminalContextWindow;
  legalReferences?: LegalReferenceHit[];
}

export type CriminalDecision = 'violation' | 'no_violation' | 'uncertain';

export interface CriminalViolationEvidence {
  subject: string;
  object: string;
  intent: string;
  contextSummary: string;
  whyNotBenign: string;
}

export interface CriminalContextWindow {
  before: number;
  after: number;
  totalMessages: number;
}

export interface CriminalContextMessage {
  messageId?: number;
  username: string;
  userId?: number;
  text: string;
  ts: number;
  relativePosition: number;
  isTarget: boolean;
}

export interface CriminalContextAnalysisInput {
  targetMessageId?: number;
  targetUserId?: number;
  targetUsername?: string;
  targetText: string;
  targetTimestamp: number;
  chatId: number;
  contextWindow: CriminalContextWindow;
  messages: CriminalContextMessage[];
  semanticPrefilter?: CriminalSemanticPrefilterResult;
}

export interface CriminalSemanticPrefilterResult {
  shouldAnalyze: boolean;
  reason: 'threat' | 'sexual_threat' | 'incitement' | 'self_incrimination' | 'extremism' | 'dangerous_instruction' | 'none';
  confidence: number;
  explanation: string;
  searchQuery?: string;
  profanity?: CriminalSemanticPrefilterProfanityResult;
}

export interface CriminalSemanticPrefilterProfanityResult {
  hasProfanity: boolean;
  words: Array<{
    word: string;
    baseForm?: string;
    count: number;
    confidence: number;
  }>;
}

// Request for criminal code analysis
export interface CriminalAnalysisRequest {
  text: string;
  userId?: number;
  chatId?: number;
  messageId?: number;
  username?: string;
  day?: string;
  ts?: number;
  useCache?: boolean;
  forceRefresh?: boolean;
  enqueueOnly?: boolean;
}

// Batch analysis request
export interface CriminalBatchAnalysisRequest {
  texts?: Array<{
    text: string;
    userId?: number;
    chatId?: number;
    messageId?: number;
  }>;
  messages?: Array<{
    text: string;
    userId?: number;
    chatId?: number;
    messageId?: number;
    username?: string;
    day?: string;
  }>;
  useCache?: boolean;
  forceRefresh?: boolean;
}

// Statistics for criminal violations
export interface CriminalViolationStats {
  userId?: number;
  chatId?: number;
  totalViolations: number;
  avgSeverity: number;
  mostCommonArticle?: string;
  lastViolationAt?: string;
  riskTrend: 'increasing' | 'stable' | 'decreasing';
}

// Cache entry for analysis results
export interface CriminalAnalysisCache {
  textHash: string;
  result: CriminalAnalysisResult;
  createdAt: number;
}

// Criminal Code Analyzer DO constants
export const CRIMINAL_ANALYSIS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
export const CRIMINAL_MAX_TEXT_LENGTH = 10000; // Maximum text length for analysis
export const CRIMINAL_ANALYSIS_TIMEOUT = 30000; // 30 seconds timeout
export const CRIMINAL_BATCH_SIZE = 10; // Maximum batch size for analysis
