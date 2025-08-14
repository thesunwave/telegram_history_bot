/**
 * Integration тесты для ViolationRepository
 * Тестируют работу с базой данных D1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ViolationRepository } from '../../src/repositories/violation-repository';
import type { Env } from '../../src/env';
import type { Violation } from '../../src/models/statistics';

// Mock D1 Database
const mockDB = {
  prepare: vi.fn(),
  exec: vi.fn(),
  batch: vi.fn(),
  dump: vi.fn()
};

const mockStmt = {
  bind: vi.fn().mockReturnThis(),
  run: vi.fn(),
  all: vi.fn(),
  first: vi.fn()
};

const mockEnv: Env = {
  DB: mockDB as any,
  // Добавляем другие необходимые поля из Env
} as Env;

describe('ViolationRepository Integration Tests', () => {
  let repository: ViolationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDB.prepare.mockReturnValue(mockStmt);
    repository = new ViolationRepository(mockEnv);
  });

  describe('save()', () => {
    it('должен сохранить нарушение в базу данных', async () => {
      const violation: Violation = {
        article: 'Статья 282',
        quote: 'экстремистские высказывания',
        punishment: 'штраф до 500 тысяч рублей',
        severity: 7,
        confidence: 0.85
      };

      mockStmt.run.mockResolvedValue({ success: true });

      await repository.save(violation, '12345', '-1001234567890');

      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO criminal_violations'));
      expect(mockStmt.bind).toHaveBeenCalledWith(
        12345,
        -1001234567890,
        'Статья 282',
        'экстремистские высказывания',
        'штраф до 500 тысяч рублей',
        7,
        0.85
      );
      expect(mockStmt.run).toHaveBeenCalled();
    });

    it('должен выбросить ошибку если база данных недоступна', async () => {
      const repositoryWithoutDB = new ViolationRepository({ DB: null } as any);
      const violation: Violation = {
        article: 'Статья 282',
        quote: 'test',
        punishment: 'test',
        severity: 5,
        confidence: 0.8
      };

      await expect(repositoryWithoutDB.save(violation, '123', '456'))
        .rejects.toThrow('Database not available');
    });
  });

  describe('getUserViolations()', () => {
    it('должен получить все нарушения пользователя', async () => {
      const mockResults = [
        {
          article: 'Статья 282',
          quote: 'экстремистские высказывания',
          punishment: 'штраф до 500 тысяч рублей',
          severity: 7,
          confidence: 0.85
        },
        {
          article: 'Статья 130',
          quote: 'оскорбление личности',
          punishment: 'штраф до 40 тысяч рублей',
          severity: 4,
          confidence: 0.92
        }
      ];

      mockStmt.all.mockResolvedValue({ results: mockResults });

      const result = await repository.getUserViolations('12345', '-1001234567890');

      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT article, quote, punishment, severity, confidence'));
      expect(mockStmt.bind).toHaveBeenCalledWith(12345, -1001234567890);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockResults[0]);
    });

    it('должен вернуть пустой массив если нарушений нет', async () => {
      mockStmt.all.mockResolvedValue({ results: [] });

      const result = await repository.getUserViolations('12345', '-1001234567890');

      expect(result).toEqual([]);
    });
  });

  describe('getPeriodViolations()', () => {
    it('должен получить нарушения за указанный период', async () => {
      const mockResults = [
        {
          article: 'Статья 282',
          quote: 'экстремистские высказывания',
          punishment: 'штраф до 500 тысяч рублей',
          severity: 7,
          confidence: 0.85
        }
      ];

      mockStmt.all.mockResolvedValue({ results: mockResults });

      const result = await repository.getPeriodViolations('-1001234567890', 7);

      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining('datetime(\'now\', \'-7 days\')'));
      expect(mockStmt.bind).toHaveBeenCalledWith(-1001234567890);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockResults[0]);
    });
  });

  describe('getAllViolations()', () => {
    it('должен получить все нарушения в чате', async () => {
      const mockResults = [
        {
          article: 'Статья 282',
          quote: 'экстремистские высказывания',
          punishment: 'штраф до 500 тысяч рублей',
          severity: 7,
          confidence: 0.85
        }
      ];

      mockStmt.all.mockResolvedValue({ results: mockResults });

      const result = await repository.getAllViolations('-1001234567890');

      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE chat_id = ?'));
      expect(mockStmt.bind).toHaveBeenCalledWith(-1001234567890);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockResults[0]);
    });
  });

  describe('getUserStats()', () => {
    it('должен получить статистику пользователя', async () => {
      // Mock для общей статистики пользователя
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 5,
        average_severity: 6.2,
        last_violation_date: '2024-01-15 10:30:00'
      });

      // Mock для нарушений по статьям
      mockStmt.all.mockResolvedValueOnce({
        results: [
          { article: 'Статья 282', count: 3, average_severity: 7.0 },
          { article: 'Статья 130', count: 2, average_severity: 5.0 }
        ]
      });

      const result = await repository.getUserStats('12345', '-1001234567890');

      expect(result.userId).toBe('12345');
      expect(result.chatId).toBe('-1001234567890');
      expect(result.totalViolations).toBe(5);
      expect(result.averageSeverity).toBe(6.2);
      expect(result.riskLevel).toBe('high');
      expect(result.violationsByArticle).toHaveLength(2);
      expect(result.mostCommonViolation).toBe('Статья 282');
      expect(result.lastViolationDate).toBeInstanceOf(Date);
    });

    it('должен обработать случай отсутствия нарушений', async () => {
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 0,
        average_severity: 0,
        last_violation_date: null
      });

      mockStmt.all.mockResolvedValueOnce({ results: [] });

      const result = await repository.getUserStats('12345', '-1001234567890');

      expect(result.totalViolations).toBe(0);
      expect(result.averageSeverity).toBe(0);
      expect(result.riskLevel).toBe('low');
      expect(result.violationsByArticle).toHaveLength(0);
      expect(result.mostCommonViolation).toBeUndefined();
      expect(result.lastViolationDate).toBeUndefined();
    });
  });

  describe('getPeriodStats()', () => {
    it('должен получить статистику за период с сравнением', async () => {
      // Mock для текущего периода
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 10,
        average_severity: 5.5,
        unique_users: 3
      });

      // Mock для нарушений по статьям
      mockStmt.all.mockResolvedValueOnce({
        results: [
          { article: 'Статья 282', count: 6, average_severity: 7.0 },
          { article: 'Статья 130', count: 4, average_severity: 4.0 }
        ]
      });

      // Mock для предыдущего периода
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 8,
        average_severity: 6.0,
        unique_users: 2
      });

      const result = await repository.getPeriodStats('-1001234567890', 7);

      expect(result.chatId).toBe('-1001234567890');
      expect(result.totalViolations).toBe(10);
      expect(result.averageSeverity).toBe(5.5);
      expect(result.uniqueUsers).toBe(3);
      expect(result.violationsByArticle).toHaveLength(2);
      expect(result.comparisonWithPreviousPeriod).toBeDefined();
      expect(result.comparisonWithPreviousPeriod?.violationsChange).toBe(25); // (10-8)/8 * 100
      expect(result.comparisonWithPreviousPeriod?.severityChange).toBe(-0.5); // 5.5 - 6.0
      expect(result.comparisonWithPreviousPeriod?.usersChange).toBe(50); // (3-2)/2 * 100
    });
  }); 
 describe('getGeneralStats()', () => {
    it('должен получить общую статистику чата', async () => {
      // Mock для общей статистики
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 25,
        average_severity: 6.8
      });

      // Mock для топ нарушений
      mockStmt.all.mockResolvedValueOnce({
        results: [
          { article: 'Статья 282', count: 10, average_severity: 7.5 },
          { article: 'Статья 130', count: 8, average_severity: 4.2 },
          { article: 'Статья 319', count: 5, average_severity: 6.0 },
          { article: 'Статья 213', count: 2, average_severity: 8.0 }
        ]
      });

      // Mock для топ пользователей
      mockStmt.all.mockResolvedValueOnce({
        results: [
          { user_id: 12345, count: 8, average_severity: 7.0 },
          { user_id: 12346, count: 6, average_severity: 5.5 },
          { user_id: 12347, count: 4, average_severity: 6.8 }
        ]
      });

      // Mock для критических нарушений
      mockStmt.all.mockResolvedValueOnce({
        results: [
          {
            article: 'Статья 282',
            quote: 'экстремистские высказывания',
            punishment: 'штраф до 500 тысяч рублей',
            severity: 9,
            confidence: 0.95
          },
          {
            article: 'Статья 213',
            quote: 'хулиганство',
            punishment: 'лишение свободы до 2 лет',
            severity: 8,
            confidence: 0.88
          }
        ]
      });

      const result = await repository.getGeneralStats('-1001234567890');

      expect(result.chatId).toBe('-1001234567890');
      expect(result.totalViolations).toBe(25);
      expect(result.averageSeverity).toBe(6.8);
      expect(result.overallRiskLevel).toBe('high');
      expect(result.topViolations).toHaveLength(4);
      expect(result.topUsers).toHaveLength(3);
      expect(result.criticalViolations).toHaveLength(2);
      
      // Проверяем топ нарушения
      expect(result.topViolations[0].article).toBe('Статья 282');
      expect(result.topViolations[0].count).toBe(10);
      
      // Проверяем топ пользователей
      expect(result.topUsers[0].userId).toBe('12345');
      expect(result.topUsers[0].count).toBe(8);
      expect(result.topUsers[0].riskLevel).toBe('high');
      
      // Проверяем критические нарушения
      expect(result.criticalViolations[0].severity).toBe(9);
      expect(result.criticalViolations[1].severity).toBe(8);
    });

    it('должен обработать случай отсутствия данных', async () => {
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 0,
        average_severity: 0
      });

      mockStmt.all.mockResolvedValue({ results: [] });

      const result = await repository.getGeneralStats('-1001234567890');

      expect(result.totalViolations).toBe(0);
      expect(result.averageSeverity).toBe(0);
      expect(result.overallRiskLevel).toBe('low');
      expect(result.topViolations).toHaveLength(0);
      expect(result.topUsers).toHaveLength(0);
      expect(result.criticalViolations).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('должен обработать ошибки базы данных при сохранении', async () => {
      mockStmt.run.mockRejectedValue(new Error('Database error'));

      const violation: Violation = {
        article: 'Статья 282',
        quote: 'test',
        punishment: 'test',
        severity: 5,
        confidence: 0.8
      };

      await expect(repository.save(violation, '123', '456'))
        .rejects.toThrow('Failed to save violation: Database error');
    });

    it('должен обработать ошибки базы данных при получении данных', async () => {
      mockStmt.all.mockRejectedValue(new Error('Database error'));

      await expect(repository.getUserViolations('123', '456'))
        .rejects.toThrow('Failed to get user violations: Database error');
    });
  });
});