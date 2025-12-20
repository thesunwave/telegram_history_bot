/**
 * Event Log Builder (Layer 1)
 * 
 * ADR-002: Processes raw chat messages into a structured event log using nano model.
 * This compresses many messages into a smaller set of structured events that preserve:
 * - Who spoke
 * - What was said (summarized)
 * - How others reacted (support/disagreement/jokes)
 * - Dialog structure (who replied to whom)
 */

import { Env, LOG_ID_RADIX } from '../env';
import { Logger } from '../logger';
import { TelegramMessage } from '../providers/ai-provider';
import { getModelPolicy } from '../llm';
import { OpenAIProvider } from '../providers/openai-provider';
import {
    EventEntry,
    EventLog,
    SummaryV2Config,
    SummaryV2Context,
    MessageBatch,
    DEFAULT_V2_CONFIG
} from './types';

/**
 * System prompt for nano model event log extraction - COMPACT version
 */
const EVENT_LOG_SYSTEM_PROMPT = `Выдели ТОЛЬКО 5 самых важных событий из чата. JSON.

{"events":[{"t":"тема","s":"кто","m":"суть 5сл","i":0.8}]}

Всего 5 событий. t=topic(2сл), s=speaker, m=суть(5сл!), i=важность.`;

/**
 * User prompt template for event log extraction
 */
function buildEventLogUserPrompt(
    messages: TelegramMessage[],
    batchInfo: { index: number; total: number }
): string {
    const formattedMessages = messages.map(m =>
        `${m.username}: ${m.text}`
    ).join('\n');

    return `Сожми в JSON (часть ${batchInfo.index + 1}/${batchInfo.total}):\n${formattedMessages}`;
}

/**
 * Split messages into batches for processing
 */
export function createBatches(
    messages: TelegramMessage[],
    batchSize: number
): MessageBatch[] {
    const batches: MessageBatch[] = [];

    for (let i = 0; i < messages.length; i += batchSize) {
        const batchMessages = messages.slice(i, i + batchSize);
        batches.push({
            index: Math.floor(i / batchSize),
            messages: batchMessages,
            startTs: batchMessages[0]?.ts || 0,
            endTs: batchMessages[batchMessages.length - 1]?.ts || 0,
        });
    }

    return batches;
}

/**
 * Process a single batch of messages with nano model
 */
async function processBatch(
    batch: MessageBatch,
    totalBatches: number,
    env: Env,
    config: SummaryV2Config
): Promise<EventEntry[]> {
    const modelPolicy = getModelPolicy(env as Partial<Env> & Record<string, unknown>);
    const nanoModel = modelPolicy.getModel('nano');

    // Create provider with nano model
    const provider = new OpenAIProvider(env, 'standard', nanoModel);

    const userPrompt = buildEventLogUserPrompt(batch.messages, {
        index: batch.index,
        total: totalBatches
    });

    try {
        const response = await provider.summarize(
            {
                messages: [], // We're using custom prompts
                systemPrompt: EVENT_LOG_SYSTEM_PROMPT,
                userPrompt: userPrompt,
                limitNote: `Максимум ${config.nanoMaxTokens} токенов. Формат: строго JSON.`,
            },
            {
                maxTokens: config.nanoMaxTokens,
                temperature: 0.3,
                forceJsonResponse: true,
            },
            env
        );

        // Parse JSON response
        const parsed = parseEventLogResponse(response);

        Logger.debug(env, 'Event Log Builder: batch processed', {
            batchIndex: batch.index,
            inputMessages: batch.messages.length,
            outputEvents: parsed.length,
        });

        return parsed;
    } catch (error) {
        Logger.error('Event Log Builder: batch processing failed', {
            batchIndex: batch.index,
            error: error instanceof Error ? error.message : String(error),
        });

        // Return simplified events on error (fallback)
        return createFallbackEvents(batch.messages);
    }
}

/**
 * Parse JSON response from nano model
 * Handles both short (t,s,m,i) and long (topic,speaker,summary,importance) field names
 */
function parseEventLogResponse(response: string): EventEntry[] {
    try {
        // Clean up response - remove markdown formatting if present
        let cleanResponse = response.trim();
        const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            cleanResponse = jsonMatch[0];
        }

        const parsed = JSON.parse(cleanResponse);

        if (!parsed.events || !Array.isArray(parsed.events)) {
            throw new Error('Invalid response: missing events array');
        }

        // Validate and normalize events - support both short and long field names
        return parsed.events.map((event: any) => ({
            topic: String(event.t || event.topic || 'общее'),
            speaker: String(event.s || event.speaker || 'unknown'),
            summary: String(event.m || event.summary || ''),
            stance: 'neutral' as const, // Skip stance for compact format
            importance: normalizeImportance(event.i ?? event.importance),
        })).filter((e: EventEntry) => e.summary.length > 0);
    } catch (error) {
        Logger.warn('Event Log Builder: failed to parse response', {
            error: error instanceof Error ? error.message : String(error),
            responsePreview: response.substring(0, 200),
        });
        return [];
    }
}

/**
 * Validate stance value
 */
function validateStance(stance: any): EventEntry['stance'] {
    const validStances = ['neutral', 'agrees', 'disagrees', 'jokes', 'complains', 'asks', 'explains', 'supports', 'challenges'];
    if (typeof stance === 'string' && validStances.includes(stance)) {
        return stance as EventEntry['stance'];
    }
    return 'neutral';
}

/**
 * Normalize importance to 0-1 range
 */
function normalizeImportance(value: any): number {
    if (typeof value !== 'number') {
        return 0.5;
    }
    return Math.max(0, Math.min(1, value));
}

/**
 * Create fallback events when LLM processing fails
 */
function createFallbackEvents(messages: TelegramMessage[]): EventEntry[] {
    // Group by speaker and create simple events
    const byUser = new Map<string, TelegramMessage[]>();

    for (const msg of messages) {
        const existing = byUser.get(msg.username) || [];
        existing.push(msg);
        byUser.set(msg.username, existing);
    }

    return Array.from(byUser.entries()).map(([speaker, msgs]) => ({
        topic: 'общее обсуждение',
        speaker,
        summary: msgs.length === 1
            ? msgs[0].text.substring(0, 100)
            : `${msgs.length} сообщений`,
        stance: 'neutral' as const,
        importance: 0.5,
    }));
}

/**
 * Merge events from multiple batches, combining low-importance events
 */
export function mergeAndCompactEvents(
    allEvents: EventEntry[],
    minImportance: number = 0.3
): EventEntry[] {
    // First, filter out very low importance events
    const significantEvents = allEvents.filter(e => e.importance >= minImportance);

    // Then merge adjacent events from same speaker on same topic
    const merged: EventEntry[] = [];

    for (const event of significantEvents) {
        const last = merged[merged.length - 1];

        if (last &&
            last.speaker === event.speaker &&
            last.topic === event.topic &&
            last.importance < 0.7 && event.importance < 0.7) {
            // Merge with previous event
            last.summary = `${last.summary}; ${event.summary}`;
            last.importance = Math.max(last.importance, event.importance);
            if (event.repliesTo) {
                last.repliesTo = [...new Set([...(last.repliesTo || []), ...event.repliesTo])];
            }
        } else {
            merged.push({ ...event });
        }
    }

    return merged;
}

/**
 * Main entry point: Build event log from messages
 */
export async function buildEventLog(
    messages: TelegramMessage[],
    env: Env,
    context: SummaryV2Context,
    config: SummaryV2Config = DEFAULT_V2_CONFIG
): Promise<EventLog> {
    const startTime = Date.now();

    Logger.debug(env, 'Event Log Builder: starting', {
        chatId: context.chatId.toString(LOG_ID_RADIX),
        messageCount: messages.length,
        maxBatchSize: config.maxMessagesPerBatch,
    });

    // Create batches
    const batches = createBatches(messages, config.maxMessagesPerBatch);

    // Limit number of batches to respect budget
    const limitedBatches = batches.slice(0, config.maxNanoCalls);

    if (batches.length > config.maxNanoCalls) {
        Logger.warn('Event Log Builder: truncating batches due to limit', {
            originalBatches: batches.length,
            limitedTo: config.maxNanoCalls,
            droppedMessages: batches.slice(config.maxNanoCalls).reduce((sum, b) => sum + b.messages.length, 0),
        });
    }

    // Process batches IN PARALLEL for speed
    const batchPromises = limitedBatches.map(batch =>
        processBatch(batch, limitedBatches.length, env, config)
    );

    const batchResults = await Promise.all(batchPromises);
    const allEvents = batchResults.flat();

    // Merge and compact events
    const compactedEvents = mergeAndCompactEvents(allEvents);

    // Extract unique participants
    const participants = [...new Set(messages.map(m => m.username))];

    // Calculate period
    const period = {
        start: context.periodStart || messages[0]?.ts || 0,
        end: context.periodEnd || messages[messages.length - 1]?.ts || 0,
    };

    const duration = Date.now() - startTime;

    Logger.debug(env, 'Event Log Builder: complete', {
        chatId: context.chatId.toString(LOG_ID_RADIX),
        inputMessages: messages.length,
        batchesProcessed: limitedBatches.length,
        eventsExtracted: allEvents.length,
        eventsAfterCompaction: compactedEvents.length,
        participants: participants.length,
        duration,
    });

    return {
        chatId: context.chatId,
        period,
        participants,
        events: compactedEvents,
        messageCount: messages.length,
        estimatedTokens: estimateEventLogTokens(compactedEvents),
    };
}

/**
 * Estimate token count for event log (rough approximation)
 */
function estimateEventLogTokens(events: EventEntry[]): number {
    // Rough estimate: 4 chars per token for Russian text
    const totalChars = events.reduce((sum, e) => {
        return sum + e.topic.length + e.speaker.length + e.summary.length + 50; // 50 for structure
    }, 0);

    return Math.ceil(totalChars / 4);
}
