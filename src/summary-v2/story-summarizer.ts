/**
 * Story Summarizer (Layer 2)
 * 
 * ADR-002: Converts the structured event log into a readable narrative using mini model.
 * Focuses on:
 * - Multi-participant awareness (who said what)
 * - Dialog structure (who replied to whom)
 * - Emotional reactions and stances
 * - Clear topic organization
 */

import { Env, LOG_ID_RADIX, TELEGRAM_LIMIT } from '../env';
import { Logger } from '../logger';
import { getModelPolicy } from '../llm';
import { OpenAIProvider } from '../providers/openai-provider';
import {
    EventLog,
    EventEntry,
    SummaryV2Result,
    SummaryV2Config,
    DEFAULT_V2_CONFIG
} from './types';

/**
 * System prompt for mini model story summarization
 */
const STORY_SUMMARIZER_SYSTEM_PROMPT = `Ты мастер написания сводок групповых чатов. Твоя задача — создать читаемое, структурированное резюме на основе журнала событий.

СТИЛЬ:
- Пиши живо и интересно, но фактически точно
- Показывай динамику обсуждения: кто начал, кто поддержал, кто возразил
- Отмечай эмоциональные моменты ("X был удивлён", "Y пошутил")
- Группируй по темам, но показывай связи между ними
- Можно использовать легкую иронию, но факты должны быть точны
- НЕ выдумывай события, которых нет в исходных данных

ФОРМАТ:
📌 ОСНОВНЫЕ ТЕМЫ
• [3-5 ключевых тем одной строкой каждая]

💬 ЧТО ОБСУЖДАЛИ
[Для каждой темы: кто начал, что говорили, к чему пришли]
[Отмечай споры, согласия, шутки]

👥 РОЛИ УЧАСТНИКОВ  
[Кто был активен, кто поддерживал, кто спорил]

⚡ КЛЮЧЕВЫЕ МОМЕНТЫ
[Важные решения, яркие реплики, неожиданные повороты]

ОГРАНИЧЕНИЯ:
- Максимум ${TELEGRAM_LIMIT} символов
- Используй эмодзи умеренно
- Пиши на русском`;

/**
 * Format event log for mini model input
 */
function formatEventLogForPrompt(eventLog: EventLog): string {
    const lines: string[] = [];

    lines.push(`ЖУРНАЛ СОБЫТИЙ ЧАТА`);
    lines.push(`Период: ${formatDate(eventLog.period.start)} — ${formatDate(eventLog.period.end)}`);
    lines.push(`Участники (${eventLog.participants.length}): ${eventLog.participants.join(', ')}`);
    lines.push(`Всего сообщений: ${eventLog.messageCount}`);
    lines.push('');
    lines.push('СОБЫТИЯ:');

    // Group events by topic for better organization
    const byTopic = new Map<string, EventEntry[]>();
    for (const event of eventLog.events) {
        const existing = byTopic.get(event.topic) || [];
        existing.push(event);
        byTopic.set(event.topic, existing);
    }

    for (const [topic, events] of byTopic) {
        lines.push(`\n[ТЕМА: ${topic}]`);
        for (const event of events) {
            const stanceEmoji = getStanceEmoji(event.stance);
            const repliesInfo = event.repliesTo?.length
                ? ` (→ ${event.repliesTo.join(', ')})`
                : '';
            const importanceMarker = event.importance >= 0.8 ? '❗' : '';

            lines.push(`${importanceMarker}${stanceEmoji} ${event.speaker}${repliesInfo}: ${event.summary}`);
        }
    }

    return lines.join('\n');
}

/**
 * Get emoji for stance
 */
function getStanceEmoji(stance?: string): string {
    const emojiMap: Record<string, string> = {
        'agrees': '👍',
        'disagrees': '👎',
        'jokes': '😄',
        'complains': '😤',
        'asks': '❓',
        'explains': '📝',
        'supports': '🤝',
        'challenges': '⚔️',
        'neutral': '💬',
    };
    return emojiMap[stance || 'neutral'] || '💬';
}

/**
 * Format timestamp to readable date
 */
function formatDate(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Build user prompt for story summarization
 */
function buildStorySummarizerPrompt(eventLog: EventLog): string {
    const formattedLog = formatEventLogForPrompt(eventLog);

    return `На основе журнала событий создай читаемую сводку чата.

${formattedLog}

Создай структурированное резюме, показывающее динамику обсуждения и роли участников.`;
}

/**
 * Extract topics from event log
 */
function extractTopics(eventLog: EventLog): string[] {
    const topicCounts = new Map<string, number>();

    for (const event of eventLog.events) {
        const count = topicCounts.get(event.topic) || 0;
        topicCounts.set(event.topic, count + 1);
    }

    // Sort by frequency and take top 5
    return Array.from(topicCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([topic]) => topic);
}

/**
 * Analyze participant roles from event log
 */
function analyzeParticipantRoles(eventLog: EventLog): Record<string, string> {
    const roles: Record<string, string> = {};
    const stats = new Map<string, {
        count: number;
        stances: string[];
        importance: number;
        topics: Set<string>;
    }>();

    for (const event of eventLog.events) {
        const existing = stats.get(event.speaker) || {
            count: 0,
            stances: [],
            importance: 0,
            topics: new Set(),
        };
        existing.count++;
        if (event.stance) existing.stances.push(event.stance);
        existing.importance += event.importance;
        existing.topics.add(event.topic);
        stats.set(event.speaker, existing);
    }

    for (const [speaker, data] of stats) {
        const dominantStance = findDominantStance(data.stances);
        const activityLevel = data.count >= 5 ? 'очень активный' : data.count >= 2 ? 'активный' : 'участвовал';
        const topicsCount = data.topics.size;

        let role = activityLevel;
        if (dominantStance === 'jokes') role += ', шутник';
        else if (dominantStance === 'explains') role += ', объяснял';
        else if (dominantStance === 'challenges') role += ', спорил';
        else if (dominantStance === 'supports') role += ', поддерживал';
        else if (dominantStance === 'asks') role += ', задавал вопросы';

        if (topicsCount >= 3) role += `, в ${topicsCount} темах`;

        roles[speaker] = role;
    }

    return roles;
}

/**
 * Find most common stance
 */
function findDominantStance(stances: string[]): string {
    if (stances.length === 0) return 'neutral';

    const counts = new Map<string, number>();
    for (const stance of stances) {
        counts.set(stance, (counts.get(stance) || 0) + 1);
    }

    let maxStance = 'neutral';
    let maxCount = 0;
    for (const [stance, count] of counts) {
        if (count > maxCount && stance !== 'neutral') {
            maxStance = stance;
            maxCount = count;
        }
    }

    return maxStance;
}

/**
 * Main entry point: Summarize event log into narrative
 */
export async function summarizeEventLog(
    eventLog: EventLog,
    env: Env,
    config: SummaryV2Config = DEFAULT_V2_CONFIG
): Promise<SummaryV2Result> {
    const startTime = Date.now();

    Logger.debug(env, 'Story Summarizer: starting', {
        chatId: eventLog.chatId.toString(LOG_ID_RADIX),
        eventCount: eventLog.events.length,
        participants: eventLog.participants.length,
        estimatedTokens: eventLog.estimatedTokens,
    });

    // Check if event log is too large
    if (eventLog.estimatedTokens && eventLog.estimatedTokens > 8000) {
        Logger.warn('Story Summarizer: event log may be too large', {
            estimatedTokens: eventLog.estimatedTokens,
        });
    }

    const modelPolicy = getModelPolicy(env as Partial<Env> & Record<string, unknown>);
    const miniModel = modelPolicy.getModel('mini');

    // Create provider with mini model
    const provider = new OpenAIProvider(env, 'standard', miniModel);

    const userPrompt = buildStorySummarizerPrompt(eventLog);

    try {
        const response = await provider.summarize(
            {
                messages: [],
                systemPrompt: STORY_SUMMARIZER_SYSTEM_PROMPT,
                userPrompt: userPrompt,
                limitNote: `Максимум ${TELEGRAM_LIMIT} символов. Структурированный формат.`,
            },
            {
                maxTokens: config.miniMaxTokens,
                temperature: 0.5,
            },
            env
        );

        const duration = Date.now() - startTime;

        // Extract topics and roles
        const topics = extractTopics(eventLog);
        const participantRoles = analyzeParticipantRoles(eventLog);

        Logger.debug(env, 'Story Summarizer: complete', {
            chatId: eventLog.chatId.toString(LOG_ID_RADIX),
            summaryLength: response.length,
            topics: topics.length,
            participants: Object.keys(participantRoles).length,
            duration,
        });

        return {
            summary: response,
            topics,
            participantRoles,
            metadata: {
                layer1Duration: 0, // Will be set by v2-processor
                layer2Duration: duration,
                eventCount: eventLog.events.length,
                fromCache: false,
            },
        };
    } catch (error) {
        Logger.error('Story Summarizer: failed', {
            chatId: eventLog.chatId.toString(LOG_ID_RADIX),
            error: error instanceof Error ? error.message : String(error),
        });

        // Return fallback summary
        return createFallbackSummary(eventLog, Date.now() - startTime);
    }
}

/**
 * Create fallback summary when LLM fails
 */
function createFallbackSummary(eventLog: EventLog, duration: number): SummaryV2Result {
    const topics = extractTopics(eventLog);
    const participantRoles = analyzeParticipantRoles(eventLog);

    // Build simple summary from event log
    const lines: string[] = [];
    lines.push(`📊 Сводка чата (${eventLog.messageCount} сообщений)`);
    lines.push('');
    lines.push('📌 ТЕМЫ: ' + topics.join(', '));
    lines.push('');
    lines.push('👥 УЧАСТНИКИ:');
    for (const [name, role] of Object.entries(participantRoles)) {
        lines.push(`• ${name}: ${role}`);
    }
    lines.push('');
    lines.push('💬 ОСНОВНОЕ:');

    // Add top 5 most important events
    const topEvents = [...eventLog.events]
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 5);

    for (const event of topEvents) {
        lines.push(`• ${event.speaker}: ${event.summary}`);
    }

    return {
        summary: lines.join('\n'),
        topics,
        participantRoles,
        metadata: {
            layer1Duration: 0,
            layer2Duration: duration,
            eventCount: eventLog.events.length,
            fromCache: false,
        },
    };
}
