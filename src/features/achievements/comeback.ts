import { DAY, type Env } from '../../core/env';
import { personalCard, sendCard } from './cards';
import { identifyGroupMessage, messageRecord } from './group-message';
import { getEnrollment } from './repository';
import { COMEBACK, COMEBACK_DAYS } from './rules';

interface ComebackAward { earned_day: string; generation: string; replies_since: number | null }
type GroupMessage = NonNullable<ReturnType<typeof identifyGroupMessage>>;

/** Record a return before normal stats overwrite the previous activity timestamp. */
export async function observeComeback(env: Env, incoming: unknown) {
  if (String(env.ENABLE_ACTIVITY_TRACKING) === 'false' || env.RAW_MESSAGE_STORAGE_MODE === 'unconfigured') return;
  const message = identifyGroupMessage(incoming);
  if (!message || message.date > Math.floor(Date.now() / 1000)) return;
  const { text } = messageRecord(incoming);
  if (typeof text === 'string' && text.startsWith('/')) return;

  const { chat, user, date } = message;
  const statements = [
    // Older albums can use their existing stats timestamp. The baseline must
    // be a real message from this enrollment period, never the join date.
    env.DB.prepare(`WITH prior AS (
      SELECT e.start_day,MAX(COALESCE(e.comeback_last_message_ts,0),COALESCE(p.last_message_ts,0)) AS seen
      FROM achievement_enrollments e JOIN achievement_groups g USING(chat_id)
      LEFT JOIN stats_chat_user_profile p USING(chat_id,user_id)
      WHERE e.chat_id=? AND e.user_id=? AND e.enabled=1 AND g.enabled=1
    ) INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result)
      SELECT ?,?,?,date(?,'unixepoch'),CAST((?-seen)/? AS INTEGER) || ' дн. тишины'
      FROM prior WHERE seen>0 AND seen>=unixepoch(start_day) AND ?-seen>=?
      ON CONFLICT(chat_id,user_id,badge_id) DO NOTHING
      RETURNING earned_day,
        (SELECT generation FROM achievement_enrollments
          WHERE chat_id=? AND user_id=?) AS generation,
        (SELECT comeback_replies_since FROM achievement_enrollments
          WHERE chat_id=? AND user_id=?) AS replies_since`)
      .bind(chat, user, chat, user, COMEBACK.id, date, date, DAY, date, COMEBACK_DAYS * DAY,
        chat, user, chat, user),
    env.DB.prepare(`UPDATE achievement_enrollments SET comeback_last_message_ts=?
      WHERE chat_id=? AND user_id=? AND enabled=1 AND ?>=unixepoch(start_day)
      AND ?>COALESCE(comeback_last_message_ts,0)
      AND EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1)
      AND NOT EXISTS (SELECT 1 FROM achievement_awards WHERE chat_id=? AND user_id=? AND badge_id=?)`)
      .bind(date, chat, user, date, date, chat, chat, user, COMEBACK.id),
  ];
  const [inserted, advanced] = await env.DB.batch<ComebackAward>(statements);
  if (!inserted?.success || !advanced?.success) throw new Error('Comeback activity write failed');
  const award = inserted.results[0];
  if (award && award.replies_since !== null && award.replies_since <= date) return { message, award };
}

/** Reply only for a newly awarded badge after verifying that consent still applies. */
export async function replyWithComebackCard(env: Env, { message, award }: { message: GroupMessage; award: ComebackAward }) {
  const caption = 'Месяц тишины. И тут — тыдыщ.';
  const png = await personalCard(COMEBACK.id, COMEBACK.title, award.earned_day, caption);
  const enrollment = await getEnrollment(env.DB, message.chat, message.user);
  if (!enrollment?.enabled || enrollment.generation !== award.generation ||
    enrollment.comeback_replies_since !== award.replies_since) return;
  const delivery = await sendCard(env, message.chat, png, [COMEBACK.title, caption].join('\n'),
    undefined, message.thread, message.id);
  if (delivery.status !== 'sent') console.warn({ event: 'comeback_card_delivery', status: delivery.status });
}
