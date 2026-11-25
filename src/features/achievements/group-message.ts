const contentFields = ['text', 'photo', 'video', 'voice', 'video_note', 'audio', 'document',
  'sticker', 'animation', 'poll', 'contact', 'location', 'venue', 'dice', 'game', 'paid_media'];

export function messageRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Identify original content posted by an identifiable human in a group. */
export function identifyGroupMessage(value: unknown) {
  const msg = messageRecord(value);
  const chat = messageRecord(msg.chat);
  const sender = messageRecord(msg.from);
  if ((chat.type !== 'group' && chat.type !== 'supergroup') ||
    typeof chat.id !== 'number' || !Number.isSafeInteger(chat.id) || !chat.id ||
    !positive(msg.message_id) || !positive(msg.date) ||
    !positive(sender.id) || sender.is_bot !== false || msg.sender_chat ||
    msg.forward_origin || msg.forward_date || msg.forward_from || msg.forward_from_chat ||
    msg.forward_sender_name || msg.is_automatic_forward || !contentFields.some(k => msg[k] != null)) return null;
  const thread = msg.is_topic_message === true && positive(msg.message_thread_id) ? msg.message_thread_id : undefined;
  return { chat: chat.id, user: sender.id, id: msg.message_id, date: msg.date, thread };
}
