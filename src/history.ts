import { Env, StoredMessage } from './env';

export async function fetchMessages(
  env: Env,
  chatId: number,
  start: number,
  end: number,
) {
  const prefix = `msg:${chatId}:`;
  let cursor: string | undefined = undefined;
  const messages: StoredMessage[] = [];
  do {
    const list = await env.HISTORY.list({ prefix, cursor });
    cursor = list.cursor;
    for (const key of list.keys) {
      const parts = key.name.split(':');
      const ts = parseInt(parts[2]);
      if (ts >= start && ts <= end) {
        const m = await env.HISTORY.get<StoredMessage>(key.name, {
          type: 'json',
        });
        if (m) messages.push(m);
      }
    }
  } while (cursor && messages.length < 10000);
  return messages.sort((a, b) => a.ts - b.ts);
}
