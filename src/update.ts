import { Env, DAY, MAX_LAST_MESSAGES } from './env';
import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { summariseChat, summariseChatMessages } from './summary';
import { topChat, resetCounters, activityChart, activityByUser, profanityTopUsers, profanityWordsStats, myProfanityStats, profanityChart, resetProfanityCounters, criminalCodeStats, criminalTopUsers, myCriminalStats, resetCriminalCounters } from './stats';
import { sendMessage } from './telegram';
import { Logger } from './logger';
import { ProfanityAnalyzer } from './profanity';
import { ProviderFactory } from './providers/provider-factory';
import { ViolationHandler } from './violation-handler';
import { NotificationService } from './services/notification-service';
import type { TelegramMessage } from './types';
import { NotificationRepository } from './repositories/notification-repository';
import type { NotificationType } from './models/notification-settings';



const HELP_TEXT = [
  '/summary <days> – сводка за последние N дней (по умолчанию 1)',
  '/summary_last <n> – сводка последних N сообщений (по умолчанию 1, макс 40)',
  '/top <n> – топ N активных пользователей за сегодня (по умолчанию 5)',
  '/profanity_top [n] [period] – топ N матершинников',
  '  Примеры: /profanity_top, /profanity_top 10, /profanity_top 5 week',
  '  n: 1-20 (по умолчанию 5), period: today|week|month (по умолчанию today)',
  '/profanity_words [n] [period] – топ N матерных слов',
  '  Примеры: /profanity_words, /profanity_words 15, /profanity_words 20 month',
  '  n: 1-20 (по умолчанию 10), period: today|week|month (по умолчанию today)',
  '/my_profanity [period] – ваша статистика мата',
  '  Примеры: /my_profanity, /my_profanity week, /my_profanity month',
  '  period: today|week|month (по умолчанию показывает все периоды)',
  '/profanity_chart_week – график мата за неделю',
  '/profanity_chart_month – график мата за месяц',
  '/profanity_reset – сбросить только счетчики мата для чата',
  '/criminal_stats [period] – статистика нарушений УК РФ',
  '  Примеры: /criminal_stats, /criminal_stats week, /criminal_stats month',
  '  period: today|week|month (по умолчанию today)',
  '/my_criminal [period] – ваша статистика нарушений УК РФ',
  '  Примеры: /my_criminal, /my_criminal week, /my_criminal month',
  '  period: today|week|month (по умолчанию показывает все периоды)',
  '/criminal_top [n] [period] – топ N нарушителей УК РФ',
  '  Примеры: /criminal_top, /criminal_top 10, /criminal_top 5 week',
  '  n: 1-20 (по умолчанию 5), period: today|week|month (по умолчанию today)',
  '/criminal_reset – сбросить только счетчики УК РФ для чата',
  '/auto_notifications – управление автоматическими уведомлениями',
  '  /auto_notifications status – показать текущие настройки',
  '  /auto_notifications enable [type] – включить уведомления (или конкретный тип)',
  '  /auto_notifications disable [type] – отключить уведомления (или конкретный тип)',
  '  /auto_notifications schedule [type] – настроить расписание для типа',
  '  /auto_notifications stats [type] – статистика отправленных уведомлений',

  '/reset – сбросить счетчики для чата',
  '/activity_week – график активности за неделю',
  '/activity_month – график активности за месяц',
  '/activity_users_week – активность по пользователям за неделю',
  '/activity_users_month – активность по пользователям за месяц',
  '/test_race_conditions – тест защиты от race conditions (только для админов)',
  '/help – показать список всех команд',
].join('\n');

export function getTextMessage(update: any) {
  const msg = update.message;
  if (!msg || !msg.text) return null;
  if (msg.from?.is_bot) return null;
  return msg;
}

/**
 * Detects if current environment should be treated as a test environment.
 * Used to disable background analyses that interfere with integration tests.
 */
export function isTestEnvironment(env: Env): boolean {
  // 12‑factor: behavior controlled by explicit config, not heuristics
  const flag = (env as any)?.DISABLE_BACKGROUND_ANALYSIS ?? (env as any)?.TEST_MODE;
  if (typeof flag === 'boolean') return flag;
  if (typeof flag === 'string') return flag.toLowerCase() === 'true' || flag === '1';
  return false;
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
  const chatId = msg.chat.id;
  const userId = msg.from?.id || 0;
  const username = msg.from?.username || `id${userId}`;
  const ts = msg.date;
  const stored = {
    chat: chatId,
    user: userId,
    username,
    text: msg.text,
    ts,
  };

  Logger.debug(env, 'recordMessage: saving message', {
    chatId,
    username,
    textLength: msg.text?.length || 0,
    timestamp: ts,
    messageId: msg.message_id
  });

  // Save to optimized daily block structure
  try {
    const { addMessageToDayBlock } = await import('./history-optimized');
    await addMessageToDayBlock(env, stored);
    Logger.debug(env, 'recordMessage: day block save successful', {
      chatId,
      date: new Date(ts * 1000).toISOString().slice(0, 10)
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    Logger.error('recordMessage: day block save failed', {
      chatId,
      error: errorMessage,
      stack: errorStack
    });

    // Fallback to individual message storage for reliability
    const key = `msg:${chatId}:${ts}:${msg.message_id}`;
    try {
      await env.HISTORY.put(key, JSON.stringify(stored), {
        expirationTtl: 7 * DAY,
      });
      Logger.debug(env, 'recordMessage: fallback individual save successful', { key });
    } catch (fallbackError: any) {
      const dayBlockErrorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('recordMessage: both storage methods failed', {
        key,
        dayBlockError: dayBlockErrorMessage,
        fallbackError: fallbackError.message || String(fallbackError)
      });
    }
  }

  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  const id = env.COUNTERS_DO.idFromName(String(chatId));

  try {
    const res = await env.COUNTERS_DO.get(id).fetch('https://do/inc', {
      method: 'POST',
      body: JSON.stringify({ chatId, userId, username, day }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '[no-body]');
      Logger.error('recordMessage: counter update returned non-OK status', {
        chatId,
        day,
        status: res.status,
        body: text,
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
        Logger.log('recordMessage: counter update successful (verified)', {
          chatId: chatId.toString(36),
          day,
          userDayCount: parsed.userDayCount,
          chatDayActivity: parsed.chatDayActivity,
          ok: parsed.ok,
        });
      } else {
        Logger.debug(env, 'recordMessage: counter update successful (legacy DO response)', {
          chatId: chatId.toString(36),
          day,
          response: rawText ?? 'ok',
        });
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Logger.error('recordMessage: counter update failed', {
      chatId,
      error: errorMessage
    });
  }

  // Schedule profanity analysis in background (fire-and-forget)
  // Only for text messages that are not commands
  // Skip background analyses during tests to avoid interference when running integration/unit tests
  if (isTestEnvironment(env)) {
    Logger.debug(env, 'Test environment detected: skipping background profanity/criminal analysis');
  } else {
    Logger.log('PROFANITY ANALYSIS CHECK', {
      hasText: !!msg.text,
      isCommand: msg.text?.startsWith('/'),
      chatId: chatId.toString(36)
    });

  if (msg.text && !msg.text.startsWith('/')) {
    Logger.log('STARTING PROFANITY ANALYSIS', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      messageId: msg.message_id,
      textLength: msg.text.length
    });

    Logger.debug(env, 'Scheduling profanity analysis for message', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      messageId: msg.message_id,
      textLength: msg.text.length
    });

    // Fire-and-forget: don't await this
    const profanityPromise = analyzeProfanityAsync(msg, env, chatId, userId, username, day).catch(error => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('Background profanity analysis failed', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        username,
        messageId: msg.message_id,
        error: errorMessage
      });
    });
    // Ensure background task isn't cut off when the request finishes
    if (ctx) {
      ctx.waitUntil(profanityPromise);
    } else {
      void profanityPromise;
    }
  } else {
    Logger.debug(env, 'Skipping profanity analysis', {
      chatId: chatId.toString(36),
      hasText: !!msg.text,
      reason: !msg.text ? 'no-text' : 'no-text'
    });
  }
  }

  // Schedule criminal code analysis in background (fire-and-forget)
  // Only for text messages that are not commands
  const hasText = !!msg.text;
  const isCommand = msg.text?.startsWith('/');
  
  if (!isTestEnvironment(env)) {
    Logger.debug(env, 'CRIMINAL CODE ANALYSIS CHECK', {
      hasText,
      isCommand,
      chatId: chatId.toString(36),
      textLength: msg.text?.length
    });

    Logger.debug(env, 'CONDITION EVALUATION', {
      hasText,
      notCommand: !isCommand,
      finalCondition: hasText && !isCommand
    });
  }

  if (!isTestEnvironment(env) && msg.text && !msg.text.startsWith('/')) {
    Logger.log('STARTING CRIMINAL CODE ANALYSIS', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      messageId: msg.message_id,
      textLength: msg.text.length
    });

    Logger.debug(env, 'Scheduling criminal code analysis for message', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      messageId: msg.message_id,
      textLength: msg.text.length
    });

    // Fire-and-forget: don't await this
    const criminalPromise = analyzeCriminalCodeAsync(msg, env, chatId, userId, username, day).catch(error => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('Background criminal code analysis failed', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        username,
        messageId: msg.message_id,
        error: errorMessage
      });
    });
    // Ensure background task isn't cut off when the request finishes
    if (ctx) {
      ctx.waitUntil(criminalPromise);
    } else {
      void criminalPromise;
    }
  } else {
    Logger.debug(env, 'Skipping criminal code analysis', {
      chatId: chatId.toString(36),
      hasText: !!msg.text,
      isCommand: msg.text?.startsWith('/'),
      reason: !msg.text ? 'no-text' : msg.text?.startsWith('/') ? 'is-command' : 'no-text'
    });
  }
}

async function analyzeProfanityAsync(
  msg: any,
  env: Env,
  chatId: number,
  userId: number,
  username: string,
  day: string
): Promise<void> {
  Logger.log('PROFANITY ANALYSIS FUNCTION STARTED', {
    chatId: chatId.toString(36),
    userId: userId.toString(36),
    username,
    day,
    textLength: msg.text?.length
  });

  const startTime = Date.now();
  const timings: Record<string, number> = {};

  // КРИТИЧЕСКАЯ ПРОВЕРКА: команды НЕ должны попадать сюда!
  if (msg.text?.startsWith('/')) {
    Logger.error('CRITICAL: Command reached profanity analysis - this should never happen!', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      command: msg.text,
      messageId: msg.message_id,
      day
    });
    return; // Немедленный выход для команд
  }

  try {
    Logger.debug(env, 'Profanity analysis: starting background processing with detailed tracking', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      textLength: msg.text?.length || 0,
      messageId: msg.message_id,
      timestamp: new Date().toISOString(),
      day,
      isCommand: msg.text?.startsWith('/'),
      fullText: msg.text // Временно для отладки
    });

    // Create AI provider and profanity analyzer
    const providerStart = Date.now();
    Logger.log('PROFANITY: Creating AI provider', {
      chatId: chatId.toString(36),
      textLength: msg.text?.length
    });
    // Use Cloudflare provider for background profanity analysis to avoid network calls in most setups
    let aiProvider;
    try {
      // Prefer Cloudflare if available; fall back to default factory
      aiProvider = ProviderFactory.createProviderWithValidation(env as any, 'cloudflare' as any);
    } catch {
      aiProvider = ProviderFactory.createProvider(env);
    }
    const profanityAnalyzer = new ProfanityAnalyzer(aiProvider);
    timings.providerCreation = Date.now() - providerStart;
    Logger.log('PROFANITY: AI provider created successfully', {
      chatId: chatId.toString(36),
      creationTime: timings.providerCreation
    });

    Logger.debug(env, 'Profanity analysis: provider and analyzer created', {
      chatId: chatId.toString(36),
      providerType: aiProvider.constructor.name,
      creationTime: timings.providerCreation
    });

    // Analyze message for profanity
    const analysisStart = Date.now();
    Logger.log('PROFANITY: Starting analysis', {
      chatId: chatId.toString(36)
    });
    const profanityResult = await profanityAnalyzer.analyzeMessage(msg.text, env);
    timings.analysis = Date.now() - analysisStart;
    Logger.log('PROFANITY: Analysis completed', {
      chatId: chatId.toString(36),
      analysisTime: timings.analysis,
      hasProfanity: profanityResult.totalCount > 0,
      totalCount: profanityResult.totalCount
    });

    Logger.debug(env, 'Profanity analysis: analysis phase completed', {
      chatId: chatId.toString(36),
      analysisTime: timings.analysis,
      wordsFound: profanityResult.totalCount,
      uniqueWords: profanityResult.words.length
    });

    // If profanity was found, update counters
    if (profanityResult.totalCount > 0) {
      Logger.log('Profanity detection: words found, processing for counter update', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        username,
        totalCount: profanityResult.totalCount,
        uniqueWords: profanityResult.words.length,
        analysisTime: timings.analysis
      });

      // Group words by base form and count occurrences
      const groupingStart = Date.now();
      const wordCounts = new Map<string, number>();
      for (const word of profanityResult.words) {
        const currentCount = wordCounts.get(word.baseForm) || 0;
        wordCounts.set(word.baseForm, currentCount + word.positions.length);
      }

      // Convert to array format expected by Counters DO
      const words = Array.from(wordCounts.entries()).map(([baseForm, count]) => ({
        baseForm,
        count
      }));
      timings.wordGrouping = Date.now() - groupingStart;

      Logger.debug(env, 'Profanity analysis: word grouping completed', {
        chatId: chatId.toString(36),
        groupingTime: timings.wordGrouping,
        originalWords: profanityResult.words.length,
        groupedWords: words.length,
        totalOccurrences: profanityResult.totalCount,
        words: words.map(w => ({ baseForm: w.baseForm.substring(0, 3) + '***', count: w.count }))
      });

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
          words
        }),
      });
      timings.counterUpdate = Date.now() - counterUpdateStart;

      if (response.ok) {
        const totalDuration = Date.now() - startTime;
        timings.total = totalDuration;

        Logger.log('Profanity counters: update successful with performance metrics', {
          chatId: chatId.toString(36),
          userId: userId.toString(36),
          totalCount: profanityResult.totalCount,
          uniqueWords: words.length,
          timings,
          performanceBreakdown: {
            analysis: (timings.analysis / totalDuration * 100).toFixed(1) + '%',
            wordProcessing: (timings.wordGrouping / totalDuration * 100).toFixed(1) + '%',
            counterUpdate: (timings.counterUpdate / totalDuration * 100).toFixed(1) + '%',
            overhead: ((totalDuration - timings.analysis - timings.wordGrouping - timings.counterUpdate) / totalDuration * 100).toFixed(1) + '%'
          }
        });
      } else {
        const responseText = await response.text().catch(() => 'Unable to read response');
        throw new Error(`Counter update failed with status: ${response.status}, response: ${responseText}`);
      }
    } else {
      const totalDuration = Date.now() - startTime;
      timings.total = totalDuration;

      Logger.debug(env, 'Profanity analysis: no profanity detected with timing details', {
        chatId: chatId.toString(36),
        userId: userId.toString(36),
        timings,
        textLength: msg.text?.length || 0,
        analysisEfficiency: timings.analysis < 100 ? 'excellent' : timings.analysis < 500 ? 'good' : 'slow'
      });
    }
  } catch (error: unknown) {
    const totalDuration = Date.now() - startTime;
    timings.total = totalDuration;

    // Log error but don't throw - profanity analysis failures shouldn't break message processing
    Logger.error('Profanity analysis: background processing failed with detailed context', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      messageId: msg.message_id,
      textLength: msg.text?.length || 0,
      timings,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      errorPhase: determineBackgroundErrorPhase(timings),
      partialResults: {
        providerCreated: !!timings.providerCreation,
        analysisStarted: !!timings.analysis,
        wordGroupingCompleted: !!timings.wordGrouping,
        counterUpdateAttempted: !!timings.counterUpdate
      }
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
  day: string
): Promise<void> {
  console.error('=== CRIMINAL CODE ANALYSIS FUNCTION STARTED ===', {
    chatId: chatId.toString(36),
    userId: userId.toString(36),
    username,
    day,
    textLength: msg.text?.length
  });

  const startTime = Date.now();

  Logger.log('CRIMINAL CODE ANALYSIS FUNCTION STARTED', {
    chatId: chatId.toString(36),
    userId: userId.toString(36),
    username,
    day,
    textLength: msg.text?.length
  });

  // КРИТИЧЕСКАЯ ПРОВЕРКА: команды НЕ должны попадать сюда!
  if (msg.text?.startsWith('/')) {
    Logger.error('CRITICAL: Command reached criminal code analysis - this should never happen!', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      command: msg.text,
      messageId: msg.message_id
    });
    return; // Немедленный выход для команд
  }

  try {
    Logger.debug(env, 'Criminal code analysis: starting background processing', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      textLength: msg.text?.length || 0,
      messageId: msg.message_id,
      timestamp: new Date().toISOString()
    });

    // Get CriminalCodeAnalyzerDO instance
    const analyzerStart = Date.now();
    const analyzerId = env.CRIMINAL_CODE_ANALYZER_DO.idFromName(String(chatId));
    const analyzer = env.CRIMINAL_CODE_ANALYZER_DO.get(analyzerId);
    const analyzerCreationTime = Date.now() - analyzerStart;

    Logger.debug(env, 'Criminal code analysis: analyzer instance created', {
      chatId: chatId.toString(36),
      creationTime: analyzerCreationTime
    });

    // Perform analysis
    const analysisStart = Date.now();
    const response = await analyzer.fetch('https://do/analyze', {
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
        day
      })
    });
    const analysisTime = Date.now() - analysisStart;

    if (response.ok) {
      const result: any = await response.json();
      const totalDuration = Date.now() - startTime;

      if (result.hasViolations) {
        Logger.log('Criminal code analysis: violations detected', {
          chatId: chatId.toString(36),
          userId: userId.toString(36),
          username,
          violationsCount: result.violations?.length || 0,
          riskLevel: result.riskLevel,
          confidence: result.confidence,
          timings: {
            analyzerCreation: analyzerCreationTime,
            analysis: analysisTime,
            total: totalDuration
          },
          articles: result.violations?.map((v: any) => v.article).join(', ') || 'unknown'
        });

        // Check notification settings before sending violation message
        try {
          const notificationRepository = new NotificationRepository(env);
          const notificationService = new NotificationService(env, notificationRepository);
          
          // Get notification settings for this chat
          const settings = await notificationService.getChatSettings(chatId.toString());
          
          // Only send if notifications are enabled and criminal reports are enabled
          if (settings && settings.enabled && settings.notifications.criminal_reports.enabled) {
            // Create violation handler compatible with both real and mocked implementations
            let violationHandler: any;
            if (typeof (ViolationHandler as any).createWithoutDI === 'function') {
              violationHandler = await (ViolationHandler as any).createWithoutDI(env);
            } else if (typeof (ViolationHandler as any) === 'function') {
              violationHandler = new (ViolationHandler as any)(env);
            } else {
              violationHandler = null;
            }

            const formattedMessage = violationHandler && typeof violationHandler.formatViolationMessage === 'function'
              ? await violationHandler.formatViolationMessage(
              result,
              userId.toString(),
              chatId.toString()
            )
              : '🚨 Обнаружено нарушение УК РФ';

            // Send the enhanced violation message to the chat
            await sendMessage(env, chatId, formattedMessage);

            Logger.debug(env, 'Enhanced violation message sent (notifications enabled)', {
              chatId: chatId.toString(36),
              messageLength: formattedMessage.length
            });
            
            // Record notification result
            await notificationRepository.recordNotificationResult(
              chatId.toString(),
              'criminal_reports',
              {
                success: true,
                messageId: 'instant',
                sentAt: new Date(),
                responseTime: Date.now() - startTime,
                retryAttempt: 0
              }
            );
          } else {
            Logger.debug(env, 'Criminal violation detected but notifications disabled', {
              chatId: chatId.toString(36),
              settingsEnabled: settings?.enabled || false,
              criminalReportsEnabled: settings?.notifications?.criminal_reports?.enabled || false
            });
          }
        } catch (formatError: any) {
          const formatErrorMessage = formatError instanceof Error ? formatError.message : String(formatError);
          Logger.error('Failed to check notification settings or send violation message', {
            chatId: chatId.toString(36),
            error: formatErrorMessage
          });
          // Continue without throwing - the analysis was successful even if notification failed
        }
      } else {
        Logger.debug(env, 'Criminal code analysis: no violations detected', {
          chatId: chatId.toString(36),
          userId: userId.toString(36),
          confidence: result.confidence,
          timings: {
            analyzerCreation: analyzerCreationTime,
            analysis: analysisTime,
            total: totalDuration
          }
        });
      }
    } else {
      const errorText = await response.text().catch(() => 'Unable to read response');
      throw new Error(`Criminal code analysis failed with status: ${response.status}, response: ${errorText}`);
    }
  } catch (error: unknown) {
    const totalDuration = Date.now() - startTime;

    // Log error but don't throw - criminal code analysis failures shouldn't break message processing
    Logger.error('Criminal code analysis: background processing failed', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      messageId: msg.message_id,
      textLength: msg.text?.length || 0,
      duration: totalDuration,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export async function handleUpdate(msg: any, env: Env) {
  if (!msg) return;
  const chatId = msg.chat.id;
  const ts = msg.date;
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  if (msg.text.startsWith('/summary_last')) {
    const n = parseInt(msg.text.split(' ')[1] || '1', 10);
    const count = Math.min(n, MAX_LAST_MESSAGES);
    await summariseChatMessages(env, chatId, count);
  } else if (msg.text.startsWith('/summary')) {
    const d = parseInt(msg.text.split(' ')[1] || '1');
    await summariseChat(env, chatId, d);
  } else if (msg.text.startsWith('/top')) {
    const n = parseInt(msg.text.split(' ')[1] || '5');
    await topChat(env, chatId, n, day);
  } else if (msg.text.startsWith('/profanity_top')) {
    const parts = msg.text.split(/\s+/);
    const count = Math.min(Math.max(parseInt(parts[1] || '10', 10), 1), 20);
    const period = ['today', 'week', 'month'].includes(parts[2]) ? parts[2] : 'today';
    await profanityTopUsers(env, chatId, count, period);
  } else if (msg.text.startsWith('/profanity_words')) {
    const parts = msg.text.split(/\s+/);
    const count = Math.min(Math.max(parseInt(parts[1] || '10', 10), 1), 20);
    const period = ['today', 'week', 'month'].includes(parts[2]) ? parts[2] : 'today';
    await profanityWordsStats(env, chatId, count, period);
  } else if (msg.text.startsWith('/my_profanity')) {
    const parts = msg.text.split(/\s+/);
    const period = ['today', 'week', 'month'].includes(parts[1]) ? parts[1] : undefined;
    const userId = msg.from?.id || 0;
    await myProfanityStats(env, chatId, userId, period);
  } else if (msg.text.startsWith('/profanity_chart_week')) {
    await profanityChart(env, chatId, 'week');
  } else if (msg.text.startsWith('/profanity_chart_month')) {
    await profanityChart(env, chatId, 'month');
  } else if (msg.text.startsWith('/profanity_reset')) {
    await resetProfanityCounters(env, chatId);
    await sendMessage(env, chatId, 'Счетчики матерной лексики сброшены');
  } else if (msg.text.startsWith('/reset')) {
    await resetCounters(env, chatId);
    await sendMessage(env, chatId, 'Counters reset');
  } else if (msg.text.startsWith('/activity_week')) {
    await activityChart(env, chatId, 'week');
    await activityByUser(env, chatId, 'week');
  } else if (msg.text.startsWith('/activity_month')) {
    await activityChart(env, chatId, 'month');
    await activityByUser(env, chatId, 'month');
  } else if (msg.text.startsWith('/activity_users_week')) {
    await activityByUser(env, chatId, 'week');
  } else if (msg.text.startsWith('/activity_users_month')) {
    await activityByUser(env, chatId, 'month');
  } else if (msg.text.startsWith('/activity')) {
    const parts = msg.text.split(/\s+/);
    const sub = parts[1] || 'week';
    if (sub === 'users') {
      const period = parts[2] === 'month' ? 'month' : 'week';
      await activityByUser(env, chatId, period);
    } else {
      const period = sub === 'month' ? 'month' : 'week';
      await activityChart(env, chatId, period);
    }
  } else if (msg.text.startsWith('/test_race_conditions')) {
    // Only allow admins to run race condition tests
    const userId = msg.from?.id || 0;
    const isAdmin = userId === parseInt(env.ADMIN_USER_ID || '0'); // Add ADMIN_USER_ID to env

    if (!isAdmin) {
      await sendMessage(env, chatId, 'Эта команда доступна только администраторам');
      return;
    }

    await sendMessage(env, chatId, 'Запуск тестов защиты от race conditions...');

    try {
      const { runAllRaceConditionTests } = await import('./race-condition-tests');
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await sendMessage(env, chatId, `Ошибка при выполнении тестов: ${errorMessage}`);
    }
  } else if (msg.text.startsWith('/criminal_stats')) {
    const args = msg.text.split(' ');
    const period = args[1] || 'today';
    await criminalCodeStats(env, chatId, period);
  } else if (msg.text.startsWith('/my_criminal')) {
    const args = msg.text.split(' ');
    const period = args[1];
    const userId = msg.from?.id || 0;
    await myCriminalStats(env, chatId, userId, period);
  } else if (msg.text.startsWith('/criminal_top')) {
    const args = msg.text.split(' ');
    const count = parseInt(args[1]) || 5;
    const period = args[2] || 'today';
    await criminalTopUsers(env, chatId, count, period);
  } else if (msg.text.startsWith('/criminal_reset')) {
    await resetCriminalCounters(env, chatId);
    await sendMessage(env, chatId, 'Счетчики нарушений УК РФ сброшены');
  } else if (msg.text.startsWith('/auto_notifications')) {
    await handleAutoNotificationsCommand(env, msg);
  } else if (msg.text.startsWith('/help')) {
    await sendMessage(env, chatId, HELP_TEXT);
  }
  // Note: Background analysis (profanity and criminal code) is handled in recordMessage function
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
    const canModify = await notificationService.canUserModifySettings(userId, chatId.toString());

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

  } catch (error: unknown) {
    Logger.error('Failed to handle auto_notifications command', {
      chatId,
      userId,
      subcommand,
      error: error instanceof Error ? error.message : String(error)
    });
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendMessage(env, chatId, `❌ Ошибка при выполнении команды: ${errorMessage}`);
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
