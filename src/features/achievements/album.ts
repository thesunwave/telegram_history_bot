import type { Env } from '../../core/env';
import { shiftDay } from './calendar';
import { getEnrollment, getGroup, listAwards } from './repository';
import { GROUP_BADGES, PERSONAL_BADGES, type BadgeProgress } from './rules';
import { button, botUsername, groupTitle, socialAvailable, type Buttons, type View } from './settings';
import { CONVERSATION_BADGES, getConversationProgress, getConversationStatus } from './social';

export async function groupCollection(env: Env, chat: number, user: number, admin: boolean): Promise<View> {
  const group = await getGroup(env.DB, chat);
  const earned = await listAwards(env.DB, chat);
  const lines = ['Коллекция чата · ' + earned.length + ' из ' + GROUP_BADGES.length];
  for (const badge of GROUP_BADGES) {
    const win = earned.find(entry => entry.badge_id === badge.id);
    lines.push(win ? '🏅 ' + badge.title + ' · ' + shiftDay(win.earned_day, -6) + ' — ' + win.earned_day + ' UTC\n' + win.result
      : '◇ ' + badge.title + '\n' + badge.description);
  }
  if (group?.enabled) {
    lines.push('Неделя по UTC, первый выпуск за ' + group.start_day + ' — ' + shiftDay(group.start_day, 6)
      + '. Карточка приходит после закрытия недели и проверки статистики.');
  } else {
    lines.push('Недельные карточки выключены. Включить их может администратор группы.');
  }
  const username = await botUsername(env);
  const buttons: Buttons = [[{ text: 'Мои бейджи', url: 'https://t.me/' + username + '?start=ach_' + Math.abs(chat) }]];
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
      text: 'Личный альбом · ' + title + '\n\nДесять бейджей за привычки, голосовые, кружочки и находки. '
        + 'Учитываются только новые полные дни по UTC, начиная с ближайшей полуночи. '
        + 'Прогресс видите вы. Отдельной карточкой можно поделиться самостоятельно.',
      buttons: [[button('Начать коллекцию', 'join', chat)]],
    };
  }
  const progress: BadgeProgress[] = enrollment.enabled ? JSON.parse(enrollment.progress_json) : [];
  const [awards, social] = await Promise.all([
    listAwards(env.DB, chat, owner),
    socialAvailable(env) ? getConversationStatus(env.DB, chat, owner) : { groupSince: null, memberSince: null },
  ]);
  // Retain earned social badges when the group later turns off reply observation.
  const extra = CONVERSATION_BADGES.filter(b => social.groupSince !== null || awards.some(a => a.badge_id === b.id));
  const badges = [...PERSONAL_BADGES, ...extra];
  const socialProgress = social.memberSince !== null ? await getConversationProgress(env.DB, chat, owner) : [];
  const size = 5;
  page = Math.min(page, Math.floor((badges.length - 1) / size));
  const lines = ['Мой альбом · ' + title, 'Открыто ' + awards.length + ' из ' + badges.length];
  const buttons: Buttons = [];
  if (!enrollment.enabled) lines.push('Сбор на паузе. Открытые бейджи сохранены.');
  else lines.push('Учёт с ' + enrollment.start_day + ' UTC. Прогресс обновляется после закрытия дня.');
  if (social.memberSince !== null) lines.push('Ответы учитываются с '
    + new Date(social.memberSince * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC.');
  if (enrollment.enabled && !enrollment.last_day) lines.push('Ждём первый проверенный день для расчёта прогресса.');
  const progressById = new Map([...progress, ...socialProgress].map(row => [row.id, row]));
  for (const badge of badges.slice(page * size, (page + 1) * size)) {
    const win = awards.find(entry => entry.badge_id === badge.id);
    if (win) {
      lines.push('🏅 ' + badge.title + ' · ' + win.earned_day + '\n' + win.result);
      buttons.push([button('Поделиться · ' + badge.title, 'share', chat, badge.id)]);
    } else {
      const score = progressById.get(badge.id);
      const indicator = score ? ' · ' + Math.min(score.current, score.target) + ' из ' + score.target : '';
      lines.push('◇ ' + badge.title + indicator + '\n' + badge.description + (score ? '\n' + score.result : ''));
      buttons.push([button('◇ ' + badge.title, 'preview', chat, badge.id)]);
    }
  }
  const pages = [];
  if (page > 0) pages.push(button('← Назад', 'album', chat, String(page - 1)));
  if ((page + 1) * size < badges.length) pages.push(button('Дальше →', 'album', chat, String(page + 1)));
  if (pages.length) buttons.push(pages);
  if (enrollment.enabled && social.groupSince !== null) {
    buttons.push([button(social.memberSince === null ? 'Как работает полка «Разговор»' : 'Прекратить учёт ответов',
      social.memberSince === null ? 'consent' : 'leave-social', chat)]);
  }
  if (group?.enabled) buttons.push([button(enrollment.enabled ? 'Поставить на паузу' : 'Возобновить',
    enrollment.enabled ? 'pause' : 'join', chat)]);
  buttons.push([button('Удалить мой альбом', 'delete', chat)]);
  return { text: lines.join('\n\n'), buttons };
}
