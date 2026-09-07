/**
 * Real-KV integration test for the stale-id prune fix.
 *
 * Uses @miniflare/kv's real KVNamespace (backed by MemoryStorage with a
 * controllable clock) to drive actual `expirationTtl` semantics — exercising
 * the same code path the production worker hits against real Cloudflare KV.
 * Confirms that once the per-notification entry's TTL elapses, `HISTORY.get`
 * returns `null` (the Cloudflare KV contract on expiry) and
 * `getScheduledNotifications` prunes the id from `scheduled_notifications_list`.
 *
 * NOTE on the clock: MemoryStorage stores per-entry expiration at put time
 * as `clock() + ttl` and re-validates it on every get using its own clock.
 * KVNamespace also uses clock for ttl computation. Both must share the same
 * controllable clock — see MemoryStorage(map, clock) signature.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KVNamespace } from '@miniflare/kv';
import { MemoryStorage } from '@miniflare/storage-memory';
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

describe('NotificationRepository getScheduledNotifications — real-KV TTL expiry (E2E)', () => {
  let nowMs: number;
  let history: KVNamespace;
  let env: any;

  beforeEach(() => {
    nowMs = T0_MS;
    const clock = () => nowMs;
    const storage = new MemoryStorage(new Map(), clock);
    history = new KVNamespace(storage, { clock });
    env = { HISTORY: history } as any;
  });

  it('prunes an id whose KV entry actually TTL-expires', async () => {
    const repo = new NotificationRepository(env);
    const id = 'n-1';
    // saveScheduledNotification reads Date.now() to compute the entry's TTL,
    // so align Date.now() with the controllable KV clock during the seed.
    await withClock(nowMs, async () => {
      await repo.saveScheduledNotification(makeNotification(nowMs, { id }));
    });

    expect(JSON.parse((await history.get('scheduled_notifications_list'))!)).toContain(id);
    expect(await history.get(`scheduled_notification:${id}`)).not.toBeNull();

    // saveScheduledNotification computes ttlSeconds = max(floor((scheduledAt - now)/1000) + 7*86400, 86400).
    // With scheduledAt = now + 60s, ttlSeconds = 60 + 604800 = 604860 (~7 days).
    // Advance the controllable clock 8 days — past the TTL.
    nowMs += 8 * DAY_MS;

    // Real Cloudflare KV contract: after TTL elapses, get returns null.
    expect(await history.get(`scheduled_notification:${id}`)).toBeNull();
    // The list key has a 365-day TTL and is still alive.
    expect(JSON.parse((await history.get('scheduled_notifications_list'))!)).toContain(id);

    // The fix must prune the now-stale id during enumeration.
    const result = await withClock(nowMs, () => repo.getScheduledNotifications());
    expect(result).toEqual([]);
    expect(JSON.parse((await history.get('scheduled_notifications_list'))!)).toEqual([]);
  });

  it('prunes one expired id while keeping a still-live id (real TTL cascade)', async () => {
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
        scheduledAt: new Date(nowMs - 16_000),
      }));
    });

    // Advance 7 days. The stale entry (ttl ~6.8 days) has expired; the live
    // entry (ttl ~8 days) is still within TTL.
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
