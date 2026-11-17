import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from '../src/core/env';
import worker from '../src/index';
import {
  TELEMETRY_ENDPOINT,
  bucketChats,
  handleTelemetryPing,
  parseTelemetryPayload,
  sendTelemetryPing,
} from '../src/features/telemetry/telemetry';

// Minimal D1 facade over node:sqlite, enough for prepare/bind/run/first.
function createDb() {
  const sqlite = new Database(':memory:');
  for (const file of ['0009_stats_daily_aggregates.sql', '0014_app_settings.sql', '0016_telemetry_installs.sql']) {
    sqlite.exec(readFileSync(join(fileURLToPath(new URL('../migrations/', import.meta.url).href), file), 'utf8'));
  }
  const prepare = (sql: string) => {
    let params: any[] = [];
    const statement = {
      bind(...values: any[]) { params = values; return statement; },
      async run() { sqlite.prepare(sql).run(...params); return { success: true }; },
      async first<T>() { return (sqlite.prepare(sql).get(...params) ?? null) as T; },
    };
    return statement;
  };
  return { sqlite, db: { prepare } as unknown as Env['DB'] };
}

const uuid = '123e4567-e89b-42d3-a456-426614174000';

describe('anonymous telemetry ping', () => {
  it('buckets chat counts coarsely', () => {
    expect([0, 1, 2, 5, 6, 20, 21, 100, 101].map(bucketChats))
      .toEqual(['0', '1', '2-5', '2-5', '6-20', '6-20', '21-100', '21-100', '100+']);
  });

  it('sends only a stable random id and buckets', async () => {
    const { sqlite, db } = createDb();
    const today = new Date().toISOString().slice(0, 10);
    const insert = sqlite.prepare('INSERT INTO stats_daily_user(chat_id, day, user_id, message_count) VALUES (?, ?, ?, 1)');
    insert.run(-1001, today, 1);
    insert.run(-1002, today, 2);
    insert.run(42, today, 42);
    insert.run(-1003, '2020-01-01', 3);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const env = { DB: db } as Env;

    expect(await sendTelemetryPing(env, fetchImpl as any)).toBe('sent');
    expect(await sendTelemetryPing(env, fetchImpl as any)).toBe('sent');

    const calls = fetchImpl.mock.calls as any[];
    expect(calls[0][0]).toBe(TELEMETRY_ENDPOINT);
    const first = JSON.parse(calls[0][1].body);
    const second = JSON.parse(calls[1][1].body);
    expect(Object.keys(first).sort()).toEqual(['activeChats7d', 'activeGroups7d', 'installId', 'schema']);
    expect(first).toMatchObject({ schema: 1, activeChats7d: '2-5', activeGroups7d: '2-5' });
    expect(second.installId).toBe(first.installId);
    expect(calls[0][1].body).not.toContain('1001');
  });

  it('respects opt-out and the receiver flag, and never throws', async () => {
    const fetchImpl = vi.fn();
    expect(await sendTelemetryPing({ TELEMETRY_DISABLED: 'true' } as Env, fetchImpl as any)).toBe('disabled');
    expect(await sendTelemetryPing({ TELEMETRY_RECEIVER: true } as Env, fetchImpl as any)).toBe('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
    const { db } = createDb();
    const failing = vi.fn(async () => { throw new Error('network'); });
    expect(await sendTelemetryPing({ DB: db } as Env, failing as any)).toBe('failed');
  });

  it('validates payloads strictly', () => {
    const valid = { schema: 1, installId: uuid, activeChats7d: '1', activeGroups7d: '0' };
    expect(parseTelemetryPayload(valid)).toEqual(valid);
    expect(parseTelemetryPayload({ ...valid, extra: 'chat' })).toEqual(valid);
    expect(parseTelemetryPayload({ ...valid, installId: 'not-a-uuid' })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, activeChats7d: '7' })).toBeNull();
    expect(parseTelemetryPayload({ ...valid, schema: 2 })).toBeNull();
  });

  it('stores pings only on the receiver and counts distinct days', async () => {
    const { sqlite, db } = createDb();
    const body = JSON.stringify({ schema: 1, installId: uuid, activeChats7d: '1', activeGroups7d: '1' });
    const post = (env: Env, text = body) => handleTelemetryPing(
      new Request('https://x' + '/telemetry/v1/ping', { method: 'POST', body: text }), env);

    expect((await post({ DB: db } as Env)).status).toBe(404);
    const receiver = { DB: db, TELEMETRY_RECEIVER: true } as Env;
    expect((await post(receiver)).status).toBe(204);
    expect((await post(receiver)).status).toBe(204);
    expect((await post(receiver, '{')).status).toBe(400);
    expect((await post(receiver, 'x'.repeat(2000))).status).toBe(413);

    const rows = sqlite.prepare('SELECT * FROM telemetry_installs').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ install_id: uuid, ping_days: 1, active_chats_7d: '1' });
    sqlite.prepare("UPDATE telemetry_installs SET last_seen = '2020-01-01'").run();
    await post(receiver);
    expect((sqlite.prepare('SELECT ping_days FROM telemetry_installs').get() as any).ping_days).toBe(2);
  });

  it('pings from the daily cron even when the summary fails', async () => {
    vi.resetModules();
    vi.doMock('../src/features/stats/stats', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/features/stats/stats')>()),
      dailySummary: vi.fn(async () => { throw new Error('summary failed'); }),
    }));
    const { default: freshWorker } = await import('../src/index');
    const { db } = createDb();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    try {
      await expect(freshWorker.scheduled({ cron: '59 23 * * *' } as any, { DB: db, ENABLE_SUMMARY: 'true' } as Env, { waitUntil() {} } as any))
        .rejects.toThrow('summary failed');
      const pings = fetchSpy.mock.calls.filter(([url]) => String(url) === TELEMETRY_ENDPOINT);
      expect(pings).toHaveLength(1);
    } finally {
      fetchSpy.mockRestore();
      vi.doUnmock('../src/features/stats/stats');
      vi.resetModules();
    }
  });

  it('routes the public endpoint through the worker', async () => {
    const { db } = createDb();
    const env = { DB: db, TELEMETRY_RECEIVER: 'true' } as unknown as Env;
    const response = await worker.fetch(new Request('https://tghistory.thesunwave.space/telemetry/v1/ping', {
      method: 'POST',
      body: JSON.stringify({ schema: 1, installId: uuid, activeChats7d: '0', activeGroups7d: '0' }),
    }), env, { waitUntil() {} } as any);
    expect(response.status).toBe(204);
  });
});
