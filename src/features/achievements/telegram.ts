import type { Env } from '../../core/env';
import { isForwardedMessage } from '../../api/update';
import { groupCollection, personalAlbum } from './album';
import { collectionCard, personalCard, sendCard } from './cards';
import { eraseAlbum, getEnrollment, getGroup, getProgress, listAwards, setEnrolled, setGroupEnabled } from './repository';
import { GROUP_BADGES, PERSONAL_BADGES, type BadgeProgress } from './rules';
import { botUsername, button, callbackSetupHint, callTelegram, groupPicker, roleOf, socialAvailable, type View } from './settings';
import { CONVERSATION_BADGES, getConversationProgress, getConversationStatus, setConversationConsent, setConversationGroup } from './social';

interface Actor { id?: number; is_bot?: boolean }
interface Message {
  chat?: { id?: number; type?: string }; from?: Actor; message_id?: number;
  sender_chat?: unknown; text?: string; date?: number;
}
interface Callback { id?: string; from?: Actor; message?: Message; data?: string }
interface Request { action: string; group: number; extra?: string }
const GROUP_ACTIONS = new Set(['group', 'group-card', 'on', 'off', 'group-social', 'group-unsocial']);

function parseCallback(input: string): Request | null {
  const match = /^ach:([a-z-]+):(-\d{1,16})(?::([a-z\d-]{1,36}))?$/.exec(input);
  if (!match || input.length > 64) return null;
  const group = Number(match[2]);
  return Number.isSafeInteger(group) && group < 0 ? { action: match[1], group, extra: match[3] } : null;
}

export async function achievementCommand(env: Env, message: Message): Promise<Request | null> {
  const match = /^\/(achievements|badges|start)(?:@(\w+))?(?:\s+(\S+))?\s*$/i.exec(message.text || '');
  if (!match) return null;
  const privateChat = message.chat?.type === 'private';
  const name = match[1].toLowerCase();
  if (name === 'start' && (!privateChat || !/^ach_\d{1,16}$/.test(match[3] || ''))) return null;
  if (match[2] && match[2].toLowerCase() !== (await botUsername(env)).toLowerCase()) return null;
  if (name === 'start') {
    const group = -Number(match[3].slice(4));
    return Number.isSafeInteger(group) && group < 0 ? { action: 'album', group } : null;
  }
  return privateChat ? { action: 'pick', group: 0 } : { action: 'group', group: message.chat!.id! };
}

async function groupAction(env: Env, request: Request, owner: number, fromCommand: boolean): Promise<View | null> {
  const { group, action } = request;
  const role = await roleOf(env, group, owner);
  if (role === 'unverified') return { text: 'Telegram пока не подтвердил членство. Попробуйте позднее.' };
  if (role === 'none') return { text: 'Коллекция доступна участникам этой группы.' };
  if (action === 'group-card') return inspect(env, group, 0, request.extra);
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
  const badge = [...PERSONAL_BADGES, ...CONVERSATION_BADGES].find(entry => entry.id === id);
  const award = (await listAwards(env.DB, group, owner)).find(entry => entry.badge_id === id);
  if (!badge || !award) return { text: 'Сначала нужно открыть этот бейдж.' };
  const png = await personalCard(badge.id, badge.title, award.earned_day, award.result);
  const delivery = await sendCard(env, owner, png, [badge.title, award.earned_day + ' UTC', award.result].join('\n'));
  return delivery.status === 'sent' ? null : { text: 'Доставку фотографии подтвердить не удалось. Альбом сохранён.' };
}

async function inspect(env: Env, group: number, owner: number, id?: string): Promise<View | null> {
  const groupCard = owner === 0;
  if (!groupCard && !await getEnrollment(env.DB, group, owner)) return { text: 'Сначала откройте /badges.' };
  const choices = groupCard ? GROUP_BADGES : [...PERSONAL_BADGES, ...CONVERSATION_BADGES];
  const badge = choices.find(b => b.id === id);
  if (!badge) return { text: 'Откройте коллекцию, чтобы выбрать бейдж.' };
  const award = (await listAwards(env.DB, group, owner)).find(a => a.badge_id === id);
  let progress: BadgeProgress | undefined;
  if (!groupCard && !award) {
    if (CONVERSATION_BADGES.some(b => b.id === id)) {
      if (!socialAvailable(env)) return { text: 'Полка «Разговор» сейчас недоступна.' };
      const state = await getConversationStatus(env.DB, group, owner);
      if (state.groupSince === null) return { text: 'Полка «Разговор» в этой группе выключена.' };
      if (state.memberSince !== null) progress = (await getConversationProgress(env.DB, group, owner)).find(p => p.id === id);
    } else progress = (await getProgress(env.DB, group, owner)).find(p => p.id === id);
  }
  const png = await collectionCard(badge.id, badge.title, badge.description, groupCard, award, progress);
  const caption = [badge.title, badge.description, award ? award.earned_day + ' UTC · ' + award.result
    : progress ? 'Пока закрыто · ' + progress.result : 'Пока закрыто'].join('\n');
  const outcome = await sendCard(env, groupCard ? group : owner, png, caption);
  return outcome.status === 'sent' ? null : { text: 'Не удалось подтвердить доставку карточки.' };
}

async function privateAction(env: Env, req: Request, owner: number): Promise<View | null> {
  const { action, group, extra } = req;
  if (action === 'pick') return groupPicker(env, owner, group);
  if (action === 'delete' || action === 'erase') return deleteAction(env, req, owner);
  const role = await roleOf(env, group, owner);
  if (role !== 'admin' && role !== 'member') return { text: 'Не удалось подтвердить членство в этой группе.' };
  if (action === 'share') return share(env, group, owner, extra);
  if (action === 'preview') return inspect(env, group, owner, extra);
  if (action === 'join' || action === 'pause') await setEnrolled(env.DB, group, owner, action === 'join');
  else if (['consent', 'join-social', 'leave-social'].includes(action)) {
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
  if (!cb && (typeof msg?.text !== 'string' || !/^\/(achievements|badges|start)\b/i.test(msg.text))) return false;
  if (!cb && isForwardedMessage(msg)) return false;
  const req = cb ? parseCallback(cb.data!) : await achievementCommand(env, msg!);
  if (!cb && !req) return false;
  if (cb?.id) {
    try { await callTelegram(env, 'answerCallbackQuery', { callback_query_id: cb.id }); }
    catch { console.warn('Achievement callback acknowledgment unavailable'); }
  }
  const caller = cb ? cb.from : msg?.from;
  const chat = msg?.chat;
  if (!req || !chat?.id || !Number.isSafeInteger(chat.id) || !caller?.id || !Number.isSafeInteger(caller.id)
    || caller.id <= 0 || caller.is_bot || (!cb && msg?.sender_chat)) return true;
  let view: View | null;
  if (GROUP_ACTIONS.has(req.action)) {
    if (chat.id !== req.group || chat.id >= 0 || !['group','supergroup'].includes(chat.type || '')) return true;
    view = await groupAction(env, req, caller.id, !cb);
  } else {
    if (chat.type !== 'private' || chat.id !== caller.id) return true;
    view = await privateAction(env, req, caller.id);
  }
  if (!view) return true;
  // A shared group message is visible to everyone. Send role-specific menus separately
  // and never edit the caption of the forwarded weekly photo.
  const edit = cb?.message?.message_id && cb.message.text && chat.type === 'private';
  const method = edit ? 'editMessageText' : 'sendMessage';
  await callTelegram(env, method, {
    chat_id: chat.id, text: view.text,
    ...(edit ? { message_id: msg!.message_id } : {}),
    reply_markup: { inline_keyboard: view.buttons || [] },
  });
  return true;
}
