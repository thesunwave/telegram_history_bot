import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleUpdate } from '../src/api/update';
import type { Env } from '../src/core/env';

afterEach(() => vi.unstubAllGlobals());

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    TOKEN: 'test-token',
    ENABLE_ACTIVITY_TRACKING: false,
    ENABLE_SUMMARY: false,
    ENABLE_PROFANITY_ANALYSIS: false,
    ENABLE_CRIMINAL_ANALYSIS: false,
    ...overrides,
  } as Env;
}

function message(command: string) {
  return { text: command, chat: { id: -1001 }, from: { id: 41 },
    date: Math.floor(Date.now() / 1000) };
}

describe('disabled feature commands', () => {
  it('blocks all disabled feature families instead of reading stale stored data', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const env = makeEnv();
    for (const command of ['/top', '/activity_week', '/profanity_top', '/summary',
      '/summary_last', '/criminal_stats', '/criminal_backfill']) {
      await handleUpdate(message(command), env);
    }
    expect(fetchMock).toHaveBeenCalledTimes(7);
    const replies = fetchMock.mock.calls.map(call => JSON.stringify(call));
    expect(replies.join('\n')).toContain('отключен');
  });

  it('denies history-dependent commands in stats-only mode even with stale flags', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const env = makeEnv({ RAW_MESSAGE_STORAGE_MODE: 'stats_only',
      ENABLE_SUMMARY: true, ENABLE_CRIMINAL_ANALYSIS: true });
    await handleUpdate(message('/summary'), env);
    await handleUpdate(message('/criminal_backfill'), env);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
