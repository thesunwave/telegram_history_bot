import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import { createRealD1 } from './helpers/real-d1';
import { runAchievementJobs } from '../src/features/achievements/jobs';
import { setGroupEnabled, setEnrolled } from '../src/features/achievements/repository';
import { CardCanvas } from '../src/features/achievements/cards-raster';
import { evaluatePersonal, evaluateWeek } from '../src/features/achievements/evaluate';
import { Logger } from '../src/core/logger';

vi.mock('../src/features/achievements/evaluate', () => ({
  evaluateWeek: vi.fn(async () => ({
    badges: [], messages: 52, authors: 4, hours: [], start: '2026-02-02', end: '2026-02-08',
    peak: { day: '2026-02-05', hour: 12, count: 15 },
  })), evaluatePersonal: vi.fn(),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

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
    const send = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection lost'));
    await Promise.all([runAchievementJobs(env, dispatch), runAchievementJobs(env, dispatch)]);
    await runAchievementJobs(env, new Date(+dispatch + 86400000));
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows('SELECT state FROM achievement_reports')).toEqual([{ state: 'unknown' }]);
    expect(evaluatePersonal).toHaveBeenCalledWith(env, -44, 123, '2026-02-02');
  });

  it('honors the rate-limit deadline and persists the confirmed Telegram message', async () => {
    const { env, dispatch, rows } = await setup();
    const send = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ ok: false, error_code: 429, parameters: { retry_after: 600 } }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 17 } }));
    await runAchievementJobs(env, dispatch);
    await runAchievementJobs(env, new Date(+dispatch + 599000));
    expect(send).toHaveBeenCalledTimes(1);
    await runAchievementJobs(env, new Date(+dispatch + 600000));
    expect(rows('SELECT state,telegram_message_id FROM achievement_reports'))
      .toEqual([{ state: 'sent', telegram_message_id: 17 }]);
  });

  it('refuses a ready report when the original cron lease belongs to another consent generation', async () => {
    const { env, dispatch, rows, sqlite } = await setup();
    const original = vi.mocked(evaluateWeek).getMockImplementation()!;
    const send = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected send'));
    vi.mocked(evaluateWeek).mockImplementationOnce(async (...args) => {
      await setGroupEnabled(env.DB, -44, false);
      await setGroupEnabled(env.DB, -44, true, new Date('2026-02-02T00:00:00Z'));
      // Simulate a ready report belonging to the replacement generation.
      sqlite.prepare("UPDATE achievement_reports SET state='ready'").run();
      return original(...args);
    });
    await runAchievementJobs(env, dispatch);
    expect(send).not.toHaveBeenCalled();
    expect(rows('SELECT state FROM achievement_reports')).toEqual([{ state: 'ready' }]);
  });

  it('checks consent after rendering and never dispatches a cancelled generation', async () => {
    const { env, dispatch, rows } = await setup();
    const send = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected send'));
    vi.spyOn(CardCanvas.prototype, 'png').mockImplementationOnce(async () => {
      await setGroupEnabled(env.DB, -44, false);
      await setGroupEnabled(env.DB, -44, true, new Date('2026-02-02T00:00:00Z'));
      return new Uint8Array(0);
    });
    await runAchievementJobs(env, dispatch);
    expect(send).not.toHaveBeenCalled();
    expect(rows('SELECT state FROM achievement_reports')).toEqual([{ state: 'cancelled' }]);
  });

  it('does not requeue a late rate limit after an in-flight send was cancelled', async () => {
    const { env, dispatch, rows } = await setup();
    const send = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      await setGroupEnabled(env.DB, -44, false);
      return Response.json({ ok: false, error_code: 429 }, { status: 429 });
    });
    await runAchievementJobs(env, dispatch);
    expect(send).toHaveBeenCalledTimes(1);
    expect(rows('SELECT state FROM achievement_reports')).toEqual([{ state: 'cancelled' }]);
  });

  it('logs only the built-in error class when a personal evaluation fails', async () => {
    const { env, dispatch } = await setup();
    vi.mocked(evaluateWeek).mockResolvedValueOnce(null);
    const error = new TypeError('private payload');
    error.name = 'private metadata';
    vi.mocked(evaluatePersonal).mockRejectedValueOnce(error);
    const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => {});
    await runAchievementJobs(env, dispatch);
    expect(warn).toHaveBeenCalledWith('Album evaluation deferred', { op: 'achievementAlbum', errorClass: 'TypeError' });
  });
});
