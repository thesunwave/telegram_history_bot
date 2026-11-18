import type { D1Database } from '@cloudflare/workers-types';
import type { AdminDateRange } from '../../api/admin-stats';

const MAX_FOUR_DIGIT_YEAR_TIMESTAMP = 253402300799;

interface ForwardChat {
  id?: number;
  type?: string;
  title?: string;
  username?: string;
}

export interface ForwardMessage {
  chat?: ForwardChat;
  from?: { id?: number; username?: string; is_bot?: boolean };
  message_id?: number;
  date?: number;
  sender_chat?: unknown;
  is_automatic_forward?: boolean;
  forward_origin?: { type: string; chat?: ForwardChat; sender_chat?: ForwardChat };
  forward_from_chat?: ForwardChat;
  forward_from?: unknown;
  forward_sender_name?: string;
}

function readForwardSource(message: ForwardMessage) {
  const origin = message.forward_origin;
  const channel = origin?.type === 'channel'
    ? origin.chat
    : origin?.type === 'chat' && origin.sender_chat?.type === 'channel'
      ? origin.sender_chat
      : !origin && message.forward_from_chat?.type === 'channel'
        ? message.forward_from_chat
        : undefined;
  if (channel && typeof channel.id === 'number' && Number.isSafeInteger(channel.id)) {
    return {
      type: 'channel',
      id: channel.id,
      title: typeof channel.title === 'string' ? channel.title : null,
      username: typeof channel.username === 'string' ? channel.username : null,
    };
  }
  const person = origin
    ? origin.type === 'user' || origin.type === 'hidden_user'
    : !message.forward_from_chat && Boolean(message.forward_from || message.forward_sender_name);
  return { type: person ? 'person' : 'other', id: null, title: null, username: null };
}

/** Stores a manual group forward, keyed by the destination message for retry deduplication. */
export async function insertForward(db: D1Database, message: ForwardMessage): Promise<void> {
  const { chat, from, message_id: messageId, date } = message;
  if ((chat?.type !== 'group' && chat?.type !== 'supergroup') ||
      typeof chat.id !== 'number' || !Number.isSafeInteger(chat.id) ||
      typeof from?.id !== 'number' || !Number.isSafeInteger(from.id) || from.id <= 0 ||
      from.is_bot || message.sender_chat || message.is_automatic_forward ||
      typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId <= 0 ||
      typeof date !== 'number' || !Number.isSafeInteger(date) || date < 0 ||
      date > MAX_FOUR_DIGIT_YEAR_TIMESTAMP) return;

  const source = readForwardSource(message);
  await db.prepare(`
    INSERT INTO stats_forwards
      (chat_id, message_id, day, user_id, username, source_type, channel_id, channel_title, channel_username)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (chat_id, message_id) DO NOTHING
  `).bind(
    chat.id, messageId, new Date(date * 1000).toISOString().slice(0, 10), from.id,
    typeof from.username === 'string' && from.username ? from.username : `id${from.id}`,
    source.type, source.id, source.title, source.username,
  ).run();
}

interface ForwardStatsRow {
  user_id: number;
  username: string;
  source_type: 'channel' | 'person' | 'other';
  channel_id: number | null;
  channel_title: string | null;
  channel_username: string | null;
  count: number;
}

/** Returns counts by forwarding user and source within the requested chat and UTC dates. */
export async function getForwardStats(
  db: D1Database, chatId: number, range: AdminDateRange,
): Promise<ForwardStatsRow[]> {
  // SQLite takes the labels from the row with the sole MAX value, unique within a chat.
  const { results } = await db.prepare(`
    SELECT user_id, username, source_type, channel_id, channel_title, channel_username, count
    FROM (
      SELECT user_id, username, source_type, channel_id, channel_title, channel_username,
             COUNT(*) AS count, MAX(message_id) AS latest_message_id
      FROM stats_forwards
      WHERE chat_id = ? AND day BETWEEN ? AND ?
      GROUP BY user_id, source_type, channel_id
    )
    ORDER BY latest_message_id DESC
  `).bind(chatId, range.from, range.to).all<ForwardStatsRow>();
  return results;
}
