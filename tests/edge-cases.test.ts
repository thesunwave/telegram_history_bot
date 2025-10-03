/**
 * Comprehensive edge case tests for violation handling system
 * Tests all possible edge cases including corrupted data, missing fields, and error scenarios
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ViolationHandler } from '../src/violation-handler';
import { MessageFormatter } from '../src/message-formatter';
import { StatisticsService } from '../src/services/statistics-service';
import { ViolationRepository } from '../src/repositories/violation-repository';
import { DataSanitizer, ValidationUtils, ValidationError } from '../src/models/validation';
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

describe('Edge Cases Tests', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let violationHandler: ViolationHandler;
  let messageFormatter: MessageFormatter;
  let mockStatisticsService: StatisticsService;
  let mockViolationRepository: ViolationRepository;

  beforeEach(() => {
    mockViolationRepository = new ViolationRepository(mockEnv);
    mockStatisticsService = new StatisticsService(mockViolationRepository);
    messageFormatter = new MessageFormatter();
    violationHandler = new ViolationHandler(
      mockEnv,
      undefined, // no service registry
      messageFormatter,
      mockStatisticsService,
      mockViolationRepository
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('ViolationAnalysis Edge Cases', () => {

    it('должен обрабатывать null ViolationAnalysis', async () => {
      const result = await violationHandler.formatViolationMessage(null as any);
      
      expect(result).toContain('✅');
      expect(result).toContain('Нарушений не обнаружено');
      // Null analysis создает пустой анализ, не ошибку
    });

    it('должен обрабатывать undefined ViolationAnalysis', async () => {
      const result = await violationHandler.formatViolationMessage(undefined as any);
      
      expect(result).toContain('✅');
      expect(result).toContain('Нарушений не обнаружено');
      // Undefined analysis создает пустой анализ, не ошибку
    });

    it('должен обрабатывать пустой объект ViolationAnalysis', async () => {
      const result = await violationHandler.formatViolationMessage({} as any);
      
      expect(result).toContain('✅');
      expect(result).toContain('Нарушений не обнаружено');
    });

    it('должен обрабатывать ViolationAnalysis с поврежденными полями', async () => {
      const corruptedAnalysis = {
        hasViolations: 'true', // Неверный тип
        violations: 'not an array', // Неверный тип
        totalSeverity: 'invalid', // Неверный тип
        riskLevel: 'invalid', // Неверное значение
        analysisTimestamp: null // Неверный тип
      };

      const result = await violationHandler.formatViolationMessage(corruptedAnalysis as any);
      
      expect(result).toContain('✅');
      expect(result).toContain('Нарушений не обнаружено');
    });

    it('должен обрабатывать ViolationAnalysis с поврежденными нарушениями', async () => {
      const analysisWithCorruptedViolations = {
        hasViolations: true,
        violations: [
          null, // Null нарушение
          undefined, // Undefined нарушение
          {}, // Пустое нарушение
          {
            article: '', // Пустая статья
            quote: null, // Null цитата
            punishment: undefined, // Undefined наказание
            severity: 'invalid', // Неверный тип серьезности
            confidence: 2.5 // Неверное значение доверия
          },
          { article: 'Статья 282 УК РФ', subarticle: null, articleTitle: "Test Article Title",
            quote: 'Валидная цитата',
            punishment: 'Валидное наказание',
            severity: 7,
            confidence: 0.8
          }
        ],
        totalSeverity: 7,
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(analysisWithCorruptedViolations as any);
      
      expect(result).toContain('🚨');
      expect(result).toContain('Обнаружены нарушения УК РФ');
      // После санитизации остается только валидное нарушение
      expect(result).toContain('Статья 282 УК РФ');
      expect(result).toContain('Валидная цитата');
    });

    it('должен добавлять предупреждение для низкого уровня доверия', async () => {
      const lowConfidenceAnalysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            quote: 'Сомнительная цитата',
            punishment: 'Штраф',
            severity: 5,
            confidence: 0.65 // Низкий уровень доверия
          }
        ],
        totalSeverity: 5,
        riskLevel: 'medium',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(lowConfidenceAnalysis);
      
      expect(result).toContain('⚠️');
      expect(result).toContain('Низкий уровень доверия к анализу');
    });

    it('должен обрабатывать экстремальные значения серьезности', async () => {
      const extremeAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            quote: 'Тест',
            punishment: 'Тест',
            severity: -5, // Отрицательная серьезность
            confidence: 0.8
          },
          {
            article: '205',
            quote: 'Тест',
            punishment: 'Тест',
            severity: 15, // Слишком высокая серьезность
            confidence: 0.9
          }
        ],
        totalSeverity: 10,
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(extremeAnalysis as any);
      
      expect(result).toContain('🚨');
      expect(result).toContain('Обнаружены нарушения УК РФ');
    });
  });

  describe('Statistics Edge Cases', () => {

    it('должен обрабатывать пустую статистику пользователя', async () => {
      vi.spyOn(mockStatisticsService, 'getUserStats').mockResolvedValue(
        DataSanitizer.createEmptyUserStats('123', '456')
      );

      const result = await violationHandler.getUserStats('123', '456');
      
      expect(result).toContain('📊');
      expect(result).toContain('Статистика пользователя');
      expect(result).toContain('Всего нарушений:</b> 0');
      expect(result).toContain('У пользователя пока нет нарушений');
    });

    it('должен обрабатывать null статистику пользователя', async () => {
      vi.spyOn(mockStatisticsService, 'getUserStats').mockResolvedValue(null as any);

      const result = await violationHandler.getUserStats('123', '456');
      
      expect(result).toContain('📊');
      expect(result).toContain('Всего нарушений:</b> 0');
    });

    it('должен обрабатывать ошибки базы данных при получении статистики пользователя', async () => {
      vi.spyOn(mockStatisticsService, 'getUserStats').mockRejectedValue(new Error('Database connection failed'));

      const result = await violationHandler.getUserStats('123', '456');
      
      expect(result).toContain('📊');
      expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');
    });

    it('должен обрабатывать пустую статистику за период', async () => {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - 7);
      
      vi.spyOn(mockStatisticsService, 'getPeriodStats').mockResolvedValue(
        DataSanitizer.createEmptyPeriodStats('456', startDate, endDate)
      );

      const result = await violationHandler.getPeriodStats('456', 7);
      
      expect(result).toContain('📈');
      expect(result).toContain('Статистика за период');
      expect(result).toContain('Всего нарушений:</b> 0');
      expect(result).toContain('За указанный период нарушений не зафиксировано');
    });

    it('должен обрабатывать пустую общую статистику', async () => {
      vi.spyOn(mockStatisticsService, 'getGeneralStats').mockResolvedValue(
        DataSanitizer.createEmptyGeneralStats('456')
      );

      const result = await violationHandler.getGeneralStats('456');
      
      expect(result).toContain('📊');
      expect(result).toContain('Общая статистика чата');
      expect(result).toContain('Всего нарушений:</b> 0');
      expect(result).toContain('В чате пока не зафиксировано нарушений');
    });

    it('должен обрабатывать невалидные параметры для getUserStats', async () => {
      // Пустые строки санитизируются, но затем валидация их отклоняет
      const result1 = await violationHandler.getUserStats('', '456');
      expect(result1).toContain('📊'); // Fallback статистика
      expect(result1).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

      const result2 = await violationHandler.getUserStats('123', '');
      expect(result2).toContain('📊'); // Fallback статистика
      expect(result2).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

      const result3 = await violationHandler.getUserStats(null as any, '456');
      expect(result3).toContain('📊'); // Fallback статистика

      const result4 = await violationHandler.getUserStats('123', undefined as any);
      expect(result4).toContain('📊'); // Fallback статистика
    });

    it('должен обрабатывать невалидные параметры для getPeriodStats', async () => {
      // Пустые строки санитизируются, но затем валидация их отклоняет
      const result1 = await violationHandler.getPeriodStats('', 7);
      expect(result1).toContain('📈'); // Fallback статистика
      expect(result1).toContain('⚠️ Данные могут быть неполными из-за технических проблем');

      const result2 = await violationHandler.getPeriodStats('456', 0);
      expect(result2).toContain('📈'); // Санитизируется к 1 дню
      expect(result2).toContain('За указанный период нарушений не зафиксировано');

      const result3 = await violationHandler.getPeriodStats('456', 400);
      expect(result3).toContain('📈'); // Санитизируется к 365 дням
      expect(result3).toContain('За указанный период нарушений не зафиксировано');

      const result4 = await violationHandler.getPeriodStats('456', -5);
      expect(result4).toContain('📈'); // Должен санитизировать к валидному значению
    });
  });

  describe('MessageFormatter Edge Cases', () => {

    it('должен обрабатывать null статистику в formatUserStats', () => {
      const result = messageFormatter.formatUserStats(null as any);
      
      expect(result).toContain('❌');
      expect(result).toContain('данные статистики недоступны');
    });

    it('должен обрабатывать статистику с поврежденными датами', () => {
      const statsWithBadDate: UserStats = {
        userId: '123',
        chatId: '456',
        totalViolations: 1,
        violationsByArticle: [],
        averageSeverity: 5,
        riskLevel: 'medium',
        lastViolationDate: 'invalid date' as any, // Неверный тип даты
        mostCommonViolation: '282'
      };

      const result = messageFormatter.formatUserStats(statsWithBadDate);
      
      expect(result).toContain('📊');
      expect(result).toContain('Статистика пользователя');
      expect(result).not.toContain('Последнее нарушение:');
    });

    it('должен обрабатывать статистику с поврежденными нарушениями по статьям', () => {
      const statsWithBadViolations: UserStats = {
        userId: '123',
        chatId: '456',
        totalViolations: 3,
        violationsByArticle: [
          null as any, // Null нарушение
          { article: '', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 0, averageSeverity: 0 }, // Пустое нарушение
          { article: '282', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 2, averageSeverity: 15 }, // Неверная серьезность
          { article: '205', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 1, averageSeverity: 8 } // Валидное нарушение
        ],
        averageSeverity: 6,
        riskLevel: 'medium'
      };

      const result = messageFormatter.formatUserStats(statsWithBadViolations);
      
      expect(result).toContain('📊');
      expect(result).toContain('Статистика пользователя');
      expect(result).toContain('Статья 205');
      // Статья 282 показывается, но без эмодзи из-за неверной серьезности
      expect(result).toContain('Статья 282');
    });

    it('должен обрабатывать экстремальные значения серьезности в getSeverityEmoji', () => {
      // Функция теперь обрабатывает недопустимые значения gracefully
      expect(messageFormatter.getSeverityEmoji(0)).toBe('🟢'); // Clamped to 1 (low)
      expect(messageFormatter.getSeverityEmoji(11)).toBe('🔴'); // Clamped to 10 (high)
      expect(messageFormatter.getSeverityEmoji(-1)).toBe('🟢'); // Clamped to 1 (low)
      expect(messageFormatter.getSeverityEmoji(NaN)).toBe('🟢'); // Default to low
      expect(messageFormatter.getSeverityEmoji(Infinity)).toBe('🔴'); // Clamped to 10 (high)
    });

    it('должен правильно экранировать HTML в цитатах', () => {
      const maliciousViolation: Violation = {
        article: '282',
        quote: '<script>alert("XSS")</script> & "dangerous" content',
        punishment: 'штраф',
        severity: 5,
        confidence: 0.8
      };

      const result = messageFormatter.formatViolation(maliciousViolation);
      
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;dangerous&quot;');
    });
  });

  describe('DataSanitizer Edge Cases', () => {

    it('должен санитизировать поврежденное нарушение', () => {
      const corruptedViolation = {
        article: 'Статья 282', // Валидная статья
        quote: undefined,
        punishment: 123, // Неверный тип
        severity: 'high', // Неверный тип
        confidence: 1.5 // Неверное значение
      };

      const sanitized = DataSanitizer.sanitizeViolation(corruptedViolation);
      
      expect(sanitized.article).toBe('Статья 282');
      expect(sanitized.quote).toBe('Данные повреждены');
      expect(sanitized.punishment).toBe('123');
      expect(sanitized.severity).toBe(1);
      expect(sanitized.confidence).toBe(1); // Clamped from 1.5 to 1
    });

    it('должен санитизировать полностью поврежденный анализ', () => {
      const corruptedAnalysis = 'not an object';

      const sanitized = DataSanitizer.sanitizeViolationAnalysis(corruptedAnalysis);
      
      expect(sanitized.hasViolations).toBe(false);
      expect(sanitized.violations).toEqual([]);
      expect(sanitized.totalSeverity).toBe(0);
      expect(sanitized.riskLevel).toBe('low');
      expect(sanitized.analysisTimestamp).toBeDefined();
    });

    it('должен создавать пустую статистику с валидными значениями', () => {
      const emptyUserStats = DataSanitizer.createEmptyUserStats('', '');
      
      expect(emptyUserStats.userId).toBe('unknown');
      expect(emptyUserStats.chatId).toBe('unknown');
      expect(emptyUserStats.totalViolations).toBe(0);
      expect(emptyUserStats.violationsByArticle).toEqual([]);
      expect(emptyUserStats.averageSeverity).toBe(0);
      expect(emptyUserStats.riskLevel).toBe('low');
    });
  });

  describe('ValidationUtils Edge Cases', () => {

    it('должен санитизировать экстремальные значения серьезности', () => {
      expect(ValidationUtils.sanitizeSeverity(-10)).toBe(1);
      expect(ValidationUtils.sanitizeSeverity(0)).toBe(1);
      expect(ValidationUtils.sanitizeSeverity(15)).toBe(10);
      expect(ValidationUtils.sanitizeSeverity(5.7)).toBe(6);
      expect(ValidationUtils.sanitizeSeverity('7')).toBe(7);
      expect(ValidationUtils.sanitizeSeverity('invalid')).toBe(1);
      expect(ValidationUtils.sanitizeSeverity(null)).toBe(1);
      expect(ValidationUtils.sanitizeSeverity(undefined)).toBe(1);
      expect(ValidationUtils.sanitizeSeverity(NaN)).toBe(1);
      expect(ValidationUtils.sanitizeSeverity(Infinity)).toBe(10);
    });

    it('должен санитизировать экстремальные значения доверия', () => {
      expect(ValidationUtils.sanitizeConfidence(-0.5)).toBe(0);
      expect(ValidationUtils.sanitizeConfidence(1.5)).toBe(1);
      expect(ValidationUtils.sanitizeConfidence('0.8')).toBe(0.8);
      expect(ValidationUtils.sanitizeConfidence('invalid')).toBe(0.5);
      expect(ValidationUtils.sanitizeConfidence(null)).toBe(0.5);
      expect(ValidationUtils.sanitizeConfidence(undefined)).toBe(0.5);
      expect(ValidationUtils.sanitizeConfidence(NaN)).toBe(0.5);
    });

    it('должен правильно определять пустые значения', () => {
      expect(ValidationUtils.isEmpty(null)).toBe(true);
      expect(ValidationUtils.isEmpty(undefined)).toBe(true);
      expect(ValidationUtils.isEmpty('')).toBe(true);
      expect(ValidationUtils.isEmpty('   ')).toBe(true);
      expect(ValidationUtils.isEmpty([])).toBe(true);
      expect(ValidationUtils.isEmpty({})).toBe(true);
      expect(ValidationUtils.isEmpty('text')).toBe(false);
      expect(ValidationUtils.isEmpty([1, 2, 3])).toBe(false);
      expect(ValidationUtils.isEmpty({ key: 'value' })).toBe(false);
      expect(ValidationUtils.isEmpty(0)).toBe(false);
      expect(ValidationUtils.isEmpty(false)).toBe(false);
    });

    it('должен санитизировать строки', () => {
      expect(ValidationUtils.sanitizeString('  test  ')).toBe('test');
      expect(ValidationUtils.sanitizeString(123)).toBe('123');
      expect(ValidationUtils.sanitizeString(null)).toBe('');
      expect(ValidationUtils.sanitizeString(undefined)).toBe('');
      expect(ValidationUtils.sanitizeString('', 'fallback')).toBe('fallback');
    });

    it('должен санитизировать даты', () => {
      const validDate = new Date('2024-01-01');
      expect(ValidationUtils.sanitizeDate(validDate)).toBe(validDate);
      expect(ValidationUtils.sanitizeDate('2024-01-01')).toBeInstanceOf(Date);
      expect(ValidationUtils.sanitizeDate('invalid')).toBeUndefined();
      expect(ValidationUtils.sanitizeDate(null)).toBeUndefined();
      expect(ValidationUtils.sanitizeDate(undefined)).toBeUndefined();
    });
  });

  describe('Network and Database Error Scenarios', () => {

    it('должен обрабатывать таймаут базы данных', async () => {
      vi.spyOn(mockStatisticsService, 'getUserStats').mockRejectedValue(new Error('Connection timeout'));

      const result = await violationHandler.getUserStats('123', '456');
      
      expect(result).toContain('📊');
      expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');
    });

    it('должен обрабатывать ошибки сети', async () => {
      vi.spyOn(mockStatisticsService, 'getPeriodStats').mockRejectedValue(new Error('Network error'));

      const result = await violationHandler.getPeriodStats('456', 7);
      
      expect(result).toContain('📈');
      expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');
    });

    it('должен обрабатывать неизвестные ошибки', async () => {
      vi.spyOn(mockStatisticsService, 'getGeneralStats').mockRejectedValue('Unknown error type');

      const result = await violationHandler.getGeneralStats('456');
      
      expect(result).toContain('📊');
      expect(result).toContain('⚠️ Данные могут быть неполными из-за технических проблем');
    });
  });

  describe('Memory and Performance Edge Cases', () => {

    it('должен обрабатывать очень длинные цитаты', () => {
      const longQuote = 'A'.repeat(10000); // 10KB строка
      const violation: Violation = {
        article: '282',
        quote: longQuote,
        punishment: 'штраф',
        severity: 5,
        confidence: 0.8
      };

      const result = messageFormatter.formatViolation(violation);
      
      expect(result).toContain('Статья 282 УК РФ');
      expect(result.length).toBeLessThan(15000); // Должно быть разумного размера
    });

    it('должен обрабатывать большое количество нарушений', async () => {
      const manyViolations: Violation[] = Array.from({ length: 100 }, (_, i) => ({
        article: `${i + 100}`,
        quote: `Нарушение ${i + 1}`,
        punishment: 'штраф',
        severity: (i % 10) + 1,
        confidence: 0.8
      }));

      const analysis: ViolationAnalysis = {
        hasViolations: true,
        violations: manyViolations,
        totalSeverity: manyViolations.reduce((sum, v) => sum + v.severity, 0),
        riskLevel: 'high',
        analysisTimestamp: new Date().toISOString()
      };

      const result = await violationHandler.formatViolationMessage(analysis);
      
      expect(result).toContain('🚨');
      expect(result).toContain('Обнаружены нарушения УК РФ');
      expect(result).toContain('Всего нарушений:</b> 100');
    });
  });
});