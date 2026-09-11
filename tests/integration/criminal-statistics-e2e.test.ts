/**
 * Интеграционный тест для полного сквозного потока генерации ответа 
 * для команд, связанных с криминальной статистикой
 * 
 * Тест охватывает:
 * 1. Вызов контроллера (handleUpdate)
 * 2. Мок ответа от LLM через CRIMINAL_CODE_ANALYZER_DO
 * 3. Обработку ответа через ViolationHandler
 * 4. Форматирование и отправку результата
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleUpdate, recordMessage } from '../../src/api/update';
import { sendMessage } from '../../src/core/telegram';
import type { Env } from '../../src/core/env';
import type { ViolationAnalysis, Violation } from '../../src/core/models/statistics';

// Мокаем модуль telegram
vi.mock('../../src/core/telegram', () => ({
  sendMessage: vi.fn()
}));

// Мокаем логгер
vi.mock('../../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn()
  }
}));

// Мокаем функцию isTestEnvironment
vi.mock('../../src/env', async () => {
  const actual = await vi.importActual('../../src/env');
  return {
    ...actual,
    isTestEnvironment: vi.fn().mockReturnValue(false)
  };
});

// isTestEnvironment is mocked in vi.mock('../../src/env')

describe('Criminal Statistics E2E Integration Tests', () => {
  let mockEnv: Env;
  let mockSendMessage: any;
  let mockCriminalAnalyzerDO: any;
  let mockCountersDO: any;
  let mockDB: any;

  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // Мокаем process.env.NODE_ENV чтобы isTestEnvironment возвращал false
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    // Сброс всех моков перед каждым тестом
    vi.clearAllMocks();

    // isTestEnvironment мокается в vi.mock('../../src/env')

    mockSendMessage = vi.mocked(sendMessage);

    // Настройка базового мокирования базы данных
    const setupDatabaseMocks = () => {
      mockDB = {
        prepare: vi.fn().mockImplementation((sql) => {
          if (sql.includes('SELECT COUNT(*) as total_violations')) {
            return {
              bind: vi.fn().mockReturnValue({
                first: vi.fn().mockResolvedValue({ total_violations: 0, total_fines: 0 }),
                all: vi.fn().mockResolvedValue({ results: [] }),
                run: vi.fn().mockResolvedValue({ changes: 0 })
              })
            };
          }

          if (sql.includes('GROUP BY article') && !sql.includes('LIMIT')) {
            return {
              bind: vi.fn().mockReturnValue({
                first: vi.fn().mockResolvedValue(null),
                all: vi.fn().mockResolvedValue({ results: [] }),
                run: vi.fn().mockResolvedValue({ changes: 0 })
              })
            };
          }

          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockResolvedValue(null),
              all: vi.fn().mockResolvedValue({ results: [] }),
              run: vi.fn().mockResolvedValue({ changes: 0 })
            })
          };
        })
      };
    };

    setupDatabaseMocks();

    // Создаем мок для CountersDO
    mockCountersDO = {
      idFromName: vi.fn().mockReturnValue('test-counters-id'),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ ok: true }), { status: 200 })
        )
      })
    };

    // Создаем мок для CRIMINAL_CODE_ANALYZER_DO
    mockCriminalAnalyzerDO = {
      idFromName: vi.fn().mockReturnValue('test-analyzer-id'),
      get: vi.fn().mockReturnValue({
        fetch: vi.fn()
      })
    };

    // Создаем мок окружения
    mockEnv = {
      DB: mockDB,
      HISTORY: {
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn().mockResolvedValue({ keys: [] }),
        delete: vi.fn()
      } as any,
      COUNTERS: {
        get: vi.fn(),
        put: vi.fn(),
        list: vi.fn().mockResolvedValue({ keys: [] }),
        delete: vi.fn()
      } as any,
      COUNTERS_DO: mockCountersDO,
      MESSAGE_FETCHER_DO: {} as any,
      MESSAGE_AGGREGATOR_DO: {} as any,
      DAY_BLOCK_MANAGER_DO: {} as any,
      CRIMINAL_CODE_ANALYZER_DO: mockCriminalAnalyzerDO,
      AI: {},
      TOKEN: 'production_token', // Не test_token, чтобы isTestEnvironment возвращала false
      SECRET: 'test-secret',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'test-prompt'
    };
  });

  afterEach(() => {
    // Восстанавливаем NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    vi.restoreAllMocks();
  });

  describe('Команда /my_criminal - полный E2E поток', () => {
    it('должен обработать команду /my_criminal с существующими нарушениями', async () => {
      // Arrange: Подготавливаем тестовые данные
      const testUserId = 123456;
      const testChatId = -100123456789;
      const testUsername = 'test_user';

      const mockViolationsByArticle = [
        {
          article: '282',
          subarticle: null,
          article_title: 'Возбуждение ненависти',
          punishment: 'лишение свободы до 3 лет',
          count: 2,
          average_severity: 7.0,
        },
        {
          article: '130',
          subarticle: null,
          article_title: 'Оскорбление',
          punishment: 'лишение свободы до 1 года',
          count: 1,
          average_severity: 5.0,
        }
      ];

      // Настраиваем мок базы данных
      mockDB.prepare.mockImplementation((query: string) => {
        const mockStmt = {
          bind: vi.fn().mockReturnValue({
            first: vi.fn(),
            all: vi.fn(),
            run: vi.fn()
          })
        };

        if (query.includes('GROUP BY article')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn(),
            all: vi.fn().mockResolvedValue({ results: mockViolationsByArticle }),
            run: vi.fn()
          });
        } else if (query.includes('ORDER BY event_ts DESC')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn(),
            all: vi.fn().mockResolvedValue({
              results: [{
                id: 1,
                article: '282',
                subarticle: null,
                article_title: 'Возбуждение ненависти',
                quote: 'тестовая цитата',
                text_preview: 'тестовый эпизод',
                punishment: 'лишение свободы до 3 лет',
                severity: 7,
                confidence: 0.91,
                event_ts: 1760000000,
              }],
            }),
            run: vi.fn()
          });
        } else {
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn()
          });
        }

        return mockStmt;
      });

      // Создаем тестовое сообщение с командой
      const testMessage = {
        message: {
          message_id: 1,
          chat: { id: testChatId },
          from: { id: testUserId, username: testUsername },
          text: '/my_criminal',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Act: Выполняем команду
      await handleUpdate(testMessage.message, mockEnv);

      // Assert: Проверяем результат
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const sentMessage = mockSendMessage.mock.calls[0][2]; // третий аргумент - текст сообщения

      // Проверяем, что сообщение содержит ожидаемые элементы
      expect(sentMessage).toContain('⚖️ <b>Твоё уголовное дело · сегодня</b>');
      expect(sentMessage).toContain('Нарушений: <b>3</b>');
      expect(sentMessage).toContain('Средняя серьёзность: <b>6.3/10</b>');
      expect(sentMessage).toContain('ст. 282 — Возбуждение ненависти ×2');
      expect(sentMessage).toContain('<b>Последние эпизоды:</b>');
      expect(sentMessage).toContain('«тестовый эпизод»');

      // Проверяем, что вызов был с правильными параметрами
      expect(mockSendMessage).toHaveBeenCalledWith(
        mockEnv,
        testChatId,
        expect.stringContaining('Твоё уголовное дело')
      );
    });

    it('должен обработать команду /my_criminal без нарушений', async () => {
      // Arrange: Подготавливаем данные для пользователя без нарушений
      const testUserId = 789012;
      const testChatId = -100987654321;
      const testUsername = 'clean_user';

      mockDB.prepare.mockImplementation((query: string) => {
        const mockStmt = {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn()
          })
        };

        return mockStmt;
      });

      const testMessage = {
        message: {
          message_id: 2,
          chat: { id: testChatId },
          from: { id: testUserId, username: testUsername },
          text: '/my_criminal',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Act: Выполняем команду
      await handleUpdate(testMessage.message, mockEnv);

      // Assert: Проверяем результат для пользователя без нарушений
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const sentMessage = mockSendMessage.mock.calls[0][2];

      expect(sentMessage).toContain('⚖️ <b>Твоё уголовное дело · сегодня</b>');
      expect(sentMessage).toContain('Нарушений: <b>0</b>');
      expect(sentMessage).toContain('Напиздел: <b>0 лет</b>');
      expect(sentMessage).toContain('<i>За этот период уголовщина не обнаружена.</i>');
    });

    it('должен обработать команду /my_criminal с периодом', async () => {
      // Arrange: Тестируем команду с параметром периода
      const testUserId = 345678;
      const testChatId = -100345678901;

      const mockViolationsByArticle = [
        {
          article: '130',
          subarticle: null,
          article_title: 'Оскорбление',
          punishment: 'лишение свободы до 1 года',
          count: 1,
          average_severity: 4.0,
        }
      ];

      mockDB.prepare.mockImplementation((query: string) => {
        const mockStmt = {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn()
          })
        };

        if (query.includes('GROUP BY article')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn(),
            all: vi.fn().mockResolvedValue({ results: mockViolationsByArticle }),
            run: vi.fn()
          });
        } else if (query.includes('ORDER BY event_ts DESC')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn(),
            all: vi.fn().mockResolvedValue({
              results: [{
                id: 3,
                article: '130',
                subarticle: null,
                article_title: 'Оскорбление',
                quote: 'эпизод за неделю',
                text_preview: null,
                punishment: 'лишение свободы до 1 года',
                severity: 4,
                confidence: 0.8,
                event_ts: 1760000000,
              }],
            }),
            run: vi.fn()
          });
        }

        return mockStmt;
      });

      const testMessage = {
        message: {
          message_id: 3,
          chat: { id: testChatId },
          from: { id: testUserId, username: 'test_user_period' },
          text: '/my_criminal week',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Act: Выполняем команду с периодом
      await handleUpdate(testMessage.message, mockEnv);

      // Assert: Проверяем результат
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const sentMessage = mockSendMessage.mock.calls[0][2];

      expect(sentMessage).toContain('⚖️ <b>Твоё уголовное дело · 7 дней</b>');
      expect(sentMessage).toContain('Нарушений: <b>1</b>');
      expect(sentMessage).toContain('Средняя серьёзность: <b>4.0/10</b>');
      expect(sentMessage).toContain('ст. 130 — Оскорбление ×1');
    });
  });

  describe('Команда /criminal_stats - полный E2E поток', () => {
    it('должен обработать команду /criminal_stats с данными', async () => {
      // Arrange: Подготавливаем данные для общей статистики
      const testChatId = -100111222333;

      const mockTopViolations = [
        {
          article: '282',
          subarticle: null,
          article_title: 'Возбуждение ненависти',
          punishment: 'лишение свободы до 3 лет',
          count: 8,
          average_severity: 7.5,
        },
        {
          article: '205',
          subarticle: null,
          article_title: 'Террористический акт',
          punishment: 'лишение свободы до 20 лет',
          count: 4,
          average_severity: 9.0,
        },
        {
          article: '130',
          subarticle: null,
          article_title: 'Оскорбление',
          punishment: 'лишение свободы до 1 года',
          count: 3,
          average_severity: 5.0,
        }
      ];

      const mockTopUsers = [
        {
          user_id: 111,
          article: '205',
          subarticle: null,
          article_title: 'Террористический акт',
          punishment: 'лишение свободы до 20 лет',
          count: 6,
          average_severity: 8.0,
        },
        {
          user_id: 222,
          article: '282',
          subarticle: null,
          article_title: 'Возбуждение ненависти',
          punishment: 'лишение свободы до 3 лет',
          count: 5,
          average_severity: 6.5,
        },
        {
          user_id: 333,
          article: '130',
          subarticle: null,
          article_title: 'Оскорбление',
          punishment: 'лишение свободы до 1 года',
          count: 4,
          average_severity: 7.0,
        }
      ];

      const mockCriticalViolations = [
        {
          article: '205',
          subarticle: null,
          article_title: 'Террористический акт',
          quote: 'Критическое нарушение',
          text_preview: 'Критическое нарушение',
          punishment: 'лишение свободы до 20 лет',
          severity: 10,
          confidence: 0.95,
          event_ts: 1760000000,
        }
      ];

      mockEnv.COUNTERS.get = vi.fn().mockImplementation((key: string) => {
        if (key === 'user:111') return Promise.resolve('user111');
        if (key === 'user:222') return Promise.resolve('user222');
        if (key === 'user:333') return Promise.resolve('user333');
        return Promise.resolve(null);
      });

      mockDB.prepare.mockImplementation((query: string) => {
        const mockStmt = {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true })
          })
        };

        if (query.includes('GROUP BY user_id')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: mockTopUsers }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        } else if (query.includes('GROUP BY article')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: mockTopViolations }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        } else if (query.includes('ORDER BY severity DESC')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: mockCriticalViolations }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        }

        return mockStmt;
      });

      const testMessage = {
        message: {
          message_id: 4,
          chat: { id: testChatId },
          from: { id: 999999, username: 'admin_user' },
          text: '/criminal_stats',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Act: Выполняем команду
      await handleUpdate(testMessage.message, mockEnv);

      // Assert: Проверяем результат
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const sentMessage = mockSendMessage.mock.calls[0][2];

      expect(sentMessage).toContain('⚖️ <b>УК РФ · статистика чата · сегодня</b>');
      expect(sentMessage).toContain('Нарушений: <b>15</b>');
      expect(sentMessage).toContain('Нарушителей: <b>3</b>');
      expect(sentMessage).toContain('<b>Самые популярные статьи:</b>');
      expect(sentMessage).toContain('<b>Главный уголовник:</b>');
      expect(sentMessage).toContain('user111 · 6 нарушений · 120 лет');
      expect(sentMessage).toContain('<b>Самый тяжёлый эпизод:</b>');
    });
  });

  describe('Команда /criminal_top - полный E2E поток', () => {
    it('должен обработать команду /criminal_top с данными', async () => {
      // Arrange: Подготавливаем данные для топа пользователей
      const testChatId = -100444555666;

      const mockTopUsers = [
        {
          user_id: 111,
          article: '119',
          subarticle: null,
          article_title: 'Угроза убийством',
          punishment: 'лишение свободы до 2 лет',
          count: 5,
          average_severity: 7,
        },
        {
          user_id: 222,
          article: '119',
          subarticle: null,
          article_title: 'Угроза убийством',
          punishment: 'лишение свободы до 2 лет',
          count: 3,
          average_severity: 7,
        },
        {
          user_id: 333,
          article: '119',
          subarticle: null,
          article_title: 'Угроза убийством',
          punishment: 'лишение свободы до 2 лет',
          count: 2,
          average_severity: 7,
        }
      ];

      const mockUsernames = ['user111', 'user222', 'user333'];

      mockDB.prepare.mockImplementation((query: string) => ({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({
            results: query.includes('GROUP BY user_id') ? mockTopUsers : [],
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
        }),
      }));

      mockEnv.COUNTERS.get = vi.fn()
        .mockImplementation((key: string) => {
          if (key.startsWith('user:')) {
            const userId = key.split(':')[1];
            const index = ['111', '222', '333'].indexOf(userId);
            return Promise.resolve(index >= 0 ? mockUsernames[index] : null);
          }
          return Promise.resolve(null);
        });

      const testMessage = {
        message: {
          message_id: 5,
          chat: { id: testChatId },
          from: { id: 888888, username: 'admin_user' },
          text: '/criminal_top 3 today',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Act: Выполняем команду
      await handleUpdate(testMessage.message, mockEnv);

      // Assert: Проверяем результат
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const sentMessage = mockSendMessage.mock.calls[0][2];

      expect(sentMessage).toContain('🏆 <b>Уголовный рейтинг · сегодня</b>');
      expect(sentMessage).toContain('1. <b>user111</b>');
      expect(sentMessage).toContain('5 нарушений · напиздел на 10 лет');
      expect(sentMessage).toContain('2. <b>user222</b>');
      expect(sentMessage).toContain('3. <b>user333</b>');
    });

    it('должен обработать команду /criminal_top без данных', async () => {
      // Arrange: Пустые данные
      const testChatId = -100777888999;

      mockEnv.COUNTERS.list = vi.fn().mockResolvedValue({
        keys: [],
        list_complete: true
      });

      const testMessage = {
        message: {
          message_id: 6,
          chat: { id: testChatId },
          from: { id: 777777, username: 'user' },
          text: '/criminal_top',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Act: Выполняем команду
      await handleUpdate(testMessage.message, mockEnv);

      // Assert: Проверяем результат
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      const sentMessage = mockSendMessage.mock.calls[0][2];

      expect(sentMessage).toContain('Нет данных о нарушениях УК РФ');
    });
  });

  describe('Обработка ошибок в E2E потоке', () => {
    it.skip('должен gracefully обработать ошибку базы данных', async () => {
      // Этот тест временно отключен, так как он влияет на другие тесты
      // TODO: Переписать тест с правильной изоляцией мокирования
    });

    it('должен обработать неизвестную команду', async () => {
      // Arrange: Неизвестная команда
      const testMessage = {
        message: {
          message_id: 8,
          chat: { id: -100999999999 },
          from: { id: 999999, username: 'test_user' },
          text: '/unknown_command',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Act: Выполняем неизвестную команду
      await handleUpdate(testMessage.message, mockEnv);

      // Assert: Проверяем, что ничего не отправлено (команда не обработана)
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Интеграция с мокированным LLM ответом', () => {
    it('должен обработать анализ сообщения с нарушениями через мок LLM', async () => {
      // Arrange: Подготавливаем мок ответа от CRIMINAL_CODE_ANALYZER_DO
      const mockViolationAnalysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            subarticle: null,
            articleTitle: 'Возбуждение ненависти либо вражды',
            quote: 'Тестовая цитата нарушения',
            punishment: 'Штраф до 300 000 рублей',
            severity: 8,
            confidence: 0.9
          }
        ],
        totalSeverity: 8,
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      // Мокаем ответ от CRIMINAL_CODE_ANALYZER_DO
      const mockAnalyzerResponse = new Response(
        JSON.stringify({
          queued: true,
          reasons: ['semantic_prefilter'],
          queueSize: 1
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

      mockCriminalAnalyzerDO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(mockAnalyzerResponse)
      });

      // Создаем обычное сообщение (не команду) для анализа
      const testMessage = {
        message: {
          message_id: 9,
          chat: { id: -100123456789 },
          from: { id: 123456, username: 'test_user' },
          text: 'Тестовое сообщение для анализа на нарушения УК РФ',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Создаем мок ExecutionContext с waitUntil
      const mockCtx = {
        waitUntil: vi.fn().mockImplementation(async (promise: Promise<any>) => {
          // Ждем завершения промиса для тестирования
          await promise;
        }),
        passThroughOnException: vi.fn(),
        props: {}
      } as any;

      // Настраиваем уведомления для этого теста
      const enabledNotificationSettings = {
        chatId: '-100123456789',
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: '123456',
        notifications: {
          criminal_reports: { enabled: true, frequency: 'instant', includeDetails: true, maxItemsInReport: 10 },
          profanity_reports: { enabled: false, frequency: 'daily', includeDetails: false, maxItemsInReport: 5 },
          activity_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 10 },
          daily_summary: { enabled: false, frequency: 'daily', includeDetails: true, maxItemsInReport: 15 },
          weekly_summary: { enabled: false, frequency: 'weekly', includeDetails: true, maxItemsInReport: 20 },
          monthly_summary: { enabled: false, frequency: 'monthly', includeDetails: true, maxItemsInReport: 25 }
        },
        adminOnly: false
      };

      // Настраиваем мок HISTORY.get для возврата настроек уведомлений
      vi.mocked(mockEnv.HISTORY.get).mockResolvedValue(JSON.stringify(enabledNotificationSettings));

      // isTestEnvironment уже настроен в beforeEach для возврата false

      // Act: Обрабатываем сообщение через полный поток как в index.ts
      // Сначала записываем сообщение (где происходит анализ)
      await recordMessage(testMessage.message, mockEnv, mockCtx);
      // Затем обрабатываем команды
      await handleUpdate(testMessage.message, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Логируем состояние моков для отладки


      // Assert: Проверяем, что анализатор был вызван
      expect(mockCriminalAnalyzerDO.idFromName).toHaveBeenCalledWith('-100123456789');
      expect(mockCriminalAnalyzerDO.get).toHaveBeenCalled();

      // The webhook now only enqueues contextual criminal analysis.
      // Confirmed violations are reported admin-only by CriminalCodeAnalyzerDO, not to the chat.
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        mockEnv,
        -100123456789,
        expect.any(String)
      );
    });

    it('должен обработать анализ сообщения без нарушений через мок LLM', async () => {
      // Arrange: Подготавливаем мок ответа без нарушений
      const mockCleanAnalysis: ViolationAnalysis = {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: new Date().toISOString()
      };

      const mockAnalyzerResponse = new Response(
        JSON.stringify(mockCleanAnalysis),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

      mockCriminalAnalyzerDO.get.mockReturnValue({
        fetch: vi.fn().mockResolvedValue(mockAnalyzerResponse)
      });

      const testMessage = {
        message: {
          message_id: 10,
          chat: { id: -100987654321 },
          from: { id: 654321, username: 'clean_user' },
          text: 'Обычное безобидное сообщение',
          date: Math.floor(Date.now() / 1000)
        }
      };

      // Создаем мок ExecutionContext с waitUntil
      const mockCtx = {
        waitUntil: vi.fn().mockImplementation(async (promise: Promise<any>) => {
          // Ждем завершения промиса для тестирования
          await promise;
        }),
        passThroughOnException: vi.fn(),
        props: {}
      } as any;

      // Логируем состояние окружения для отладки


      // Act: Обрабатываем сообщение через полный поток
      // Сначала записываем сообщение (где происходит анализ)
      await recordMessage(testMessage.message, mockEnv, mockCtx);
      // Затем обрабатываем команды
      await handleUpdate(testMessage.message, mockEnv);

      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));

      // Логируем состояние моков для отладки


      // Assert: Проверяем, что анализатор был вызван
      expect(mockCriminalAnalyzerDO.idFromName).toHaveBeenCalledWith('-100987654321');
      expect(mockCriminalAnalyzerDO.get).toHaveBeenCalled();

      // Проверяем, что НЕ было отправлено сообщение о нарушении
      // (так как нарушений не найдено)
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});
