/**
 * Tests for MessageFormatter class
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFormatter, Violation, ViolationAnalysis, UserStats, PeriodStats } from '../src/message-formatter';
import { HTMLBuilder } from '../src/html-builder';

describe('MessageFormatter', () => {
  let formatter: MessageFormatter;
  let mockHtmlBuilder: HTMLBuilder;

  beforeEach(() => {
    mockHtmlBuilder = new HTMLBuilder();
    formatter = new MessageFormatter(mockHtmlBuilder);
  });

  describe('getSeverityEmoji', () => {
    it('should return green emoji for low severity (1-3)', () => {
      expect(formatter.getSeverityEmoji(1)).toBe('🟢');
      expect(formatter.getSeverityEmoji(2)).toBe('🟢');
      expect(formatter.getSeverityEmoji(3)).toBe('🟢');
    });

    it('should return yellow emoji for medium severity (4-6)', () => {
      expect(formatter.getSeverityEmoji(4)).toBe('🟡');
      expect(formatter.getSeverityEmoji(5)).toBe('🟡');
      expect(formatter.getSeverityEmoji(6)).toBe('🟡');
    });

    it('should return red emoji for high severity (7-10)', () => {
      expect(formatter.getSeverityEmoji(7)).toBe('🔴');
      expect(formatter.getSeverityEmoji(8)).toBe('🔴');
      expect(formatter.getSeverityEmoji(9)).toBe('🔴');
      expect(formatter.getSeverityEmoji(10)).toBe('🔴');
    });

    it('should throw error for invalid severity values', () => {
      expect(() => formatter.getSeverityEmoji(0)).toThrow('Severity must be between 1 and 10');
      expect(() => formatter.getSeverityEmoji(11)).toThrow('Severity must be between 1 and 10');
      expect(() => formatter.getSeverityEmoji(-1)).toThrow('Severity must be between 1 and 10');
    });
  });

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(formatter.escapeHtml('<script>alert("test")</script>')).toBe('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;');
      expect(formatter.escapeHtml('Test & Co')).toBe('Test &amp; Co');
      expect(formatter.escapeHtml("It's a test")).toBe('It&#x27;s a test');
    });

    it('should handle empty strings', () => {
      expect(formatter.escapeHtml('')).toBe('');
    });
  });

  describe('formatViolation', () => {
    const mockViolation: Violation = {
      article: '282',
      quote: 'Тестовая цитата с нарушением',
      punishment: 'штраф в размере до трехсот тысяч рублей',
      severity: 7,
      confidence: 0.85
    };

    it('should format violation with all required information', () => {
      const result = formatter.formatViolation(mockViolation);
      
      expect(result).toContain('🔴'); // High severity emoji
      expect(result).toContain('<b>Статья 282 УК РФ</b>');
      expect(result).toContain('<b>Цитата из текста:</b>');
      expect(result).toContain('<i>&quot;Тестовая цитата с нарушением&quot;</i>');
      expect(result).toContain('<b>Наказание:</b>');
      expect(result).toContain('штраф в размере до трехсот тысяч рублей');
      expect(result).toContain('<b>Уровень серьезности:</b> 7/10 🔴');
      expect(result).toContain('<b>Уровень доверия:</b> 85%');
    });

    it('should add confidence warning for low confidence', () => {
      const lowConfidenceViolation: Violation = {
        ...mockViolation,
        confidence: 0.65
      };

      const result = formatter.formatViolation(lowConfidenceViolation);
      expect(result).toContain('⚠️');
      expect(result).toContain('<i>Низкий уровень доверия к анализу</i>');
    });

    it('should not add confidence warning for high confidence', () => {
      const result = formatter.formatViolation(mockViolation);
      expect(result).not.toContain('⚠️');
      expect(result).not.toContain('Низкий уровень доверия');
    });

    it('should handle different severity levels correctly', () => {
      const lowSeverityViolation: Violation = {
        ...mockViolation,
        severity: 2
      };

      const result = formatter.formatViolation(lowSeverityViolation);
      expect(result).toContain('🟢'); // Low severity emoji
      expect(result).toContain('2/10 🟢');
    });
  });

  describe('formatViolationAnalysis', () => {
    it('should return no violations message when no violations found', () => {
      const analysis: ViolationAnalysis = {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: '2024-01-01T00:00:00Z'
      };

      const result = formatter.formatViolationAnalysis(analysis);
      expect(result).toBe('✅ <b>Нарушений не обнаружено</b>');
    });

    it('should format single violation analysis', () => {
      const violation: Violation = {
        article: '282',
        quote: 'Тестовая цитата',
        punishment: 'штраф',
        severity: 5,
        confidence: 0.8
      };

      const analysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [violation],
        totalSeverity: 5,
        riskLevel: 'medium',
        analysisTimestamp: '2024-01-01T00:00:00Z'
      };

      const result = formatter.formatViolationAnalysis(analysis);
      expect(result).toContain('🚨 <b>Обнаружены нарушения УК РФ</b>');
      expect(result).toContain('Статья 282 УК РФ');
      expect(result).toContain('<b>Всего нарушений:</b> 1');
      expect(result).toContain('<b>Общий уровень серьезности:</b> 5');
      expect(result).toContain('<b>Уровень риска:</b> 🟡 Средний');
    });

    it('should format multiple violations with separators', () => {
      const violations: Violation[] = [
        {
          article: '282',
          quote: 'Первая цитата',
          punishment: 'штраф',
          severity: 5,
          confidence: 0.8
        },
        {
          article: '205',
          quote: 'Вторая цитата',
          punishment: 'лишение свободы',
          severity: 9,
          confidence: 0.9
        }
      ];

      const analysis: ViolationAnalysis = {
        hasViolations: true,
        violations,
        totalSeverity: 14,
        riskLevel: 'high',
        analysisTimestamp: '2024-01-01T00:00:00Z'
      };

      const result = formatter.formatViolationAnalysis(analysis);
      expect(result).toContain('━━━━━━━━━━━━━━━━━━━━'); // Separator
      expect(result).toContain('Статья 282 УК РФ');
      expect(result).toContain('Статья 205 УК РФ');
      expect(result).toContain('<b>Всего нарушений:</b> 2');
      expect(result).toContain('<b>Общий уровень серьезности:</b> 14');
      expect(result).toContain('<b>Уровень риска:</b> 🔴 Высокий');
    });
  });

  describe('formatUserStats', () => {
    const mockUserStats: UserStats = {
      userId: 'user123',
      chatId: 'chat456',
      totalViolations: 5,
      violationsByArticle: new Map([
        ['282', 3],
        ['205', 2]
      ]),
      averageSeverity: 6.2,
      riskLevel: 'medium',
      lastViolationDate: new Date('2024-01-15'),
      mostCommonViolation: '282'
    };

    it('should format user statistics correctly', () => {
      const result = formatter.formatUserStats(mockUserStats);
      
      expect(result).toContain('📊 <b>Статистика пользователя</b>');
      expect(result).toContain('<b>Всего нарушений:</b> 5');
      expect(result).toContain('<b>Средняя серьезность:</b> 6.2/10');
      expect(result).toContain('<b>Уровень риска:</b> 🟡 Средний');
      expect(result).toContain('<b>Последнее нарушение:</b> 15.01.2024');
      expect(result).toContain('<b>Наиболее частое нарушение:</b> 282');
    });

    it('should format violations by article in descending order', () => {
      const result = formatter.formatUserStats(mockUserStats);
      
      expect(result).toContain('<b>Нарушения по статьям УК РФ:</b>');
      expect(result).toContain('• <b>Статья 282:</b> 3 раз');
      expect(result).toContain('• <b>Статья 205:</b> 2 раз');
      
      // Check that 282 (3 violations) comes before 205 (2 violations)
      const index282 = result.indexOf('• <b>Статья 282:</b> 3 раз');
      const index205 = result.indexOf('• <b>Статья 205:</b> 2 раз');
      expect(index282).toBeLessThan(index205);
    });

    it('should handle empty violations by article', () => {
      const statsWithoutViolations: UserStats = {
        ...mockUserStats,
        violationsByArticle: new Map(),
        mostCommonViolation: ''
      };

      const result = formatter.formatUserStats(statsWithoutViolations);
      expect(result).not.toContain('<b>Нарушения по статьям УК РФ:</b>');
      expect(result).not.toContain('<b>Наиболее частое нарушение:</b>');
    });
  });

  describe('formatPeriodStats', () => {
    const mockPeriodStats: PeriodStats = {
      chatId: 'chat456',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-31'),
      totalViolations: 15,
      violationsByArticle: new Map([
        ['282', 8],
        ['205', 4],
        ['130', 3]
      ]),
      averageSeverity: 5.8,
      uniqueUsers: 7,
      comparisonWithPreviousPeriod: {
        violationsChange: 3,
        severityChange: -0.5
      }
    };

    it('should format period statistics correctly', () => {
      const result = formatter.formatPeriodStats(mockPeriodStats);
      
      expect(result).toContain('📈 <b>Статистика за период</b>');
      expect(result).toContain('<b>Период:</b> 01.01.2024 - 31.01.2024');
      expect(result).toContain('<b>Всего нарушений:</b> 15');
      expect(result).toContain('<b>Уникальных пользователей:</b> 7');
      expect(result).toContain('<b>Средняя серьезность:</b> 5.8/10');
    });

    it('should show increase trends correctly', () => {
      const result = formatter.formatPeriodStats(mockPeriodStats);
      
      expect(result).toContain('📈 <b>Изменение количества:</b> увеличение на 3');
      expect(result).toContain('⬇️ <b>Изменение серьезности:</b> снижение на 0.5');
    });

    it('should show decrease trends correctly', () => {
      const statsWithDecrease: PeriodStats = {
        ...mockPeriodStats,
        comparisonWithPreviousPeriod: {
          violationsChange: -2,
          severityChange: 1.2
        }
      };

      const result = formatter.formatPeriodStats(statsWithDecrease);
      
      expect(result).toContain('📉 <b>Изменение количества:</b> уменьшение на 2');
      expect(result).toContain('⬆️ <b>Изменение серьезности:</b> повышение на 1.2');
    });

    it('should not show trends when there are no changes', () => {
      const statsWithoutChanges: PeriodStats = {
        ...mockPeriodStats,
        comparisonWithPreviousPeriod: {
          violationsChange: 0,
          severityChange: 0
        }
      };

      const result = formatter.formatPeriodStats(statsWithoutChanges);
      
      expect(result).not.toContain('Изменение количества');
      expect(result).not.toContain('Изменение серьезности');
    });

    it('should format violations by article in descending order', () => {
      const result = formatter.formatPeriodStats(mockPeriodStats);
      
      expect(result).toContain('<b>Нарушения по статьям УК РФ:</b>');
      expect(result).toContain('• <b>Статья 282:</b> 8 раз');
      expect(result).toContain('• <b>Статья 205:</b> 4 раз');
      expect(result).toContain('• <b>Статья 130:</b> 3 раз');
      
      // Check order: 282 (8) > 205 (4) > 130 (3)
      const index282 = result.indexOf('• <b>Статья 282:</b> 8 раз');
      const index205 = result.indexOf('• <b>Статья 205:</b> 4 раз');
      const index130 = result.indexOf('• <b>Статья 130:</b> 3 раз');
      
      expect(index282).toBeLessThan(index205);
      expect(index205).toBeLessThan(index130);
    });
  });

  describe('formatRiskLevel', () => {
    it('should format risk levels with appropriate emojis', () => {
      const lowRiskStats: UserStats = {
        userId: 'user123',
        chatId: 'chat456',
        totalViolations: 1,
        violationsByArticle: new Map(),
        averageSeverity: 2.0,
        riskLevel: 'low',
        lastViolationDate: new Date(),
        mostCommonViolation: ''
      };

      const mediumRiskStats: UserStats = {
        ...lowRiskStats,
        riskLevel: 'medium'
      };

      const highRiskStats: UserStats = {
        ...lowRiskStats,
        riskLevel: 'high'
      };

      expect(formatter.formatUserStats(lowRiskStats)).toContain('🟢 Низкий');
      expect(formatter.formatUserStats(mediumRiskStats)).toContain('🟡 Средний');
      expect(formatter.formatUserStats(highRiskStats)).toContain('🔴 Высокий');
    });
  });

  describe('edge cases', () => {
    it('should handle violations with special characters in quotes', () => {
      const violationWithSpecialChars: Violation = {
        article: '282',
        quote: 'Цитата с <script>alert("xss")</script> и & символами',
        punishment: 'штраф',
        severity: 5,
        confidence: 0.8
      };

      const result = formatter.formatViolation(violationWithSpecialChars);
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;');
      expect(result).not.toContain('<script>');
    });

    it('should handle empty violation data gracefully', () => {
      const emptyViolation: Violation = {
        article: '',
        quote: '',
        punishment: '',
        severity: 1,
        confidence: 0.5
      };

      const result = formatter.formatViolation(emptyViolation);
      expect(result).toContain('<b>Статья  УК РФ</b>'); // Empty article
      expect(result).toContain('<i>&quot;&quot;</i>'); // Empty quote
    });

    it('should handle confidence exactly at threshold', () => {
      const thresholdViolation: Violation = {
        article: '282',
        quote: 'Test quote',
        punishment: 'Test punishment',
        severity: 5,
        confidence: 0.7 // Exactly at threshold
      };

      const result = formatter.formatViolation(thresholdViolation);
      expect(result).not.toContain('⚠️'); // Should not show warning at exactly 70%
    });
  });
});