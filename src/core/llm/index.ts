/**
 * LLM Module - Public API
 * 
 * ADR-001: Centralized LLM budget and model policy infrastructure.
 * 
 * This module provides:
 * - ModelPolicy: Logical model roles (nano/mini/heavy) to model name mapping
 * - LLMBudgetTracker: Token usage tracking with soft limit detection
 * - FeatureModes: Degradation mode calculation for summary/profanity/criminal
 */

// Model Policy exports
export type { ModelRole, IModelPolicy } from './model-policy';
export { ModelPolicy, getModelPolicy, resetModelPolicy } from './model-policy';

// Budget Tracker exports
export type {
    FeatureType,
    TokenUsage,
    ModelUsageRecord,
    FeatureUsageRecord,
    MonthlyUsageData,
    ILLMBudgetTracker,
} from './budget-tracker';
export { LLMBudgetTracker, getBudgetTracker, resetBudgetTracker } from './budget-tracker';

// Feature Modes exports
export type {
    SummaryMode,
    ProfanityMode,
    CriminalMode,
    FeatureModes,
    FeatureModeConfig,
} from './feature-modes';
export {
    getLLMFeatureModes,
    isFeatureDegraded,
    isFeatureDisabled,
    getFeatureModesStatus,
} from './feature-modes';
