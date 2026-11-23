import type { Env } from '../core/env';
import { Logger } from '../core/logger';
import { getEnrollment, getGroup, listAwards, type Award } from '../features/achievements/repository';
import { GROUP_BADGES, PERSONAL_BADGES, type Badge, type BadgeProgress } from '../features/achievements/rules';
import { botUsername, socialAvailable } from '../features/achievements/settings';
import { getConversationProgress, getConversationStatus } from '../features/achievements/social';
import { DUTCH_RUDDER, visibleConversationBadges } from '../features/achievements/social-score';
import { badgePoster } from '../features/achievements/badge-art-generated';
import { localizeAchievementBadge, type AdminLanguage } from './admin-i18n';

export interface AdminAchievementBadge extends Badge {
  earnedDay: string | null;
  result: string | null;
  current: number | null;
  target: number | null;
  conversation?: true;
  posterUrl?: string;
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

async function albumLink(env: Env, chat: number): Promise<string | null> {
  try {
    return 'https://t.me/' + await botUsername(env) + '?start=ach_' + Math.abs(chat);
  } catch {
    Logger.warn('Telegram bot name unavailable for dashboard album link');
    return null;
  }
}

/** Return a secret poster only after the caller's chat access and badge ownership are verified. */
export async function getAdminSecretPoster(env: Env, chat: number, viewer: number): Promise<Response> {
  const awards = await listAwards(env.DB, chat, viewer);
  if (!awards.some(award => award.badge_id === DUTCH_RUDDER.id)) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  }
  return badgePoster(DUTCH_RUDDER.id, 'GET', 'private');
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
  const conversation = visibleConversationBadges(group.enabled && social.groupSince !== null, awards);
  const progress: BadgeProgress[] = active && enrollment ? JSON.parse(enrollment.progress_json) : [];
  if (active && social.memberSince !== null) progress.push(...await getConversationProgress(env.DB, chat, viewer));
  return {
    group,
    personal: {
      state: !enrollment ? 'not-enrolled' : active ? 'available' : 'paused',
      albumUrl: group.enabled || enrollment ? await albumLink(env, chat) : null,
      badges: [
        ...badgeList(language, PERSONAL_BADGES, awards, progress),
        ...badgeList(language, conversation, awards, progress).map(badge => ({
          ...badge, conversation: true as const,
          ...(badge.id === DUTCH_RUDDER.id
            ? { posterUrl: '/admin/api/achievements/secret-poster?chatId=' + chat } : {}),
        })),
      ],
    },
  };
}
