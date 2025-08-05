import {
  Env,
  DAY,
  TELEGRAM_LIMIT,
  LOG_ID_RADIX,
  DEFAULT_SUMMARY_CHUNK_SIZE,
} from "./env";
import { fetchMessages, fetchLastMessages } from "./history";
import { chunkText, truncateText } from "./utils";
import { sendMessage } from "./telegram";
import { ProviderFactory } from "./providers/provider-factory";
import { ProviderInitializer } from "./providers/provider-init";
import { SummaryOptions, TelegramMessage, SummaryRequest, ProviderError } from "./providers/ai-provider";
import { Logger, PerformanceTracker } from "./logger";

function filterContentMessages(messages: TelegramMessage[]): TelegramMessage[] {
  return messages.filter(msg => {
    const text = msg.text.toLowerCase().trim();

    // Игнорируем команды бота
    if (text.startsWith('/')) {
      return false;
    }

    // Игнорируем упоминания ботов
    if (text.includes('@stat_history_bot') || text.includes('@bot')) {
      return false;
    }

    // Игнорируем очень короткие сообщения (вероятно, реакции), но только если они меньше 2 символов
    if (text.length < 2) {
      return false;
    }

    // Игнорируем сообщения только с эмодзи или символами
    if (!/[а-яёa-z]/i.test(text)) {
      return false;
    }

    return true;
  });
}

function buildAiOptions(env: Env): SummaryOptions {
  const provider = (env as any).SUMMARY_PROVIDER || 'cloudflare';

  let opts: SummaryOptions;

  switch (provider) {
    case 'cloudflare':
      opts = {
        maxTokens: (env as any).CLOUDFLARE_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 400,
        temperature: (env as any).CLOUDFLARE_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
        topP: (env as any).CLOUDFLARE_TOP_P ?? env.SUMMARY_TOP_P ?? 0.95,
      };
      const cloudflareFreqPenalty = (env as any).CLOUDFLARE_FREQUENCY_PENALTY ?? env.SUMMARY_FREQUENCY_PENALTY;
      if (cloudflareFreqPenalty !== undefined) {
        opts.frequencyPenalty = cloudflareFreqPenalty;
      }
      const cloudflareSeed = (env as any).CLOUDFLARE_SEED ?? env.SUMMARY_SEED;
      if (cloudflareSeed !== undefined) {
        opts.seed = cloudflareSeed;
      }
      break;

    case 'openai':
      opts = {
        maxTokens: (env as any).OPENAI_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 500,
        temperature: (env as any).OPENAI_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
        topP: (env as any).OPENAI_TOP_P ?? env.SUMMARY_TOP_P ?? 0.9,
      };
      const openaiFreqPenalty = (env as any).OPENAI_FREQUENCY_PENALTY ?? env.SUMMARY_FREQUENCY_PENALTY;
      if (openaiFreqPenalty !== undefined) {
        opts.frequencyPenalty = openaiFreqPenalty;
      }
      const openaiSeed = (env as any).OPENAI_SEED ?? env.SUMMARY_SEED;
      if (openaiSeed !== undefined) {
        opts.seed = openaiSeed;
      }
      break;

    case 'openai-premium':
      opts = {
        maxTokens: (env as any).OPENAI_PREMIUM_MAX_TOKENS ?? env.SUMMARY_MAX_TOKENS ?? 600,
        temperature: (env as any).OPENAI_PREMIUM_TEMPERATURE ?? env.SUMMARY_TEMPERATURE ?? 0.0,
        topP: (env as any).OPENAI_PREMIUM_TOP_P ?? env.SUMMARY_TOP_P ?? 0.85,
      };
      const premiumFreqPenalty = (env as any).OPENAI_PREMIUM_FREQUENCY_PENALTY ?? env.SUMMARY_FREQUENCY_PENALTY;
      if (premiumFreqPenalty !== undefined) {
        opts.frequencyPenalty = premiumFreqPenalty;
      }
      const premiumSeed = (env as any).OPENAI_PREMIUM_SEED ?? env.SUMMARY_SEED;
      if (premiumSeed !== undefined) {
        opts.seed = premiumSeed;
      }
      break;

    default:
      // Fallback to old behavior for backward compatibility
      opts = {
        maxTokens: env.SUMMARY_MAX_TOKENS ?? 300,
        temperature: env.SUMMARY_TEMPERATURE ?? 0.0,
        topP: env.SUMMARY_TOP_P ?? 0.9,
      };
      if (env.SUMMARY_FREQUENCY_PENALTY !== undefined) {
        opts.frequencyPenalty = env.SUMMARY_FREQUENCY_PENALTY;
      }
      if (env.SUMMARY_SEED !== undefined) {
        opts.seed = env.SUMMARY_SEED;
      }
  }

  return opts;
}

function createSummaryRequest(messages: TelegramMessage[], env: Env, limitNote: string, chatId?: number, start?: number, end?: number): SummaryRequest {
  // Собираем информацию для замены плейсхолдеров
  const participants = [...new Set(messages.map(m => m.username))];
  const startDate = start ? new Date(start * 1000).toLocaleDateString('ru-RU') : 'неизвестно';
  const endDate = end ? new Date(end * 1000).toLocaleDateString('ru-RU') : 'неизвестно';
  const chatTitle = chatId ? `Чат ${chatId.toString(LOG_ID_RADIX)}` : 'Неизвестный чат';

  // Создаем детальную информацию об участниках
  const participantStats = participants.map(username => {
    const messageCount = messages.filter(m => m.username === username).length;
    return { username, messageCount };
  }).sort((a, b) => b.messageCount - a.messageCount);

  const participantsInfo = participantStats.length > 0
    ? `${participantStats.length} чел. (${participantStats.map(p => `${p.username}: ${p.messageCount}`).join(', ')})`
    : 'нет данных';

  // Создаем информацию о периоде
  let periodInfo = '';
  if (start && end) {
    const startDateTime = new Date(start * 1000);
    const endDateTime = new Date(end * 1000);
    const duration = Math.ceil((end - start) / DAY);
    periodInfo = `${startDate} - ${endDate} (${duration} дн.)`;
  } else if (messages.length > 0) {
    // Для случая summariseChatMessages используем временные метки сообщений
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];
    const firstDate = new Date(firstMsg.ts * 1000).toLocaleDateString('ru-RU');
    const lastDate = new Date(lastMsg.ts * 1000).toLocaleDateString('ru-RU');
    const duration = Math.ceil((lastMsg.ts - firstMsg.ts) / DAY);
    periodInfo = `${firstDate} - ${lastDate}${duration > 0 ? ` (${duration} дн.)` : ' (в тот же день)'}`;
  } else {
    periodInfo = 'неизвестно';
  }

  // Заменяем плейсхолдеры в промпте
  let userPrompt = env.SUMMARY_PROMPT;
  userPrompt = userPrompt.replace('{chatTitle}', chatTitle);
  userPrompt = userPrompt.replace('{startDate}', startDate);
  userPrompt = userPrompt.replace('{endDate}', endDate);
  userPrompt = userPrompt.replace('{totalMessages}', messages.length.toString());
  userPrompt = userPrompt.replace('{participants}', participantsInfo);
  userPrompt = userPrompt.replace('{period}', periodInfo);
  userPrompt = userPrompt.replace('{messages}', ''); // Сообщения добавляются отдельно провайдером

  return {
    messages,
    systemPrompt: env.SUMMARY_SYSTEM,
    userPrompt,
    limitNote,
  };
}

export async function summariseChat(env: Env, chatId: number, days: number) {
  const trackerId = PerformanceTracker.start('summariseChat', chatId.toString(LOG_ID_RADIX), { days });
  let allMessages: any[] = [];
  let messages: any[] = [];
  
  Logger.debug(env, "summariseChat started", {
    chat: chatId.toString(LOG_ID_RADIX),
    days,
    model: env.SUMMARY_MODEL,
    providerInitialized: ProviderInitializer.isProviderInitialized(),
    trackerId
  });

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * DAY;
  Logger.debug(env, "summariseChat time range", {
    chat: chatId.toString(LOG_ID_RADIX),
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
  });

  try {
    // Fetch messages with performance tracking
    const fetchStartTime = Date.now();
    allMessages = await fetchMessages(env, chatId, start, end);
    const fetchDuration = Date.now() - fetchStartTime;
    
    messages = filterContentMessages(allMessages);
    
    Logger.debug(env, "summariseChat messages fetched and filtered", {
      chat: chatId.toString(LOG_ID_RADIX),
      totalCount: allMessages.length,
      filteredCount: messages.length,
      removedCount: allMessages.length - messages.length,
      fetchDuration
    });

    // Log API request pattern for message fetching
    Logger.logApiRequestPattern(env, 'fetchMessages', {
      requestCount: allMessages.length,
      duration: fetchDuration,
      successRate: 100, // We got results, so consider it successful
      chatId: chatId.toString(LOG_ID_RADIX)
    });

    // Log performance insight for message fetching
    Logger.logPerformanceInsight(env, 'summariseChat', {
      duration: fetchDuration,
      itemsProcessed: allMessages.length,
      chatId: chatId.toString(LOG_ID_RADIX),
      stage: 'message_fetch'
    });

    if (!messages.length) {
      Logger.debug(env, "summariseChat no messages after filtering", {
        chat: chatId.toString(LOG_ID_RADIX),
        originalCount: allMessages.length
      });
      
      const metrics = PerformanceTracker.end(trackerId, { 
        result: 'no_messages', 
        totalMessages: allMessages.length,
        filteredMessages: 0 
      });
      
      if (allMessages.length > 0) {
        await sendMessage(env, chatId, "В данном периоде содержательных обсуждений не было, только команды бота и системные сообщения.");
      } else {
        await sendMessage(env, chatId, "Нет сообщений");
      }
      return;
    }

    // Get initialized provider instance
    const provider = ProviderInitializer.getProvider(env);
    const providerInfo = provider.getProviderInfo();

    Logger.debug(env, "summarize start", {
      chat: chatId.toString(LOG_ID_RADIX),
      days,
      provider: providerInfo.name,
      model: providerInfo.model,
      count: messages.length,
      firstMessageTime:
        messages.length > 0
          ? new Date(messages[0].ts * 1000).toISOString()
          : null,
      lastMessageTime:
        messages.length > 0
          ? new Date(messages[messages.length - 1].ts * 1000).toISOString()
          : null,
    });

    const limitNote = `Ответ не длиннее ${TELEGRAM_LIMIT} символов.`;
    const chunkSize = env.SUMMARY_CHUNK_SIZE ?? DEFAULT_SUMMARY_CHUNK_SIZE;

    // Convert messages to TelegramMessage format for chunking
    const content = messages.map((m) => `${m.username}: ${m.text}`).join('\n');
    const parts = chunkText(content, chunkSize);

    // Debug: log sample messages to understand what's being sent to AI
    Logger.debug(env, "summarize messages sample", {
      chat: chatId.toString(LOG_ID_RADIX),
      totalMessages: messages.length,
      sampleMessages: messages.slice(0, 5).map(m => ({
        username: m.username,
        text: m.text.substring(0, 100),
        textLength: m.text.length
      })),
      contentPreview: content.substring(0, 500)
    });

    Logger.debug(env, "summarize chunks", {
      chat: chatId.toString(LOG_ID_RADIX),
      chunkSize,
      chunks: parts.length,
    });

    const summaryOptions = buildAiOptions(env);

    async function summariseMessages(messagesToSummarize: TelegramMessage[], stage: string): Promise<string> {
      const aiStartTime = Date.now();
      
      Logger.debug(env, "summarize AI request", {
        chat: chatId.toString(LOG_ID_RADIX),
        stage,
        provider: providerInfo.name,
        model: providerInfo.model,
        messageCount: messagesToSummarize.length,
      });

      try {
        const request = createSummaryRequest(messagesToSummarize, env, limitNote, chatId, start, end);
        const resp = await provider.summarize(request, summaryOptions, env);
        const aiDuration = Date.now() - aiStartTime;

        Logger.debug(env, "summarize AI response received", {
          chat: chatId.toString(LOG_ID_RADIX),
          stage,
          provider: providerInfo.name,
          responseLength: resp.length,
          aiDuration
        });

        // Log AI request pattern
        Logger.logApiRequestPattern(env, `AI_${stage}`, {
          requestCount: 1,
          duration: aiDuration,
          successRate: 100,
          chatId: chatId.toString(LOG_ID_RADIX)
        });

        // Log AI performance insight
        Logger.logPerformanceInsight(env, 'summariseChat', {
          duration: aiDuration,
          itemsProcessed: messagesToSummarize.length,
          chatId: chatId.toString(LOG_ID_RADIX),
          stage: `ai_${stage}`,
          insights: aiDuration > 10000 ? ['SLOW_AI_RESPONSE'] : []
        });

        return truncateText(resp, TELEGRAM_LIMIT);
      } catch (error) {
        const aiDuration = Date.now() - aiStartTime;
        const e = error as Error;
        
        Logger.error("summarize AI error", {
          chat: chatId.toString(LOG_ID_RADIX),
          stage,
          provider: providerInfo.name,
          error: e.message || String(e),
          stack: e.stack,
          aiDuration
        });

        // Log failed AI request pattern
        Logger.logApiRequestPattern(env, `AI_${stage}_FAILED`, {
          requestCount: 1,
          duration: aiDuration,
          successRate: 0,
          errorTypes: [e.constructor.name],
          chatId: chatId.toString(LOG_ID_RADIX)
        });

        throw error;
      }
    }

    // Helper function to convert text chunks back to TelegramMessage format for provider
    function createMessagesFromText(text: string): TelegramMessage[] {
      const lines = text.split('\n');
      return lines.map((line, index) => {
        const colonIndex = line.indexOf(': ');
        if (colonIndex > 0) {
          return {
            username: line.substring(0, colonIndex),
            text: line.substring(colonIndex + 2),
            ts: Math.floor(Date.now() / 1000) + index, // Use current time with offset for ordering
          };
        } else {
          return {
            username: 'unknown',
            text: line,
            ts: Math.floor(Date.now() / 1000) + index,
          };
        }
      });
    }

    let summary = "";
    const summaryStartTime = Date.now();
    
    try {
      if (parts.length > 1) {
        const partials = [] as string[];
        for (let i = 0; i < parts.length; i++) {
          const partMessages = createMessagesFromText(parts[i]);
          partials.push(
            await summariseMessages(partMessages, `part-${i + 1}/${parts.length}`),
          );
        }
        // Create final summary from partial summaries
        const finalMessages = createMessagesFromText(partials.join("\n"));
        summary = await summariseMessages(finalMessages, "final");
      } else {
        summary = await summariseMessages(messages, "single");
      }
      
      const summaryDuration = Date.now() - summaryStartTime;
      
      // Log overall summary performance
      Logger.logPerformanceInsight(env, 'summariseChat', {
        duration: summaryDuration,
        itemsProcessed: messages.length,
        chatId: chatId.toString(LOG_ID_RADIX),
        stage: 'ai_summary_complete',
        insights: [
          parts.length > 1 ? 'MULTI_PART_SUMMARY' : 'SINGLE_PART_SUMMARY',
          `${parts.length}_CHUNKS`
        ]
      });
      
    } catch (error) {
      const e = error as Error;
      Logger.error("summarize error", {
        chat: chatId.toString(LOG_ID_RADIX),
        provider: providerInfo.name,
        model: providerInfo.model,
        providerVersion: providerInfo.version,
        providerInitialized: ProviderInitializer.isProviderInitialized(),
        error: e.message || String(e),
        errorType: e.constructor.name,
        isProviderError: error instanceof ProviderError,
      });

      // Provide more specific error messages based on error type
      let userMessage = "Ошибка при создании сводки. Пожалуйста, попробуйте позже.";
      
      if (error instanceof ProviderError) {
        // Provider-specific errors
        if (e.message.includes('rate limit') || e.message.includes('Too many requests')) {
          userMessage = "Превышен лимит запросов к AI сервису. Попробуйте через несколько минут.";
        } else if (e.message.includes('timeout')) {
          userMessage = "Превышено время ожидания ответа от AI сервиса. Попробуйте сократить период или количество сообщений.";
        }
      } else if (e.message.includes('API request limits exceeded')) {
        // Our custom API limit error from batch processing
        userMessage = e.message; // Use the specific message we crafted
      } else if (e.message.includes('Critical failures occurred')) {
        // Our custom critical failure error
        userMessage = "Произошли критические ошибки при получении сообщений. Попробуйте позже или сократите период.";
      }

      await sendMessage(env, chatId, userMessage);
      return;
    }

    Logger.debug(env, "summarize done", {
      chat: chatId.toString(LOG_ID_RADIX),
      length: summary.length,
    });

    // Save to database
    if (env.DB) {
      try {
        Logger.debug(env, "summarize DB insert start", {
          chat: chatId.toString(LOG_ID_RADIX),
        });

        await env.DB.prepare(
          'INSERT INTO summaries (chat_id, period_start, period_end, summary) VALUES (?, ?, ?, ?)',
        )
          .bind(
            chatId,
            new Date(start * 1000).toISOString(),
            new Date(end * 1000).toISOString(),
            summary,
          )
          .run();

        Logger.debug(env, "summarize DB insert done", {
          chat: chatId.toString(LOG_ID_RADIX),
        });
      } catch (error) {
        const e = error as Error;
        Logger.error("summarize DB insert error", {
          chat: chatId.toString(LOG_ID_RADIX),
          error: e.message || String(e),
          stack: e.stack,
        });
        // Продолжаем выполнение, чтобы отправить сообщение пользователю
      }
    } else {
      Logger.debug(env, "summarize DB not available", {
        chat: chatId.toString(LOG_ID_RADIX),
      });
    }

    // Send message to user
    try {
      Logger.debug(env, "summarize sending message", {
        chat: chatId.toString(LOG_ID_RADIX),
        summaryLength: summary.length,
      });
      await sendMessage(env, chatId, summary);
      Logger.debug(env, "summarize message sent", {
        chat: chatId.toString(LOG_ID_RADIX),
      });
      
      // Track successful completion
      const finalMetrics = PerformanceTracker.end(trackerId, { 
        result: 'success',
        totalMessages: allMessages.length,
        filteredMessages: messages.length,
        summaryLength: summary.length,
        chunks: parts.length
      });
      
      // Log overall function performance insight
      if (finalMetrics && finalMetrics.duration !== undefined) {
        Logger.logPerformanceInsight(env, 'summariseChat', {
          duration: finalMetrics.duration,
          itemsProcessed: messages.length,
          chatId: chatId.toString(LOG_ID_RADIX),
          stage: 'complete',
          insights: [
            `${days}_DAYS`,
            `${parts.length}_CHUNKS`,
            finalMetrics.duration > 30000 ? 'SLOW_OVERALL' : 'NORMAL_SPEED'
          ]
        });
      }
      
    } catch (error) {
      const e = error as Error;
      Logger.error("summarize send message error", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: e.message || String(e),
        stack: e.stack,
      });
      throw error; // Пробрасываем ошибку для обработки во внешнем блоке
    }
  } catch (error) {
    // Обработка всех необработанных ошибок с улучшенными сообщениями
    const e = error as Error;
    Logger.error("summariseChat unhandled error", {
      chat: chatId.toString(LOG_ID_RADIX),
      providerInitialized: ProviderInitializer.isProviderInitialized(),
      error: e.message || String(e),
      errorType: e.constructor.name,
      stack: e.stack,
    });

    // Provide more specific error messages for unhandled errors
    let userMessage = "Произошла непредвиденная ошибка при создании сводки.";
    
    if (e.message.includes('API request limits exceeded')) {
      userMessage = e.message; // Use our specific API limit message
    } else if (e.message.includes('Critical failures occurred')) {
      userMessage = "Произошли критические ошибки при получении сообщений. Попробуйте позже или сократите период.";
    } else if (e.message.includes('timeout') || e.message.includes('TIMEOUT')) {
      userMessage = "Превышено время ожидания. Попробуйте сократить период или количество дней.";
    } else if (e.message.includes('Too many') || e.message.includes('rate limit')) {
      userMessage = "Превышен лимит запросов. Попробуйте через несколько минут.";
    }

    try {
      await sendMessage(env, chatId, userMessage);
    } catch (sendError) {
      const se = sendError as Error;
      Logger.error("summariseChat error notification failed", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: se.message || String(se),
        originalError: e.message,
      });
      
      // Fallback: try to send a simple error message
      try {
        await sendMessage(env, chatId, "Ошибка сервиса. Попробуйте позже.");
      } catch (fallbackError) {
        Logger.error("summariseChat fallback error notification also failed", {
          chat: chatId.toString(LOG_ID_RADIX),
          error: (fallbackError as Error).message,
        });
      }
    }
  } finally {
    // Cleanup any remaining performance trackers
    PerformanceTracker.cleanup();
  }
}

export async function summariseChatMessages(
  env: Env,
  chatId: number,
  count: number,
) {
  const trackerId = PerformanceTracker.start('summariseChatMessages', chatId.toString(LOG_ID_RADIX), { count });
  let allMessages: any[] = [];
  let messages: any[] = [];
  
  Logger.debug(env, 'summariseChatMessages started', {
    chat: chatId.toString(LOG_ID_RADIX),
    count,
    model: env.SUMMARY_MODEL,
    providerInitialized: ProviderInitializer.isProviderInitialized(),
    trackerId
  });
  try {
    // Fetch messages with performance tracking
    const fetchStartTime = Date.now();
    allMessages = await fetchLastMessages(env, chatId, count);
    const fetchDuration = Date.now() - fetchStartTime;
    
    messages = filterContentMessages(allMessages);

    Logger.debug(env, 'summariseChatMessages messages fetched and filtered', {
      chat: chatId.toString(LOG_ID_RADIX),
      totalCount: allMessages.length,
      filteredCount: messages.length,
      removedCount: allMessages.length - messages.length,
      fetchDuration
    });

    // Log API request pattern for message fetching
    Logger.logApiRequestPattern(env, 'fetchLastMessages', {
      requestCount: allMessages.length,
      duration: fetchDuration,
      successRate: 100, // We got results, so consider it successful
      chatId: chatId.toString(LOG_ID_RADIX)
    });

    // Log performance insight for message fetching
    Logger.logPerformanceInsight(env, 'summariseChatMessages', {
      duration: fetchDuration,
      itemsProcessed: allMessages.length,
      chatId: chatId.toString(LOG_ID_RADIX),
      stage: 'message_fetch'
    });

    if (!messages.length) {
      Logger.debug(env, 'summariseChatMessages no messages after filtering', {
        chat: chatId.toString(LOG_ID_RADIX),
        originalCount: allMessages.length
      });
      
      const metrics = PerformanceTracker.end(trackerId, { 
        result: 'no_messages', 
        totalMessages: allMessages.length,
        filteredMessages: 0 
      });
      
      if (allMessages.length > 0) {
        await sendMessage(env, chatId, 'В данном периоде были только команды бота, содержательных сообщений не найдено.');
      } else {
        await sendMessage(env, chatId, 'Нет сообщений');
      }
      return;
    }

    // Get initialized provider instance
    const provider = ProviderInitializer.getProvider(env);
    const providerInfo = provider.getProviderInfo();

    Logger.debug(env, 'summariseChatMessages summarize start', {
      chat: chatId.toString(LOG_ID_RADIX),
      provider: providerInfo.name,
      model: providerInfo.model,
      count: messages.length,
      firstMessageTime: new Date(messages[0].ts * 1000).toISOString(),
      lastMessageTime: new Date(
        messages[messages.length - 1].ts * 1000,
      ).toISOString(),
    });

    const limitNote = `Ответ не длиннее ${TELEGRAM_LIMIT} символов.`;
    const summaryOptions = buildAiOptions(env);
    let summary: string;

    // Debug: log sample messages to understand what's being sent to AI
    Logger.debug(env, "summariseChatMessages messages sample", {
      chat: chatId.toString(LOG_ID_RADIX),
      totalMessages: messages.length,
      sampleMessages: messages.slice(0, 5).map(m => ({
        username: m.username,
        text: m.text.substring(0, 100),
        textLength: m.text.length
      }))
    });

    const aiStartTime = Date.now();
    
    Logger.debug(env, 'summariseChatMessages AI request', {
      chat: chatId.toString(LOG_ID_RADIX),
      provider: providerInfo.name,
      model: providerInfo.model,
      messageCount: messages.length,
    });

    try {
      const request = createSummaryRequest(messages, env, limitNote, chatId);
      const aiResp = await provider.summarize(request, summaryOptions, env);
      summary = truncateText(aiResp, TELEGRAM_LIMIT);
      const aiDuration = Date.now() - aiStartTime;

      Logger.debug(env, 'summariseChatMessages AI response received', {
        chat: chatId.toString(LOG_ID_RADIX),
        provider: providerInfo.name,
        responseLength: summary.length,
        aiDuration
      });

      // Log AI request pattern
      Logger.logApiRequestPattern(env, 'AI_single', {
        requestCount: 1,
        duration: aiDuration,
        successRate: 100,
        chatId: chatId.toString(LOG_ID_RADIX)
      });

      // Log AI performance insight
      Logger.logPerformanceInsight(env, 'summariseChatMessages', {
        duration: aiDuration,
        itemsProcessed: messages.length,
        chatId: chatId.toString(LOG_ID_RADIX),
        stage: 'ai_single',
        insights: aiDuration > 10000 ? ['SLOW_AI_RESPONSE'] : []
      });
      
    } catch (error) {
      const aiDuration = Date.now() - aiStartTime;
      const e = error as Error;
      
      Logger.error('summariseChatMessages AI error', {
        chat: chatId.toString(LOG_ID_RADIX),
        provider: providerInfo.name,
        model: providerInfo.model,
        providerVersion: providerInfo.version,
        providerInitialized: ProviderInitializer.isProviderInitialized(),
        error: e.message || String(e),
        errorType: e.constructor.name,
        isProviderError: error instanceof ProviderError,
        stack: e.stack,
        aiDuration
      });

      // Log failed AI request pattern
      Logger.logApiRequestPattern(env, 'AI_single_FAILED', {
        requestCount: 1,
        duration: aiDuration,
        successRate: 0,
        errorTypes: [e.constructor.name],
        chatId: chatId.toString(LOG_ID_RADIX)
      });

      // Provide more specific error messages based on error type
      let userMessage = 'Ошибка при создании сводки. Пожалуйста, попробуйте позже.';
      
      if (error instanceof ProviderError) {
        // Provider-specific errors
        if (e.message.includes('rate limit') || e.message.includes('Too many requests')) {
          userMessage = 'Превышен лимит запросов к AI сервису. Попробуйте через несколько минут.';
        } else if (e.message.includes('timeout')) {
          userMessage = 'Превышено время ожидания ответа от AI сервиса. Попробуйте запросить меньше сообщений.';
        }
      } else if (e.message.includes('API request limits exceeded')) {
        // Our custom API limit error from batch processing
        userMessage = e.message; // Use the specific message we crafted
      } else if (e.message.includes('Critical failures occurred')) {
        // Our custom critical failure error
        userMessage = 'Произошли критические ошибки при получении сообщений. Попробуйте позже или запросите меньше сообщений.';
      }

      await sendMessage(env, chatId, userMessage);
      return;
    }

    if (env.DB) {
      try {
        await env.DB.prepare(
          'INSERT INTO summaries (chat_id, period_start, period_end, summary) VALUES (?, ?, ?, ?)',
        )
          .bind(
            chatId,
            new Date(messages[0].ts * 1000).toISOString(),
            new Date(messages[messages.length - 1].ts * 1000).toISOString(),
            summary,
          )
          .run();
      } catch (error) {
        const e = error as Error;
        Logger.error('summariseChatMessages DB insert error', {
          chat: chatId.toString(LOG_ID_RADIX),
          error: e.message || String(e),
          stack: e.stack,
        });
      }
    }

    await sendMessage(env, chatId, summary);
    
    // Track successful completion
    const finalMetrics = PerformanceTracker.end(trackerId, { 
      result: 'success',
      totalMessages: allMessages.length,
      filteredMessages: messages.length,
      summaryLength: summary.length
    });
    
    // Log overall function performance insight
    if (finalMetrics && finalMetrics.duration !== undefined) {
      Logger.logPerformanceInsight(env, 'summariseChatMessages', {
        duration: finalMetrics.duration,
        itemsProcessed: messages.length,
        chatId: chatId.toString(LOG_ID_RADIX),
        stage: 'complete',
        insights: [
          `${count}_MESSAGES_REQUESTED`,
          finalMetrics.duration > 15000 ? 'SLOW_OVERALL' : 'NORMAL_SPEED'
        ]
      });
    }
    
  } catch (error) {
    const e = error as Error;
    Logger.error('summariseChatMessages unhandled error', {
      chat: chatId.toString(LOG_ID_RADIX),
      providerInitialized: ProviderInitializer.isProviderInitialized(),
      error: e.message || String(e),
      errorType: e.constructor.name,
      stack: e.stack,
    });

    // Provide more specific error messages for unhandled errors
    let userMessage = 'Произошла непредвиденная ошибка при создании сводки.';
    
    if (e.message.includes('API request limits exceeded')) {
      userMessage = e.message; // Use our specific API limit message
    } else if (e.message.includes('Critical failures occurred')) {
      userMessage = 'Произошли критические ошибки при получении сообщений. Попробуйте позже или запросите меньше сообщений.';
    } else if (e.message.includes('timeout') || e.message.includes('TIMEOUT')) {
      userMessage = 'Превышено время ожидания. Попробуйте запросить меньше сообщений.';
    } else if (e.message.includes('Too many') || e.message.includes('rate limit')) {
      userMessage = 'Превышен лимит запросов. Попробуйте через несколько минут.';
    }

    try {
      await sendMessage(env, chatId, userMessage);
    } catch (sendError) {
      const se = sendError as Error;
      Logger.error('summariseChatMessages error notification failed', {
        chat: chatId.toString(LOG_ID_RADIX),
        error: se.message || String(se),
        originalError: e.message,
      });
      
      // Fallback: try to send a simple error message
      try {
        await sendMessage(env, chatId, 'Ошибка сервиса. Попробуйте позже.');
      } catch (fallbackError) {
        Logger.error('summariseChatMessages fallback error notification also failed', {
          chat: chatId.toString(LOG_ID_RADIX),
          error: (fallbackError as Error).message,
        });
      }
    }
  } finally {
    // Cleanup any remaining performance trackers
    PerformanceTracker.cleanup();
  }
}
