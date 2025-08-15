/**
 * Тесты для проверки новых полей articleTitle и punishment в ViolationRepository
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  bind: vi.fn().mockReturnThis(),
  run: vi.fn(),
  all: vi.fn(),
  first: vi.fn()
};

const mockEnv = {
  DB: mockDB
};

describe('ViolationRepository Fields Test', () => {
  let repository: ViolationRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDB.prepare.mockReturnValue(mockStmt);
    repository = new ViolationRepository(mockEnv as any);
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

      mockStmt.run.mockResolvedValue({ success: true });

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

    it('should save violation with empty articleTitle', async () => {
      const violation: Violation = {
        article: '282',
        subarticle: null,
        articleTitle: '',
        quote: 'Тестовая цитата',
        punishment: 'штраф',
        severity: 7,
        confidence: 0.85
      };

      mockStmt.run.mockResolvedValue({ success: true });

      await repository.save(violation, '12345', '67890');

      expect(mockStmt.bind).toHaveBeenCalledWith(
        12345,
        67890,
        '282',
        null,
        '',
        'Тестовая цитата',
        'штраф',
        7,
        0.85
      );
    });

    it('should save violation with undefined articleTitle', async () => {
      const violation: Violation = {
        article: '282',
        subarticle: null,
        articleTitle: undefined as any,
        quote: 'Тестовая цитата',
        punishment: 'штраф',
        severity: 7,
        confidence: 0.85
      };

      mockStmt.run.mockResolvedValue({ success: true });

      await repository.save(violation, '12345', '67890');

      expect(mockStmt.bind).toHaveBeenCalledWith(
        12345,
        67890,
        '282',
        null,
        '',
        'Тестовая цитата',
        'штраф',
        7,
        0.85
      );
    });
  });

  describe('getUserStats method', () => {
    it('should return ViolationCount with articleTitle and punishment', async () => {
      // Мок для основной статистики пользователя
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 2,
        average_severity: 6.5,
        last_violation_date: '2024-01-15T10:00:00Z'
      });

      // Мок для нарушений по статьям
      mockStmt.all.mockResolvedValueOnce({
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
        subarticle: null,
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
        total_violations: 1,
        average_severity: 5.0
      });

      mockStmt.all.mockResolvedValueOnce({
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
        subarticle: null,
        articleTitle: '',
        punishment: '',
        count: 1,
        averageSeverity: 5.0
      });
    });
  });

  describe('getPeriodStats method', () => {
    it('should return ViolationCount with articleTitle and punishment for period', async () => {
      // Мок для статистики за период
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 3,
        average_severity: 7.0,
        unique_users: 2
      });

      // Мок для нарушений по статьям за период
      mockStmt.all.mockResolvedValueOnce({
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

      // Мок для предыдущего периода
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 1,
        average_severity: 4.0,
        unique_users: 1
      });

      const result = await repository.getPeriodStats('67890', 7);

      expect(result.violationsByArticle).toHaveLength(2);
      expect(result.violationsByArticle[0]).toEqual({
        article: '205',
        subarticle: null,
        articleTitle: 'Терроризм',
        punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
        count: 2,
        averageSeverity: 8.5
      });
      expect(result.violationsByArticle[1]).toEqual({
        article: '282',
        subarticle: null,
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 1,
        averageSeverity: 5.0
      });
    });
  });

  describe('getGeneralStats method', () => {
    it('should return topViolations with articleTitle and punishment', async () => {
      // Мок для общей статистики
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 10,
        average_severity: 6.8
      });

      // Мок для топ нарушений
      mockStmt.all.mockResolvedValueOnce({
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
      });

      // Мок для топ пользователей
      mockStmt.all.mockResolvedValueOnce({
        results: []
      });

      // Мок для критических нарушений
      mockStmt.all.mockResolvedValueOnce({
        results: []
      });

      const result = await repository.getGeneralStats('67890');

      expect(result.topViolations).toHaveLength(2);
      expect(result.topViolations[0]).toEqual({
        article: '282',
        subarticle: null,
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 5,
        averageSeverity: 6.0
      });
      expect(result.topViolations[1]).toEqual({
        article: '130',
        subarticle: null,
        articleTitle: 'Оскорбление',
        punishment: 'штраф в размере до сорока тысяч рублей',
        count: 3,
        averageSeverity: 4.0
      });
    });

    it('should return criticalViolations with articleTitle', async () => {
      // Мок для общей статистики
      mockStmt.first.mockResolvedValueOnce({
        total_violations: 5,
        average_severity: 8.5
      });

      // Мок для топ нарушений
      mockStmt.all.mockResolvedValueOnce({ results: [] });

      // Мок для топ пользователей
      mockStmt.all.mockResolvedValueOnce({ results: [] });

      // Мок для критических нарушений
      mockStmt.all.mockResolvedValueOnce({
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
        subarticle: null,
        articleTitle: 'Терроризм',
        quote: 'Критическое нарушение',
        punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
        severity: 9,
        confidence: 0.95
      });
    });
  });
});