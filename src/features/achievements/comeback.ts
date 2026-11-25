import { DAY, type Env } from '../../core/env';
import { personalCard, sendCard } from './cards';
import { identifyGroupMessage, messageRecord } from './group-message';
import { getEnrollment } from './repository';
import { COMEBACK, COMEBACK_DAYS } from './rules';
import { comebackAvailable } from './settings';

const CLOCK_SKEW_SECONDS = 5;
const MAX_REPLY_AGE = DAY;
const REPLIES_PER_RUN = 10;
const nowSeconds = () => Math.floor(Date.now() / 1000);

interface PendingReply {
  chat_id: number;
  user_id: number;
  earned_day: string;
  comeback_reply_json: string;
  comeback_reply_at: number;
}

interface ReplyTarget {
  message: number;
  thread: number | null;
  generation: string;
  consent: number;
  queued: number;
}

const replyColumns = 'chat_id,user_id,earned_day,comeback_reply_json,comeback_reply_at';

/** Record a return before normal stats overwrite the previous activity timestamp. */
export async function observeComeback(env: Env, incoming: unknown) {
  if (!comebackAvailable(env)) return;
  const message = identifyGroupMessage(incoming);
  const now = nowSeconds();
  if (!message || message.date > now + CLOCK_SKEW_SECONDS) return;
  const { text, caption } = messageRecord(incoming);
  if ((typeof text === 'string' && text.startsWith('/')) ||
    (typeof caption === 'string' && caption.startsWith('/'))) return;

  const { chat, user, date } = message;
  // A primary-key read keeps the write transaction off chats without active albums.
  const eligible = await env.DB.prepare(`SELECT 1 FROM achievement_enrollments e
    JOIN achievement_groups g USING(chat_id)
    WHERE e.chat_id=? AND e.user_id=? AND e.enabled=1 AND g.enabled=1 AND ?>=unixepoch(e.start_day)
    AND NOT EXISTS (SELECT 1 FROM achievement_awards WHERE chat_id=? AND user_id=? AND badge_id=?)`)
    .bind(chat, user, date, chat, user, COMEBACK.id).first();
  if (!eligible) return;

  const statements = [
    // Older albums can use their existing stats timestamp. The baseline must
    // be a real message from this enrollment period, never the join date.
    env.DB.prepare(`WITH prior AS (
      SELECT e.start_day,e.generation,e.comeback_replies_since,
        MAX(COALESCE(e.comeback_last_message_ts,0),COALESCE(p.last_message_ts,0)) AS seen
      FROM achievement_enrollments e JOIN achievement_groups g USING(chat_id)
      LEFT JOIN stats_chat_user_profile p USING(chat_id,user_id)
      WHERE e.chat_id=? AND e.user_id=? AND e.enabled=1 AND g.enabled=1
    ) INSERT INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result,comeback_reply_json,comeback_reply_at)
      SELECT ?,?,?,date(?,'unixepoch'),CAST((?-seen)/? AS INTEGER) || ' дн. тишины',
        CASE WHEN comeback_replies_since<=? THEN json_object('message',?,'thread',?,'generation',generation,
          'consent',comeback_replies_since,'queued',?) END,
        CASE WHEN comeback_replies_since<=? THEN ? END
      FROM prior WHERE seen>0 AND seen>=unixepoch(start_day) AND ?-seen>=?
      ON CONFLICT(chat_id,user_id,badge_id) DO NOTHING
      RETURNING ${replyColumns}`)
      .bind(chat, user, chat, user, COMEBACK.id, date, date, DAY, date, message.id, message.thread ?? null,
        now, date, now, date, COMEBACK_DAYS * DAY),
    env.DB.prepare(`UPDATE achievement_enrollments SET comeback_last_message_ts=?
      WHERE chat_id=? AND user_id=? AND enabled=1 AND ?>=unixepoch(start_day)
      AND ?>COALESCE(comeback_last_message_ts,0)
      AND EXISTS (SELECT 1 FROM achievement_groups WHERE chat_id=? AND enabled=1)
      AND NOT EXISTS (SELECT 1 FROM achievement_awards WHERE chat_id=? AND user_id=? AND badge_id=?)`)
      .bind(date, chat, user, date, date, chat, chat, user, COMEBACK.id),
  ];
  const [inserted, advanced] = await env.DB.batch<PendingReply>(statements);
  if (!inserted?.success || !advanced?.success) throw new Error('Comeback activity write failed');
  const award = inserted.results[0];
  if (award?.comeback_reply_json) return award;
}

const consentGuard = `EXISTS (SELECT 1 FROM achievement_enrollments e JOIN achievement_groups g USING(chat_id)
  WHERE e.chat_id=achievement_awards.chat_id AND e.user_id=achievement_awards.user_id
  AND e.enabled=1 AND g.enabled=1 AND e.generation=? AND e.comeback_replies_since=?)`;

/** Clear the pending reply before dispatch so an ambiguous send can never be replayed. */
export async function replyWithComebackCard(env: Env, reply: PendingReply, now = nowSeconds()) {
  const { chat_id: chat, user_id: user, earned_day: day, comeback_reply_json: payload, comeback_reply_at: due } = reply;
  const target: ReplyTarget = JSON.parse(payload);
  const key = [chat, user, COMEBACK.id];
  const clear = `UPDATE achievement_awards SET comeback_reply_json=NULL,comeback_reply_at=NULL
    WHERE chat_id=? AND user_id=? AND badge_id=? AND comeback_reply_json=? AND comeback_reply_at=?`;
  const consent = [target.generation, target.consent];
  const enrollment = await getEnrollment(env.DB, chat, user);
  const expires = target.queued + MAX_REPLY_AGE;
  if (now >= expires || !enrollment?.enabled || enrollment.generation !== target.generation ||
    enrollment.comeback_replies_since !== target.consent) {
    await env.DB.prepare(clear).bind(...key, payload, due).run();
    return;
  }
  const caption = 'Месяц тишины. И тут — тыдыщ.';
  const png = await personalCard(COMEBACK.id, COMEBACK.title, day, caption);
  const claim = await env.DB.prepare(clear + ' AND ' + consentGuard).bind(...key, payload, due, ...consent).run();
  if (!claim.meta.changes) return;
  const delivery = await sendCard(env, chat, png, [COMEBACK.title, caption].join('\n'),
    undefined, target.thread ?? undefined, target.message);
  if (delivery.status === 'retry') {
    const next = Math.max(now, nowSeconds()) + Math.ceil(delivery.retryAfter);
    if (next < expires) await env.DB.prepare(`UPDATE achievement_awards SET comeback_reply_json=?,comeback_reply_at=?
      WHERE chat_id=? AND user_id=? AND badge_id=? AND comeback_reply_json IS NULL AND ${consentGuard}`)
      .bind(payload, next, ...key, ...consent).run();
  }
  if (delivery.status !== 'sent') console.warn({ event: 'comeback_card_delivery', status: delivery.status });
}

/** Drain only a bounded set of due replies per achievement cron run. */
export async function retryComebackReplies(env: Env, now: number) {
  const { results } = await env.DB.prepare(`SELECT ${replyColumns} FROM achievement_awards
    WHERE comeback_reply_at<=? ORDER BY comeback_reply_at LIMIT ?`).bind(now, REPLIES_PER_RUN).all<PendingReply>();
  for (const reply of results) {
    try {
      await replyWithComebackCard(env, reply, now);
    } catch {
      console.warn('Comeback card unavailable');
    }
  }
}
