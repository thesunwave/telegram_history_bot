/**
 * Integration тесты для ViolationHandler
 * Тестируют полный цикл обработки нарушений
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ViolationHandler } from '../src/violation-handler';
import { MessageFormatter } from '../src/message-formatter';
import { StatisticsService } from '../src/services/statistics-service';
import { ViolationRepository } from '../src/repositories/violation-repository';
import type { 
  ViolationAnalysis, 
  Violation, 
  UserStats, 
  PeriodStats, 
  GeneralStats 
} from '../src/models/statistics';
import type { Env } from '../src/env';

// Mock environment
const mockEnv: Env = {
  DB: {
    prepare: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn()
  } as any,
  HISTORY: {} as any,
  COUNTERS: {} as any,
  COUNTERS_DO: {} as any,
  MESSAGE_FETCHER_DO: {} as any,
  MESSAGE_AGGREGATOR_DO: {} as any,
  DAY_BLOCK_MANAGER_DO: {} as any,
  CRIMINAL_CODE_ANALYZER_DO: {} as any,
  AI: {},
  TOKEN: 'test-token',
  SECRET: 'test-secret',
  SUMMARY_MODEL: 'test-model',
  SUMMARY_PROMPT: 'test-prompt'
};

describe('ViolationHandler Integration Tests', () => {
  let violationHandler: ViolationHandler;
  let mockMessageFormatter: MessageFormatter;
  let mockStatisticsService: StatisticsService;
  let mockViolationRepository: ViolationRepository;

  beforeEach(() => {
    // Создаем моки для зависимостей
    mockViolationRepository = new ViolationRepository(mockEnv);
    mockStatisticsService = new StatisticsService(mockViolationRepository);
    mockMessageFormatter = new MessageFormatter();

    // Создаем ViolationHandler с моками
    violationHandler = new ViolationHandler(
      mockEnv,
      mockMessageFormatter,
      mockStatisticsService,
      mockViolationRepository
    );
  });

  describe('formatViolationMessage', () => {
    it('должен успешно форматировать сообщение с нарушениями', async () => {
      const mockAnalysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            quote: 'Тестовая цитата нарушения',
            punishment: 'Штраф до 300 000 рублей',
            severity: 7,
            confidence: 0.85
          }
        ],
        totalSeverity: 7,
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(mockAnalysis);

      expect(result).toContain('🚨');
      expect(result).toContain('Обнаружены нарушения УК РФ');
      expect(result).toContain('Статья 282 УК РФ');
      expect(result).toContain('Тестовая цитата нарушения');
      expect(result).toContain('Штраф до 300 000 рублей');
      expect(result).toContain('7/10');
      expect(result).toContain('85%');
      expect(result).toContain('🔴'); // High severity emoji
    });

    it('должен форматировать сообщение без нарушений', async () => {
      const mockAnalysis: ViolationAnalysis = {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(mockAnalysis);

      expect(result).toContain('✅');
      expect(result).toContain('Нарушений не обнаружено');
    });

    it('должен добавлять предупреждение при низком уровне доверия', async () => {
      const mockAnalysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '130',
            quote: 'Сомнительная цитата',
            punishment: 'Предупреждение',
            severity: 3,
            confidence: 0.65 // Низкий уровень доверия
          }
        ],
        totalSeverity: 3,
        riskLevel: 'low',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(mockAnalysis);

      expect(result).toContain('⚠️');
      expect(result).toContain('Низкий уровень доверия к анализу');
    });

    it('должен обрабатывать множественные нарушения', async () => {
      const mockAnalysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            quote: 'Первое нарушение',
            punishment: 'Штраф',
            severity: 8,
            confidence: 0.9
          },
          {
            article: '205',
            quote: 'Второе нарушение',
            punishment: 'Лишение свободы',
            severity: 10,
            confidence: 0.95
          }
        ],
        totalSeverity: 18,
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(mockAnalysis);

      expect(result).toContain('Статья 282 УК РФ');
      expect(result).toContain('Статья 205 УК РФ');
      expect(result).toContain('Первое нарушение');
      expect(result).toContain('Второе нарушение');
      expect(result).toContain('<b>Всего нарушений:</b> 2');
      expect(result).toContain('<b>Общий уровень серьезности:</b> 18');
    });

    it('должен возвращать fallback сообщение при ошибке валидации', async () => {
      // Подавляем console.warn для этого теста, так как ошибки валидации ожидаемы
      const originalWarn = console.warn;
      console.warn = vi.fn();

      try {
        const invalidAnalysis = {
          hasViolations: true,
          violations: [
            {
              article: '', // Невалидная статья - ожидаемая ошибка валидации
              quote: 'Тест',
              punishment: 'Тест',
              severity: 15, // Невалидная серьезность - ожидаемая ошибка валидации
              confidence: 0.8
            }
          ],
          totalSeverity: 5,
          riskLevel: 'medium',
          analysisTimestamp: new Date().toISOString()
        } as any;

        const result = await violationHandler.formatViolationMessage(invalidAnalysis);

        // После санитизации невалидные нарушения отфильтровываются, остается пустой анализ
        expect(result).toContain('✅');
        expect(result).toContain('Нарушений не обнаружено');

        // Проверяем, что предупреждение о валидации было выведено
        expect(console.warn).toHaveBeenCalledWith(
          expect.stringContaining('ViolationAnalysis validation failed, attempting to sanitize:'),
          expect.stringContaining('Invalid violation at index 0')
        );
      } finally {
        // Восстанавливаем оригинальный console.warn
        console.warn = originalWarn;
      }
    });
  });

  describe('getUserStats', () => {
    it('должен получать и форматировать статистику пользователя', async () => {
      const mockUserStats: UserStats = {
        userId: '123456',
        chatId: '-100123456789',
        totalViolations: 5,
        violationsByArticle: [
          { article: '282', count: 3, averageSeverity: 6.5 },
          { article: '130', count: 2, averageSeverity: 4.0 }
        ],
        averageSeverity: 5.5,
        riskLevel: 'medium',
        lastViolationDate: new Date('2024-01-15'),
        mostCommonViolation: '282'
      };

      // Мокаем метод statisticsService
      vi.spyOn(mockStatisticsService, 'getUserStats').mockResolvedValue(mockUserStats);

      const result = await violationHandler.getUserStats('123456', '-100123456789');

      expect(result).toContain('📊');
      expect(result).toContain('Статистика пользователя');
      expect(result).toContain('<b>Всего нарушений:</b> 5');
      expect(result).toContain('<b>Средняя серьезность:</b> 5.5/10');
      expect(result).toContain('🟡 Средний'); // Medium risk level
      expect(result).toContain('<b>Статья 282:</b> 3 раз');
      expect(result).toContain('<b>Статья 130:</b> 2 раз');
    });

    it('должен обрабатывать ошибку при получении статистики пользователя', async () => {
      // Подавляем console.error для этого теста, так как ошибка базы данных ожидаема
      const originalError = console.error;
      console.error = vi.fn();

      try {
        vi.spyOn(mockStatisticsService, 'getUserStats').mockRejectedValue(new Error('Database error'));

        const result = await violationHandler.getUserStats('123456', '-100123456789');

        // Теперь возвращается fallback статистика с предупреждением
        expect(result).toContain('📊');
        expect(result).toContain('Статистика пользователя');
        expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

        // Проверяем, что ошибка была залогирована
        expect(console.error).toHaveBeenCalledWith(
          '❌ Error getting user stats:',
          expect.any(Error)
        );
      } finally {
        // Восстанавливаем оригинальный console.error
        console.error = originalError;
      }
    });

    it('должен валидировать параметры для getUserStats', async () => {
      // Подавляем console.error для этого теста, так как ошибки валидации ожидаемы
      const originalError = console.error;
      console.error = vi.fn();

      try {
        // Теперь возвращается fallback статистика с предупреждением
        const result1 = await violationHandler.getUserStats('', '-100123456789');
        expect(result1).toContain('📊');
        expect(result1).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

        const result2 = await violationHandler.getUserStats('123456', '');
        expect(result2).toContain('📊');
        expect(result2).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

        // Проверяем, что ошибки валидации были залогированы
        expect(console.error).toHaveBeenCalledTimes(2);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('getPeriodStats', () => {
    it('должен получать и форматировать статистику за период', async () => {
      const mockPeriodStats: PeriodStats = {
        chatId: '-100123456789',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-07'),
        totalViolations: 10,
        violationsByArticle: [
          { article: '282', count: 6, averageSeverity: 7.0 },
          { article: '205', count: 4, averageSeverity: 9.0 }
        ],
        averageSeverity: 7.8,
        uniqueUsers: 3,
        comparisonWithPreviousPeriod: {
          violationsChange: 25.0,
          severityChange: 1.2,
          usersChange: 50.0
        }
      };

      vi.spyOn(mockStatisticsService, 'getPeriodStats').mockResolvedValue(mockPeriodStats);

      const result = await violationHandler.getPeriodStats('-100123456789', 7);

      expect(result).toContain('📈');
      expect(result).toContain('Статистика за период');
      expect(result).toContain('<b>Всего нарушений:</b> 10');
      expect(result).toContain('<b>Уникальных пользователей:</b> 3');
      expect(result).toContain('<b>Средняя серьезность:</b> 7.8/10');
      expect(result).toContain('увеличение на 25.0%');
      expect(result).toContain('повышение на 1.2');
    });

    it('должен валидировать параметры для getPeriodStats', async () => {
      // Подавляем console.error для этого теста, так как ошибки валидации ожидаемы
      const originalError = console.error;
      console.error = vi.fn();

      try {
        // Теперь возвращается fallback статистика с предупреждением
        const result1 = await violationHandler.getPeriodStats('', 7);
        expect(result1).toContain('📈');
        expect(result1).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

        // Параметры санитизируются к валидным значениям
        const result2 = await violationHandler.getPeriodStats('-100123456789', 0);
        expect(result2).toContain('📈');
        expect(result2).toContain('За указанный период нарушений не зафиксировано');

        const result3 = await violationHandler.getPeriodStats('-100123456789', 400);
        expect(result3).toContain('📈');
        expect(result3).toContain('За указанный период нарушений не зафиксировано');

        // Проверяем, что ошибки были залогированы (может быть больше из-за fallback попыток)
        expect(console.error).toHaveBeenCalled();
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('getGeneralStats', () => {
    it('должен получать и форматировать общую статистику', async () => {
      const mockGeneralStats: GeneralStats = {
        chatId: '-100123456789',
        totalViolations: 50,
        topViolations: [
          { article: '282', count: 20, averageSeverity: 6.5 },
          { article: '205', count: 15, averageSeverity: 9.0 },
          { article: '130', count: 10, averageSeverity: 4.0 }
        ],
        topUsers: [
          { userId: '123', count: 15, averageSeverity: 7.0, riskLevel: 'high' },
          { userId: '456', count: 10, averageSeverity: 5.0, riskLevel: 'medium' }
        ],
        overallRiskLevel: 'high',
        averageSeverity: 6.8,
        criticalViolations: [
          {
            article: '205',
            quote: 'Критическое нарушение',
            punishment: 'Лишение свободы',
            severity: 10,
            confidence: 0.95
          }
        ]
      };

      vi.spyOn(mockStatisticsService, 'getGeneralStats').mockResolvedValue(mockGeneralStats);

      const result = await violationHandler.getGeneralStats('-100123456789');

      expect(result).toContain('📊');
      expect(result).toContain('Общая статистика чата');
      expect(result).toContain('<b>Всего нарушений:</b> 50');
      expect(result).toContain('<b>Средняя серьезность:</b> 6.8/10');
      expect(result).toContain('🔴 Высокий'); // High risk level
      expect(result).toContain('🏆 Топ-5 самых частых нарушений');
      expect(result).toContain('👤 Топ-5 пользователей');
      expect(result).toContain('🚨 <b>Критические нарушения (серьезность ≥ 8):</b>');
    });

    it('должен валидировать параметры для getGeneralStats', async () => {
      // Подавляем console.error для этого теста, так как ошибка валидации ожидаема
      const originalError = console.error;
      console.error = vi.fn();

      try {
        // Теперь возвращается fallback статистика с предупреждением
        const result = await violationHandler.getGeneralStats('');
        expect(result).toContain('📊');
        expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

        // Проверяем, что ошибка валидации была залогирована
        expect(console.error).toHaveBeenCalledTimes(1);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('Error Handling', () => {
    it('должен обрабатывать ошибки базы данных gracefully', async () => {
      // Подавляем console.error для этого теста, так как ошибка ожидаема
      const originalError = console.error;
      console.error = vi.fn();

      try {
        vi.spyOn(mockStatisticsService, 'getUserStats').mockRejectedValue(new Error('Connection timeout'));

        const result = await violationHandler.getUserStats('123456', '-100123456789');

        // Теперь возвращается fallback статистика с предупреждением
        expect(result).toContain('📊');
        expect(result).toContain('Статистика пользователя');
        expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

        // Проверяем, что ошибка была залогирована
        expect(console.error).toHaveBeenCalledWith(
          '❌ Error getting user stats:',
          expect.any(Error)
        );
      } finally {
        console.error = originalError;
      }
    });

    it('должен обрабатывать неизвестные ошибки', async () => {
      // Подавляем console.error для этого теста, так как ошибка ожидаема
      const originalError = console.error;
      console.error = vi.fn();

      try {
        vi.spyOn(mockStatisticsService, 'getPeriodStats').mockRejectedValue('Unknown error');

        const result = await violationHandler.getPeriodStats('-100123456789', 7);

        // Теперь возвращается fallback статистика с предупреждением
        expect(result).toContain('📈');
        expect(result).toContain('Статистика за период');
        expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

        // Проверяем, что ошибка была залогирована (строка, а не Error объект)
        expect(console.error).toHaveBeenCalledWith(
          '❌ Error getting period stats:',
          'Unknown error'
        );
      } finally {
        console.error = originalError;
      }
    });
  });

  describe('Integration with Dependencies', () => {
    it('должен использовать переданные зависимости', () => {
      const customFormatter = new MessageFormatter();
      const customService = new StatisticsService(mockViolationRepository);
      const customRepository = new ViolationRepository(mockEnv);

      const handler = new ViolationHandler(
        mockEnv,
        customFormatter,
        customService,
        customRepository
      );

      expect(handler).toBeDefined();
      // Проверяем, что handler создан с кастомными зависимостями
      expect(handler['messageFormatter']).toBe(customFormatter);
      expect(handler['statisticsService']).toBe(customService);
      expect(handler['violationRepository']).toBe(customRepository);
    });

    it('должен создавать зависимости по умолчанию', () => {
      const handler = new ViolationHandler(mockEnv);

      expect(handler).toBeDefined();
      expect(handler['messageFormatter']).toBeInstanceOf(MessageFormatter);
      expect(handler['statisticsService']).toBeInstanceOf(StatisticsService);
      expect(handler['violationRepository']).toBeInstanceOf(ViolationRepository);
    });
  });
});