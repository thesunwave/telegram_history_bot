/**
 * Summary V2 Configuration
 * 
 * ADR-002: Loads and validates V2 pipeline configuration from environment.
 */

import { Env } from '../env';
import { SummaryV2Config, DEFAULT_V2_CONFIG } from './types';

/**
 * Load V2 configuration from environment
 */
export function loadV2Config(env: Env): SummaryV2Config {
    return {
        enabled: getEnvBoolean(env, 'SUMMARY_V2_ENABLED', DEFAULT_V2_CONFIG.enabled),
        maxMessagesPerBatch: getEnvNumber(env, 'SUMMARY_V2_MAX_MESSAGES_PER_BATCH', DEFAULT_V2_CONFIG.maxMessagesPerBatch),
        nanoMaxTokens: getEnvNumber(env, 'SUMMARY_V2_NANO_MAX_TOKENS', DEFAULT_V2_CONFIG.nanoMaxTokens),
        miniMaxTokens: getEnvNumber(env, 'SUMMARY_V2_MINI_MAX_TOKENS', DEFAULT_V2_CONFIG.miniMaxTokens),
        cacheTTL: getEnvNumber(env, 'SUMMARY_V2_CACHE_TTL', DEFAULT_V2_CONFIG.cacheTTL),
        version: getEnvString(env, 'SUMMARY_V2_VERSION', DEFAULT_V2_CONFIG.version),
        maxNanoCalls: getEnvNumber(env, 'SUMMARY_V2_MAX_NANO_CALLS', DEFAULT_V2_CONFIG.maxNanoCalls),
    };
}

/**
 * Check if V2 is enabled
 */
export function isV2Enabled(env: Env): boolean {
    return getEnvBoolean(env, 'SUMMARY_V2_ENABLED', DEFAULT_V2_CONFIG.enabled);
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
