// Pure helpers that build the message context passed to criminal analysis.
// Moved from CriminalCodeAnalyzerDO.

import type {
  CriminalAnalysisResult,
  CriminalContextAnalysisInput,
  CriminalContextMessage,
  StoredMessage,
  MessageReplyContext,
} from '../../../core/env';
import type { QueuedCriminalAnalysisTask } from './types';

export function buildDiagnosticContextInput(
  body: any,
  text: string,
  chatId: number,
  targetTimestamp: number
): CriminalContextAnalysisInput {
  const targetMessageId = Number.isFinite(Number(body.messageId)) ? Number(body.messageId) : Date.now();
  const targetUserId = Number.isFinite(Number(body.userId)) ? Number(body.userId) : undefined;
  const targetUsername = typeof body.username === 'string' ? body.username : 'diagnostic';
  const replyTo = normalizeReplyContext(body.replyTo);
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];

  if (rawMessages.length === 0) {
    return {
      targetMessageId,
      targetUserId,
      targetUsername,
      targetText: text,
      targetTimestamp,
      chatId,
      replyTo,
      contextWindow: { before: 0, after: 0, totalMessages: 1 },
      messages: [{
        messageId: targetMessageId,
        username: targetUsername,
        userId: targetUserId,
        text,
        ts: targetTimestamp,
        relativePosition: 0,
        isTarget: true,
      }],
    };
  }

  const messages = rawMessages
    .map((message: any, index: number): CriminalContextMessage => ({
      messageId: Number.isFinite(Number(message.messageId)) ? Number(message.messageId) : undefined,
      username: typeof message.username === 'string' ? message.username : 'unknown',
      userId: Number.isFinite(Number(message.userId)) ? Number(message.userId) : undefined,
      text: typeof message.text === 'string' ? message.text : '',
      ts: Number.isFinite(Number(message.ts)) ? Number(message.ts) : targetTimestamp + index,
      relativePosition: Number.isFinite(Number(message.relativePosition))
        ? Number(message.relativePosition)
        : index,
      isTarget: Boolean(message.isTarget),
    }))
    .filter((message: CriminalContextMessage) => message.text.trim().length > 0);

  if (!messages.some((message: CriminalContextMessage) => message.isTarget)) {
    messages.push({
      messageId: targetMessageId,
      username: targetUsername,
      userId: targetUserId,
      text,
      ts: targetTimestamp,
      relativePosition: 0,
      isTarget: true,
    });
  }

  return {
    targetMessageId,
    targetUserId,
    targetUsername,
    targetText: text,
    targetTimestamp,
    chatId,
    replyTo,
    contextWindow: {
      before: messages.filter((message: CriminalContextMessage) => message.relativePosition < 0).length,
      after: messages.filter((message: CriminalContextMessage) => message.relativePosition > 0).length,
      totalMessages: messages.length,
    },
    messages,
  };
}

export function buildContextMessages(
  recentMessages: StoredMessage[],
  task: QueuedCriminalAnalysisTask,
  beforeLimit: number,
  afterLimit: number
): CriminalContextMessage[] {
  const targetIndex = findTargetMessageIndex(recentMessages, task);
  if (targetIndex >= 0) {
    const start = Math.max(0, targetIndex - beforeLimit);
    const end = Math.min(recentMessages.length, targetIndex + afterLimit + 1);
    return recentMessages.slice(start, end).map((message, index) => {
      const absoluteIndex = start + index;
      return toContextMessage(message, absoluteIndex - targetIndex, absoluteIndex === targetIndex);
    });
  }

  // The queue can be processed after the original message has fallen out of
  // the bounded recent-history read. Never nominate an arbitrary later chat
  // message as the target in that case: inject the queued task itself and use
  // message id/timestamp only to split the available context around it.
  const before: StoredMessage[] = [];
  const after: StoredMessage[] = [];
  for (const message of recentMessages) {
    if (compareStoredMessageToTask(message, task) > 0) {
      after.push(message);
    } else {
      before.push(message);
    }
  }

  const selectedBefore = before.slice(-beforeLimit);
  const selectedAfter = after.slice(0, afterLimit);
  return [
    ...selectedBefore.map((message, index) =>
      toContextMessage(message, index - selectedBefore.length, false)
    ),
    {
      messageId: task.messageId,
      username: task.username || 'unknown',
      userId: task.userId,
      text: task.text,
      ts: task.ts || Math.floor(Date.now() / 1000),
      relativePosition: 0,
      isTarget: true,
    },
    ...selectedAfter.map((message, index) =>
      toContextMessage(message, index + 1, false)
    ),
  ];
}

export function toContextMessage(
  message: StoredMessage,
  relativePosition: number,
  isTarget: boolean
): CriminalContextMessage {
  return {
    messageId: message.messageId,
    username: message.username,
    userId: message.user,
    text: message.text,
    ts: message.ts,
    relativePosition,
    isTarget,
  };
}

export function normalizeReplyContext(value: unknown): MessageReplyContext | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const reply = value as Record<string, unknown>;
  const messageId = Number.isFinite(Number(reply.messageId)) ? Number(reply.messageId) : undefined;
  const userId = Number.isFinite(Number(reply.userId)) ? Number(reply.userId) : undefined;
  const username = typeof reply.username === 'string'
    ? reply.username.replace(/\s+/g, ' ').trim().slice(0, 100)
    : undefined;
  const text = typeof reply.text === 'string'
    ? reply.text.replace(/\s+/g, ' ').trim().slice(0, 2000)
    : undefined;
  const ts = Number.isFinite(Number(reply.ts)) ? Number(reply.ts) : undefined;

  if (messageId === undefined && userId === undefined && !username && !text && ts === undefined) {
    return undefined;
  }
  return { messageId, userId, username: username || undefined, text: text || undefined, ts };
}

export function compareStoredMessageToTask(message: StoredMessage, task: QueuedCriminalAnalysisTask): number {
  if (Number.isInteger(message.messageId) && Number.isInteger(task.messageId)) {
    return (message.messageId as number) - (task.messageId as number);
  }
  if (Number.isFinite(message.ts) && Number.isFinite(task.ts)) {
    return message.ts - (task.ts as number);
  }
  // Without a reliable ordering field, preserve the old useful behavior of
  // treating the latest bounded history as preceding context.
  return -1;
}

export function findTargetMessageIndex(
  messages: StoredMessage[],
  task: QueuedCriminalAnalysisTask
): number {
  if (task.messageId !== undefined) {
    const byMessageId = messages.findIndex(message => message.messageId === task.messageId);
    if (byMessageId >= 0) {
      return byMessageId;
    }
  }
  const byText = messages.findIndex(message => (
    message.user === task.userId &&
    message.text === task.text
  ));
  return byText;
}

export function buildSingleMessageContextInput(text: string): CriminalContextAnalysisInput {
  const ts = Math.floor(Date.now() / 1000);
  return {
    targetText: text,
    targetTimestamp: ts,
    chatId: 0,
    contextWindow: {
      before: 0,
      after: 0,
      totalMessages: 1,
    },
    messages: [{
      username: 'unknown',
      text,
      ts,
      relativePosition: 0,
      isTarget: true,
    }],
  };
}

export function normalizeAnalysisResult(result: CriminalAnalysisResult): CriminalAnalysisResult {
  if (
    typeof result.analysisTimestamp !== 'number' ||
    !Number.isFinite(result.analysisTimestamp) ||
    result.analysisTimestamp <= 0
  ) {
    return { ...result, analysisTimestamp: Date.now() };
  }
  return result;
}

export async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getPeriodDays(period: string): number {
  switch (period) {
    case '1d': return 1;
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    default: return 7;
  }
}
