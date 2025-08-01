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

const MESSAGE_SEPARATOR = "=== СООБЩЕНИЯ ===";

interface AiBaseOptions {
  max_tokens: number;
  temperature: number;
  top_p: number;
  frequency_penalty?: number;
}

function buildAiOptions(env: Env): AiBaseOptions {
  const opts: AiBaseOptions = {
    max_tokens: env.SUMMARY_MAX_TOKENS ?? 300,
    temperature: env.SUMMARY_TEMPERATURE ?? 0.1,
    top_p: env.SUMMARY_TOP_P ?? 0.9,
  };
  if (env.SUMMARY_FREQUENCY_PENALTY !== undefined) {
    opts.frequency_penalty = env.SUMMARY_FREQUENCY_PENALTY;
  }
  return opts;
}

function buildChatMessages(env: Env, text: string, limitNote: string) {
  const system = env.SUMMARY_SYSTEM
    ? `${env.SUMMARY_SYSTEM}\n${limitNote}`
    : limitNote;
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `${env.SUMMARY_PROMPT}\n${MESSAGE_SEPARATOR}\n${text}`,
    },
  ];
}

export async function summariseChat(env: Env, chatId: number, days: number) {
  console.debug("summariseChat started", {
    chat: chatId.toString(LOG_ID_RADIX),
    days,
    model: env.SUMMARY_MODEL,
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
    const messages = await fetchMessages(env, chatId, start, end);
    console.debug("summariseChat messages fetched", {
      chat: chatId.toString(LOG_ID_RADIX),
      count: messages.length,
    });

    if (!messages.length) {
      console.debug("summariseChat no messages", {
        chat: chatId.toString(LOG_ID_RADIX),
      });
      await sendMessage(env, chatId, "Нет сообщений");
      return;
    }

    // Prepare content
    const content = messages.map((m) => `${m.username}: ${m.text}`).join('\n');
    console.debug("summarize start", {
      chat: chatId.toString(LOG_ID_RADIX),
      days,
      model: env.SUMMARY_MODEL,
      count: messages.length,
      contentLength: content.length,
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
    const parts = chunkText(content, chunkSize);
    console.debug("summarize chunks", {
      chat: chatId.toString(LOG_ID_RADIX),
      chunkSize,
      chunks: parts.length,
    });

    const baseOpts = buildAiOptions(env);

    async function summariseText(text: string, stage: string) {
      let resp: any;
      console.debug("summarize AI model", {
        chat: chatId.toString(LOG_ID_RADIX),
        stage,
        model: env.SUMMARY_MODEL,
        isChat: env.SUMMARY_MODEL.includes("chat"),
        promptLength: env.SUMMARY_PROMPT.length,
      });
      try {
        if (env.SUMMARY_MODEL.includes("chat")) {
          const msg = buildChatMessages(env, text, limitNote);
          console.debug("summarize AI request (chat)", {
            chat: chatId.toString(LOG_ID_RADIX),
            stage,
            messageCount: msg.length,
            systemContentLength: msg[0].content.length,
            userContentLength: msg[1].content.length,
          });
          const opts = { ...baseOpts, messages: msg };
          resp = await env.AI.run(env.SUMMARY_MODEL, opts);
        } else {
          const input = `${env.SUMMARY_PROMPT}\n${limitNote}\n${text}`;
          console.debug("summarize AI request (completion)", {
            chat: chatId.toString(LOG_ID_RADIX),
            stage,
            inputLength: input.length,
          });
          const opts = { ...baseOpts, prompt: input };
          resp = await env.AI.run(env.SUMMARY_MODEL, opts);
        }

        console.debug("summarize AI response received", {
          chat: chatId.toString(LOG_ID_RADIX),
          stage,
          responseType: typeof resp,
          hasResponse:
            resp && (resp.response !== undefined || typeof resp === "string"),
          responseLength: resp
            ? resp.response?.length ||
              (typeof resp === "string" ? resp.length : 0)
            : 0,
        });
        return truncateText(resp.response ?? resp, TELEGRAM_LIMIT);
      } catch (error: any) {
        console.error("summarize AI error", {
          chat: chatId.toString(LOG_ID_RADIX),
          stage,
          error: error.message || String(error),
          stack: error.stack,
        });
        throw error;
      }
    }

    let summary = "";
    try {
      if (parts.length > 1) {
        const partials = [] as string[];
        for (let i = 0; i < parts.length; i++) {
          partials.push(
            await summariseText(parts[i], `part-${i + 1}/${parts.length}`),
          );
        }
        summary = await summariseText(partials.join("\n"), "final");
      } else {
        summary = await summariseText(content, "single");
      }
    } catch {
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
        const err = error as Error;
        console.error("summarize DB insert error", {
          chat: chatId.toString(LOG_ID_RADIX),
          error: err.message || String(err),
          stack: err.stack,
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
      const err = error as Error;
      console.error("summarize send message error", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: err.message || String(err),
        stack: err.stack,
      });
      throw error; // Пробрасываем ошибку для обработки во внешнем блоке
    }
  } catch (error) {
    // Обработка всех необработанных ошибок
    const err = error as Error;
    console.error("summariseChat unhandled error", {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
    });
    try {
      await sendMessage(
        env,
        chatId,
        "Произошла непредвиденная ошибка при создании сводки.",
      );
    } catch (sendError) {
      const sendErr = sendError as Error;
      console.error("summariseChat error notification failed", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: sendErr.message || String(sendErr),
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
  });
  try {
    const messages = await fetchLastMessages(env, chatId, count);
    console.debug('summariseChatMessages messages fetched', {
      chat: chatId.toString(LOG_ID_RADIX),
      count: messages.length,
    });

    if (!messages.length) {
      console.debug('summariseChatMessages no messages', {
        chat: chatId.toString(LOG_ID_RADIX),
      });
      await sendMessage(env, chatId, 'Нет сообщений');
      return;
    }

    const content = messages.map((m) => `${m.username}: ${m.text}`).join('\n');
    console.debug('summariseChatMessages summarize start', {
      chat: chatId.toString(LOG_ID_RADIX),
      model: env.SUMMARY_MODEL,
      count: messages.length,
      contentLength: content.length,
      firstMessageTime: new Date(messages[0].ts * 1000).toISOString(),
      lastMessageTime: new Date(
        messages[messages.length - 1].ts * 1000,
      ).toISOString(),
    });

    const limitNote = `Ответ не длиннее ${TELEGRAM_LIMIT} символов.`;
    const baseOpts = buildAiOptions(env);
    let aiResp: any;

    console.debug('summariseChatMessages AI model', {
      chat: chatId.toString(LOG_ID_RADIX),
      model: env.SUMMARY_MODEL,
      isChat: env.SUMMARY_MODEL.includes('chat'),
      promptLength: env.SUMMARY_PROMPT.length,
    });

    try {
      if (env.SUMMARY_MODEL.includes('chat')) {
        const msg = buildChatMessages(env, content, limitNote);
        const opts = { ...baseOpts, messages: msg };
        aiResp = await env.AI.run(env.SUMMARY_MODEL, opts);
      } else {
        const input = `${env.SUMMARY_PROMPT}\n${limitNote}\n${content}`;
        const opts = { ...baseOpts, prompt: input };
        aiResp = await env.AI.run(env.SUMMARY_MODEL, opts);
      }
    } catch (error) {
      const err = error as Error;
      console.error('summariseChatMessages AI error', {
        chat: chatId.toString(LOG_ID_RADIX),
        error: err.message || String(err),
        stack: err.stack,
      });
      await sendMessage(
        env,
        chatId,
        'Ошибка при создании сводки. Пожалуйста, попробуйте позже.',
      );
      return;
    }

    const summary = truncateText(aiResp.response ?? aiResp, TELEGRAM_LIMIT);

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
        const err = error as Error;
        console.error('summariseChatMessages DB insert error', {
          chat: chatId.toString(LOG_ID_RADIX),
          error: err.message || String(err),
          stack: err.stack,
        });
      }
    }

    await sendMessage(env, chatId, summary);
  } catch (error) {
    const err = error as Error;
    console.error('summariseChatMessages unhandled error', {
      chat: chatId.toString(LOG_ID_RADIX),
      error: err.message || String(err),
      stack: err.stack,
    });
    try {
      await sendMessage(
        env,
        chatId,
        'Произошла непредвиденная ошибка при создании сводки.',
      );
    } catch (sendError) {
      const sendErr = sendError as Error;
      console.error('summariseChatMessages error notification failed', {
        chat: chatId.toString(LOG_ID_RADIX),
        error: sendErr.message || String(sendErr),
      });
    }
  } finally {
    console.debug('summariseChatMessages finished', {
      chat: chatId.toString(LOG_ID_RADIX),
    });
  }
}
