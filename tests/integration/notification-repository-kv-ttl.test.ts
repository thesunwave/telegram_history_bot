/**
 * Exercises stale-id pruning against real Miniflare KV. Deleting a KV entry
 * simulates it becoming absent after expiry, without waiting days for the TTL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createKVBindings } from '../helpers/miniflare-kv';
import type { KVNamespace } from '@cloudflare/workers-types';
import { NotificationRepository } from '../../src/core/repositories/notification-repository';
import type { ScheduledNotification } from '../../src/core/models/notification-settings';

vi.mock('../../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  }
}));

const T0_MS = Date.parse('2026-01-01T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function makeNotification(now: number, overrides: Partial<ScheduledNotification> = {}): ScheduledNotification {
  const notif: ScheduledNotification = {
    id: 'n-1',
    chatId: '1',
    notificationType: 'daily_summary',
    scheduledAt: new Date(now + 60_000),
    createdAt: new Date(now),
    status: 'pending',
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
  return notif;
}

async function withClock<T>(nowMs: number, fn: () => Promise<T>): Promise<T> {
  const realDateNow = Date.now;
  Date.now = () => nowMs;
  try {
    return await fn();
  } finally {
    Date.now = realDateNow;
  }
}

describe('NotificationRepository getScheduledNotifications — missing KV entries', () => {
  let nowMs: number;
  let history: KVNamespace;
  let env: any;
  let bindings: Awaited<ReturnType<typeof createKVBindings>>;

  beforeEach(async () => {
    nowMs = T0_MS;
    bindings = await createKVBindings();
    history = bindings.history as unknown as KVNamespace;
    env = { HISTORY: history } as any;
  });

  afterEach(async () => {
    await bindings.mf.dispose();
  });

  it('prunes an id after its KV entry becomes absent', async () => {
    const repo = new NotificationRepository(env);
    const id = 'n-1';
    // saveScheduledNotification reads Date.now() to compute the entry's TTL,
    // use the fixed time when saving the notification.
    await withClock(nowMs, async () => {
      await repo.saveScheduledNotification(makeNotification(nowMs, { id }));
    });

    expect(JSON.parse((await history.get('scheduled_notifications_list'))!)).toContain(id);
    expect(await history.get(`scheduled_notification:${id}`)).not.toBeNull();

    // KV returns null for missing entries, including ones that have expired.
    await history.delete(`scheduled_notification:${id}`);
    nowMs += 8 * DAY_MS;

    expect(await history.get(`scheduled_notification:${id}`)).toBeNull();
    // The list key has a 365-day TTL and is still alive.
    expect(JSON.parse((await history.get('scheduled_notifications_list'))!)).toContain(id);

    // The fix must prune the now-stale id during enumeration.
    const result = await withClock(nowMs, () => repo.getScheduledNotifications());
    expect(result).toEqual([]);
    expect(JSON.parse((await history.get('scheduled_notifications_list'))!)).toEqual([]);
  });

  it('prunes one missing id while keeping an existing id', async () => {
    const repo = new NotificationRepository(env);
    // live: scheduled 60s in the future, ttl ~ 7+ days
    // stale: scheduled in the past, ttlSeconds = max(floor(negative)+604800, 86400).
    //   With scheduledAt = now - 16_000s, ttl = max(-16000 + 604800, 86400) = 588800s (~6.8d).
    await withClock(nowMs, async () => {
      await repo.saveScheduledNotification(makeNotification(nowMs, {
        id: 'live',
        scheduledAt: new Date(nowMs + 60_000),
      }));
      await repo.saveScheduledNotification(makeNotification(nowMs, {
        id: 'stale',
        scheduledAt: new Date(nowMs - 16_000_000),
      }));
    });

    // Simulate the stale entry expiring without modifying the runtime clock.
    await history.delete('scheduled_notification:stale');
    nowMs += 7 * DAY_MS;

    const staleBefore = await history.get(`scheduled_notification:stale`);
    const liveBefore = await history.get(`scheduled_notification:live`);
    expect(staleBefore).toBeNull();
    expect(liveBefore).not.toBeNull();

    const result = await withClock(nowMs, () => repo.getScheduledNotifications());
    expect(result.map(n => n.id)).toEqual(['live']);
    expect(JSON.parse((await history.get('scheduled_notifications_list'))!)).toEqual(['live']);
  });
});
