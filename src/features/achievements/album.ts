import type { Env } from '../../core/env';
import { mondayOf, shiftDay } from './calendar';
import { getEnrollment, getGroup, listAwards } from './repository';
import { COMEBACK, GROUP_BADGES, PERSONAL_BADGES } from './rules';
import { conversationProgress, groupProgress, personalProgress, type CollectionProgress } from './progress';
import { telegramProgress } from './progress-copy';
import { button, botUsername, comebackAvailable, groupTitle, socialAvailable, type Buttons, type View } from './settings';
import { getConversationStatus } from './social';
import { visibleConversationBadges } from './social-score';

export async function groupCollection(env: Env, chat: number, user: number, admin: boolean): Promise<View> {
  const [group, earned] = await Promise.all([getGroup(env.DB, chat), listAwards(env.DB, chat)]);
  const now = new Date();
  const progress = await groupProgress(env, chat, group, now);
  const lines = ['Коллекция чата · ' + earned.length + ' из ' + GROUP_BADGES.length];
  for (const badge of GROUP_BADGES) {
    const win = earned.find(entry => entry.badge_id === badge.id);
    lines.push(win ? '🏅 ' + badge.title + ' · ' + shiftDay(win.earned_day, -6) + ' — ' + win.earned_day + ' UTC\n' + win.result
      : ['◇ ' + badge.title, badge.description, ...telegramProgress(progress[badge.id])].join('\n'));
  }
  if (group?.enabled) {
    const monday = mondayOf(now.toISOString().slice(0, 10));
    const start = [monday, group.start_day].sort()[1];
    lines.push((monday < group.start_day ? 'Первая неделя · ' : 'Текущая неделя · ') + start + ' — ' + shiftDay(start, 6)
      + ' UTC. Карточка приходит после закрытия недели и проверки статистики.');
  } else {
    lines.push('Недельные карточки выключены. Включить их может администратор группы.');
  }
  const username = await botUsername(env);
  const buttons: Buttons = [[{ text: 'Мои бейджи', url: 'https://t.me/' + username + '?start=ach_' + Math.abs(chat) }]];
  if (group?.enabled) buttons.push([button('Обновить', 'group', chat)]);
  for (let i = 0; i < GROUP_BADGES.length; i += 2) {
    buttons.push(GROUP_BADGES.slice(i, i + 2).map(badge => button(badge.title, 'group-card', chat, badge.id)));
  }
  if (admin) {
    buttons.push([button(group?.enabled ? 'Выключить достижения' : 'Включить достижения',
      group?.enabled ? 'off' : 'on', chat)]);
    if (group?.enabled && socialAvailable(env)) {
      const settings = await getConversationStatus(env.DB, chat, user);
      buttons.push([button(settings.groupSince === null ? 'Включить полку «Разговор»' : 'Выключить полку «Разговор»',
        settings.groupSince === null ? 'group-social' : 'group-unsocial', chat)]);
    }
  }
  return { text: lines.join('\n\n'), buttons };
}

export async function personalAlbum(env: Env, chat: number, owner: number, page = 0): Promise<View> {
  const [group, enrollment, title] = await Promise.all([
    getGroup(env.DB, chat), getEnrollment(env.DB, chat, owner), groupTitle(env, chat),
  ]);
  if (!enrollment) {
    if (!group?.enabled) return { text: 'В этой группе достижения выключены.' };
    return {
      text: 'Личный альбом · ' + title + '\n\nБейджи за привычки, голосовые, кружочки, находки и возвращение в чат. '
        + 'Учёт начнётся с ближайшей полуночи по UTC. Прогресс за день предварительный. '
        + 'Прогресс видите вы. Отдельной карточкой можно поделиться самостоятельно.',
      buttons: [[button('Начать коллекцию', 'join', chat)]],
    };
  }
  const [awards, social] = await Promise.all([
    listAwards(env.DB, chat, owner),
    socialAvailable(env) ? getConversationStatus(env.DB, chat, owner) : { groupSince: null, memberSince: null },
  ]);
  // Retain earned social badges when the group later turns off reply observation.
  const active = group?.enabled && enrollment.enabled;
  const extra = visibleConversationBadges(Boolean(group?.enabled && social.groupSince !== null), awards);
  const badges = [...PERSONAL_BADGES, ...extra];
  const [progress, replies] = await Promise.all([
    personalProgress(env, chat, owner, group, enrollment),
    active && social.groupSince !== null && social.memberSince !== null ? conversationProgress(env, chat, owner) : {},
  ]);
  const size = 5;
  page = Math.min(page, Math.floor((badges.length - 1) / size));
  const lines = ['Мой альбом · ' + title, 'Открыто ' + awards.length + ' из ' + badges.length];
  const buttons: Buttons = [];
  if (!active) lines.push('Сбор на паузе. Открытые бейджи сохранены.');
  else lines.push('Учёт с ' + enrollment.start_day + ' UTC. Дневные бейджи выдаются после проверки статистики.');
  if (active && social.memberSince !== null) lines.push('Ответы учитываются с '
    + new Date(social.memberSince * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC.');
  const progressById: CollectionProgress = { ...progress, ...replies };
  for (const badge of badges.slice(page * size, (page + 1) * size)) {
    const win = awards.find(entry => entry.badge_id === badge.id);
    if (win) {
      lines.push('🏅 ' + badge.title + ' · ' + win.earned_day + '\n' + win.result);
      buttons.push([button('Поделиться · ' + badge.title, 'share', chat, badge.id)]);
    } else {
      lines.push(['◇ ' + badge.title, badge.description, ...telegramProgress(progressById[badge.id])].join('\n'));
      buttons.push([button('◇ ' + badge.title, 'preview', chat, badge.id)]);
    }
  }
  const pages = [];
  if (page > 0) pages.push(button('← Назад', 'album', chat, String(page - 1)));
  if ((page + 1) * size < badges.length) pages.push(button('Дальше →', 'album', chat, String(page + 1)));
  if (pages.length) buttons.push(pages);
  if (active) buttons.push([button('Обновить', 'album', chat, String(page))]);
  if (active && (enrollment.comeback_replies_since !== null ||
    (comebackAvailable(env) && !awards.some(award => award.badge_id === COMEBACK.id)))) {
    buttons.push([enrollment.comeback_replies_since === null
      ? button('Анонс «' + COMEBACK.title + '»', 'comeback-consent', chat)
      : button('Выключить анонс возвращения', 'comeback-off', chat)]);
  }
  if (active && social.groupSince !== null) {
    buttons.push([button(social.memberSince === null ? 'Как работает полка «Разговор»' : 'Прекратить учёт ответов',
      social.memberSince === null ? 'consent' : 'leave-social', chat)]);
  }
  if (group?.enabled) buttons.push([button(enrollment.enabled ? 'Поставить на паузу' : 'Возобновить',
    enrollment.enabled ? 'pause' : 'join', chat)]);
  buttons.push([button('Удалить мой альбом', 'delete', chat)]);
  return { text: lines.join('\n\n'), buttons };
}
