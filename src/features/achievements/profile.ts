import type { Env } from '../../core/env';
import { getEnrollment, getGroup, listAwards, type Award } from './repository';
import { PERSONAL_BADGES, type Badge } from './rules';
import { socialAvailable } from './settings';
import { getConversationStatus } from './social';
import { DUTCH_RUDDER, visibleConversationBadges } from './social-score';

export type ProfileState = 'active' | 'paused' | 'waiting' | 'disabled';
export interface ProfileBadge { badge: Badge; award: Award; conversation: boolean }
export interface MemberProfile { state: ProfileState; total: number; earned: ProfileBadge[] }

/**
 * Collect the badges a member has earned in a group, for any member of that group.
 * Progress stays private to the album owner. The secret badge is shown only to its owner.
 */
export async function memberProfile(env: Env, chat: number, member: number, viewer: number): Promise<MemberProfile> {
  const [group, enrollment, awards, social] = await Promise.all([
    getGroup(env.DB, chat), getEnrollment(env.DB, chat, member), listAwards(env.DB, chat, member),
    socialAvailable(env) ? getConversationStatus(env.DB, chat, member) : { groupSince: null, memberSince: null },
  ]);
  const own = viewer === member;
  const conversation = visibleConversationBadges(Boolean(group?.enabled && social.groupSince !== null), awards)
    .filter(badge => own || badge.id !== DUTCH_RUDDER.id);
  const catalog = [...PERSONAL_BADGES.map(badge => ({ badge, conversation: false })),
    ...conversation.map(badge => ({ badge, conversation: true }))];
  const earned = enrollment ? catalog.flatMap(({ badge, conversation }) => {
    const award = awards.find(entry => entry.badge_id === badge.id);
    return award ? [{ badge, award, conversation }] : [];
  }).sort((a, b) => b.award.earned_day.localeCompare(a.award.earned_day)) : [];
  const state: ProfileState = !group?.enabled ? 'disabled' : !enrollment ? 'waiting'
    : enrollment.enabled ? 'active' : 'paused';
  return { state, total: catalog.length, earned };
}

const STATE_NOTE: Record<ProfileState, string> = {
  active: '',
  waiting: 'Участие автоматическое: бейджи начнут считаться после первого сообщения в группе.',
  paused: 'Альбом на паузе. Открытые бейджи сохранены.',
  disabled: 'Достижения в этой группе сейчас выключены. Открытые бейджи сохранены.',
};

/** Plain-text profile for a group chat. Telegram renders it without parse mode. */
export function profileText(name: string, profile: MemberProfile): string {
  const lines = ['Профиль · ' + name, 'Бейджи: ' + profile.earned.length + ' из ' + profile.total];
  if (STATE_NOTE[profile.state]) lines.push(STATE_NOTE[profile.state]);
  if (!profile.earned.length && profile.state === 'active') lines.push('Пока ни одного бейджа. Всё впереди.');
  for (const { badge, award } of profile.earned) {
    lines.push('🏅 ' + badge.title + ' · ' + award.earned_day + '\n' + award.result);
  }
  return lines.join('\n\n');
}

/** Name a Telegram user from the update itself, without stored profile data. */
export function displayName(user: { first_name?: unknown; last_name?: unknown; username?: unknown }): string {
  const parts = [user.first_name, user.last_name].filter((part): part is string => typeof part === 'string' && !!part.trim());
  const name = parts.join(' ').trim() || (typeof user.username === 'string' && user.username ? '@' + user.username : '');
  return (name || 'Участник').slice(0, 64);
}
