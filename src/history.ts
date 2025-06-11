import { Env, StoredMessage, LOG_ID_RADIX } from './env';

export async function fetchMessages(
  env: Env,
  chatId: number,
  start: number,
  end: number,
) {
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const messages: StoredMessage[] = [];
  console.debug('fetchMessages start', {
    chat: chatId.toString(LOG_ID_RADIX),
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
  });
  try {
    do {
      console.debug('fetchMessages list', {
        chat: chatId.toString(LOG_ID_RADIX),
        cursor,
      });
      const list = await env.HISTORY.list({ prefix, cursor });
      cursor = list.cursor;
      console.debug('fetchMessages list done', {
        chat: chatId.toString(LOG_ID_RADIX),
        keys: list.keys.length,
        nextCursor: cursor,
      });
      const fetches = list.keys.map(async (key) => {
        const parts = key.name.split(':');
        const ts = parseInt(parts[2]);
        if (ts >= start && ts <= end) {
          console.debug('fetchMessages get', {
            chat: chatId.toString(LOG_ID_RADIX),
            ts,
          });
          return env.HISTORY.get<StoredMessage>(key.name, { type: 'json' });
        }
        return null;
      });
      const results = await Promise.all(fetches);
      for (const m of results) if (m) messages.push(m);
      console.debug('fetchMessages page processed', {
        chat: chatId.toString(LOG_ID_RADIX),
        collected: messages.length,
      });
    } while (cursor && messages.length < 10000);
    return messages.sort((a, b) => a.ts - b.ts);
  } catch (err: any) {
    console.error('fetchMessages failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
    });
    throw err;
  } finally {
    console.debug('fetchMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
      count: messages.length,
    });
  }
}

export async function fetchLastMessages(env: Env, chatId: number, count: number) {
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const messages: StoredMessage[] = [];
  console.debug('fetchLastMessages start', {
    chat: chatId.toString(LOG_ID_RADIX),
    count,
  });
  try {
    do {
      console.debug('fetchLastMessages list', {
        chat: chatId.toString(LOG_ID_RADIX),
        cursor,
      });
      const list = await env.HISTORY.list({ prefix, cursor });
      cursor = list.cursor;
      console.debug('fetchLastMessages list done', {
        chat: chatId.toString(LOG_ID_RADIX),
        keys: list.keys.length,
        nextCursor: cursor,
      });
      const results = await Promise.all(
        list.keys.map((key) =>
          env.HISTORY.get<StoredMessage>(key.name, { type: 'json' }),
        ),
      );
      for (const m of results) if (m) messages.push(m);
      console.debug('fetchLastMessages page processed', {
        chat: chatId.toString(LOG_ID_RADIX),
        collected: messages.length,
      });
    } while (cursor && messages.length < 10000);
    const sorted = messages.sort((a, b) => b.ts - a.ts).slice(0, count);
    return sorted;
  } catch (err: any) {
    console.error('fetchLastMessages failed', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
    });
    throw err;
  } finally {
    console.debug('fetchLastMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
      count: messages.length,
    });
  }
}
