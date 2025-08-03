import { Env, StoredMessage, LOG_ID_RADIX } from './env';
import { Logger } from './logger';

export async function fetchMessages(env: Env, chatId: number, start: number, end: number) {
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
      const fetches = list.keys.map(async (key: { name: string }) => {
        const parts = key.name.split(':');
        const ts = parseInt(parts[2]);
        if (ts >= start && ts <= end) {
          Logger.debug(env, 'fetchMessages get', {
            chat: chatId.toString(LOG_ID_RADIX),
            ts,
          });
          return env.HISTORY.get<StoredMessage>(key.name, { type: 'json' });
        }
        return null;
      });
      const results = await Promise.all(fetches);
      for (const m of results) if (m) messages.push(m);
      Logger.debug(env, 'fetchMessages page processed', {
        chat: chatId.toString(LOG_ID_RADIX),
        collected: messages.length,
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

export async function fetchLastMessages(env: Env, chatId: number, count: number) {
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

    const msgs = await Promise.all(
      keys.map((k: string) => env.HISTORY.get<StoredMessage>(k, { type: 'json' })),
    );
    const filtered = msgs.filter((m): m is StoredMessage => !!m);
    const sorted = filtered.sort((a: StoredMessage, b: StoredMessage) => b.ts - a.ts);
    
    // Filter out command messages and return only the requested count
    const nonCommandMessages = sorted.filter((msg: StoredMessage) => !msg.text.startsWith('/'));
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
