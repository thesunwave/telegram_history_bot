import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationRepository } from '../src/core/repositories/notification-repository';
import { NotificationValidationUtils } from '../src/core/models/notification-validation';
import { parseActivityReportHour, runActivityReportCron } from '../src/features/notifications/activity-report';
import { sendMessage } from '../src/core/telegram';
import type { Env } from '../src/core/env';

vi.mock('../src/core/telegram', () => ({ sendMessage: vi.fn().mockResolvedValue(undefined) }));

const RUN_AT = Date.parse('2026-10-15T18:00:00Z');

function harness(messages = 7, users = 3) {
  const kv = new Map<string, string>();
  const claims = new Map<string, string>();
  const prepare = vi.fn((sql: string) => ({
    bind: (...params: unknown[]) => ({
      first: async () => {
        if (!sql.includes('FROM stats_daily_user')) throw new Error('Unexpected read');
        expect(params).toEqual([-100123, '2026-10-14']);
        return { messages, users };
      },
      run: async () => {
        const key = params.join(':');
        if (sql.includes('INSERT OR IGNORE')) {
          if (claims.has(key)) return { meta: { changes: 0 } };
          claims.set(key, 'claimed');
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE activity_report_delivery')) {
          claims.set(key, sql.includes("'sent'") ? 'sent' : 'failed');
          return { meta: { changes: 1 } };
        }
        throw new Error('Unexpected write');
      },
    }),
  }));
  const env = {
    ENABLE_ACTIVITY_TRACKING: 'true',
    HISTORY: {
      get: async (key: string) => kv.get(key) ?? null,
      put: async (key: string, value: string) => { kv.set(key, value); },
      delete: async (key: string) => { kv.delete(key); },
    },
    DB: { prepare },
  } as unknown as Env;
  return { env, claims, prepare, repository: new NotificationRepository(env) };
}

async function enable(repository: NotificationRepository, hour = 18) {
  const settings = NotificationValidationUtils.createDefaultChatSettings('-100123', '123');
  settings.enabled = true;
  settings.notifications.activity_summary.enabled = true;
  settings.notifications.activity_summary.time = { hour, minute: 0, timezone: 'UTC' };
  await repository.saveChatSettings(settings);
  return settings;
}

describe('opt-in activity report', () => {
  beforeEach(() => vi.mocked(sendMessage).mockReset().mockResolvedValue(undefined));

  it('does not send to chats without an explicit opt-in', async () => {
    const { env, repository, prepare } = harness();
    const settings = await enable(repository);
    settings.enabled = false;
    await repository.saveChatSettings(settings);
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    settings.enabled = true;
    settings.notifications.activity_summary.enabled = false;
    await repository.saveChatSettings(settings);
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('checks UTC hour and global activity tracking before touching D1', async () => {
    const { env, repository, prepare } = harness();
    await enable(repository, 19);
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    (env as any).ENABLE_ACTIVITY_TRACKING = 'false';
    expect(await runActivityReportCron(env, RUN_AT + 3_600_000)).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('does not activate old legacy activity settings without explicit UTC opt-in', async () => {
    const { env, repository } = harness();
    const settings = await enable(repository);
    settings.notifications.activity_summary.time = { hour: 18, minute: 0 };
    await repository.saveChatSettings(settings);
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('sends real previous-day D1 activity and claims the day exactly once', async () => {
    const { env, repository, claims } = harness(19, 4);
    await enable(repository);
    expect(await runActivityReportCron(env, RUN_AT)).toBe(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(env, -100123,
      expect.stringContaining('💬 Сообщений: 19'));
    expect(vi.mocked(sendMessage).mock.calls[0][2]).toContain('👥 Активных участников: 4');
    expect(claims.get('-100123:2026-10-14')).toBe('sent');
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent invocations with the same chat and report day', async () => {
    const { env, repository, claims } = harness();
    await enable(repository);
    const results = await Promise.all([
      runActivityReportCron(env, RUN_AT),
      runActivityReportCron(env, RUN_AT),
    ]);
    expect(results.sort()).toEqual([0, 1]);
    expect(claims.get('-100123:2026-10-14')).toBe('sent');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('reports empty completed days without placeholders', async () => {
    const { env, repository } = harness(0, 0);
    await enable(repository);
    expect(await runActivityReportCron(env, RUN_AT)).toBe(1);
    expect(vi.mocked(sendMessage).mock.calls[0][2]).toContain('Сообщений: 0');
    expect(vi.mocked(sendMessage).mock.calls[0][2]).not.toMatch(/{{|placeholder/i);
  });

  it('never blindly retries an ambiguous Telegram failure', async () => {
    const { env, repository, claims } = harness();
    await enable(repository);
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error('network timeout'));
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    expect(claims.get('-100123:2026-10-14')).toBe('failed');
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('accepts whole UTC hours and rejects unsupported minute/timezone values', async () => {
    expect(parseActivityReportHour('0')).toBe(0);
    expect(parseActivityReportHour('18:00')).toBe(18);
    for (const input of ['24:00', '18:30', '-1', 'UTC', '18:00 Europe/Nicosia', '']) {
      expect(parseActivityReportHour(input)).toBeNull();
    }
    const { env, repository } = harness();
    const settings = await enable(repository);
    settings.notifications.activity_summary.time = { hour: 18, minute: 30 };
    await repository.saveChatSettings(settings);
    expect(await runActivityReportCron(env, RUN_AT)).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
