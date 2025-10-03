/**
 * Database Seeding and Cleanup Utilities
 * Provides utilities for setting up and tearing down test database state
 */

import type { D1Database } from '@cloudflare/workers-types';
import { DatabaseFixtures } from '../fixtures/database-fixtures';
import type { CriminalViolationRow } from '../../src/utils/database-types';

/**
 * Database seeding utilities for integration tests
 */
export class DatabaseSeeder {
  constructor(private db: D1Database) {}

  /**
   * Seed criminal violations table with test data
   */
  async seedCriminalViolations(violations: CriminalViolationRow[]): Promise<void> {
    const insertQuery = `
      INSERT INTO criminal_violations (
        user_id, chat_id, article, subarticle, article_title, 
        quote, punishment, severity, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const violation of violations) {
      await this.db.prepare(insertQuery)
        .bind(
          violation.user_id,
          violation.chat_id,
          violation.article,
          violation.subarticle,
          violation.article_title,
          violation.quote,
          violation.punishment,
          violation.severity,
          violation.confidence,
          violation.created_at
        )
        .run();
    }
  }

  /**
   * Seed test data for a specific chat
   */
  async seedChatData(chatId: number, options: {
    userCount?: number;
    violationsPerUser?: number;
    timeRangeDays?: number;
  } = {}): Promise<CriminalViolationRow[]> {
    const {
      userCount = 5,
      violationsPerUser = 3,
      timeRangeDays = 30
    } = options;

    const violations = DatabaseFixtures.Seeding.createCriminalViolationsSeedData(
      chatId,
      userCount,
      violationsPerUser
    );

    // Distribute violations over time range
    const now = Date.now();
    const timeRange = timeRangeDays * 24 * 60 * 60 * 1000;
    
    violations.forEach(violation => {
      const randomTime = now - Math.random() * timeRange;
      violation.created_at = new Date(randomTime).toISOString();
    });

    await this.seedCriminalViolations(violations);
    return violations;
  }

  /**
   * Seed time-series data for testing trends
   */
  async seedTimeSeriesData(chatId: number, days: number = 30): Promise<CriminalViolationRow[]> {
    const violations = DatabaseFixtures.Seeding.createTimeSeriesSeedData(chatId, days);
    await this.seedCriminalViolations(violations);
    return violations;
  }

  /**
   * Seed scenario-specific data
   */
  async seedScenarioData(
    scenario: 'high-activity' | 'low-activity' | 'mixed' | 'empty',
    chatId: number
  ): Promise<CriminalViolationRow[]> {
    const violations = DatabaseFixtures.Seeding.createScenarioSeedData(scenario, chatId);
    
    if (violations.length > 0) {
      await this.seedCriminalViolations(violations);
    }
    
    return violations;
  }

  /**
   * Seed multiple chats with different activity levels
   */
  async seedMultipleChatData(chatConfigs: Array<{
    chatId: number;
    scenario: 'high-activity' | 'low-activity' | 'mixed' | 'empty';
  }>): Promise<Record<number, CriminalViolationRow[]>> {
    const result: Record<number, CriminalViolationRow[]> = {};
    
    for (const config of chatConfigs) {
      result[config.chatId] = await this.seedScenarioData(config.scenario, config.chatId);
    }
    
    return result;
  }

  /**
   * Seed realistic test dataset with various patterns
   */
  async seedRealisticDataset(): Promise<{
    highActivityChat: CriminalViolationRow[];
    lowActivityChat: CriminalViolationRow[];
    mixedActivityChat: CriminalViolationRow[];
    emptyChat: CriminalViolationRow[];
  }> {
    const chatIds = {
      highActivity: -1001111111111,
      lowActivity: -1002222222222,
      mixedActivity: -1003333333333,
      empty: -1004444444444
    };

    const [highActivityChat, lowActivityChat, mixedActivityChat, emptyChat] = await Promise.all([
      this.seedScenarioData('high-activity', chatIds.highActivity),
      this.seedScenarioData('low-activity', chatIds.lowActivity),
      this.seedScenarioData('mixed', chatIds.mixedActivity),
      this.seedScenarioData('empty', chatIds.empty)
    ]);

    return {
      highActivityChat,
      lowActivityChat,
      mixedActivityChat,
      emptyChat
    };
  }
}

/**
 * Database cleanup utilities for test isolation
 */
export class DatabaseCleaner {
  constructor(private db: D1Database) {}

  /**
   * Clear all criminal violations
   */
  async clearCriminalViolations(): Promise<void> {
    await this.db.prepare('DELETE FROM criminal_violations').run();
  }

  /**
   * Clear violations for specific chat
   */
  async clearChatViolations(chatId: number): Promise<void> {
    await this.db.prepare('DELETE FROM criminal_violations WHERE chat_id = ?')
      .bind(chatId)
      .run();
  }

  /**
   * Clear violations for specific user
   */
  async clearUserViolations(userId: number): Promise<void> {
    await this.db.prepare('DELETE FROM criminal_violations WHERE user_id = ?')
      .bind(userId)
      .run();
  }

  /**
   * Clear violations older than specified date
   */
  async clearOldViolations(olderThanDays: number): Promise<void> {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    await this.db.prepare('DELETE FROM criminal_violations WHERE created_at < ?')
      .bind(cutoffDate.toISOString())
      .run();
  }

  /**
   * Clear all test data (comprehensive cleanup)
   */
  async clearAllTestData(): Promise<void> {
    const tables = [
      'criminal_violations',
      // Add other tables as needed
    ];

    for (const table of tables) {
      try {
        await this.db.prepare(`DELETE FROM ${table}`).run();
      } catch (error: unknown) {
        // Table might not exist in test environment, continue
        console.warn(`Failed to clear table ${table}:`, error);
      }
    }
  }

  /**
   * Reset auto-increment counters (if applicable)
   */
  async resetAutoIncrement(): Promise<void> {
    try {
      // SQLite doesn't have a direct way to reset auto-increment,
      // but we can delete from sqlite_sequence if it exists
      await this.db.prepare('DELETE FROM sqlite_sequence WHERE name = ?')
        .bind('criminal_violations')
        .run();
    } catch (error: unknown) {
      // sqlite_sequence might not exist, ignore
    }
  }
}

/**
 * Database transaction utilities for test isolation
 */
export class DatabaseTransactionManager {
  constructor(private db: D1Database) {}

  /**
   * Execute operations within a transaction-like context
   * Note: D1 doesn't support transactions yet, but this provides a pattern
   */
  async withTransaction<T>(operations: (db: D1Database) => Promise<T>): Promise<T> {
    // For now, just execute the operations
    // In the future, this could be enhanced with actual transaction support
    return operations(this.db);
  }

  /**
   * Execute operations with rollback capability
   * Creates a backup of affected data before operations
   */
  async withRollback<T>(
    operations: (db: D1Database) => Promise<T>,
    backupTables: string[] = ['criminal_violations']
  ): Promise<T> {
    const backups: Record<string, any[]> = {};
    
    // Create backups
    for (const table of backupTables) {
      try {
        const result = await this.db.prepare(`SELECT * FROM ${table}`).all();
        backups[table] = result.results || [];
      } catch (error: unknown) {
        console.warn(`Failed to backup table ${table}:`, error);
      }
    }

    try {
      return await operations(this.db);
    } catch (error: unknown) {
      // Restore from backups
      await this.restoreFromBackups(backups);
      throw error;
    }
  }

  /**
   * Restore tables from backup data
   */
  private async restoreFromBackups(backups: Record<string, any[]>): Promise<void> {
    for (const [table, data] of Object.entries(backups)) {
      try {
        // Clear table
        await this.db.prepare(`DELETE FROM ${table}`).run();
        
        // Restore data
        if (data.length > 0 && table === 'criminal_violations') {
          const insertQuery = `
            INSERT INTO criminal_violations (
              id, user_id, chat_id, article, subarticle, article_title,
              quote, punishment, severity, confidence, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          
          for (const row of data) {
            await this.db.prepare(insertQuery)
              .bind(
                row.id, row.user_id, row.chat_id, row.article, row.subarticle,
                row.article_title, row.quote, row.punishment, row.severity,
                row.confidence, row.created_at
              )
              .run();
          }
        }
      } catch (error: unknown) {
        console.error(`Failed to restore table ${table}:`, error);
      }
    }
  }
}

/**
 * Database test utilities factory
 */
export class DatabaseTestUtils {
  private seeder: DatabaseSeeder;
  private cleaner: DatabaseCleaner;
  private transactionManager: DatabaseTransactionManager;

  constructor(db: D1Database) {
    this.seeder = new DatabaseSeeder(db);
    this.cleaner = new DatabaseCleaner(db);
    this.transactionManager = new DatabaseTransactionManager(db);
  }

  /**
   * Get seeder instance
   */
  get seed(): DatabaseSeeder {
    return this.seeder;
  }

  /**
   * Get cleaner instance
   */
  get clean(): DatabaseCleaner {
    return this.cleaner;
  }

  /**
   * Get transaction manager instance
   */
  get transaction(): DatabaseTransactionManager {
    return this.transactionManager;
  }

  /**
   * Setup test database with fresh data
   */
  async setupTestDatabase(scenario: 'realistic' | 'empty' | 'high-activity' = 'realistic'): Promise<any> {
    // Clean existing data
    await this.cleaner.clearAllTestData();
    
    switch (scenario) {
      case 'realistic':
        return this.seeder.seedRealisticDataset();
      case 'high-activity':
        return this.seeder.seedScenarioData('high-activity', -1001234567890);
      case 'empty':
        return [];
      default:
        return this.seeder.seedRealisticDataset();
    }
  }

  /**
   * Teardown test database
   */
  async teardownTestDatabase(): Promise<void> {
    await this.cleaner.clearAllTestData();
    await this.cleaner.resetAutoIncrement();
  }

  /**
   * Create isolated test environment
   */
  async withIsolatedDatabase<T>(
    testFn: (utils: DatabaseTestUtils) => Promise<T>,
    scenario: 'realistic' | 'empty' | 'high-activity' = 'realistic'
  ): Promise<T> {
    // Setup
    await this.setupTestDatabase(scenario);
    
    try {
      // Execute test
      return await testFn(this);
    } finally {
      // Cleanup
      await this.teardownTestDatabase();
    }
  }

  /**
   * Verify database state
   */
  async verifyDatabaseState(expectedCounts: {
    totalViolations?: number;
    chatViolations?: Record<number, number>;
    userViolations?: Record<number, number>;
  }): Promise<boolean> {
    try {
      if (expectedCounts.totalViolations !== undefined) {
        const result = await this.seeder['db'].prepare('SELECT COUNT(*) as count FROM criminal_violations').first();
        if (result?.count !== expectedCounts.totalViolations) {
          return false;
        }
      }

      if (expectedCounts.chatViolations) {
        for (const [chatId, expectedCount] of Object.entries(expectedCounts.chatViolations)) {
          const result = await this.seeder['db']
            .prepare('SELECT COUNT(*) as count FROM criminal_violations WHERE chat_id = ?')
            .bind(parseInt(chatId))
            .first();
          if (result?.count !== expectedCount) {
            return false;
          }
        }
      }

      if (expectedCounts.userViolations) {
        for (const [userId, expectedCount] of Object.entries(expectedCounts.userViolations)) {
          const result = await this.seeder['db']
            .prepare('SELECT COUNT(*) as count FROM criminal_violations WHERE user_id = ?')
            .bind(parseInt(userId))
            .first();
          if (result?.count !== expectedCount) {
            return false;
          }
        }
      }

      return true;
    } catch (error: unknown) {
      console.error('Database state verification failed:', error);
      return false;
    }
  }
}

/**
 * Helper function to create database test utils
 */
export function createDatabaseTestUtils(db: D1Database): DatabaseTestUtils {
  return new DatabaseTestUtils(db);
}

/**
 * Test database factory for different scenarios
 */
export class TestDatabaseFactory {
  /**
   * Create database with realistic production-like data
   */
  static async createRealisticDatabase(db: D1Database): Promise<DatabaseTestUtils> {
    const utils = new DatabaseTestUtils(db);
    await utils.setupTestDatabase('realistic');
    return utils;
  }

  /**
   * Create empty database for clean tests
   */
  static async createEmptyDatabase(db: D1Database): Promise<DatabaseTestUtils> {
    const utils = new DatabaseTestUtils(db);
    await utils.setupTestDatabase('empty');
    return utils;
  }

  /**
   * Create high-activity database for performance tests
   */
  static async createHighActivityDatabase(db: D1Database): Promise<DatabaseTestUtils> {
    const utils = new DatabaseTestUtils(db);
    await utils.setupTestDatabase('high-activity');
    return utils;
  }

  /**
   * Create database with specific scenario
   */
  static async createScenarioDatabase(
    db: D1Database,
    scenario: 'realistic' | 'empty' | 'high-activity'
  ): Promise<DatabaseTestUtils> {
    const utils = new DatabaseTestUtils(db);
    await utils.setupTestDatabase(scenario);
    return utils;
  }
}