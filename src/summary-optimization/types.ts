/**
 * Types and interfaces for the optimized summarization system
 */

import { TelegramMessage, SummaryOptions } from "../providers/ai-provider";
import { Env } from "../env";

// Processing strategies
export type ProcessingStrategy = "direct" | "parallel" | "hierarchical";

// Session management
export interface ProcessingSession {
  sessionId: string;
  chatId: number;
  startTime: number;
  endTime?: number;
  strategy: ProcessingStrategy;
  status: "initializing" | "fetching" | "processing" | "completed" | "failed";

  // Metrics
  metrics: {
    totalMessages: number;
    fetchDuration: number;
    processingDuration: number;
    tokensUsed: number;
    aiRequestsCount: number;
  };

  // Errors
  errors: ProcessingError[];
}

export interface ProcessingError {
  stage: "fetch" | "aggregate" | "ai_preprocessing" | "ai_final";
  error: string;
  timestamp: number;
  recoverable: boolean;
}

// Configuration interfaces
export interface SummaryOptimizationConfig {
  // Parallel processing
  parallelProcessing: {
    enabled: boolean;
    minMessagesThreshold: number;
    maxWorkers: number;
    workerBatchSize: number;
    workerTimeout: number;
  };

  // Context management
  contextManagement: {
    maxTokensPerRequest: number;
    preprocessingMaxTokens: number;
    finalMaxTokens: number;
    tokenEstimationFactor: number;
  };

  // Hierarchical processing
  hierarchicalProcessing: {
    enabled: boolean;
    chunkSizeThreshold: number;
    preprocessingPrompt: string;
    maxPreprocessingChunks: number;
  };

  // Monitoring
  monitoring: {
    enableDetailedMetrics: boolean;
    logPerformanceInsights: boolean;
    trackTokenUsage: boolean;
  };
}

// Strategy selection interface
export interface ProcessingStrategySelector {
  shouldUseParallelProcessing(estimatedMessageCount: number): boolean;
  shouldUseHierarchicalProcessing(tokenCount: number): boolean;
  getOptimalWorkerCount(messageCount: number): number;
  selectStrategy(
    messageCount: number,
    estimatedTokens: number,
  ): ProcessingStrategy;
}

// Message fetching interfaces
export interface ParallelFetchRequest {
  chatId: number;
  start: number;
  end: number;
  concurrentFetches: number; // количество параллельных fetch операций
  batchSize: number;
}

export interface FetchStatus {
  sessionId: string;
  status: "running" | "completed" | "failed";
  fetchesCompleted: number;
  totalFetches: number;
  messagesCollected: number;
  errors: string[];
}

// Context optimization interfaces
export interface ContextOptimizer {
  // Оценивает количество токенов
  estimateTokens(messages: TelegramMessage[]): number;

  // Оптимизирует сообщения для контекста
  optimizeForContext(
    messages: TelegramMessage[],
    maxTokens: number,
  ): TelegramMessage[];

  // Создает оптимальные чанки для обработки
  createOptimalChunks(
    messages: TelegramMessage[],
    maxTokens: number,
  ): TelegramMessage[][];
}

// Processing phases for hierarchical processing
export interface ProcessingPhase {
  phase: "preprocessing" | "final";
  chunkSize: number;
  prompt: string;
  maxTokens: number;
}

// Summary controller interface
export interface SummaryController {
  summarizeChat(chatId: number, days: number): Promise<string>;
  summarizeChatMessages(chatId: number, count: number): Promise<string>;
}

// Processor interfaces
export interface DirectProcessor {
  process(messages: TelegramMessage[], env: Env): Promise<string>;
}

export interface HierarchicalProcessor {
  process(messages: TelegramMessage[], env: Env): Promise<string>;
}

// Durable Object interfaces
export interface MessageFetcherDO {
  // Инициализирует параллельную загрузку с использованием Promise.all()
  initializeParallelFetch(request: ParallelFetchRequest): Promise<string>; // returns sessionId

  // Получает статус загрузки
  getFetchStatus(sessionId: string): Promise<FetchStatus>;

  // Получает результаты загрузки
  getResults(sessionId: string): Promise<TelegramMessage[]>;
}

export interface MessageAggregatorDO {
  // Агрегирует сообщения от воркеров
  aggregateMessages(
    sessionId: string,
    messages: TelegramMessage[],
  ): Promise<void>;

  // Получает агрегированные и отсортированные сообщения
  getAggregatedMessages(sessionId: string): Promise<TelegramMessage[]>;

  // Очищает данные сессии
  cleanupSession(sessionId: string): Promise<void>;
}

// Aggregation session data
export interface AggregationSession {
  sessionId: string;
  chatId: number;
  status: "running" | "completed" | "failed";
  startTime: number;
  endTime?: number;
  messagesReceived: number;
  messagesAggregated: number;
  errors: string[];
  lastActivity: number;
}

// Aggregation result interface
export interface AggregationResult {
  sessionId: string;
  status: "running" | "completed" | "failed";
  messagesAggregated: number;
  messagesReceived: number;
  messages: TelegramMessage[];
  errors: string[];
  processingTime: number | null;
}

// Aggregation status interface
export interface AggregationStatus {
  sessionId: string;
  status: "running" | "completed" | "failed";
  messagesReceived: number;
  messagesAggregated: number;
  errors: string[];
  startTime: number;
  endTime?: number;
  lastActivity: number;
}
