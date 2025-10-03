/**
 * Advanced test utilities for MessageFormatter testing
 * Provides deterministic data generation, mocking utilities, and test helpers
 */

import { vi } from 'vitest';
import { Violation, ViolationAnalysis } from '../../src/message-formatter';
import { UserStats, PeriodStats, GeneralStats } from '../../src/models/statistics';

/**
 * Deterministic date generator for consistent test results
 */
export class DeterministicDateGenerator {
  private static baseDate = new Date('2024-01-15T10:30:00Z');
  private static counter = 0;

  /**
   * Gets a deterministic date that increments by days
   */
  static getNextDate(): Date {
    const date = new Date(this.baseDate);
    date.setDate(date.getDate() + this.counter);
    this.counter++;
    return date;
  }

  /**
   * Resets the counter for fresh test runs
   */
  static reset(): void {
    this.counter = 0;
  }

  /**
   * Gets a specific date offset from base
   */
  static getDateOffset(days: number): Date {
    const date = new Date(this.baseDate);
    date.setDate(date.getDate() + days);
    return date;
  }

  /**
   * Gets a date range for period testing
   */
  static getDateRange(startOffset: number, endOffset: number): { start: Date; end: Date } {
    return {
      start: this.getDateOffset(startOffset),
      end: this.getDateOffset(endOffset)
    };
  }
}

/**
 * Mock data factory for creating consistent test data
 */
export class MockDataFactory {
  /**
   * Creates a violation with predictable data
   */
  static createViolation(overrides: Partial<Violation> = {}): Violation {
    return {
      article: '282',
      subarticle: null,
      articleTitle: 'Возбуждение ненависти либо вражды',
      quote: 'Тестовая цитата с нарушением',
      punishment: 'штраф в размере до трехсот тысяч рублей',
      severity: 7,
      confidence: 0.85,
      ...overrides
    };
  }

  /**
   * Creates multiple violations with incremental data
   */
  static createViolations(count: number, baseOverrides: Partial<Violation> = {}): Violation[] {
    const articles = ['282', '205', '130', '228', '159'];
    const severities = [3, 5, 7, 8, 9];
    const confidences = [0.6, 0.7, 0.8, 0.85, 0.9];

    return Array.from({ length: count }, (_, index) => ({
      article: articles[index % articles.length],
      subarticle: index % 2 === 0 ? null : '1',
      articleTitle: `Статья ${articles[index % articles.length]}`,
      quote: `Тестовая цитата ${index + 1}`,
      punishment: `Наказание ${index + 1}`,
      severity: severities[index % severities.length],
      confidence: confidences[index % confidences.length],
      ...baseOverrides
    }));
  }

  /**
   * Creates violation analysis with predictable data
   */
  static createViolationAnalysis(overrides: Partial<ViolationAnalysis> = {}): ViolationAnalysis {
    const violations = overrides.violations || [this.createViolation()];
    const totalSeverity = violations.reduce((sum, v) => sum + v.severity, 0);
    
    return {
      hasViolations: violations.length > 0,
      violations,
      totalSeverity,
      riskLevel: totalSeverity > 15 ? 'high' : totalSeverity > 8 ? 'medium' : 'low',
      analysisTimestamp: DeterministicDateGenerator.getNextDate().toISOString(),
      ...overrides
    };
  }

  /**
   * Creates user stats with predictable data
   */
  static createUserStats(overrides: Partial<UserStats> = {}): UserStats {
    return {
      userId: 'test-user-123',
      chatId: 'test-chat-456',
      totalViolations: 5,
      violationsByArticle: [
        { 
          article: '282', 
          subarticle: null, 
          articleTitle: 'Возбуждение ненависти либо вражды', 
          punishment: 'штраф в размере до трехсот тысяч рублей', 
          count: 3, 
          averageSeverity: 6.5 
        },
        { 
          article: '205', 
          subarticle: '1', 
          articleTitle: 'Терроризм', 
          punishment: 'лишение свободы на срок до 15 лет', 
          count: 2, 
          averageSeverity: 8.0 
        }
      ],
      averageSeverity: 6.2,
      riskLevel: 'medium',
      lastViolationDate: DeterministicDateGenerator.getNextDate(),
      mostCommonViolation: '282',
      ...overrides
    };
  }

  /**
   * Creates period stats with predictable data
   */
  static createPeriodStats(overrides: Partial<PeriodStats> = {}): PeriodStats {
    const dateRange = DeterministicDateGenerator.getDateRange(-30, 0);
    
    return {
      chatId: 'test-chat-456',
      startDate: dateRange.start,
      endDate: dateRange.end,
      totalViolations: 15,
      violationsByArticle: [
        { 
          article: '282', 
          subarticle: null, 
          articleTitle: 'Возбуждение ненависти либо вражды', 
          punishment: 'штраф в размере до трехсот тысяч рублей', 
          count: 8, 
          averageSeverity: 5.5 
        },
        { 
          article: '205', 
          subarticle: '1', 
          articleTitle: 'Терроризм', 
          punishment: 'лишение свободы на срок до 15 лет', 
          count: 4, 
          averageSeverity: 8.2 
        },
        { 
          article: '130', 
          subarticle: null, 
          articleTitle: 'Оскорбление', 
          punishment: 'штраф в размере до сорока тысяч рублей', 
          count: 3, 
          averageSeverity: 4.0 
        }
      ],
      averageSeverity: 5.8,
      uniqueUsers: 7,
      comparisonWithPreviousPeriod: {
        violationsChange: 15.5,
        severityChange: -0.5,
        usersChange: 12.0
      },
      ...overrides
    };
  }

  /**
   * Creates general stats with predictable data
   */
  static createGeneralStats(overrides: Partial<GeneralStats> = {}): GeneralStats {
    return {
      chatId: 'test-chat-456',
      totalViolations: 50,
      topViolations: [
        { 
          article: '282', 
          subarticle: null, 
          articleTitle: 'Возбуждение ненависти либо вражды', 
          punishment: 'штраф в размере до трехсот тысяч рублей', 
          count: 20, 
          averageSeverity: 6.5 
        },
        { 
          article: '205', 
          subarticle: '1', 
          articleTitle: 'Терроризм', 
          punishment: 'лишение свободы на срок до 15 лет', 
          count: 15, 
          averageSeverity: 8.8 
        },
        { 
          article: '130', 
          subarticle: null, 
          articleTitle: 'Оскорбление', 
          punishment: 'штраф в размере до сорока тысяч рублей', 
          count: 10, 
          averageSeverity: 4.2 
        }
      ],
      topUsers: [
        { userId: 'user1', username: 'testuser1', count: 12, averageSeverity: 7.2, riskLevel: 'high' },
        { userId: 'user2', username: 'testuser2', count: 8, averageSeverity: 5.5, riskLevel: 'medium' },
        { userId: 'user3', count: 6, averageSeverity: 4.0, riskLevel: 'low' }
      ],
      overallRiskLevel: 'high',
      averageSeverity: 6.8,
      criticalViolations: [
        {
          article: '205',
          subarticle: null,
          articleTitle: 'Терроризм',
          quote: 'Критическое нарушение высокой степени опасности',
          punishment: 'лишение свободы на срок до 15 лет',
          severity: 9,
          confidence: 0.95
        }
      ],
      ...overrides
    };
  }
}

/**
 * Mock providers for external dependencies
 */
export class MockProviders {
  /**
   * Creates a mock HTMLBuilder with predictable output
   */
  static createMockHTMLBuilder() {
    return {
      bold: vi.fn((text: string) => `<b>${text}</b>`),
      italic: vi.fn((text: string) => `<i>${text}</i>`),
      underline: vi.fn((text: string) => `<u>${text}</u>`),
      code: vi.fn((text: string) => `<code>${text}</code>`),
      pre: vi.fn((text: string) => `<pre>${text}</pre>`),
      link: vi.fn((text: string, url: string) => `<a href="${url}">${text}</a>`),
      escapeHtml: vi.fn((text: string) => text.replace(/[<>&"']/g, (char) => {
        const entities: Record<string, string> = {
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&#x27;'
        };
        return entities[char] || char;
      }))
    };
  }

  /**
   * Creates a mock date formatter with consistent output
   */
  static createMockDateFormatter() {
    return {
      formatDate: vi.fn((date: Date) => {
        if (!date || !(date instanceof Date)) return 'неизвестно';
        return date.toLocaleDateString('ru-RU');
      }),
      formatDateTime: vi.fn((date: Date) => {
        if (!date || !(date instanceof Date)) return 'неизвестно';
        return date.toLocaleString('ru-RU');
      })
    };
  }
}

/**
 * Test assertion helpers for MessageFormatter
 */
export class MessageFormatterAssertions {
  /**
   * Asserts that a message contains expected HTML structure
   */
  static assertHtmlStructure(message: string, expectedElements: string[]): void {
    expectedElements.forEach(element => {
      if (!message.includes(element)) {
        throw new Error(`Expected message to contain HTML element: ${element}\nActual message: ${message}`);
      }
    });
  }

  /**
   * Asserts that a message has proper emoji indicators
   */
  static assertEmojiIndicators(message: string, expectedEmojis: string[]): void {
    expectedEmojis.forEach(emoji => {
      if (!message.includes(emoji)) {
        throw new Error(`Expected message to contain emoji: ${emoji}\nActual message: ${message}`);
      }
    });
  }

  /**
   * Asserts that a message follows expected ordering
   */
  static assertOrdering(message: string, orderedElements: string[]): void {
    let lastIndex = -1;
    
    orderedElements.forEach((element, index) => {
      const currentIndex = message.indexOf(element);
      if (currentIndex === -1) {
        throw new Error(`Expected element not found: ${element}`);
      }
      if (currentIndex <= lastIndex) {
        throw new Error(`Element "${element}" should appear after "${orderedElements[index - 1]}" but appears at index ${currentIndex} vs ${lastIndex}`);
      }
      lastIndex = currentIndex;
    });
  }

  /**
   * Asserts that a message contains proper Russian text formatting
   */
  static assertRussianFormatting(message: string): void {
    // Check for proper Russian article formatting
    const articlePattern = /Статья \d+(\.\d+)? УК РФ/;
    if (message.includes('Статья') && !articlePattern.test(message)) {
      throw new Error(`Message contains improperly formatted Russian article reference: ${message}`);
    }

    // Check for proper risk level formatting
    const riskLevels = ['🟢 Низкий', '🟡 Средний', '🔴 Высокий'];
    const hasRiskLevel = riskLevels.some(level => message.includes(level));
    if (message.includes('риск') && !hasRiskLevel) {
      throw new Error(`Message contains improperly formatted risk level: ${message}`);
    }
  }

  /**
   * Asserts that a message is properly escaped for HTML
   */
  static assertHtmlSafety(message: string): void {
    // Check for unescaped HTML tags
    const dangerousPatterns = [
      /<script/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
      /javascript:/i,
      /on\w+\s*=/i
    ];

    dangerousPatterns.forEach(pattern => {
      if (pattern.test(message)) {
        throw new Error(`Message contains potentially dangerous HTML: ${message}`);
      }
    });

    // Check that quotes are properly escaped
    if (message.includes('"') && !message.includes('&quot;')) {
      throw new Error(`Message contains unescaped quotes: ${message}`);
    }
  }
}

/**
 * Performance testing utilities
 */
export class PerformanceTestUtils {
  /**
   * Measures the execution time of a function
   */
  static async measureExecutionTime<T>(fn: () => T | Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const end = performance.now();
    
    return {
      result,
      duration: end - start
    };
  }

  /**
   * Tests formatting performance with large datasets
   */
  static createLargeDataset(size: number) {
    return {
      violations: MockDataFactory.createViolations(size),
      userStats: MockDataFactory.createUserStats({
        totalViolations: size,
        violationsByArticle: Array.from({ length: Math.min(size, 20) }, (_, i) => ({
          article: `${200 + i}`,
          subarticle: null,
          articleTitle: `Test Article ${i}`,
          punishment: `Test Punishment ${i}`,
          count: Math.floor(Math.random() * 10) + 1,
          averageSeverity: Math.random() * 10
        }))
      }),
      generalStats: MockDataFactory.createGeneralStats({
        totalViolations: size,
        topViolations: Array.from({ length: Math.min(size, 10) }, (_, i) => ({
          article: `${300 + i}`,
          subarticle: null,
          articleTitle: `Top Article ${i}`,
          punishment: `Top Punishment ${i}`,
          count: Math.floor(Math.random() * 50) + 1,
          averageSeverity: Math.random() * 10
        }))
      })
    };
  }

  /**
   * Benchmarks formatting operations
   */
  static async benchmarkFormatting(formatter: any, iterations: number = 100) {
    const testData = this.createLargeDataset(50);
    const results: Record<string, number[]> = {
      formatViolation: [],
      formatUserStats: [],
      formatGeneralStats: []
    };

    for (let i = 0; i < iterations; i++) {
      // Test formatViolation
      const violationResult = await this.measureExecutionTime(() => 
        formatter.formatViolation(testData.violations[0])
      );
      results.formatViolation.push(violationResult.duration);

      // Test formatUserStats
      const userStatsResult = await this.measureExecutionTime(() => 
        formatter.formatUserStats(testData.userStats)
      );
      results.formatUserStats.push(userStatsResult.duration);

      // Test formatGeneralStats
      const generalStatsResult = await this.measureExecutionTime(() => 
        formatter.formatGeneralStats(testData.generalStats)
      );
      results.formatGeneralStats.push(generalStatsResult.duration);
    }

    // Calculate averages
    const averages = Object.entries(results).reduce((acc, [key, times]) => {
      acc[key] = times.reduce((sum, time) => sum + time, 0) / times.length;
      return acc;
    }, {} as Record<string, number>);

    return {
      averages,
      raw: results,
      iterations
    };
  }
}

/**
 * Snapshot testing utilities
 */
export class SnapshotTestUtils {
  /**
   * Normalizes a message for snapshot comparison
   */
  static normalizeForSnapshot(message: string): string {
    return message
      .replace(/\d{2}\.\d{2}\.\d{4}/g, 'DD.MM.YYYY') // Normalize dates
      .replace(/user\d+/g, 'userXXX') // Normalize user IDs
      .replace(/chat\d+/g, 'chatXXX') // Normalize chat IDs
      .replace(/\d+\.\d+%/g, 'XX.X%') // Normalize percentages
      .trim();
  }

  /**
   * Creates a snapshot-friendly version of test data
   */
  static createSnapshotData() {
    DeterministicDateGenerator.reset();
    
    return {
      violation: MockDataFactory.createViolation(),
      userStats: MockDataFactory.createUserStats(),
      periodStats: MockDataFactory.createPeriodStats(),
      generalStats: MockDataFactory.createGeneralStats()
    };
  }
}

/**
 * Main test utilities export
 */
export const MessageFormatterTestUtils = {
  MockDataFactory,
  MockProviders,
  DeterministicDateGenerator,
  MessageFormatterAssertions,
  PerformanceTestUtils,
  SnapshotTestUtils
};

export default MessageFormatterTestUtils;