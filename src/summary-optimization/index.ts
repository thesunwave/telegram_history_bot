/**
 * Optimized summarization system exports
 */

// Types and interfaces
export * from './types';

// Configuration
export { loadOptimizationConfig, getDefaultConfig } from './config';

// Strategy selection
export { OptimizedStrategySelector } from './strategy-selector';

// Main controller
export { OptimizedSummaryController } from './summary-controller';