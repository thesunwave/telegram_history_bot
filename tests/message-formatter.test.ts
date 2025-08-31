/**
 * Tests for MessageFormatter class
 * Enhanced with deterministic test data and better error reporting
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageFormatter, ViolationAnalysis } from '../src/message-formatter';
import { UserStats, PeriodStats, GeneralStats, ViolationCount, UserViolationCount, Violation } from '../src/models/statistics';
import { HTMLBuilder } from '../src/html-builder';
import { 
  MOCK_VIOLATIONS, 
  MOCK_VIOLATION_ANALYSIS, 
  MOCK_USER_STATS, 
  MOCK_PERIOD_STATS, 
  MOCK_GENERAL_STATS,
  EDGE_CASE_DATA,
  EXPECTED_OUTPUTS,
  MessageFormatterTestUtils,
  MockDateProvider
} from './fixtures/message-formatter-fixtures';

describe('MessageFormatter', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let formatter: MessageFormatter;
  let mockHtmlBuilder: HTMLBuilder;

  beforeEach(() => {
    mockHtmlBuilder = new HTMLBuilder();
    formatter = new MessageFormatter(mockHtmlBuilder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('getSeverityEmoji', () => {

    it('should return green emoji for low severity (1-3)', () => {
      expect(formatter.getSeverityEmoji(1)).toBe('🟢');
      expect(formatter.getSeverityEmoji(2)).toBe('🟢');
      expect(formatter.getSeverityEmoji(3)).toBe('🟢');
    }, testTimeout);

    it('should return yellow emoji for medium severity (4-6)', () => {
      expect(formatter.getSeverityEmoji(4)).toBe('🟡');
      expect(formatter.getSeverityEmoji(5)).toBe('🟡');
      expect(formatter.getSeverityEmoji(6)).toBe('🟡');
    }, testTimeout);

    it('should return red emoji for high severity (7-10)', () => {
      expect(formatter.getSeverityEmoji(7)).toBe('🔴');
      expect(formatter.getSeverityEmoji(8)).toBe('🔴');
      expect(formatter.getSeverityEmoji(9)).toBe('🔴');
      expect(formatter.getSeverityEmoji(10)).toBe('🔴');
    }, testTimeout);

    it('should handle invalid severity values gracefully', () => {
      // The implementation uses graceful handling instead of throwing errors
      expect(formatter.getSeverityEmoji(0)).toBe('🟢'); // Defaults to low
      expect(formatter.getSeverityEmoji(11)).toBe('🔴'); // Clamped to high
      expect(formatter.getSeverityEmoji(-1)).toBe('🟢'); // Clamped to low
      expect(formatter.getSeverityEmoji(NaN)).toBe('🟢'); // Defaults to low
    }, testTimeout);
  }, testTimeout);

  describe('escapeHtml', () => {

    it('should escape HTML special characters', () => {
      // The implementation escapes forward slashes as &#x2F;
      expect(formatter.escapeHtml('<script>alert("test")</script>')).toBe('&lt;script&gt;alert(&quot;test&quot;)&lt;&#x2F;script&gt;');
      expect(formatter.escapeHtml('Test & Co')).toBe('Test &amp; Co');
      expect(formatter.escapeHtml("It's a test")).toBe('It&#x27;s a test');
    }, testTimeout);

    it('should handle empty strings', () => {
      expect(formatter.escapeHtml('')).toBe('');
    }, testTimeout);

    it('should handle null and undefined values', () => {
      expect(formatter.escapeHtml(null)).toBe('');
      expect(formatter.escapeHtml(undefined)).toBe('');
    }, testTimeout);

    it('should escape additional special characters', () => {
      expect(formatter.escapeHtml('=')).toBe('&#x3D;');
      expect(formatter.escapeHtml('/')).toBe('&#x2F;');
    }, testTimeout);
  }, testTimeout);

  describe('formatViolation', () => {

    it('should format violation with all required information', () => {
      const result = formatter.formatViolation(MOCK_VIOLATIONS.simple);
      
      expect(result).toContain('🔴'); // High severity emoji
      expect(result).toContain('<b>Статья 282 УК РФ</b>'); // Without subarticle
      expect(result).toContain('<b>Цитата из текста:</b>');
      expect(result).toContain('<i>&quot;Тестовая цитата с нарушением&quot;</i>');
      expect(result).toContain('<b>Наказание:</b>');
      expect(result).toContain('штраф в размере до трехсот тысяч рублей');
      expect(result).toContain('<b>Уровень серьезности:</b> 7/10 🔴');
      expect(result).toContain('<b>Уровень доверия:</b> 85%');
    }, testTimeout);

    it('should format violation with subarticle correctly', () => {
      const result = formatter.formatViolation(MOCK_VIOLATIONS.withSubarticle);
      
      expect(result).toContain('<b>Статья 282.1 УК РФ</b>'); // With subarticle
      expect(result).toContain('🔴'); // High severity emoji
    }, testTimeout);

    it('should add confidence warning for low confidence', () => {
      const result = formatter.formatViolation(MOCK_VIOLATIONS.lowConfidence);
      expect(result).toContain('⚠️');
      expect(result).toContain('<i>Низкий уровень доверия к анализу</i>');
    }, testTimeout);

    it('should not add confidence warning for high confidence', () => {
      const result = formatter.formatViolation(MOCK_VIOLATIONS.simple);
      expect(result).not.toContain('⚠️');
      expect(result).not.toContain('Низкий уровень доверия');
    }, testTimeout);

    it('should handle different severity levels correctly', () => {
      const result = formatter.formatViolation(MOCK_VIOLATIONS.lowSeverity);
      expect(result).toContain('🟢'); // Low severity emoji
      expect(result).toContain('2/10 🟢');
    }, testTimeout);

    it('should handle special characters in quotes', () => {
      const result = formatter.formatViolation(MOCK_VIOLATIONS.withSpecialChars);
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;');
      expect(result).not.toContain('<script>');
    }, testTimeout);

    it('should handle empty violation data gracefully', () => {
      const result = formatter.formatViolation(MOCK_VIOLATIONS.empty);
      expect(result).toContain('<b>Неизвестная статья</b>'); // Empty article normalized
      expect(result).toContain('<i>&quot;&quot;</i>'); // Empty quote
    }, testTimeout);
  }, testTimeout);

  describe('formatViolationAnalysis', () => {

    it('should return no violations message when no violations found', () => {
      const result = formatter.formatViolationAnalysis(MOCK_VIOLATION_ANALYSIS.noViolations);
      expect(result).toBe(EXPECTED_OUTPUTS.noViolations);
    }, testTimeout);

    it('should format single violation analysis', () => {
      const result = formatter.formatViolationAnalysis(MOCK_VIOLATION_ANALYSIS.singleViolation);
      expect(result).toContain('🚨 <b>Обнаружены нарушения УК РФ</b>');
      expect(result).toContain('Статья 282 УК РФ');
      expect(result).toContain('<b>Всего нарушений:</b> 1');
      expect(result).toContain('<b>Общий уровень серьезности:</b> 7');
      expect(result).toContain('<b>Уровень риска:</b> 🟡 Средний');
    }, testTimeout);

    it('should format multiple violations with separators', () => {
      const result = formatter.formatViolationAnalysis(MOCK_VIOLATION_ANALYSIS.multipleViolations);
      expect(result).toContain('━━━━━━━━━━━━━━━━━━━━'); // Separator
      expect(result).toContain('Статья 282 УК РФ');
      expect(result).toContain('Статья 205 УК РФ');
      expect(result).toContain('<b>Всего нарушений:</b> 2');
      expect(result).toContain('<b>Общий уровень серьезности:</b> 16');
      expect(result).toContain('<b>Уровень риска:</b> 🔴 Высокий');
    }, testTimeout);

    it('should handle empty violations array', () => {
      const emptyAnalysis = { ...MOCK_VIOLATION_ANALYSIS.singleViolation, violations: [] };
      const result = formatter.formatViolationAnalysis(emptyAnalysis);
      expect(result).toBe(EXPECTED_OUTPUTS.noViolations);
    }, testTimeout);
  }, testTimeout);

  describe('formatUserStats', () => {

    it('should format user statistics correctly', () => {
      const result = formatter.formatUserStats(MOCK_USER_STATS);
      
      expect(result).toContain('📊 <b>Статистика пользователя</b>');
      expect(result).toContain('<b>Всего нарушений:</b> 5');
      expect(result).toContain('<b>Средняя серьезность:</b> 6.2/10');
      expect(result).toContain('<b>Уровень риска:</b> 🟡 Средний');
      expect(result).toContain('<b>Последнее нарушение:</b> 15.01.2024');
      expect(result).toContain('<b>Наиболее частое нарушение:</b> 282');
    }, testTimeout);

    it('should format violations by article in descending order', () => {
      const result = formatter.formatUserStats(MOCK_USER_STATS);
      
      expect(result).toContain('<b>Нарушения по статьям УК РФ:</b>');
      expect(result).toContain('• <b>Статья 282 УК РФ</b> 3 раз 🟡 (ср. 6.5)');
      expect(result).toContain('• <b>Статья 205.1 УК РФ</b> 2 раз 🔴 (ср. 8.0)');
      
      // Check that 282 (3 violations) comes before 205.1 (2 violations)
      const index282 = result.indexOf('• <b>Статья 282 УК РФ</b> 3 раз');
      const index205 = result.indexOf('• <b>Статья 205.1 УК РФ</b> 2 раз');
      expect(index282).toBeLessThan(index205);
    }, testTimeout);

    it('should display article titles and punishments for violations', () => {
      const result = formatter.formatUserStats(MOCK_USER_STATS);
      
      // Check that article titles are displayed
      expect(result).toContain('<i>Возбуждение ненависти либо вражды</i>');
      expect(result).toContain('<i>Терроризм</i>');
      
      // Check that punishments are displayed
      expect(result).toContain('<b>Наказание:</b> штраф в размере до трехсот тысяч рублей');
      expect(result).toContain('<b>Наказание:</b> лишение свободы на срок до 15 лет');
    }, testTimeout);

    it('should handle empty violations by article', () => {
      const result = formatter.formatUserStats(EDGE_CASE_DATA.emptyUserStats);
      expect(result).toContain('<i>У пользователя пока нет нарушений</i>');
    }, testTimeout);

    it('should handle null stats gracefully', () => {
      const result = formatter.formatUserStats(EDGE_CASE_DATA.nullStats);
      expect(result).toContain('❌ <b>Ошибка: данные статистики недоступны</b>');
    }, testTimeout);
  });

  describe('formatPeriodStats', () => {

    it('should format period statistics correctly', () => {
      const result = formatter.formatPeriodStats(MOCK_PERIOD_STATS);
      
      expect(result).toContain('📈 <b>Статистика за период</b>');
      expect(result).toContain('<b>Период:</b> 01.01.2024 - 31.01.2024');
      expect(result).toContain('<b>Всего нарушений:</b> 15');
      expect(result).toContain('<b>Уникальных пользователей:</b> 7');
      expect(result).toContain('<b>Средняя серьезность:</b> 5.8/10');
    }, testTimeout);

    it('should show increase trends correctly', () => {
      const result = formatter.formatPeriodStats(MOCK_PERIOD_STATS);
      
      expect(result).toContain('📈 <b>Изменение количества:</b> увеличение на 15.5%');
      expect(result).toContain('⬇️ <b>Изменение серьезности:</b> снижение на 0.5');
      expect(result).toContain('👥📈 <b>Изменение пользователей:</b> увеличение на 12.0%');
    }, testTimeout);

    it('should show decrease trends correctly', () => {
      const statsWithDecrease = MessageFormatterTestUtils.createPeriodStats({
        comparisonWithPreviousPeriod: {
          violationsChange: -8.5,
          severityChange: 1.2,
          usersChange: -5.0
        }
      });

      const result = formatter.formatPeriodStats(statsWithDecrease);
      
      expect(result).toContain('📉 <b>Изменение количества:</b> уменьшение на 8.5%');
      expect(result).toContain('⬆️ <b>Изменение серьезности:</b> повышение на 1.2');
      expect(result).toContain('👥📉 <b>Изменение пользователей:</b> уменьшение на 5.0%');
    }, testTimeout);

    it('should not show trends when there are no changes', () => {
      const statsWithoutChanges = MessageFormatterTestUtils.createPeriodStats({
        comparisonWithPreviousPeriod: {
          violationsChange: 0,
          severityChange: 0,
          usersChange: 0
        }
      });

      const result = formatter.formatPeriodStats(statsWithoutChanges);
      
      expect(result).not.toContain('Изменение количества');
      expect(result).not.toContain('Изменение серьезности');
      expect(result).not.toContain('Изменение пользователей');
    }, testTimeout);



    it('should display article titles and punishments in period stats', () => {
      const result = formatter.formatPeriodStats(MOCK_PERIOD_STATS);
      
      // Check that article titles are displayed
      expect(result).toContain('<i>Возбуждение ненависти либо вражды</i>');
      expect(result).toContain('<i>Терроризм</i>');
      expect(result).toContain('<i>Оскорбление</i>');
      
      // Check that punishments are displayed
      expect(result).toContain('<b>Наказание:</b> штраф в размере до трехсот тысяч рублей');
      expect(result).toContain('<b>Наказание:</b> лишение свободы на срок до 15 лет');
      expect(result).toContain('<b>Наказание:</b> штраф в размере до сорока тысяч рублей');
    }, testTimeout);

    it('should handle empty period stats', () => {
      const result = formatter.formatPeriodStats(EDGE_CASE_DATA.emptyPeriodStats);
      expect(result).toContain('<i>За указанный период нарушений не зафиксировано</i>');
    }, testTimeout);

    it('should handle null period stats', () => {
      const result = formatter.formatPeriodStats(EDGE_CASE_DATA.nullStats);
      expect(result).toContain('❌ <b>Ошибка: данные статистики за период недоступны</b>');
    }, testTimeout);
  });

  describe('formatGeneralStats', () => {

    it('should format general statistics correctly', () => {
      const result = formatter.formatGeneralStats(MOCK_GENERAL_STATS);
      
      expect(result).toContain('📊 <b>Общая статистика чата</b>');
      expect(result).toContain('<b>Всего нарушений:</b> 50');
      expect(result).toContain('<b>Средняя серьезность:</b> 6.8/10');
      expect(result).toContain('<b>Общий уровень риска:</b> 🔴 Высокий');
    }, testTimeout);

    it('should format top 5 violations with position emojis', () => {
      const result = formatter.formatGeneralStats(MOCK_GENERAL_STATS);
      
      expect(result).toContain('<b>🏆 Топ-5 самых частых нарушений:</b>');
      expect(result).toContain('🥇 <b>Статья 282 УК РФ</b> 20 раз 🟡 (ср. 6.5)');
      expect(result).toContain('🥈 <b>Статья 205.1 УК РФ</b> 15 раз 🔴 (ср. 8.8)');
      expect(result).toContain('🥉 <b>Статья 130 УК РФ</b> 10 раз 🟡 (ср. 4.2)');
      expect(result).toContain('4. <b>Статья 228.1 УК РФ</b> 3 раз 🔴 (ср. 7.0)');
      expect(result).toContain('5. <b>Статья 159 УК РФ</b> 2 раз 🟡 (ср. 5.5)');
    }, testTimeout);

    it('should display article titles and punishments in general stats top violations', () => {
      const result = formatter.formatGeneralStats(MOCK_GENERAL_STATS);
      
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
    }, testTimeout);

    it('should format top 5 users with usernames and risk levels', () => {
      const result = formatter.formatGeneralStats(MOCK_GENERAL_STATS);
      
      expect(result).toContain('<b>👤 Топ-5 пользователей с наибольшим количеством нарушений:</b>');
      expect(result).toContain('🥇 <b>@baduser1</b>: 12 нарушений, риск: 🔴 Высокий (ср. 7.2)');
      expect(result).toContain('🥈 <b>@baduser2</b>: 8 нарушений, риск: 🟡 Средний (ср. 5.5)');
      expect(result).toContain('🥉 <b>ID: user3</b>: 6 нарушений, риск: 🟢 Низкий (ср. 4.0)');
      expect(result).toContain('4. <b>@baduser4</b>: 4 нарушения, риск: 🟡 Средний (ср. 6.8)');
      expect(result).toContain('5. <b>ID: user5</b>: 3 нарушения, риск: 🟢 Низкий (ср. 3.2)');
    }, testTimeout);

    it('should format critical violations section', () => {
      const result = formatter.formatGeneralStats(MOCK_GENERAL_STATS);
      
      expect(result).toContain('🚨 <b>Критические нарушения (серьезность ≥ 8):</b>');
      expect(result).toContain('🔴 <b>Статья 205 УК РФ</b> серьезность 9/10');
      expect(result).toContain('<i>&quot;Очень серьезное нарушение с высокой степенью опасности для общества&quot;</i>');
      expect(result).toContain('🔴 <b>Статья 282 УК РФ</b> серьезность 8/10');
      expect(result).toContain('<i>&quot;Еще одно критическое нарушение&quot;</i>');
    }, testTimeout);

    it('should truncate long quotes in critical violations', () => {
      const statsWithLongQuote = MessageFormatterTestUtils.createGeneralStats({
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
      });

      const result = formatter.formatGeneralStats(statsWithLongQuote);
      
      expect(result).toContain('Это очень длинная цитата которая должна быть обрезана потому что она превышает лимит в сто символов ...');
      expect(result).not.toContain('слишком длинным для удобного чтения');
    }, testTimeout);

    it('should handle empty sections gracefully', () => {
      const result = formatter.formatGeneralStats(EDGE_CASE_DATA.emptyGeneralStats);
      
      expect(result).toContain('📊 <b>Общая статистика чата</b>');
      expect(result).toContain('<b>Всего нарушений:</b> 0');
      expect(result).toContain('<i>В чате пока не зафиксировано нарушений</i>');
    }, testTimeout);

    it('should limit to top 5 even if more data is provided', () => {
      const statsWithManyViolations = MessageFormatterTestUtils.createGeneralStats({
        topViolations: [
          ...MOCK_GENERAL_STATS.topViolations,
          { article: '111', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 1, averageSeverity: 3.0 },
          { article: '222', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 1, averageSeverity: 2.0 }
        ]
      });

      const result = formatter.formatGeneralStats(statsWithManyViolations);
      
      // Should only show first 5
      expect(result).toContain('🥇 <b>Статья 282 УК РФ</b>');
      expect(result).toContain('🥈 <b>Статья 205.1 УК РФ</b>');
      expect(result).toContain('🥉 <b>Статья 130 УК РФ</b>');
      expect(result).toContain('4. <b>Статья 228.1 УК РФ</b>');
      expect(result).toContain('5. <b>Статья 159 УК РФ</b>');
      expect(result).not.toContain('Статья 111');
      expect(result).not.toContain('Статья 222');
    }, testTimeout);

    it('should handle null general stats', () => {
      const result = formatter.formatGeneralStats(EDGE_CASE_DATA.nullStats);
      expect(result).toContain('❌ <b>Ошибка: данные общей статистики недоступны</b>');
    }, testTimeout);
  });

  describe('formatRiskLevel', () => {

    it('should format risk levels with appropriate emojis', () => {
      const lowRiskStats = MessageFormatterTestUtils.createUserStats({ riskLevel: 'low' });
      const mediumRiskStats = MessageFormatterTestUtils.createUserStats({ riskLevel: 'medium' });
      const highRiskStats = MessageFormatterTestUtils.createUserStats({ riskLevel: 'high' });

      expect(formatter.formatUserStats(lowRiskStats)).toContain('🟢 Низкий');
      expect(formatter.formatUserStats(mediumRiskStats)).toContain('🟡 Средний');
      expect(formatter.formatUserStats(highRiskStats)).toContain('🔴 Высокий');
    }, testTimeout);
  });

  describe('edge cases', () => {

    it('should handle confidence exactly at threshold', () => {
      const thresholdViolation = MessageFormatterTestUtils.createViolation({ confidence: 0.7 });
      const result = formatter.formatViolation(thresholdViolation);
      expect(result).not.toContain('⚠️'); // Should not show warning at exactly 70%
    }, testTimeout);

    it('should handle extreme severity values', () => {
      const extremeViolation = MessageFormatterTestUtils.createViolation({ severity: 100 });
      const result = formatter.formatViolation(extremeViolation);
      expect(result).toContain('🔴'); // Should clamp to high severity
    }, testTimeout);

    it('should handle negative confidence values', () => {
      const negativeConfidenceViolation = MessageFormatterTestUtils.createViolation({ confidence: -0.5 });
      const result = formatter.formatViolation(negativeConfidenceViolation);
      expect(result).toContain('⚠️'); // Should show warning for negative confidence
    }, testTimeout);

    it('should handle very long article names', () => {
      const longArticleViolation = MessageFormatterTestUtils.createViolation({ 
        article: '282.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15' 
      });
      const result = formatter.formatViolation(longArticleViolation);
      expect(result).toContain('Статья 282.1.2.3.4.5.6.7.8.9.10.11.12.13.14.15 УК РФ');
    }, testTimeout);
  });
});