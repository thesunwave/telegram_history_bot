import { Env, StoredMessage, LOG_ID_RADIX } from '../../core/env';
import { Logger } from '../../core/logger';
import { addMessageToDayBlock } from '../history/history-optimized';

/**
 * Migration utilities for converting individual messages to daily blocks
 */

export interface MigrationStats {
  totalMessages: number;
  migratedMessages: number;
  failedMessages: number;
  daysCreated: number;
  duration: number;
}

/**
 * Migrate individual messages to daily blocks for a specific chat and date range
 */
export async function migrateMessagesToDayBlocks(
  env: Env,
  chatId: number,
  startDate: string,
  endDate: string
): Promise<MigrationStats> {
  const startTime = Date.now();
  const stats: MigrationStats = {
    totalMessages: 0,
    migratedMessages: 0,
    failedMessages: 0,
    daysCreated: 0,
    duration: 0
  };

  Logger.log('Migration: starting message migration to day blocks', {
    chat: chatId.toString(LOG_ID_RADIX),
    startDate,
    endDate
  });

  try {
    // List all individual message keys for this chat
    const prefix = `msg:${chatId}:`;
    let cursor: string | undefined = undefined;
    const daysProcessed = new Set<string>();

    do {
      const list: { keys: { name: string }[], cursor?: string } = await env.HISTORY.list({
        prefix,
        cursor
      });
      cursor = list.cursor;

      Logger.debug(env, 'Migration: processing batch', {
        chat: chatId.toString(LOG_ID_RADIX),
        keysInBatch: list.keys.length,
        cursor: cursor ? 'has_more' : 'last_batch'
      });

      // Process messages in this batch
      for (const key of list.keys) {
        try {
          const parts = key.name.split(':');
          if (parts.length < 3) continue;

          const timestamp = parseInt(parts[2]);
          const messageDate = new Date(timestamp * 1000).toISOString().slice(0, 10);

          // Skip if outside date range
          if (messageDate < startDate || messageDate > endDate) {
            continue;
          }

          // Get the individual message
          const message = await env.HISTORY.get<StoredMessage>(key.name, { type: 'json' });
          if (!message) {
            Logger.debug(env, 'Migration: message not found', { key: key.name });
            continue;
          }

          stats.totalMessages++;

          // Add to day block
          await addMessageToDayBlock(env, message);
          stats.migratedMessages++;
          daysProcessed.add(messageDate);

          if (stats.migratedMessages % 100 === 0) {
            Logger.debug(env, 'Migration: progress update', {
              chat: chatId.toString(LOG_ID_RADIX),
              migratedMessages: stats.migratedMessages,
              totalMessages: stats.totalMessages,
              daysProcessed: daysProcessed.size
            });
          }

        } catch (error: any) {
          stats.failedMessages++;
          Logger.error('Migration: failed to migrate message', {
            chat: chatId.toString(LOG_ID_RADIX),
            key: key.name,
            error: error.message || String(error)
          });
        }
      }

    } while (cursor);

    stats.daysCreated = daysProcessed.size;
    stats.duration = Date.now() - startTime;

    Logger.log('Migration: completed successfully', {
      chat: chatId.toString(LOG_ID_RADIX),
      stats,
      successRate: `${((stats.migratedMessages / stats.totalMessages) * 100).toFixed(1)}%`,
      averageMessagesPerDay: Math.round(stats.migratedMessages / stats.daysCreated)
    });

    return stats;

  } catch (error: any) {
    stats.duration = Date.now() - startTime;
    Logger.error('Migration: failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: error.message || String(error),
      partialStats: stats
    });
    throw error;
  }
}

/**
 * Check migration status for a chat
 */
export async function checkMigrationStatus(
  env: Env,
  chatId: number,
  dateRange: { start: string; end: string }
): Promise<{
  individualMessages: number;
  dayBlocks: number;
  migrationNeeded: boolean;
}> {
  Logger.debug(env, 'Migration check: starting', {
    chat: chatId.toString(LOG_ID_RADIX),
    dateRange
  });

  try {
    // Count individual messages
    const prefix = `msg:${chatId}:`;
    let cursor: string | undefined = undefined;
    let individualMessages = 0;

    do {
      const list: any = await env.HISTORY.list({ prefix, cursor });
      cursor = list.cursor;
      individualMessages += list.keys.length;
    } while (cursor);

    // Count day blocks
    const dates: string[] = [];
    const startDate = new Date(dateRange.start);
    const endDate = new Date(dateRange.end);

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    let dayBlocks = 0;
    for (const date of dates) {
      const key = `msg_day:${chatId}:${date}`;
      const block = await env.HISTORY.get(key);
      if (block) dayBlocks++;
    }

    const migrationNeeded = individualMessages > 0 && dayBlocks === 0;

    Logger.debug(env, 'Migration check: completed', {
      chat: chatId.toString(LOG_ID_RADIX),
      individualMessages,
      dayBlocks,
      migrationNeeded
    });

    return {
      individualMessages,
      dayBlocks,
      migrationNeeded
    };

  } catch (error: any) {
    Logger.error('Migration check: failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: error.message || String(error)
    });
    throw error;
  }
}