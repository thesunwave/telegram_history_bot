import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env, StoredMessage } from '../src/core/env';
import type { AdminDateRange } from '../src/api/admin-stats';
import { fetchMessagesOptimized } from '../src/features/history/history-optimized';
import { getAdminCriminalViolationDetails } from '../src/api/admin-criminal';

vi.mock('../src/features/history/history-optimized', () => ({
  fetchMessagesOptimized: vi.fn(),
}));

const range: AdminDateRange = {
  period: 'week',
  from: '2026-09-01',
  to: '2026-09-07',
  days: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'],
};

function createEnv(rows: unknown[]) {
  const all = vi.fn().mockResolvedValue({ success: true, results: rows, meta: {} });
  const bind = vi.fn().mockReturnValue({ all });
  const prepare = vi.fn().mockReturnValue({ bind });
  return {
    env: { DB: { prepare } } as unknown as Env,
    prepare,
    bind,
  };
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    user_id: 42,
    message_id: 1002,
    target_message_id: 1002,
    article: '119',
    subarticle: null,
    article_title: 'Угроза убийством или причинением тяжкого вреда здоровью',
    quote: 'я тебя убью',
    punishment: 'лишение свободы на срок до 5 лет',
    severity: 8,
    confidence: 0.87,
    decision: 'violation',
    evidence_json: JSON.stringify({
      subject: 'author',
      object: 'recipient',
      intent: 'threat',
      contextSummary: 'Конфликт между участниками.',
      whyNotBenign: 'Фраза адресована конкретному человеку и сформулирована как угроза.',
    }),
    context_before: 1,
    context_after: 1,
    context_total_messages: 3,
    text_preview: null,
    event_ts: 1788782400,
    ...overrides,
  };
}

describe('getAdminCriminalViolationDetails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T14:00:00.000Z'));
    vi.mocked(fetchMessagesOptimized).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the exact retained trigger message, nearby context and model/legal details', async () => {
    const { env, bind } = createEnv([baseRow()]);
    const messages: StoredMessage[] = [
      { chat: -1001, user: 7, username: 'alice', text: 'успокойтесь', ts: 1788782390, messageId: 1001 },
      { chat: -1001, user: 42, username: 'bob', text: 'я тебя убью завтра', ts: 1788782400, messageId: 1002 },
      { chat: -1001, user: 7, username: 'alice', text: 'это угроза?', ts: 1788782410, messageId: 1003 },
    ];
    vi.mocked(fetchMessagesOptimized).mockResolvedValue(messages);

    const result = await getAdminCriminalViolationDetails(env, -1001, 42, range);

    expect(bind).toHaveBeenCalledWith(
      -1001,
      42,
      '2026-09-01',
      '2026-09-07',
      '2026-09-01',
      '2026-09-07',
      51,
    );
    expect(fetchMessagesOptimized).toHaveBeenCalledTimes(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      article: '119',
      confidence: 0.87,
      severity: 8,
      trigger: { text: 'я тебя убью завтра', source: 'history' },
      sentence: { totalYears: 5, lifeSentences: 0, display: '5 лет' },
      contextSummary: 'Конфликт между участниками.',
      evidence: {
        whyNotBenign: 'Фраза адресована конкретному человеку и сформулирована как угроза.',
      },
    });
    expect(result.violations[0].contextMessages).toEqual([
      { username: 'alice', text: 'успокойтесь', ts: 1788782390, relativePosition: -1 },
      { username: 'alice', text: 'это угроза?', ts: 1788782410, relativePosition: 1 },
    ]);
  });

  it('falls back to the model quote for old rows without extending raw-message retention', async () => {
    const oldTimestamp = Math.floor(new Date('2026-08-20T12:00:00.000Z').getTime() / 1000);
    const { env } = createEnv([
      baseRow({
        event_ts: oldTimestamp,
        evidence_json: '{bad json',
        punishment: 'штраф до 100 тысяч рублей',
      }),
    ]);

    const result = await getAdminCriminalViolationDetails(env, -1001, 42, {
      period: 'custom',
      from: '2026-08-20',
      to: '2026-08-20',
      days: ['2026-08-20'],
    });

    expect(fetchMessagesOptimized).not.toHaveBeenCalled();
    expect(result.violations[0]).toMatchObject({
      trigger: { text: 'я тебя убью', source: 'quote' },
      evidence: null,
      contextMessages: [],
      sentence: { totalYears: 0, lifeSentences: 0, display: 'срок не распознан' },
    });
  });

  it('bounds detail responses to 50 rows and reports truncation', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => baseRow({
      id: index + 1,
      event_ts: Math.floor(new Date('2026-08-20T12:00:00.000Z').getTime() / 1000) - index,
    }));
    const { env } = createEnv(rows);

    const result = await getAdminCriminalViolationDetails(env, -1001, 42, range);

    expect(result.violations).toHaveLength(50);
    expect(result.hasMore).toBe(true);
  });
});
