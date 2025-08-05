import { Env, DAY, MAX_LAST_MESSAGES } from './env';
import type { KVNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { summariseChat, summariseChatMessages } from './summary';
import { topChat, resetCounters, activityChart, activityByUser, profanityTopUsers, profanityWordsStats, myProfanityStats } from './stats';
import { sendMessage } from './telegram';
import { Logger } from './logger';
import { ProfanityAnalyzer } from './profanity';
import { ProviderFactory } from './providers/provider-factory';

function isTestEnvironment(env: Env): boolean {
  // Check if we're in a test environment by looking for test-specific values
  return env.TOKEN === 'test-token' || 
         env.OPENAI_API_KEY === 'test-openai-key' ||
         (typeof process !== 'undefined' && process.env.NODE_ENV === 'test');
}

const HELP_TEXT = [
  '/summary <days> – сводка за последние N дней (по умолчанию 1)',
  '/summary_last <n> – сводка последних N сообщений (по умолчанию 1, макс 40)',
  '/top <n> – топ N активных пользователей за сегодня (по умолчанию 5)',
  '/profanity_top <n> <period> – топ N матершинников (по умолчанию 5, today)',
  '/profanity_words <n> <period> – топ N матерных слов (по умолчанию 10, today)',
  '/my_profanity <period> – ваша статистика мата (опционально: today, week, month)',
  '/reset – сбросить счетчики для чата',
  '/activity_week – график активности за неделю',
  '/activity_month – график активности за месяц',
  '/activity_users_week – активность по пользователям за неделю',
  '/activity_users_month – активность по пользователям за месяц',
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
  const key = `msg:${chatId}:${ts}:${msg.message_id}`;
  
  Logger.debug(env, 'recordMessage: saving to KV', {
    key,
    chatId,
    username,
    textLength: msg.text?.length || 0,
    timestamp: ts,
    messageId: msg.message_id
  });
  
  try {
    await env.HISTORY.put(key, JSON.stringify(stored), {
      expirationTtl: 7 * DAY,
    });
    Logger.debug(env, 'recordMessage: KV save successful', { key });
  } catch (error: any) {
    Logger.error('recordMessage: KV save failed', {
      key,
      error: error.message || String(error),
      stack: error.stack
    });
  }
  
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  const id = env.COUNTERS_DO.idFromName(String(chatId));
  
  try {
    await env.COUNTERS_DO.get(id).fetch('https://do/inc', {
      method: 'POST',
      body: JSON.stringify({ chatId, userId, username, day }),
    });
    Logger.debug(env, 'recordMessage: counter update successful', { chatId, day });
  } catch (error: any) {
    Logger.error('recordMessage: counter update failed', {
      chatId,
      error: error.message || String(error)
    });
  }

  // Perform profanity analysis in background if message has text, ctx is available, and not in test mode
  if (msg.text && ctx && !isTestEnvironment(env)) {
    ctx.waitUntil(analyzeProfanityAsync(msg, env, chatId, userId, username, day));
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
  try {
    Logger.debug(env, 'Starting profanity analysis', {
      chatId,
      userId,
      textLength: msg.text?.length || 0
    });

    // Create AI provider and profanity analyzer
    const aiProvider = ProviderFactory.createProvider(env);
    const profanityAnalyzer = new ProfanityAnalyzer(aiProvider);
    
    // Analyze message for profanity
    const profanityResult = await profanityAnalyzer.analyzeMessage(msg.text, env);
    
    // If profanity was found, update counters
    if (profanityResult.totalCount > 0) {
      Logger.debug(env, 'Profanity detected, updating counters', {
        chatId,
        userId,
        totalCount: profanityResult.totalCount,
        wordsCount: profanityResult.words.length
      });

      // Group words by base form and count occurrences
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

      // Update profanity counters
      const id = env.COUNTERS_DO.idFromName(String(chatId));
      await env.COUNTERS_DO.get(id).fetch('https://do/profanity', {
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

      Logger.debug(env, 'Profanity counters updated successfully', {
        chatId,
        userId,
        totalCount: profanityResult.totalCount,
        uniqueWords: words.length
      });
    } else {
      Logger.debug(env, 'No profanity detected', { chatId, userId });
    }
  } catch (error: any) {
    // Log error but don't throw - profanity analysis failures shouldn't break message processing
    Logger.error('Profanity analysis failed', {
      chatId,
      userId,
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
    const count = parseInt(parts[1] || '5', 10);
    const period = parts[2] || 'today';
    await profanityTopUsers(env, chatId, count, period);
  } else if (msg.text.startsWith('/profanity_words')) {
    const parts = msg.text.split(/\s+/);
    const count = parseInt(parts[1] || '10', 10);
    const period = parts[2] || 'today';
    await profanityWordsStats(env, chatId, count, period);
  } else if (msg.text.startsWith('/my_profanity')) {
    const parts = msg.text.split(/\s+/);
    const period = parts[1]; // Optional period parameter
    const userId = msg.from?.id || 0;
    await myProfanityStats(env, chatId, userId, period);
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
  } else if (msg.text.startsWith('/help')) {
    await sendMessage(env, chatId, HELP_TEXT);
  }
}
