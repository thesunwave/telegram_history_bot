/**
 * Summary V2 Types
 * 
 * ADR-002: Types for the two-layer summary pipeline.
 */

import { TelegramMessage } from '../providers/ai-provider';

/**
 * Stance of a speaker in a conversation
 */
export type SpeakerStance =
    | 'neutral'
    | 'agrees'
    | 'disagrees'
    | 'jokes'
    | 'complains'
    | 'asks'
    | 'explains'
    | 'supports'
    | 'challenges';

/**
 * Single event entry in the structured event log
 */
export interface EventEntry {
    /** Short topic label (e.g., "coffee machine", "deployment issue") */
    topic: string;

    /** Username of the speaker */
    speaker: string;

    /** 1-2 sentence summary of what this person said */
    summary: string;

    /** Optional stance indicator */
    stance?: SpeakerStance;

    /** Optional list of users this message responds to */
    repliesTo?: string[];

    /** Importance score 0-1 (0 = low, 1 = high) */
    importance: number;

    /** Approximate timestamp of the event */
    timestamp?: number;
}

/**
 * Complete structured event log from Layer 1
 */
export interface EventLog {
    /** Chat identifier */
    chatId: number;

    /** Time period covered */
    period: {
        start: number;
        end: number;
    };

    /** List of unique participants */
    participants: string[];

    /** Structured events extracted from messages */
    events: EventEntry[];

    /** Total number of original messages processed */
    messageCount: number;

    /** Approximate token count of the event log */
    estimatedTokens?: number;
}

/**
 * Result from Layer 2 story summarizer
 */
export interface SummaryV2Result {
    /** The narrative summary text */
    summary: string;

    /** Main topics discussed (3-5 items) */
    topics: string[];

    /** Participant roles and contributions */
    participantRoles: Record<string, string>;

    /** Processing metadata */
    metadata: {
        /** Duration of Layer 1 processing (ms) */
        layer1Duration: number;
        /** Duration of Layer 2 processing (ms) */
        layer2Duration: number;
        /** Number of events in the event log */
        eventCount: number;
        /** Whether result was from cache */
        fromCache: boolean;
    };
}

/**
 * Configuration for Summary V2 pipeline
 */
export interface SummaryV2Config {
    /** Whether V2 pipeline is enabled */
    enabled: boolean;

    /** Maximum messages to process in a single nano batch */
    maxMessagesPerBatch: number;

    /** Maximum tokens for nano model output per batch */
    nanoMaxTokens: number;

    /** Maximum tokens for mini model output */
    miniMaxTokens: number;

    /** Cache TTL in seconds */
    cacheTTL: number;

    /** Version string for cache key */
    version: string;

    /** Maximum total nano calls per summary request */
    maxNanoCalls: number;
}

/**
 * Cached summary entry structure
 */
export interface SummaryV2CacheEntry {
    /** The cached summary result */
    result: SummaryV2Result;

    /** Timestamp when cached */
    cachedAt: number;

    /** Version of the pipeline that generated this */
    version: string;

    /** Number of messages that were summarized */
    messageCount: number;
}

/**
 * Context for V2 processing (extends SummaryContext)
 */
export interface SummaryV2Context {
    chatId: number;
    periodStart?: number;
    periodEnd?: number;
    requestedMessageCount?: number;
    /** Last message ID/timestamp for cache key */
    lastMessageId?: number;
}

/**
 * Batch of messages for Layer 1 processing
 */
export interface MessageBatch {
    /** Batch index (0-based) */
    index: number;

    /** Messages in this batch */
    messages: TelegramMessage[];

    /** Start timestamp of batch */
    startTs: number;

    /** End timestamp of batch */
    endTs: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_V2_CONFIG: SummaryV2Config = {
    enabled: false,
    maxMessagesPerBatch: 75,
    nanoMaxTokens: 2000,
    miniMaxTokens: 4000,
    cacheTTL: 7 * 24 * 60 * 60, // 7 days in seconds
    version: 'v2.0',
    maxNanoCalls: 5,
};
