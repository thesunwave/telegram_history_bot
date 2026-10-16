import { describe, it, expect, vi } from 'vitest';
import { recordMessage } from '../src/api/update';

function makeEnv() {
  const put = vi.fn(async (_key: string, _value: string, _options?: { expiration?: number }) => {});
  const env = {
    TOKEN: 'test-token',
    HISTORY: { put },
    ENABLE_ACTIVITY_TRACKING: false,
    ENABLE_PROFANITY_ANALYSIS: false,
    ENABLE_CRIMINAL_ANALYSIS: false,
  } as any;
  return { env, put };
}

function message(ts: number) {
  return {
    chat: { id: 123, type: 'supergroup', title: 'Test Group' },
    from: { id: 456, username: 'test_member' },
    message_id: 789,
    text: 'Private conversation',
    date: ts,
  };
}

describe('fallback raw message retention', () => {
  it('expires stored content relative to the original message timestamp', async () => {
    const { env, put } = makeEnv();
    const ts = Math.floor(Date.now() / 1000) - 3600;
    await recordMessage(message(ts), env);
    const rawWrite = put.mock.calls.find(([key]) => key.startsWith('msg:'));
    expect(rawWrite).toBeDefined();
    expect(rawWrite![2]).toEqual({ expiration: ts + 7 * 86400 });
  });

  it('does not resurrect message text that is already past retention', async () => {
    const { env, put } = makeEnv();
    const ts = Math.floor(Date.now() / 1000) - 8 * 86400;
    await recordMessage(message(ts), env);
    expect(put.mock.calls.filter(([key]) => key.startsWith('msg:'))).toHaveLength(0);
  });

  it('never writes raw messages to KV or a day-block when stats-only is selected', async () => {
    const { env, put } = makeEnv();
    env.RAW_MESSAGE_STORAGE_MODE = 'stats_only';
    env.DAY_BLOCK_MANAGER_DO = { idFromName: vi.fn(), get: vi.fn() };
    await recordMessage(message(Math.floor(Date.now() / 1000)), env);
    expect(put.mock.calls.filter(([key]) => key.startsWith('msg:') || key.startsWith('msg_day:'))).toHaveLength(0);
    expect(env.DAY_BLOCK_MANAGER_DO.get).not.toHaveBeenCalled();
    expect(put.mock.calls.some(([key]) => key.startsWith('admin_chat:'))).toBe(true);
  });
});
