import type { Env } from '../core/env';
import { Logger } from '../core/logger';
import { getEnrollment, getGroup, listAwards, type Award } from '../features/achievements/repository';
import { mondayOf } from '../features/achievements/calendar';
import { GROUP_BADGES, PERSONAL_BADGES, type Badge } from '../features/achievements/rules';
import { conversationProgress, groupProgress, personalProgress, type AchievementProgress,
  type CollectionProgress } from '../features/achievements/progress';
import { progressCopy } from '../features/achievements/progress-copy';
import { botUsername, socialAvailable } from '../features/achievements/settings';
import { getConversationStatus } from '../features/achievements/social';
import { DUTCH_RUDDER, visibleConversationBadges } from '../features/achievements/social-score';
import { badgePoster } from '../features/achievements/badge-art-generated';
import { localizeAchievementBadge, type AdminLanguage } from './admin-i18n';

export interface AdminAchievementBadge extends Badge {
  earnedDay: string | null;
  result: string | null;
  current: number | null;
  target: number | null;
  progress?: AchievementProgress & { display: ReturnType<typeof progressCopy> };
  conversation?: true;
  posterUrl?: string;
}

function badgeList(
  language: AdminLanguage, catalog: Badge[], awards: Award[], progress: CollectionProgress,
): AdminAchievementBadge[] {
  return catalog.map(({ id, title, description }) => {
    const win = awards.find(award => award.badge_id === id);
    const score = progress[id];
    const conditions = score?.conditions ?? [];
    return localizeAchievementBadge(language, {
      id, title, description, earnedDay: win?.earned_day ?? null, result: win?.result ?? null,
      current: conditions.length ? Math.min(...conditions.map(row => row.current)) : null,
      target: conditions[0]?.target ?? null,
      ...(!win && score ? { progress: { ...score, display: progressCopy(score, language) } } : {}),
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
  const now = new Date();
  const [settings, groupAwards, enrollment, social] = await Promise.all([
    getGroup(env.DB, chat), listAwards(env.DB, chat), getEnrollment(env.DB, chat, viewer),
    socialAvailable(env) ? getConversationStatus(env.DB, chat, viewer) : { groupSince: null, memberSince: null },
  ]);
  const enabled = Boolean(settings?.enabled);
  const active = enabled && Boolean(enrollment?.enabled);
  const [awards, weekly, personal, replies, url] = await Promise.all([
    enrollment ? listAwards(env.DB, chat, viewer) : [],
    groupProgress(env, chat, settings, now),
    personalProgress(env, chat, viewer, settings, enrollment, now),
    active && social.groupSince !== null && social.memberSince !== null ? conversationProgress(env, chat, viewer) : {},
    enabled || enrollment ? albumLink(env, chat) : null,
  ]);
  const conversation = visibleConversationBadges(enabled && social.groupSince !== null, awards);
  const monday = mondayOf(now.toISOString().slice(0, 10));
  return {
    group: {
      enabled,
      weekStart: settings?.enabled && monday >= settings.start_day ? monday : null,
      badges: badgeList(language, GROUP_BADGES, groupAwards, weekly),
    },
    personal: {
      state: !enrollment ? 'not-enrolled' : active ? 'available' : 'paused',
      albumUrl: url,
      badges: [
        ...badgeList(language, PERSONAL_BADGES, awards, personal),
        ...badgeList(language, conversation, awards, replies).map(badge => ({
          ...badge, conversation: true as const,
          ...(badge.id === DUTCH_RUDDER.id
            ? { posterUrl: '/admin/api/achievements/secret-poster?chatId=' + chat } : {}),
        })),
      ],
    },
  };
}
