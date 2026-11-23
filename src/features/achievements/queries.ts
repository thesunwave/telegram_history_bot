export const GROUP_DAY_SQL = `WITH ranked AS (
  SELECT day,user_id,message_count,voice_duration_seconds,voice_count,
    MAX(message_count) OVER (PARTITION BY day) AS daily_max FROM stats_daily_user
  WHERE chat_id=? AND day BETWEEN ? AND ? AND user_id>0 AND message_count>0)
  SELECT day,COUNT(*) AS authors,SUM(message_count) AS messages,MAX(daily_max) AS maximum,
    CASE WHEN SUM(message_count=daily_max)=1 THEN MAX(CASE WHEN message_count=daily_max THEN user_id END) END AS leader,
    SUM(voice_duration_seconds) AS voice_seconds,SUM(voice_count) AS voices FROM ranked GROUP BY day`;
