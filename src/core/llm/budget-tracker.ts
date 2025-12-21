/**
 * LLM Budget Tracker - Token usage tracking and soft limit detection
 * 
 * ADR-001: Tracks per-model and per-feature token usage for budget management.
 * Provides soft limit checking for graceful degradation.
 */

import { Env } from '../env';
import { Logger } from '../logger';

// Use Cloudflare Workers KVNamespace type
type KVNamespace = import('@cloudflare/workers-types').KVNamespace;

/**
 * Feature types that use LLM capabilities
 */
export type FeatureType = 'summary' | 'profanity' | 'criminal';

/**
 * Token usage data structure
 */
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/**
 * Usage record for a specific model
 */
export interface ModelUsageRecord {
    model: string;
    usage: TokenUsage;
    lastUpdated: number;
}

/**
 * Usage record for a specific feature
 */
export interface FeatureUsageRecord {
    feature: FeatureType;
    usage: TokenUsage;
    lastUpdated: number;
}

/**
 * Monthly usage data structure for persistence
 */
export interface MonthlyUsageData {
    month: string;  // YYYY-MM format
    models: Record<string, TokenUsage>;
    features: Record<FeatureType, TokenUsage>;
    lastUpdated: number;
}

/**
 * Default soft limits for token usage (per month)
 * Based on ~5 USD/month budget target from ADR-001
 */
const DEFAULT_SOFT_LIMITS: Record<string, number> = {
    'gpt-4.1-nano': 20_000_000,
    'gpt-5-nano': 20_000_000,
    'gpt-4.1-mini': 3_000_000,
    'gpt-5-mini': 3_000_000,
    'default': 5_000_000,  // Fallback for unknown models
};

/**
 * LLM Budget Tracker interface
 */
export interface ILLMBudgetTracker {
    /**
     * Record token usage for a model and feature.
     */
    recordUsage(model: string, feature: FeatureType, usage: TokenUsage): void;

    /**
     * Get total token usage for a model this month.
     */
    getModelUsageThisMonth(model: string): TokenUsage;

    /**
     * Get total token usage for a feature this month.
     */
    getFeatureUsageThisMonth(feature: FeatureType): TokenUsage;

    /**
     * Check if a model has exceeded its soft limit.
     */
    isOverSoftLimit(model: string): boolean;

    /**
     * Get all usage data for the current month.
     */
    getMonthlyData(): MonthlyUsageData;

    /**
     * Flush in-memory data to persistent storage.
     */
    flush(): Promise<void>;
}

/**
 * Get current month in YYYY-MM format
 */
function getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

/**
 * Create empty token usage object
 */
function emptyUsage(): TokenUsage {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

/**
 * Add two usage objects together
 */
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
        promptTokens: a.promptTokens + b.promptTokens,
        completionTokens: a.completionTokens + b.completionTokens,
        totalTokens: a.totalTokens + b.totalTokens,
    };
}

/**
 * Default implementation of LLMBudgetTracker.
 * Uses in-memory counters with optional KV persistence.
 */
export class LLMBudgetTracker implements ILLMBudgetTracker {
    private data: MonthlyUsageData;
    private softLimits: Record<string, number>;
    private kv: KVNamespace | null;
    private kvKey: string;
    private isDirty: boolean = false;

    constructor(
        env?: Partial<Env> | null,
        existingData?: MonthlyUsageData
    ) {
        const currentMonth = getCurrentMonth();

        // Initialize or load existing data
        if (existingData && existingData.month === currentMonth) {
            this.data = existingData;
        } else {
            this.data = {
                month: currentMonth,
                models: {},
                features: {
                    summary: emptyUsage(),
                    profanity: emptyUsage(),
                    criminal: emptyUsage(),
                },
                lastUpdated: Date.now(),
            };
        }

        // Build soft limits from defaults and environment
        this.softLimits = { ...DEFAULT_SOFT_LIMITS };
        if (env) {
            const nanoLimit = env['NANO_TOKENS_SOFT_LIMIT'];
            const miniLimit = env['MINI_TOKENS_SOFT_LIMIT'];

            if (typeof nanoLimit === 'number' && nanoLimit > 0) {
                this.softLimits['gpt-4.1-nano'] = nanoLimit;
                this.softLimits['gpt-5-nano'] = nanoLimit;
            } else if (typeof nanoLimit === 'string') {
                const parsed = parseInt(nanoLimit, 10);
                if (!isNaN(parsed) && parsed > 0) {
                    this.softLimits['gpt-4.1-nano'] = parsed;
                    this.softLimits['gpt-5-nano'] = parsed;
                }
            }

            if (typeof miniLimit === 'number' && miniLimit > 0) {
                this.softLimits['gpt-4.1-mini'] = miniLimit;
                this.softLimits['gpt-5-mini'] = miniLimit;
            } else if (typeof miniLimit === 'string') {
                const parsed = parseInt(miniLimit, 10);
                if (!isNaN(parsed) && parsed > 0) {
                    this.softLimits['gpt-4.1-mini'] = parsed;
                    this.softLimits['gpt-5-mini'] = parsed;
                }
            }
        }

        // KV persistence setup
        this.kv = env?.COUNTERS || null;
        const budgetKey = env?.['LLM_BUDGET_KV_KEY'];
        this.kvKey = typeof budgetKey === 'string' ? budgetKey : 'llm_budget';
    }

    recordUsage(model: string, feature: FeatureType, usage: TokenUsage): void {
        // Check if we need to reset for a new month
        const currentMonth = getCurrentMonth();
        if (this.data.month !== currentMonth) {
            // Reset data for new month
            this.data = {
                month: currentMonth,
                models: {},
                features: {
                    summary: emptyUsage(),
                    profanity: emptyUsage(),
                    criminal: emptyUsage(),
                },
                lastUpdated: Date.now(),
            };
        }

        // Update model usage
        if (!this.data.models[model]) {
            this.data.models[model] = emptyUsage();
        }
        this.data.models[model] = addUsage(this.data.models[model], usage);

        // Update feature usage
        this.data.features[feature] = addUsage(this.data.features[feature], usage);

        // Update timestamp
        this.data.lastUpdated = Date.now();
        this.isDirty = true;

        // Log for observability
        Logger.log('LLM usage recorded', {
            model,
            feature,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            monthlyModelTotal: this.data.models[model].totalTokens,
            monthlyFeatureTotal: this.data.features[feature].totalTokens,
        });
    }

    getModelUsageThisMonth(model: string): TokenUsage {
        return this.data.models[model] || emptyUsage();
    }

    getFeatureUsageThisMonth(feature: FeatureType): TokenUsage {
        return this.data.features[feature] || emptyUsage();
    }

    isOverSoftLimit(model: string): boolean {
        const usage = this.getModelUsageThisMonth(model);
        const limit = this.getSoftLimit(model);
        const isOver = usage.totalTokens > limit;

        if (isOver) {
            Logger.warn('Model over soft limit', {
                model,
                usage: usage.totalTokens,
                limit,
                percentUsed: ((usage.totalTokens / limit) * 100).toFixed(1) + '%',
            });
        }

        return isOver;
    }

    private getSoftLimit(model: string): number {
        // Try exact match first
        if (this.softLimits[model] !== undefined) {
            return this.softLimits[model];
        }

        // Try pattern matching
        const modelLower = model.toLowerCase();
        if (modelLower.includes('nano')) {
            return this.softLimits['gpt-4.1-nano'] || this.softLimits['default'];
        }
        if (modelLower.includes('mini')) {
            return this.softLimits['gpt-4.1-mini'] || this.softLimits['default'];
        }

        return this.softLimits['default'];
    }

    getMonthlyData(): MonthlyUsageData {
        return { ...this.data };
    }

    async flush(): Promise<void> {
        if (!this.isDirty || !this.kv) {
            return;
        }

        try {
            const key = `${this.kvKey}_${this.data.month}`;
            await this.kv.put(key, JSON.stringify(this.data));
            this.isDirty = false;
            Logger.log('LLM budget data flushed to KV', { key, month: this.data.month });
        } catch (error) {
            Logger.error('Failed to flush LLM budget data', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Load existing data from KV storage.
     */
    static async loadFromKV(
        kv: KVNamespace,
        kvKeyPrefix: string = 'llm_budget'
    ): Promise<MonthlyUsageData | null> {
        try {
            const currentMonth = getCurrentMonth();
            const key = `${kvKeyPrefix}_${currentMonth}`;
            const data = await kv.get(key);

            if (data) {
                const parsed = JSON.parse(data) as MonthlyUsageData;
                if (parsed.month === currentMonth) {
                    return parsed;
                }
            }
        } catch (error) {
            Logger.error('Failed to load LLM budget data from KV', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return null;
    }
}

/**
 * Singleton tracker instance
 */
let globalTracker: ILLMBudgetTracker | null = null;

/**
 * Get or create the global budget tracker instance.
 */
export function getBudgetTracker(
    env?: Partial<Env> | null
): ILLMBudgetTracker {
    if (!globalTracker) {
        globalTracker = new LLMBudgetTracker(env);
    }
    return globalTracker;
}

/**
 * Reset the global tracker (primarily for testing).
 */
export function resetBudgetTracker(): void {
    globalTracker = null;
}
