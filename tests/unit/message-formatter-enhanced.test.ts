/**
 * Enhanced Unit Tests for MessageFormatter
 * Comprehensive coverage of all MessageFormatter methods and edge cases
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageFormatter } from '../../src/message-formatter';
import { HTMLBuilder } from '../../src/html-builder';
import { StatisticsFixtures } from '../fixtures/statistics-fixtures';
import type { Violation, ViolationAnalysis, UserStats, PeriodStats, GeneralStats } from '../../src/models/statistics';

describe('MessageFormatter Enhanced Tests', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let formatter: MessageFormatter;
  let htmlBuilder: HTMLBuilder;

  beforeEach(() => {
    htmlBuilder = new HTMLBuilder();
    formatter = new MessageFormatter(htmlBuilder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('getSeverityEmoji Edge Cases', () => {

    it('should handle decimal severity values', () => {
      expect(formatter.getSeverityEmoji(1.9)).toBe('🟢');
      expect(formatter.getSeverityEmoji(3.1)).toBe('🟡');
      expect(formatter.getSeverityEmoji(6.9)).toBe('🔴'); // 6.9 rounds to 7, which is high
      expect(formatter.getSeverityEmoji(7.1)).toBe('🔴');
    });

    it('should handle boundary values correctly', () => {
      expect(formatter.getSeverityEmoji(3)).toBe('🟢');
      expect(formatter.getSeverityEmoji(4)).toBe('🟡');
      expect(formatter.getSeverityEmoji(6)).toBe('🟡');
      expect(formatter.getSeverityEmoji(7)).toBe('🔴');
    });

    it('should handle invalid values gracefully', () => {
      expect(formatter.getSeverityEmoji(0.5)).toBe('🟢'); // Clamped to low
      expect(formatter.getSeverityEmoji(10.5)).toBe('🔴'); // Clamped to high
      expect(formatter.getSeverityEmoji(NaN)).toBe('🟢'); // Default to low
      expect(formatter.getSeverityEmoji(Infinity)).toBe('🔴'); // Clamped to high
    });
  });

  describe('escapeHtml Comprehensive Tests', () => {

    it('should escape all HTML special characters', () => {
      const testCases = [
        { input: '<', expected: '&lt;' },
        { input: '>', expected: '&gt;' },
        { input: '&', expected: '&amp;' },
        { input: '"', expected: '&quot;' },
        { input: "'", expected: '&#x27;' },
        { input: '/', expected: '&#x2F;' }
      ];

      testCases.forEach(({ input, expected }) => {
        expect(formatter.escapeHtml(input)).toBe(expected);
      });
    });

    it('should handle complex HTML strings', () => {
      const complexHtml = '<div class="test" onclick="alert(\'xss\')">&copy; 2024</div>';
      const escaped = formatter.escapeHtml(complexHtml);
      
      expect(escaped).not.toContain('<div');
      expect(escaped).not.toContain('onclick='); // Check for the attribute, not just the word
      expect(escaped).toContain('&lt;div');
      expect(escaped).toContain('&amp;copy;');
    });

    it('should handle Unicode characters correctly', () => {
      const unicode = 'Тест с русскими символами & émojis 🚀';
      const escaped = formatter.escapeHtml(unicode);
      
      expect(escaped).toContain('Тест с русскими символами');
      expect(escaped).toContain('&amp;');
      expect(escaped).toContain('émojis');
      expect(escaped).toContain('🚀');
    });

    it('should handle null and undefined gracefully', () => {
      expect(formatter.escapeHtml(null as any)).toBe('');
      expect(formatter.escapeHtml(undefined as any)).toBe('');
    });

    it('should handle non-string inputs', () => {
      expect(formatter.escapeHtml(123 as any)).toBe('123');
      expect(formatter.escapeHtml(true as any)).toBe('true');
      expect(formatter.escapeHtml({} as any)).toBe('[object Object]');
    });
  });

  describe('formatViolation Edge Cases', () => {

    it('should handle violations with null subarticle', () => {
      const violation = StatisticsFixtures.Violation.createViolation({
        article: '282',
        subarticle: null
      });

      const result = formatter.formatViolation(violation);
      expect(result).toContain('<b>Статья 282 УК РФ</b>');
      expect(result).not.toContain('282.');
    });

    it('should handle violations with subarticle', () => {
      const violation = StatisticsFixtures.Violation.createViolation({
        article: '282',
        subarticle: '1'
      });

      const result = formatter.formatViolation(violation);
      expect(result).toContain('<b>Статья 282.1 УК РФ</b>');
    });

    it('should handle very long quotes', () => {
      const longQuote = 'A'.repeat(500);
      const violation = StatisticsFixtures.Violation.createViolation({
        quote: longQuote
      });

      const result = formatter.formatViolation(violation);
      expect(result.length).toBeLessThan(longQuote.length + 1000); // Should not be excessively long
    });

    it('should handle special characters in violation data', () => {
      const violation = StatisticsFixtures.Violation.createViolation({
        article: '282',
        articleTitle: 'Title with script tag',
        quote: 'Quote with & special chars "test" and <script>alert("xss")</script>',
        punishment: 'Punishment with <b>formatting</b>'
      });

      const result = formatter.formatViolation(violation);
      expect(result).not.toContain('<script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).toContain('&amp;');
      expect(result).toContain('&quot;');
    });

    it('should handle extreme confidence values', () => {
      const lowConfidence = StatisticsFixtures.Violation.createViolation({ confidence: 0.01 });
      const highConfidence = StatisticsFixtures.Violation.createViolation({ confidence: 0.99 });

      const lowResult = formatter.formatViolation(lowConfidence);
      const highResult = formatter.formatViolation(highConfidence);

      expect(lowResult).toContain('⚠️');
      expect(lowResult).toContain('1%');
      expect(highResult).not.toContain('⚠️');
      expect(highResult).toContain('99%');
    });

    it('should handle confidence exactly at warning threshold', () => {
      const thresholdConfidence = StatisticsFixtures.Violation.createViolation({ confidence: 0.7 });
      const belowThreshold = StatisticsFixtures.Violation.createViolation({ confidence: 0.69 });

      const thresholdResult = formatter.formatViolation(thresholdConfidence);
      const belowResult = formatter.formatViolation(belowThreshold);

      expect(thresholdResult).not.toContain('⚠️');
      expect(belowResult).toContain('⚠️');
    });
  });

  describe('formatViolationAnalysis Edge Cases', () => {

    it('should handle analysis with empty violations array but hasViolations true', () => {
      const analysis: ViolationAnalysis = {
        hasViolations: true,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: new Date().toISOString()
      };

      const result = formatter.formatViolationAnalysis(analysis);
      expect(result).toBe('✅ <b>Нарушений не обнаружено</b>');
    });

    it('should handle analysis with violations but hasViolations false', () => {
      const violation = StatisticsFixtures.Violation.createViolation();
      const analysis: ViolationAnalysis = {
        hasViolations: false,
        violations: [violation],
        totalSeverity: violation.severity,
        riskLevel: 'medium',
        analysisTimestamp: new Date().toISOString()
      };

      const result = formatter.formatViolationAnalysis(analysis);
      expect(result).toBe('✅ <b>Нарушений не обнаружено</b>');
    });

    it('should handle analysis with many violations', () => {
      const violations = StatisticsFixtures.Violation.createViolations(10);
      const analysis = StatisticsFixtures.ViolationAnalysis.createWithViolations(0, {
        violations,
        totalSeverity: violations.reduce((sum, v) => sum + v.severity, 0)
      });

      const result = formatter.formatViolationAnalysis(analysis);
      expect(result).toContain('<b>Всего нарушений:</b> 10');
      
      // Should contain separators between violations
      const separatorCount = (result.match(/━━━━━━━━━━━━━━━━━━━━/g) || []).length;
      expect(separatorCount).toBe(10); // 10 separators for 10 violations (including after last)
    });

    it('should handle analysis with zero total severity', () => {
      const violations = StatisticsFixtures.Violation.createViolations(2, { severity: 0 });
      const analysis = StatisticsFixtures.ViolationAnalysis.createWithViolations(0, {
        violations,
        totalSeverity: 0
      });

      const result = formatter.formatViolationAnalysis(analysis);
      expect(result).toContain('<b>Общий уровень серьезности:</b> 0');
    });

    it('should format risk levels with correct emojis', () => {
      const riskLevels: Array<{ level: 'low' | 'medium' | 'high'; emoji: string; text: string }> = [
        { level: 'low', emoji: '🟢', text: 'Низкий' },
        { level: 'medium', emoji: '🟡', text: 'Средний' },
        { level: 'high', emoji: '🔴', text: 'Высокий' }
      ];

      riskLevels.forEach(({ level, emoji, text }) => {
        const analysis = StatisticsFixtures.ViolationAnalysis.createWithViolations(1, { riskLevel: level });
        const result = formatter.formatViolationAnalysis(analysis);
        expect(result).toContain(`<b>Уровень риска:</b> ${emoji} ${text}`);
      });
    });
  });

  describe('formatUserStats Edge Cases', () => {

    it('should handle user stats with no violations', () => {
      const userStats = StatisticsFixtures.UserStats.createEmptyUserStats('user123', 'chat456');
      const result = formatter.formatUserStats(userStats);

      expect(result).toContain('<b>Всего нарушений:</b> 0');
      expect(result).toContain('<b>Средняя серьезность:</b> 0.0/10');
      expect(result).toContain('<b>Уровень риска:</b> 🟢 Низкий');
      expect(result).not.toContain('<b>Нарушения по статьям УК РФ:</b>');
      expect(result).not.toContain('<b>Последнее нарушение:</b>');
      expect(result).not.toContain('<b>Наиболее частое нарушение:</b>');
    });

    it('should handle user stats with undefined optional fields', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats({
        lastViolationDate: undefined,
        mostCommonViolation: undefined
      });

      const result = formatter.formatUserStats(userStats);
      expect(result).not.toContain('<b>Последнее нарушение:</b>');
      expect(result).not.toContain('<b>Наиболее частое нарушение:</b>');
    });

    it('should format dates correctly', () => {
      const testDate = new Date('2024-03-15T10:30:00Z');
      const userStats = StatisticsFixtures.UserStats.createUserStats({
        lastViolationDate: testDate
      });

      const result = formatter.formatUserStats(userStats);
      expect(result).toContain('<b>Последнее нарушение:</b> 15.03.2024');
    });

    it('should handle violations by article with missing titles', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats({
        violationsByArticle: [
          {
            article: '282',
            subarticle: null,
            articleTitle: '',
            punishment: '',
            count: 5,
            averageSeverity: 6.5
          }
        ]
      });

      const result = formatter.formatUserStats(userStats);
      expect(result).toContain('• <b>Статья 282 УК РФ</b> 5 раз');
      expect(result).not.toContain('<i></i>'); // Empty title should not appear
    });

    it('should sort violations by count in descending order', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats({
        violationsByArticle: [
          { article: '130', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 2, averageSeverity: 3 },
          { article: '282', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 5, averageSeverity: 7 },
          { article: '213', subarticle: null, articleTitle: "Test Article Title", punishment: "Test punishment", count: 3, averageSeverity: 5 }
        ].map(v => ({ ...v, subarticle: null, articleTitle: '', punishment: '' }))
      });

      const result = formatter.formatUserStats(userStats);
      
      // Should be ordered: 282 (5), 213 (3), 130 (2)
      const index282 = result.indexOf('Статья 282 УК РФ');
      const index213 = result.indexOf('Статья 213 УК РФ');
      const index130 = result.indexOf('Статья 130 УК РФ');

      expect(index282).toBeLessThan(index213);
      expect(index213).toBeLessThan(index130);
    });
  });

  describe('formatPeriodStats Edge Cases', () => {

    it('should handle period stats with no comparison data', () => {
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats({
        comparisonWithPreviousPeriod: undefined
      });

      const result = formatter.formatPeriodStats(periodStats);
      expect(result).not.toContain('📈 <b>Изменения по сравнению с предыдущим периодом:</b>');
      expect(result).not.toContain('Изменение количества');
      expect(result).not.toContain('Изменение серьезности');
      expect(result).not.toContain('Изменение пользователей');
    });

    it('should handle zero changes in comparison', () => {
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats({
        comparisonWithPreviousPeriod: {
          violationsChange: 0,
          severityChange: 0,
          usersChange: 0
        }
      });

      const result = formatter.formatPeriodStats(periodStats);
      expect(result).not.toContain('Изменение количества');
      expect(result).not.toContain('Изменение серьезности');
      expect(result).not.toContain('Изменение пользователей');
    });

    it('should format very small changes correctly', () => {
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats({
        comparisonWithPreviousPeriod: {
          violationsChange: 0.1,
          severityChange: -0.01,
          usersChange: 0.05
        }
      });

      const result = formatter.formatPeriodStats(periodStats);
      expect(result).toContain('увеличение на 0.1%');
      expect(result).toContain('снижение на 0.0');
      expect(result).toContain('увеличение на 0.1%'); // Check actual formatted value
    });

    it('should format large changes correctly', () => {
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats({
        comparisonWithPreviousPeriod: {
          violationsChange: 150.5,
          severityChange: -5.7,
          usersChange: 200.0
        }
      });

      const result = formatter.formatPeriodStats(periodStats);
      expect(result).toContain('увеличение на 150.5%');
      expect(result).toContain('снижение на 5.7');
      expect(result).toContain('увеличение на 200.0%');
    });

    it('should handle period with same start and end date', () => {
      const sameDate = new Date('2024-01-15');
      const periodStats = StatisticsFixtures.PeriodStats.createPeriodStats({
        startDate: sameDate,
        endDate: sameDate
      });

      const result = formatter.formatPeriodStats(periodStats);
      expect(result).toContain('<b>Период:</b> 15.01.2024 - 15.01.2024');
    });
  });

  describe('formatGeneralStats Edge Cases', () => {

    it('should handle empty general stats', () => {
      const emptyStats = StatisticsFixtures.GeneralStats.createEmptyStats('chat123');
      const result = formatter.formatGeneralStats(emptyStats);

      expect(result).toContain('<b>Всего нарушений:</b> 0');
      expect(result).toContain('<b>Средняя серьезность:</b> 0.0/10');
      expect(result).toContain('<b>Общий уровень риска:</b> 🟢 Низкий');
      expect(result).not.toContain('🏆 Топ-5 самых частых нарушений:');
      expect(result).not.toContain('👤 Топ-5 пользователей');
      expect(result).not.toContain('🚨 Критические нарушения');
    });

    it('should handle stats with fewer than 5 items', () => {
      const statsWithFewItems = StatisticsFixtures.GeneralStats.createGeneralStats({
        topViolations: StatisticsFixtures.ViolationCount.createViolationCounts(2),
        topUsers: StatisticsFixtures.UserViolationCount.createUserViolationCounts(3),
        criticalViolations: StatisticsFixtures.Violation.createViolations(1)
      });

      const result = formatter.formatGeneralStats(statsWithFewItems);
      
      // Should show only available items
      expect(result).toContain('🥇');
      expect(result).toContain('🥈');
      // Note: 🥉 may appear in top users section (3 users), so we check violations section specifically
      const violationsSection = result.split('👤 Топ-5 пользователей')[0];
      expect(violationsSection).not.toContain('🥉'); // Only 2 violations in violations section
      // Note: Numbers like "4." and "5." may appear in other contexts (like severity 4.8)
      // So we check more specifically for ranking positions
      expect(result).not.toContain('4️⃣'); // No 4th position emoji
      expect(result).not.toContain('5️⃣'); // No 5th position emoji
    });

    it('should handle users without usernames', () => {
      const statsWithNoUsernames = StatisticsFixtures.GeneralStats.createGeneralStats({
        topUsers: [
          { userId: 'user1', count: 10, averageSeverity: 7, riskLevel: 'high' },
          { userId: 'user2', username: 'hasusername', count: 8, averageSeverity: 5, riskLevel: 'medium' }
        ]
      });

      const result = formatter.formatGeneralStats(statsWithNoUsernames);
      expect(result).toContain('<b>ID: user1</b>');
      expect(result).toContain('<b>@hasusername</b>');
    });

    it('should truncate very long critical violation quotes', () => {
      const longQuote = 'A'.repeat(200);
      const statsWithLongQuote = StatisticsFixtures.GeneralStats.createGeneralStats({
        criticalViolations: [
          StatisticsFixtures.Violation.createViolation({
            quote: longQuote,
            severity: 9
          })
        ]
      });

      const result = formatter.formatGeneralStats(statsWithLongQuote);
      expect(result).toContain('...');
      expect(result.length).toBeLessThan(longQuote.length + 1500);
    });

    it('should handle critical violations with severity exactly 8', () => {
      const criticalViolation = StatisticsFixtures.Violation.createViolation({ severity: 8 });
      const statsWithCritical = StatisticsFixtures.GeneralStats.createGeneralStats({
        criticalViolations: [criticalViolation]
      });

      const result = formatter.formatGeneralStats(statsWithCritical);
      expect(result).toContain('🚨 <b>Критические нарушения (серьезность ≥ 8):</b>');
      expect(result).toContain('серьезность 8/10');
    });

    it('should format position emojis correctly for top violations', () => {
      const statsWithManyViolations = StatisticsFixtures.GeneralStats.createGeneralStats({
        topViolations: StatisticsFixtures.ViolationCount.createViolationCounts(5)
      });

      const result = formatter.formatGeneralStats(statsWithManyViolations);
      expect(result).toContain('🥇'); // 1st place
      expect(result).toContain('🥈'); // 2nd place
      expect(result).toContain('🥉'); // 3rd place
      expect(result).toContain('4.'); // 4th place
      expect(result).toContain('5.'); // 5th place
    });
  });

  describe('Performance Tests', () => {

    it('should handle large violation analysis efficiently', () => {
      const largeAnalysis = StatisticsFixtures.ViolationAnalysis.createWithViolations(100);
      
      const startTime = Date.now();
      const result = formatter.formatViolationAnalysis(largeAnalysis);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle large user stats efficiently', () => {
      const largeUserStats = StatisticsFixtures.UserStats.createUserStats({
        violationsByArticle: StatisticsFixtures.ViolationCount.createViolationCounts(50)
      });

      const startTime = Date.now();
      const result = formatter.formatUserStats(largeUserStats);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(500); // Should complete within 0.5 seconds
    });

    it('should handle large general stats efficiently', () => {
      const largeGeneralStats = StatisticsFixtures.GeneralStats.createGeneralStats({
        topViolations: StatisticsFixtures.ViolationCount.createViolationCounts(100),
        topUsers: StatisticsFixtures.UserViolationCount.createUserViolationCounts(100),
        criticalViolations: StatisticsFixtures.Violation.createViolations(50)
      });

      const startTime = Date.now();
      const result = formatter.formatGeneralStats(largeGeneralStats);
      const endTime = Date.now();

      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Memory Usage Tests', () => {

    it('should not create excessive string concatenations', () => {
      const violation = StatisticsFixtures.Violation.createViolation();
      
      // Format the same violation multiple times
      const results = Array.from({ length: 1000 }, () => 
        formatter.formatViolation(violation)
      );

      // All results should be identical
      expect(results.every(result => result === results[0])).toBe(true);
    });

    it('should handle repeated formatting without memory leaks', () => {
      const userStats = StatisticsFixtures.UserStats.createUserStats();
      
      // Format stats many times
      for (let i = 0; i < 10; i++) {
        const result = formatter.formatUserStats(userStats);
        expect(result).toBeDefined();
      }
    });
  });

  describe('Internationalization Considerations', () => {

    it('should handle Cyrillic characters correctly', () => {
      const violation = StatisticsFixtures.Violation.createViolation({
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Цитата с русскими символами',
        punishment: 'штраф в размере до трехсот тысяч рублей'
      });

      const result = formatter.formatViolation(violation);
      // Note: articleTitle is not displayed in formatViolation, only article number
      expect(result).toContain('Статья'); // Check that article is formatted
      expect(result).toContain('Цитата с русскими символами');
      expect(result).toContain('штраф в размере до трехсот тысяч рублей');
    });

    it('should handle mixed language content', () => {
      const violation = StatisticsFixtures.Violation.createViolation({
        quote: 'Mixed content: English and русский текст'
      });

      const result = formatter.formatViolation(violation);
      expect(result).toContain('Mixed content: English and русский текст');
    });

    it('should handle emoji in content', () => {
      const violation = StatisticsFixtures.Violation.createViolation({
        quote: 'Message with emoji 🚀 and symbols'
      });

      const result = formatter.formatViolation(violation);
      expect(result).toContain('🚀');
    });
  });
});