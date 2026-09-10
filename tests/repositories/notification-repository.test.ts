/**
 * Тесты для NotificationRepository.getScheduledNotifications
 * Покрывают инвариант "scheduled_notifications_list содержит только загружаемые записи":
 *  - истёкшие/удалённые KV-записи (HISTORY.get -> null) удаляются из списка;
 *  - повреждённые записи (JSON.parse бросает) удаляются из списка (существующее поведение);
 *  - валидные записи, отфильтрованные по chatId/status, остаются в списке.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationRepository } from '../../src/core/repositories/notification-repository';
import type { ScheduledNotification } from '../../src/core/models/notification-settings';

// Мокаем логгер, чтобы не городить зависимостей и шуметь в выводе
vi.mock('../../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  }
}));

// Лёгкий in-memory фейк KV: ведёт себя как Cloudflare KV (get возвращает null для отсутствующих).
function createFakeKV() {
  const store = new Map<string, string>();
  const kv = {
    get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    put: vi.fn((k: string, v: string) => { store.set(k, v); return Promise.resolve(); }),
    delete: vi.fn((k: string) => { store.delete(k); return Promise.resolve(); }),
  };
  return kv;
}

function makeNotification(overrides: Partial<ScheduledNotification> = {}): ScheduledNotification {
  return {
    id: 'n-1',
    chatId: '1',
    notificationType: 'daily_summary',
    scheduledAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    status: 'pending',
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

describe('NotificationRepository.getScheduledNotifications list-prune', () => {
  let env: any;

  beforeEach(() => {
    env = { HISTORY: createFakeKV() };
  });

  it('prunes an id whose KV entry is missing (TTL-expired / deleted)', async () => {
    const repo = new NotificationRepository(env);
    const id = 'n-1';
    const notif = makeNotification({ id });

    // Сидим через публичный API — регистрирует id в scheduled_notifications_list.
    await repo.saveScheduledNotification(notif);
    expect(JSON.parse((await env.HISTORY.get('scheduled_notifications_list'))!)).toContain(id);

    // Симулируем истечение TTL: запись исчезла, список остался.
    env.HISTORY.delete(`scheduled_notification:${id}`);

    const result = await repo.getScheduledNotifications();

    // Корректирующее поведение: истёкший id удалён из списка.
    expect(result).toEqual([]);
    expect(JSON.parse((await env.HISTORY.get('scheduled_notifications_list'))!)).toEqual([]);
  });

  it('still prunes corrupt (un-parseable) entries from the list', async () => {
    const repo = new NotificationRepository(env);
    const notif = makeNotification({ id: 'corrupt' });
    await repo.saveScheduledNotification(notif);

    // Пишем мусор, который JSON.parse не сможет разобрать.
    await env.HISTORY.put(`scheduled_notification:corrupt`, '{ not valid json');

    const result = await repo.getScheduledNotifications();

    expect(result).toEqual([]);
    expect(JSON.parse((await env.HISTORY.get('scheduled_notifications_list'))!)).toEqual([]);
  });

  it('respects chatId and status filters without pruning filtered-out valid entries', async () => {
    const repo = new NotificationRepository(env);
    const a = makeNotification({ id: 'a', chatId: 'c1', status: 'pending' });
    const b = makeNotification({ id: 'b', chatId: 'c2', status: 'sent' });

    await repo.saveScheduledNotification(a);
    await repo.saveScheduledNotification(b);

    const result = await repo.getScheduledNotifications('c1', 'pending');

    expect(result.map(n => n.id)).toEqual(['a']);
    // b не попал в результат из-за фильтра, но должен остаться в списке.
    expect(JSON.parse((await env.HISTORY.get('scheduled_notifications_list'))!)).toEqual(['a', 'b']);
  });
});
