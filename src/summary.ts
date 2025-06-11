import { Env, DAY, TELEGRAM_LIMIT, LOG_ID_RADIX } from './env';
import { fetchMessages, fetchLastMessages } from './history';
import { truncateText } from "./utils";
import { sendMessage } from "./telegram";

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
    const content = messages.map((m) => `${m.username}: ${m.text}`).join("\n");
    console.debug("summarize start", {
      chat: chatId.toString(LOG_ID_RADIX),
      days,
      model: env.SUMMARY_MODEL,
      count: messages.length,
      contentLength: content.length,
      firstMessageTime: messages.length > 0 ? new Date(messages[0].ts * 1000).toISOString() : null,
      lastMessageTime: messages.length > 0 ? new Date(messages[messages.length - 1].ts * 1000).toISOString() : null,
    });

    // Prepare AI request
    const limitNote = `Ответ не длиннее ${TELEGRAM_LIMIT} символов.`;
    let aiResp: any;
    
    console.debug("summarize AI model", {
      chat: chatId.toString(LOG_ID_RADIX),
      model: env.SUMMARY_MODEL,
      isChat: env.SUMMARY_MODEL.includes("chat"),
      promptLength: env.SUMMARY_PROMPT.length,
    });
    
    try {
      // Call AI model
      if (env.SUMMARY_MODEL.includes("chat")) {
        const msg = [
          { role: "system", content: `${env.SUMMARY_PROMPT}\n${limitNote}` },
          { role: "user", content },
        ];
        console.debug("summarize AI request (chat)", {
          chat: chatId.toString(LOG_ID_RADIX),
          messageCount: msg.length,
          systemContentLength: msg[0].content.length,
          userContentLength: msg[1].content.length,
        });
        aiResp = await env.AI.run(env.SUMMARY_MODEL, { messages: msg });
      } else {
        const input = `${env.SUMMARY_PROMPT}\n${limitNote}\n${content}`;
        console.debug("summarize AI request (completion)", {
          chat: chatId.toString(LOG_ID_RADIX),
          inputLength: input.length,
        });
        aiResp = await env.AI.run(env.SUMMARY_MODEL, { prompt: input });
      }
      
      console.debug("summarize AI response received", {
        chat: chatId.toString(LOG_ID_RADIX),
        responseType: typeof aiResp,
        hasResponse: aiResp && (aiResp.response !== undefined || typeof aiResp === 'string'),
        responseLength: aiResp ? (aiResp.response?.length || (typeof aiResp === 'string' ? aiResp.length : 0)) : 0,
      });
    } catch (error) {
      console.error("summarize AI error", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: error.message || String(error),
        stack: error.stack,
      });
      await sendMessage(env, chatId, "Ошибка при создании сводки. Пожалуйста, попробуйте позже.");
      return;
    }

    // Process AI response
    const summary = truncateText(aiResp.response ?? aiResp, TELEGRAM_LIMIT);
    console.debug("summarize done", {
      chat: chatId.toString(LOG_ID_RADIX),
      length: summary.length,
      truncated: (aiResp.response?.length || (typeof aiResp === 'string' ? aiResp.length : 0)) > TELEGRAM_LIMIT,
    });
    
    // Save to database
    if (env.DB) {
      try {
        console.debug("summarize DB insert start", {
          chat: chatId.toString(LOG_ID_RADIX),
        });
        
        await env.DB.prepare(
          "INSERT INTO summaries (chat_id, period_start, period_end, summary) VALUES (?, ?, ?, ?)",
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
      error: error.message || String(error),
      stack: error.stack,
    });
    try {
      await sendMessage(env, chatId, "Произошла непредвиденная ошибка при создании сводки.");
    } catch (sendError) {
      console.error("summariseChat error notification failed", {
        chat: chatId.toString(LOG_ID_RADIX),
        error: sendError.message || String(sendError),
      });
    }
  }
  finally {
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

    const content = messages
      .map((m) => `${m.username}: ${m.text}`)
      .join('\n');
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
    let aiResp: any;

    console.debug('summariseChatMessages AI model', {
      chat: chatId.toString(LOG_ID_RADIX),
      model: env.SUMMARY_MODEL,
      isChat: env.SUMMARY_MODEL.includes('chat'),
      promptLength: env.SUMMARY_PROMPT.length,
    });

    try {
      if (env.SUMMARY_MODEL.includes('chat')) {
        const msg = [
          { role: 'system', content: `${env.SUMMARY_PROMPT}\n${limitNote}` },
          { role: 'user', content },
        ];
        aiResp = await env.AI.run(env.SUMMARY_MODEL, { messages: msg });
      } else {
        const input = `${env.SUMMARY_PROMPT}\n${limitNote}\n${content}`;
        aiResp = await env.AI.run(env.SUMMARY_MODEL, { prompt: input });
      }
    } catch (error) {
      console.error('summariseChatMessages AI error', {
        chat: chatId.toString(LOG_ID_RADIX),
        error: (error as any).message || String(error),
        stack: (error as any).stack,
      });
      await sendMessage(env, chatId, 'Ошибка при создании сводки. Пожалуйста, попробуйте позже.');
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
      error: (error as any).message || String(error),
      stack: (error as any).stack,
    });
    try {
      await sendMessage(env, chatId, 'Произошла непредвиденная ошибка при создании сводки.');
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
