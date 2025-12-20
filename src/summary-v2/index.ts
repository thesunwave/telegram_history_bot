/**
 * Summary V2 Module - Public API
 * 
 * ADR-002: Two-layer summary pipeline with caching.
 */

// Types
export type {
    EventEntry,
    EventLog,
    SummaryV2Result,
    SummaryV2Config,
    SummaryV2CacheEntry,
    SummaryV2Context,
    MessageBatch,
    SpeakerStance,
} from './types';
export { DEFAULT_V2_CONFIG } from './types';

// Configuration
export { loadV2Config, isV2Enabled } from './config';

// Cache
export {
    getCacheKey,
    getCacheKeyFromPeriod,
    getCached,
    setCache,
    invalidateCache,
} from './summary-cache';

// Event Log Builder (Layer 1)
export {
    buildEventLog,
    createBatches,
    mergeAndCompactEvents,
} from './event-log-builder';

// Story Summarizer (Layer 2)
export { summarizeEventLog } from './story-summarizer';

// Main Processor
export { V2Processor, createV2Processor } from './v2-processor';
