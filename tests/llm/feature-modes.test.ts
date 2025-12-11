/**
 * Feature Modes Unit Tests
 * ADR-001: Tests for feature degradation mode computation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getLLMFeatureModes,
    isFeatureDegraded,
    isFeatureDisabled,
    getFeatureModesStatus,
    FeatureModes,
    SummaryMode,
    ProfanityMode,
    CriminalMode,
    LLMBudgetTracker,
    ModelPolicy,
    resetBudgetTracker,
    resetModelPolicy,
    ILLMBudgetTracker,
    IModelPolicy,
    TokenUsage,
} from '../../src/llm';

// Mock tracker for testing specific scenarios
function createMockTracker(overLimits: { nano?: boolean; mini?: boolean } = {}): ILLMBudgetTracker {
    return {
        recordUsage: vi.fn(),
        getModelUsageThisMonth: vi.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
        getFeatureUsageThisMonth: vi.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
        isOverSoftLimit: vi.fn().mockImplementation((model: string) => {
            if (model.includes('nano')) return overLimits.nano || false;
            if (model.includes('mini')) return overLimits.mini || false;
            return false;
        }),
        getMonthlyData: vi.fn().mockReturnValue({ month: '2025-12', models: {}, features: {}, lastUpdated: Date.now() }),
        flush: vi.fn().mockResolvedValue(undefined),
    };
}

describe('FeatureModes', () => {
    beforeEach(() => {
        resetBudgetTracker();
        resetModelPolicy();
    });

    describe('getLLMFeatureModes', () => {
        it('should return all full modes when under limits', () => {
            const tracker = createMockTracker({ nano: false, mini: false });
            const policy = new ModelPolicy();

            const modes = getLLMFeatureModes(tracker, policy);

            expect(modes.summary).toBe('full');
            expect(modes.profanity).toBe('full');
            expect(modes.criminal).toBe('full');
        });

        it('should degrade summary to economy when mini over limit', () => {
            const tracker = createMockTracker({ nano: false, mini: true });
            const policy = new ModelPolicy();

            const modes = getLLMFeatureModes(tracker, policy);

            expect(modes.summary).toBe('economy');
        });

        it('should degrade criminal to light when mini over limit', () => {
            const tracker = createMockTracker({ nano: false, mini: true });
            const policy = new ModelPolicy();

            const modes = getLLMFeatureModes(tracker, policy);

            expect(modes.criminal).toBe('light');
        });

        it('should degrade profanity to local-only when nano over limit', () => {
            const tracker = createMockTracker({ nano: true, mini: false });
            const policy = new ModelPolicy();

            const modes = getLLMFeatureModes(tracker, policy);

            expect(modes.profanity).toBe('local-only');
        });

        it('should disable summary and criminal when both limits exceeded', () => {
            const tracker = createMockTracker({ nano: true, mini: true });
            const policy = new ModelPolicy();

            const modes = getLLMFeatureModes(tracker, policy);

            expect(modes.summary).toBe('disabled');
            expect(modes.criminal).toBe('disabled');
            expect(modes.profanity).toBe('local-only'); // Has local fallback
        });

        it('should respect custom config', () => {
            const tracker = createMockTracker({ nano: false, mini: true });
            const policy = new ModelPolicy();

            const modes = getLLMFeatureModes(tracker, policy, {
                summaryEconomyOnMiniOverLimit: false, // Don't degrade summary
                criminalLightOnMiniOverLimit: true,
            });

            expect(modes.summary).toBe('full'); // Not degraded due to config
            expect(modes.criminal).toBe('light'); // Still degraded
        });
    });

    describe('isFeatureDegraded', () => {
        it('should return false for full mode', () => {
            const modes: FeatureModes = {
                summary: 'full',
                profanity: 'full',
                criminal: 'full',
            };

            expect(isFeatureDegraded('summary', modes)).toBe(false);
            expect(isFeatureDegraded('profanity', modes)).toBe(false);
            expect(isFeatureDegraded('criminal', modes)).toBe(false);
        });

        it('should return true for economy mode', () => {
            const modes: FeatureModes = {
                summary: 'economy',
                profanity: 'full',
                criminal: 'full',
            };

            expect(isFeatureDegraded('summary', modes)).toBe(true);
        });

        it('should return true for local-only mode', () => {
            const modes: FeatureModes = {
                summary: 'full',
                profanity: 'local-only',
                criminal: 'full',
            };

            expect(isFeatureDegraded('profanity', modes)).toBe(true);
        });

        it('should return true for disabled mode', () => {
            const modes: FeatureModes = {
                summary: 'disabled',
                profanity: 'disabled',
                criminal: 'disabled',
            };

            expect(isFeatureDegraded('summary', modes)).toBe(true);
            expect(isFeatureDegraded('criminal', modes)).toBe(true);
        });
    });

    describe('isFeatureDisabled', () => {
        it('should return false for non-disabled modes', () => {
            const modes: FeatureModes = {
                summary: 'economy',
                profanity: 'local-only',
                criminal: 'light',
            };

            expect(isFeatureDisabled('summary', modes)).toBe(false);
            expect(isFeatureDisabled('profanity', modes)).toBe(false);
            expect(isFeatureDisabled('criminal', modes)).toBe(false);
        });

        it('should return true for disabled mode', () => {
            const modes: FeatureModes = {
                summary: 'disabled',
                profanity: 'full',
                criminal: 'disabled',
            };

            expect(isFeatureDisabled('summary', modes)).toBe(true);
            expect(isFeatureDisabled('profanity', modes)).toBe(false);
            expect(isFeatureDisabled('criminal', modes)).toBe(true);
        });
    });

    describe('getFeatureModesStatus', () => {
        it('should return normal status when all full', () => {
            const modes: FeatureModes = {
                summary: 'full',
                profanity: 'full',
                criminal: 'full',
            };

            const status = getFeatureModesStatus(modes);

            expect(status).toBe('All features operating normally');
        });

        it('should list degraded features', () => {
            const modes: FeatureModes = {
                summary: 'economy',
                profanity: 'local-only',
                criminal: 'full',
            };

            const status = getFeatureModesStatus(modes);

            expect(status).toContain('Summary: economy');
            expect(status).toContain('Profanity: local-only');
            expect(status).not.toContain('Criminal');
        });
    });
});
