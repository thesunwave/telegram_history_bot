/**
 * Тесты для проверки новых полей articleTitle и punishment в ViolationRepository
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ViolationRepository } from '../../src/repositories/violation-repository';
import type { Violation } from '../../src/models/statistics';

// Мок для D1 Database
const mockDB = {
  prepare: vi.fn(),
  exec: vi.fn(),
  dump: vi.fn(),
  batch: vi.fn()
};

const mockStmt = {
          all: vi.fn().mockResolvedValue({ results: [] }),
          first: vi.fn().mockResolvedValue(undefined),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
          bind: vi.fn().mockReturnThis()
        };

const mockEnv = {
  DB: mockDB
};

describe('ViolationRepository Fields Test', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let repository: ViolationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // Важно: настраиваем prepare ПОСЛЕ clearAllMocks
    mockDB.prepare.mockReturnValue(mockStmt);
    // Сбрасываем моки для statement
    mockStmt.first = vi.fn().mockResolvedValue(undefined);
    mockStmt.all = vi.fn().mockResolvedValue({ results: [] });
    mockStmt.run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    mockStmt.bind = vi.fn().mockReturnThis();
    repository = new ViolationRepository(mockEnv as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('save method', () => {

    it('should save violation with articleTitle field', async () => {
      const violation: Violation = {
        article: '282',
        subarticle: null,
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Тестовая цитата',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        severity: 7,
        confidence: 0.85
      };

      mockStmt.run = vi.fn().mockResolvedValue({ success: true });

      await repository.save(violation, '12345', '67890');

      // Проверяем, что SQL запрос включает article_title
      expect(mockDB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('article_title')
      );

      // Проверяем, что bind вызван с правильными параметрами
      expect(mockStmt.bind).toHaveBeenCalledWith(
        12345,
        67890,
        '282',
        null,
        'Возбуждение ненависти либо вражды',
        'Тестовая цитата',
        'штраф в размере до трехсот тысяч рублей',
        7,
        0.85
      );
    });

    it('should reject violation with empty articleTitle', async () => {
      const violation: Violation = {
        article: '282',
        subarticle: null,
        articleTitle: '',
        quote: 'Тестовая цитата',
        punishment: 'штраф',
        severity: 7,
        confidence: 0.85
      };

      await expect(repository.save(violation, '12345', '67890'))
        .rejects.toThrow('Article title must be a non-empty string');
    });

    it('should reject violation with undefined articleTitle', async () => {
      const violation: Violation = {
        article: '282',
        subarticle: null,
        articleTitle: undefined as any,
        quote: 'Тестовая цитата',
        punishment: 'штраф',
        severity: 7,
        confidence: 0.85
      };

      await expect(repository.save(violation, '12345', '67890'))
        .rejects.toThrow('Article title must be a non-empty string');
    });
  });

  describe('getUserStats method', () => {

    it('should return ViolationCount with articleTitle and punishment', async () => {
      // Мок для основной статистики пользователя
      mockStmt.first.mockResolvedValueOnce({
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
          total_violations: 2,
          average_severity: 6.5,
          last_violation_date: '2024-01-15T10:00:00Z'
        }
      });

      // Мок для нарушений по статьям
      mockStmt.all.mockResolvedValueOnce({
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
        results: [
          {
            article: '282',
            article_title: 'Возбуждение ненависти либо вражды',
            punishment: 'штраф в размере до трехсот тысяч рублей',
            count: 2,
            average_severity: 6.5
          }
        ]
      });

      const result = await repository.getUserStats('12345', '67890');

      expect(result.violationsByArticle).toHaveLength(1);
      expect(result.violationsByArticle[0]).toEqual({
        article: '282',
        subarticle: undefined,
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 2,
        averageSeverity: 6.5
      });

      // Проверяем, что SQL запрос включает article_title и punishment
      expect(mockDB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('article_title')
      );
      expect(mockDB.prepare).toHaveBeenCalledWith(
        expect.stringContaining('punishment')
      );
    });

    it('should handle missing articleTitle and punishment gracefully', async () => {
      mockStmt.first.mockResolvedValueOnce({
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
          total_violations: 1,
          average_severity: 5.0
        }
      });

      mockStmt.all.mockResolvedValueOnce({
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
        results: [
          {
            article: '282',
            article_title: null,
            punishment: null,
            count: 1,
            average_severity: 5.0
          }
        ]
      });

      const result = await repository.getUserStats('12345', '67890');

      expect(result.violationsByArticle[0]).toEqual({
        article: '282',
        subarticle: undefined,
        articleTitle: '',
        punishment: '',
        count: 1,
        averageSeverity: 5.0
      });
    });
  });

  describe('getPeriodStats method', () => {

    it('should return ViolationCount with articleTitle and punishment for period', async () => {
      // Мок для текущего периода и предыдущего периода
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
            total_violations: 3,
            average_severity: 7.0,
            unique_users: 2
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
            total_violations: 1,
            average_severity: 4.0,
            unique_users: 1
          }
        });

      // Мок для нарушений по статьям за период
      mockStmt.all.mockResolvedValueOnce({
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
            article: '205',
            article_title: 'Терроризм',
            punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
            count: 2,
            average_severity: 8.5
          },
          {
            article: '282',
            article_title: 'Возбуждение ненависти либо вражды',
            punishment: 'штраф в размере до трехсот тысяч рублей',
            count: 1,
            average_severity: 5.0
          }
        ]
      });

      const result = await repository.getPeriodStats('67890', 7);

      expect(result.violationsByArticle).toHaveLength(2);
      expect(result.violationsByArticle[0]).toEqual({
        article: '205',
        subarticle: undefined,
        articleTitle: 'Терроризм',
        punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
        count: 2,
        averageSeverity: 8.5
      });
      expect(result.violationsByArticle[1]).toEqual({
        article: '282',
        subarticle: undefined,
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 1,
        averageSeverity: 5.0
      });
    });
  });

  describe('getGeneralStats method', () => {

    it('should return topViolations with articleTitle and punishment', async () => {
      // Мок для общей статистики (first)
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
          total_violations: 10,
          average_severity: 6.8
        }
      });

      // Мок для топ нарушений, топ пользователей и критических нарушений (all)
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
            rows_read: 2,
            rows_written: 0
          },
          results: [
            {
              article: '282',
              article_title: 'Возбуждение ненависти либо вражды',
              punishment: 'штраф в размере до трехсот тысяч рублей',
              count: 5,
              average_severity: 6.0
            },
            {
              article: '130',
              article_title: 'Оскорбление',
              punishment: 'штраф в размере до сорока тысяч рублей',
              count: 3,
              average_severity: 4.0
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
            rows_read: 0,
            rows_written: 0
          },
          results: []
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
            rows_read: 0,
            rows_written: 0
          },
          results: []
        })

      const result = await repository.getGeneralStats('67890');

      expect(result.topViolations).toHaveLength(2);
      expect(result.topViolations[0]).toEqual({
        article: '282',
        subarticle: undefined,
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 5,
        averageSeverity: 6.0
      });
      expect(result.topViolations[1]).toEqual({
        article: '130',
        subarticle: undefined,
        articleTitle: 'Оскорбление',
        punishment: 'штраф в размере до сорока тысяч рублей',
        count: 3,
        averageSeverity: 4.0
      });
    });

    it('should return criticalViolations with articleTitle', async () => {
      // Мок для общей статистики
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
          average_severity: 8.5
        }
      });

      // Мок для топ нарушений, топ пользователей и критических нарушений
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
            rows_read: 0,
            rows_written: 0
          },
          results: []
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
            rows_read: 0,
            rows_written: 0
          },
          results: []
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
          results: [
            {
              article: '205',
              article_title: 'Терроризм',
              quote: 'Критическое нарушение',
              punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
              severity: 9,
              confidence: 0.95
            }
          ]
        });

      const result = await repository.getGeneralStats('67890');

      expect(result.criticalViolations).toHaveLength(1);
      expect(result.criticalViolations[0]).toEqual({
        article: '205',
        subarticle: undefined,
        articleTitle: 'Терроризм',
        quote: 'Критическое нарушение',
        punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
        severity: 9,
        confidence: 0.95
      });
    });
  });
});