import { Env, StoredMessage, LOG_ID_RADIX, DEFAULT_KV_BATCH_SIZE, DEFAULT_KV_BATCH_DELAY } from './env';
import { Logger } from './logger';
import { processBatches } from './utils';

export async function fetchMessages(env: Env, chatId: number, start: number, end: number): Promise<StoredMessage[]> {
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const messages: StoredMessage[] = [];
  Logger.debug(env, 'fetchMessages start', {
    chat: chatId.toString(LOG_ID_RADIX),
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
  });
  try {
    do {
      Logger.debug(env, 'fetchMessages list', {
        chat: chatId.toString(LOG_ID_RADIX),
        cursor,
      });
      const list: { keys: { name: string }[], cursor?: string } = await env.HISTORY.list({ prefix, cursor });
      cursor = list.cursor;
      Logger.debug(env, 'fetchMessages list done', {
        chat: chatId.toString(LOG_ID_RADIX),
        keys: list.keys.length,
        nextCursor: cursor,
      });
      // Filter keys that match the time range before processing
      const keysToFetch = list.keys.filter((key: { name: string }) => {
        const parts = key.name.split(':');
        const ts = parseInt(parts[2]);
        return ts >= start && ts <= end;
      });

      Logger.debug(env, 'fetchMessages batch processing', {
        chat: chatId.toString(LOG_ID_RADIX),
        totalKeys: list.keys.length,
        keysToFetch: keysToFetch.length,
        batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
      });

      // Process KV requests in batches to avoid API limits
      const results = await processBatches(
        keysToFetch,
        async (key: { name: string }) => {
          const parts = key.name.split(':');
          const ts = parseInt(parts[2]);
          Logger.debug(env, 'fetchMessages get', {
            chat: chatId.toString(LOG_ID_RADIX),
            ts,
          });
          return env.HISTORY.get<StoredMessage>(key.name, { type: 'json' });
        },
        {
          batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
          delayBetweenBatches: env.KV_BATCH_DELAY || DEFAULT_KV_BATCH_DELAY,
        }
      );

      // Add successful results to messages array
      for (const m of results) {
        if (m !== null && m !== undefined) {
          messages.push(m);
        }
      }
      Logger.debug(env, 'fetchMessages page processed', {
        chat: chatId.toString(LOG_ID_RADIX),
        totalKeysInPage: list.keys.length,
        keysMatchingTimeRange: keysToFetch.length,
        successfulFetches: results.length,
        totalCollected: messages.length,
        batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
      });
    } while (cursor && messages.length < 10000);
    return messages.sort((a, b) => a.ts - b.ts);
  } catch (err: any) {
    Logger.error('fetchMessages failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
    });
    throw err;
  } finally {
    Logger.debug(env, 'fetchMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
      count: messages.length,
    });
  }
}

export async function fetchLastMessages(env: Env, chatId: number, count: number): Promise<StoredMessage[]> {
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const keys: string[] = [];
  Logger.debug(env, 'fetchLastMessages start', {
    chat: chatId.toString(LOG_ID_RADIX),
    count,
  });
  try {
    do {
      Logger.debug(env, 'fetchLastMessages list', {
        chat: chatId.toString(LOG_ID_RADIX),
        cursor,
      });
      const list: { keys: { name: string }[], cursor?: string } = await env.HISTORY.list({ prefix, cursor });
      cursor = list.cursor;
      Logger.debug(env, 'fetchLastMessages list done', {
        chat: chatId.toString(LOG_ID_RADIX),
        keys: list.keys.length,
        nextCursor: cursor,
      });
      for (const k of list.keys) {
        keys.push(k.name);
        // Fetch extra messages to account for potential filtering
        if (keys.length > count + 5) keys.shift();
      }
      Logger.debug(env, 'fetchLastMessages page processed', {
        chat: chatId.toString(LOG_ID_RADIX),
        collected: keys.length,
      });
    } while (cursor);

    Logger.debug(env, 'fetchLastMessages batch processing', {
      chat: chatId.toString(LOG_ID_RADIX),
      totalKeys: keys.length,
      batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
    });

    // Process KV requests in batches to avoid API limits
    const msgs = await processBatches(
      keys,
      async (k: string) => {
        Logger.debug(env, 'fetchLastMessages get', {
          chat: chatId.toString(LOG_ID_RADIX),
          key: k,
        });
        return env.HISTORY.get<StoredMessage | null>(k, { type: 'json' });
      },
      {
        batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
        delayBetweenBatches: env.KV_BATCH_DELAY || DEFAULT_KV_BATCH_DELAY,
      }
    );
    Logger.debug(env, 'fetchLastMessages batch processing complete', {
      chat: chatId.toString(LOG_ID_RADIX),
      totalKeys: keys.length,
      successfulFetches: msgs.filter(m => m !== null).length,
      batchSize: env.KV_BATCH_SIZE || DEFAULT_KV_BATCH_SIZE,
    });

    const filtered = msgs.filter((m): m is StoredMessage => m !== null);
    const sorted = filtered.sort((a: StoredMessage, b: StoredMessage) => b.ts - a.ts);
    
    // Filter out command messages and return only the requested count
    const nonCommandMessages = sorted.filter((msg: StoredMessage) => Boolean(msg.text) && !msg.text!.startsWith('/'));
    const result = nonCommandMessages.slice(0, count);
    
    // Sort the final result in ascending order (oldest first) for consistent ordering
    return result.sort((a: StoredMessage, b: StoredMessage) => a.ts - b.ts);
  } catch (err: any) {
    Logger.error('fetchLastMessages failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
    });
    throw err;
  } finally {
    Logger.debug(env, 'fetchLastMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
      count: keys.length,
    });
  }
}
