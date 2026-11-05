import type { Env } from '../../core/env';
import { Logger } from '../../core/logger';
import { NotificationRepository } from '../../core/repositories/notification-repository';
import { sendMessage } from '../../core/telegram';

export const ACTIVITY_REPORT_CRON = '0 * * * *';
const DAY_MS = 24 * 60 * 60 * 1000;

/** One report per completed UTC day, sent at the chat's chosen UTC hour. */
export async function runActivityReportCron(env: Env, scheduledTime: number): Promise<number> {
  if (env.ENABLE_ACTIVITY_TRACKING === 'false' || env.ENABLE_ACTIVITY_TRACKING === false) return 0;
  const now = new Date(scheduledTime);
  const hour = now.getUTCHours();
  const reportDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS)
    .toISOString().slice(0, 10);
  const repository = new NotificationRepository(env);
  let sent = 0;

  for (const chat of await repository.getAllChatIds()) {
    const chatId = Number(chat);
    if (!Number.isSafeInteger(chatId) || chatId === 0) continue;

    try {
      const settings = await repository.getChatSettings(chat);
      const activity = settings?.notifications.activity_summary;
      if (!settings?.enabled || !activity?.enabled || activity.frequency !== 'daily') continue;
      // Old legacy settings may have activity_summary.enabled=true without
      // ever having a working delivery path. Require a new explicit UTC opt-in.
      if (activity.time?.minute !== 0 || activity.time.timezone !== 'UTC') continue;
      if (activity.time?.hour !== hour) continue;

      const counts = await env.DB.prepare(
        `SELECT COALESCE(SUM(message_count), 0) AS messages,
                COALESCE(SUM(CASE WHEN message_count > 0 THEN 1 ELSE 0 END), 0) AS users
         FROM stats_daily_user WHERE chat_id = ? AND day = ?`
      ).bind(chatId, reportDay).first<{ messages: number; users: number }>();
      const messages = Number(counts?.messages ?? 0);
      const users = Number(counts?.users ?? 0);
      const claim = await env.DB.prepare(
        `INSERT OR IGNORE INTO activity_report_delivery (chat_id, report_day)
         VALUES (?, ?)`
      ).bind(chatId, reportDay).run();
      if (claim.meta.changes !== 1) continue;

      try {
        await sendMessage(env, chatId,
          `📈 Активность чата за ${reportDay} (UTC)\n\n💬 Сообщений: ${messages}\n👥 Активных участников: ${users}`);
        await env.DB.prepare(
          "UPDATE activity_report_delivery SET status = 'sent', finished_at = CURRENT_TIMESTAMP WHERE chat_id = ? AND report_day = ?"
        ).bind(chatId, reportDay).run();
        await repository.recordNotificationResult(chat, 'activity_summary', {
          success: true, sentAt: now, responseTime: 0, retryAttempt: 0
        });
        sent++;
      } catch (error) {
        // Telegram network errors can be ambiguous; never resend this day's
        // claimed report automatically, even if marking the failure fails.
        await env.DB.prepare(
          "UPDATE activity_report_delivery SET status = 'failed', finished_at = CURRENT_TIMESTAMP WHERE chat_id = ? AND report_day = ?"
        ).bind(chatId, reportDay).run();
        await repository.recordNotificationResult(chat, 'activity_summary', {
          success: false, sentAt: now, responseTime: 0, retryAttempt: 0,
          error: error instanceof Error ? error.name : 'UnknownError'
        });
        Logger.error('Activity report delivery failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
      }
    } catch (error) {
      Logger.error('Activity report processing failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    }
  }

  return sent;
}

/** Accept only whole UTC hours; the hourly Cloudflare trigger has minute 0. */
export function parseActivityReportHour(input: string | undefined): number | null {
  if (!input || !/^(?:[01]?\d|2[0-3])(?::00)?$/.test(input)) return null;
  return Number(input.split(':')[0]);
}
