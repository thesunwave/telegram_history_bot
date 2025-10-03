/**
 * Integration тесты для ViolationRepository
 * Тестируют работу с базой данных D1
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
  all: vi.fn().mockResolvedValue({ success: true, results: [] }),
  first: vi.fn().mockResolvedValue(undefined),
  run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
  bind: vi.fn()
};

// Настраиваем bind чтобы он возвращал сам объект
mockStmt.bind.mockReturnValue(mockStmt);

const mockEnv: Env = {
  DB: mockDB as any,
  // Добавляем другие необходимые поля из Env
} as Env;

describe('ViolationRepository Integration Tests', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let repository: ViolationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Настраиваем базовые моки
    mockStmt.bind.mockReturnValue(mockStmt);
    mockStmt.all.mockResolvedValue({ results: [] });
    mockStmt.first.mockResolvedValue({ result: null });
    mockStmt.run.mockResolvedValue({ success: true, meta: { changes: 1 } });
    
    // Важно: настраиваем prepare ПОСЛЕ clearAllMocks
    mockDB.prepare.mockReturnValue(mockStmt);
    repository = new ViolationRepository(mockEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('save()', () => {

    it('должен сохранить нарушение в базу данных', async () => {
      const violation: Violation = {
        article: 'Статья 282',
        subarticle: null,
        articleTitle: 'Экстремизм',
        quote: 'экстремистские высказывания',
        punishment: 'штраф до 500 тысяч рублей',
        severity: 7,
        confidence: 0.85
      };

      mockStmt.run = vi.fn().mockResolvedValue({ success: true });

      await repository.save(violation, '12345', '-1001234567890');

      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO criminal_violations'));
      expect(mockStmt.bind).toHaveBeenCalledWith(
        12345,
        -1001234567890,
        'Статья 282',
        null,
        'Экстремизм',
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
        subarticle: null,
        articleTitle: 'Test Title',
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
          subarticle: null,
          articleTitle: '',
          quote: 'экстремистские высказывания',
          punishment: 'штраф до 500 тысяч рублей',
          severity: 7,
          confidence: 0.85
        },
        {
          article: 'Статья 130',
          subarticle: null,
          articleTitle: '',
          quote: 'оскорбление личности',
          punishment: 'штраф до 40 тысяч рублей',
          severity: 4,
          confidence: 0.92
        }
      ];

      mockStmt.all = vi.fn().mockResolvedValue({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 2,
          rows_written: 0
        },
        results: mockResults
      });

      const result = await repository.getUserViolations('12345', '-1001234567890');

      expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT article, subarticle, article_title, quote, punishment, severity, confidence'));
      expect(mockStmt.bind).toHaveBeenCalledWith(12345, -1001234567890);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(mockResults[0]);
    });

    it('должен вернуть пустой массив если нарушений нет', async () => {
      mockStmt.all = vi.fn().mockResolvedValue({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 0,
          rows_written: 0
        },
        results: []
      });

      const result = await repository.getUserViolations('12345', '-1001234567890');

      expect(result).toEqual([]);
    });
  });

  describe('getPeriodViolations()', () => {

    it('должен получить нарушения за указанный период', async () => {
      const mockResults = [
        {
          article: 'Статья 282',
          subarticle: null,
          articleTitle: '',
          quote: 'экстремистские высказывания',
          punishment: 'штраф до 500 тысяч рублей',
          severity: 7,
          confidence: 0.85
        }
      ];

      mockStmt.all = vi.fn().mockResolvedValue({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 1,
          rows_written: 0
        },
        results: mockResults
      });

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
          subarticle: null,
          articleTitle: '',
          quote: 'экстремистские высказывания',
          punishment: 'штраф до 500 тысяч рублей',
          severity: 7,
          confidence: 0.85
        }
      ];

      mockStmt.all = vi.fn().mockResolvedValue({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 1,
          rows_written: 0
        },
        results: mockResults
      });

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
      mockStmt.first = vi.fn().mockResolvedValueOnce({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 1,
          rows_written: 0
        },
        result: {
          total_violations: 5,
          average_severity: 6.2,
          last_violation_date: '2024-01-15 10:30:00'
        }
      });

      // Mock для нарушений по статьям
      mockStmt.all = vi.fn().mockResolvedValueOnce({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 2,
          rows_written: 0
        },
        results: [
          { 
            article: 'Статья 282', 
            subarticle: null,
            article_title: 'Экстремизм',
            punishment: 'штраф',
            count: 3, 
            average_severity: 7.0 
          },
          { 
            article: 'Статья 130', 
            subarticle: null,
            article_title: 'Оскорбление',
            punishment: 'штраф',
            count: 2, 
            average_severity: 5.0 
          }
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
      mockStmt.first = vi.fn().mockResolvedValueOnce({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 0,
          rows_written: 0
        },
        result: {
          total_violations: 0,
          average_severity: 0,
          last_violation_date: null
        }
      });

      mockStmt.all = vi.fn().mockResolvedValueOnce({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 0,
          rows_written: 0
        },
        results: []
      });

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
      // Mock для текущего периода и предыдущего периода
      mockStmt.first = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          meta: {
            served_by: 'test',
            duration: 1,
            changes: 0,
            last_row_id: 0,
            changed_db: false,
            size_after: 0,
            rows_read: 1,
            rows_written: 0
          },
          result: {
            total_violations: 10,
            average_severity: 5.5,
            unique_users: 3
          }
        })
        .mockResolvedValueOnce({
          success: true,
          meta: {
            served_by: 'test',
            duration: 1,
            changes: 0,
            last_row_id: 0,
            changed_db: false,
            size_after: 0,
            rows_read: 1,
            rows_written: 0
          },
          result: {
            total_violations: 8,
            average_severity: 6.0,
            unique_users: 2
          }
        });

      // Mock для нарушений по статьям
      mockStmt.all = vi.fn().mockResolvedValueOnce({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 2,
          rows_written: 0
        },
        results: [
          { 
            article: 'Статья 282', 
            subarticle: null,
            article_title: 'Экстремизм',
            punishment: 'штраф',
            count: 6, 
            average_severity: 7.0 
          },
          { 
            article: 'Статья 130', 
            subarticle: null,
            article_title: 'Оскорбление',
            punishment: 'штраф',
            count: 4, 
            average_severity: 4.0 
          }
        ]
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
      mockStmt.first = vi.fn().mockResolvedValueOnce({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 1,
          rows_written: 0
        },
        result: {
          total_violations: 25,
          average_severity: 6.8
        }
      });

      // Mock для топ нарушений, топ пользователей и критических нарушений
      mockStmt.all = vi.fn()
        .mockResolvedValueOnce({
          success: true,
          meta: {
            served_by: 'test',
            duration: 1,
            changes: 0,
            last_row_id: 0,
            changed_db: false,
            size_after: 0,
            rows_read: 4,
            rows_written: 0
          },
          results: [
            { 
              article: 'Статья 282', 
              subarticle: null,
              article_title: 'Экстремизм',
              punishment: 'штраф',
              count: 10, 
              average_severity: 7.5 
            },
            { 
              article: 'Статья 130', 
              subarticle: null,
              article_title: 'Оскорбление',
              punishment: 'штраф',
              count: 8, 
              average_severity: 4.2 
            },
            { 
              article: 'Статья 319', 
              subarticle: null,
              article_title: 'Оскорбление представителя власти',
              punishment: 'штраф',
              count: 5, 
              average_severity: 6.0 
            },
            { 
              article: 'Статья 213', 
              subarticle: null,
              article_title: 'Хулиганство',
              punishment: 'штраф',
              count: 2, 
              average_severity: 8.0 
            }
          ]
        })
        .mockResolvedValueOnce({
          success: true,
          meta: {
            served_by: 'test',
            duration: 1,
            changes: 0,
            last_row_id: 0,
            changed_db: false,
            size_after: 0,
            rows_read: 3,
            rows_written: 0
          },
          results: [
            { user_id: 12345, count: 8, average_severity: 7.0 },
            { user_id: 12346, count: 6, average_severity: 5.5 },
            { user_id: 12347, count: 4, average_severity: 6.8 }
          ]
        })
        .mockResolvedValueOnce({
          success: true,
          meta: {
            served_by: 'test',
            duration: 1,
            changes: 0,
            last_row_id: 0,
            changed_db: false,
            size_after: 0,
            rows_read: 2,
            rows_written: 0
          },
          results: [
            {
              article: 'Статья 282',
              subarticle: null,
              article_title: 'Экстремизм',
              quote: 'экстремистские высказывания',
              punishment: 'штраф до 500 тысяч рублей',
              severity: 9,
              confidence: 0.95
            },
            {
              article: 'Статья 213',
              subarticle: null,
              article_title: 'Хулиганство',
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
      mockStmt.first = vi.fn().mockResolvedValueOnce({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 0,
          rows_written: 0
        },
        result: {
          total_violations: 0,
          average_severity: 0
        }
      });

      mockStmt.all = vi.fn().mockResolvedValue({
        success: true,
        meta: {
          served_by: 'test',
          duration: 1,
          changes: 0,
          last_row_id: 0,
          changed_db: false,
          size_after: 0,
          rows_read: 0,
          rows_written: 0
        },
        results: []
      });

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
      // Переопределяем мок для этого теста
      const errorStmt = {
        ...mockStmt,
        run: vi.fn().mockRejectedValue(new Error('Database error')),
        bind: vi.fn().mockReturnThis()
      };
      mockDB.prepare.mockReturnValue(errorStmt);

      const violation: Violation = {
        article: 'Статья 282',
        subarticle: null,
        articleTitle: 'Test Article',
        quote: 'test',
        punishment: 'test',
        severity: 5,
        confidence: 0.8
      };

      await expect(repository.save(violation, '123', '456'))
        .rejects.toThrow('Failed to save violation: Database error');
    });

    it('должен обработать ошибки базы данных при получении данных', async () => {
      // Переопределяем мок для этого теста
      const errorStmt = {
        ...mockStmt,
        all: vi.fn().mockRejectedValue(new Error('Database error')),
        bind: vi.fn().mockReturnThis()
      };
      mockDB.prepare.mockReturnValue(errorStmt);

      await expect(repository.getUserViolations('123', '456'))
        .rejects.toThrow('Failed to get user violations: Database error');
    });
  });
});