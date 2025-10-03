/**
 * Comprehensive Unit Tests for Validation Utilities
 * Tests all validation functions with edge cases and error scenarios
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
  ValidationUtils,
  DataSanitizer
} from '../../src/models/validation';
import { StatisticsFixtures } from '../fixtures/statistics-fixtures';

describe('Validation Utilities', () => {
  const testTimeout = 10000; // 10 seconds max per test

  describe('validateViolation', () => {

    it('should validate correct violation object', () => {
      const violation = StatisticsFixtures.Violation.createViolation();
      expect(() => validateViolation(violation)).not.toThrow();
      expect(validateViolation(violation)).toBe(true);
    });

    it('should reject null or undefined violation', () => {
      expect(() => validateViolation(null)).toThrow(ValidationError);
      expect(() => validateViolation(undefined)).toThrow(ValidationError);
      expect(() => validateViolation('not an object')).toThrow(ValidationError);
    });

    it('should reject violation with missing required fields', () => {
      const incompleteViolation = { article: '282' }; // Missing other required fields
      expect(() => validateViolation(incompleteViolation)).toThrow(ValidationError);
    });

    it('should reject violation with invalid article', () => {
      const violation = StatisticsFixtures.Violation.createViolation({ article: '' });
      expect(() => validateViolation(violation)).toThrow('Article must be a non-empty string');
    });

    it('should reject violation with invalid severity', () => {
      const violation = StatisticsFixtures.Violation.createViolation({ severity: 0 });
      expect(() => validateViolation(violation)).toThrow('Severity must be a number between 1 and 10');
      
      const violation2 = StatisticsFixtures.Violation.createViolation({ severity: 11 });
      expect(() => validateViolation(violation2)).toThrow('Severity must be a number between 1 and 10');
    });

    it('should reject violation with invalid confidence', () => {
      const violation = StatisticsFixtures.Violation.createViolation({ confidence: -0.1 });
      expect(() => validateViolation(violation)).toThrow('Confidence must be a number between 0 and 1');
      
      const violation2 = StatisticsFixtures.Violation.createViolation({ confidence: 1.1 });
      expect(() => validateViolation(violation2)).toThrow('Confidence must be a number between 0 and 1');
    });

    it('should accept null subarticle', () => {
      const violation = StatisticsFixtures.Violation.createViolation({ subarticle: null });
      expect(() => validateViolation(violation)).not.toThrow();
    });

    it('should reject invalid subarticle type', () => {
      const violation = StatisticsFixtures.Violation.createViolation({ subarticle: 123 as any });
      expect(() => validateViolation(violation)).toThrow('Subarticle must be a string or null');
    });
  });

  describe('validateViolationAnalysis', () => {

    it('should validate correct violation analysis', () => {
      const analysis = StatisticsFixtures.ViolationAnalysis.createWithViolations(2);
      expect(() => validateViolationAnalysis(analysis)).not.toThrow();
      expect(validateViolationAnalysis(analysis)).toBe(true);
    });

    it('should validate analysis without violations', () => {
      const analysis = StatisticsFixtures.ViolationAnalysis.createWithoutViolations();
      expect(() => validateViolationAnalysis(analysis)).not.toThrow();
    });

    it('should reject analysis with invalid hasViolations', () => {
      const analysis = { ...StatisticsFixtures.ViolationAnalysis.createWithViolations(), hasViolations: 'true' };
      expect(() => validateViolationAnalysis(analysis)).toThrow('hasViolations must be a boolean');
    });

    it('should reject analysis with non-array violations', () => {
      const analysis = { ...StatisticsFixtures.ViolationAnalysis.createWithViolations(), violations: 'not array' };
      expect(() => validateViolationAnalysis(analysis)).toThrow('violations must be an array');
    });

    it('should reject analysis with invalid violation in array', () => {
      const analysis = StatisticsFixtures.ViolationAnalysis.createWithViolations();
      analysis.violations[0] = { invalid: 'violation' } as any;
      expect(() => validateViolationAnalysis(analysis)).toThrow('Invalid violation at index 0');
    });

    it('should reject analysis with invalid risk level', () => {
      const analysis = { ...StatisticsFixtures.ViolationAnalysis.createWithViolations(), riskLevel: 'extreme' };
      expect(() => validateViolationAnalysis(analysis)).toThrow('riskLevel must be one of: low, medium, high');
    });

    it('should reject analysis with negative total severity', () => {
      const analysis = { ...StatisticsFixtures.ViolationAnalysis.createWithViolations(), totalSeverity: -5 };
      expect(() => validateViolationAnalysis(analysis)).toThrow('totalSeverity must be a non-negative number');
    });
  });

  describe('validateViolationCount', () => {

    it('should validate correct violation count', () => {
      const violationCount = StatisticsFixtures.ViolationCount.createViolationCount();
      expect(() => validateViolationCount(violationCount)).not.toThrow();
      expect(validateViolationCount(violationCount)).toBe(true);
    });

    it('should reject violation count with empty article', () => {
      const violationCount = StatisticsFixtures.ViolationCount.createViolationCount({ article: '' });
      expect(() => validateViolationCount(violationCount)).toThrow('Article must be a non-empty string');
    });

    it('should reject violation count with negative count', () => {
      const violationCount = StatisticsFixtures.ViolationCount.createViolationCount({ count: -1 });
      expect(() => validateViolationCount(violationCount)).toThrow('Count must be a non-negative number');
    });

    it('should reject violation count with invalid average severity', () => {
      const violationCount = StatisticsFixtures.ViolationCount.createViolationCount({ averageSeverity: 0 });
      expect(() => validateViolationCount(violationCount)).toThrow('averageSeverity must be a number between 1 and 10');
      
      const violationCount2 = StatisticsFixtures.ViolationCount.createViolationCount({ averageSeverity: 11 });
      expect(() => validateViolationCount(violationCount2)).toThrow('averageSeverity must be a number between 1 and 10');
    });

    it('should accept undefined optional fields', () => {
      const violationCount = {
        article: '282',
        subarticle: undefined,
        articleTitle: undefined,
        punishment: undefined,
        count: 5,
        averageSeverity: 6.5
      };
      expect(() => validateViolationCount(violationCount)).not.toThrow();
    });
  });

  describe('validateUserViolationCount', () => {

    it('should validate correct user violation count', () => {
      const userViolationCount = StatisticsFixtures.UserViolationCount.createUserViolationCount();
      expect(() => validateUserViolationCount(userViolationCount)).not.toThrow();
      expect(validateUserViolationCount(userViolationCount)).toBe(true);
    });

    it('should reject user violation count with empty userId', () => {
      const userViolationCount = StatisticsFixtures.UserViolationCount.createUserViolationCount({ userId: '' });
      expect(() => validateUserViolationCount(userViolationCount)).toThrow('userId must be a non-empty string');
    });

    it('should reject user violation count with invalid risk level', () => {
      const userViolationCount = StatisticsFixtures.UserViolationCount.createUserViolationCount({ riskLevel: 'extreme' as any });
      expect(() => validateUserViolationCount(userViolationCount)).toThrow('riskLevel must be one of: low, medium, high');
    });

    it('should accept undefined username', () => {
      const userViolationCount = StatisticsFixtures.UserViolationCount.createUserViolationCount({ username: undefined });
      expect(() => validateUserViolationCount(userViolationCount)).not.toThrow();
    });
  });

  describe('validateUserStats', () => {

    it('should validate correct user stats', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats();
      expect(() => validateUserStats(userStats)).not.toThrow();
      expect(validateUserStats(userStats)).toBe(true);
    });

    it('should reject user stats with empty userId', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats({ userId: '' });
      expect(() => validateUserStats(userStats)).toThrow('userId must be a non-empty string');
    });

    it('should reject user stats with empty chatId', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats({ chatId: '' });
      expect(() => validateUserStats(userStats)).toThrow('chatId must be a non-empty string');
    });

    it('should reject user stats with negative total violations', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats({ totalViolations: -1 });
      expect(() => validateUserStats(userStats)).toThrow('totalViolations must be a non-negative number');
    });

    it('should reject user stats with non-array violationsByArticle', () => {
      const userStats = { ...StatisticsFixtures.UserStats.createUserStats(), violationsByArticle: 'not array' };
      expect(() => validateUserStats(userStats)).toThrow('violationsByArticle must be an array');
    });

    it('should validate each violation count in violationsByArticle', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats();
      userStats.violationsByArticle[0] = { invalid: 'data' } as any;
      expect(() => validateUserStats(userStats)).toThrow('Invalid violationCount at index 0');
    });

    it('should accept undefined optional fields', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats({
        lastViolationDate: undefined,
        mostCommonViolation: undefined
      });
      expect(() => validateUserStats(userStats)).not.toThrow();
    });

    it('should reject invalid lastViolationDate', () => {
      const userStats = { ...StatisticsFixtures.UserStats.createUserStats(), lastViolationDate: 'not a date' };
      expect(() => validateUserStats(userStats)).toThrow('lastViolationDate must be a Date or undefined');
    });
  });

  describe('validatePeriodComparison', () => {

    it('should validate correct period comparison', () => {
      const comparison = StatisticsFixtures.PeriodComparison.createPeriodComparison();
      expect(() => validatePeriodComparison(comparison)).not.toThrow();
      expect(validatePeriodComparison(comparison)).toBe(true);
    });

    it('should reject period comparison with non-number fields', () => {
      const comparison = { violationsChange: 'not number', severityChange: 0, usersChange: 0 };
      expect(() => validatePeriodComparison(comparison)).toThrow('violationsChange must be a number');
      
      const comparison2 = { violationsChange: 0, severityChange: 'not number', usersChange: 0 };
      expect(() => validatePeriodComparison(comparison2)).toThrow('severityChange must be a number');
      
      const comparison3 = { violationsChange: 0, severityChange: 0, usersChange: 'not number' };
      expect(() => validatePeriodComparison(comparison3)).toThrow('usersChange must be a number');
    });

    it('should accept negative values for decreases', () => {
      const comparison = {
        violationsChange: -15.5,
        severityChange: -2.3,
        usersChange: -10.0
      };
      expect(() => validatePeriodComparison(comparison)).not.toThrow();
    });
  });

  describe('validatePeriodStats', () => {

    it('should validate correct period stats', () => {
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats();
      expect(() => validatePeriodStats(periodStats)).not.toThrow();
      expect(validatePeriodStats(periodStats)).toBe(true);
    });

    it('should reject period stats with invalid date range', () => {
      const endDate = new Date('2024-01-01');
      const startDate = new Date('2024-01-02'); // Start after end
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats({ startDate, endDate });
      expect(() => validatePeriodStats(periodStats)).toThrow('startDate must be before endDate');
    });

    it('should reject period stats with non-Date objects', () => {
      const periodStats = { ...StatisticsFixtures.PeriodStats.createPeriodStats(), startDate: 'not a date' };
      expect(() => validatePeriodStats(periodStats)).toThrow('startDate must be a Date');
      
      const periodStats2 = { ...StatisticsFixtures.PeriodStats.createPeriodStats(), endDate: 'not a date' };
      expect(() => validatePeriodStats(periodStats2)).toThrow('endDate must be a Date');
    });

    it('should validate comparison with previous period if present', () => {
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats();
      periodStats.comparisonWithPreviousPeriod = { invalid: 'comparison' } as any;
      expect(() => validatePeriodStats(periodStats)).toThrow('Invalid period comparison');
    });

    it('should accept undefined comparison with previous period', () => {
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats({
        comparisonWithPreviousPeriod: undefined
      });
      expect(() => validatePeriodStats(periodStats)).not.toThrow();
    });
  });

  describe('validateGeneralStats', () => {

    it('should validate correct general stats', () => {
      const generalStats = StatisticsFixtures.GeneralStats.createGeneralStats();
      expect(() => validateGeneralStats(generalStats)).not.toThrow();
      expect(validateGeneralStats(generalStats)).toBe(true);
    });

    it('should validate each violation in topViolations array', () => {
      const generalStats = StatisticsFixtures.GeneralStats.createGeneralStats();
      generalStats.topViolations[0] = { invalid: 'violation' } as any;
      expect(() => validateGeneralStats(generalStats)).toThrow('Invalid topViolation at index 0');
    });

    it('should validate each user in topUsers array', () => {
      const generalStats = StatisticsFixtures.GeneralStats.createGeneralStats();
      generalStats.topUsers[0] = { invalid: 'user' } as any;
      expect(() => validateGeneralStats(generalStats)).toThrow('Invalid topUser at index 0');
    });

    it('should validate each violation in criticalViolations array', () => {
      const generalStats = StatisticsFixtures.GeneralStats.createGeneralStats();
      generalStats.criticalViolations[0] = { invalid: 'violation' } as any;
      expect(() => validateGeneralStats(generalStats)).toThrow('Invalid criticalViolation at index 0');
    });

    it('should reject general stats with invalid overall risk level', () => {
      const generalStats = { ...StatisticsFixtures.GeneralStats.createGeneralStats(), overallRiskLevel: 'extreme' };
      expect(() => validateGeneralStats(generalStats)).toThrow('overallRiskLevel must be one of: low, medium, high');
    });
  });

  describe('ValidationUtils', () => {

    describe('isValidRiskLevel', () => {

      it('should validate correct risk levels', () => {
        expect(ValidationUtils.isValidRiskLevel('low')).toBe(true);
        expect(ValidationUtils.isValidRiskLevel('medium')).toBe(true);
        expect(ValidationUtils.isValidRiskLevel('high')).toBe(true);
      });

      it('should reject invalid risk levels', () => {
        expect(ValidationUtils.isValidRiskLevel('extreme')).toBe(false);
        expect(ValidationUtils.isValidRiskLevel('minimal')).toBe(false);
        expect(ValidationUtils.isValidRiskLevel('')).toBe(false);
      });
    });

    describe('isValidSeverity', () => {

      it('should validate correct severity values', () => {
        expect(ValidationUtils.isValidSeverity(1)).toBe(true);
        expect(ValidationUtils.isValidSeverity(5)).toBe(true);
        expect(ValidationUtils.isValidSeverity(10)).toBe(true);
      });

      it('should reject invalid severity values', () => {
        expect(ValidationUtils.isValidSeverity(0)).toBe(false);
        expect(ValidationUtils.isValidSeverity(11)).toBe(false);
        expect(ValidationUtils.isValidSeverity(-1)).toBe(false);
        expect(ValidationUtils.isValidSeverity('5' as any)).toBe(false);
      });
    });

    describe('isValidConfidence', () => {

      it('should validate correct confidence values', () => {
        expect(ValidationUtils.isValidConfidence(0)).toBe(true);
        expect(ValidationUtils.isValidConfidence(0.5)).toBe(true);
        expect(ValidationUtils.isValidConfidence(1)).toBe(true);
      });

      it('should reject invalid confidence values', () => {
        expect(ValidationUtils.isValidConfidence(-0.1)).toBe(false);
        expect(ValidationUtils.isValidConfidence(1.1)).toBe(false);
        expect(ValidationUtils.isValidConfidence('0.5' as any)).toBe(false);
      });
    });

    describe('calculateRiskLevel', () => {

      it('should calculate risk levels correctly', () => {
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

    describe('sanitizeSeverity', () => {

      it('should sanitize valid severity values', () => {
        expect(ValidationUtils.sanitizeSeverity(5)).toBe(5);
        expect(ValidationUtils.sanitizeSeverity(5.7)).toBe(6); // Rounded
        expect(ValidationUtils.sanitizeSeverity(5.3)).toBe(5); // Rounded
      });

      it('should clamp out-of-range values', () => {
        expect(ValidationUtils.sanitizeSeverity(0)).toBe(1);
        expect(ValidationUtils.sanitizeSeverity(-5)).toBe(1);
        expect(ValidationUtils.sanitizeSeverity(15)).toBe(10);
      });

      it('should handle string inputs', () => {
        expect(ValidationUtils.sanitizeSeverity('5')).toBe(5);
        expect(ValidationUtils.sanitizeSeverity('5.7')).toBe(6);
        expect(ValidationUtils.sanitizeSeverity('invalid')).toBe(1);
      });

      it('should handle invalid inputs', () => {
        expect(ValidationUtils.sanitizeSeverity(null)).toBe(1);
        expect(ValidationUtils.sanitizeSeverity(undefined)).toBe(1);
        expect(ValidationUtils.sanitizeSeverity({})).toBe(1);
      });
    });

    describe('sanitizeConfidence', () => {

      it('should sanitize valid confidence values', () => {
        expect(ValidationUtils.sanitizeConfidence(0.5)).toBe(0.5);
        expect(ValidationUtils.sanitizeConfidence(0)).toBe(0);
        expect(ValidationUtils.sanitizeConfidence(1)).toBe(1);
      });

      it('should clamp out-of-range values', () => {
        expect(ValidationUtils.sanitizeConfidence(-0.5)).toBe(0);
        expect(ValidationUtils.sanitizeConfidence(1.5)).toBe(1);
      });

      it('should handle string inputs', () => {
        expect(ValidationUtils.sanitizeConfidence('0.5')).toBe(0.5);
        expect(ValidationUtils.sanitizeConfidence('invalid')).toBe(0.5);
      });

      it('should handle invalid inputs', () => {
        expect(ValidationUtils.sanitizeConfidence(null)).toBe(0.5);
        expect(ValidationUtils.sanitizeConfidence(undefined)).toBe(0.5);
      });
    });

    describe('sanitizeString', () => {

      it('should sanitize valid strings', () => {
        expect(ValidationUtils.sanitizeString('test')).toBe('test');
        expect(ValidationUtils.sanitizeString('  test  ')).toBe('test');
      });

      it('should handle empty strings', () => {
        expect(ValidationUtils.sanitizeString('')).toBe('');
        expect(ValidationUtils.sanitizeString('   ')).toBe('');
      });

      it('should use fallback for empty strings', () => {
        expect(ValidationUtils.sanitizeString('', 'fallback')).toBe('fallback');
        expect(ValidationUtils.sanitizeString('   ', 'fallback')).toBe('fallback');
      });

      it('should convert non-strings', () => {
        expect(ValidationUtils.sanitizeString(123)).toBe('123');
        expect(ValidationUtils.sanitizeString(true)).toBe('true');
        expect(ValidationUtils.sanitizeString(null)).toBe('');
        expect(ValidationUtils.sanitizeString(undefined)).toBe('');
      });
    });

    describe('sanitizeRiskLevel', () => {

      it('should sanitize valid risk levels', () => {
        expect(ValidationUtils.sanitizeRiskLevel('low')).toBe('low');
        expect(ValidationUtils.sanitizeRiskLevel('medium')).toBe('medium');
        expect(ValidationUtils.sanitizeRiskLevel('high')).toBe('high');
      });

      it('should fallback to low for invalid values', () => {
        expect(ValidationUtils.sanitizeRiskLevel('extreme')).toBe('low');
        expect(ValidationUtils.sanitizeRiskLevel('')).toBe('low');
        expect(ValidationUtils.sanitizeRiskLevel(null)).toBe('low');
        expect(ValidationUtils.sanitizeRiskLevel(undefined)).toBe('low');
      });
    });

    describe('isEmpty', () => {

      it('should detect empty values', () => {
        expect(ValidationUtils.isEmpty(null)).toBe(true);
        expect(ValidationUtils.isEmpty(undefined)).toBe(true);
        expect(ValidationUtils.isEmpty([])).toBe(true);
        expect(ValidationUtils.isEmpty({})).toBe(true);
        expect(ValidationUtils.isEmpty('')).toBe(true);
        expect(ValidationUtils.isEmpty('   ')).toBe(true);
      });

      it('should detect non-empty values', () => {
        expect(ValidationUtils.isEmpty('test')).toBe(false);
        expect(ValidationUtils.isEmpty([1, 2, 3])).toBe(false);
        expect(ValidationUtils.isEmpty({ key: 'value' })).toBe(false);
        expect(ValidationUtils.isEmpty(0)).toBe(false);
        expect(ValidationUtils.isEmpty(false)).toBe(false);
      });
    });

    describe('isValidDate', () => {

      it('should validate correct dates', () => {
        expect(ValidationUtils.isValidDate(new Date())).toBe(true);
        expect(ValidationUtils.isValidDate(new Date('2024-01-01'))).toBe(true);
      });

      it('should reject invalid dates', () => {
        expect(ValidationUtils.isValidDate(new Date('invalid'))).toBe(false);
        expect(ValidationUtils.isValidDate('2024-01-01')).toBe(false);
        expect(ValidationUtils.isValidDate(null)).toBe(false);
        expect(ValidationUtils.isValidDate(undefined)).toBe(false);
      });
    });

    describe('sanitizeDate', () => {

      it('should sanitize valid dates', () => {
        const date = new Date('2024-01-01');
        expect(ValidationUtils.sanitizeDate(date)).toEqual(date);
      });

      it('should parse valid date strings', () => {
        const result = ValidationUtils.sanitizeDate('2024-01-01');
        expect(result).toBeInstanceOf(Date);
        expect(result?.getFullYear()).toBe(2024);
      });

      it('should return undefined for invalid inputs', () => {
        expect(ValidationUtils.sanitizeDate('invalid')).toBeUndefined();
        expect(ValidationUtils.sanitizeDate(null)).toBeUndefined();
        expect(ValidationUtils.sanitizeDate(undefined)).toBeUndefined();
        expect(ValidationUtils.sanitizeDate(123)).toBeUndefined();
      });
    });
  });

  describe('DataSanitizer', () => {

    describe('sanitizeViolation', () => {

      it('should sanitize valid violation', () => {
        const violation = StatisticsFixtures.Violation.createViolation();
        const sanitized = DataSanitizer.sanitizeViolation(violation);
        
        expect(sanitized.article).toBe(violation.article);
        expect(sanitized.severity).toBe(violation.severity);
        expect(sanitized.confidence).toBe(violation.confidence);
      });

      it('should handle null/undefined violation', () => {
        const sanitized = DataSanitizer.sanitizeViolation(null);
        
        expect(sanitized.article).toBe('Неизвестная статья');
        expect(sanitized.quote).toBe('Данные повреждены');
        expect(sanitized.severity).toBe(1);
        expect(sanitized.confidence).toBe(0.1);
      });

      it('should sanitize corrupted violation data', () => {
        const corruptedViolation = {
          article: '',
          severity: 'invalid',
          confidence: 'bad',
          quote: null,
          punishment: undefined
        };
        
        const sanitized = DataSanitizer.sanitizeViolation(corruptedViolation);
        
        expect(sanitized.article).toBe('Неизвестная статья');
        expect(sanitized.severity).toBe(1); // Sanitized
        expect(sanitized.confidence).toBe(0.5); // Sanitized
        expect(sanitized.quote).toBe('Данные повреждены');
        expect(sanitized.punishment).toBe('Не определено');
      });

      it('should return null for completely invalid data', () => {
        const invalidViolation = {
          article: 'Неизвестная статья',
          quote: 'Данные повреждены'
        };
        
        const sanitized = DataSanitizer.sanitizeViolation(invalidViolation);
        expect(sanitized).toBeNull();
      });
    });

    describe('sanitizeViolationAnalysis', () => {

      it('should sanitize valid analysis', () => {
        const analysis = StatisticsFixtures.ViolationAnalysis.createWithViolations(2);
        const sanitized = DataSanitizer.sanitizeViolationAnalysis(analysis);
        
        expect(sanitized.hasViolations).toBe(true);
        expect(sanitized.violations.length).toBe(2);
        expect(sanitized.riskLevel).toBeDefined();
      });

      it('should handle null/undefined analysis', () => {
        const sanitized = DataSanitizer.sanitizeViolationAnalysis(null);
        
        expect(sanitized.hasViolations).toBe(false);
        expect(sanitized.violations).toEqual([]);
        expect(sanitized.totalSeverity).toBe(0);
        expect(sanitized.riskLevel).toBe('low');
      });

      it('should filter out invalid violations', () => {
        const analysisWithInvalidViolations = {
          hasViolations: true,
          violations: [
            StatisticsFixtures.Violation.createViolation(),
            { article: 'Неизвестная статья', quote: 'Данные повреждены' }, // Invalid
            StatisticsFixtures.Violation.createViolation()
          ],
          totalSeverity: 15,
          riskLevel: 'high',
          analysisTimestamp: new Date().toISOString()
        };
        
        const sanitized = DataSanitizer.sanitizeViolationAnalysis(analysisWithInvalidViolations);
        
        expect(sanitized.violations.length).toBe(2); // Invalid one filtered out
        expect(sanitized.hasViolations).toBe(true);
      });
    });

    describe('createEmptyUserStats', () => {

      it('should create empty user stats', () => {
        const stats = DataSanitizer.createEmptyUserStats('user123', 'chat456');
        
        expect(stats.userId).toBe('user123');
        expect(stats.chatId).toBe('chat456');
        expect(stats.totalViolations).toBe(0);
        expect(stats.violationsByArticle).toEqual([]);
        expect(stats.averageSeverity).toBe(0);
        expect(stats.riskLevel).toBe('low');
        expect(stats.lastViolationDate).toBeUndefined();
        expect(stats.mostCommonViolation).toBeUndefined();
      });

      it('should sanitize invalid user/chat IDs', () => {
        const stats = DataSanitizer.createEmptyUserStats('', null as any);
        
        expect(stats.userId).toBe('unknown');
        expect(stats.chatId).toBe('unknown');
      });
    });

    describe('createEmptyPeriodStats', () => {

      it('should create empty period stats', () => {
        const startDate = new Date('2024-01-01');
        const endDate = new Date('2024-01-31');
        const stats = DataSanitizer.createEmptyPeriodStats('chat456', startDate, endDate);
        
        expect(stats.chatId).toBe('chat456');
        expect(stats.startDate).toEqual(startDate);
        expect(stats.endDate).toEqual(endDate);
        expect(stats.totalViolations).toBe(0);
        expect(stats.violationsByArticle).toEqual([]);
        expect(stats.averageSeverity).toBe(0);
        expect(stats.uniqueUsers).toBe(0);
      });

      it('should handle invalid dates', () => {
        const stats = DataSanitizer.createEmptyPeriodStats('chat456', 'invalid' as any, null as any);
        
        expect(stats.startDate).toBeInstanceOf(Date);
        expect(stats.endDate).toBeInstanceOf(Date);
      });
    });

    describe('createEmptyGeneralStats', () => {

      it('should create empty general stats', () => {
        const stats = DataSanitizer.createEmptyGeneralStats('chat456');
        
        expect(stats.chatId).toBe('chat456');
        expect(stats.totalViolations).toBe(0);
        expect(stats.topViolations).toEqual([]);
        expect(stats.topUsers).toEqual([]);
        expect(stats.overallRiskLevel).toBe('low');
        expect(stats.averageSeverity).toBe(0);
        expect(stats.criticalViolations).toEqual([]);
      });

      it('should sanitize invalid chat ID', () => {
        const stats = DataSanitizer.createEmptyGeneralStats('');
        expect(stats.chatId).toBe('unknown');
      });
    });
  });

  describe('Error Handling', () => {

    it('should throw ValidationError with field information', () => {
      try {
        validateViolation({ article: '' });
      } catch (error: unknown) {
        const e = error as ValidationError;
        expect(e).toBeInstanceOf(ValidationError);
        expect(e.field).toBe('article');
        expect(e.message).toContain('Article must be a non-empty string');
      }
    });

    it('should provide detailed error messages for nested validation', () => {
      const analysis = StatisticsFixtures.ViolationAnalysis.createWithViolations();
      analysis.violations[0] = { article: '' } as any;
      
      try {
        validateViolationAnalysis(analysis);
      } catch (error: unknown) {
        const e = error as any;
        expect(e.message).toContain('Invalid violation at index 0');
        expect(e.message).toContain('Article must be a non-empty string');
      }
    });
  });

  describe('Performance Tests', () => {

    it('should validate large datasets efficiently', () => {
      const largeAnalysis = StatisticsFixtures.ViolationAnalysis.createWithViolations(1000);
      
      const startTime = Date.now();
      expect(() => validateViolationAnalysis(largeAnalysis)).not.toThrow();
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should sanitize large datasets efficiently', () => {
      const largeCorruptedAnalysis = {
        hasViolations: true,
        violations: Array.from({ length: 500 }, () => ({ 
          article: '', 
          severity: 'invalid', 
          confidence: 'bad' 
        })),
        totalSeverity: 'invalid',
        riskLevel: 'extreme',
        analysisTimestamp: 'invalid'
      };
      
      const startTime = Date.now();
      const sanitized = DataSanitizer.sanitizeViolationAnalysis(largeCorruptedAnalysis);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(2000); // Should complete within 2 seconds
      expect(sanitized.violations.length).toBe(0); // All invalid violations filtered out
    });
  });
});