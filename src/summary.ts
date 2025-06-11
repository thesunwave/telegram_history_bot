import { Env, DAY, TELEGRAM_LIMIT, LOG_ID_RADIX } from "./env";
import { fetchMessages } from "./history";
import { truncateText } from "./utils";
import { sendMessage } from "./telegram";

export async function summariseChat(env: Env, chatId: number, days: number) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * DAY;
  const messages = await fetchMessages(env, chatId, start, end);
  if (!messages.length) {
    await sendMessage(env, chatId, "Нет сообщений");
    return;
  }
  const content = messages.map((m) => `${m.username}: ${m.text}`).join("\n");
  console.debug("summarize start", {
    chat: chatId.toString(LOG_ID_RADIX),
    days,
    model: env.SUMMARY_MODEL,
    count: messages.length,
    contentLength: content.length,
  });
  const limitNote = `Ответ не длиннее ${TELEGRAM_LIMIT} символов.`;
  let aiResp: any;
  if (env.SUMMARY_MODEL.includes("chat")) {
    const msg = [
      { role: "system", content: `${env.SUMMARY_PROMPT}\n${limitNote}` },
      { role: "user", content },
    ];
    aiResp = await env.AI.run(env.SUMMARY_MODEL, { messages: msg });
  } else {
    const input = `${env.SUMMARY_PROMPT}\n${limitNote}\n${content}`;
    aiResp = await env.AI.run(env.SUMMARY_MODEL, { prompt: input });
  }

  const summary = truncateText(aiResp.response ?? aiResp, TELEGRAM_LIMIT);
  console.debug("summarize done", {
    chat: chatId.toString(LOG_ID_RADIX),
    length: summary.length,
  });
  if (env.DB) {
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
  }
  await sendMessage(env, chatId, summary);
}
