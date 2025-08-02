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

function createSummaryRequest(messages: TelegramMessage[], env: Env, limitNote: string): SummaryRequest {
  return {
    messages,
    systemPrompt: env.SUMMARY_SYSTEM,
    userPrompt: env.SUMMARY_PROMPT,
    limitNote,
  };
}

export async function summariseChat(env: Env, chatId: number, days: number) {
  console.debug("summariseChat started", {
    chat: chatId.toString(LOG_ID_RADIX),
    days,
    model: env.SUMMARY_MODEL,
    providerInitialized: ProviderInitializer.isProviderInitialized(),
  });

  const end = Math.floor(Date.now() / 1000);
  const start = end - days * DAY;
  console.debug("summariseChat time range", {
    chat: chatId.toString(LOG_ID_RADIX),
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
  });

  try {
    // Fetch messages
    const allMessages = await fetchMessages(env, chatId, start, end);
    const messages = filterContentMessages(allMessages);
    console.debug("summariseChat messages fetched and filtered", {
      chat: chatId.toString(LOG_ID_RADIX),
      totalCount: allMessages.length,
      filteredCount: messages.length,
    });

    if (!messages.length) {
      console.debug("summariseChat no content messages", {
        chat: chatId.toString(LOG_ID_RADIX),
        totalMessages: allMessages.length,
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

    console.debug("summarize start", {
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
    console.debug("summarize chunks", {
      chat: chatId.toString(LOG_ID_RADIX),
      chunkSize,
      chunks: parts.length,
    });

    const summaryOptions = buildAiOptions(env);

    async function summariseMessages(messagesToSummarize: TelegramMessage[], stage: string): Promise<string> {
      console.debug("summarize AI request", {
        chat: chatId.toString(LOG_ID_RADIX),
        stage,
        provider: providerInfo.name,
        model: providerInfo.model,
        messageCount: messagesToSummarize.length,
      });

      try {
        const request = createSummaryRequest(messagesToSummarize, env, limitNote);
        const resp = await provider.summarize(request, summaryOptions);

        console.debug("summarize AI response received", {
          chat: chatId.toString(LOG_ID_RADIX),
          stage,
          provider: providerInfo.name,
          responseLength: resp.length,
        });

        return truncateText(resp, TELEGRAM_LIMIT);
      } catch (error: any) {
        console.error("summarize AI error", {
          chat: chatId.toString(LOG_ID_RADIX),
          stage,
          provider: providerInfo.name,
          error: error.message || String(error),
          stack: error.stack,
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
    } catch (error: any) {
      console.error("summarize error", {
        chat: chatId.toString(LOG_ID_RADIX),
        provider: providerInfo.name,
        model: providerInfo.model,
        providerVersion: providerInfo.version,
        providerInitialized: ProviderInitializer.isProviderInitialized(),
        error: error.message || String(error),
        errorType: error.constructor.name,
        isProviderError: error instanceof ProviderError,
      });
      await sendMessage(
        env,
        chatId,
        "Ошибка при создании сводки. Пожалуйста, попробуйте позже.",
      );
      return;
    }

    console.debug("summarize done", {
      chat: chatId.toString(LOG_ID_RADIX),
      length: summary.length,
    });

    // Save to database
    if (env.DB) {
      try {
        console.debug("summarize DB insert start", {
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

        console.debug("summarize DB insert done", {
          chat: chatId.toString(LOG_ID_RADIX),
        });
      } catch (error) {
        console.error("summarize DB insert error", {
          chat: chatId.toString(LOG_ID_RADIX),
          error: error.message || String(error),
          stack: error.stack,
        });
        // Продолжаем выполнение, чтобы отправить сообщение пользователю
      }
    } else {
      console.debug("summarize DB not available", {
        chat: chatId.toString(LOG_ID_RADIX),
      });
    }

    // Send message to user
    try {
      console.debug("summarize sending message", {
        chat: chatId.toString(LOG_ID_RADIX),
        summaryLength: summary.length,
      });
      await sendMessage(env, chatId, summary);
      console.debug("summarize message sent", {
        chat: chatId.toString(LOG_ID_RADIX),
      });
    } catch (error) {
      console.error("summarize send message error", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: error.message || String(error),
        stack: error.stack,
      });
      throw error; // Пробрасываем ошибку для обработки во внешнем блоке
    }
  } catch (error) {
    // Обработка всех необработанных ошибок
    console.error("summariseChat unhandled error", {
      chat: chatId.toString(LOG_ID_RADIX),
      providerInitialized: ProviderInitializer.isProviderInitialized(),
      error: (error as any).message || String(error),
      errorType: (error as any).constructor.name,
      stack: (error as any).stack,
    });
    try {
      await sendMessage(
        env,
        chatId,
        "Произошла непредвиденная ошибка при создании сводки.",
      );
    } catch (sendError) {
      console.error("summariseChat error notification failed", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: sendError.message || String(sendError),
      });
    }
  } finally {
    console.debug("summariseChat finished", {
      chat: chatId.toString(LOG_ID_RADIX),
    });
  }
}

export async function summariseChatMessages(
  env: Env,
  chatId: number,
  count: number,
) {
  console.debug('summariseChatMessages started', {
    chat: chatId.toString(LOG_ID_RADIX),
    count,
    model: env.SUMMARY_MODEL,
    providerInitialized: ProviderInitializer.isProviderInitialized(),
  });
  try {
    const allMessages = await fetchLastMessages(env, chatId, count);
    const messages = filterContentMessages(allMessages);
    console.debug('summariseChatMessages messages fetched and filtered', {
      chat: chatId.toString(LOG_ID_RADIX),
      totalCount: allMessages.length,
      filteredCount: messages.length,
    });

    if (!messages.length) {
      console.debug('summariseChatMessages no content messages', {
        chat: chatId.toString(LOG_ID_RADIX),
        totalMessages: allMessages.length,
      });
      if (allMessages.length > 0) {
        await sendMessage(env, chatId, 'В данном периоде содержательных обсуждений не было, только команды бота и системные сообщения.');
      } else {
        await sendMessage(env, chatId, 'Нет сообщений');
      }
      return;
    }

    // Get initialized provider instance
    const provider = ProviderInitializer.getProvider(env);
    const providerInfo = provider.getProviderInfo();

    console.debug('summariseChatMessages summarize start', {
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

    console.debug('summariseChatMessages AI request', {
      chat: chatId.toString(LOG_ID_RADIX),
      provider: providerInfo.name,
      model: providerInfo.model,
      messageCount: messages.length,
    });

    try {
      const request = createSummaryRequest(messages, env, limitNote);
      const aiResp = await provider.summarize(request, summaryOptions);
      summary = truncateText(aiResp, TELEGRAM_LIMIT);

      console.debug('summariseChatMessages AI response received', {
        chat: chatId.toString(LOG_ID_RADIX),
        provider: providerInfo.name,
        responseLength: summary.length,
      });
    } catch (error) {
      console.error('summariseChatMessages AI error', {
        chat: chatId.toString(LOG_ID_RADIX),
        provider: providerInfo.name,
        model: providerInfo.model,
        providerVersion: providerInfo.version,
        providerInitialized: ProviderInitializer.isProviderInitialized(),
        error: (error as any).message || String(error),
        errorType: (error as any).constructor.name,
        isProviderError: error instanceof ProviderError,
        stack: (error as any).stack,
      });
      await sendMessage(
        env,
        chatId,
        'Ошибка при создании сводки. Пожалуйста, попробуйте позже.',
      );
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
        console.error('summariseChatMessages DB insert error', {
          chat: chatId.toString(LOG_ID_RADIX),
          error: (error as any).message || String(error),
          stack: (error as any).stack,
        });
      }
    }

    await sendMessage(env, chatId, summary);
  } catch (error) {
    console.error('summariseChatMessages unhandled error', {
      chat: chatId.toString(LOG_ID_RADIX),
      providerInitialized: ProviderInitializer.isProviderInitialized(),
      error: (error as any).message || String(error),
      errorType: (error as any).constructor.name,
      stack: (error as any).stack,
    });
    try {
      await sendMessage(
        env,
        chatId,
        'Произошла непредвиденная ошибка при создании сводки.',
      );
    } catch (sendError) {
      console.error('summariseChatMessages error notification failed', {
        chat: chatId.toString(LOG_ID_RADIX),
        error: (sendError as any).message || String(sendError),
      });
    }
  } finally {
    console.debug('summariseChatMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
    });
  }
}
