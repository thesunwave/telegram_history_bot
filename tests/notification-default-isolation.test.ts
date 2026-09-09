/**
 * Регрессионные тесты изоляции настроек уведомлений по умолчанию.
 *
 * Гарантируют, что `NotificationValidationUtils.createDefaultChatSettings`
 * возвращает глубокую копию `DEFAULT_NOTIFICATION_SETTINGS` (включая вложенную
 * карту `notifications` и объекты `time` внутри неё), так, чтобы ни сервисные
 * мутации (enable/disable/updateNotificationSettings), ни санитизатор на
 * каждом чтении сохранённых настроек чата не могли записать через общую
 * ссылку в module-level константу и загрязнить дефолт для последующих чатов
 * в том же Cloudflare Workers isolate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotificationService } from '../src/core/services/notification-service';
import { NotificationRepository } from '../src/core/repositories/notification-repository';
import {
  NotificationValidationUtils,
  NotificationDataSanitizer,
  validateChatNotificationSettings
} from '../src/core/models/notification-validation';
import {
  DEFAULT_NOTIFICATION_SETTINGS
} from '../src/core/models/notification-settings';
import type {
  ChatNotificationSettings,
  NotificationType,
  NotificationTypeSettings
} from '../src/core/models/notification-settings';
import type { Env } from '../src/core/env';
import { createMockEnv } from './test-utils';

vi.mock('../src/core/telegram', () => ({
  sendMessage: vi.fn().mockResolvedValue('123')
}));

vi.mock('../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
    log: vi.fn()
  }
}));

const NOTIFICATION_TYPES: NotificationType[] = [
  'criminal_reports',
  'profanity_reports',
  'activity_summary',
  'daily_summary',
  'weekly_summary',
  'monthly_summary'
];

/**
 * Глубокий снимок эталонных значений `notifications`, сделанный один раз при
 * загрузке модуля. Используется в `beforeEach` для восстановления эталона в
 * module-level константе, чтобы каждый тест начинался с чистого состояния
 * независимо от порядка выполнения (актуально, если регрессия вернётся —
 * тогда мутации переносились бы между `it` в одном файле).
 */
const PRISTINE_NOTIFICATIONS = JSON.parse(
  JSON.stringify(DEFAULT_NOTIFICATION_SETTINGS.notifications)
) as ChatNotificationSettings['notifications'];

function resetDefaultSingleton(): void {
  for (const key of NOTIFICATION_TYPES) {
    const pristine = PRISTINE_NOTIFICATIONS[key];
    DEFAULT_NOTIFICATION_SETTINGS.notifications[key] = {
      ...pristine,
      ...(pristine.time ? { time: { ...pristine.time } } : {})
    };
  }
}

/**
 * Построить mock репозитория, реализующий `INotificationRepository` виом-ами.
 */
function createMockRepository() {
  return {
    getChatSettings: vi.fn(),
    saveChatSettings: vi.fn(),
    deleteChatSettings: vi.fn(),
    getNotificationStats: vi.fn(),
    updateNotificationStats: vi.fn(),
    recordNotificationResult: vi.fn(),
    getScheduledNotifications: vi.fn(),
    saveScheduledNotification: vi.fn(),
    updateScheduledNotification: vi.fn(),
    deleteScheduledNotification: vi.fn(),
    getAllChatIds: vi.fn(),
    cleanupOldNotifications: vi.fn()
  } as any;
}

/**
 * Прямое засевание KV для реального репозитория (минуя сервис, чтобы
 * исключить влияние пути enable при проверке санитизатора).
 */
async function seedChatSettings(
  env: Env,
  chatId: string,
  type: NotificationType,
  enabled: boolean
): Promise<void> {
  const base = NotificationValidationUtils.createDefaultChatSettings(chatId, 'seeder');
  base.notifications[type].enabled = enabled;
  base.enabled = true;
  const key = `notification_settings:${chatId}`;
  await env.HISTORY.put(key, JSON.stringify(base));
}

describe('createDefaultChatSettings — глубокая копия (изоляция ссылок)', () => {
  beforeEach(resetDefaultSingleton);

  it('возвращает настройки, не разделяющие ссылку на карту notifications с дефолтом', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    expect(settings.notifications).not.toBe(DEFAULT_NOTIFICATION_SETTINGS.notifications);
  });

  it('каждый per-type вход — независимая копия (не та же ссылка, что в дефолте)', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    for (const type of NOTIFICATION_TYPES) {
      expect(settings.notifications[type]).not.toBe(
        DEFAULT_NOTIFICATION_SETTINGS.notifications[type]
      );
    }
  });

  it('объект time каждого типа — независимая копия (глубокая копия)', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    for (const type of NOTIFICATION_TYPES) {
      const sourceTime = DEFAULT_NOTIFICATION_SETTINGS.notifications[type].time;
      if (sourceTime) {
        expect(settings.notifications[type].time).toBeDefined();
        expect(settings.notifications[type].time).not.toBe(sourceTime);
      }
    }
  });

  it('мутация возвращённого settings.notifications[type].enabled не загрязняет дефолт', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    settings.notifications.criminal_reports.enabled = true;
    settings.notifications.profanity_reports.enabled = true;

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.enabled).toBe(false);
  });

  it('мутация возвращённого settings.notifications[type].time не загрязняет дефолт', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    settings.notifications.profanity_reports.time!.hour = 23;
    settings.notifications.profanity_reports.time!.minute = 59;

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.time!.hour).toBe(9);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.time!.minute).toBe(0);
  });

  it('мутация примитивов верхнего уровня (enabled/adminOnly) не загрязняет дефолт', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    settings.enabled = true;
    settings.adminOnly = true;

    expect(DEFAULT_NOTIFICATION_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.adminOnly).toBe(false);
  });

  it('два последовательных вызова возвращают независимые объекты', () => {
    const a = NotificationValidationUtils.createDefaultChatSettings('chat-a', 'user-a');
    const b = NotificationValidationUtils.createDefaultChatSettings('chat-b', 'user-b');

    expect(a.notifications).not.toBe(b.notifications);
    expect(a.notifications.criminal_reports).not.toBe(b.notifications.criminal_reports);

    a.notifications.criminal_reports.enabled = true;
    expect(b.notifications.criminal_reports.enabled).toBe(false);
  });

  it('возвращённые настройки проходят валидацию', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    expect(() => validateChatNotificationSettings(settings)).not.toThrow();
  });

  it('все шесть типов присутствуют с эталонными значениями по умолчанию', () => {
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-1', 'user-1');

    for (const type of NOTIFICATION_TYPES) {
      expect(settings.notifications[type]).toBeDefined();
      expect(settings.notifications[type].enabled).toBe(false);
      expect(settings.notifications[type]).toEqual(DEFAULT_NOTIFICATION_SETTINGS.notifications[type]);
    }
  });

  it('chatId/updatedBy/createdAt/updatedAt проставлены корректно', () => {
    const before = Date.now();
    const settings = NotificationValidationUtils.createDefaultChatSettings('chat-42', 'user-x');
    const after = Date.now();

    expect(settings.chatId).toBe('chat-42');
    expect(settings.updatedBy).toBe('user-x');
    expect(settings.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(settings.createdAt.getTime()).toBeLessThanOrEqual(after);
    expect(settings.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(settings.updatedAt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('Manifestation 1 — сервисные мутации не загрязняют дефолт', () => {
  let env: Env;
  let repo: any;
  let service: NotificationService;

  beforeEach(() => {
    resetDefaultSingleton();
    env = createMockEnv();
    repo = createMockRepository();
    service = new NotificationService(env, repo);
  });

  it('enableNotification (нет сохранённых настроек) не мутирует module-level дефолт', async () => {
    repo.getChatSettings.mockResolvedValue(null);
    repo.saveChatSettings.mockResolvedValue(undefined);

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    await service.enableNotification('chatA', 'criminal_reports', 'userA');

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);
  });

  it('последующий resetChatSettings для нового чата не наследует загрязнение (M1)', async () => {
    repo.getChatSettings.mockResolvedValue(null);
    repo.saveChatSettings.mockResolvedValue(undefined);

    await service.enableNotification('chatA', 'criminal_reports', 'userA');

    // Новый чат B инициализирует дефолты через resetChatSettings.
    repo.getChatSettings.mockResolvedValue(null);
    const chatB = await service.resetChatSettings('chatB', 'userB');

    expect(chatB.notifications.criminal_reports.enabled).toBe(false);

    // И в KV persistence для chatB persist-нуто незагрязнённое значение.
    const saved = repo.saveChatSettings.mock.calls.find((c: any[]) => c[0]?.chatId === 'chatB');
    expect(saved).toBeTruthy();
    expect(saved[0].notifications.criminal_reports.enabled).toBe(false);
  });

  it('enableNotification корректно persists enabled=true для действующего чата (без регрессии)', async () => {
    repo.getChatSettings.mockResolvedValue(null);
    repo.saveChatSettings.mockResolvedValue(undefined);

    await service.enableNotification('chatA', 'criminal_reports', 'userA');

    const saved = repo.saveChatSettings.mock.calls.find((c: any[]) => c[0]?.chatId === 'chatA');
    expect(saved).toBeTruthy();
    expect(saved[0].notifications.criminal_reports.enabled).toBe(true);
    // M1 не трогает верхний переключатель.
    expect(saved[0].enabled).toBe(false);
  });

  it('disableNotification (нет сохранённых настроек) не мутирует дефолт', async () => {
    repo.getChatSettings.mockResolvedValue(null);
    repo.saveChatSettings.mockResolvedValue(undefined);

    await service.disableNotification('chatA', 'criminal_reports', 'userA');

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    const saved = repo.saveChatSettings.mock.calls.find((c: any[]) => c[0]?.chatId === 'chatA');
    expect(saved).toBeTruthy();
    expect(saved[0].notifications.criminal_reports.enabled).toBe(false);
  });

  it('disableNotification для существующего чата не мутирует дефолт', async () => {
    const existing = NotificationValidationUtils.createDefaultChatSettings('chatA', 'userA');
    existing.notifications.criminal_reports.enabled = true;
    repo.getChatSettings.mockResolvedValue(existing);
    repo.saveChatSettings.mockResolvedValue(undefined);

    await service.disableNotification('chatA', 'criminal_reports', 'userA');

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);
    expect(existing.notifications.criminal_reports.enabled).toBe(false);
  });

  it('updateNotificationSettings (нет сохранённых настроек) не мутирует дефолт', async () => {
    repo.getChatSettings.mockResolvedValue(null);
    repo.saveChatSettings.mockResolvedValue(undefined);

    await service.updateNotificationSettings(
      'chatA',
      'profanity_reports',
      { frequency: 'weekly', threshold: 7 },
      'userA'
    );

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.frequency).toBe('daily');
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.threshold).toBe(5);

    const saved = repo.saveChatSettings.mock.calls.find((c: any[]) => c[0]?.chatId === 'chatA');
    expect(saved).toBeTruthy();
    expect(saved[0].notifications.profanity_reports.frequency).toBe('weekly');
    expect(saved[0].notifications.profanity_reports.threshold).toBe(7);
  });

  it('updateChatSettings (без обновления notifications) не мутирует дефолт', async () => {
    repo.getChatSettings.mockResolvedValue(null);
    repo.saveChatSettings.mockResolvedValue(undefined);

    await service.updateChatSettings('chatA', { enabled: true } as any, 'userA');

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    const saved = repo.saveChatSettings.mock.calls.find((c: any[]) => c[0]?.chatId === 'chatA');
    expect(saved).toBeTruthy();
    expect(saved[0].enabled).toBe(true);
    // notifications у нового чата — pristine дефолт (все выключены).
    expect(saved[0].notifications.criminal_reports.enabled).toBe(false);
  });
});

describe('Manifestation 2 — санитизатор на чтении не дрейфит дефолт', () => {
  let env: Env;
  let repo: NotificationRepository;
  let service: NotificationService;

  beforeEach(() => {
    resetDefaultSingleton();
    env = createMockEnv();
    repo = new NotificationRepository(env);
    service = new NotificationService(env, repo);
  });

  it('чтение существующего чата через реальный репозиторий не дрейфит дефолт', async () => {
    // Засеваем chatA напрямую в KV (минуя сервис, чтобы изолировать санитизатор).
    await seedChatSettings(env, 'chatA', 'criminal_reports', true);

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    // Чтение chatA через реальный репозиторий -> санитизатор отрабатывает.
    const readA = await service.getChatSettings('chatA');

    // Санитизатор возвращает корректное значение для chatA (без регрессии).
    expect(readA?.notifications.criminal_reports.enabled).toBe(true);

    // Module-level константа осталась pristine (дрейфа нет).
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);
  });

  it('последующий resetChatSettings для нового чата не наследует дрейф (M2)', async () => {
    await seedChatSettings(env, 'chatA', 'criminal_reports', true);

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    await service.getChatSettings('chatA');

    // Новый чат B инициализируется через resetChatSettings.
    const chatB = await service.resetChatSettings('chatB', 'userB');

    expect(chatB.notifications.criminal_reports.enabled).toBe(false);

    const storedB = await env.HISTORY.get('notification_settings:chatB');
    expect(storedB).toBeTruthy();
    expect(JSON.parse(storedB!).notifications.criminal_reports.enabled).toBe(false);
  });

  it('многократное чтение чата с включённым типом не накапливает дрейф', async () => {
    await seedChatSettings(env, 'chatA', 'criminal_reports', true);
    await seedChatSettings(env, 'chatA2', 'profanity_reports', true);

    for (let i = 0; i < 3; i++) {
      await service.getChatSettings('chatA');
      await service.getChatSettings('chatA2');
    }

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.enabled).toBe(false);

    const chatNew = await service.resetChatSettings('chatNew', 'userNew');
    expect(chatNew.notifications.criminal_reports.enabled).toBe(false);
    expect(chatNew.notifications.profanity_reports.enabled).toBe(false);
  });

  it('sanitizeChatNotificationSettings напрямую не мутирует дефолт', () => {
    const stored = NotificationValidationUtils.createDefaultChatSettings('chatA', 'userA');
    stored.notifications.criminal_reports.enabled = true;
    stored.enabled = true;
    stored.notifications.profanity_reports.time!.hour = 23;

    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    const sanitized = NotificationDataSanitizer.sanitizeChatNotificationSettings(
      stored,
      'chatA',
      'userA'
    );

    expect(sanitized.notifications.criminal_reports.enabled).toBe(true);
    expect(sanitized.enabled).toBe(true);
    expect(sanitized.notifications.profanity_reports.time!.hour).toBe(23);

    // Дефолт остался pristine.
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.time!.hour).toBe(9);
  });

  it('sanitizeChatNotificationSettings с null-входом возвращает pristine дефолт', () => {
    const sanitized = NotificationDataSanitizer.sanitizeChatNotificationSettings(
      null,
      'chatA',
      'userA'
    );

    expect(sanitized.notifications.criminal_reports.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    // Возвращённый объект не разделяет ссылку с дефолтом.
    expect(sanitized.notifications).not.toBe(DEFAULT_NOTIFICATION_SETTINGS.notifications);
  });
});

describe('User-facing first-use вектор (bug-repro4) — chatB не наследует чужой тип', () => {
  let env: Env;
  let repo: NotificationRepository;
  let service: NotificationService;

  beforeEach(() => {
    resetDefaultSingleton();
    env = createMockEnv();
    repo = new NotificationRepository(env);
    service = new NotificationService(env, repo);
  });

  it('chatB /enable profanity_reports не получает criminal_reports.enabled=true', async () => {
    // chatA first-use: включаем criminal_reports (нет сохранённых настроек).
    await service.enableNotification('chatA', 'criminal_reports', 'userA');
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);

    // chatB first-use через USER-FACING путь: включаем profanity_reports.
    await service.enableNotification('chatB', 'profanity_reports', 'userB');

    // chatB не трогал criminal_reports — persisted snapshot должен иметь его выключенным.
    const storedB = await env.HISTORY.get('notification_settings:chatB');
    expect(storedB).toBeTruthy();
    const parsedB = JSON.parse(storedB!);
    expect(parsedB.notifications.criminal_reports.enabled).toBe(false);
    // Тип, который chatB действительно включил — включён.
    expect(parsedB.notifications.profanity_reports.enabled).toBe(true);
    // M1 не трогает верхний переключатель.
    expect(parsedB.enabled).toBe(false);
  });

  it('chatA persists criminal_reports.enabled=true для себя (без регрессии поведения)', async () => {
    await service.enableNotification('chatA', 'criminal_reports', 'userA');

    const storedA = await env.HISTORY.get('notification_settings:chatA');
    expect(storedA).toBeTruthy();
    const parsedA = JSON.parse(storedA!);
    expect(parsedA.notifications.criminal_reports.enabled).toBe(true);
  });

  it('последовательность enable/disable нескольких чатов не приводит к кросс-загрязнению', async () => {
    await service.enableNotification('chatA', 'criminal_reports', 'userA');
    await service.enableNotification('chatB', 'profanity_reports', 'userB');
    await service.enableNotification('chatC', 'activity_summary', 'userC');

    for (const chatId of ['chatA', 'chatB', 'chatC']) {
      const stored = await env.HISTORY.get(`notification_settings:${chatId}`);
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      // Каждый чат имеет включённым только тот тип, который он сам включил.
      expect(parsed.notifications.criminal_reports.enabled).toBe(chatId === 'chatA');
      expect(parsed.notifications.profanity_reports.enabled).toBe(chatId === 'chatB');
      expect(parsed.notifications.activity_summary.enabled).toBe(chatId === 'chatC');
      // Верхний переключатель не тронут.
      expect(parsed.enabled).toBe(false);
    }
  });
});

describe('resetChatSettings — возвращает pristine дефолт', () => {
  let env: Env;
  let repo: any;
  let service: NotificationService;

  beforeEach(() => {
    resetDefaultSingleton();
    env = createMockEnv();
    repo = createMockRepository();
    service = new NotificationService(env, repo);
  });

  it('resetChatSettings возвращает все типы выключенными', async () => {
    repo.saveChatSettings.mockResolvedValue(undefined);

    const result = await service.resetChatSettings('chatX', 'userX');

    for (const type of NOTIFICATION_TYPES) {
      expect(result.notifications[type].enabled).toBe(false);
    }
    expect(result.enabled).toBe(false);
    expect(result.adminOnly).toBe(false);
  });

  it('resetChatSettings после сервисных включений в других чатах возвращает pristine дефолт', async () => {
    repo.getChatSettings.mockResolvedValue(null);
    repo.saveChatSettings.mockResolvedValue(undefined);

    // Запускаем легитимные сервисные операции для других чатов (раньше они
    // загрязняли shared дефолт через общую ссылку).
    await service.enableNotification('chatA', 'criminal_reports', 'userA');
    await service.enableNotification('chatB', 'profanity_reports', 'userB');
    await service.updateNotificationSettings('chatC', 'activity_summary', { threshold: 3 }, 'userC');

    // Дефолт всё ещё pristine.
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.criminal_reports.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.profanity_reports.enabled).toBe(false);
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifications.activity_summary.threshold).toBeUndefined();

    // resetChatSettings для нового чата возвращает pristine значения.
    const result = await service.resetChatSettings('chatX', 'userX');
    expect(result.notifications.criminal_reports.enabled).toBe(false);
    expect(result.notifications.profanity_reports.enabled).toBe(false);
    expect(result.notifications.profanity_reports.frequency).toBe('daily');
  });
});
