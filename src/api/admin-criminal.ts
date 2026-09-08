import type { Env, CriminalViolationEvidence, StoredMessage } from '../core/env';
import { fetchMessagesOptimized } from '../features/history/history-optimized';
import {
  calculateSentenceFromPunishment,
  formatSentenceTotalValue,
} from '../features/criminal/sentence-calculator';
import type { AdminDateRange } from './admin-stats';

const RAW_HISTORY_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const MAX_DETAILS = 50;
const CONTEXT_BEFORE_LIMIT = 3;
const CONTEXT_AFTER_LIMIT = 2;

interface CriminalDetailRow {
  id: number;
  message_id: number | null;
  target_message_id: number | null;
  article: string;
  subarticle: string | null;
  article_title: string | null;
  quote: string;
  punishment: string | null;
  severity: number | null;
  confidence: number | null;
  decision: string | null;
  evidence_json: string | null;
  context_before: number | null;
  context_after: number | null;
  text_preview: string | null;
  event_ts: number | string | null;
}

export interface AdminCriminalContextMessage {
  username: string;
  text: string;
  ts: number;
  relativePosition: number;
}

export interface AdminCriminalViolationDetail {
  id: number;
  messageId: number | null;
  article: string;
  subarticle: string | null;
  articleTitle: string;
  quote: string;
  punishment: string;
  severity: number;
  confidence: number | null;
  decision: string;
  occurredAt: number | null;
  trigger: {
    text: string;
    source: 'history' | 'preview' | 'quote';
  };
  contextMessages: AdminCriminalContextMessage[];
  contextSummary: string;
  evidence: CriminalViolationEvidence | null;
  sentence: {
    totalYears: number;
    lifeSentences: number;
    display: string;
  };
}

export interface AdminCriminalViolationDetails {
  chatId: number;
  userId: number;
  range: {
    from: string;
    to: string;
  };
  violations: AdminCriminalViolationDetail[];
  hasMore: boolean;
}

function parseEvidence(value: string | null): CriminalViolationEvidence | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const stringValue = (key: string): string =>
      typeof record[key] === 'string' ? record[key] as string : '';

    return {
      subject: stringValue('subject'),
      object: stringValue('object'),
      intent: stringValue('intent'),
      contextSummary: stringValue('contextSummary'),
      whyNotBenign: stringValue('whyNotBenign'),
    };
  } catch {
    return null;
  }
}

function eventTimestamp(row: CriminalDetailRow): number | null {
  if (row.event_ts === null) return null;
  const value = Number(row.event_ts);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

async function loadRecentHistory(
  env: Env,
  chatId: number,
  rows: CriminalDetailRow[],
): Promise<StoredMessage[]> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - RAW_HISTORY_RETENTION_SECONDS;
  const recentTimestamps = rows
    .map(eventTimestamp)
    .filter((ts): ts is number => ts !== null && ts >= cutoff && ts <= now + 60);

  if (recentTimestamps.length === 0) return [];

  const start = Math.max(cutoff, Math.min(...recentTimestamps) - 24 * 60 * 60);
  const end = Math.min(now, Math.max(...recentTimestamps) + 24 * 60 * 60);

  try {
    return await fetchMessagesOptimized(env, chatId, start, end);
  } catch {
    // Details remain useful from D1 even after raw 7-day history is unavailable.
    return [];
  }
}

function findTargetMessage(row: CriminalDetailRow, history: StoredMessage[]): number {
  const targetMessageId = row.target_message_id ?? row.message_id;
  if (targetMessageId === null) return -1;
  return history.findIndex((message) => message.messageId === targetMessageId);
}

function contextFor(
  row: CriminalDetailRow,
  history: StoredMessage[],
  targetIndex: number,
): AdminCriminalContextMessage[] {
  if (targetIndex < 0) return [];

  const before = Math.min(Math.max(Number(row.context_before) || 0, 0), CONTEXT_BEFORE_LIMIT);
  const after = Math.min(Math.max(Number(row.context_after) || 0, 0), CONTEXT_AFTER_LIMIT);
  const start = Math.max(0, targetIndex - before);
  const end = Math.min(history.length, targetIndex + after + 1);

  return history
    .slice(start, end)
    .map((message, index) => ({ message, relativePosition: start + index - targetIndex }))
    .filter(({ relativePosition }) => relativePosition !== 0)
    .map(({ message, relativePosition }) => ({
      username: message.username || `id${message.user}`,
      text: message.text || '',
      ts: message.ts,
      relativePosition,
    }))
    .filter((message) => message.text.trim().length > 0);
}

function mapViolation(
  row: CriminalDetailRow,
  history: StoredMessage[],
): AdminCriminalViolationDetail {
  const targetIndex = findTargetMessage(row, history);
  const targetMessage = targetIndex >= 0 ? history[targetIndex] : null;
  const trigger = targetMessage?.text
    ? { text: targetMessage.text, source: 'history' as const }
    : row.text_preview
      ? { text: row.text_preview, source: 'preview' as const }
      : { text: row.quote, source: 'quote' as const };
  const evidence = parseEvidence(row.evidence_json);
  const sentence = calculateSentenceFromPunishment(row.punishment || '');

  return {
    id: row.id,
    messageId: row.target_message_id ?? row.message_id,
    article: row.article,
    subarticle: row.subarticle,
    articleTitle: row.article_title || '',
    quote: row.quote,
    punishment: row.punishment || '',
    severity: Number(row.severity) || 0,
    confidence: row.confidence === null || !Number.isFinite(Number(row.confidence))
      ? null
      : Number(row.confidence),
    decision: row.decision || 'violation',
    occurredAt: eventTimestamp(row),
    trigger,
    contextMessages: contextFor(row, history, targetIndex),
    contextSummary: evidence?.contextSummary || '',
    evidence,
    sentence: {
      ...sentence,
      display: formatSentenceTotalValue(sentence),
    },
  };
}

/**
 * Returns bounded per-violation details for one leaderboard user. Raw Telegram
 * context is read only from the existing 7-day history retention and is never
 * persisted longer by this endpoint.
 */
export async function getAdminCriminalViolationDetails(
  env: Env,
  chatId: number,
  userId: number,
  range: AdminDateRange,
): Promise<AdminCriminalViolationDetails> {
  const statement = env.DB.prepare(
    `SELECT id, message_id, target_message_id, article, subarticle, article_title,
            quote, punishment, severity, confidence, decision, evidence_json,
            context_before, context_after, text_preview,
            COALESCE(violation_ts, CAST(strftime('%s', created_at) AS INTEGER)) AS event_ts
     FROM criminal_violations
     WHERE chat_id = ? AND user_id = ? AND (
       (violation_day IS NOT NULL AND violation_day >= ? AND violation_day <= ?)
       OR (violation_day IS NULL AND date(created_at) >= ? AND date(created_at) <= ?)
     )
     ORDER BY event_ts DESC, id DESC
     LIMIT ?`,
  );
  const result = await statement
    .bind(chatId, userId, range.from, range.to, range.from, range.to, MAX_DETAILS + 1)
    .all<CriminalDetailRow>();
  if (result.error || result.success === false) {
    throw new Error('criminal violation detail query failed');
  }
  const rows = result.results || [];
  const visibleRows = rows.slice(0, MAX_DETAILS);
  const history = await loadRecentHistory(env, chatId, visibleRows);

  return {
    chatId,
    userId,
    range: { from: range.from, to: range.to },
    violations: visibleRows.map((row) => mapViolation(row, history)),
    hasMore: rows.length > MAX_DETAILS,
  };
}
