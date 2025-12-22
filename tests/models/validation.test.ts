/**
 * Тесты для функций валидации моделей данных
 */

import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  validateViolation,
  validateViolationAnalysis,
  validateViolationCount,
  validateUserViolationCount,
  validateUserStats,
  validatePeriodComparison,
  validatePeriodStats,
  validateGeneralStats,
  ValidationUtils
} from '../../src/core/models/validation';

describe('Validation Functions', () => {
  describe('validateViolation', () => {
    it('should validate correct violation', () => {
      const violation = {
        article: '282',
        subarticle: '1',
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Пример цитаты',
        punishment: 'Штраф до 300 000 рублей',
        severity: 7,
        confidence: 0.85
      };

      expect(() => validateViolation(violation)).not.toThrow();
      expect(validateViolation(violation)).toBe(true);
    });

    it('should validate violation with null subarticle', () => {
      const violation = {
        article: '282',
        subarticle: null,
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Пример цитаты',
        punishment: 'Штраф до 300 000 рублей',
        severity: 7,
        confidence: 0.85
      };

      expect(() => validateViolation(violation)).not.toThrow();
      expect(validateViolation(violation)).toBe(true);
    });

    it('should throw error for null violation', () => {
      expect(() => validateViolation(null)).toThrow(ValidationError);
      expect(() => validateViolation(null)).toThrow('Violation must be an object');
    });

    it('should throw error for missing article', () => {
      const violation = {
        subarticle: '1',
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Пример цитаты',
        punishment: 'Штраф',
        severity: 7,
        confidence: 0.85
      };

      expect(() => validateViolation(violation)).toThrow(ValidationError);
      expect(() => validateViolation(violation)).toThrow('Article must be a non-empty string');
    });

    it('should throw error for missing articleTitle', () => {
      const violation = {
        article: '282',
        subarticle: '1',
        quote: 'Пример цитаты',
        punishment: 'Штраф',
        severity: 7,
        confidence: 0.85
      };

      expect(() => validateViolation(violation)).toThrow(ValidationError);
      expect(() => validateViolation(violation)).toThrow('Article title must be a non-empty string');
    });

    it('should throw error for invalid subarticle type', () => {
      const violation = {
        article: '282',
        subarticle: 123, // должно быть строкой или null
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Пример цитаты',
        punishment: 'Штраф',
        severity: 7,
        confidence: 0.85
      };

      expect(() => validateViolation(violation)).toThrow(ValidationError);
      expect(() => validateViolation(violation)).toThrow('Subarticle must be a string or null');
    });

    it('should throw error for invalid severity', () => {
      const violation = {
        article: '282',
        subarticle: '1',
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Пример цитаты',
        punishment: 'Штраф',
        severity: 11, // Неверное значение
        confidence: 0.85
      };

      expect(() => validateViolation(violation)).toThrow(ValidationError);
      expect(() => validateViolation(violation)).toThrow('Severity must be a number between 1 and 10');
    });

    it('should throw error for invalid confidence', () => {
      const violation = {
        article: '282',
        subarticle: '1',
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Пример цитаты',
        punishment: 'Штраф',
        severity: 7,
        confidence: 1.5 // Неверное значение
      };

      expect(() => validateViolation(violation)).toThrow(ValidationError);
      expect(() => validateViolation(violation)).toThrow('Confidence must be a number between 0 and 1');
    });
  });

  describe('validateViolationAnalysis', () => {
    it('should validate correct analysis', () => {
      const analysis = {
        hasViolations: true,
        violations: [
          {
            article: '282',
            subarticle: '1',
            articleTitle: 'Возбуждение ненависти либо вражды',
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

      expect(() => validateViolationAnalysis(analysis)).not.toThrow();
      expect(validateViolationAnalysis(analysis)).toBe(true);
    });

    it('should throw error for invalid hasViolations', () => {
      const analysis = {
        hasViolations: 'true', // Неверный тип
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: '2024-01-01T12:00:00Z'
      };

      expect(() => validateViolationAnalysis(analysis)).toThrow(ValidationError);
      expect(() => validateViolationAnalysis(analysis)).toThrow('hasViolations must be a boolean');
    });

    it('should throw error for invalid riskLevel', () => {
      const analysis = {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'invalid', // Неверное значение
        analysisTimestamp: '2024-01-01T12:00:00Z'
      };

      expect(() => validateViolationAnalysis(analysis)).toThrow(ValidationError);
      expect(() => validateViolationAnalysis(analysis)).toThrow('riskLevel must be one of: low, medium, high');
    });

    it('should throw error for invalid violation in array', () => {
      const analysis = {
        hasViolations: true,
        violations: [
          {
            article: 'Статья 282 УК РФ',
            quote: 'Пример цитаты',
            punishment: 'Штраф',
            severity: 11, // Неверное значение
            confidence: 0.85
          }
        ],
        totalSeverity: 7,
        riskLevel: 'high',
        analysisTimestamp: '2024-01-01T12:00:00Z'
      };

      expect(() => validateViolationAnalysis(analysis)).toThrow(ValidationError);
      expect(() => validateViolationAnalysis(analysis)).toThrow('Invalid violation at index 0');
    });
  });

  describe('validateViolationCount', () => {
    it('should validate correct violation count', () => {
      const violationCount = {
        article: 'Статья 282 УК РФ',
        subarticle: '1',
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 5,
        averageSeverity: 6.5
      };

      expect(() => validateViolationCount(violationCount)).not.toThrow();
      expect(validateViolationCount(violationCount)).toBe(true);
    });

    it('should validate violation count without optional fields', () => {
      const violationCount = {
        article: 'Статья 282 УК РФ',
        count: 5,
        averageSeverity: 6.5
      };

      expect(() => validateViolationCount(violationCount)).not.toThrow();
      expect(validateViolationCount(violationCount)).toBe(true);
    });

    it('should validate violation count with null subarticle', () => {
      const violationCount = {
        article: 'Статья 282 УК РФ',
        subarticle: null,
        articleTitle: 'Возбуждение ненависти либо вражды',
        punishment: 'штраф в размере до трехсот тысяч рублей',
        count: 5,
        averageSeverity: 6.5
      };

      expect(() => validateViolationCount(violationCount)).not.toThrow();
      expect(validateViolationCount(violationCount)).toBe(true);
    });

    it('should throw error for negative count', () => {
      const violationCount = {
        article: 'Статья 282 УК РФ',
        count: -1, // Неверное значение
        averageSeverity: 6.5
      };

      expect(() => validateViolationCount(violationCount)).toThrow(ValidationError);
      expect(() => validateViolationCount(violationCount)).toThrow('Count must be a non-negative number');
    });

    it('should throw error for invalid averageSeverity', () => {
      const violationCount = {
        article: 'Статья 282 УК РФ',
        count: 5,
        averageSeverity: 0 // Неверное значение
      };

      expect(() => validateViolationCount(violationCount)).toThrow(ValidationError);
      expect(() => validateViolationCount(violationCount)).toThrow('averageSeverity must be a number between 1 and 10');
    });
  });

  describe('validateUserViolationCount', () => {
    it('should validate correct user violation count with username', () => {
      const userViolationCount = {
        userId: '12345',
        username: 'testuser',
        count: 3,
        averageSeverity: 5.5,
        riskLevel: 'medium'
      };

      expect(() => validateUserViolationCount(userViolationCount)).not.toThrow();
      expect(validateUserViolationCount(userViolationCount)).toBe(true);
    });

    it('should validate correct user violation count without username', () => {
      const userViolationCount = {
        userId: '12345',
        count: 3,
        averageSeverity: 5.5,
        riskLevel: 'medium'
      };

      expect(() => validateUserViolationCount(userViolationCount)).not.toThrow();
      expect(validateUserViolationCount(userViolationCount)).toBe(true);
    });

    it('should throw error for missing userId', () => {
      const userViolationCount = {
        count: 3,
        averageSeverity: 5.5,
        riskLevel: 'medium'
      };

      expect(() => validateUserViolationCount(userViolationCount)).toThrow(ValidationError);
      expect(() => validateUserViolationCount(userViolationCount)).toThrow('userId must be a non-empty string');
    });

    it('should throw error for invalid riskLevel', () => {
      const userViolationCount = {
        userId: '12345',
        count: 3,
        averageSeverity: 5.5,
        riskLevel: 'invalid' // Неверное значение
      };

      expect(() => validateUserViolationCount(userViolationCount)).toThrow(ValidationError);
      expect(() => validateUserViolationCount(userViolationCount)).toThrow('riskLevel must be one of: low, medium, high');
    });
  });

  describe('validateUserStats', () => {
    it('should validate correct user stats', () => {
      const userStats = {
        userId: '12345',
        chatId: '-67890',
        totalViolations: 10,
        violationsByArticle: [
          {
            article: 'Статья 282 УК РФ',
            count: 5,
            averageSeverity: 6.5
          }
        ],
        averageSeverity: 6.75,
        riskLevel: 'high',
        lastViolationDate: new Date('2024-01-01'),
        mostCommonViolation: 'Статья 282 УК РФ'
      };

      expect(() => validateUserStats(userStats)).not.toThrow();
      expect(validateUserStats(userStats)).toBe(true);
    });

    it('should validate user stats with minimal fields', () => {
      const userStats = {
        userId: '12345',
        chatId: '-67890',
        totalViolations: 0,
        violationsByArticle: [],
        averageSeverity: 1,
        riskLevel: 'low'
      };

      expect(() => validateUserStats(userStats)).not.toThrow();
      expect(validateUserStats(userStats)).toBe(true);
    });

    it('should throw error for missing chatId', () => {
      const userStats = {
        userId: '12345',
        totalViolations: 10,
        violationsByArticle: [],
        averageSeverity: 6.75,
        riskLevel: 'high'
      };

      expect(() => validateUserStats(userStats)).toThrow(ValidationError);
      expect(() => validateUserStats(userStats)).toThrow('chatId must be a non-empty string');
    });

    it('should throw error for invalid lastViolationDate', () => {
      const userStats = {
        userId: '12345',
        chatId: '-67890',
        totalViolations: 10,
        violationsByArticle: [],
        averageSeverity: 6.75,
        riskLevel: 'high',
        lastViolationDate: '2024-01-01' // Неверный тип
      };

      expect(() => validateUserStats(userStats)).toThrow(ValidationError);
      expect(() => validateUserStats(userStats)).toThrow('lastViolationDate must be a Date or undefined');
    });
  });

  describe('validatePeriodComparison', () => {
    it('should validate correct period comparison', () => {
      const comparison = {
        violationsChange: 25.5,
        severityChange: -0.3,
        usersChange: 10.0
      };

      expect(() => validatePeriodComparison(comparison)).not.toThrow();
      expect(validatePeriodComparison(comparison)).toBe(true);
    });

    it('should throw error for non-number violationsChange', () => {
      const comparison = {
        violationsChange: '25.5', // Неверный тип
        severityChange: -0.3,
        usersChange: 10.0
      };

      expect(() => validatePeriodComparison(comparison)).toThrow(ValidationError);
      expect(() => validatePeriodComparison(comparison)).toThrow('violationsChange must be a number');
    });
  });

  describe('validatePeriodStats', () => {
    it('should validate correct period stats', () => {
      const periodStats = {
        chatId: '-67890',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        totalViolations: 50,
        violationsByArticle: [
          {
            article: 'Статья 282 УК РФ',
            count: 30,
            averageSeverity: 6.5
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

      expect(() => validatePeriodStats(periodStats)).not.toThrow();
      expect(validatePeriodStats(periodStats)).toBe(true);
    });

    it('should throw error for startDate after endDate', () => {
      const periodStats = {
        chatId: '-67890',
        startDate: new Date('2024-01-31'),
        endDate: new Date('2024-01-01'), // Неверный порядок дат
        totalViolations: 50,
        violationsByArticle: [],
        averageSeverity: 6.7,
        uniqueUsers: 15
      };

      expect(() => validatePeriodStats(periodStats)).toThrow(ValidationError);
      expect(() => validatePeriodStats(periodStats)).toThrow('startDate must be before endDate');
    });

    it('should throw error for invalid startDate type', () => {
      const periodStats = {
        chatId: '-67890',
        startDate: '2024-01-01', // Неверный тип
        endDate: new Date('2024-01-31'),
        totalViolations: 50,
        violationsByArticle: [],
        averageSeverity: 6.7,
        uniqueUsers: 15
      };

      expect(() => validatePeriodStats(periodStats)).toThrow(ValidationError);
      expect(() => validatePeriodStats(periodStats)).toThrow('startDate must be a Date');
    });
  });

  describe('validateGeneralStats', () => {
    it('should validate correct general stats', () => {
      const generalStats = {
        chatId: '-67890',
        totalViolations: 100,
        topViolations: [
          {
            article: 'Статья 282 УК РФ',
            count: 40,
            averageSeverity: 6.5
          }
        ],
        topUsers: [
          {
            userId: '12345',
            count: 15,
            averageSeverity: 7.5,
            riskLevel: 'high'
          }
        ],
        overallRiskLevel: 'high',
        averageSeverity: 6.8,
        criticalViolations: [
          {
            article: '205',
            subarticle: null,
            articleTitle: 'Терроризм',
            quote: 'Критическое нарушение',
            punishment: 'Лишение свободы',
            severity: 9,
            confidence: 0.95
          }
        ]
      };

      expect(() => validateGeneralStats(generalStats)).not.toThrow();
      expect(validateGeneralStats(generalStats)).toBe(true);
    });

    it('should validate general stats with empty arrays', () => {
      const generalStats = {
        chatId: '-67890',
        totalViolations: 0,
        topViolations: [],
        topUsers: [],
        overallRiskLevel: 'low',
        averageSeverity: 1,
        criticalViolations: []
      };

      expect(() => validateGeneralStats(generalStats)).not.toThrow();
      expect(validateGeneralStats(generalStats)).toBe(true);
    });

    it('should throw error for invalid topViolations array', () => {
      const generalStats = {
        chatId: '-67890',
        totalViolations: 100,
        topViolations: 'not an array', // Неверный тип
        topUsers: [],
        overallRiskLevel: 'high',
        averageSeverity: 6.8,
        criticalViolations: []
      };

      expect(() => validateGeneralStats(generalStats)).toThrow(ValidationError);
      expect(() => validateGeneralStats(generalStats)).toThrow('topViolations must be an array');
    });

    it('should throw error for invalid violation in criticalViolations', () => {
      const generalStats = {
        chatId: '-67890',
        totalViolations: 100,
        topViolations: [],
        topUsers: [],
        overallRiskLevel: 'high',
        averageSeverity: 6.8,
        criticalViolations: [
          {
            article: 'Статья 205 УК РФ',
            quote: 'Критическое нарушение',
            punishment: 'Лишение свободы',
            severity: 11, // Неверное значение
            confidence: 0.95
          }
        ]
      };

      expect(() => validateGeneralStats(generalStats)).toThrow(ValidationError);
      expect(() => validateGeneralStats(generalStats)).toThrow('Invalid criticalViolation at index 0');
    });
  });

  describe('ValidationUtils', () => {
    describe('isValidRiskLevel', () => {
      it('should return true for valid risk levels', () => {
        expect(ValidationUtils.isValidRiskLevel('low')).toBe(true);
        expect(ValidationUtils.isValidRiskLevel('medium')).toBe(true);
        expect(ValidationUtils.isValidRiskLevel('high')).toBe(true);
      });

      it('should return false for invalid risk levels', () => {
        expect(ValidationUtils.isValidRiskLevel('invalid')).toBe(false);
        expect(ValidationUtils.isValidRiskLevel('')).toBe(false);
        expect(ValidationUtils.isValidRiskLevel('LOW')).toBe(false);
      });
    });

    describe('isValidSeverity', () => {
      it('should return true for valid severity values', () => {
        expect(ValidationUtils.isValidSeverity(1)).toBe(true);
        expect(ValidationUtils.isValidSeverity(5)).toBe(true);
        expect(ValidationUtils.isValidSeverity(10)).toBe(true);
        expect(ValidationUtils.isValidSeverity(5.5)).toBe(true);
      });

      it('should return false for invalid severity values', () => {
        expect(ValidationUtils.isValidSeverity(0)).toBe(false);
        expect(ValidationUtils.isValidSeverity(11)).toBe(false);
        expect(ValidationUtils.isValidSeverity(-1)).toBe(false);
        expect(ValidationUtils.isValidSeverity('5')).toBe(false);
      });
    });

    describe('isValidConfidence', () => {
      it('should return true for valid confidence values', () => {
        expect(ValidationUtils.isValidConfidence(0)).toBe(true);
        expect(ValidationUtils.isValidConfidence(0.5)).toBe(true);
        expect(ValidationUtils.isValidConfidence(1)).toBe(true);
      });

      it('should return false for invalid confidence values', () => {
        expect(ValidationUtils.isValidConfidence(-0.1)).toBe(false);
        expect(ValidationUtils.isValidConfidence(1.1)).toBe(false);
        expect(ValidationUtils.isValidConfidence('0.5')).toBe(false);
      });
    });

    describe('calculateRiskLevel', () => {
      it('should return correct risk levels', () => {
        expect(ValidationUtils.calculateRiskLevel(1)).toBe('low');
        expect(ValidationUtils.calculateRiskLevel(3)).toBe('low');
        expect(ValidationUtils.calculateRiskLevel(4)).toBe('medium');
        expect(ValidationUtils.calculateRiskLevel(6)).toBe('medium');
        expect(ValidationUtils.calculateRiskLevel(7)).toBe('high');
        expect(ValidationUtils.calculateRiskLevel(10)).toBe('high');
      });

      it('should handle edge cases', () => {
        expect(ValidationUtils.calculateRiskLevel(3.0)).toBe('low');
        expect(ValidationUtils.calculateRiskLevel(3.1)).toBe('medium');
        expect(ValidationUtils.calculateRiskLevel(6.0)).toBe('medium');
        expect(ValidationUtils.calculateRiskLevel(6.1)).toBe('high');
      });
    });
  });
});