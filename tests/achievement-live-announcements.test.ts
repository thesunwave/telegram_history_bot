import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import { createRealD1 } from './helpers/real-d1';
import { daysBetween, shiftDay } from '../src/features/achievements/rules';
import { evaluateWeek, unlockLiveWeekly } from '../src/features/achievements/evaluate';
import { announceGroupBadges, liveWeeklyStep } from '../src/features/achievements/announce';
import { setGroupEnabled } from '../src/features/achievements/repository';
import { CardCanvas } from '../src/features/achievements/cards-raster';
import { JOB_VERSION } from '../src/features/stats/daily-backfill';

const monday = '2026-01-05';
const chat = -123;
const person = 456;

function fixture() {
  const real = createRealD1();
  const f = { ...real, env: { DB: real.db, TOKEN: 'token' } as Env };
  f.sqlite.prepare(`INSERT OR IGNORE INTO stats_backfill_state(job_name,version,status,phase,cutoff_day,created_at,updated_at)
    VALUES ('daily_aggregates_v1',?,'done','done','2026-04-01',0,0)`).run(JOB_VERSION);
  const coverage = f.sqlite.prepare(`INSERT INTO stats_daily_coverage
    (chat_id,day,base_status,profanity_status,criminal_status,source,updated_at)
    VALUES (?,?,'complete','complete','complete','backfill',0)`);
  for (const day of daysBetween(shiftDay(monday, -28), shiftDay(monday, 6))) coverage.run(chat, day);
  const user = f.sqlite.prepare(`INSERT INTO stats_daily_user
    (chat_id,user_id,day,message_count,word_count,voice_count,voice_duration_seconds,video_note_count)
    VALUES (?,?,?,?,100,1,135,1)`);
  for (const [i, day] of daysBetween(monday, shiftDay(monday, 6)).entries()) {
    f.sqlite.prepare('INSERT INTO stats_daily_hour VALUES (?,?,10,41)').run(chat, day);
    for (let j = 0; j < 4; j++) user.run(chat, person + j, day, j === i % 4 ? 11 : 10);
  }
  return f;
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('live group badge announcements', () => {
  it('unlocks proven badges mid-week, announces each once and leaves the rest to the weekly report', async () => {
    const f = fixture();
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T00:00:00Z'));
    const thursday = new Date('2026-01-08T12:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(thursday);
    await liveWeeklyStep(f.env, thursday);
    await liveWeeklyStep(f.env, thursday);
    expect(f.rows('SELECT badge_id,earned_day FROM achievement_awards ORDER BY badge_id')).toEqual([
      { badge_id: 'choir', earned_day: '2026-01-08' },
      { badge_id: 'relay-cup', earned_day: '2026-01-07' },
      { badge_id: 'round-table', earned_day: '2026-01-07' },
      { badge_id: 'rush-hour', earned_day: '2026-01-08' },
    ]);
    const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ ok: true, result: { message_id: 7 } }));
    const now = Math.floor(+thursday / 1000);
    await Promise.all([announceGroupBadges(f.env, now), announceGroupBadges(f.env, now)]);
    await announceGroupBadges(f.env, now + 600);
    expect(send).toHaveBeenCalledTimes(4);
    const captions = send.mock.calls.map(([, init]) => ((init as RequestInit).body as FormData).get('caption'));
    expect(captions).toContain('Чат открыл бейдж «Хор»!\nРазных голосов: 4');
    expect(f.rows('SELECT COUNT(*) AS n FROM achievement_awards WHERE announce_at IS NOT NULL')).toEqual([{ n: 0 }]);

    vi.setSystemTime(new Date('2026-01-12T00:05:00Z'));
    const report = await evaluateWeek(f.env, chat, monday);
    expect(report?.badges.map(s => s.id)).toEqual(['podcast', 'seven-days']);
  });

  async function pending() {
    const f = fixture();
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T00:00:00Z'));
    const thursday = new Date('2026-01-08T12:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(thursday);
    expect(await unlockLiveWeekly(f.env, chat, thursday)).toBe(4);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    return { ...f, now: Math.floor(+thursday / 1000) };
  }
  const rateLimited = () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 60 } }, { status: 429 });

  it('retries a rate-limited announcement once due and stops after 24 hours', async () => {
    const f = await pending();
    const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => rateLimited());
    await announceGroupBadges(f.env, f.now);
    expect(send).toHaveBeenCalledTimes(4);
    expect(f.rows('SELECT DISTINCT announce_at FROM achievement_awards')).toEqual([{ announce_at: f.now + 300 }]);
    await announceGroupBadges(f.env, f.now + 299);
    expect(send).toHaveBeenCalledTimes(4);
    send.mockImplementation(async () => Response.json({ ok: true, result: { message_id: 8 } }));
    await announceGroupBadges(f.env, f.now + 300);
    expect(send).toHaveBeenCalledTimes(8);
    expect(f.rows('SELECT DISTINCT announce_at FROM achievement_awards')).toEqual([{ announce_at: null }]);

    f.sqlite.prepare('UPDATE achievement_awards SET announce_at=?').run(f.now + 86100);
    send.mockImplementation(async () => rateLimited());
    await announceGroupBadges(f.env, f.now + 86100);
    expect(send).toHaveBeenCalledTimes(12);
    expect(f.rows('SELECT DISTINCT announce_at FROM achievement_awards')).toEqual([{ announce_at: null }]);
  });

  it('requeues a card that failed before dispatch and drops pending ones when the group is disabled', async () => {
    const f = await pending();
    const send = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => rateLimited());
    vi.spyOn(CardCanvas.prototype, 'png').mockRejectedValueOnce(new Error('render failed'));
    await announceGroupBadges(f.env, f.now);
    expect(send).toHaveBeenCalledTimes(3);
    expect(f.rows('SELECT DISTINCT announce_at FROM achievement_awards')).toEqual([{ announce_at: f.now + 300 }]);
    vi.spyOn(CardCanvas.prototype, 'png').mockImplementationOnce(async () => {
      await setGroupEnabled(f.db, chat, false);
      return new Uint8Array(0);
    });
    await announceGroupBadges(f.env, f.now + 300);
    expect(send).toHaveBeenCalledTimes(3);
    expect(f.rows('SELECT DISTINCT announce_at FROM achievement_awards')).toEqual([{ announce_at: null }]);
  });
});
