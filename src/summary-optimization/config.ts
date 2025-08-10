/**
 * Configuration management for optimized summarization system
 */

import { Env } from '../env';
import { SummaryOptimizationConfig } from './types';

// Default configuration values
const DEFAULT_CONFIG: SummaryOptimizationConfig = {
  parallelProcessing: {
    enabled: true,
    minMessagesThreshold: 100,
    maxWorkers: 5,
    workerBatchSize: 50,
    workerTimeout: 30000, // 30 seconds
  },
  
  contextManagement: {
    maxTokensPerRequest: 120000, // Conservative limit for OpenAI 128k context
    preprocessingMaxTokens: 60000,
    finalMaxTokens: 120000,
    tokenEstimationFactor: 4, // Rough estimate: 1 token ≈ 4 characters for Russian
  },
  
  hierarchicalProcessing: {
    enabled: true,
    chunkSizeThreshold: 80000, // Switch to hierarchical if estimated tokens > this
    preprocessingPrompt: 'Создай краткую сводку основных тем и событий из следующих сообщений:',
    maxPreprocessingChunks: 10,
  },
  
  monitoring: {
    enableDetailedMetrics: true,
    logPerformanceInsights: true,
    trackTokenUsage: true,
  },
};

/**
 * Loads configuration from environment variables with fallback to defaults
 */
export function loadOptimizationConfig(env: Env): SummaryOptimizationConfig {
  const config: SummaryOptimizationConfig = {
    parallelProcessing: {
      enabled: getEnvBoolean(env, 'SUMMARY_OPT_PARALLEL_ENABLED', DEFAULT_CONFIG.parallelProcessing.enabled),
      minMessagesThreshold: getEnvNumber(env, 'SUMMARY_OPT_MIN_MESSAGES_THRESHOLD', DEFAULT_CONFIG.parallelProcessing.minMessagesThreshold),
      maxWorkers: getEnvNumber(env, 'SUMMARY_OPT_MAX_WORKERS', DEFAULT_CONFIG.parallelProcessing.maxWorkers),
      workerBatchSize: getEnvNumber(env, 'SUMMARY_OPT_WORKER_BATCH_SIZE', DEFAULT_CONFIG.parallelProcessing.workerBatchSize),
      workerTimeout: getEnvNumber(env, 'SUMMARY_OPT_WORKER_TIMEOUT', DEFAULT_CONFIG.parallelProcessing.workerTimeout),
    },
    
    contextManagement: {
      maxTokensPerRequest: getEnvNumber(env, 'SUMMARY_OPT_MAX_TOKENS_PER_REQUEST', DEFAULT_CONFIG.contextManagement.maxTokensPerRequest),
      preprocessingMaxTokens: getEnvNumber(env, 'SUMMARY_OPT_PREPROCESSING_MAX_TOKENS', DEFAULT_CONFIG.contextManagement.preprocessingMaxTokens),
      finalMaxTokens: getEnvNumber(env, 'SUMMARY_OPT_FINAL_MAX_TOKENS', DEFAULT_CONFIG.contextManagement.finalMaxTokens),
      tokenEstimationFactor: getEnvNumber(env, 'SUMMARY_OPT_TOKEN_ESTIMATION_FACTOR', DEFAULT_CONFIG.contextManagement.tokenEstimationFactor),
    },
    
    hierarchicalProcessing: {
      enabled: getEnvBoolean(env, 'SUMMARY_OPT_HIERARCHICAL_ENABLED', DEFAULT_CONFIG.hierarchicalProcessing.enabled),
      chunkSizeThreshold: getEnvNumber(env, 'SUMMARY_OPT_CHUNK_SIZE_THRESHOLD', DEFAULT_CONFIG.hierarchicalProcessing.chunkSizeThreshold),
      preprocessingPrompt: getEnvString(env, 'SUMMARY_OPT_PREPROCESSING_PROMPT', DEFAULT_CONFIG.hierarchicalProcessing.preprocessingPrompt),
      maxPreprocessingChunks: getEnvNumber(env, 'SUMMARY_OPT_MAX_PREPROCESSING_CHUNKS', DEFAULT_CONFIG.hierarchicalProcessing.maxPreprocessingChunks),
    },
    
    monitoring: {
      enableDetailedMetrics: getEnvBoolean(env, 'SUMMARY_OPT_ENABLE_DETAILED_METRICS', DEFAULT_CONFIG.monitoring.enableDetailedMetrics),
      logPerformanceInsights: getEnvBoolean(env, 'SUMMARY_OPT_LOG_PERFORMANCE_INSIGHTS', DEFAULT_CONFIG.monitoring.logPerformanceInsights),
      trackTokenUsage: getEnvBoolean(env, 'SUMMARY_OPT_TRACK_TOKEN_USAGE', DEFAULT_CONFIG.monitoring.trackTokenUsage),
    },
  };

  // Validate configuration
  validateConfig(config);
  
  return config;
}

/**
 * Validates the configuration for consistency and reasonable values
 */
function validateConfig(config: SummaryOptimizationConfig): void {
  // Validate parallel processing config
  if (config.parallelProcessing.maxWorkers < 1 || config.parallelProcessing.maxWorkers > 20) {
    throw new Error('SUMMARY_OPT_MAX_WORKERS must be between 1 and 20');
  }
  
  if (config.parallelProcessing.workerBatchSize < 1 || config.parallelProcessing.workerBatchSize > 1000) {
    throw new Error('SUMMARY_OPT_WORKER_BATCH_SIZE must be between 1 and 1000');
  }
  
  if (config.parallelProcessing.workerTimeout < 5000 || config.parallelProcessing.workerTimeout > 300000) {
    throw new Error('SUMMARY_OPT_WORKER_TIMEOUT must be between 5000ms and 300000ms');
  }
  
  // Validate context management config
  if (config.contextManagement.maxTokensPerRequest < 1000 || config.contextManagement.maxTokensPerRequest > 200000) {
    throw new Error('SUMMARY_OPT_MAX_TOKENS_PER_REQUEST must be between 1000 and 200000');
  }
  
  if (config.contextManagement.preprocessingMaxTokens > config.contextManagement.maxTokensPerRequest) {
    throw new Error('SUMMARY_OPT_PREPROCESSING_MAX_TOKENS cannot be greater than SUMMARY_OPT_MAX_TOKENS_PER_REQUEST');
  }
  
  if (config.contextManagement.tokenEstimationFactor < 1 || config.contextManagement.tokenEstimationFactor > 10) {
    throw new Error('SUMMARY_OPT_TOKEN_ESTIMATION_FACTOR must be between 1 and 10');
  }
  
  // Validate hierarchical processing config
  if (config.hierarchicalProcessing.maxPreprocessingChunks < 1 || config.hierarchicalProcessing.maxPreprocessingChunks > 50) {
    throw new Error('SUMMARY_OPT_MAX_PREPROCESSING_CHUNKS must be between 1 and 50');
  }
  
  if (config.hierarchicalProcessing.chunkSizeThreshold < 1000) {
    throw new Error('SUMMARY_OPT_CHUNK_SIZE_THRESHOLD must be at least 1000');
  }
}

// Helper functions for environment variable parsing
function getEnvString(env: Env, key: string, defaultValue: string): string {
  const value = (env as any)[key];
  return typeof value === 'string' ? value : defaultValue;
}

function getEnvNumber(env: Env, key: string, defaultValue: number): number {
  const value = (env as any)[key];
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return typeof value === 'number' ? value : defaultValue;
}

function getEnvBoolean(env: Env, key: string, defaultValue: boolean): boolean {
  const value = (env as any)[key];
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return typeof value === 'boolean' ? value : defaultValue;
}

/**
 * Gets the default configuration (useful for testing)
 */
export function getDefaultConfig(): SummaryOptimizationConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}