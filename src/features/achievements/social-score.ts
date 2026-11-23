import type { Badge, BadgeProgress } from './rules';

interface ConversationBadge extends Badge {
  target: number;
}

export const CONVERSATION_BADGES: ConversationBadge[] = [
  { id: 'ping-pong', title: 'Пинг-понг', description: 'Цепочка из четырёх реплик вдвоём за 24 часа.', target: 4 },
  { id: 'spark', title: 'Искра', description: 'Три разных человека ответили на одно сообщение за 48 часов.', target: 3 },
  { id: 'connector', title: 'Связующее звено', description: 'Три разных собеседника ответили на ваши прямые ответы за 28 дней.', target: 3 },
  { id: 'to-be-continued', title: 'Продолжение следует', description: 'Вернуться к реплике спустя 1–7 дней и получить ответ в течение суток.', target: 2 },
];

export const DUTCH_RUDDER: Badge = {
  id: 'dutch-rudder',
  title: 'Голландский штурвал',
  description: 'За 28 дней в разные дни подхватить реплики друг друга. Каждый ответ должен за сутки собрать прямые ответы двух других участников.',
};
export const DUTCH_RUDDER_RESULT = 'Два раза передали штурвал — и оба раза чат пошёл за вами.';

/** The secret badge only appears in an album that already earned it. */
export function visibleConversationBadges(
  available: boolean, awards: readonly { badge_id: string }[],
): Badge[] {
  const badges: Badge[] = CONVERSATION_BADGES.filter(badge =>
    available || awards.some(award => award.badge_id === badge.id));
  if (awards.some(award => award.badge_id === DUTCH_RUDDER.id)) badges.push(DUTCH_RUDDER);
  return badges;
}

// Every newly verified edge affects only its two endpoints, even if it links
// older out-of-order messages. Each query reads only that participant's edges.
export const SCORE_SQL = `
WITH scope(chat,owner,cutoff,clock) AS (VALUES (?,?,?,?)),
edges AS MATERIALIZED (
  SELECT * FROM conversation_messages
  WHERE chat_id=(SELECT chat FROM scope) AND user_id=(SELECT owner FROM scope) AND verified=1 AND sent_at>=(SELECT cutoff FROM scope)
  UNION ALL
  SELECT * FROM conversation_messages
  WHERE chat_id=(SELECT chat FROM scope) AND parent_user=(SELECT owner FROM scope) AND verified=1 AND sent_at>=(SELECT cutoff FROM scope)
),
exchanges AS MATERIALIZED (
  SELECT a.user_id AS pivot, a.parent_user AS partner, a.parent_sent AS started,
    a.sent_at AS middle, b.sent_at AS finished, b.message_id AS last_id
  FROM edges a JOIN edges b ON b.parent_id=a.message_id AND b.user_id=a.parent_user
),
scores(id, current, target) AS (
  SELECT 'ping-pong', CASE
    WHEN EXISTS (SELECT 1 FROM exchanges e JOIN edges c
      ON c.parent_id=e.last_id AND c.user_id=e.pivot
      WHERE c.sent_at-e.started<=86400) THEN 4
    WHEN EXISTS (SELECT 1 FROM exchanges WHERE finished-started<=86400) THEN 3
    WHEN EXISTS (SELECT 1 FROM edges WHERE sent_at-parent_sent<=86400) THEN 2
    ELSE 0 END, 4
  UNION ALL
  SELECT 'spark', COALESCE((SELECT MAX(n) FROM (
    SELECT COUNT(DISTINCT user_id) n FROM edges
    WHERE parent_user=(SELECT owner FROM scope) AND sent_at-parent_sent<=172800 GROUP BY parent_id
  )), 0), 3
  UNION ALL
  SELECT 'connector', COUNT(DISTINCT partner), 3 FROM exchanges WHERE pivot=(SELECT owner FROM scope)
  UNION ALL
  SELECT 'to-be-continued', CASE
    WHEN EXISTS (SELECT 1 FROM exchanges
      WHERE middle-started BETWEEN 86400 AND 604800 AND finished-middle<=86400) THEN 2
    WHEN EXISTS (SELECT 1 FROM edges WHERE sent_at-parent_sent BETWEEN 86400 AND 604800) THEN 1
    ELSE 0 END, 2
),
results AS (
  SELECT id,current,target, CASE id
    WHEN 'ping-pong' THEN 'Реплик в цепочке · ' || current
    WHEN 'spark' THEN 'Ответивших участников · ' || current
    WHEN 'connector' THEN 'Взаимных диалогов · ' || current
    ELSE 'Ответов в продолжении · ' || current || ' из 2' END AS result
  FROM scores
)`;

export function asProgress(row: Omit<BadgeProgress, 'earned'>): BadgeProgress {
  return { ...row, earned: row.current >= row.target };
}

// Only inspect pivots between the owner and a partner. The two outsider replies
// can come from different members on each leg. Both pivots must be within the window.
export const DUTCH_RUDDER_AWARD_SQL = `
WITH scope(chat,owner,cutoff,clock) AS (VALUES (?,?,?,?)),
pivots AS (
  SELECT m.*, m.parent_user AS partner
  FROM scope s JOIN conversation_messages m ON m.chat_id=s.chat AND m.user_id=s.owner
  WHERE m.verified=1 AND m.sent_at BETWEEN s.cutoff AND s.clock AND m.parent_sent>=s.cutoff
  UNION ALL
  SELECT m.*, m.user_id AS partner
  FROM scope s JOIN conversation_messages m ON m.chat_id=s.chat AND m.parent_user=s.owner
  WHERE m.verified=1 AND m.sent_at BETWEEN s.cutoff AND s.clock AND m.parent_sent>=s.cutoff
),
branches AS (
  SELECT p.partner, p.user_id AS pivot, p.sent_at/86400 AS utc_day
  FROM pivots p
  WHERE (SELECT COUNT(DISTINCT r.user_id)
    FROM conversation_messages r INDEXED BY conversation_by_parent
    WHERE r.chat_id=p.chat_id AND r.parent_id=p.message_id
      AND r.verified=1 AND r.user_id NOT IN (p.user_id,p.parent_user)
      AND r.sent_at BETWEEN p.sent_at AND MIN(p.sent_at+86400,(SELECT clock FROM scope))
  )>=2
),
pairs AS MATERIALIZED (
  SELECT b.partner FROM branches b CROSS JOIN scope s
  WHERE EXISTS (SELECT 1 FROM conversation_members a WHERE a.chat_id=s.chat AND a.user_id=s.owner)
    AND EXISTS (SELECT 1 FROM conversation_members p WHERE p.chat_id=s.chat AND p.user_id=b.partner)
  GROUP BY b.partner
  HAVING COUNT(DISTINCT b.pivot)=2 AND MIN(b.utc_day)<>MAX(b.utc_day)
),
recipients(user_id) AS (
  SELECT partner FROM pairs UNION SELECT owner FROM scope WHERE EXISTS (SELECT 1 FROM pairs)
)
INSERT OR IGNORE INTO achievement_awards(chat_id,user_id,badge_id,earned_day,result,rule_version)
SELECT chat,user_id,'${DUTCH_RUDDER.id}',date(clock,'unixepoch'),?,1 FROM recipients,scope
`;
