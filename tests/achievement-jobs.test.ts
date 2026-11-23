import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import { createRealD1 } from './helpers/real-d1';
import { runAchievementJobs } from '../src/features/achievements/jobs';
import { setGroupEnabled, setEnrolled } from '../src/features/achievements/repository';
import { sendWeeklyPhoto } from '../src/features/achievements/cards';
import { evaluatePersonal } from '../src/features/achievements/evaluate';

vi.mock('../src/features/achievements/cards', () => ({ sendWeeklyPhoto: vi.fn() }));
vi.mock('../src/features/achievements/evaluate', () => ({
  evaluateWeek: vi.fn(async () => ({ badges: [], messages: 52 })), evaluatePersonal: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

describe('achievement job delivery', () => {
  async function setup() {
    const d1 = createRealD1();
    const env = { DB: d1.db } as Env;
    const start = new Date('2026-02-02T00:00:00Z');
    const dispatch = new Date('2026-02-09T00:05:00Z');
    await setGroupEnabled(d1.db, -44, true, start);
    await setEnrolled(d1.db, -44, 123, true, start);
    d1.sqlite.prepare("INSERT INTO achievement_reports(chat_id,week,report_json) VALUES (-44,'2026-02-02','{}')").run();
    return { ...d1, env, dispatch };
  }

  it('reserves before delivery and suppresses concurrent or ambiguous repeats', async () => {
    const { env, dispatch, rows } = await setup();
    vi.mocked(sendWeeklyPhoto).mockResolvedValue({ status: 'unknown' });
    await Promise.all([runAchievementJobs(env, dispatch), runAchievementJobs(env, dispatch)]);
    await runAchievementJobs(env, new Date(+dispatch + 86400000));
    expect(sendWeeklyPhoto).toHaveBeenCalledTimes(1);
    expect(rows('SELECT state FROM achievement_reports')).toEqual([{ state: 'unknown' }]);
    expect(evaluatePersonal).toHaveBeenCalledWith(env, -44, 123, '2026-02-02');
  });

  it('honors the rate-limit deadline and persists the confirmed Telegram message', async () => {
    const { env, dispatch, rows } = await setup();
    vi.mocked(sendWeeklyPhoto).mockResolvedValueOnce({ status: 'retry', retryAfter: 600 })
      .mockResolvedValueOnce({ status: 'sent', messageId: 17 });
    await runAchievementJobs(env, dispatch);
    await runAchievementJobs(env, new Date(+dispatch + 599000));
    expect(sendWeeklyPhoto).toHaveBeenCalledTimes(1);
    await runAchievementJobs(env, new Date(+dispatch + 600000));
    expect(rows('SELECT state,telegram_message_id FROM achievement_reports'))
      .toEqual([{ state: 'sent', telegram_message_id: 17 }]);
  });
});
