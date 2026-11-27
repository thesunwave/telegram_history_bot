import { DAY, type Env } from '../../core/env';
import { collectionCard, sendCard } from './cards';
import { unlockLiveWeekly } from './evaluate';
import { GROUP_BADGES } from './rules';

const SHORT_LEASE = 5 * 60;
const GROUPS_PER_RUN = 3;
const ANNOUNCEMENTS_PER_RUN = 5;

interface PendingAnnouncement {
  chat_id: number;
  badge_id: string;
  earned_day: string;
  result: string;
  live_at: number;
  announce_at: number;
}

/** Check a bounded set of groups for badges already proven inside the open week. */
export async function liveWeeklyStep(env: Env, time: Date) {
  const now = Math.floor(time.getTime() / 1000);
  const due = await env.DB.prepare(`UPDATE achievement_groups SET next_live_check=?
    WHERE chat_id IN (SELECT chat_id FROM achievement_groups WHERE enabled=1 AND next_live_check<=?
      ORDER BY next_live_check,chat_id LIMIT ?) RETURNING chat_id`)
    .bind(now + SHORT_LEASE, now, GROUPS_PER_RUN).all<{ chat_id: number }>();
  for (const { chat_id: chat } of due.results) {
    try {
      await unlockLiveWeekly(env, chat, time);
    } catch {
      console.warn('Live group achievements deferred');
    }
  }
}

const groupGuard = `EXISTS (SELECT 1 FROM achievement_groups g
  WHERE g.chat_id=achievement_awards.chat_id AND g.enabled=1)`;

/** Clear each pending announcement before dispatch so an ambiguous send is never replayed. */
export async function announceGroupBadges(env: Env, now: number) {
  const { results } = await env.DB.prepare(`SELECT chat_id,badge_id,earned_day,result,live_at,announce_at
    FROM achievement_awards WHERE user_id=0 AND announce_at<=? ORDER BY announce_at LIMIT ?`)
    .bind(now, ANNOUNCEMENTS_PER_RUN).all<PendingAnnouncement>();
  for (const award of results) {
    const key = [award.chat_id, award.badge_id];
    const claim = await env.DB.prepare(`UPDATE achievement_awards SET announce_at=NULL
      WHERE chat_id=? AND user_id=0 AND badge_id=? AND announce_at=? AND ${groupGuard}`)
      .bind(...key, award.announce_at).run();
    if (!claim.meta.changes) continue;
    const badge = GROUP_BADGES.find(b => b.id === award.badge_id);
    if (!badge) continue;
    try {
      const png = await collectionCard(badge.id, badge.title, '', true, award);
      const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM achievement_awards WHERE chat_id=? AND user_id=0')
        .bind(award.chat_id).first<{ count: number }>() ?? { count: 1 };
      const delivery = await sendCard(env, award.chat_id, png,
        'Чат открыл бейдж «' + badge.title + '»!\n' + award.result, [[{
          text: 'Коллекция чата · ' + count + ' из ' + GROUP_BADGES.length,
          callback_data: 'ach:group:' + award.chat_id,
        }]]);
      if (delivery.status === 'retry') {
        const next = now + Math.max(SHORT_LEASE, Math.ceil(delivery.retryAfter));
        if (next < award.live_at + DAY) await env.DB.prepare(`UPDATE achievement_awards SET announce_at=?
          WHERE chat_id=? AND user_id=0 AND badge_id=? AND announce_at IS NULL AND ${groupGuard}`)
          .bind(next, ...key).run();
      }
      if (delivery.status !== 'sent') console.warn({ event: 'group_badge_announcement', status: delivery.status });
    } catch {
      console.warn('Group badge announcement unavailable');
    }
  }
}
