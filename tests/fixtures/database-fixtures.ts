/**
 * Database Test Fixtures
 * Provides realistic test data generators for database operations
 */

import type {
  D1Meta,
  DatabaseResult,
  D1Result,
  D1SingleResult,
  D1ExecResult,
  CriminalViolationRow,
  UserStatsRow,
  ViolationCountRow,
  UserViolationCountRow,
  PeriodStatsRow
} from '../../src/utils/database-types';

/**
 * Generate realistic D1 metadata
 */
export class D1MetaFixtures {
  /**
   * Create D1 metadata
   */
  static createD1Meta(overrides: Partial<D1Meta> = {}): D1Meta {
    return {
      duration: Math.random() * 100 + 10, // 10-110ms
      rows_read: Math.floor(Math.random() * 1000),
      rows_written: Math.floor(Math.random() * 100),
      last_row_id: Math.floor(Math.random() * 10000) + 1,
      changed_db: Math.random() > 0.5,
      size_after: Math.floor(Math.random() * 1000000) + 100000,
      ...overrides
    };
  }

  /**
   * Create fast query metadata
   */
  static createFastQueryMeta(): D1Meta {
    return this.createD1Meta({
      duration: Math.random() * 20 + 1, // 1-21ms
      rows_read: Math.floor(Math.random() * 100),
      rows_written: 0
    });
  }

  /**
   * Create slow query metadata
   */
  static createSlowQueryMeta(): D1Meta {
    return this.createD1Meta({
      duration: Math.random() * 500 + 200, // 200-700ms
      rows_read: Math.floor(Math.random() * 10000) + 1000,
      rows_written: 0
    });
  }

  /**
   * Create insert operation metadata
   */
  static createInsertMeta(): D1Meta {
    return this.createD1Meta({
      duration: Math.random() * 50 + 5, // 5-55ms
      rows_read: 0,
      rows_written: 1,
      changed_db: true
    });
  }

  /**
   * Create update operation metadata
   */
  static createUpdateMeta(rowsAffected: number = 1): D1Meta {
    return this.createD1Meta({
      duration: Math.random() * 30 + 10, // 10-40ms
      rows_read: rowsAffected,
      rows_written: rowsAffected,
      changed_db: rowsAffected > 0
    });
  }

  /**
   * Create delete operation metadata
   */
  static createDeleteMeta(rowsAffected: number = 1): D1Meta {
    return this.createD1Meta({
      duration: Math.random() * 25 + 5, // 5-30ms
      rows_read: rowsAffected,
      rows_written: rowsAffected,
      changed_db: rowsAffected > 0
    });
  }
}

/**
 * Generate realistic database result wrappers
 */
export class DatabaseResultFixtures {
  /**
   * Create successful database result
   */
  static createSuccess<T>(data: T, overrides: Partial<DatabaseResult<T>> = {}): DatabaseResult<T> {
    return {
      success: true,
      data,
      meta: D1MetaFixtures.createD1Meta(),
      executionTime: Math.random() * 100 + 10,
      queryInfo: {
        query: 'SELECT * FROM test_table WHERE id = ?',
        parameters: [1]
      },
      ...overrides
    };
  }

  /**
   * Create failed database result
   */
  static createFailure<T>(error: string = 'Database error', overrides: Partial<DatabaseResult<T>> = {}): DatabaseResult<T> {
    return {
      success: false,
      error,
      meta: D1MetaFixtures.createD1Meta({ duration: 5, rows_read: 0, rows_written: 0 }),
      executionTime: Math.random() * 50 + 5,
      queryInfo: {
        query: 'SELECT * FROM test_table WHERE id = ?',
        parameters: [1]
      },
      ...overrides
    };
  }

  /**
   * Create timeout database result
   */
  static createTimeout<T>(): DatabaseResult<T> {
    return this.createFailure('Query timeout exceeded', {
      executionTime: 30000,
      meta: D1MetaFixtures.createD1Meta({ duration: 30000 })
    });
  }

  /**
   * Create connection error result
   */
  static createConnectionError<T>(): DatabaseResult<T> {
    return this.createFailure('Database connection failed', {
      executionTime: 1000,
      meta: undefined
    });
  }
}

/**
 * Generate realistic D1 query results
 */
export class D1ResultFixtures {
  /**
   * Create D1 query result
   */
  static createD1Result<T>(results: T[], overrides: Partial<D1Result<T>> = {}): D1Result<T> {
    return {
      results,
      success: true,
      meta: D1MetaFixtures.createD1Meta({
        rows_read: results.length,
        rows_written: 0
      }),
      ...overrides
    };
  }

  /**
   * Create empty D1 result
   */
  static createEmptyResult<T>(): D1Result<T> {
    return this.createD1Result([], {
      meta: D1MetaFixtures.createD1Meta({
        rows_read: 0,
        rows_written: 0
      })
    });
  }

  /**
   * Create failed D1 result
   */
  static createFailedResult<T>(error: string = 'SQL error'): D1Result<T> {
    return {
      results: [],
      success: false,
      meta: D1MetaFixtures.createD1Meta({ rows_read: 0, rows_written: 0 }),
      error
    };
  }

  /**
   * Create D1 single result
   */
  static createD1SingleResult<T>(result: T | null, overrides: Partial<D1SingleResult<T>> = {}): D1SingleResult<T> {
    return {
      success: true,
      meta: D1MetaFixtures.createD1Meta({
        rows_read: result ? 1 : 0,
        rows_written: 0
      }),
      result: result || undefined,
      ...overrides
    };
  }

  /**
   * Create D1 execution result
   */
  static createD1ExecResult(overrides: Partial<D1ExecResult> = {}): D1ExecResult {
    return {
      success: true,
      meta: D1MetaFixtures.createInsertMeta(),
      ...overrides
    };
  }
}

/**
 * Generate realistic criminal violation database rows
 */
export class CriminalViolationRowFixtures {
  private static readonly ARTICLES = [
    { article: '282', title: 'Возбуждение ненависти либо вражды', punishment: 'штраф до 300 тысяч рублей' },
    { article: '213', title: 'Хулиганство', punishment: 'штраф до 500 тысяч рублей' },
    { article: '319', title: 'Оскорбление представителя власти', punishment: 'штраф до 40 тысяч рублей' },
    { article: '130', title: 'Оскорбление', punishment: 'штраф до 40 тысяч рублей' },
    { article: '148', title: 'Нарушение права на свободу совести', punishment: 'штраф до 300 тысяч рублей' }
  ];

  private static readonly QUOTES = [
    'Призыв к насилию против определенной группы',
    'Оскорбительные высказывания в адрес власти',
    'Разжигание межнациональной розни',
    'Угрозы физической расправы',
    'Призывы к незаконным действиям'
  ];

  /**
   * Create criminal violation row
   */
  static createCriminalViolationRow(overrides: Partial<CriminalViolationRow> = {}): CriminalViolationRow {
    const articleData = this.ARTICLES[Math.floor(Math.random() * this.ARTICLES.length)];
    const quote = this.QUOTES[Math.floor(Math.random() * this.QUOTES.length)];
    const createdAt = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000); // Within last 30 days
    
    return {
      id: Math.floor(Math.random() * 10000) + 1,
      user_id: Math.floor(Math.random() * 1000000),
      chat_id: Math.floor(Math.random() * -1000000),
      article: articleData.article,
      subarticle: Math.random() > 0.7 ? `${Math.floor(Math.random() * 5) + 1}` : null,
      article_title: articleData.title,
      quote,
      punishment: articleData.punishment,
      severity: Math.floor(Math.random() * 10) + 1,
      confidence: Math.random() * 0.4 + 0.6, // 0.6-1.0
      created_at: createdAt.toISOString(),
      ...overrides
    };
  }

  /**
   * Create multiple violation rows
   */
  static createCriminalViolationRows(count: number, overrides: Partial<CriminalViolationRow> = {}): CriminalViolationRow[] {
    return Array.from({ length: count }, () => this.createCriminalViolationRow(overrides));
  }

  /**
   * Create violation rows for specific user and chat
   */
  static createUserViolationRows(userId: number, chatId: number, count: number = 3): CriminalViolationRow[] {
    return this.createCriminalViolationRows(count, { user_id: userId, chat_id: chatId });
  }

  /**
   * Create violation rows for specific chat
   */
  static createChatViolationRows(chatId: number, count: number = 10): CriminalViolationRow[] {
    return this.createCriminalViolationRows(count, { chat_id: chatId });
  }

  /**
   * Create recent violation rows (within last 24 hours)
   */
  static createRecentViolationRows(count: number = 5): CriminalViolationRow[] {
    const now = new Date();
    return this.createCriminalViolationRows(count).map(row => ({
      ...row,
      created_at: new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000).toISOString()
    }));
  }

  /**
   * Create high-severity violation rows
   */
  static createHighSeverityViolationRows(count: number = 3): CriminalViolationRow[] {
    return this.createCriminalViolationRows(count).map(row => ({
      ...row,
      severity: Math.floor(Math.random() * 3) + 8, // 8-10
      confidence: Math.random() * 0.2 + 0.8 // 0.8-1.0
    }));
  }
}

/**
 * Generate realistic user stats database rows
 */
export class UserStatsRowFixtures {
  /**
   * Create user stats row
   */
  static createUserStatsRow(overrides: Partial<UserStatsRow> = {}): UserStatsRow {
    const totalViolations = Math.floor(Math.random() * 20) + 1;
    const lastViolationDate = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);
    
    return {
      total_violations: totalViolations,
      average_severity: Math.random() * 8 + 2, // 2-10
      last_violation_date: lastViolationDate.toISOString(),
      ...overrides
    };
  }

  /**
   * Create empty user stats row
   */
  static createEmptyUserStatsRow(): UserStatsRow {
    return {
      total_violations: 0,
      average_severity: 0,
      last_violation_date: null
    };
  }

  /**
   * Create high-activity user stats row
   */
  static createHighActivityUserStatsRow(): UserStatsRow {
    return this.createUserStatsRow({
      total_violations: Math.floor(Math.random() * 50) + 20,
      average_severity: Math.random() * 3 + 7 // 7-10
    });
  }
}

/**
 * Generate realistic violation count database rows
 */
export class ViolationCountRowFixtures {
  /**
   * Create violation count row
   */
  static createViolationCountRow(overrides: Partial<ViolationCountRow> = {}): ViolationCountRow {
    const articles = CriminalViolationRowFixtures['ARTICLES'];
    const articleData = articles[Math.floor(Math.random() * articles.length)];
    
    return {
      article: articleData.article,
      subarticle: Math.random() > 0.7 ? `${Math.floor(Math.random() * 5) + 1}` : null,
      article_title: articleData.title,
      punishment: articleData.punishment,
      count: Math.floor(Math.random() * 20) + 1,
      average_severity: Math.random() * 8 + 2, // 2-10
      ...overrides
    };
  }

  /**
   * Create multiple violation count rows
   */
  static createViolationCountRows(count: number): ViolationCountRow[] {
    return Array.from({ length: count }, () => this.createViolationCountRow());
  }

  /**
   * Create top violation count rows (sorted by count)
   */
  static createTopViolationCountRows(count: number = 5): ViolationCountRow[] {
    return this.createViolationCountRows(count)
      .map(row => ({ ...row, count: Math.floor(Math.random() * 50) + 10 }))
      .sort((a, b) => b.count - a.count);
  }
}

/**
 * Generate realistic user violation count database rows
 */
export class UserViolationCountRowFixtures {
  /**
   * Create user violation count row
   */
  static createUserViolationCountRow(overrides: Partial<UserViolationCountRow> = {}): UserViolationCountRow {
    return {
      user_id: Math.floor(Math.random() * 1000000),
      count: Math.floor(Math.random() * 15) + 1,
      average_severity: Math.random() * 8 + 2, // 2-10
      ...overrides
    };
  }

  /**
   * Create multiple user violation count rows
   */
  static createUserViolationCountRows(count: number): UserViolationCountRow[] {
    return Array.from({ length: count }, () => this.createUserViolationCountRow());
  }

  /**
   * Create top user violation count rows (sorted by count)
   */
  static createTopUserViolationCountRows(count: number = 5): UserViolationCountRow[] {
    return this.createUserViolationCountRows(count)
      .map(row => ({ ...row, count: Math.floor(Math.random() * 30) + 5 }))
      .sort((a, b) => b.count - a.count);
  }
}

/**
 * Generate realistic period stats database rows
 */
export class PeriodStatsRowFixtures {
  /**
   * Create period stats row
   */
  static createPeriodStatsRow(overrides: Partial<PeriodStatsRow> = {}): PeriodStatsRow {
    const totalViolations = Math.floor(Math.random() * 100) + 10;
    const uniqueUsers = Math.floor(Math.random() * 20) + 5;
    
    return {
      total_violations: totalViolations,
      average_severity: Math.random() * 8 + 2, // 2-10
      unique_users: uniqueUsers,
      ...overrides
    };
  }

  /**
   * Create empty period stats row
   */
  static createEmptyPeriodStatsRow(): PeriodStatsRow {
    return {
      total_violations: 0,
      average_severity: 0,
      unique_users: 0
    };
  }

  /**
   * Create high-activity period stats row
   */
  static createHighActivityPeriodStatsRow(): PeriodStatsRow {
    return this.createPeriodStatsRow({
      total_violations: Math.floor(Math.random() * 200) + 100,
      unique_users: Math.floor(Math.random() * 50) + 25,
      average_severity: Math.random() * 3 + 7 // 7-10
    });
  }
}

/**
 * Database seeding utilities for integration tests
 */
export class DatabaseSeedingFixtures {
  /**
   * Create seed data for criminal violations table
   */
  static createCriminalViolationsSeedData(chatId: number, userCount: number = 5, violationsPerUser: number = 3) {
    const seedData: CriminalViolationRow[] = [];
    
    for (let i = 0; i < userCount; i++) {
      const userId = Math.floor(Math.random() * 1000000);
      const userViolations = CriminalViolationRowFixtures.createUserViolationRows(userId, chatId, violationsPerUser);
      seedData.push(...userViolations);
    }
    
    return seedData;
  }

  /**
   * Create seed data for multiple chats
   */
  static createMultiChatSeedData(chatCount: number = 3) {
    const seedData: CriminalViolationRow[] = [];
    
    for (let i = 0; i < chatCount; i++) {
      const chatId = Math.floor(Math.random() * -1000000);
      const chatViolations = this.createCriminalViolationsSeedData(chatId);
      seedData.push(...chatViolations);
    }
    
    return seedData;
  }

  /**
   * Create time-series seed data (violations over time)
   */
  static createTimeSeriesSeedData(chatId: number, days: number = 30) {
    const seedData: CriminalViolationRow[] = [];
    const now = new Date();
    
    for (let day = 0; day < days; day++) {
      const date = new Date(now.getTime() - day * 24 * 60 * 60 * 1000);
      const dailyViolations = Math.floor(Math.random() * 5); // 0-4 violations per day
      
      for (let v = 0; v < dailyViolations; v++) {
        const violation = CriminalViolationRowFixtures.createCriminalViolationRow({
          chat_id: chatId,
          created_at: new Date(date.getTime() + Math.random() * 24 * 60 * 60 * 1000).toISOString()
        });
        seedData.push(violation);
      }
    }
    
    return seedData.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  /**
   * Create realistic test scenario seed data
   */
  static createScenarioSeedData(scenario: 'high-activity' | 'low-activity' | 'mixed' | 'empty', chatId: number) {
    switch (scenario) {
      case 'high-activity':
        return [
          ...CriminalViolationRowFixtures.createHighSeverityViolationRows(10).map(row => ({ ...row, chat_id: chatId })),
          ...CriminalViolationRowFixtures.createRecentViolationRows(15).map(row => ({ ...row, chat_id: chatId }))
        ];

      case 'low-activity':
        return CriminalViolationRowFixtures.createCriminalViolationRows(3, { chat_id: chatId, severity: 2 });

      case 'mixed':
        return [
          ...CriminalViolationRowFixtures.createHighSeverityViolationRows(3).map(row => ({ ...row, chat_id: chatId })),
          ...CriminalViolationRowFixtures.createCriminalViolationRows(7, { chat_id: chatId, severity: 4 })
        ];

      case 'empty':
      default:
        return [];
    }
  }
}

/**
 * Comprehensive database fixtures factory
 */
export class DatabaseFixtures {
  static readonly Meta = D1MetaFixtures;
  static readonly Result = DatabaseResultFixtures;
  static readonly D1Result = D1ResultFixtures;
  static readonly CriminalViolationRow = CriminalViolationRowFixtures;
  static readonly UserStatsRow = UserStatsRowFixtures;
  static readonly ViolationCountRow = ViolationCountRowFixtures;
  static readonly UserViolationCountRow = UserViolationCountRowFixtures;
  static readonly PeriodStatsRow = PeriodStatsRowFixtures;
  static readonly Seeding = DatabaseSeedingFixtures;

  /**
   * Create a complete database test dataset
   */
  static createCompleteDataset(chatId: number = -1001234567890) {
    const violations = CriminalViolationRowFixtures.createChatViolationRows(chatId, 15);
    const userStats = UserStatsRowFixtures.createUserStatsRow();
    const violationCounts = ViolationCountRowFixtures.createViolationCountRows(5);
    const userViolationCounts = UserViolationCountRowFixtures.createUserViolationCountRows(5);
    const periodStats = PeriodStatsRowFixtures.createPeriodStatsRow();

    return {
      violations,
      userStats,
      violationCounts,
      userViolationCounts,
      periodStats
    };
  }

  /**
   * Create mock D1 database responses for testing
   */
  static createMockD1Responses() {
    return {
      selectViolations: D1ResultFixtures.createD1Result(CriminalViolationRowFixtures.createCriminalViolationRows(5)),
      selectUserStats: D1ResultFixtures.createD1SingleResult(UserStatsRowFixtures.createUserStatsRow()),
      insertViolation: D1ResultFixtures.createD1ExecResult(),
      updateViolation: D1ResultFixtures.createD1ExecResult({ meta: D1MetaFixtures.createUpdateMeta() }),
      deleteViolation: D1ResultFixtures.createD1ExecResult({ meta: D1MetaFixtures.createDeleteMeta() }),
      emptyResult: D1ResultFixtures.createEmptyResult(),
      errorResult: D1ResultFixtures.createFailedResult('Test database error')
    };
  }
}