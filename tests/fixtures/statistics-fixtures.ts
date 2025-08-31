/**
 * Statistics Model Test Fixtures
 * Provides realistic test data generators for statistics models
 */

import type {
  Violation,
  ViolationAnalysis,
  ViolationCount,
  UserViolationCount,
  UserStats,
  PeriodComparison,
  PeriodStats,
  GeneralStats
} from '../../src/models/statistics';

/**
 * Generate realistic violation data
 */
export class ViolationFixtures {
  private static readonly ARTICLES = [
    { article: '282', title: 'Возбуждение ненависти либо вражды', punishment: 'штраф до 300 тысяч рублей', severity: 7 },
    { article: '213', title: 'Хулиганство', punishment: 'штраф до 500 тысяч рублей', severity: 5 },
    { article: '319', title: 'Оскорбление представителя власти', punishment: 'штраф до 40 тысяч рублей', severity: 4 },
    { article: '130', title: 'Оскорбление', punishment: 'штраф до 40 тысяч рублей', severity: 3 },
    { article: '148', title: 'Нарушение права на свободу совести', punishment: 'штраф до 300 тысяч рублей', severity: 6 },
    { article: '280', title: 'Публичные призывы к экстремистской деятельности', punishment: 'лишение свободы до 4 лет', severity: 8 },
    { article: '205', title: 'Терроризм', punishment: 'лишение свободы от 10 до 20 лет', severity: 10 },
    { article: '354', title: 'Публичные призывы к развязыванию агрессивной войны', punishment: 'лишение свободы до 5 лет', severity: 9 }
  ];

  private static readonly QUOTES = [
    'Призыв к насилию против определенной группы',
    'Оскорбительные высказывания в адрес власти',
    'Разжигание межнациональной розни',
    'Угрозы физической расправы',
    'Призывы к незаконным действиям',
    'Экстремистские высказывания',
    'Дискриминационные заявления',
    'Пропаганда насилия'
  ];

  /**
   * Create a realistic violation
   */
  static createViolation(overrides: Partial<Violation> = {}): Violation {
    const articleData = this.ARTICLES[Math.floor(Math.random() * this.ARTICLES.length)];
    const quote = this.QUOTES[Math.floor(Math.random() * this.QUOTES.length)];
    
    const rawSeverity = articleData.severity + Math.floor(Math.random() * 3) - 1;
    const severity = Math.max(1, Math.min(10, rawSeverity));
    
    return {
      article: articleData.article,
      subarticle: Math.random() > 0.7 ? `${Math.floor(Math.random() * 5) + 1}` : null,
      articleTitle: articleData.title,
      quote,
      punishment: articleData.punishment,
      severity,
      confidence: 0.6 + Math.random() * 0.4, // 0.6-1.0 range
      ...overrides
    };
  }

  /**
   * Create multiple violations
   */
  static createViolations(count: number, overrides: Partial<Violation> = {}): Violation[] {
    return Array.from({ length: count }, () => this.createViolation(overrides));
  }

  /**
   * Create a high-severity violation
   */
  static createCriticalViolation(overrides: Partial<Violation> = {}): Violation {
    const criticalArticles = this.ARTICLES.filter(a => a.severity >= 8);
    const articleData = criticalArticles[Math.floor(Math.random() * criticalArticles.length)];
    
    return this.createViolation({
      article: articleData.article,
      articleTitle: articleData.title,
      punishment: articleData.punishment,
      severity: Math.max(8, articleData.severity),
      confidence: 0.8 + Math.random() * 0.2,
      ...overrides
    });
  }

  /**
   * Create a low-severity violation
   */
  static createMinorViolation(overrides: Partial<Violation> = {}): Violation {
    const minorArticles = this.ARTICLES.filter(a => a.severity <= 4);
    const articleData = minorArticles[Math.floor(Math.random() * minorArticles.length)];
    
    return this.createViolation({
      article: articleData.article,
      articleTitle: articleData.title,
      punishment: articleData.punishment,
      severity: Math.min(4, articleData.severity),
      confidence: 0.5 + Math.random() * 0.3,
      ...overrides
    });
  }
}

/**
 * Generate realistic violation analysis data
 */
export class ViolationAnalysisFixtures {
  /**
   * Create a violation analysis with violations
   */
  static createWithViolations(violationCount: number = 3, overrides: Partial<ViolationAnalysis> = {}): ViolationAnalysis {
    const violations = ViolationFixtures.createViolations(violationCount);
    const totalSeverity = violations.reduce((sum, v) => sum + v.severity, 0);
    const averageSeverity = totalSeverity / violations.length;
    
    return {
      hasViolations: true,
      violations,
      totalSeverity,
      riskLevel: averageSeverity <= 3 ? 'low' : averageSeverity <= 6 ? 'medium' : 'high',
      analysisTimestamp: new Date().toISOString(),
      ...overrides
    };
  }

  /**
   * Create a violation analysis without violations
   */
  static createWithoutViolations(overrides: Partial<ViolationAnalysis> = {}): ViolationAnalysis {
    return {
      hasViolations: false,
      violations: [],
      totalSeverity: 0,
      riskLevel: 'low',
      analysisTimestamp: new Date().toISOString(),
      ...overrides
    };
  }

  /**
   * Create a high-risk analysis
   */
  static createHighRisk(overrides: Partial<ViolationAnalysis> = {}): ViolationAnalysis {
    const violations = [
      ViolationFixtures.createCriticalViolation(),
      ViolationFixtures.createCriticalViolation(),
      ViolationFixtures.createViolation({ severity: 7 })
    ];
    
    return this.createWithViolations(0, {
      violations,
      totalSeverity: violations.reduce((sum, v) => sum + v.severity, 0),
      riskLevel: 'high',
      ...overrides
    });
  }
}

/**
 * Generate realistic violation count data
 */
export class ViolationCountFixtures {
  /**
   * Create a violation count
   */
  static createViolationCount(overrides: Partial<ViolationCount> = {}): ViolationCount {
    const articleData = ViolationFixtures['ARTICLES'][Math.floor(Math.random() * ViolationFixtures['ARTICLES'].length)];
    
    const avg = articleData.severity + (Math.random() * 2 - 1); // ±1 variation
    const averageSeverity = Math.max(1, Math.min(10, avg));
    
    return {
      article: articleData.article,
      subarticle: Math.random() > 0.7 ? `${Math.floor(Math.random() * 5) + 1}` : null,
      articleTitle: articleData.title,
      punishment: articleData.punishment,
      count: Math.floor(Math.random() * 20) + 1,
      averageSeverity,
      ...overrides
    };
  }

  /**
   * Create multiple violation counts
   */
  static createViolationCounts(count: number): ViolationCount[] {
    return Array.from({ length: count }, () => this.createViolationCount());
  }

  /**
   * Create top violations (sorted by count)
   */
  static createTopViolations(count: number = 5): ViolationCount[] {
    return this.createViolationCounts(count)
      .map(v => ({ ...v, count: Math.floor(Math.random() * 50) + 10 }))
      .sort((a, b) => b.count - a.count);
  }
}

/**
 * Generate realistic user violation count data
 */
export class UserViolationCountFixtures {
  private static readonly USERNAMES = [
    'user123', 'testuser', 'violator1', 'badactor', 'troublemaker',
    'anonymous', 'chatmember', 'participant', 'member123', 'user456'
  ];

  /**
   * Create a user violation count
   */
  static createUserViolationCount(overrides: Partial<UserViolationCount> = {}): UserViolationCount {
    const count = Math.floor(Math.random() * 15) + 1;
    const averageSeverity = 2 + Math.random() * 6; // 2-8 range
    
    return {
      userId: `${Math.floor(Math.random() * 1000000)}`,
      username: this.USERNAMES[Math.floor(Math.random() * this.USERNAMES.length)],
      count,
      averageSeverity,
      riskLevel: averageSeverity <= 3 ? 'low' : averageSeverity <= 6 ? 'medium' : 'high',
      ...overrides
    };
  }

  /**
   * Create multiple user violation counts
   */
  static createUserViolationCounts(count: number): UserViolationCount[] {
    return Array.from({ length: count }, () => this.createUserViolationCount());
  }

  /**
   * Create top users (sorted by violation count)
   */
  static createTopUsers(count: number = 5): UserViolationCount[] {
    return this.createUserViolationCounts(count)
      .map(u => ({ ...u, count: Math.floor(Math.random() * 30) + 5 }))
      .sort((a, b) => b.count - a.count);
  }
}

/**
 * Generate realistic user stats data
 */
export class UserStatsFixtures {
  /**
   * Create user stats
   */
  static createUserStats(overrides: Partial<UserStats> = {}): UserStats {
    const violationsByArticle = ViolationCountFixtures.createViolationCounts(3);
    const totalViolations = violationsByArticle.reduce((sum, v) => sum + v.count, 0);
    const averageSeverity = violationsByArticle.reduce((sum, v) => sum + v.averageSeverity * v.count, 0) / totalViolations;
    
    return {
      userId: `${Math.floor(Math.random() * 1000000)}`,
      chatId: `${Math.floor(Math.random() * -1000000)}`,
      totalViolations,
      violationsByArticle,
      averageSeverity,
      riskLevel: averageSeverity <= 3 ? 'low' : averageSeverity <= 6 ? 'medium' : 'high',
      lastViolationDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Within last 30 days
      mostCommonViolation: violationsByArticle[0]?.article,
      ...overrides
    };
  }

  /**
   * Create empty user stats
   */
  static createEmptyUserStats(userId: string, chatId: string): UserStats {
    return {
      userId,
      chatId,
      totalViolations: 0,
      violationsByArticle: [],
      averageSeverity: 0,
      riskLevel: 'low',
      lastViolationDate: undefined,
      mostCommonViolation: undefined
    };
  }
}

/**
 * Generate realistic period comparison data
 */
export class PeriodComparisonFixtures {
  /**
   * Create period comparison
   */
  static createPeriodComparison(overrides: Partial<PeriodComparison> = {}): PeriodComparison {
    return {
      violationsChange: (Math.random() - 0.5) * 100, // -50% to +50%
      severityChange: (Math.random() - 0.5) * 4, // -2 to +2
      usersChange: (Math.random() - 0.5) * 60, // -30% to +30%
      ...overrides
    };
  }

  /**
   * Create improving trend
   */
  static createImprovingTrend(): PeriodComparison {
    return {
      violationsChange: -Math.random() * 30, // -30% to 0%
      severityChange: -Math.random() * 2, // -2 to 0
      usersChange: -Math.random() * 20 // -20% to 0%
    };
  }

  /**
   * Create worsening trend
   */
  static createWorseningTrend(): PeriodComparison {
    return {
      violationsChange: Math.random() * 50, // 0% to +50%
      severityChange: Math.random() * 3, // 0 to +3
      usersChange: Math.random() * 40 // 0% to +40%
    };
  }
}

/**
 * Generate realistic period stats data
 */
export class PeriodStatsFixtures {
  /**
   * Create period stats
   */
  static createPeriodStats(overrides: Partial<PeriodStats> = {}): PeriodStats {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const violationsByArticle = ViolationCountFixtures.createViolationCounts(4);
    const totalViolations = violationsByArticle.reduce((sum, v) => sum + v.count, 0);
    const averageSeverity = violationsByArticle.reduce((sum, v) => sum + v.averageSeverity * v.count, 0) / totalViolations;
    
    return {
      chatId: `${Math.floor(Math.random() * -1000000)}`,
      startDate,
      endDate,
      totalViolations,
      violationsByArticle,
      averageSeverity,
      uniqueUsers: Math.floor(Math.random() * 20) + 5,
      comparisonWithPreviousPeriod: PeriodComparisonFixtures.createPeriodComparison(),
      ...overrides
    };
  }

  /**
   * Create daily stats
   */
  static createDailyStats(date: Date = new Date()): PeriodStats {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    return this.createPeriodStats({
      startDate,
      endDate,
      totalViolations: Math.floor(Math.random() * 10),
      uniqueUsers: Math.floor(Math.random() * 5) + 1
    });
  }

  /**
   * Create weekly stats
   */
  static createWeeklyStats(weekStart: Date = new Date()): PeriodStats {
    const startDate = new Date(weekStart);
    const endDate = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return this.createPeriodStats({
      startDate,
      endDate,
      totalViolations: Math.floor(Math.random() * 50) + 10,
      uniqueUsers: Math.floor(Math.random() * 15) + 5
    });
  }

  /**
   * Create monthly stats
   */
  static createMonthlyStats(month: Date = new Date()): PeriodStats {
    const startDate = new Date(month.getFullYear(), month.getMonth(), 1);
    const endDate = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    
    return this.createPeriodStats({
      startDate,
      endDate,
      totalViolations: Math.floor(Math.random() * 200) + 50,
      uniqueUsers: Math.floor(Math.random() * 50) + 20
    });
  }
}

/**
 * Generate realistic general stats data
 */
export class GeneralStatsFixtures {
  /**
   * Create general stats
   */
  static createGeneralStats(overrides: Partial<GeneralStats> = {}): GeneralStats {
    const topViolations = ViolationCountFixtures.createTopViolations(5);
    const topUsers = UserViolationCountFixtures.createTopUsers(5);
    const totalViolations = topViolations.reduce((sum, v) => sum + v.count, 0);
    const averageSeverity = topViolations.reduce((sum, v) => sum + v.averageSeverity * v.count, 0) / totalViolations;
    const criticalViolations = ViolationFixtures.createViolations(2).map(v => ({ ...v, severity: Math.min(10, Math.max(8, v.severity)) }));
    
    return {
      chatId: `${Math.floor(Math.random() * -1000000)}`,
      totalViolations,
      topViolations,
      topUsers,
      overallRiskLevel: averageSeverity <= 3 ? 'low' : averageSeverity <= 6 ? 'medium' : 'high',
      averageSeverity,
      criticalViolations,
      ...overrides
    };
  }

  /**
   * Create high-activity stats
   */
  static createHighActivityStats(): GeneralStats {
    return this.createGeneralStats({
      totalViolations: Math.floor(Math.random() * 500) + 200,
      topViolations: ViolationCountFixtures.createTopViolations(5).map(v => ({ ...v, count: v.count + 20 })),
      topUsers: UserViolationCountFixtures.createTopUsers(5).map(u => ({ ...u, count: u.count + 15 })),
      overallRiskLevel: 'high'
    });
  }

  /**
   * Create low-activity stats
   */
  static createLowActivityStats(): GeneralStats {
    return this.createGeneralStats({
      totalViolations: Math.floor(Math.random() * 20) + 1,
      topViolations: ViolationCountFixtures.createTopViolations(2).map(v => ({ ...v, count: Math.min(5, v.count) })),
      topUsers: UserViolationCountFixtures.createTopUsers(2).map(u => ({ ...u, count: Math.min(3, u.count) })),
      overallRiskLevel: 'low',
      criticalViolations: []
    });
  }

  /**
   * Create empty stats
   */
  static createEmptyStats(chatId: string): GeneralStats {
    return {
      chatId,
      totalViolations: 0,
      topViolations: [],
      topUsers: [],
      overallRiskLevel: 'low',
      averageSeverity: 0,
      criticalViolations: []
    };
  }
}

/**
 * Comprehensive statistics fixtures factory
 */
export class StatisticsFixtures {
  static readonly Violation = ViolationFixtures;
  static readonly ViolationAnalysis = ViolationAnalysisFixtures;
  static readonly ViolationCount = ViolationCountFixtures;
  static readonly UserViolationCount = UserViolationCountFixtures;
  static readonly UserStats = UserStatsFixtures;
  static readonly PeriodComparison = PeriodComparisonFixtures;
  static readonly PeriodStats = PeriodStatsFixtures;
  static readonly GeneralStats = GeneralStatsFixtures;

  /**
   * Create a complete dataset for testing
   */
  static createCompleteDataset(chatId: string = '-1001234567890') {
    const violations = ViolationFixtures.createViolations(10);
    const analysis = ViolationAnalysisFixtures.createWithViolations(5);
    const userStats = UserStatsFixtures.createUserStats({ chatId });
    const periodStats = PeriodStatsFixtures.createWeeklyStats();
    const generalStats = GeneralStatsFixtures.createGeneralStats({ chatId });

    return {
      violations,
      analysis,
      userStats,
      periodStats,
      generalStats
    };
  }

  /**
   * Create test data for specific scenarios
   */
  static createScenarioData(scenario: 'high-risk' | 'low-risk' | 'empty' | 'mixed', chatId: string = '-1001234567890') {
    switch (scenario) {
      case 'high-risk':
        return {
          violations: [ViolationFixtures.createCriticalViolation(), ViolationFixtures.createCriticalViolation()],
          analysis: ViolationAnalysisFixtures.createHighRisk(),
          userStats: UserStatsFixtures.createUserStats({ chatId, riskLevel: 'high', averageSeverity: 8 }),
          periodStats: PeriodStatsFixtures.createPeriodStats({ chatId, averageSeverity: 8 }),
          generalStats: GeneralStatsFixtures.createHighActivityStats()
        };

      case 'low-risk':
        return {
          violations: [ViolationFixtures.createMinorViolation()],
          analysis: ViolationAnalysisFixtures.createWithViolations(1),
          userStats: UserStatsFixtures.createUserStats({ chatId, riskLevel: 'low', averageSeverity: 2 }),
          periodStats: PeriodStatsFixtures.createPeriodStats({ chatId, averageSeverity: 2 }),
          generalStats: GeneralStatsFixtures.createLowActivityStats()
        };

      case 'empty':
        return {
          violations: [],
          analysis: ViolationAnalysisFixtures.createWithoutViolations(),
          userStats: UserStatsFixtures.createEmptyUserStats('123', chatId),
          periodStats: PeriodStatsFixtures.createPeriodStats({ chatId, totalViolations: 0 }),
          generalStats: GeneralStatsFixtures.createEmptyStats(chatId)
        };

      case 'mixed':
      default:
        return this.createCompleteDataset(chatId);
    }
  }
}