import { Env, DAY, MAX_LAST_MESSAGES } from './env';
import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { summariseChat, summariseChatMessages } from './summary';
import { topChat, resetCounters, activityChart, activityByUser, profanityTopUsers, profanityWordsStats, myProfanityStats, profanityChart, resetProfanityCounters, criminalCodeStats, criminalTopUsers, myCriminalStats, resetCriminalCounters } from './stats';
import { sendMessage } from './telegram';
import { Logger } from './logger';
import { ProfanityAnalyzer } from './profanity';
import { ProviderFactory } from './providers/provider-factory';

function isTestEnvironment(env: Env): boolean {
  // Check if we're in a test environment by looking for test-specific values
  return env.TOKEN === 'test_token' ||
    env.OPENAI_API_KEY === 'test-openai-key' ||
    (typeof process !== 'undefined' && process.env.NODE_ENV === 'test');
}

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
  } catch (error: any) {
    Logger.error('recordMessage: day block save failed', {
      chatId,
      error: error.message || String(error),
      stack: error.stack
    });
    
    // Fallback to individual message storage for reliability
    const key = `msg:${chatId}:${ts}:${msg.message_id}`;
    try {
      await env.HISTORY.put(key, JSON.stringify(stored), {
        expirationTtl: 7 * DAY,
      });
      Logger.debug(env, 'recordMessage: fallback individual save successful', { key });
    } catch (fallbackError: any) {
      Logger.error('recordMessage: both storage methods failed', {
        key,
        dayBlockError: error.message,
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
  } catch (error: any) {
    Logger.error('recordMessage: counter update failed', {
      chatId,
      error: error.message || String(error)
    });
  }

  // Schedule profanity analysis in background (fire-and-forget)
  // Only for text messages that are not commands and not in test environment
  Logger.log('PROFANITY ANALYSIS CHECK', {
    hasText: !!msg.text,
    isCommand: msg.text?.startsWith('/'),
    isTestEnv: isTestEnvironment(env),
    chatId: chatId.toString(36)
  });
  
  if (msg.text && !msg.text.startsWith('/') && !isTestEnvironment(env)) {
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
    Logger.error('Background profanity analysis failed', {
    chatId: chatId.toString(36),
    userId: userId.toString(36),
    username,
    messageId: msg.message_id,
    error: error.message || String(error)
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
      isTest: isTestEnvironment(env),
      reason: !msg.text ? 'no-text' : 'test-environment'
    });
  }

  // Schedule criminal code analysis in background (fire-and-forget)
    // Only for text messages that are not commands and not in test environment
    Logger.log('CRIMINAL CODE ANALYSIS CHECK', {
      hasText: !!msg.text,
      isCommand: msg.text?.startsWith('/'),
      isTestEnv: isTestEnvironment(env),
      chatId: chatId.toString(36)
    });
    
    if (msg.text && !msg.text.startsWith('/') && !isTestEnvironment(env)) {
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
    Logger.error('Background criminal code analysis failed', {
    chatId: chatId.toString(36),
    userId: userId.toString(36),
    username,
    messageId: msg.message_id,
    error: error.message || String(error)
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
      isTest: isTestEnvironment(env),
      reason: !msg.text ? 'no-text' : msg.text?.startsWith('/') ? 'is-command' : 'test-environment'
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
    const aiProvider = ProviderFactory.createProvider(env);
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
  } catch (error: any) {
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
      error: error.message || String(error),
      stack: error.stack,
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
  Logger.log('CRIMINAL CODE ANALYSIS FUNCTION STARTED', {
    chatId: chatId.toString(36),
    userId: userId.toString(36),
    username,
    day,
    textLength: msg.text?.length
  });
  
  const startTime = Date.now();

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
  } catch (error: any) {
    const totalDuration = Date.now() - startTime;

    // Log error but don't throw - criminal code analysis failures shouldn't break message processing
    Logger.error('Criminal code analysis: background processing failed', {
      chatId: chatId.toString(36),
      userId: userId.toString(36),
      username,
      messageId: msg.message_id,
      textLength: msg.text?.length || 0,
      duration: totalDuration,
      error: error.message || String(error),
      stack: error.stack
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
    } catch (error: any) {
      await sendMessage(env, chatId, `Ошибка при выполнении тестов: ${error.message}`);
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
  } else if (msg.text.startsWith('/help')) {
    await sendMessage(env, chatId, HELP_TEXT);
  }
}
