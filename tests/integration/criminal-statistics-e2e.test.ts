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
import { handleUpdate } from '../../src/update';
import { sendMessage } from '../../src/telegram';
import type { Env } from '../../src/env';
import type { ViolationAnalysis, Violation } from '../../src/models/statistics';

// Мокаем модуль telegram
vi.mock('../../src/telegram', () => ({
  sendMessage: vi.fn()
}));

// Мокаем логгер
vi.mock('../../src/logger', () => ({
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
    isTestEnvironment: vi.fn()
  };
});

// isTestEnvironment is mocked in vi.mock('../../src/env')

describe('Criminal Statistics E2E Integration Tests', () => {
  let mockEnv: Env;
  let mockSendMessage: any;
  let mockCriminalAnalyzerDO: any;
  let mockCountersDO: any;
  let mockDB: any;

  beforeEach(() => {
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
      TOKEN: 'test_token',
      SECRET: 'test-secret',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'test-prompt'
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Команда /my_criminal - полный E2E поток', () => {
    it('должен обработать команду /my_criminal с существующими нарушениями', async () => {
      // Arrange: Подготавливаем тестовые данные
      const testUserId = 123456;
      const testChatId = -100123456789;
      const testUsername = 'test_user';

      // Мокаем данные из базы для getUserStats
      const mockUserStatsData = {
        total_violations: 3,
        average_severity: 6.5,
        last_violation_date: '2024-01-15T10:30:00Z'
      };

      const mockViolationsByArticle = [
        { article: '282', count: 2, average_severity: 7.0 },
        { article: '130', count: 1, average_severity: 5.0 }
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

        if (query.includes('COUNT(*) as total_violations')) {
          // Запрос для общей статистики пользователя
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(mockUserStatsData),
            all: vi.fn(),
            run: vi.fn()
          });
        } else if (query.includes('GROUP BY article')) {
          // Запрос для нарушений по статьям
          mockStmt.bind.mockReturnValue({
            first: vi.fn(),
            all: vi.fn().mockResolvedValue({ results: mockViolationsByArticle }),
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
      expect(sentMessage).toContain('📊');
      expect(sentMessage).toContain('Статистика пользователя');
      expect(sentMessage).toContain('<b>Всего нарушений:</b> 3');
      expect(sentMessage).toContain('<b>Средняя серьезность:</b> 6.5/10');
      expect(sentMessage).toContain('🟡'); // Medium risk level emoji
      expect(sentMessage).toContain('<b>Статья 282:</b> 2 раз');
      expect(sentMessage).toContain('<b>Статья 130:</b> 1 раз');
      expect(sentMessage).toContain('15.01.2024'); // Дата последнего нарушения

      // Проверяем, что вызов был с правильными параметрами
      expect(mockSendMessage).toHaveBeenCalledWith(
        mockEnv,
        testChatId,
        expect.stringContaining('📊')
      );
    });

    it('должен обработать команду /my_criminal без нарушений', async () => {
      // Arrange: Подготавливаем данные для пользователя без нарушений
      const testUserId = 789012;
      const testChatId = -100987654321;
      const testUsername = 'clean_user';

      // Мокаем пустые данные из базы
      const mockEmptyUserStats = {
        total_violations: 0,
        average_severity: 0,
        last_violation_date: null
      };

      mockDB.prepare.mockImplementation((query: string) => {
        const mockStmt = {
          bind: vi.fn().mockReturnValue({
            first: vi.fn(),
            all: vi.fn(),
            run: vi.fn()
          })
        };

        if (query.includes('COUNT(*) as total_violations')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(mockEmptyUserStats),
            all: vi.fn(),
            run: vi.fn()
          });
        } else if (query.includes('GROUP BY article')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn(),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn()
          });
        }

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
      
      expect(sentMessage).toContain('📊');
      expect(sentMessage).toContain('Статистика пользователя');
      expect(sentMessage).toContain('<b>Всего нарушений:</b> 0');
      expect(sentMessage).toContain('<i>У пользователя пока нет нарушений</i>');
      expect(sentMessage).toContain('🟢 Низкий'); // Low risk level
    });

    it('должен обработать команду /my_criminal с периодом', async () => {
      // Arrange: Тестируем команду с параметром периода
      const testUserId = 345678;
      const testChatId = -100345678901;
      
      const mockUserStatsData = {
        total_violations: 1,
        average_severity: 4.0,
        last_violation_date: '2024-01-10T15:20:00Z'
      };

      const mockViolationsByArticle = [
        { article: '130', count: 1, average_severity: 4.0 }
      ];

      mockDB.prepare.mockImplementation((query: string) => {
        const mockStmt = {
          bind: vi.fn().mockReturnValue({
            first: vi.fn(),
            all: vi.fn(),
            run: vi.fn()
          })
        };

        if (query.includes('COUNT(*) as total_violations')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(mockUserStatsData),
            all: vi.fn(),
            run: vi.fn()
          });
        } else if (query.includes('GROUP BY article')) {
          mockStmt.bind.mockReturnValue({
            first: vi.fn(),
            all: vi.fn().mockResolvedValue({ results: mockViolationsByArticle }),
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
      
      expect(sentMessage).toContain('📊');
      expect(sentMessage).toContain('Статистика пользователя');
      expect(sentMessage).toContain('<b>Всего нарушений:</b> 1');
      expect(sentMessage).toContain('<b>Средняя серьезность:</b> 4.0/10');
      expect(sentMessage).toContain('🟡 Средний'); // Medium risk level (4.0 is medium)
      expect(sentMessage).toContain('<b>Статья 130:</b> 1 раз');
    });
  });

  describe('Команда /criminal_stats - полный E2E поток', () => {
    it('должен обработать команду /criminal_stats с данными', async () => {
      // Arrange: Подготавливаем данные для общей статистики
      const testChatId = -100111222333;

      const mockGeneralStats = {
        total_violations: 15,
        average_severity: 7.2
      };

      const mockTopViolations = [
        { article: '282', count: 8, average_severity: 7.5 },
        { article: '205', count: 4, average_severity: 9.0 },
        { article: '130', count: 3, average_severity: 5.0 }
      ];

      const mockTopUsers = [
        { user_id: 111, count: 6, average_severity: 8.0 },
        { user_id: 222, count: 5, average_severity: 6.5 },
        { user_id: 333, count: 4, average_severity: 7.0 }
      ];

      const mockCriticalViolations = [
        {
          article: '205',
          quote: 'Критическое нарушение',
          punishment: 'Лишение свободы',
          severity: 10,
          confidence: 0.95
        }
      ];

      mockDB.prepare.mockImplementation((query: string) => {
        const mockStmt = {
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true })
          })
        };

        if (query.includes('COUNT(*) as total_violations') && query.includes('AVG(severity)')) {
          // Общая статистика
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(mockGeneralStats),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        } else if (query.includes('GROUP BY article') && query.includes('LIMIT 5')) {
          // Топ нарушений
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: mockTopViolations }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        } else if (query.includes('GROUP BY article') && query.includes('ORDER BY count DESC') && !query.includes('LIMIT')) {
          // Нарушения по статьям за период (для getPeriodStats)
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        } else if (query.includes('GROUP BY user_id') && query.includes('LIMIT 5')) {
          // Топ пользователей
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: mockTopUsers }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        } else if (query.includes('severity >= 8')) {
          // Критические нарушения
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: mockCriticalViolations }),
            run: vi.fn().mockResolvedValue({ success: true })
          });
        } else if (query.includes('SELECT COUNT(*) as total_violations') && query.includes('WHERE user_id')) {
          // Статистика пользователя (getUserStats)
          mockStmt.bind.mockReturnValue({
            first: vi.fn().mockResolvedValue({ total_violations: 0, avg_severity: 0 }),
            all: vi.fn().mockResolvedValue({ results: [] }),
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
      
      expect(sentMessage).toContain('📈');
      expect(sentMessage).toContain('Статистика за период');
      expect(sentMessage).toContain('<b>Всего нарушений:</b> 15');
      expect(sentMessage).toContain('<b>Средняя серьезность:</b> 7.2/10');
    });
  });

  describe('Команда /criminal_top - полный E2E поток', () => {
    it('должен обработать команду /criminal_top с данными', async () => {
      // Arrange: Подготавливаем данные для топа пользователей
      const testChatId = -100444555666;

      // Мокаем KV storage для получения топа пользователей
      const today = new Date().toISOString().slice(0, 10);
      const mockCountersData = [
        { name: `criminal:${testChatId}:111:${today}`, value: '5' },
        { name: `criminal:${testChatId}:222:${today}`, value: '3' },
        { name: `criminal:${testChatId}:333:${today}`, value: '2' }
      ];

      const mockUsernames = ['user111', 'user222', 'user333'];

      mockEnv.COUNTERS.list = vi.fn().mockResolvedValue({
        keys: mockCountersData.map(item => ({ name: item.name })),
        list_complete: true
      });

      mockEnv.COUNTERS.get = vi.fn()
        .mockImplementation((key: string) => {
          if (key.startsWith('user:')) {
            const userId = key.split(':')[1];
            const index = ['111', '222', '333'].indexOf(userId);
            return Promise.resolve(index >= 0 ? mockUsernames[index] : null);
          }
          const item = mockCountersData.find(d => d.name === key);
          return Promise.resolve(item ? item.value : '0');
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
      
      expect(sentMessage).toContain('Топ нарушителей УК РФ сегодня:');
      expect(sentMessage).toContain('1. user111: 5');
      expect(sentMessage).toContain('2. user222: 3');
      expect(sentMessage).toContain('3. user333: 2');
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
        JSON.stringify(mockViolationAnalysis),
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
        waitUntil: vi.fn().mockImplementation((promise: Promise<any>) => {
          // Выполняем промис немедленно для тестирования
          return promise;
        }),
        passThroughOnException: vi.fn()
      };

      // isTestEnvironment уже настроен в beforeEach для возврата false

      // Act: Обрабатываем сообщение через полный поток как в index.ts
      // Передаем ExecutionContext для правильной работы ctx.waitUntil
      await handleUpdate(testMessage.message, mockEnv);
      
      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Логируем состояние моков для отладки
      console.log('Mock calls after analysis:', {
        idFromNameCalls: mockCriminalAnalyzerDO.idFromName.mock.calls,
        getCalls: mockCriminalAnalyzerDO.get.mock.calls
      });

      // Assert: Проверяем, что анализатор был вызван
      expect(mockCriminalAnalyzerDO.idFromName).toHaveBeenCalledWith('-100123456789');
      expect(mockCriminalAnalyzerDO.get).toHaveBeenCalled();

      // Проверяем, что было отправлено сообщение о нарушении
      expect(mockSendMessage).toHaveBeenCalledWith(
        mockEnv,
        -100123456789,
        expect.stringContaining('🚨')
      );

      const sentMessage = mockSendMessage.mock.calls[0][2];
      expect(sentMessage).toContain('Обнаружены нарушения УК РФ');
      expect(sentMessage).toContain('Статья 282 УК РФ');
      expect(sentMessage).toContain('Тестовая цитата нарушения');
      expect(sentMessage).toContain('8/10');
      expect(sentMessage).toContain('90%');
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
        waitUntil: vi.fn().mockImplementation((promise: Promise<any>) => {
          return promise;
        }),
        passThroughOnException: vi.fn()
      };

      // Логируем состояние окружения для отладки
      console.log('Test environment check:', {
        chatId: testMessage.message.chat.id,
        text: testMessage.message.text,
        isCommand: testMessage.message.text?.startsWith('/')
      });

      // Act: Обрабатываем сообщение через полный поток
      await handleUpdate(testMessage.message, mockEnv);
      
      // Ждем завершения асинхронных операций
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Логируем состояние моков для отладки
      console.log('Mock calls after wait (second test):', {
        idFromNameCalls: mockCriminalAnalyzerDO.idFromName.mock.calls,
        getCalls: mockCriminalAnalyzerDO.get.mock.calls
      });

      // Assert: Проверяем, что анализатор был вызван
      expect(mockCriminalAnalyzerDO.idFromName).toHaveBeenCalledWith('-100987654321');
      expect(mockCriminalAnalyzerDO.get).toHaveBeenCalled();

      // Проверяем, что НЕ было отправлено сообщение о нарушении
      // (так как нарушений не найдено)
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });
});