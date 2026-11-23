import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import { CountersDO } from '../src/durable-objects/counters-do';
import type { Env } from '../src/core/env';
import { withRealCountersDO } from './helpers/real-counters-do';
import { createRealD1 } from './helpers/real-d1';
import { daysBetween, shiftDay, personalRules, weeklyRules, type GroupDay, type PersonalDay } from '../src/features/achievements/rules';
import { GROUP_DAY_SQL } from '../src/features/achievements/queries';
import { evaluateWeek, evaluatePersonal } from '../src/features/achievements/evaluate';
import { eraseAlbum, getEnrollment, getProgress, listAwards, setEnrolled, setGroupEnabled } from '../src/features/achievements/repository';
import { JOB_VERSION } from '../src/features/stats/daily-backfill';

const monday = '2026-01-05';
const friday = '2026-01-09';
const chat = -123;
const person = 456;

/** The repository helper's write-only batch lacks SELECT resultsets. Read batches use the same SQLite snapshot. */
function fixture() {
  const real = createRealD1();
  const writeBatch = real.db.batch.bind(real.db);
  const db = {
    ...real.db, batch: async (statements: Parameters<D1Database['batch']>[0]) => {
      const first = statements[0] as unknown as { sql: string };
      if (first.sql.trimStart().startsWith('SELECT')) return Promise.all(statements.map(s => s.all()));
      return writeBatch(statements);
    }
  } as D1Database;
  const env = { DB: db } as Env;
  return { ...real, db, env };
}
type Fixture = ReturnType<typeof fixture>;
function markReady(f: Fixture, start: string, end: string) {
  f.sqlite.prepare(`INSERT OR IGNORE INTO stats_backfill_state(job_name,version,status,phase,cutoff_day,created_at,updated_at)
    VALUES ('daily_aggregates_v1',?,'done','done','2026-04-01',0,0)`).run(JOB_VERSION);
  const save = f.sqlite.prepare(`INSERT INTO stats_daily_coverage
    (chat_id,day,base_status,profanity_status,criminal_status,source,updated_at)
    VALUES (?,?,'complete','complete','complete','backfill',0)`);
  for (const day of daysBetween(start, end)) save.run(chat, day);
}
function userDay(day: string): PersonalDay { return { day, messages: 1, words: 100, voices: 1, videos: 1 }; }
function seed(f: Fixture) {
  markReady(f, shiftDay(monday, -28), shiftDay(monday, 6));
  const user = f.sqlite.prepare(`INSERT INTO stats_daily_user
    (chat_id,user_id,day,message_count,word_count,voice_count,voice_duration_seconds,video_note_count)
    VALUES (?,?,?,?,100,1,135,1)`);
  for (const [i, day] of daysBetween(monday, shiftDay(monday, 6)).entries()) {
    f.sqlite.prepare('INSERT INTO stats_daily_hour VALUES (?,?,10,41)').run(chat, day);
    for (let j = 0; j < 4; j++) user.run(chat, person + j, day, j === i % 4 ? 11 : 10);
  }
}

describe('achievement rules', () => {
  it('matches different UTC buckets to different dates, and separates voice/video from posts', () => {
    const dates = daysBetween(monday, friday);
    const rows = dates.map(userDay);
    const buckets = [
      { day: dates[0], bucket: 'morning' }, { day: dates[0], bucket: 'evening' },
      { day: dates[0], bucket: 'night' }, { day: dates[1], bucket: 'night' }, { day: dates[2], bucket: 'night' },
    ];
    const progress = personalRules(rows, buckets, { days: 2, channels: 4 }, monday, friday);
    const earned = progress.filter(s => s.earned).map(s => s.id);
    expect(earned).toEqual(['tomorrow', 'columnist', 'night-shift', 'radio-diary', 'film', 'dual-air']);
    expect(progress.find(s => s.id === 'three-shifts')?.current).toBe(2);
    buckets.push({ day: dates[3], bucket: 'evening' });
    expect(personalRules(rows, buckets, { days: 3, channels: 3 }, monday, friday)
      .filter(s => s.earned).map(s => s.id)).toContain('three-shifts');
  });
  it('requires all four completed enrollment weeks, with no daily streak requirement', () => {
    const rows = [0, 7, 14, 21].map(d => userDay(shiftDay(monday, d)));
    const regular = (day: string, start: string) => personalRules(rows, [], { days: 0, channels: 0 }, start, day)[1].earned;
    expect(regular(shiftDay(monday, 26), monday)).toBe(false);
    expect(regular(shiftDay(monday, 27), monday)).toBe(true);
    expect(regular(shiftDay(monday, 27), shiftDay(monday, 1))).toBe(false);
  });
  it('rejects missing or tied hourly baselines and preserves the measured podcast duration', () => {
    const row = { day: monday, authors: 4, messages: 30, maximum: 12, voice_seconds: 3599, voices: 20, leader: null };
    const hour = { day: monday, hour: 12, count: 30 };
    const run = (baseline: number | null) => weeklyRules(monday, [row], [hour], 4, 4, baseline);
    expect(run(null).badges.filter(s => s.earned).map(s => s.id)).toEqual(['choir']);
    expect(run(30).badges[0].earned).toBe(false);
    expect(run(29).badges[0].earned).toBe(true);
    row.voice_seconds = 3600;
    expect(run(null).badges.find(b => b.id === 'podcast')).toMatchObject({ earned: true, current: 3600 });
    row.voice_seconds = 3661;
    expect(run(null).badges.find(b => b.id === 'podcast')?.result).toBe('61 мин 1 с, записей: 20');
  });
  it('counts only sole leaders on UTC dates with three or more posting participants', () => {
    const f = fixture(); seed(f);
    const wednesday = shiftDay(monday, 2), thursday = shiftDay(monday, 3);
    // Monday and Tuesday have different sole leaders. Wednesday has two joint leaders.
    const change = f.sqlite.prepare('UPDATE stats_daily_user SET message_count=? WHERE day=? AND user_id=?');
    change.run(11, wednesday, person);
    // Thursday has a third sole leader but only two posting participants.
    change.run(0, thursday, person);
    change.run(0, thursday, person + 1);
    const leaders = () => weeklyRules(monday, f.sqlite.prepare(GROUP_DAY_SQL).all(chat, monday, thursday) as GroupDay[],
      [], 4, 0, null).badges.find(b => b.id === 'relay-cup');
    expect(leaders()).toMatchObject({ current: 2, earned: false });
    change.run(10, wednesday, person);
    expect(leaders()).toMatchObject({ current: 3, earned: true });
  });
});

describe('achievement persistence and calibration', () => {
  it('commits all six unlocks with the report in priority order and safely replays', async () => {
    const f = fixture(); seed(f);
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T00:00:00Z'));
    const report = await evaluateWeek(f.env, chat, monday);
    expect(report?.badges.map(s => s.id)).toEqual(['rush-hour', 'relay-cup', 'round-table', 'podcast', 'seven-days', 'choir']);
    expect(report?.hours).toHaveLength(24);
    expect(report?.peak).toEqual({ day: monday, hour: 10, count: 41 });
    expect(report?.authors).toBe(4);
    expect(await evaluateWeek(f.env, chat, monday)).toEqual(report);
    expect(await listAwards(f.db, chat)).toHaveLength(6);
    expect(f.rows('SELECT week FROM achievement_reports')).toHaveLength(1);
  });
  it('defers unknown current days while a missing baseline suppresses only the peak', async () => {
    const f = fixture(); seed(f);
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T00:00:00Z'));
    f.sqlite.prepare("UPDATE stats_daily_coverage SET base_status='partial' WHERE day=?").run(friday);
    expect(await evaluateWeek(f.env, chat, monday)).toBeNull();
    f.sqlite.prepare("UPDATE stats_daily_coverage SET base_status='complete' WHERE day=?").run(friday);
    f.sqlite.prepare("UPDATE stats_daily_coverage SET base_status='partial' WHERE day=?").run(shiftDay(monday, -2));
    expect((await evaluateWeek(f.env, chat, monday))?.badges.map(s => s.id)).not.toContain('rush-hour');
  });
  it('publishes a one-message week on a fresh installation only when every quiet date is verifiable', async () => {
    const f = fixture();
    const env = withRealCountersDO(f.env);
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T00:00:00Z'));
    const stub = env.COUNTERS_DO.get(env.COUNTERS_DO.idFromName(String(chat)));
    const post = (route: string, payload: object) => stub.fetch('https://do/' + route, { method: 'POST', body: JSON.stringify(payload) });
    expect((await post('inc', { chatId: chat, userId: person, username: 'fixture', day: monday, messageId: 1, hour: 4 })).status).toBe(200);
    for (const category of ['profanity', 'criminal']) {
      expect((await post('ack', { chatId: chat, day: monday, sequence: 1, messageId: 1, category, outcome: 'skipped' })).status).toBe(200);
    }
    f.sqlite.prepare('INSERT INTO stats_daily_hour VALUES (?,?,1,1)').run(chat, friday);
    expect(await evaluateWeek(env, chat, monday)).toBeNull(); // orphaned D1 evidence
    f.sqlite.prepare('DELETE FROM stats_daily_hour WHERE day=?').run(friday);
    const report = await evaluateWeek(env, chat, monday);
    expect(report?.messages).toBe(1);
    expect(report?.authors).toBe(1);
    expect(report?.badges).toEqual([]);
  });
  it('persists a verified silent week without awards or another evidence scan on replay', async () => {
    const f = fixture();
    const env = withRealCountersDO(f.env);
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T00:00:00Z'));
    const report = await evaluateWeek(env, chat, monday);
    expect(report).toMatchObject({ messages: 0, authors: 0, badges: [] });
    expect(f.rows('SELECT state FROM achievement_reports')).toEqual([{ state: 'silent' }]);
    // With CountersDO unavailable, a fresh evaluation would fail.
    const replay = await evaluateWeek({ ...env, COUNTERS_DO: undefined } as unknown as Env, chat, monday);
    expect(replay).toEqual(report);
  });
  it('refuses an empty-day certificate when a first write crashed before the day marker was created', async () => {
    const f = fixture();
    const storage = new Map<string, unknown>([['integrity:' + friday + ':base', { activeAttemptSeq: 1 }]]);
    const counter = new CountersDO({
      storage: {
        get: async (key: string) => storage.get(key),
        put: async (key: string, value: unknown) => { storage.set(key, value); },
        list: async ({ prefix }: { prefix: string }) => new Map([...storage].filter(([key]) => key.startsWith(prefix))),
      },
      blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
    } as unknown as ConstructorParameters<typeof CountersDO>[0], f.env);
    const response = await counter.fetch(new Request('https://do/pipeline-snapshots', {
      method: 'POST', body: JSON.stringify({ days: [monday, friday], verifyEmpty: true }),
    }));
    const proof = await response.json() as { emptyDays: string[] };
    expect(proof.emptyDays).toEqual([monday]);
  });
  it('scopes personal evidence to enrollment, guards repeated evaluations and erases one owner only', async () => {
    const f = fixture(); seed(f);
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T12:00:00Z'));
    await setEnrolled(f.db, chat, person, true, new Date(monday + 'T12:00:00Z'));
    await evaluatePersonal(f.env, chat, person, monday);
    expect(await getProgress(f.db, chat, person)).toEqual([]);
    const tuesday = shiftDay(monday, 1);
    for (const day of daysBetween(tuesday, friday)) await evaluatePersonal(f.env, chat, person, day);
    expect((await listAwards(f.db, chat, person)).find(a => a.badge_id === 'radio-diary')?.earned_day).toBe('2026-01-08');
    await evaluatePersonal(f.env, chat, person, tuesday);
    expect((await getEnrollment(f.db, chat, person))?.last_day).toBe(friday);
    await setGroupEnabled(f.db, chat, false);
    expect(await getProgress(f.db, chat, person)).toEqual([]);
    expect((await listAwards(f.db, chat, person)).length).toBeGreaterThan(0);
    await eraseAlbum(f.db, chat, person);
    expect(await getEnrollment(f.db, chat, person)).toBeNull();
    expect(await listAwards(f.db, chat, person)).toEqual([]);
  });
  it('checks a complete 42-day live album in two bounded DO calls', async () => {
    const f = fixture();
    const env = withRealCountersDO(f.env);
    const namespace = env.COUNTERS_DO;
    const stub = namespace.get(namespace.idFromName(String(chat)));
    const post = (path: string, payload: object) => stub.fetch('https://do/' + path, {
      method: 'POST', body: JSON.stringify(payload),
    });
    await setGroupEnabled(f.db, chat, true, new Date(monday + 'T00:00:00Z'));
    await setEnrolled(f.db, chat, person, true, new Date(monday + 'T00:00:00Z'));
    const end = shiftDay(monday, 41);
    for (const [index, day] of daysBetween(monday, end).entries()) {
      const messageId = index + 1;
      await post('inc', { chatId: chat, userId: person, username: 'fixture', day, hour: 6, messageId });
      for (const category of ['profanity', 'criminal']) {
        await post('ack', { chatId: chat, day, sequence: 1, messageId, category, outcome: 'skipped' });
      }
    }
    const chunkSizes: number[] = [];
    const tracked = {
      ...env,
      COUNTERS_DO: {
        idFromName: () => namespace.idFromName(String(chat)),
        get: () => ({
          fetch: (url: string, init: { body: string; method: string }) => {
            chunkSizes.push(JSON.parse(init.body).days.length);
            return stub.fetch(url, init);
          },
        }),
      },
    } as unknown as Env;
    await evaluatePersonal(tracked, chat, person, end);
    expect(chunkSizes).toEqual([30, 12]);
    expect((await listAwards(f.db, chat, person)).map(a => a.badge_id)).toContain('regular');
  });
  it('calibrates a read-only historical fixture without printing chat/user IDs', async () => {
    const f = fixture(); seed(f);
    markReady(f, shiftDay(monday, -41), shiftDay(monday, -29));
    const add = f.sqlite.prepare('INSERT INTO stats_daily_user (chat_id,user_id,day,message_count) VALUES (?,?,?,1)');
    for (const owner of [person, person + 1, person + 2, person + 10]) add.run(chat, owner, shiftDay(monday, -1));
    add.run(chat, person + 4, monday);
    const dir = mkdtempSync(join(tmpdir(), 'badge-calibration-'));
    try {
      const dbPath = join(dir, 'history.sqlite'); await f.sqlite.backup(dbPath);
      const json = execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/calibrate-achievements.mjs',
        dbPath, monday, shiftDay(monday, 6)], { encoding: 'utf8' });
      const result = JSON.parse(json);
      expect(result.cohorts['1–5'].participants).toBe(5);
      expect(result.cohorts['1–5'].participantsWithoutObservedUnlock).toBe(1);
      expect(result.cohorts['1–5'].badges['rush-hour'].unlocked).toBe(1);
      expect(result.cohorts['1–5'].medianDaysToFirstPersonalUnlock).toBe(1);
      expect(result.cohorts['1–5'].badges.tomorrow.medianDaysToUnlock).toBe(1);
      expect(json).not.toContain(String(chat));
    } finally { rmSync(dir, { force: true, recursive: true }); }
  });
  it('uses inclusive 7-, 28- and 42-day windows and excludes missing lookback coverage', async () => {
    const f = fixture();
    markReady(f, shiftDay(monday, -41), monday);
    const add = f.sqlite.prepare(`INSERT INTO stats_daily_user
      (chat_id,user_id,day,message_count,word_count,video_note_count) VALUES (?,?,?,1,?,?)`);
    for (const [owner, offsets] of [[1, [-6, -1, 0]], [2, [-7, -1, 0]],
      [3, [-27, -1, 0]], [4, [-28, -1, 0]],
      [5, [-41, -5, -4, -3, -2, -1, 0]], [6, [-48, -5, -4, -3, -2, -1, 0]]] as const) {
      for (const offset of offsets) add.run(chat, owner, shiftDay(monday, offset),
        owner === 3 || owner === 4 ? 100 : 0, owner <= 2 ? 1 : 0);
    }
    const dir = mkdtempSync(join(tmpdir(), 'badge-lookback-'));
    try {
      const run = async (name: string) => {
        const dbPath = join(dir, name + '.sqlite'); await f.sqlite.backup(dbPath);
        return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types',
          'scripts/calibrate-achievements.mjs', dbPath, monday, monday], { encoding: 'utf8' }));
      };
      const complete = (await run('complete')).cohorts['6–20'];
      expect(complete.participants).toBe(6);
      for (const id of ['film', 'columnist', 'calendar']) {
        expect(complete.badges[id]).toMatchObject({ eligible: 6, unlocked: 1, medianDaysToUnlock: 1 });
      }
      f.sqlite.prepare("UPDATE stats_daily_coverage SET base_status='partial' WHERE day=?").run(shiftDay(monday, -41));
      const partial = await run('partial');
      expect(partial.excludedPartialPersonalGroups).toBe(1);
      expect(partial.cohorts['6–20'].participants).toBe(0);
      expect(partial.cohorts['6–20'].badges.calendar).toMatchObject({ eligible: 0, fraction: null });
    } finally { rmSync(dir, { force: true, recursive: true }); }
  });
  it('reports invalid calendar dates through CLI usage before opening the snapshot', () => {
    for (const day of ['2026-13-01', '2026-02-30']) {
      const run = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/calibrate-achievements.mjs',
        'unused.sqlite', day, day], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('1–180 closed UTC days');
      expect(run.stderr).not.toContain('RangeError');
    }
  });
});
