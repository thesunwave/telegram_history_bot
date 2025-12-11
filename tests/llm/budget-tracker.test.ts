/**
 * LLM Budget Tracker Unit Tests
 * ADR-001: Tests for token usage tracking and soft limit detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    LLMBudgetTracker,
    resetBudgetTracker,
    TokenUsage,
    FeatureType,
} from '../../src/llm';

describe('LLMBudgetTracker', () => {
    beforeEach(() => {
        // Reset global tracker between tests
        resetBudgetTracker();
    });

    describe('recordUsage', () => {
        it('should record usage for a model', () => {
            const tracker = new LLMBudgetTracker();
            const usage: TokenUsage = {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            };

            tracker.recordUsage('gpt-4.1-nano', 'summary', usage);

            const modelUsage = tracker.getModelUsageThisMonth('gpt-4.1-nano');
            expect(modelUsage.promptTokens).toBe(100);
            expect(modelUsage.completionTokens).toBe(50);
            expect(modelUsage.totalTokens).toBe(150);
        });

        it('should record usage for a feature', () => {
            const tracker = new LLMBudgetTracker();
            const usage: TokenUsage = {
                promptTokens: 200,
                completionTokens: 100,
                totalTokens: 300,
            };

            tracker.recordUsage('gpt-4.1-nano', 'profanity', usage);

            const featureUsage = tracker.getFeatureUsageThisMonth('profanity');
            expect(featureUsage.promptTokens).toBe(200);
            expect(featureUsage.completionTokens).toBe(100);
            expect(featureUsage.totalTokens).toBe(300);
        });

        it('should accumulate usage across multiple calls', () => {
            const tracker = new LLMBudgetTracker();

            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            });

            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 200,
                completionTokens: 100,
                totalTokens: 300,
            });

            const modelUsage = tracker.getModelUsageThisMonth('gpt-4.1-nano');
            expect(modelUsage.totalTokens).toBe(450);

            const featureUsage = tracker.getFeatureUsageThisMonth('summary');
            expect(featureUsage.totalTokens).toBe(450);
        });

        it('should track different models separately', () => {
            const tracker = new LLMBudgetTracker();

            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            });

            tracker.recordUsage('gpt-4.1-mini', 'summary', {
                promptTokens: 500,
                completionTokens: 200,
                totalTokens: 700,
            });

            expect(tracker.getModelUsageThisMonth('gpt-4.1-nano').totalTokens).toBe(150);
            expect(tracker.getModelUsageThisMonth('gpt-4.1-mini').totalTokens).toBe(700);
        });

        it('should track different features separately', () => {
            const tracker = new LLMBudgetTracker();

            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            });

            tracker.recordUsage('gpt-4.1-nano', 'profanity', {
                promptTokens: 200,
                completionTokens: 100,
                totalTokens: 300,
            });

            tracker.recordUsage('gpt-4.1-nano', 'criminal', {
                promptTokens: 50,
                completionTokens: 25,
                totalTokens: 75,
            });

            expect(tracker.getFeatureUsageThisMonth('summary').totalTokens).toBe(150);
            expect(tracker.getFeatureUsageThisMonth('profanity').totalTokens).toBe(300);
            expect(tracker.getFeatureUsageThisMonth('criminal').totalTokens).toBe(75);
        });
    });

    describe('isOverSoftLimit', () => {
        it('should return false when under limit', () => {
            const tracker = new LLMBudgetTracker();

            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 1000,
                completionTokens: 500,
                totalTokens: 1500,
            });

            expect(tracker.isOverSoftLimit('gpt-4.1-nano')).toBe(false);
        });

        it('should return true when over default nano limit (20M)', () => {
            const tracker = new LLMBudgetTracker();

            // Record usage over the 20M limit
            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 15_000_000,
                completionTokens: 6_000_000,
                totalTokens: 21_000_000,
            });

            expect(tracker.isOverSoftLimit('gpt-4.1-nano')).toBe(true);
        });

        it('should return true when over default mini limit (3M)', () => {
            const tracker = new LLMBudgetTracker();

            tracker.recordUsage('gpt-4.1-mini', 'summary', {
                promptTokens: 2_500_000,
                completionTokens: 1_000_000,
                totalTokens: 3_500_000,
            });

            expect(tracker.isOverSoftLimit('gpt-4.1-mini')).toBe(true);
        });

        it('should respect custom limits from env', () => {
            const tracker = new LLMBudgetTracker({
                NANO_TOKENS_SOFT_LIMIT: 1000, // Very low limit for testing
            });

            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 800,
                completionTokens: 500,
                totalTokens: 1300,
            });

            expect(tracker.isOverSoftLimit('gpt-4.1-nano')).toBe(true);
        });

        it('should detect limits for gpt-5 models by pattern', () => {
            const tracker = new LLMBudgetTracker();

            tracker.recordUsage('gpt-5-nano', 'summary', {
                promptTokens: 15_000_000,
                completionTokens: 6_000_000,
                totalTokens: 21_000_000,
            });

            expect(tracker.isOverSoftLimit('gpt-5-nano')).toBe(true);
        });
    });

    describe('getMonthlyData', () => {
        it('should return current month data', () => {
            const tracker = new LLMBudgetTracker();

            tracker.recordUsage('gpt-4.1-nano', 'summary', {
                promptTokens: 100,
                completionTokens: 50,
                totalTokens: 150,
            });

            const data = tracker.getMonthlyData();

            expect(data.month).toMatch(/^\d{4}-\d{2}$/);
            expect(data.models['gpt-4.1-nano']).toBeDefined();
            expect(data.features.summary.totalTokens).toBe(150);
        });
    });

    describe('getModelUsageThisMonth', () => {
        it('should return empty usage for unknown model', () => {
            const tracker = new LLMBudgetTracker();

            const usage = tracker.getModelUsageThisMonth('unknown-model');

            expect(usage.promptTokens).toBe(0);
            expect(usage.completionTokens).toBe(0);
            expect(usage.totalTokens).toBe(0);
        });
    });

    describe('getFeatureUsageThisMonth', () => {
        it('should return zero usage for unused feature', () => {
            const tracker = new LLMBudgetTracker();

            const usage = tracker.getFeatureUsageThisMonth('criminal');

            expect(usage.totalTokens).toBe(0);
        });
    });
});
