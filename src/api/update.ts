import { Env, DAY, MAX_LAST_MESSAGES } from '../core/env';
import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { summariseChat, summariseChatMessages } from '../features/summary/summary';
import {
  topChat,
  topTalkers,
  resetCounters,
  activityChart,
  activityByUser,
  activityHours,
  parseActivityCommand,
  profanityTopUsers,
  profanityWordsStats,
  myProfanityStats,
  profanityChart,
  profanityRateChart,
  resetProfanityCounters,
  criminalCodeStats,
  criminalTopUsers,
  myCriminalStats,
  resetCriminalCounters,
} from '../features/stats/stats';
import { sendMessage } from '../core/telegram';
import { Logger } from '../core/logger';
import { ProfanityAnalyzer } from '../features/profanity/profanity';
import { ProviderFactory } from '../core/providers/provider-factory';
import { NotificationService } from '../core/services/notification-service';
import { NotificationRepository } from '../core/repositories/notification-repository';
import type { NotificationType } from '../core/models/notification-settings';
import { isTelegramUserChatAdmin, saveAdminChatMeta } from './admin-chats';

function isTestEnvironment(env: Env): boolean {
  // Check if we're in a test environment by looking for test-specific values
  return env.TOKEN === 'test_token' ||
    env.TOKEN === 'test-token' ||
    env.OPENAI_API_KEY === 'test-openai-key' ||
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'test');
}

function isFeatureEnabled(value: string | boolean | undefined): boolean {
  return value !== 'false' && value !== false;
}

function disabledOnProdLabel(enabled: boolean): string {
  return enabled ? '' : ' [глобально отключено на проде]';
}

export function buildHelpText(env: Env): string {
  const summaryLabel = disabledOnProdLabel(isFeatureEnabled(env.ENABLE_SUMMARY));
  const activityLabel = disabledOnProdLabel(isFeatureEnabled(env.ENABLE_ACTIVITY_TRACKING));
  const profanityLabel = disabledOnProdLabel(isFeatureEnabled(env.ENABLE_PROFANITY_ANALYSIS));
  const criminalLabel = disabledOnProdLabel(isFeatureEnabled(env.ENABLE_CRIMINAL_ANALYSIS));

  return [
    'Справка по командам чата',
    '',
    'Сводки',
    `/summary <days> – сводка за последние N дней (по умолчанию 1)${summaryLabel}`,
    `/summary_last <n> – сводка последних N сообщений (по умолчанию 100, макс 1000)${summaryLabel}`,
    '',
    'Активность',
    `/top <n> – топ N активных пользователей за сегодня (по умолчанию 5)${activityLabel}`,
    `/talkers <n> [period] – топ болтунов по словам и словам/сообщение${activityLabel}`,
    `/activity_week – график активности за неделю${activityLabel}`,
    `/activity_month – график активности за последние 30 дней${activityLabel}`,
    `/activity_users_week – активность по пользователям за неделю${activityLabel}`,
    `/activity_users_month – активность по пользователям за последние 30 дней${activityLabel}`,
    `/activity chart <period> – активность чата за период${activityLabel}`,
    `/activity users <period> – активность пользователей за период${activityLabel}`,
    `/activity_hours <period> – средняя активность по часам суток${activityLabel}`,
    'period: week | month | 2m | 14d | 8w | prev_week | prev_month | YYYY-MM-DD YYYY-MM-DD',
    '',
    'Мат',
    `/profanity_top [n] [period] – топ N матершинников${profanityLabel}`,
    `/profanity_words [n] [period] – топ N матерных слов${profanityLabel}`,
    `/my_profanity [period] – ваша статистика мата${profanityLabel}`,
    `/profanity_chart_week – график мата за неделю${profanityLabel}`,
    `/profanity_chart_month – график мата за месяц${profanityLabel}`,
    `/profanity_rate [n] [period] – график доли мата среди всех слов${profanityLabel}`,
    'period: today | week | month',
    '',
    'УК РФ',
    `/criminal_stats [period] – статистика нарушений УК РФ${criminalLabel}`,
    `/my_criminal [period] – ваша статистика нарушений УК РФ${criminalLabel}`,
    `/criminal_top [n] [period] – топ N нарушителей УК РФ${criminalLabel}`,
    `/criminal_backfill [n|today|week|month] – админский replay последних сообщений${criminalLabel}`,
    'period: today | week | month',
    '',
    '/help – показать эту справку',
  ].join('\n');
}

export function getTextMessage(update: any) {
  const msg = update.message;
  if (!msg || (!msg.text && !msg.voice && !msg.video_note)) return null;
  if (msg.from?.is_bot) return null;
  if (isForwardedMessage(msg)) return null;
  return msg;
}

/**
 * Detects Telegram reposts/forwards so reposted text is not counted as user activity.
 */
export function isForwardedMessage(msg: any): boolean {
  return Boolean(
    msg?.forward_origin ||
    msg?.forward_from ||
    msg?.forward_from_chat ||
    msg?.forward_sender_name ||
    msg?.forward_date ||
    msg?.is_automatic_forward
  );
}

export function countWords(text: string | undefined): number {
  if (!text) return 0;
  const textWithoutUrls = text.replace(/\b(?:https?:\/\/|www\.)\S+/giu, ' ');
  return textWithoutUrls.trim().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

type ProgressCategory = 'base' | 'profanity' | 'criminal';
type ProgressOutcome = 'completed' | 'zero' | 'skipped' | 'failed';

/** Whether profanity analysis will actually run for this message. */
function profanityAnalysisEnabledFor(env: Env, msg: any): boolean {
  const enabled = env.ENABLE_PROFANITY_ANALYSIS !== 'false' && env.ENABLE_PROFANITY_ANALYSIS !== false;
  return enabled && !!msg?.text && !msg.text.startsWith('/') && !isTestEnvironment(env);
}

/** Whether criminal analysis will actually run for this message. */
function criminalAnalysisEnabledFor(env: Env, msg: any): boolean {
  const enabled = env.ENABLE_CRIMINAL_ANALYSIS !== 'false' && env.ENABLE_CRIMINAL_ANALYSIS !== false;
  return enabled && !!msg?.text && !msg.text.startsWith('/') && !isTestEnvironment(env);
}

/**
 * Best-effort acknowledgement of an async terminal branch to CountersDO. Ack
 * failures propagate to caller for terminal failed handling; never logs payload identity.
 * A non-2xx /ack response cannot be repaired by re-acknowledging, so it is
 * surfaced to the caller (or swallowed by fire-and-forget callers) while a
 * privacy-safe log records only operation/category/outcome/status.
 */
async function ackProgress(
  env: Env,
  chatId: number,
  day: string,
  category: ProgressCategory,
  messageId: number | undefined,
  sequence: number,
  outcome: ProgressOutcome,
): Promise<void> {
  const id = env.COUNTERS_DO.idFromName(String(chatId));
  const response = await env.COUNTERS_DO.get(id).fetch('https://do/ack', {
    method: 'POST',
    body: JSON.stringify({ chatId, day, category, messageId, sequence, outcome }),
  });
  if (!response.ok) {
    Logger.warn('Ack to CountersDO returned non-OK status', {
      op: 'ack',
      category,
      outcome,
      status: response.status,
    });
  }
}

export async function recordMessage(msg: any, env: Env, ctx?: ExecutionContext) {
  if (!msg) {
    Logger.debug(env, 'recordMessage: no message');
    return;
  }
  if (msg.from?.is_bot) {
    Logger.debug(env, 'recordMessage: bot message, skipping');
    return;
  }
  if (isForwardedMessage(msg)) {
    Logger.debug(env, 'recordMessage: forwarded message, skipping');
    return;
  }
  const chatId = msg.chat.id;
  const userId = msg.from?.id || 0;
  const username = msg.from?.username || `id${userId}`;
  const ts = msg.date;
  const wordCount = countWords(msg.text);
  const voiceCount = msg.voice ? 1 : 0;
  const voiceDurationSeconds = Number.isInteger(msg.voice?.duration) ? msg.voice.duration : 0;
  const videoNoteCount = msg.video_note ? 1 : 0;
  const videoNoteDurationSeconds = Number.isInteger(msg.video_note?.duration)
    ? msg.video_note.duration
    : 0;
  await saveAdminChatMeta(env, msg.chat, ts);
  const stored = {
    chat: chatId,
    user: userId,
    username,
    text: msg.text,
    ts,
    messageId: msg.message_id,
  };

  Logger.debug(env, 'recordMessage: saving message', {
    op: 'recordMessage',
  });

  // Save to optimized daily block structure.
  // The exact summary-E2E mock token bypasses the DayBlock Durable Object
  // (its namespace returns plain text) and persists through the individual
  // msg: KV path, which summary fetches can read. Other test sentinels must
  // keep the normal DayBlock-first path.
  const key = `msg:${chatId}:${ts}:${msg.message_id}`;
  if (env.TOKEN === 'test-token') {
    try {
      await env.HISTORY.put(key, JSON.stringify(stored), {
        expirationTtl: 7 * DAY,
      });
      Logger.debug(env, 'recordMessage: individual save successful (test env)', { op: 'fallback' });
    } catch {
      Logger.error('recordMessage: individual save failed', {
        op: 'fallback',
        errorClass: 'Error',
      });
    }
  } else {
    try {
      const { addMessageToDayBlock } = await import('../features/history/history-optimized');
      await addMessageToDayBlock(env, stored);
      Logger.debug(env, 'recordMessage: day block save successful', {
        chatId,
        date: new Date(ts * 1000).toISOString().slice(0, 10)
      });
    } catch {
      Logger.error('recordMessage: day block save failed', {
        op: 'dayBlock',
        errorClass: 'Error',
      });

      // Fallback to individual message storage for reliability
      try {
        await env.HISTORY.put(key, JSON.stringify(stored), {
          expirationTtl: 7 * DAY,
        });
        Logger.debug(env, 'recordMessage: fallback individual save successful', { op: 'fallback' });
      } catch {
        Logger.error('recordMessage: both storage methods failed', {
          op: 'fallback',
          errorClass: 'Error',
        });
      }
    }
  }

  // Check for ENABLE_ACTIVITY_TRACKING flag (default to true)
  const activityTrackingEnabled = env.ENABLE_ACTIVITY_TRACKING !== 'false' && env.ENABLE_ACTIVITY_TRACKING !== false;
  let sequence: number | undefined;

  if (activityTrackingEnabled) {
    const day = new Date(ts * 1000).toISOString().slice(0, 10);
    const id = env.COUNTERS_DO.idFromName(String(chatId));

    try {
      const res = await env.COUNTERS_DO.get(id).fetch('https://do/inc', {
        method: 'POST',
        body: JSON.stringify({
          chatId,
          userId,
          username,
          day,
          messageId: msg.message_id,
          hour: new Date(ts * 1000).getUTCHours(),
          wordCount,
          voiceCount,
          voiceDurationSeconds,
          videoNoteCount,
          videoNoteDurationSeconds,
          ts,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '[no-body]');
        Logger.error('recordMessage: counter update returned non-OK status', {
          op: 'counterUpdate',
          errorClass: 'Error',
          status: res.status,
        });
      } else {
        // Try to parse JSON with detailed counts (new DO version)
        let parsed: any = null;
        let rawText: string | null = null;
        try {
          parsed = await res.json();
        } catch {
          // Fallback for legacy plain-text 'ok'
          rawText = await res.text().catch(() => null);
        }

        if (parsed && typeof parsed === 'object') {
          sequence = Number.isInteger(parsed.sequence) ? parsed.sequence : undefined;
          Logger.log('recordMessage: counter update successful (verified)', {
            op: 'counterUpdate',
          });
        } else {
          Logger.debug(env, 'recordMessage: counter update successful (legacy DO response)', {
            op: 'counterUpdate',
          });
        }
      }
    } catch {
      Logger.error('recordMessage: counter update failed', {
        op: 'counterUpdate',
        errorClass: 'Error'
      });
    }

  } else {
    Logger.debug(env, 'Skipping activity tracking (ENABLE_ACTIVITY_TRACKING is false)', {
      op: 'activitySkip',
    });
  }

  // Define day for analysis usage if not already defined (in case activity tracking was skipped)
  const day = new Date(ts * 1000).toISOString().slice(0, 10);

  // Schedule profanity analysis in background (fire-and-forget)
  // Only for text messages that are not commands and not in test environment
  Logger.log('PROFANITY ANALYSIS CHECK', {
    op: 'profanityCheck',
  });

  // Check for ENABLE_PROFANITY_ANALYSIS flag (default to true)
  const profanityAnalysisEnabled = env.ENABLE_PROFANITY_ANALYSIS !== 'false' && env.ENABLE_PROFANITY_ANALYSIS !== false;

  if (profanityAnalysisEnabled && msg.text && !msg.text.startsWith('/') && !isTestEnvironment(env)) {
    Logger.debug(env, 'Scheduling profanity analysis for message', { op: 'profanitySchedule' });

    // Fire-and-forget: don't await this; lifecycle-safe via ctx.waitUntil
    const profanityPromise = analyzeProfanityAsync(msg, env, chatId, userId, username, day, sequence).catch(() => {
      // already handled inside analyzeProfanityAsync terminal failed ack; no payload logging
    });
    if (ctx) ctx.waitUntil(profanityPromise); else void profanityPromise;
  } else {
    Logger.debug(env, 'Skipping profanity analysis', {
      reason: !profanityAnalysisEnabled ? 'disabled-by-config' : !msg.text ? 'no-text' : 'test-environment',
      op: 'profanitySkip',
    });
    if (sequence !== undefined) {
      const p = ackProgress(env, chatId, day, 'profanity', msg.message_id, sequence, 'skipped').catch(() => undefined);
      if (ctx) ctx.waitUntil(p); else void p;
    }
  }

  // Schedule criminal code analysis in background (fire-and-forget)
  Logger.log('CRIMINAL CODE ANALYSIS CHECK', { op: 'criminalCheck' });

  // Check for ENABLE_CRIMINAL_ANALYSIS flag (default to true)
  const criminalAnalysisEnabled = env.ENABLE_CRIMINAL_ANALYSIS !== 'false' && env.ENABLE_CRIMINAL_ANALYSIS !== false;

  if (criminalAnalysisEnabled && msg.text && !msg.text.startsWith('/') && !isTestEnvironment(env)) {
    Logger.debug(env, 'Scheduling criminal code analysis for message', { op: 'criminalSchedule' });

    // Fire-and-forget: don't await this; lifecycle-safe via ctx.waitUntil
    const criminalPromise = analyzeCriminalCodeAsync(msg, env, chatId, userId, username, day, sequence).catch(() => undefined);
    if (ctx) ctx.waitUntil(criminalPromise); else void criminalPromise;
  } else {
    Logger.debug(env, 'Skipping criminal code analysis', { op: 'criminalSkip' });
    if (sequence !== undefined) {
      const p = ackProgress(env, chatId, day, 'criminal', msg.message_id, sequence, 'skipped').catch(() => undefined);
      if (ctx) ctx.waitUntil(p); else void p;
    }
  }
}

async function analyzeProfanityAsync(
  msg: any,
  env: Env,
  chatId: number,
  userId: number,
  username: string,
  day: string,
  sequence?: number
): Promise<void> {
  Logger.log('PROFANITY ANALYSIS FUNCTION STARTED', { op: 'profanityStart' });

  const startTime = Date.now();
  const timings: Record<string, number> = {};

  // КРИТИЧЕСКАЯ ПРОВЕРКА: команды НЕ должны попадать сюда!
  if (msg.text?.startsWith('/')) {
    Logger.error('CRITICAL: Command reached profanity analysis - this should never happen!', {
      op: 'profanityCommand',
      errorClass: 'Error',
    });
    if (sequence !== undefined) {
      await ackProgress(env, chatId, day, 'profanity', msg.message_id, sequence, 'skipped');
    }
    return; // Немедленный выход для команд
  }

  try {
    Logger.debug(env, 'Profanity analysis: starting background processing', { op: 'profanity' });

    // Create AI provider and profanity analyzer
    const providerStart = Date.now();
    const aiProvider = ProviderFactory.createProvider(env, 'profanity');
    const profanityAnalyzer = new ProfanityAnalyzer(aiProvider);
    timings.providerCreation = Date.now() - providerStart;

    // Analyze message for profanity
    const analysisStart = Date.now();
    const profanityResult = await profanityAnalyzer.analyzeMessage(msg.text, env);
    timings.analysis = Date.now() - analysisStart;

    // If profanity was found, update counters
    if (profanityResult.totalCount > 0) {
      Logger.log('Profanity detection: words found, processing for counter update', { op: 'profanityFound' });

      // Group by the normalized word form that appeared in the message.
      const groupingStart = Date.now();
      const wordCounts = new Map<string, number>();
      for (const word of profanityResult.words) {
        const currentCount = wordCounts.get(word.word) || 0;
        wordCounts.set(word.word, currentCount + word.positions.length);
      }

      // Convert to array format expected by Counters DO
      const words = Array.from(wordCounts.entries()).map(([word, count]) => ({
        word,
        count
      }));
      timings.wordGrouping = Date.now() - groupingStart;

      // Update profanity counters
      const counterUpdateStart = Date.now();
      const id = env.COUNTERS_DO.idFromName(String(chatId));
      const response = await env.COUNTERS_DO.get(id).fetch('https://do/profanity', {
        method: 'POST',
        body: JSON.stringify({
          chatId,
          userId,
          username,
          day,
          count: profanityResult.totalCount,
          words,
          sequence,
          messageId: msg.message_id,
        }),
      });
      timings.counterUpdate = Date.now() - counterUpdateStart;

      if (!response.ok) {
        const responseText = await response.text().catch(() => 'Unable to read response');
        throw new Error(`Counter update failed with status: ${response.status}, response: ${responseText}`);
      }
      // Success: no PII logging
    } else {
      if (sequence !== undefined) {
        await ackProgress(env, chatId, day, 'profanity', msg.message_id, sequence, 'zero');
      }
    }
  } catch {
    if (sequence !== undefined) {
      await ackProgress(env, chatId, day, 'profanity', msg.message_id, sequence, 'failed');
    }

    // Log error but don't throw - profanity analysis failures shouldn't break message processing
    Logger.error('Profanity analysis: background processing failed', {
      op: 'profanity',
      errorClass: 'Error',
      errorCode: 'PROFANITY_FAILED',
    });
  }
}

function determineBackgroundErrorPhase(timings: Record<string, number>): string {
  if (timings.counterUpdate) return 'counter-update';
  if (timings.wordGrouping) return 'word-grouping';
  if (timings.analysis) return 'analysis';
  if (timings.providerCreation) return 'provider-creation';
  return 'initialization';
}

async function analyzeCriminalCodeAsync(
  msg: any,
  env: Env,
  chatId: number,
  userId: number,
  username: string,
  day: string,
  sequence?: number
): Promise<void> {
  Logger.log('CRIMINAL CODE ANALYSIS FUNCTION STARTED', { op: 'criminalStart' });

  const startTime = Date.now();

  // КРИТИЧЕСКАЯ ПРОВЕРКА: команды НЕ должны попадать сюда!
  if (msg.text?.startsWith('/')) {
    Logger.error('CRITICAL: Command reached criminal code analysis - this should never happen!', {
      op: 'criminalCommand',
      errorClass: 'Error',
    });
    if (sequence !== undefined) {
      await ackProgress(env, chatId, day, 'criminal', msg.message_id, sequence, 'skipped');
    }
    return; // Немедленный выход для команд
  }

  try {
    const analyzerId = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(String(chatId));
    const analyzer = env.CRIMINAL_CODE_ANALYZER_DO.get(analyzerId);

    // Enqueue contextual analysis. The Durable Object owns batching, rate gates,
    // context building, persistence, and admin-only reporting.
    const analysisStart = Date.now();
    const response = await analyzer.fetch('https://do/enqueue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: msg.text,
        chatId,
        userId,
        messageId: msg.message_id,
        username,
        day,
        ts: msg.date,
        sequence,
        enqueueOnly: true
      })
    });
    const analysisTime = Date.now() - analysisStart;

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read response');
      throw new Error(`Criminal code analysis failed with status: ${response.status}, response: ${errorText}`);
    }
    // queued vs not queued is handled inside DO with privacy-safe logs; no additional PII here
  } catch {
    if (sequence !== undefined) {
      await ackProgress(env, chatId, day, 'criminal', msg.message_id, sequence, 'failed');
    }

    // Log error but don't throw - criminal code analysis failures shouldn't break message processing
    Logger.error('Criminal code analysis: background processing failed', {
      op: 'criminalEnqueue',
      errorClass: 'Error',
      errorCode: 'CRIMINAL_ENQUEUE_FAILED',
    });
  }
}

export async function handleUpdate(msg: any, env: Env) {
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const ts = msg.date;
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  const command = parseActivityCommand(msg.text);
  if (command.name === '/summary_last') {
    const n = parseInt(msg.text.split(' ')[1] || '100', 10);
    const count = Math.min(n, MAX_LAST_MESSAGES);
    await summariseChatMessages(env, chatId, count);
  } else if (command.name === '/summary') {
    const d = parseInt(msg.text.split(' ')[1] || '1');
    await summariseChat(env, chatId, d);
  } else if (command.name === '/top') {
    const n = parseInt(msg.text.split(' ')[1] || '5');
    await topChat(env, chatId, n, day);
  } else if (command.name === '/talkers' || command.name === '/top_talkers') {
    const requestedCount = parseInt(command.args[0] || '', 10);
    const hasCount = Number.isFinite(requestedCount);
    const count = hasCount ? Math.min(Math.max(requestedCount, 1), 20) : 10;
    const periodArgs = hasCount ? command.args.slice(1) : command.args;
    await topTalkers(
      env,
      chatId,
      count,
      periodArgs.length > 0 ? periodArgs : ['week'],
    );
  } else if (command.name === '/profanity_top') {
    const requestedCount = parseInt(command.args[0] || '', 10);
    const hasCount = Number.isFinite(requestedCount);
    const count = hasCount ? Math.min(Math.max(requestedCount, 1), 20) : 10;
    const period = hasCount ? command.args[1] : command.args[0];
    await profanityTopUsers(env, chatId, count,
      ['today', 'week', 'month'].includes(period) ? period : 'today');
  } else if (command.name === '/profanity_words') {
    const requestedCount = parseInt(command.args[0] || '', 10);
    const hasCount = Number.isFinite(requestedCount);
    const count = hasCount ? Math.min(Math.max(requestedCount, 1), 20) : 10;
    const period = hasCount ? command.args[1] : command.args[0];
    await profanityWordsStats(env, chatId, count,
      ['today', 'week', 'month'].includes(period) ? period : 'today');
  } else if (command.name === '/my_profanity') {
    const parts = msg.text.split(/\s+/);
    const period = ['today', 'week', 'month'].includes(parts[1]) ? parts[1] : undefined;
    const userId = msg.from?.id || 0;
    await myProfanityStats(env, chatId, userId, period);
  } else if (command.name === '/profanity_chart_week') {
    await profanityChart(env, chatId, 'week');
  } else if (command.name === '/profanity_chart_month') {
    await profanityChart(env, chatId, 'month');
  } else if (command.name === '/profanity_rate' || command.name === '/profanity_rate_chart') {
    const requestedCount = parseInt(command.args[0] || '', 10);
    const hasCount = Number.isFinite(requestedCount);
    const count = hasCount ? Math.min(Math.max(requestedCount, 1), 20) : 10;
    const period = hasCount ? command.args[1] : command.args[0];
    await profanityRateChart(
      env,
      chatId,
      count,
      ['today', 'week', 'month'].includes(period) ? period : 'week',
    );
  } else if (command.name === '/profanity_reset') {
    await resetProfanityCounters(env, chatId);
    await sendMessage(env, chatId, 'Счетчики матерной лексики сброшены');
  } else if (command.name === '/reset') {
    await resetCounters(env, chatId);
    await sendMessage(env, chatId, 'Counters reset');
  } else if (command.name === '/activity_week') {
    await activityChart(env, chatId, ['week']);
    await activityByUser(env, chatId, ['week']);
  } else if (command.name === '/activity_month') {
    await activityChart(env, chatId, ['month']);
    await activityByUser(env, chatId, ['month']);
  } else if (command.name === '/activity_users_week') {
    await activityByUser(env, chatId, ['week']);
  } else if (command.name === '/activity_users_month') {
    await activityByUser(env, chatId, ['month']);
  } else if (command.name === '/activity_hours') {
    await activityHours(env, chatId, command.args.length > 0 ? command.args : ['week']);
  } else if (command.name === '/activity') {
    const sub = command.args[0] || 'chart';
    const periodArgs = command.args.slice(1);
    if (sub === 'users') {
      await activityByUser(env, chatId, periodArgs.length > 0 ? periodArgs : ['week']);
    } else if (sub === 'hours') {
      await activityHours(env, chatId, periodArgs.length > 0 ? periodArgs : ['week']);
    } else {
      const args = sub === 'chart' ? periodArgs : command.args;
      await activityChart(env, chatId, args.length > 0 ? args : ['week']);
    }
  } else if (command.name === '/test_race_conditions') {
    // Only allow admins to run race condition tests
    const userId = msg.from?.id || 0;
    const isAdmin = userId === parseInt(env.ADMIN_USER_ID || '0'); // Add ADMIN_USER_ID to env

    if (!isAdmin) {
      await sendMessage(env, chatId, 'Эта команда доступна только администраторам');
      return;
    }

    await sendMessage(env, chatId, 'Запуск тестов защиты от race conditions...');

    try {
      const { runAllRaceConditionTests } = await import('../core/tests/race-condition-tests');
      const testResults = await runAllRaceConditionTests(env, chatId);

      const summary = testResults.map(result =>
        `${result.success ? '✅' : '❌'} ${result.testName}: ${result.messagesAdded}/${result.expectedMessages} сообщений, ${result.duplicatesDetected} дубликатов, ${result.errors.length} ошибок`
      ).join('\n');

      const overallSuccess = testResults.every(r => r.success);
      const totalDuration = testResults.reduce((sum, r) => sum + r.duration, 0);

      await sendMessage(env, chatId,
        `Результаты тестов race conditions:\n\n${summary}\n\n` +
        `${overallSuccess ? '✅ Все тесты пройдены' : '❌ Есть проблемы'}\n` +
        `Общее время: ${totalDuration}ms`
      );
    } catch (error: any) {
      await sendMessage(env, chatId, `Ошибка при выполнении тестов: ${error.message}`);
    }
  } else if (command.name === '/criminal_stats') {
    const args = msg.text.split(' ');
    const period = args[1] || 'today';
    await criminalCodeStats(env, chatId, period);
  } else if (command.name === '/my_criminal') {
    const args = msg.text.split(' ');
    const period = args[1];
    const userId = msg.from?.id || 0;
    await myCriminalStats(env, chatId, userId, period);
  } else if (command.name === '/criminal_top') {
    const args = msg.text.split(' ');
    const count = parseInt(args[1]) || 5;
    const period = args[2] || 'today';
    await criminalTopUsers(env, chatId, count, period);
  } else if (command.name === '/criminal_backfill') {
    await handleCriminalBackfillCommand(env, msg, command.args);
  } else if (command.name === '/criminal_reset') {
    await resetCriminalCounters(env, chatId);
    await sendMessage(env, chatId, 'Счетчики нарушений УК РФ сброшены');
  } else if (command.name === '/auto_notifications') {
    await handleAutoNotificationsCommand(env, msg);
  } else if (command.name === '/help') {
    await sendMessage(env, chatId, buildHelpText(env));
  }
  // Note: Background analysis (profanity and criminal code) is handled in recordMessage function
}

async function handleCriminalBackfillCommand(env: Env, msg: any, args: string[]): Promise<void> {
  const userId = msg.from?.id || 0;
  const adminId = parseInt(env.ADMIN_USER_ID || '0', 10);
  const isPrivateChat = msg.chat?.type === 'private';
  if ((adminId && userId !== adminId) || (!adminId && !isPrivateChat)) {
    await sendMessage(env, msg.chat.id, 'Эта команда доступна только администратору или в личке с ботом');
    return;
  }

  const chatId = msg.chat.id;
  const now = Math.floor(Date.now() / 1000);
  const requested = args[0] || 'today';
  const numericLimit = parseInt(requested, 10);
  const maxMessages = Math.min(Math.max(Number.isFinite(numericLimit) ? numericLimit : 100, 1), 250);
  const rangeStart = getCriminalBackfillRangeStart(requested, now);

  const { fetchMessagesOptimized } = await import('../features/history/history-optimized');
  const messages = await fetchMessagesOptimized(env, chatId, rangeStart, now);
  const candidates = messages
    .filter(message => Boolean(message.text) && !message.text!.startsWith('/'))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, maxMessages)
    .reverse();

  if (candidates.length === 0) {
    await sendMessage(env, chatId, 'Не нашел сохраненных текстовых сообщений для replay');
    return;
  }

  const analyzerId = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(String(chatId));
  const analyzer = env.CRIMINAL_CODE_ANALYZER_DO.get(analyzerId);
  let queued = 0;
  let skipped = 0;

  for (const message of candidates) {
    const response = await analyzer.fetch('https://do/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message.text,
        chatId,
        userId: message.user,
        messageId: message.messageId,
        username: message.username,
        day: new Date(message.ts * 1000).toISOString().slice(0, 10),
        ts: message.ts,
        enqueueOnly: true,
      }),
    });

    if (!response.ok) {
      skipped++;
      continue;
    }

    const result: any = await response.json().catch(() => null);
    if (result?.queued) {
      queued++;
    } else {
      skipped++;
    }
  }

  await sendMessage(
    env,
    chatId,
    [
      'Criminal backfill запущен',
      `Кандидатов: ${candidates.length}`,
      `Поставлено в очередь: ${queued}`,
      `Пропущено: ${skipped}`,
      'Результаты появятся после обработки очереди; cap сейчас ограничивает до 250 анализов в день.',
    ].join('\n')
  );
}

function getCriminalBackfillRangeStart(requested: string, now: number): number {
  if (requested === 'week') {
    return now - 7 * DAY;
  }
  if (requested === 'month') {
    return now - 30 * DAY;
  }
  return now - DAY;
}

async function canEditAutoNotifications(env: Env, chatId: number, userId: string): Promise<boolean> {
  if (chatId > 0) {
    return true;
  }

  const numericUserId = Number(userId);
  if (!Number.isFinite(numericUserId)) {
    return false;
  }

  return await isTelegramUserChatAdmin(env, chatId, numericUserId);
}

/**
 * Обработчик команды управления автоматическими уведомлениями
 */
async function handleAutoNotificationsCommand(env: Env, msg: any) {
  const chatId = msg.chat.id;
  const userId = msg.from?.id?.toString() || '0';
  const args = msg.text.split(/\s+/).slice(1); // Убираем /auto_notifications
  const subcommand = args[0] || 'status';

  try {
    // Создаем экземпляры сервисов
    const notificationRepository = new NotificationRepository(env);
    const notificationService = new NotificationService(env, notificationRepository);

    // Проверяем права пользователя
    const settingsPermission = await notificationService.canUserModifySettings(userId, chatId.toString());
    const canModify = settingsPermission && await canEditAutoNotifications(env, chatId, userId);

    switch (subcommand.toLowerCase()) {
      case 'status':
        await handleNotificationStatus(env, notificationService, chatId);
        break;

      case 'enable':
        if (!canModify) {
          await sendMessage(env, chatId, '❌ У вас нет прав для изменения настроек уведомлений');
          return;
        }
        await handleNotificationEnable(env, notificationService, chatId, userId, args[1]);
        break;

      case 'disable':
        if (!canModify) {
          await sendMessage(env, chatId, '❌ У вас нет прав для изменения настроек уведомлений');
          return;
        }
        await handleNotificationDisable(env, notificationService, chatId, userId, args[1]);
        break;

      case 'schedule':
        if (!canModify) {
          await sendMessage(env, chatId, '❌ У вас нет прав для изменения настроек уведомлений');
          return;
        }
        await handleNotificationSchedule(env, notificationService, chatId, userId, args[1]);
        break;

      case 'stats':
        await handleNotificationStats(env, notificationService, chatId, args[1] as NotificationType);
        break;

      case 'types':
        await handleNotificationTypes(env, notificationService, chatId);
        break;

      default:
        await sendMessage(env, chatId,
          `❓ Неизвестная подкоманда: ${subcommand}\n\n` +
          'Доступные команды:\n' +
          '• /auto_notifications status – показать настройки\n' +
          '• /auto_notifications enable [type] – включить уведомления\n' +
          '• /auto_notifications disable [type] – отключить уведомления\n' +
          '• /auto_notifications schedule [type] – настроить расписание\n' +
          '• /auto_notifications stats [type] – статистика\n' +
          '• /auto_notifications types – список типов уведомлений'
        );
    }

  } catch (error: any) {
    Logger.error('Failed to handle auto_notifications command', {
      chatId,
      userId,
      subcommand,
      error: error.message || String(error)
    });
    await sendMessage(env, chatId, `❌ Ошибка при выполнении команды: ${error.message}`);
  }
}

/**
 * Показать статус настроек уведомлений
 */
async function handleNotificationStatus(env: Env, service: NotificationService, chatId: number) {
  const settings = await service.getChatSettings(chatId.toString());

  if (!settings) {
    await sendMessage(env, chatId,
      '📋 *Автоматические уведомления*\n\n' +
      '❌ Уведомления не настроены для этого чата\n\n' +
      'Используйте `/auto_notifications enable` для включения'
    );
    return;
  }

  const enabledTypes = Object.entries(settings.notifications)
    .filter(([_, config]) => config.enabled)
    .map(([type, config]) => `• ${getNotificationTypeDisplayName(type as NotificationType)}: ${config.frequency}`)
    .join('\n');

  const disabledTypes = Object.entries(settings.notifications)
    .filter(([_, config]) => !config.enabled)
    .map(([type, _]) => `• ${getNotificationTypeDisplayName(type as NotificationType)}`)
    .join('\n');

  let message = `📋 *Автоматические уведомления*\n\n`;
  message += `🔧 Общий статус: ${settings.enabled ? '✅ Включены' : '❌ Отключены'}\n`;
  message += `👤 Последнее изменение: ${settings.updatedBy}\n`;
  message += `📅 Обновлено: ${settings.updatedAt.toLocaleString('ru-RU')}\n\n`;

  if (enabledTypes) {
    message += `✅ *Включенные уведомления:*\n${enabledTypes}\n\n`;
  }

  if (disabledTypes) {
    message += `❌ *Отключенные уведомления:*\n${disabledTypes}\n\n`;
  }

  if (settings.quietHours?.enabled) {
    message += `🔇 *Тихие часы:* ${settings.quietHours.startTime.hour}:${settings.quietHours.startTime.minute.toString().padStart(2, '0')} - ${settings.quietHours.endTime.hour}:${settings.quietHours.endTime.minute.toString().padStart(2, '0')}\n\n`;
  }

  message += `🛡️ Только админы: ${settings.adminOnly ? 'Да' : 'Нет'}`;

  await sendMessage(env, chatId, message);
}

/**
 * Включить уведомления
 */
async function handleNotificationEnable(env: Env, service: NotificationService, chatId: number, userId: string, type?: string) {
  if (type) {
    // Включаем конкретный тип уведомлений
    const availableTypes = service.getAvailableNotificationTypes();
    if (!availableTypes.includes(type as NotificationType)) {
      await sendMessage(env, chatId,
        `❌ Неизвестный тип уведомлений: ${type}\n\n` +
        `Доступные типы: ${availableTypes.map(t => getNotificationTypeDisplayName(t)).join(', ')}`
      );
      return;
    }

    await service.enableNotification(chatId.toString(), type as NotificationType, userId);
    await sendMessage(env, chatId,
      `✅ Уведомления "${getNotificationTypeDisplayName(type as NotificationType)}" включены`
    );
  } else {
    // Включаем все уведомления
    await service.updateChatSettings(chatId.toString(), { enabled: true }, userId);
    await sendMessage(env, chatId, '✅ Автоматические уведомления включены для чата');
  }
}

/**
 * Отключить уведомления
 */
async function handleNotificationDisable(env: Env, service: NotificationService, chatId: number, userId: string, type?: string) {
  if (type) {
    // Отключаем конкретный тип уведомлений
    const availableTypes = service.getAvailableNotificationTypes();
    if (!availableTypes.includes(type as NotificationType)) {
      await sendMessage(env, chatId,
        `❌ Неизвестный тип уведомлений: ${type}\n\n` +
        `Доступные типы: ${availableTypes.map(t => getNotificationTypeDisplayName(t)).join(', ')}`
      );
      return;
    }

    await service.disableNotification(chatId.toString(), type as NotificationType, userId);
    await sendMessage(env, chatId,
      `❌ Уведомления "${getNotificationTypeDisplayName(type as NotificationType)}" отключены`
    );
  } else {
    // Отключаем все уведомления
    await service.updateChatSettings(chatId.toString(), { enabled: false }, userId);
    await sendMessage(env, chatId, '❌ Автоматические уведомления отключены для чата');
  }
}

/**
 * Настроить расписание уведомлений
 */
async function handleNotificationSchedule(env: Env, service: NotificationService, chatId: number, userId: string, type?: string) {
  if (!type) {
    await sendMessage(env, chatId,
      '❓ Укажите тип уведомлений для настройки расписания\n\n' +
      'Пример: `/auto_notifications schedule daily_summary`'
    );
    return;
  }

  const availableTypes = service.getAvailableNotificationTypes();
  if (!availableTypes.includes(type as NotificationType)) {
    await sendMessage(env, chatId,
      `❌ Неизвестный тип уведомлений: ${type}\n\n` +
      `Доступные типы: ${availableTypes.map(t => getNotificationTypeDisplayName(t)).join(', ')}`
    );
    return;
  }

  // Пока что показываем текущие настройки
  const settings = await service.getChatSettings(chatId.toString());
  if (!settings) {
    await sendMessage(env, chatId, '❌ Сначала включите уведомления командой `/auto_notifications enable`');
    return;
  }

  const typeSettings = settings.notifications[type as NotificationType];
  let message = `⚙️ *Настройки "${getNotificationTypeDisplayName(type as NotificationType)}"*\n\n`;
  message += `📊 Статус: ${typeSettings.enabled ? '✅ Включено' : '❌ Отключено'}\n`;
  message += `⏰ Частота: ${getFrequencyDisplayName(typeSettings.frequency)}\n`;

  if (typeSettings.time) {
    message += `🕐 Время: ${typeSettings.time.hour}:${typeSettings.time.minute.toString().padStart(2, '0')}\n`;
  }

  if (typeSettings.threshold) {
    message += `📈 Порог: ${typeSettings.threshold}\n`;
  }

  message += `📋 Детали: ${typeSettings.includeDetails ? 'Включены' : 'Отключены'}\n`;
  message += `📊 Макс. элементов: ${typeSettings.maxItemsInReport}\n\n`;
  message += `💡 Для изменения настроек обратитесь к администратору`;

  await sendMessage(env, chatId, message);
}

/**
 * Показать статистику уведомлений
 */
async function handleNotificationStats(env: Env, service: NotificationService, chatId: number, type?: NotificationType) {
  if (!type) {
    // Показываем общую статистику по всем типам
    const availableTypes = service.getAvailableNotificationTypes();
    let message = '📊 *Статистика уведомлений*\n\n';

    for (const notificationType of availableTypes) {
      const stats = await service.getNotificationStats(chatId.toString(), notificationType);
      const successRate = (stats.successRate * 100).toFixed(1);

      message += `📋 *${getNotificationTypeDisplayName(notificationType)}*\n`;
      message += `• Отправлено: ${stats.totalSent}\n`;
      message += `• Успешность: ${successRate}%\n`;

      if (stats.lastSentAt) {
        message += `• Последнее: ${stats.lastSentAt.toLocaleString('ru-RU')}\n`;
      }

      message += '\n';
    }

    await sendMessage(env, chatId, message);
  } else {
    // Показываем детальную статистику по конкретному типу
    const stats = await service.getNotificationStats(chatId.toString(), type);
    const successRate = (stats.successRate * 100).toFixed(1);

    let message = `📊 *Статистика "${getNotificationTypeDisplayName(type)}"*\n\n`;
    message += `📤 Всего отправлено: ${stats.totalSent}\n`;
    message += `✅ Успешность: ${successRate}%\n`;
    message += `❌ Ошибок: ${stats.failureCount}\n`;
    message += `⏱️ Среднее время отклика: ${stats.averageResponseTime}мс\n`;

    if (stats.lastSentAt) {
      message += `📅 Последняя отправка: ${stats.lastSentAt.toLocaleString('ru-RU')}\n`;
    }

    if (stats.lastFailureReason) {
      message += `⚠️ Последняя ошибка: ${stats.lastFailureReason}\n`;
    }

    await sendMessage(env, chatId, message);
  }
}

/**
 * Показать доступные типы уведомлений
 */
async function handleNotificationTypes(env: Env, service: NotificationService, chatId: number) {
  const availableTypes = service.getAvailableNotificationTypes();

  let message = '📋 *Доступные типы уведомлений:*\n\n';

  for (const type of availableTypes) {
    const template = service.getNotificationTemplate(type);
    message += `📌 *${getNotificationTypeDisplayName(type)}*\n`;
    if (template) {
      message += `   ${template.description}\n`;
      message += `   Частота по умолчанию: ${getFrequencyDisplayName(template.defaultFrequency)}\n`;
    }
    message += '\n';
  }

  message += '💡 Используйте `/auto_notifications enable <тип>` для включения конкретного типа';

  await sendMessage(env, chatId, message);
}

/**
 * Получить отображаемое название типа уведомления
 */
function getNotificationTypeDisplayName(type: NotificationType): string {
  const names: Record<NotificationType, string> = {
    'criminal_reports': '🚨 Криминальные репорты',
    'profanity_reports': '🤬 Отчеты о мате',
    'activity_summary': '📈 Сводка активности',
    'daily_summary': '📋 Ежедневная сводка',
    'weekly_summary': '📊 Еженедельная сводка',
    'monthly_summary': '📈 Месячная сводка'
  };
  return names[type] || type;
}

/**
 * Получить отображаемое название частоты
 */
function getFrequencyDisplayName(frequency: string): string {
  const names: Record<string, string> = {
    'instant': '⚡ Мгновенно',
    'daily': '📅 Ежедневно',
    'weekly': '📊 Еженедельно',
    'monthly': '📈 Ежемесячно'
  };
  return names[frequency] || frequency;
}
