/**
 * Test fixtures for MessageFormatter tests
 * Provides deterministic, consistent test data for reliable testing
 */

import { Violation, ViolationAnalysis } from '../../src/message-formatter';
import { UserStats, PeriodStats, GeneralStats } from '../../src/models/statistics';

/**
 * Fixed date for deterministic testing
 */
export const FIXED_DATE = new Date('2024-01-15T10:30:00Z');

/**
 * Fixed violation data for consistent testing
 */
export const MOCK_VIOLATIONS = {
  simple: {
    article: '282',
    subarticle: null,
    articleTitle: 'Возбуждение ненависти либо вражды',
    quote: 'Тестовая цитата с нарушением',
    punishment: 'штраф в размере до трехсот тысяч рублей',
    severity: 7,
    confidence: 0.85
  } as Violation,

  withSubarticle: {
    article: '282',
    subarticle: '1',
    articleTitle: 'Возбуждение ненависти либо вражды',
    quote: 'Тестовая цитата с нарушением',
    punishment: 'штраф в размере до трехсот тысяч рублей',
    severity: 7,
    confidence: 0.85
  } as Violation,

  lowConfidence: {
    article: '282',
    subarticle: null,
    articleTitle: 'Возбуждение ненависти либо вражды',
    quote: 'Тестовая цитата с нарушением',
    punishment: 'штраф в размере до трехсот тысяч рублей',
    severity: 7,
    confidence: 0.65
  } as Violation,

  lowSeverity: {
    article: '282',
    subarticle: null,
    articleTitle: 'Возбуждение ненависти либо вражды',
    quote: 'Тестовая цитата с нарушением',
    punishment: 'штраф в размере до трехсот тысяч рублей',
    severity: 2,
    confidence: 0.85
  } as Violation,

  highSeverity: {
    article: '205',
    subarticle: null,
    articleTitle: 'Терроризм',
    quote: 'Очень серьезное нарушение',
    punishment: 'лишение свободы на срок до 15 лет',
    severity: 9,
    confidence: 0.95
  } as Violation,

  withSpecialChars: {
    article: '282',
    subarticle: null,
    articleTitle: 'Возбуждение ненависти либо вражды',
    quote: 'Цитата с <script>alert("xss")</script> и & символами',
    punishment: 'штраф',
    severity: 5,
    confidence: 0.8
  } as Violation,

  empty: {
    article: '',
    subarticle: null,
    articleTitle: '',
    quote: '',
    punishment: '',
    severity: 1,
    confidence: 0.5
  } as Violation
};

/**
 * Fixed violation analysis data
 */
export const MOCK_VIOLATION_ANALYSIS = {
  noViolations: {
    hasViolations: false,
    violations: [],
    totalSeverity: 0,
    riskLevel: 'low' as const,
    analysisTimestamp: FIXED_DATE.toISOString()
  } as ViolationAnalysis,

  singleViolation: {
    hasViolations: true,
    violations: [MOCK_VIOLATIONS.simple],
    totalSeverity: 7,
    riskLevel: 'medium' as const,
    analysisTimestamp: FIXED_DATE.toISOString()
  } as ViolationAnalysis,

  multipleViolations: {
    hasViolations: true,
    violations: [MOCK_VIOLATIONS.simple, MOCK_VIOLATIONS.highSeverity],
    totalSeverity: 16,
    riskLevel: 'high' as const,
    analysisTimestamp: FIXED_DATE.toISOString()
  } as ViolationAnalysis
};

/**
 * Fixed user statistics data
 */
export const MOCK_USER_STATS: UserStats = {
  userId: 'user123',
  chatId: 'chat456',
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
  lastViolationDate: FIXED_DATE,
  mostCommonViolation: '282'
};

/**
 * Fixed period statistics data
 */
export const MOCK_PERIOD_STATS: PeriodStats = {
  chatId: 'chat456',
  startDate: new Date('2024-01-01T00:00:00Z'),
  endDate: new Date('2024-01-31T00:00:00Z'),
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
  }
};

/**
 * Fixed general statistics data
 */
export const MOCK_GENERAL_STATS: GeneralStats = {
  chatId: 'chat456',
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
    },
    { 
      article: '228', 
      subarticle: '1', 
      articleTitle: 'Незаконные приобретение, хранение, перевозка, изготовление, переработка наркотических средств', 
      punishment: 'лишение свободы на срок до трех лет', 
      count: 3, 
      averageSeverity: 7.0 
    },
    { 
      article: '159', 
      subarticle: null, 
      articleTitle: 'Мошенничество', 
      punishment: 'штраф в размере до ста двадцати тысяч рублей', 
      count: 2, 
      averageSeverity: 5.5 
    }
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
      subarticle: null,
      articleTitle: 'Возбуждение ненависти либо вражды',
      quote: 'Еще одно критическое нарушение',
      punishment: 'штраф или лишение свободы',
      severity: 8,
      confidence: 0.88
    }
  ]
};

/**
 * Test data variations for edge cases
 */
export const EDGE_CASE_DATA = {
  emptyUserStats: {
    ...MOCK_USER_STATS,
    totalViolations: 0,
    violationsByArticle: [],
    mostCommonViolation: undefined
  } as UserStats,

  emptyPeriodStats: {
    ...MOCK_PERIOD_STATS,
    totalViolations: 0,
    violationsByArticle: [],
    comparisonWithPreviousPeriod: {
      violationsChange: 0,
      severityChange: 0,
      usersChange: 0
    }
  } as PeriodStats,

  emptyGeneralStats: {
    chatId: 'chat456',
    totalViolations: 0,
    topViolations: [],
    topUsers: [],
    overallRiskLevel: 'low' as const,
    averageSeverity: 0,
    criticalViolations: []
  } as GeneralStats,

  nullStats: null as any,
  undefinedStats: undefined as any
};

/**
 * Expected output strings for deterministic testing
 */
export const EXPECTED_OUTPUTS = {
  noViolations: '✅ <b>Нарушений не обнаружено</b>',
  
  simpleViolationFormatted: `🔴 <b>Статья 282 УК РФ</b>

<b>Цитата из текста:</b>
<i>&quot;Тестовая цитата с нарушением&quot;</i>

<b>Наказание:</b>
штраф в размере до трехсот тысяч рублей

<b>Уровень серьезности:</b> 7/10 🔴
<b>Уровень доверия:</b> 85%`,

  lowConfidenceWarning: '⚠️ <i>Низкий уровень доверия к анализу</i>',
  
  htmlEscapedText: '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;',
  
  emptyArticleFormatted: '<b>Неизвестная статья</b>'
};

/**
 * Mock date provider for consistent date formatting in tests
 */
export class MockDateProvider {
  static formatDate(date: Date): string {
    return date.toLocaleDateString('ru-RU');
  }
  
  static getFixedDate(): Date {
    return new Date(FIXED_DATE);
  }
}

/**
 * Test utilities for MessageFormatter testing
 */
export const MessageFormatterTestUtils = {
  /**
   * Creates a violation with predictable data
   */
  createViolation(overrides: Partial<Violation> = {}): Violation {
    return { ...MOCK_VIOLATIONS.simple, ...overrides };
  },

  /**
   * Creates user stats with predictable data
   */
  createUserStats(overrides: Partial<UserStats> = {}): UserStats {
    return { ...MOCK_USER_STATS, ...overrides };
  },

  /**
   * Creates period stats with predictable data
   */
  createPeriodStats(overrides: Partial<PeriodStats> = {}): PeriodStats {
    return { ...MOCK_PERIOD_STATS, ...overrides };
  },

  /**
   * Creates general stats with predictable data
   */
  createGeneralStats(overrides: Partial<GeneralStats> = {}): GeneralStats {
    return { ...MOCK_GENERAL_STATS, ...overrides };
  },

  /**
   * Normalizes whitespace in strings for comparison
   */
  normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  },

  /**
   * Extracts lines from formatted text for easier testing
   */
  extractLines(text: string): string[] {
    return text.split('\n').map(line => line.trim());
  }
};