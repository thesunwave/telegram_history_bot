/**
 * Feature Modes - Degradation modes for LLM-using features
 * 
 * ADR-001: Computes and logs feature modes based on budget usage.
 * Future ADRs (002, 003, 004) will use these modes to implement actual degradation.
 */

import { ILLMBudgetTracker, getBudgetTracker } from './budget-tracker';
import { IModelPolicy, getModelPolicy } from './model-policy';
import { Logger } from '../logger';
import { Env } from '../env';

/**
 * Summary feature modes:
 * - full: Normal summarization with all features
 * - economy: Reduced quality/token usage mode
 * - disabled: Summarization disabled due to budget
 */
export type SummaryMode = 'full' | 'economy' | 'disabled';

/**
 * Profanity detection modes:
 * - full: AI-powered profanity detection
 * - local-only: Use local dictionary only (no AI)
 * - disabled: Profanity detection disabled
 */
export type ProfanityMode = 'full' | 'local-only' | 'disabled';

/**
 * Criminal code analysis modes:
 * - full: Full analysis with all checks
 * - light: Reduced analysis, key violations only
 * - disabled: Analysis disabled due to budget
 */
export type CriminalMode = 'full' | 'light' | 'disabled';

/**
 * Combined feature modes structure
 */
export interface FeatureModes {
    summary: SummaryMode;
    profanity: ProfanityMode;
    criminal: CriminalMode;
}

/**
 * Configuration for mode computation
 */
export interface FeatureModeConfig {
    /**
     * When mini usage exceeds soft limit, switch summary to economy mode
     */
    summaryEconomyOnMiniOverLimit?: boolean;

    /**
     * When mini usage exceeds soft limit, switch criminal to light mode
     */
    criminalLightOnMiniOverLimit?: boolean;

    /**
     * When both nano and mini are over limit, disable features
     */
    disableOnBothOverLimit?: boolean;
}

const DEFAULT_CONFIG: FeatureModeConfig = {
    summaryEconomyOnMiniOverLimit: true,
    criminalLightOnMiniOverLimit: true,
    disableOnBothOverLimit: true,
};

/**
 * Compute current feature modes based on budget usage.
 * 
 * Logic (from ADR-001):
 * - If mini usage exceeds MINI_TOKENS_SOFT_LIMIT: summary -> economy, criminal -> light
 * - If nano usage exceeds NANO_TOKENS_SOFT_LIMIT: profanity -> local-only
 * - If both limits exceeded and disableOnBothOverLimit: features -> disabled
 * 
 * NOTE: In ADR-001, these modes are computed and logged but NOT enforced.
 * Future ADRs will read and use these modes.
 */
export function getLLMFeatureModes(
    tracker?: ILLMBudgetTracker,
    policy?: IModelPolicy,
    config: FeatureModeConfig = DEFAULT_CONFIG
): FeatureModes {
    const t = tracker || getBudgetTracker();
    const p = policy || getModelPolicy();

    // Get model names for each role
    const nanoModel = p.getModel('nano');
    const miniModel = p.getModel('mini');

    // Check soft limit status
    const nanoOverLimit = t.isOverSoftLimit(nanoModel);
    const miniOverLimit = t.isOverSoftLimit(miniModel);

    // Compute modes
    let summaryMode: SummaryMode = 'full';
    let profanityMode: ProfanityMode = 'full';
    let criminalMode: CriminalMode = 'full';

    // Mini over limit: degrade summary and criminal
    if (miniOverLimit && config.summaryEconomyOnMiniOverLimit) {
        summaryMode = 'economy';
    }
    if (miniOverLimit && config.criminalLightOnMiniOverLimit) {
        criminalMode = 'light';
    }

    // Nano over limit: degrade profanity
    if (nanoOverLimit) {
        profanityMode = 'local-only';
    }

    // Both over limit: consider disabling
    if (nanoOverLimit && miniOverLimit && config.disableOnBothOverLimit) {
        // Disabled mode - but keep profanity at local-only since it can still work
        summaryMode = 'disabled';
        criminalMode = 'disabled';
        // profanity stays at local-only (has local fallback)
    }

    const modes: FeatureModes = {
        summary: summaryMode,
        profanity: profanityMode,
        criminal: criminalMode,
    };

    // Log current modes for observability
    Logger.log('LLM feature modes computed', {
        modes,
        nanoModel,
        miniModel,
        nanoOverLimit,
        miniOverLimit,
    });

    return modes;
}

/**
 * Check if a specific feature is in degraded mode.
 */
export function isFeatureDegraded(
    feature: 'summary' | 'profanity' | 'criminal',
    modes?: FeatureModes
): boolean {
    const m = modes || getLLMFeatureModes();

    switch (feature) {
        case 'summary':
            return m.summary !== 'full';
        case 'profanity':
            return m.profanity !== 'full';
        case 'criminal':
            return m.criminal !== 'full';
        default:
            return false;
    }
}

/**
 * Check if a specific feature is completely disabled.
 */
export function isFeatureDisabled(
    feature: 'summary' | 'profanity' | 'criminal',
    modes?: FeatureModes
): boolean {
    const m = modes || getLLMFeatureModes();

    switch (feature) {
        case 'summary':
            return m.summary === 'disabled';
        case 'profanity':
            return m.profanity === 'disabled';
        case 'criminal':
            return m.criminal === 'disabled';
        default:
            return false;
    }
}

/**
 * Get a human-readable status message for current modes.
 */
export function getFeatureModesStatus(modes?: FeatureModes): string {
    const m = modes || getLLMFeatureModes();

    const parts: string[] = [];

    if (m.summary !== 'full') {
        parts.push(`Summary: ${m.summary}`);
    }
    if (m.profanity !== 'full') {
        parts.push(`Profanity: ${m.profanity}`);
    }
    if (m.criminal !== 'full') {
        parts.push(`Criminal: ${m.criminal}`);
    }

    if (parts.length === 0) {
        return 'All features operating normally';
    }

    return `Degraded modes: ${parts.join(', ')}`;
}
