/**
 * Types and interfaces for the optimized summarization system
 */

import { TelegramMessage, SummaryOptions } from '../../../core/providers/ai-provider';
import { Env } from '../../../core/env';

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
export interface ModelLimits {
  name: string;
  maxContextTokens: number;
  maxOutputTokens: number;
  defaultOutputTokensTarget: number;
}

export interface SummaryOptimizationConfig {
  modelLimits: ModelLimits;

  // Parallel processing
  parallelProcessing: {
    enabled: boolean;
    minMessagesThreshold: number;
    maxWorkers: number;
    workerBatchSize: number;
    workerTimeout: number;
    minCoverageRatio: number;
  };

  // Context management
  contextManagement: {
    maxTokensPerRequest: number;
    preprocessingMaxTokens: number;
    finalMaxTokens: number;
    outputTokensTarget: number;
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

export interface SummaryContext {
  chatId?: number;
  periodStart?: number;
  periodEnd?: number;
  requestedMessageCount?: number;
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
  process(messages: TelegramMessage[], env: Env, context?: SummaryContext): Promise<string>;
}

export interface HierarchicalProcessor {
  process(messages: TelegramMessage[], env: Env, context?: SummaryContext): Promise<string>;
}

// Per-user data interfaces for improved hierarchical processing
export interface UserSummary {
  username: string;
  messageCount: number;
  summary: string;
}

export interface ChunkUserSummaries {
  chunkIndex: number;
  userSummaries: UserSummary[];
}

export interface AggregatedUserSummary {
  username: string;
  totalMessageCount: number;
  aggregatedSummary: string;
  chunkContributions: number[]; // which chunks this user appeared in
}

// Enhanced hierarchical processor interface with per-user processing
export interface EnhancedHierarchicalProcessor extends HierarchicalProcessor {
  processWithUserAggregation(messages: TelegramMessage[], env: Env): Promise<string>;
}
