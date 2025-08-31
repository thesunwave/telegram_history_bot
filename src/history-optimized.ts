import { 
  Env, 
  StoredMessage, 
  DayBlock,
  LOG_ID_RADIX, 
  DAY
} from './env';
import { Logger, PerformanceTracker } from './logger';

/**
 * Optimized message storage using daily blocks instead of individual messages
 * This reduces KV requests from N messages to N days for range queries
 */

export function getDateFromTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function getDayBlockKey(chatId: number, date: string): string {
  return `msg_day:${chatId}:${date}`;
}

/**
 * Add a message to a daily block (race-condition safe)
 * Uses Durable Objects for atomic operations
 */
export async function addMessageToDayBlock(
  env: Env, 
  message: StoredMessage
): Promise<void> {
  const date = getDateFromTimestamp(message.ts);
  
  Logger.debug(env, 'addMessageToDayBlock: start (race-safe)', {
    chat: message.chat.toString(LOG_ID_RADIX),
    date,
    messageTs: message.ts
  });

  try {
    // Use race-condition safe method through Durable Object
    const { addMessageToDayBlockSafe } = await import('./day-block-manager');
    const result = await addMessageToDayBlockSafe(env, message);

    if (result.duplicate) {
      Logger.debug(env, 'addMessageToDayBlock: duplicate message skipped', {
        chat: message.chat.toString(LOG_ID_RADIX),
        date,
        messageTs: message.ts
      });
    } else {
      Logger.debug(env, 'addMessageToDayBlock: success', {
        chat: message.chat.toString(LOG_ID_RADIX),
        date,
        messageCount: result.messageCount
      });
    }
  } catch (error: unknown) {
    Logger.error('addMessageToDayBlock: failed', {
      chat: message.chat.toString(LOG_ID_RADIX),
      date,
      error: error.message || String(error),
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Fetch messages using optimized daily blocks
 * This reduces KV requests from N messages to N days
 */
export async function fetchMessagesOptimized(
  env: Env, 
  chatId: number, 
  start: number, 
  end: number
): Promise<StoredMessage[]> {
  const trackerId = PerformanceTracker.start('fetchMessagesOptimized', chatId.toString(LOG_ID_RADIX), {
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
    timeRangeDays: Math.ceil((end - start) / (24 * 60 * 60))
  });

  Logger.debug(env, 'fetchMessagesOptimized: start', {
    chat: chatId.toString(LOG_ID_RADIX),
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
    trackerId
  });

  try {
    // Generate list of dates to fetch
    const dates: string[] = [];
    const startDate = new Date(start * 1000);
    const endDate = new Date(end * 1000);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    Logger.debug(env, 'fetchMessagesOptimized: dates to fetch', {
      chat: chatId.toString(LOG_ID_RADIX),
      dates,
      dateCount: dates.length
    });

    // Fetch all day blocks in parallel using race-safe method
    const dayBlockPromises = dates.map(async (date) => {
      try {
        // Try Durable Object first for most up-to-date data
        const { getDayBlockSafe } = await import('./day-block-manager');
        let block = await getDayBlockSafe(env, chatId, date);
        
        // Fallback to KV if DO doesn't have the block
        if (!block) {
          // Try new sharded format first
          block = await loadShardedBlockFromKV(env, chatId, date);
          
          // Fallback to legacy single-block format
          if (!block) {
            const key = getDayBlockKey(chatId, date);
            block = await env.HISTORY.get<DayBlock>(key, { type: 'json' });
          }
        }
        
        return { date, block, success: true };
      } catch (error: unknown) {
        Logger.error('fetchMessagesOptimized: day block fetch failed', {
          chat: chatId.toString(LOG_ID_RADIX),
          date,
          error: error.message || String(error)
        });
        return { date, block: null, success: false };
      }
    });

    const dayBlockResults = await Promise.all(dayBlockPromises);
    
    // Collect all messages from successful day blocks
    const allMessages: StoredMessage[] = [];
    let successfulBlocks = 0;
    let totalBlockMessages = 0;

    for (const result of dayBlockResults) {
      if (result.success && result.block) {
        successfulBlocks++;
        // Filter messages within the exact time range
        const filteredMessages = result.block.messages.filter(msg => 
          msg.ts >= start && msg.ts <= end
        );
        allMessages.push(...filteredMessages);
        totalBlockMessages += result.block.messageCount;
        
        Logger.debug(env, 'fetchMessagesOptimized: day block processed', {
          chat: chatId.toString(LOG_ID_RADIX),
          date: result.date,
          blockMessages: result.block.messageCount,
          filteredMessages: filteredMessages.length
        });
      }
    }

    // Sort all messages by timestamp
    const sortedMessages = allMessages.sort((a, b) => a.ts - b.ts);

    const finalMetrics = PerformanceTracker.end(trackerId, {
      result: 'success',
      messagesFound: sortedMessages.length,
      timeRangeDays: dates.length,
      dayBlocksRequested: dates.length,
      dayBlocksFound: successfulBlocks
    });

    Logger.debug(env, 'fetchMessagesOptimized: complete', {
      chat: chatId.toString(LOG_ID_RADIX),
      datesRequested: dates.length,
      dayBlocksFound: successfulBlocks,
      totalBlockMessages,
      filteredMessages: sortedMessages.length,
      duration: finalMetrics?.duration,
      efficiency: `${dates.length} KV requests instead of ${sortedMessages.length} individual requests`
    });

    return sortedMessages;

  } catch (error: unknown) {
    const finalMetrics = PerformanceTracker.end(trackerId, {
      result: 'error',
      errorType: error.constructor?.name || 'Unknown'
    });

    Logger.error('fetchMessagesOptimized: failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: error.message || String(error),
      stack: error.stack,
      totalDuration: finalMetrics?.duration
    });
    throw error;
  }
}

/**
 * Hybrid fetch that tries optimized day blocks first, falls back to individual messages
 */
export async function fetchMessagesHybrid(
  env: Env, 
  chatId: number, 
  start: number, 
  end: number
): Promise<StoredMessage[]> {
  const trackerId = PerformanceTracker.start('fetchMessagesHybrid', chatId.toString(LOG_ID_RADIX), {
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
    timeRangeDays: Math.ceil((end - start) / (24 * 60 * 60))
  });

  Logger.debug(env, 'fetchMessagesHybrid: attempting optimized fetch first', {
    chat: chatId.toString(LOG_ID_RADIX)
  });

  try {
    // Try optimized day blocks first
    const optimizedMessages = await fetchMessagesOptimized(env, chatId, start, end);
    
    // If we got a reasonable number of messages, use optimized result
    if (optimizedMessages.length > 0) {
      PerformanceTracker.end(trackerId, {
        result: 'success',
        method: 'optimized',
        messagesFound: optimizedMessages.length
      });
      
      Logger.debug(env, 'fetchMessagesHybrid: optimized fetch successful', {
        chat: chatId.toString(LOG_ID_RADIX),
        messagesFound: optimizedMessages.length
      });
      
      return optimizedMessages;
    }

    // Fallback to individual message fetch for backward compatibility
    Logger.debug(env, 'fetchMessagesHybrid: falling back to individual message fetch', {
      chat: chatId.toString(LOG_ID_RADIX)
    });

    // Import the original fetchMessages function
    const { fetchMessages } = await import('./history');
    const individualMessages = await fetchMessages(env, chatId, start, end);

    PerformanceTracker.end(trackerId, {
      result: 'success',
      method: 'fallback',
      messagesFound: individualMessages.length
    });

    return individualMessages;

  } catch (error: unknown) {
    PerformanceTracker.end(trackerId, {
      result: 'error',
      errorType: error.constructor?.name || 'Unknown'
    });

    Logger.error('fetchMessagesHybrid: both methods failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: error.message || String(error)
    });
    throw error;
  }
}


async function loadShardedBlockFromKV(env: Env, chatId: number, date: string): Promise<DayBlock | null> {
  try {
    const metaKey = `msg_day_meta:${chatId}:${date}`;
    type DayBlockMeta = {
      id: string;
      date: string;
      chatId: number;
      messageCount: number;
      lastUpdated: number;
      version: number;
      shardCount: number;
      checksum?: string;
    };

    const meta = await env.HISTORY.get<DayBlockMeta>(metaKey, { type: 'json' });
    if (!meta) return null;

    const shardPromises: Promise<StoredMessage[]>[] = [];
    for (let i = 0; i < meta.shardCount; i++) {
      const shardKey = `msg_day_shard:${chatId}:${date}:${i}`;
      shardPromises.push(
        env.HISTORY.get<{ messages: StoredMessage[] }>(shardKey, { type: 'json' })
          .then(s => s?.messages || [])
          .catch(() => [])
      );
    }

    const shardMessages = await Promise.all(shardPromises);
    const messages = shardMessages.flat();
    messages.sort((a, b) => a.ts - b.ts);

    const block: DayBlock = {
      date,
      chatId,
      messages,
      messageCount: meta.messageCount,
      lastUpdated: meta.lastUpdated,
      version: meta.version,
      checksum: meta.checksum
    };

    return block;
  } catch {
    return null;
  }
}