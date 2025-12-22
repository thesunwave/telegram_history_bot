/**
 * Unit тесты для StatisticsService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StatisticsService } from '../../src/core/services/statistics-service';
import type { IViolationRepository } from '../../src/core/repositories/violation-repository';
import type {
  Violation,
  UserStats,
  PeriodStats,
  GeneralStats,
  ViolationCount,
  UserViolationCount
} from '../../src/models/statistics';

// Мок репозитория
const mockViolationRepository: IViolationRepository = {
  save: vi.fn(),
  getUserViolations: vi.fn(),
  getPeriodViolations: vi.fn(),
  getAllViolations: vi.fn(),
  getUserStats: vi.fn(),
  getPeriodStats: vi.fn(),
  getGeneralStats: vi.fn()
};

describe('StatisticsService', () => {
  let statisticsService: StatisticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    statisticsService = new StatisticsService(mockViolationRepository);
  });

  describe('getUserStats', () => {
    it('должен возвращать пустую статистику для пользователя без нарушений', async () => {
      // Arrange
      const userId = '123';
      const chatId = '456';
      const emptyUserStats: UserStats = {
        userId,
        chatId,
        totalViolations: 0,
        violationsByArticle: [],
        averageSeverity: 0,
        riskLevel: 'low',
        lastViolationDate: undefined,
        mostCommonViolation: undefined
      };

      vi.mocked(mockViolationRepository.getUserStats).mockResolvedValue(emptyUserStats);

      // Act
      const result = await statisticsService.getUserStats(userId, chatId);

      // Assert
      expect(result).toEqual(emptyUserStats);
      expect(mockViolationRepository.getUserStats).toHaveBeenCalledWith(userId, chatId);
    });

    it('должен правильно группировать нарушения по статьям УК РФ', async () => {
      // Arrange
      const userId = '123';
      const chatId = '456';
      const expectedUserStats: UserStats = {
        userId,
        chatId,
        totalViolations: 3,
        violationsByArticle: [
          {
            article: 'Статья 105 УК РФ',
            subarticle: null,
            articleTitle: 'Убийство',
            punishment: 'лишение свободы на срок от шести до пятнадцати лет',
            count: 2,
            averageSeverity: 9.5
          },
          {
            article: 'Статья 158 УК РФ',
            subarticle: '1',
            articleTitle: 'Кража',
            punishment: 'штраф в размере до восьмидесяти тысяч рублей',
            count: 1,
            averageSeverity: 3
          }
        ],
        averageSeverity: 7.33,
        riskLevel: 'high',
        mostCommonViolation: 'Статья 105 УК РФ'
      };

      vi.mocked(mockViolationRepository.getUserStats).mockResolvedValue(expectedUserStats);

      // Act
      const result = await statisticsService.getUserStats(userId, chatId);

      // Assert
      expect(result).toEqual(expectedUserStats);
      expect(mockViolationRepository.getUserStats).toHaveBeenCalledWith(userId, chatId);
    });

    it('должен правильно вычислять уровень риска', async () => {
      // Arrange
      const userId = '123';
      const chatId = '456';

      const lowRiskUserStats: UserStats = {
        userId,
        chatId,
        totalViolations: 2,
        violationsByArticle: [
          {
            article: 'Статья 158 УК РФ',
            subarticle: null,
            articleTitle: 'Кража',
            punishment: 'штраф в размере до восьмидесяти тысяч рублей',
            count: 2,
            averageSeverity: 2.5
          }
        ],
        averageSeverity: 2.5,
        riskLevel: 'low',
        mostCommonViolation: 'Статья 158 УК РФ'
      };

      vi.mocked(mockViolationRepository.getUserStats).mockResolvedValue(lowRiskUserStats);

      // Act
      const result = await statisticsService.getUserStats(userId, chatId);

      // Assert
      expect(result.averageSeverity).toBe(2.5);
      expect(result.riskLevel).toBe('low');
    });

    it('должен обрабатывать ошибки репозитория', async () => {
      // Arrange
      const userId = '123';
      const chatId = '456';
      const error = new Error('Database error');
      vi.mocked(mockViolationRepository.getUserStats).mockRejectedValue(error);

      // Act & Assert
      await expect(statisticsService.getUserStats(userId, chatId))
        .rejects.toThrow('Failed to get user stats: Database error');
    });
  });

  describe('getPeriodStats', () => {
    it('должен возвращать статистику за период с подсчетом изменений', async () => {
      // Arrange
      const chatId = '456';
      const days = 7;

      const expectedPeriodStats: PeriodStats = {
        chatId,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-08'),
        totalViolations: 2,
        violationsByArticle: [
          {
            article: 'Статья 105 УК РФ',
            subarticle: null,
            articleTitle: 'Убийство',
            punishment: 'лишение свободы на срок от шести до пятнадцати лет',
            count: 1,
            averageSeverity: 10
          },
          {
            article: 'Статья 158 УК РФ',
            subarticle: null,
            articleTitle: 'Кража',
            punishment: 'штраф в размере до восьмидесяти тысяч рублей',
            count: 1,
            averageSeverity: 3
          }
        ],
        averageSeverity: 6.5,
        uniqueUsers: 2,
        comparisonWithPreviousPeriod: {
          violationsChange: 100,
          severityChange: 2.5,
          usersChange: 50
        }
      };

      vi.mocked(mockViolationRepository.getPeriodStats).mockResolvedValue(expectedPeriodStats);

      // Act
      const result = await statisticsService.getPeriodStats(chatId, days);

      // Assert
      expect(result).toEqual(expectedPeriodStats);
      expect(mockViolationRepository.getPeriodStats).toHaveBeenCalledWith(chatId, days);
    });

    it('должен обрабатывать период без нарушений', async () => {
      // Arrange
      const chatId = '456';
      const days = 7;

      const emptyPeriodStats: PeriodStats = {
        chatId,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-08'),
        totalViolations: 0,
        violationsByArticle: [],
        averageSeverity: 0,
        uniqueUsers: 0
      };

      vi.mocked(mockViolationRepository.getPeriodStats).mockResolvedValue(emptyPeriodStats);

      // Act
      const result = await statisticsService.getPeriodStats(chatId, days);

      // Assert
      expect(result.totalViolations).toBe(0);
      expect(result.averageSeverity).toBe(0);
      expect(result.violationsByArticle).toHaveLength(0);
      expect(result.uniqueUsers).toBe(0);
    });

    it('должен обрабатывать ошибки репозитория', async () => {
      // Arrange
      const chatId = '456';
      const days = 7;
      const error = new Error('Database error');
      vi.mocked(mockViolationRepository.getPeriodStats).mockRejectedValue(error);

      // Act & Assert
      await expect(statisticsService.getPeriodStats(chatId, days))
        .rejects.toThrow('Failed to get period stats: Database error');
    });
  });

  describe('getGeneralStats', () => {
    it('должен возвращать общую статистику с топ-5 нарушений', async () => {
      // Arrange
      const chatId = '456';

      const expectedGeneralStats: GeneralStats = {
        chatId,
        totalViolations: 6,
        topViolations: [
          {
            article: 'Статья 105 УК РФ',
            subarticle: null,
            articleTitle: 'Убийство',
            punishment: 'лишение свободы на срок от шести до пятнадцати лет',
            count: 3,
            averageSeverity: 9
          },
          {
            article: 'Статья 158 УК РФ',
            subarticle: '1',
            articleTitle: 'Кража',
            punishment: 'штраф в размере до восьмидесяти тысяч рублей',
            count: 2,
            averageSeverity: 3.5
          },
          {
            article: 'Статья 228 УК РФ',
            subarticle: null,
            articleTitle: 'Незаконные приобретение, хранение, перевозка, изготовление, переработка наркотических средств',
            punishment: 'лишение свободы на срок до трех лет',
            count: 1,
            averageSeverity: 5
          }
        ],
        topUsers: [
          {
            userId: '123',
            count: 4,
            averageSeverity: 7.5,
            riskLevel: 'high'
          },
          {
            userId: '456',
            count: 2,
            averageSeverity: 4,
            riskLevel: 'medium'
          }
        ],
        overallRiskLevel: 'high',
        averageSeverity: 6.5,
        criticalViolations: [
          { article: '105', subarticle: null, articleTitle: 'Убийство', quote: 'Убийство 1', punishment: 'Лишение свободы', severity: 10, confidence: 0.9 },
          { article: '105', subarticle: null, articleTitle: 'Убийство', quote: 'Убийство 2', punishment: 'Лишение свободы', severity: 9, confidence: 0.8 },
          { article: '105', subarticle: null, articleTitle: 'Убийство', quote: 'Убийство 3', punishment: 'Лишение свободы', severity: 8, confidence: 0.7 }
        ]
      };

      vi.mocked(mockViolationRepository.getGeneralStats).mockResolvedValue(expectedGeneralStats);

      // Act
      const result = await statisticsService.getGeneralStats(chatId);

      // Assert
      expect(result).toEqual(expectedGeneralStats);
      expect(mockViolationRepository.getGeneralStats).toHaveBeenCalledWith(chatId);
    });

    it('должен возвращать пустую статистику для чата без нарушений', async () => {
      // Arrange
      const chatId = '456';

      const emptyGeneralStats: GeneralStats = {
        chatId,
        totalViolations: 0,
        topViolations: [],
        topUsers: [],
        overallRiskLevel: 'low',
        averageSeverity: 0,
        criticalViolations: []
      };

      vi.mocked(mockViolationRepository.getGeneralStats).mockResolvedValue(emptyGeneralStats);

      // Act
      const result = await statisticsService.getGeneralStats(chatId);

      // Assert
      expect(result).toEqual(emptyGeneralStats);
    });

    it('должен обрабатывать ошибки репозитория', async () => {
      // Arrange
      const chatId = '456';
      const error = new Error('Database error');
      vi.mocked(mockViolationRepository.getGeneralStats).mockRejectedValue(error);

      // Act & Assert
      await expect(statisticsService.getGeneralStats(chatId))
        .rejects.toThrow('Failed to get general stats: Database error');
    });
  });

  describe('saveViolation', () => {
    it('должен сохранять нарушение через репозиторий', async () => {
      // Arrange
      const violation: Violation = {
        article: 'Статья 105 УК РФ',
        quote: 'Убийство',
        punishment: 'Лишение свободы',
        severity: 10,
        confidence: 0.9
      };
      const userId = '123';
      const chatId = '456';

      vi.mocked(mockViolationRepository.save).mockResolvedValue();

      // Act
      await statisticsService.saveViolation(violation, userId, chatId);

      // Assert
      expect(mockViolationRepository.save).toHaveBeenCalledWith(violation, userId, chatId);
    });

    it('должен обрабатывать ошибки сохранения', async () => {
      // Arrange
      const violation: Violation = {
        article: 'Статья 105 УК РФ',
        quote: 'Убийство',
        punishment: 'Лишение свободы',
        severity: 10,
        confidence: 0.9
      };
      const userId = '123';
      const chatId = '456';
      const error = new Error('Save error');

      vi.mocked(mockViolationRepository.save).mockRejectedValue(error);

      // Act & Assert
      await expect(statisticsService.saveViolation(violation, userId, chatId))
        .rejects.toThrow('Failed to save violation: Save error');
    });
  });


});