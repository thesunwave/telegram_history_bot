/**
 * Tests for MessageFormatter class
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFormatter, ViolationAnalysis } from '../src/core/message-formatter';
import { UserStats, PeriodStats, GeneralStats, ViolationCount, UserViolationCount, Violation } from '../src/models/statistics';
import { HTMLBuilder } from '../src/core/html-builder';

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
      subarticle: '1',
      articleTitle: 'Возбуждение ненависти либо вражды',
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
        subarticle: null,
        articleTitle: '',
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
          subarticle: null,
          articleTitle: '',
          quote: 'Первая цитата',
          punishment: 'штраф',
          severity: 5,
          confidence: 0.8
        },
        {
          article: '205',
          subarticle: null,
          articleTitle: '',
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
      violationsByArticle: [
        { article: '282', subarticle: null, articleTitle: 'Возбуждение ненависти либо вражды', punishment: 'штраф в размере до трехсот тысяч рублей', count: 3, averageSeverity: 6.5 },
        { article: '205', subarticle: '1', articleTitle: 'Терроризм', punishment: 'лишение свободы на срок до 15 лет', count: 2, averageSeverity: 8.0 }
      ],
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
      expect(result).toContain('• <b>Статья 282 УК РФ</b> 3 раз 🟡 (ср. 6.5)');
      expect(result).toContain('• <b>Статья 205.1 УК РФ</b> 2 раз 🔴 (ср. 8.0)');
      
      // Check that 282 (3 violations) comes before 205.1 (2 violations)
      const index282 = result.indexOf('• <b>Статья 282 УК РФ</b> 3 раз');
      const index205 = result.indexOf('• <b>Статья 205.1 УК РФ</b> 2 раз');
      expect(index282).toBeLessThan(index205);
    });

    it('should display article titles and punishments for violations', () => {
      const result = formatter.formatUserStats(mockUserStats);
      
      // Check that article titles are displayed
      expect(result).toContain('<i>Возбуждение ненависти либо вражды</i>');
      expect(result).toContain('<i>Терроризм</i>');
      
      // Check that punishments are displayed
      expect(result).toContain('<b>Наказание:</b> штраф в размере до трехсот тысяч рублей');
      expect(result).toContain('<b>Наказание:</b> лишение свободы на срок до 15 лет');
    });

    it('should handle empty violations by article', () => {
      const statsWithoutViolations: UserStats = {
        ...mockUserStats,
        violationsByArticle: [],
        mostCommonViolation: undefined
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
      violationsByArticle: [
        { article: '282', subarticle: null, articleTitle: 'Возбуждение ненависти либо вражды', punishment: 'штраф в размере до трехсот тысяч рублей', count: 8, averageSeverity: 5.5 },
        { article: '205', subarticle: '1', articleTitle: 'Терроризм', punishment: 'лишение свободы на срок до 15 лет', count: 4, averageSeverity: 8.2 },
        { article: '130', subarticle: null, articleTitle: 'Оскорбление', punishment: 'штраф в размере до сорока тысяч рублей', count: 3, averageSeverity: 4.0 }
      ],
      averageSeverity: 5.8,
      uniqueUsers: 7,
      comparisonWithPreviousPeriod: {
        violationsChange: 15.5,
        severityChange: -0.5,
        usersChange: 12.0
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
      
      expect(result).toContain('📈 <b>Изменение количества:</b> увеличение на 15.5%');
      expect(result).toContain('⬇️ <b>Изменение серьезности:</b> снижение на 0.5');
      expect(result).toContain('👥📈 <b>Изменение пользователей:</b> увеличение на 12.0%');
    });

    it('should show decrease trends correctly', () => {
      const statsWithDecrease: PeriodStats = {
        ...mockPeriodStats,
        comparisonWithPreviousPeriod: {
          violationsChange: -8.5,
          severityChange: 1.2,
          usersChange: -5.0
        }
      };

      const result = formatter.formatPeriodStats(statsWithDecrease);
      
      expect(result).toContain('📉 <b>Изменение количества:</b> уменьшение на 8.5%');
      expect(result).toContain('⬆️ <b>Изменение серьезности:</b> повышение на 1.2');
      expect(result).toContain('👥📉 <b>Изменение пользователей:</b> уменьшение на 5.0%');
    });

    it('should not show trends when there are no changes', () => {
      const statsWithoutChanges: PeriodStats = {
        ...mockPeriodStats,
        comparisonWithPreviousPeriod: {
          violationsChange: 0,
          severityChange: 0,
          usersChange: 0
        }
      };

      const result = formatter.formatPeriodStats(statsWithoutChanges);
      
      expect(result).not.toContain('Изменение количества');
      expect(result).not.toContain('Изменение серьезности');
      expect(result).not.toContain('Изменение пользователей');
    });

    it('should format violations by article in descending order', () => {
      const result = formatter.formatPeriodStats(mockPeriodStats);
      
      expect(result).toContain('<b>Нарушения по статьям УК РФ:</b>');
      expect(result).toContain('• <b>Статья 282 УК РФ</b> 8 раз 🟡 (ср. 5.5)');
      expect(result).toContain('• <b>Статья 205.1 УК РФ</b> 4 раз 🔴 (ср. 8.2)');
      expect(result).toContain('• <b>Статья 130 УК РФ</b> 3 раз 🟡 (ср. 4.0)');
      
      // Check order: 282 (8) > 205.1 (4) > 130 (3)
      const index282 = result.indexOf('• <b>Статья 282 УК РФ</b> 8 раз');
      const index205 = result.indexOf('• <b>Статья 205.1 УК РФ</b> 4 раз');
      const index130 = result.indexOf('• <b>Статья 130 УК РФ</b> 3 раз');
      
      expect(index282).toBeLessThan(index205);
      expect(index205).toBeLessThan(index130);
    });

    it('should display article titles and punishments in period stats', () => {
      const result = formatter.formatPeriodStats(mockPeriodStats);
      
      // Check that article titles are displayed
      expect(result).toContain('<i>Возбуждение ненависти либо вражды</i>');
      expect(result).toContain('<i>Терроризм</i>');
      expect(result).toContain('<i>Оскорбление</i>');
      
      // Check that punishments are displayed
      expect(result).toContain('<b>Наказание:</b> штраф в размере до трехсот тысяч рублей');
      expect(result).toContain('<b>Наказание:</b> лишение свободы на срок до 15 лет');
      expect(result).toContain('<b>Наказание:</b> штраф в размере до сорока тысяч рублей');
    });
  });

  describe('formatGeneralStats', () => {
    const mockGeneralStats: GeneralStats = {
      chatId: 'chat456',
      totalViolations: 50,
      topViolations: [
        { article: '282', subarticle: null, articleTitle: 'Возбуждение ненависти либо вражды', punishment: 'штраф в размере до трехсот тысяч рублей', count: 20, averageSeverity: 6.5 },
        { article: '205', subarticle: '1', articleTitle: 'Терроризм', punishment: 'лишение свободы на срок до 15 лет', count: 15, averageSeverity: 8.8 },
        { article: '130', subarticle: null, articleTitle: 'Оскорбление', punishment: 'штраф в размере до сорока тысяч рублей', count: 10, averageSeverity: 4.2 },
        { article: '228', subarticle: '1', articleTitle: 'Незаконные приобретение, хранение, перевозка, изготовление, переработка наркотических средств', punishment: 'лишение свободы на срок до трех лет', count: 3, averageSeverity: 7.0 },
        { article: '159', subarticle: null, articleTitle: 'Мошенничество', punishment: 'штраф в размере до ста двадцати тысяч рублей', count: 2, averageSeverity: 5.5 }
      ],
      topUsers: [
        { userId: 'user1', username: 'baduser1', count: 12, averageSeverity: 7.2, riskLevel: 'high' },
        { userId: 'user2', username: 'baduser2', count: 8, averageSeverity: 5.5, riskLevel: 'medium' },
        { userId: 'user3', count: 6, averageSeverity: 4.0, riskLevel: 'low' },
        { userId: 'user4', username: 'baduser4', count: 4, averageSeverity: 6.8, riskLevel: 'medium' },
        { userId: 'user5', count: 3, averageSeverity: 3.2, riskLevel: 'low' }
      ],
      overallRiskLevel: 'high',
      averageSeverity: 6.8,
      criticalViolations: [
        {
          article: '205',
          subarticle: null,
          articleTitle: 'Терроризм',
          quote: 'Очень серьезное нарушение с высокой степенью опасности для общества',
          punishment: 'лишение свободы на срок до 15 лет',
          severity: 9,
          confidence: 0.95
        },
        {
          article: '282',
          subarticle: '1',
          articleTitle: 'Возбуждение ненависти либо вражды',
          quote: 'Еще одно критическое нарушение',
          punishment: 'штраф или лишение свободы',
          severity: 8,
          confidence: 0.88
        }
      ]
    };

    it('should format general statistics correctly', () => {
      const result = formatter.formatGeneralStats(mockGeneralStats);
      
      expect(result).toContain('📊 <b>Общая статистика чата</b>');
      expect(result).toContain('<b>Всего нарушений:</b> 50');
      expect(result).toContain('<b>Средняя серьезность:</b> 6.8/10');
      expect(result).toContain('<b>Общий уровень риска:</b> 🔴 Высокий');
    });

    it('should format top 5 violations with position emojis', () => {
      const result = formatter.formatGeneralStats(mockGeneralStats);
      
      expect(result).toContain('<b>🏆 Топ-5 самых частых нарушений:</b>');
      expect(result).toContain('🥇 <b>Статья 282 УК РФ</b> 20 раз 🟡 (ср. 6.5)');
      expect(result).toContain('🥈 <b>Статья 205.1 УК РФ</b> 15 раз 🔴 (ср. 8.8)');
      expect(result).toContain('🥉 <b>Статья 130 УК РФ</b> 10 раз 🟡 (ср. 4.2)');
      expect(result).toContain('4. <b>Статья 228.1 УК РФ</b> 3 раз 🔴 (ср. 7.0)');
      expect(result).toContain('5. <b>Статья 159 УК РФ</b> 2 раз 🟡 (ср. 5.5)');
    });

    it('should display article titles and punishments in general stats top violations', () => {
      const result = formatter.formatGeneralStats(mockGeneralStats);
      
      // Check that article titles are displayed
      expect(result).toContain('<i>Возбуждение ненависти либо вражды</i>');
      expect(result).toContain('<i>Терроризм</i>');
      expect(result).toContain('<i>Оскорбление</i>');
      expect(result).toContain('<i>Незаконные приобретение, хранение, перевозка, изготовление, переработка наркотических средств</i>');
      expect(result).toContain('<i>Мошенничество</i>');
      
      // Check that punishments are displayed
      expect(result).toContain('<b>Наказание:</b> штраф в размере до трехсот тысяч рублей');
      expect(result).toContain('<b>Наказание:</b> лишение свободы на срок до 15 лет');
      expect(result).toContain('<b>Наказание:</b> штраф в размере до сорока тысяч рублей');
      expect(result).toContain('<b>Наказание:</b> лишение свободы на срок до трех лет');
      expect(result).toContain('<b>Наказание:</b> штраф в размере до ста двадцати тысяч рублей');
    });

    it('should format top 5 users with usernames and risk levels', () => {
      const result = formatter.formatGeneralStats(mockGeneralStats);
      
      expect(result).toContain('<b>👤 Топ-5 пользователей с наибольшим количеством нарушений:</b>');
      expect(result).toContain('🥇 <b>@baduser1</b>: 12 нарушений, риск: 🔴 Высокий (ср. 7.2)');
      expect(result).toContain('🥈 <b>@baduser2</b>: 8 нарушений, риск: 🟡 Средний (ср. 5.5)');
      expect(result).toContain('🥉 <b>ID: user3</b>: 6 нарушений, риск: 🟢 Низкий (ср. 4.0)');
      expect(result).toContain('4. <b>@baduser4</b>: 4 нарушения, риск: 🟡 Средний (ср. 6.8)');
      expect(result).toContain('5. <b>ID: user5</b>: 3 нарушения, риск: 🟢 Низкий (ср. 3.2)');
    });

    it('should format critical violations section', () => {
      const result = formatter.formatGeneralStats(mockGeneralStats);
      
      expect(result).toContain('🚨 <b>Критические нарушения (серьезность ≥ 8):</b>');
      expect(result).toContain('🔴 <b>Статья 205 УК РФ</b> серьезность 9/10');
      expect(result).toContain('<i>&quot;Очень серьезное нарушение с высокой степенью опасности для общества&quot;</i>');
      expect(result).toContain('🔴 <b>Статья 282 УК РФ</b> серьезность 8/10');
      expect(result).toContain('<i>&quot;Еще одно критическое нарушение&quot;</i>');
    });

    it('should truncate long quotes in critical violations', () => {
      const statsWithLongQuote: GeneralStats = {
        ...mockGeneralStats,
        criticalViolations: [
          {
            article: '205',
            subarticle: null,
            articleTitle: 'Терроризм',
            quote: 'Это очень длинная цитата которая должна быть обрезана потому что она превышает лимит в сто символов и может сделать сообщение слишком длинным для удобного чтения',
            punishment: 'лишение свободы',
            severity: 9,
            confidence: 0.95
          }
        ]
      };

      const result = formatter.formatGeneralStats(statsWithLongQuote);
      
      expect(result).toContain('Это очень длинная цитата которая должна быть обрезана потому что она превышает лимит в сто символов ...');
      expect(result).not.toContain('слишком длинным для удобного чтения');
    });

    it('should handle empty sections gracefully', () => {
      const emptyStats: GeneralStats = {
        chatId: 'chat456',
        totalViolations: 0,
        topViolations: [],
        topUsers: [],
        overallRiskLevel: 'low',
        averageSeverity: 0,
        criticalViolations: []
      };

      const result = formatter.formatGeneralStats(emptyStats);
      
      expect(result).toContain('📊 <b>Общая статистика чата</b>');
      expect(result).toContain('<b>Всего нарушений:</b> 0');
      expect(result).not.toContain('🏆 Топ-5 самых частых нарушений:');
      expect(result).not.toContain('👤 Топ-5 пользователей');
      expect(result).not.toContain('🚨 Критические нарушения');
    });

    it('should limit to top 5 even if more data is provided', () => {
      const statsWithManyViolations: GeneralStats = {
        ...mockGeneralStats,
        topViolations: [
          ...mockGeneralStats.topViolations,
          { article: '111', count: 1, averageSeverity: 3.0 },
          { article: '222', count: 1, averageSeverity: 2.0 }
        ]
      };

      const result = formatter.formatGeneralStats(statsWithManyViolations);
      
      // Should only show first 5
      expect(result).toContain('🥇 <b>Статья 282 УК РФ</b>');
      expect(result).toContain('🥈 <b>Статья 205.1 УК РФ</b>');
      expect(result).toContain('🥉 <b>Статья 130 УК РФ</b>');
      expect(result).toContain('4. <b>Статья 228.1 УК РФ</b>');
      expect(result).toContain('5. <b>Статья 159 УК РФ</b>');
      expect(result).not.toContain('Статья 111');
      expect(result).not.toContain('Статья 222');
    });
  });

  describe('formatRiskLevel', () => {
    it('should format risk levels with appropriate emojis', () => {
      const lowRiskStats: UserStats = {
        userId: 'user123',
        chatId: 'chat456',
        totalViolations: 1,
        violationsByArticle: [],
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
        subarticle: null,
        articleTitle: '',
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
        subarticle: null,
        articleTitle: '',
        quote: '',
        punishment: '',
        severity: 1,
        confidence: 0.5
      };

      const result = formatter.formatViolation(emptyViolation);
      expect(result).toContain('<b>Неизвестная статья</b>'); // Empty article normalized
      expect(result).toContain('<i>&quot;&quot;</i>'); // Empty quote
    });

    it('should handle confidence exactly at threshold', () => {
      const thresholdViolation: Violation = {
        article: '282',
        subarticle: null,
        articleTitle: '',
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