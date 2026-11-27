import type { Env } from '../../core/env';
import { isForwardedMessage } from '../../api/update';
import { groupCollection, personalAlbum } from './album';
import { collectionCard, personalCard, sendCard } from './cards';
import { eraseAlbum, getEnrollment, getGroup, listAwards, resumeParticipant, setComebackReplies, setEnrolled, setGroupEnabled } from './repository';
import { COMEBACK, GROUP_BADGES, PERSONAL_BADGES } from './rules';
import { conversationProgress, groupProgress, personalProgress, type AchievementProgress } from './progress';
import { progressCopy, telegramProgress } from './progress-copy';
import { botUsername, button, callbackSetupHint, callTelegram, comebackAvailable, groupPicker, roleOf, socialAvailable, type View } from './settings';
import { CONVERSATION_BADGES, getConversationStatus, setConversationConsent, setConversationGroup } from './social';
import { DUTCH_RUDDER } from './social-score';
import { displayName, memberProfile, profileAccess, profileText } from './profile';

interface Actor { id?: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string }
interface Message {
  chat?: { id?: number; type?: string }; from?: Actor; message_id?: number;
  is_topic_message?: boolean; message_thread_id?: number;
  sender_chat?: unknown; text?: string; date?: number;
  reply_to_message?: { from?: Actor; message_id?: number; forum_topic_created?: unknown };
}
interface Callback { id?: string; from?: Actor; message?: Message; data?: string }
interface Request { action: string; group: number; extra?: string; target?: Actor }
const GROUP_ACTIONS = new Set(['group', 'group-card', 'on', 'off', 'group-social', 'group-unsocial', 'profile']);

function parseCallback(input: string): Request | null {
  const match = /^ach:([a-z-]+):(-\d{1,16})(?::([a-z\d-]{1,36}))?$/.exec(input);
  if (!match || input.length > 64) return null;
  const group = Number(match[2]);
  return Number.isSafeInteger(group) && group < 0 ? { action: match[1], group, extra: match[3] } : null;
}

function callbackFeedback(req: Request | null, chat: Message['chat']): { text?: string; show_alert?: boolean } {
  if (req && GROUP_ACTIONS.has(req.action) && chat?.id && chat.id !== req.group) {
    const text = chat.type === 'private' ? 'Отправьте /achievements в своей группе.'
      : 'Чтобы открыть коллекцию этой группы, отправьте здесь /achievements.';
    return { text, show_alert: true };
  }
  if (req?.action === 'group-card' || req?.action === 'preview') return { text: 'Открываю карточку…' };
  return {};
}

export async function achievementCommand(env: Env, message: Message): Promise<Request | null> {
  const match = /^\/(achievements|badges|start|profile)(?:@(\w+))?(?:\s+(\S+))?\s*$/i.exec(message.text || '');
  if (!match) return null;
  const privateChat = message.chat?.type === 'private';
  const name = match[1].toLowerCase();
  if (name === 'start' && (!privateChat || !/^ach_\d{1,16}$/.test(match[3] || ''))) return null;
  if (match[2] && match[2].toLowerCase() !== (await botUsername(env)).toLowerCase()) return null;
  if (name === 'start') {
    const group = -Number(match[3].slice(4));
    return Number.isSafeInteger(group) && group < 0 ? { action: 'album', group } : null;
  }
  if (privateChat) return { action: 'pick', group: 0 };
  if (name === 'profile') return { action: 'profile', group: message.chat!.id!, target: profileTarget(message) };
  return { action: 'group', group: message.chat!.id! };
}

/** A reply to someone's message opens their profile. A topic's implicit reply does not count. */
function profileTarget(message: Message): Actor | undefined {
  const parent = message.reply_to_message;
  if (!parent || parent.forum_topic_created !== undefined) return message.from;
  if (message.is_topic_message && parent.message_id === message.message_thread_id) return message.from;
  const user = parent.from;
  return user?.id && Number.isSafeInteger(user.id) && user.id > 0 && !user.is_bot ? user : undefined;
}

async function profileView(env: Env, group: number, viewer: number, target?: Actor): Promise<View> {
  if (!target?.id) return { text: 'Профиль есть только у участников группы. Ответьте командой /profile на сообщение человека.' };
  const access = await profileAccess(env, group, target.id, viewer);
  if (access === 'unverified') return { text: 'Telegram пока не подтвердил членство. Попробуйте позднее.' };
  if (access === 'none') return { text: 'Профиль виден, только пока человек состоит в группе.' };
  const profile = await memberProfile(env, group, target.id, viewer);
  const text = profileText(displayName(target), profile);
  if (target.id !== viewer) return { text };
  try {
    const url = 'https://t.me/' + await botUsername(env) + '?start=ach_' + Math.abs(group);
    return { text, buttons: [[{ text: 'Мой альбом', url }]] };
  } catch {
    return { text };
  }
}

async function groupAction(env: Env, request: Request, owner: number, fromCommand: boolean, threadId?: number): Promise<View | null> {
  const { group, action } = request;
  const role = await roleOf(env, group, owner);
  if (role === 'unverified') return { text: 'Telegram пока не подтвердил членство. Попробуйте позднее.' };
  if (role === 'none') return { text: 'Коллекция доступна участникам этой группы.' };
  if (action === 'group-card') return inspect(env, group, 0, request.extra, threadId);
  if (action === 'profile') return profileView(env, group, owner, request.target);
  if (action !== 'group' && role !== 'admin') return { text: 'Менять настройки может администратор группы.' };
  if (action === 'on' || action === 'off') {
    if (action === 'on' && (String(env.ENABLE_ACTIVITY_TRACKING) === 'false' || env.RAW_MESSAGE_STORAGE_MODE === 'unconfigured')) {
      return { text: 'Для достижений владелец бота должен включить сбор статистики.' };
    }
    await setGroupEnabled(env.DB, group, action === 'on');
  } else if (action === 'group-social' || action === 'group-unsocial') {
    if (!socialAvailable(env) || !(await getGroup(env.DB, group))?.enabled) {
      return { text: 'Полка «Разговор» сейчас недоступна.' };
    }
    await setConversationGroup(env.DB, group, action === 'group-social');
  }
  const [view, hint] = await Promise.all([groupCollection(env, group, owner, role === 'admin'),
    fromCommand && role === 'admin' ? callbackSetupHint(env) : '']);
  return { ...view, text: view.text + hint };
}

async function deleteAction(env: Env, req: Request, owner: number): Promise<View> {
  const album = await getEnrollment(env.DB, req.group, owner);
  if (!album) return { text: 'Этого личного альбома уже нет.' };
  if (req.action === 'delete') return {
    text: 'Удалить эту коллекцию? Бейджи и прогресс исчезнут. Можно будет начать заново.',
    buttons: [[button('Да, удалить мой альбом', 'erase', req.group, album.generation)]],
  };
  if (req.extra !== album.generation) return { text: 'Подтверждение устарело. Откройте /badges ещё раз.' };
  if (!await eraseAlbum(env.DB, req.group, owner, album.generation)) {
    return { text: 'Альбом успел измениться. Откройте /badges ещё раз.' };
  }
  return { text: 'Ваш альбом для этой группы удалён.' };
}

async function share(env: Env, group: number, owner: number, id?: string): Promise<View | null> {
  const badge = [...PERSONAL_BADGES, ...CONVERSATION_BADGES, DUTCH_RUDDER].find(entry => entry.id === id);
  const award = (await listAwards(env.DB, group, owner)).find(entry => entry.badge_id === id);
  if (!badge || !award) return { text: 'Сначала нужно открыть этот бейдж.' };
  let png: Uint8Array<ArrayBuffer>;
  try { png = await personalCard(badge.id, badge.title, award.earned_day, award.result); }
  catch {
    console.warn('Achievement card rendering failed');
    return { text: 'Не удалось подготовить фотографию. Альбом сохранён.' };
  }
  const delivery = await sendCard(env, owner, png, [badge.title, award.earned_day + ' UTC', award.result].join('\n'));
  return delivery.status === 'sent' ? null : { text: 'Доставку фотографии подтвердить не удалось. Альбом сохранён.' };
}

async function deliverInspection(env: Env, chatId: number, caption: string, png?: Uint8Array<ArrayBuffer>, threadId?: number) {
  const photo = png ? await sendCard(env, chatId, png, caption, undefined, threadId) : null;
  if (photo?.status === 'sent') return 'sent';
  // A lost sendPhoto response may follow a successful delivery. Never repeat its content in that case.
  const uncertain = photo?.status === 'unknown';
  try {
    await callTelegram(env, 'sendMessage', {
      chat_id: chatId, text: uncertain ? 'Не удалось подтвердить доставку фотографии.' : caption,
      ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
    });
  } catch {
    // Avoid replaying a possibly delivered photo or text by retrying the webhook.
    return uncertain ? 'unknown' : 'text_fallback_unconfirmed';
  }
  return uncertain ? 'unknown' : 'text_fallback';
}

async function inspect(env: Env, group: number, owner: number, id?: string, threadId?: number): Promise<View | null> {
  const groupCard = owner === 0;
  const [settings, enrollment, awards] = await Promise.all([
    getGroup(env.DB, group), groupCard ? null : getEnrollment(env.DB, group, owner), listAwards(env.DB, group, owner),
  ]);
  if (!groupCard && !enrollment && !settings?.enabled) return { text: 'В этой группе достижения выключены.' };
  const award = awards.find(a => a.badge_id === id);
  const choices = groupCard ? GROUP_BADGES : [...PERSONAL_BADGES, ...CONVERSATION_BADGES,
    ...(award?.badge_id === DUTCH_RUDDER.id ? [DUTCH_RUDDER] : [])];
  const badge = choices.find(b => b.id === id);
  if (!badge) return { text: 'Откройте коллекцию, чтобы выбрать бейдж.' };
  let progress: AchievementProgress | undefined;
  if (!award) {
    if (groupCard) progress = (await groupProgress(env, group, settings))[badge.id];
    else if (CONVERSATION_BADGES.some(b => b.id === id)) {
      if (!socialAvailable(env)) return { text: 'Полка «Разговор» сейчас недоступна.' };
      const state = await getConversationStatus(env.DB, group, owner);
      if (state.groupSince === null) return { text: 'Полка «Разговор» в этой группе выключена.' };
      if (settings?.enabled && enrollment?.enabled && state.memberSince !== null) {
        progress = (await conversationProgress(env, group, owner))[badge.id];
      }
    } else progress = (await personalProgress(env, group, owner, settings, enrollment))[badge.id];
  }
  const caption = [badge.title, badge.description, award ? 'Открыто · ' + award.earned_day + ' UTC · ' + award.result
    : 'Пока закрыто', ...telegramProgress(progress)].join('\n');
  const counter = progress?.conditions.length === 1 ? progressCopy(progress).rows[0].counter : undefined;
  let png: Uint8Array<ArrayBuffer> | undefined;
  try {
    png = await collectionCard(badge.id, badge.title, badge.description, groupCard, award, counter);
  } catch {
    console.warn('Achievement card rendering failed');
  }
  const status = await deliverInspection(env, groupCard ? group : owner, caption, png, threadId);
  console.info({ event: 'achievement_card_delivery', status });
  return null;
}

async function privateAction(env: Env, req: Request, owner: number): Promise<View | null> {
  const { action, group, extra } = req;
  if (action === 'pick') return groupPicker(env, owner, group);
  if (action === 'delete' || action === 'erase') return deleteAction(env, req, owner);
  const role = await roleOf(env, group, owner);
  if (role !== 'admin' && role !== 'member') return { text: 'Не удалось подтвердить членство в этой группе.' };
  if (action === 'share') return share(env, group, owner, extra);
  if (action === 'preview') return inspect(env, group, owner, extra);
  if (action === 'join') await resumeParticipant(env.DB, group, owner);
  else if (action === 'pause') await setEnrolled(env.DB, group, owner, false);
  else if (action === 'comeback-on' || action === 'comeback-off') {
    if (action === 'comeback-off' || comebackAvailable(env)) {
      await setComebackReplies(env.DB, group, owner, action === 'comeback-on');
    }
  } else if (['consent', 'join-social', 'leave-social'].includes(action)) {
    const enrollment = await getEnrollment(env.DB, group, owner);
    if (!socialAvailable(env) || !enrollment?.enabled) return { text: 'Учёт диалогов сейчас недоступен.' };
    const status = await getConversationStatus(env.DB, group, owner);
    if (status.groupSince === null) return { text: 'Администратор выключил полку «Разговор».' };
    if (action === 'consent') return {
      text: 'Полка «Разговор» добавит четыре бейджа за прямые ответы. '
        + 'Бот до 28 дней хранит связь между репликами участников, которые тоже дали согласие. '
        + 'Сохраняются идентификаторы сообщений, авторов и время. Текст для этого не нужен. Учёт можно выключить.',
      buttons: [[button('Согласен, считать мои ответы', 'join-social', group)]],
    };
    await setConversationConsent(env.DB, group, owner, action === 'join-social');
  } else if (action !== 'album') return { text: 'Эта кнопка устарела. Откройте /badges.' };
  const page = action === 'album' && extra && /^\d$/.test(extra) ? Number(extra) : 0;
  return personalAlbum(env, group, owner, page);
}

/** Handle achievement commands and album callbacks from an authenticated Telegram webhook. */
export async function handleAchievementUpdate(env: Env, update: unknown): Promise<boolean> {
  if (!update || typeof update !== 'object') return false;
  const incoming = update as { callback_query?: Callback; message?: Message };
  const cb = incoming.callback_query;
  if (cb && (typeof cb.data !== 'string' || !cb.data.startsWith('ach:'))) return false;
  const msg = cb ? cb.message : incoming.message;
  if (!cb && (typeof msg?.text !== 'string' || !/^\/(achievements|badges|start|profile)\b/i.test(msg.text))) return false;
  if (!cb && isForwardedMessage(msg)) return false;
  const req = cb ? parseCallback(cb.data!) : await achievementCommand(env, msg!);
  if (!cb && !req) return false;
  const chat = msg?.chat;
  if (cb?.id) {
    try {
      await callTelegram(env, 'answerCallbackQuery', {
        callback_query_id: cb.id, ...callbackFeedback(req, chat),
      });
    } catch { console.warn('Achievement callback acknowledgment unavailable'); }
  }
  const caller = cb ? cb.from : msg?.from;
  if (!req || !chat?.id || !Number.isSafeInteger(chat.id) || !caller?.id || !Number.isSafeInteger(caller.id)
    || caller.id <= 0 || caller.is_bot || (!cb && msg?.sender_chat)) return true;
  let view: View | null;
  let threadId: number | undefined;
  if (GROUP_ACTIONS.has(req.action)) {
    if (chat.id !== req.group || chat.id >= 0 || !['group','supergroup'].includes(chat.type || '')) return true;
    if (msg?.is_topic_message === true && typeof msg.message_thread_id === 'number'
      && Number.isSafeInteger(msg.message_thread_id) && msg.message_thread_id > 0) threadId = msg.message_thread_id;
    view = await groupAction(env, req, caller.id, !cb, threadId);
  } else {
    if (chat.type !== 'private' || chat.id !== caller.id) return true;
    view = await privateAction(env, req, caller.id);
  }
  if (!view) return true;
  // A shared group message is visible to everyone. Send role-specific menus separately
  // and never edit the caption of the forwarded weekly photo.
  const edit = cb?.message?.message_id && cb.message.text && chat.type === 'private'
    && req.action !== 'preview' && req.action !== 'share';
  const method = edit ? 'editMessageText' : 'sendMessage';
  await callTelegram(env, method, {
    chat_id: chat.id, text: view.text,
    ...(threadId !== undefined ? { message_thread_id: threadId } : {}),
    ...(edit ? { message_id: msg!.message_id } : {}),
    reply_markup: { inline_keyboard: view.buttons || [] },
  });
  return true;
}
