/**
 * Configuration management for optimized summarization system
 */

import { Env } from '../env';
import { ModelLimits, SummaryOptimizationConfig } from './types';

// Default configuration values (generic baseline, will be clamped to model limits)
const DEFAULT_CONFIG: Omit<SummaryOptimizationConfig, 'modelLimits'> = {
  parallelProcessing: {
    enabled: true,
    minMessagesThreshold: 1000,
    maxWorkers: 5,
    workerBatchSize: 50,
    workerTimeout: 30000, // 30 seconds
  },

  contextManagement: {
    maxTokensPerRequest: 120000, // Baseline; adjusted by model limits
    preprocessingMaxTokens: 60000,
    finalMaxTokens: 32000,
    outputTokensTarget: 32000,
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

const MODEL_LIMIT_PRESETS: Record<string, ModelLimits> = {
  'gpt-4.1-nano': {
    name: 'gpt-4.1-nano',
    maxContextTokens: 1_000_000,
    maxOutputTokens: 32_000,
    defaultOutputTokensTarget: 28_000,
  },
  'gpt-5-nano': {
    name: 'gpt-5-nano',
    maxContextTokens: 400_000,
    maxOutputTokens: 128_000,
    defaultOutputTokensTarget: 96_000,
  },
};

const DEFAULT_MODEL_LIMITS: ModelLimits = {
  name: 'generic',
  maxContextTokens: 200_000,
  maxOutputTokens: 8_000,
  defaultOutputTokensTarget: 6_000,
};

/**
 * Detects model limits based on configured model name
 */
function detectModelLimits(env: Env): ModelLimits {
  const configuredModel =
    (env as any).SUMMARY_MODEL ||
    (env as any).OPENAI_MODEL ||
    (env as any).CLOUDFLARE_MODEL ||
    '';
  const modelKey = configuredModel.toLowerCase();

  const preset =
    Object.keys(MODEL_LIMIT_PRESETS).find((key) => modelKey.includes(key)) ||
    null;

  if (preset) {
    const limits = MODEL_LIMIT_PRESETS[preset];
    return { ...limits, name: configuredModel || limits.name };
  }

  return { ...DEFAULT_MODEL_LIMITS, name: configuredModel || DEFAULT_MODEL_LIMITS.name };
}

/**
 * Loads configuration from environment variables with fallback to defaults,
 * clamped to the detected model limits to avoid token overflows.
 */
export function loadOptimizationConfig(env: Env): SummaryOptimizationConfig {
  const modelLimits = detectModelLimits(env);

  // Output budget cannot exceed model max output
  const requestedOutputTokens = getEnvNumber(
    env,
    'SUMMARY_OPT_OUTPUT_TOKENS',
    modelLimits.defaultOutputTokensTarget ||
    DEFAULT_CONFIG.contextManagement.outputTokensTarget,
  );
  const outputTokensTarget = clamp(
    requestedOutputTokens,
    500,
    modelLimits.maxOutputTokens,
  );

  // Reserve space for output when calculating input context budget
  const maxInputBudgetDefault = Math.max(
    1000,
    modelLimits.maxContextTokens - outputTokensTarget,
  );

  const maxTokensPerRequest = clamp(
    getEnvNumber(
      env,
      'SUMMARY_OPT_MAX_TOKENS_PER_REQUEST',
      Math.min(DEFAULT_CONFIG.contextManagement.maxTokensPerRequest, maxInputBudgetDefault),
    ),
    1000,
    modelLimits.maxContextTokens - 1000, // keep some headroom
  );

  const preprocessingMaxTokens = clamp(
    getEnvNumber(
      env,
      'SUMMARY_OPT_PREPROCESSING_MAX_TOKENS',
      Math.min(DEFAULT_CONFIG.contextManagement.preprocessingMaxTokens, maxTokensPerRequest),
    ),
    1000,
    maxTokensPerRequest,
  );

  // Final pass output budget
  const finalMaxTokens = clamp(
    getEnvNumber(
      env,
      'SUMMARY_OPT_FINAL_MAX_TOKENS',
      outputTokensTarget,
    ),
    500,
    modelLimits.maxOutputTokens,
  );

  const chunkSizeThreshold = clamp(
    getEnvNumber(
      env,
      'SUMMARY_OPT_CHUNK_SIZE_THRESHOLD',
      Math.floor(maxTokensPerRequest * 0.8),
    ),
    1000,
    modelLimits.maxContextTokens,
  );

  const config: SummaryOptimizationConfig = {
    modelLimits,
    parallelProcessing: {
      enabled: getEnvBoolean(
        env,
        'SUMMARY_OPT_PARALLEL_ENABLED',
        DEFAULT_CONFIG.parallelProcessing.enabled,
      ),
      minMessagesThreshold: getEnvNumber(
        env,
        'SUMMARY_OPT_MIN_MESSAGES_THRESHOLD',
        DEFAULT_CONFIG.parallelProcessing.minMessagesThreshold,
      ),
      maxWorkers: getEnvNumber(
        env,
        'SUMMARY_OPT_MAX_WORKERS',
        DEFAULT_CONFIG.parallelProcessing.maxWorkers,
      ),
      workerBatchSize: getEnvNumber(
        env,
        'SUMMARY_OPT_WORKER_BATCH_SIZE',
        DEFAULT_CONFIG.parallelProcessing.workerBatchSize,
      ),
      workerTimeout: getEnvNumber(
        env,
        'SUMMARY_OPT_WORKER_TIMEOUT',
        DEFAULT_CONFIG.parallelProcessing.workerTimeout,
      ),
    },

    contextManagement: {
      maxTokensPerRequest: maxTokensPerRequest,
      preprocessingMaxTokens,
      finalMaxTokens,
      outputTokensTarget,
      tokenEstimationFactor: getEnvNumber(
        env,
        'SUMMARY_OPT_TOKEN_ESTIMATION_FACTOR',
        DEFAULT_CONFIG.contextManagement.tokenEstimationFactor,
      ),
    },

    hierarchicalProcessing: {
      enabled: getEnvBoolean(
        env,
        'SUMMARY_OPT_HIERARCHICAL_ENABLED',
        DEFAULT_CONFIG.hierarchicalProcessing.enabled,
      ),
      chunkSizeThreshold,
      preprocessingPrompt: getEnvString(
        env,
        'SUMMARY_OPT_PREPROCESSING_PROMPT',
        DEFAULT_CONFIG.hierarchicalProcessing.preprocessingPrompt,
      ),
      maxPreprocessingChunks: getEnvNumber(
        env,
        'SUMMARY_OPT_MAX_PREPROCESSING_CHUNKS',
        DEFAULT_CONFIG.hierarchicalProcessing.maxPreprocessingChunks,
      ),
    },

    monitoring: {
      enableDetailedMetrics: getEnvBoolean(
        env,
        'SUMMARY_OPT_ENABLE_DETAILED_METRICS',
        DEFAULT_CONFIG.monitoring.enableDetailedMetrics,
      ),
      logPerformanceInsights: getEnvBoolean(
        env,
        'SUMMARY_OPT_LOG_PERFORMANCE_INSIGHTS',
        DEFAULT_CONFIG.monitoring.logPerformanceInsights,
      ),
      trackTokenUsage: getEnvBoolean(
        env,
        'SUMMARY_OPT_TRACK_TOKEN_USAGE',
        DEFAULT_CONFIG.monitoring.trackTokenUsage,
      ),
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
  const { modelLimits } = config;

  // Validate parallel processing config
  if (config.parallelProcessing.maxWorkers < 1 || config.parallelProcessing.maxWorkers > 20) {
    throw new Error('SUMMARY_OPT_MAX_WORKERS must be between 1 and 20');
  }

  if (config.parallelProcessing.workerBatchSize < 1 || config.parallelProcessing.workerBatchSize > 5000) {
    throw new Error('SUMMARY_OPT_WORKER_BATCH_SIZE must be between 1 and 5000');
  }

  if (config.parallelProcessing.workerTimeout < 5000 || config.parallelProcessing.workerTimeout > 300000) {
    throw new Error('SUMMARY_OPT_WORKER_TIMEOUT must be between 5000ms and 300000ms');
  }

  // Validate context management config
  if (
    config.contextManagement.maxTokensPerRequest < 1000 ||
    config.contextManagement.maxTokensPerRequest > modelLimits.maxContextTokens
  ) {
    throw new Error(
      `SUMMARY_OPT_MAX_TOKENS_PER_REQUEST must be between 1000 and ${modelLimits.maxContextTokens}`,
    );
  }

  if (config.contextManagement.preprocessingMaxTokens > config.contextManagement.maxTokensPerRequest) {
    throw new Error('SUMMARY_OPT_PREPROCESSING_MAX_TOKENS cannot be greater than SUMMARY_OPT_MAX_TOKENS_PER_REQUEST');
  }

  if (
    config.contextManagement.outputTokensTarget < 500 ||
    config.contextManagement.outputTokensTarget > modelLimits.maxOutputTokens
  ) {
    throw new Error(
      `SUMMARY_OPT_OUTPUT_TOKENS must be between 500 and ${modelLimits.maxOutputTokens}`,
    );
  }

  if (config.contextManagement.finalMaxTokens > modelLimits.maxOutputTokens) {
    throw new Error(
      `SUMMARY_OPT_FINAL_MAX_TOKENS cannot exceed ${modelLimits.maxOutputTokens}`,
    );
  }

  if (
    config.contextManagement.maxTokensPerRequest + config.contextManagement.outputTokensTarget >
    modelLimits.maxContextTokens + 1000 // allow some slack for prompts
  ) {
    throw new Error(
      'Input + output token budgets exceed model context window. Reduce SUMMARY_OPT_MAX_TOKENS_PER_REQUEST or SUMMARY_OPT_OUTPUT_TOKENS.',
    );
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
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    modelLimits: { ...DEFAULT_MODEL_LIMITS },
  } as SummaryOptimizationConfig;
}

/**
 * Exposes detected model limits for other modules
 */
export function getModelLimits(env: Env): ModelLimits {
  return detectModelLimits(env);
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
