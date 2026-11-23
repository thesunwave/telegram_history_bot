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
