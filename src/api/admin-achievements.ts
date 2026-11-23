import type { Env } from '../core/env';
import { getEnrollment, getGroup, listAwards, type Award } from '../features/achievements/repository';
import { GROUP_BADGES, PERSONAL_BADGES, type Badge, type BadgeProgress } from '../features/achievements/rules';
import { configuredBotUsername, socialAvailable } from '../features/achievements/settings';
import { CONVERSATION_BADGES, getConversationProgress, getConversationStatus } from '../features/achievements/social';
import { localizeAchievementBadge, type AdminLanguage } from './admin-i18n';

export interface AdminAchievementBadge extends Badge {
  earnedDay: string | null;
  result: string | null;
  current: number | null;
  target: number | null;
}

function badgeList(
  language: AdminLanguage, catalog: Badge[], awards: Award[], progress: BadgeProgress[] = [],
): AdminAchievementBadge[] {
  return catalog.map(({ id, title, description }) => {
    const win = awards.find(award => award.badge_id === id);
    const score = progress.find(row => row.id === id);
    return localizeAchievementBadge(language, {
      id, title, description, earnedDay: win?.earned_day ?? null, result: win?.result ?? null,
      current: score?.current ?? null, target: score?.target ?? null,
    });
  });
}

/** Read the selected group's collection and only the authenticated member's own album. */
export async function getAdminAchievements(env: Env, chat: number, viewer: number, language: AdminLanguage) {
  const [settings, groupAwards, enrollment, social] = await Promise.all([
    getGroup(env.DB, chat), listAwards(env.DB, chat), getEnrollment(env.DB, chat, viewer),
    socialAvailable(env) ? getConversationStatus(env.DB, chat, viewer) : { groupSince: null, memberSince: null },
  ]);
  const group = { enabled: Boolean(settings?.enabled), badges: badgeList(language, GROUP_BADGES, groupAwards) };
  const active = group.enabled && Boolean(enrollment?.enabled);
  const awards = enrollment ? await listAwards(env.DB, chat, viewer) : [];
  const conversation = CONVERSATION_BADGES.filter(badge =>
    (group.enabled && social.groupSince !== null) || awards.some(award => award.badge_id === badge.id));
  const progress: BadgeProgress[] = active && enrollment ? JSON.parse(enrollment.progress_json) : [];
  if (active && social.memberSince !== null) progress.push(...await getConversationProgress(env.DB, chat, viewer));
  const username = configuredBotUsername(env);
  return {
    group,
    personal: {
      state: !enrollment ? 'not-enrolled' : active ? 'available' : 'paused',
      albumUrl: username ? 'https://t.me/' + username + '?start=ach_' + Math.abs(chat) : null,
      badges: badgeList(language, [...PERSONAL_BADGES, ...conversation], awards, progress),
    },
  };
}
