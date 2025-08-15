/**
 * Тесты для моделей данных статистики
 */

import { describe, it, expect } from 'vitest';
import {
  Violation,
  ViolationAnalysis,
  UserStats,
  PeriodStats,
  GeneralStats,
  ViolationCount,
  UserViolationCount,
  PeriodComparison
} from '../../src/models/statistics';

describe('Statistics Models', () => {
  describe('Violation', () => {
    it('should have correct structure', () => {
      const violation: Violation = {
        article: 'Статья 282 УК РФ',
        quote: 'Пример цитаты из сообщения',
        punishment: 'Штраф до 300 000 рублей',
        severity: 7,
        confidence: 0.85
      };

      expect(violation.article).toBe('Статья 282 УК РФ');
      expect(violation.quote).toBe('Пример цитаты из сообщения');
      expect(violation.punishment).toBe('Штраф до 300 000 рублей');
      expect(violation.severity).toBe(7);
      expect(violation.confidence).toBe(0.85);
    });
  });

  describe('ViolationAnalysis', () => {
    it('should have correct structure with violations', () => {
      const analysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [
          {
            article: 'Статья 282 УК РФ',
            quote: 'Пример цитаты',
            punishment: 'Штраф',
            severity: 7,
            confidence: 0.85
          }
        ],
        totalSeverity: 7,
        riskLevel: 'high',
        analysisTimestamp: '2024-01-01T12:00:00Z'
      };

      expect(analysis.hasViolations).toBe(true);
      expect(analysis.violations).toHaveLength(1);
      expect(analysis.totalSeverity).toBe(7);
      expect(analysis.riskLevel).toBe('high');
      expect(analysis.analysisTimestamp).toBe('2024-01-01T12:00:00Z');
    });

    it('should have correct structure without violations', () => {
      const analysis: ViolationAnalysis = {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: '2024-01-01T12:00:00Z'
      };

      expect(analysis.hasViolations).toBe(false);
      expect(analysis.violations).toHaveLength(0);
      expect(analysis.totalSeverity).toBe(0);
      expect(analysis.riskLevel).toBe('low');
    });
  });

  describe('ViolationCount', () => {
    it('should have correct structure', () => {
      const violationCount: ViolationCount = {
        article: 'Статья 282 УК РФ',
        subarticle: '1',
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 5,
        averageSeverity: 6.5
      };

      expect(violationCount.article).toBe('Статья 282 УК РФ');
      expect(violationCount.subarticle).toBe('1');
      expect(violationCount.articleTitle).toBe('Возбуждение ненависти либо вражды');
      expect(violationCount.punishment).toBe('штраф в размере до трехсот тысяч рублей');
      expect(violationCount.count).toBe(5);
      expect(violationCount.averageSeverity).toBe(6.5);
    });
  });

  describe('UserViolationCount', () => {
    it('should have correct structure with username', () => {
      const userViolationCount: UserViolationCount = {
        userId: '12345',
        username: 'testuser',
        count: 3,
        averageSeverity: 5.5,
        riskLevel: 'medium'
      };

      expect(userViolationCount.userId).toBe('12345');
      expect(userViolationCount.username).toBe('testuser');
      expect(userViolationCount.count).toBe(3);
      expect(userViolationCount.averageSeverity).toBe(5.5);
      expect(userViolationCount.riskLevel).toBe('medium');
    });

    it('should have correct structure without username', () => {
      const userViolationCount: UserViolationCount = {
        userId: '12345',
        count: 3,
        averageSeverity: 5.5,
        riskLevel: 'medium'
      };

      expect(userViolationCount.userId).toBe('12345');
      expect(userViolationCount.username).toBeUndefined();
      expect(userViolationCount.count).toBe(3);
    });
  });

  describe('UserStats', () => {
    it('should have correct structure with all fields', () => {
      const userStats: UserStats = {
        userId: '12345',
        chatId: '-67890',
        totalViolations: 10,
        violationsByArticle: [
          {
            article: 'Статья 282 УК РФ',
            count: 5,
            averageSeverity: 6.5
          },
          {
            article: 'Статья 280 УК РФ',
            count: 5,
            averageSeverity: 7.0
          }
        ],
        averageSeverity: 6.75,
        riskLevel: 'high',
        lastViolationDate: new Date('2024-01-01'),
        mostCommonViolation: 'Статья 282 УК РФ'
      };

      expect(userStats.userId).toBe('12345');
      expect(userStats.chatId).toBe('-67890');
      expect(userStats.totalViolations).toBe(10);
      expect(userStats.violationsByArticle).toHaveLength(2);
      expect(userStats.averageSeverity).toBe(6.75);
      expect(userStats.riskLevel).toBe('high');
      expect(userStats.lastViolationDate).toEqual(new Date('2024-01-01'));
      expect(userStats.mostCommonViolation).toBe('Статья 282 УК РФ');
    });

    it('should have correct structure with minimal fields', () => {
      const userStats: UserStats = {
        userId: '12345',
        chatId: '-67890',
        totalViolations: 0,
        violationsByArticle: [],
        averageSeverity: 1,
        riskLevel: 'low'
      };

      expect(userStats.totalViolations).toBe(0);
      expect(userStats.violationsByArticle).toHaveLength(0);
      expect(userStats.lastViolationDate).toBeUndefined();
      expect(userStats.mostCommonViolation).toBeUndefined();
    });
  });

  describe('PeriodComparison', () => {
    it('should have correct structure', () => {
      const comparison: PeriodComparison = {
        violationsChange: 25.5,
        severityChange: -0.3,
        usersChange: 10.0
      };

      expect(comparison.violationsChange).toBe(25.5);
      expect(comparison.severityChange).toBe(-0.3);
      expect(comparison.usersChange).toBe(10.0);
    });
  });

  describe('PeriodStats', () => {
    it('should have correct structure with comparison', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');
      
      const periodStats: PeriodStats = {
        chatId: '-67890',
        startDate,
        endDate,
        totalViolations: 50,
        violationsByArticle: [
          {
            article: 'Статья 282 УК РФ',
            count: 30,
            averageSeverity: 6.5
          },
          {
            article: 'Статья 280 УК РФ',
            count: 20,
            averageSeverity: 7.0
          }
        ],
        averageSeverity: 6.7,
        uniqueUsers: 15,
        comparisonWithPreviousPeriod: {
          violationsChange: 25.5,
          severityChange: -0.3,
          usersChange: 10.0
        }
      };

      expect(periodStats.chatId).toBe('-67890');
      expect(periodStats.startDate).toEqual(startDate);
      expect(periodStats.endDate).toEqual(endDate);
      expect(periodStats.totalViolations).toBe(50);
      expect(periodStats.violationsByArticle).toHaveLength(2);
      expect(periodStats.averageSeverity).toBe(6.7);
      expect(periodStats.uniqueUsers).toBe(15);
      expect(periodStats.comparisonWithPreviousPeriod).toBeDefined();
    });

    it('should have correct structure without comparison', () => {
      const periodStats: PeriodStats = {
        chatId: '-67890',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        totalViolations: 50,
        violationsByArticle: [],
        averageSeverity: 6.7,
        uniqueUsers: 15
      };

      expect(periodStats.comparisonWithPreviousPeriod).toBeUndefined();
    });
  });

  describe('GeneralStats', () => {
    it('should have correct structure', () => {
      const generalStats: GeneralStats = {
        chatId: '-67890',
        totalViolations: 100,
        topViolations: [
          {
            article: 'Статья 282 УК РФ',
            count: 40,
            averageSeverity: 6.5
          },
          {
            article: 'Статья 280 УК РФ',
            count: 30,
            averageSeverity: 7.0
          }
        ],
        topUsers: [
          {
            userId: '12345',
            username: 'user1',
            count: 15,
            averageSeverity: 7.5,
            riskLevel: 'high'
          },
          {
            userId: '67890',
            count: 12,
            averageSeverity: 6.0,
            riskLevel: 'medium'
          }
        ],
        overallRiskLevel: 'high',
        averageSeverity: 6.8,
        criticalViolations: [
          {
            article: 'Статья 205 УК РФ',
            quote: 'Критическое нарушение',
            punishment: 'Лишение свободы',
            severity: 9,
            confidence: 0.95
          }
        ]
      };

      expect(generalStats.chatId).toBe('-67890');
      expect(generalStats.totalViolations).toBe(100);
      expect(generalStats.topViolations).toHaveLength(2);
      expect(generalStats.topUsers).toHaveLength(2);
      expect(generalStats.overallRiskLevel).toBe('high');
      expect(generalStats.averageSeverity).toBe(6.8);
      expect(generalStats.criticalViolations).toHaveLength(1);
    });

    it('should handle empty arrays', () => {
      const generalStats: GeneralStats = {
        chatId: '-67890',
        totalViolations: 0,
        topViolations: [],
        topUsers: [],
        overallRiskLevel: 'low',
        averageSeverity: 1,
        criticalViolations: []
      };

      expect(generalStats.totalViolations).toBe(0);
      expect(generalStats.topViolations).toHaveLength(0);
      expect(generalStats.topUsers).toHaveLength(0);
      expect(generalStats.criticalViolations).toHaveLength(0);
    });
  });
});