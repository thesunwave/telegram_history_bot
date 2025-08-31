/**
 * Test Fixture Manager
 * Manages reusable test data generation, seeding, and cleanup
 */

import type { D1Database } from '@cloudflare/workers-types';
import { DatabaseFixtures } from '../fixtures/database-fixtures';
import type { CriminalViolationRow } from '../../src/utils/database-types';

export interface TestFixture {
  /** Fixture name/identifier */
  name: string;
  /** Table name this fixture applies to */
  tableName: string;
  /** Fixture data */
  data: any[];
  /** Dependencies (other fixtures that must be loaded first) */
  dependencies: string[];
  /** Cleanup strategy for this fixture */
  cleanupStrategy: 'delete' | 'truncate' | 'cascade';
  /** Whether this fixture should be loaded by default */
  autoLoad: boolean;
}

export interface FixtureLoadResult {
  /** Fixture that was loaded */
  fixture: TestFixture;
  /** Number of records inserted */
  recordsInserted: number;
  /** Load time in milliseconds */
  loadTime: number;
  /** Whether load was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

export interface CleanupResult {
  /** Table that was cleaned */
  tableName: string;
  /** Number of records removed */
  recordsRemoved: number;
  /** Cleanup time in milliseconds */
  cleanupTime: number;
  /** Whether cleanup was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

export interface FixtureSet {
  /** Set name */
  name: string;
  /** Description */
  description: string;
  /** Fixtures in this set */
  fixtures: string[];
  /** Load order (fixtures will be loaded in this order) */
  loadOrder: string[];
}

/**
 * Test Fixture Manager
 * Manages test data fixtures for database testing
 */
export class TestFixtureManager {
  private database: D1Database;
  private fixtures: Map<string, TestFixture> = new Map();
  private fixtureSets: Map<string, FixtureSet> = new Map();
  private loadedFixtures: Set<string> = new Set();
  private enableLogging: boolean;

  constructor(database: D1Database, enableLogging: boolean = true) {
    this.database = database;
    this.enableLogging = enableLogging;
    this.registerDefaultFixtures();
    this.registerDefaultFixtureSets();
  }

  /**
   * Register a test fixture
   */
  registerFixture(fixture: TestFixture): void {
    this.fixtures.set(fixture.name, fixture);
    this.log(`Registered fixture: ${fixture.name} (${fixture.data.length} records)`);
  }

  /**
   * Register a fixture set
   */
  registerFixtureSet(fixtureSet: FixtureSet): void {
    this.fixtureSets.set(fixtureSet.name, fixtureSet);
    this.log(`Registered fixture set: ${fixtureSet.name} (${fixtureSet.fixtures.length} fixtures)`);
  }

  /**
   * Load a specific fixture
   */
  async loadFixture(fixtureName: string): Promise<FixtureLoadResult> {
    const fixture = this.fixtures.get(fixtureName);
    if (!fixture) {
      return {
        fixture: {} as TestFixture,
        recordsInserted: 0,
        loadTime: 0,
        success: false,
        error: `Fixture not found: ${fixtureName}`
      };
    }

    // Check if already loaded
    if (this.loadedFixtures.has(fixtureName)) {
      this.log(`Fixture ${fixtureName} already loaded, skipping`);
      return {
        fixture,
        recordsInserted: 0,
        loadTime: 0,
        success: true
      };
    }

    const startTime = Date.now();

    try {
      // Load dependencies first
      for (const dependency of fixture.dependencies) {
        if (!this.loadedFixtures.has(dependency)) {
          await this.loadFixture(dependency);
        }
      }

      // Load fixture data
      const recordsInserted = await this.insertFixtureData(fixture);
      this.loadedFixtures.add(fixtureName);

      const loadTime = Date.now() - startTime;
      this.log(`Loaded fixture ${fixtureName}: ${recordsInserted} records in ${loadTime}ms`);

      return {
        fixture,
        recordsInserted,
        loadTime,
        success: true
      };
    } catch (error: unknown) {
      const loadTime = Date.now() - startTime;
      const errorMessage = (error as Error).message;
      
      this.log(`Failed to load fixture ${fixtureName}: ${errorMessage}`);

      return {
        fixture,
        recordsInserted: 0,
        loadTime,
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Load multiple fixtures
   */
  async loadFixtures(fixtureNames: string[]): Promise<FixtureLoadResult[]> {
    const results: FixtureLoadResult[] = [];
    
    for (const fixtureName of fixtureNames) {
      const result = await this.loadFixture(fixtureName);
      results.push(result);
      
      if (!result.success) {
        this.log(`Stopping fixture loading due to failure: ${result.error}`);
        break;
      }
    }

    return results;
  }

  /**
   * Load a fixture set
   */
  async loadFixtureSet(setName: string): Promise<FixtureLoadResult[]> {
    const fixtureSet = this.fixtureSets.get(setName);
    if (!fixtureSet) {
      throw new Error(`Fixture set not found: ${setName}`);
    }

    this.log(`Loading fixture set: ${setName}`);
    
    // Use load order if specified, otherwise use fixtures array
    const loadOrder = fixtureSet.loadOrder.length > 0 
      ? fixtureSet.loadOrder 
      : fixtureSet.fixtures;

    return this.loadFixtures(loadOrder);
  }

  /**
   * Load all auto-load fixtures
   */
  async loadAutoFixtures(): Promise<FixtureLoadResult[]> {
    const autoFixtures = Array.from(this.fixtures.values())
      .filter(fixture => fixture.autoLoad)
      .map(fixture => fixture.name);

    if (autoFixtures.length === 0) {
      this.log('No auto-load fixtures found');
      return [];
    }

    this.log(`Loading ${autoFixtures.length} auto-load fixtures`);
    return this.loadFixtures(autoFixtures);
  }

  /**
   * Clean up a specific table
   */
  async cleanupTable(tableName: string, strategy: 'delete' | 'truncate' | 'cascade' = 'delete'): Promise<CleanupResult> {
    const startTime = Date.now();

    try {
      let recordsRemoved = 0;
      
      switch (strategy) {
        case 'delete':
          const deleteResult = await this.database
            .prepare(`DELETE FROM ${tableName}`)
            .run();
          recordsRemoved = deleteResult.meta?.changes || 0;
          break;

        case 'truncate':
          // SQLite doesn't have TRUNCATE, use DELETE
          const truncateResult = await this.database
            .prepare(`DELETE FROM ${tableName}`)
            .run();
          recordsRemoved = truncateResult.meta?.changes || 0;
          
          // Reset auto-increment if applicable
          await this.database.exec(`DELETE FROM sqlite_sequence WHERE name='${tableName}'`);
          break;

        case 'cascade':
          // For cascade, we need to handle foreign key constraints
          // This is a simplified implementation
          await this.database.exec('PRAGMA foreign_keys = OFF');
          const cascadeResult = await this.database
            .prepare(`DELETE FROM ${tableName}`)
            .run();
          recordsRemoved = cascadeResult.meta?.changes || 0;
          await this.database.exec('PRAGMA foreign_keys = ON');
          break;
      }

      const cleanupTime = Date.now() - startTime;
      this.log(`Cleaned up table ${tableName}: ${recordsRemoved} records removed in ${cleanupTime}ms`);

      return {
        tableName,
        recordsRemoved,
        cleanupTime,
        success: true
      };
    } catch (error: unknown) {
      const cleanupTime = Date.now() - startTime;
      const errorMessage = (error as Error).message;
      
      this.log(`Failed to cleanup table ${tableName}: ${errorMessage}`);

      return {
        tableName,
        recordsRemoved: 0,
        cleanupTime,
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Clean up all loaded fixtures
   */
  async cleanupLoadedFixtures(): Promise<CleanupResult[]> {
    const results: CleanupResult[] = [];
    
    // Get unique table names from loaded fixtures
    const tablesToCleanup = new Set<string>();
    for (const fixtureName of this.loadedFixtures) {
      const fixture = this.fixtures.get(fixtureName);
      if (fixture) {
        tablesToCleanup.add(fixture.tableName);
      }
    }

    // Clean up tables in reverse dependency order
    const cleanupOrder = this.calculateCleanupOrder(Array.from(tablesToCleanup));
    
    for (const tableName of cleanupOrder) {
      // Find fixture for this table to get cleanup strategy
      const fixture = Array.from(this.fixtures.values())
        .find(f => f.tableName === tableName && this.loadedFixtures.has(f.name));
      
      const strategy = fixture?.cleanupStrategy || 'delete';
      const result = await this.cleanupTable(tableName, strategy);
      results.push(result);
    }

    // Clear loaded fixtures tracking
    this.loadedFixtures.clear();
    this.log('Cleared loaded fixtures tracking');

    return results;
  }

  /**
   * Clean up all tables
   */
  async cleanupAllTables(): Promise<CleanupResult[]> {
    const tables = await this.getAllTables();
    const results: CleanupResult[] = [];

    // Clean up in reverse order to handle dependencies
    for (const tableName of tables.reverse()) {
      // Skip system tables
      if (tableName.startsWith('sqlite_') || tableName.includes('migrations')) {
        continue;
      }

      const result = await this.cleanupTable(tableName, 'truncate');
      results.push(result);
    }

    this.loadedFixtures.clear();
    return results;
  }

  /**
   * Verify cleanup completeness
   */
  async verifyCleanup(): Promise<{
    isComplete: boolean;
    remainingRecords: Record<string, number>;
    issues: string[];
  }> {
    const remainingRecords: Record<string, number> = {};
    const issues: string[] = [];

    try {
      const tables = await this.getAllTables();
      
      for (const tableName of tables) {
        // Skip system tables
        if (tableName.startsWith('sqlite_') || tableName.includes('migrations')) {
          continue;
        }

        try {
          const result = await this.database
            .prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
            .first();
          
          const count = (result as any)?.count || 0;
          if (count > 0) {
            remainingRecords[tableName] = count;
          }
        } catch (error: unknown) {
          issues.push(`Failed to count records in ${tableName}: ${(error as Error).message}`);
        }
      }

      const isComplete = Object.keys(remainingRecords).length === 0 && issues.length === 0;
      
      if (!isComplete) {
        this.log(`Cleanup verification failed: ${Object.keys(remainingRecords).length} tables with data, ${issues.length} issues`);
      } else {
        this.log('Cleanup verification passed: all tables clean');
      }

      return {
        isComplete,
        remainingRecords,
        issues
      };
    } catch (error: unknown) {
      return {
        isComplete: false,
        remainingRecords: {},
        issues: [`Cleanup verification failed: ${(error as Error).message}`]
      };
    }
  }

  /**
   * Get fixture status
   */
  getFixtureStatus(): {
    totalFixtures: number;
    loadedFixtures: number;
    availableFixtures: string[];
    loadedFixtureNames: string[];
    fixtureSets: string[];
  } {
    return {
      totalFixtures: this.fixtures.size,
      loadedFixtures: this.loadedFixtures.size,
      availableFixtures: Array.from(this.fixtures.keys()),
      loadedFixtureNames: Array.from(this.loadedFixtures),
      fixtureSets: Array.from(this.fixtureSets.keys())
    };
  }

  /**
   * Reset fixture manager
   */
  async reset(): Promise<void> {
    await this.cleanupAllTables();
    this.loadedFixtures.clear();
    this.log('Fixture manager reset complete');
  }

  // Private methods

  /**
   * Insert fixture data into database
   */
  private async insertFixtureData(fixture: TestFixture): Promise<number> {
    if (fixture.data.length === 0) {
      return 0;
    }

    let recordsInserted = 0;

    // Handle different table types
    switch (fixture.tableName) {
      case 'criminal_violations':
        recordsInserted = await this.insertCriminalViolations(fixture.data);
        break;
      case 'summaries':
        recordsInserted = await this.insertSummaries(fixture.data);
        break;
      default:
        recordsInserted = await this.insertGenericData(fixture.tableName, fixture.data);
    }

    return recordsInserted;
  }

  /**
   * Insert criminal violations data
   */
  private async insertCriminalViolations(data: CriminalViolationRow[]): Promise<number> {
    let inserted = 0;
    
    for (const violation of data) {
      await this.database
        .prepare(`
          INSERT INTO criminal_violations 
          (user_id, chat_id, article, subarticle, article_title, quote, punishment, severity, confidence, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
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
      
      inserted++;
    }

    return inserted;
  }

  /**
   * Insert summaries data
   */
  private async insertSummaries(data: any[]): Promise<number> {
    let inserted = 0;
    
    for (const summary of data) {
      await this.database
        .prepare(`
          INSERT INTO summaries (chat_id, period_start, period_end, summary)
          VALUES (?, ?, ?, ?)
        `)
        .bind(summary.chat_id, summary.period_start, summary.period_end, summary.summary)
        .run();
      
      inserted++;
    }

    return inserted;
  }

  /**
   * Insert generic data
   */
  private async insertGenericData(tableName: string, data: any[]): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    // Get column names from first record
    const columns = Object.keys(data[0]);
    const placeholders = columns.map(() => '?').join(', ');
    const columnNames = columns.join(', ');

    let inserted = 0;
    
    for (const record of data) {
      const values = columns.map(col => record[col]);
      
      await this.database
        .prepare(`INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`)
        .bind(...values)
        .run();
      
      inserted++;
    }

    return inserted;
  }

  /**
   * Get all table names
   */
  private async getAllTables(): Promise<string[]> {
    try {
      const result = await this.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();

      return (result.results || []).map((row: any) => row.name);
    } catch (error: unknown) {
      this.log(`Failed to get table names: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Calculate cleanup order based on dependencies
   */
  private calculateCleanupOrder(tableNames: string[]): string[] {
    // Simple implementation - in a real scenario, you'd analyze foreign key dependencies
    // For now, just reverse the table names to handle basic dependencies
    return [...tableNames].reverse();
  }

  /**
   * Register default fixtures
   */
  private registerDefaultFixtures(): void {
    // Criminal violations fixture
    this.registerFixture({
      name: 'criminal_violations_basic',
      tableName: 'criminal_violations',
      data: DatabaseFixtures.Seeding.createCriminalViolationsSeedData(-1001234567890, 5, 3),
      dependencies: [],
      cleanupStrategy: 'delete',
      autoLoad: false
    });

    // High activity criminal violations
    this.registerFixture({
      name: 'criminal_violations_high_activity',
      tableName: 'criminal_violations',
      data: DatabaseFixtures.Seeding.createScenarioSeedData('high-activity', -1001234567890),
      dependencies: [],
      cleanupStrategy: 'delete',
      autoLoad: false
    });

    // Empty summaries fixture
    this.registerFixture({
      name: 'summaries_empty',
      tableName: 'summaries',
      data: [],
      dependencies: [],
      cleanupStrategy: 'delete',
      autoLoad: false
    });

    // Basic summaries fixture
    this.registerFixture({
      name: 'summaries_basic',
      tableName: 'summaries',
      data: [
        {
          chat_id: -1001234567890,
          period_start: '2024-01-01T00:00:00Z',
          period_end: '2024-01-01T23:59:59Z',
          summary: 'Test summary for basic scenario'
        }
      ],
      dependencies: [],
      cleanupStrategy: 'delete',
      autoLoad: false
    });
  }

  /**
   * Register default fixture sets
   */
  private registerDefaultFixtureSets(): void {
    // Empty database set
    this.registerFixtureSet({
      name: 'empty',
      description: 'Empty database with no test data',
      fixtures: [],
      loadOrder: []
    });

    // Basic test set
    this.registerFixtureSet({
      name: 'basic',
      description: 'Basic test data for standard scenarios',
      fixtures: ['criminal_violations_basic', 'summaries_basic'],
      loadOrder: ['summaries_basic', 'criminal_violations_basic']
    });

    // High activity test set
    this.registerFixtureSet({
      name: 'high_activity',
      description: 'High activity test data for performance testing',
      fixtures: ['criminal_violations_high_activity', 'summaries_basic'],
      loadOrder: ['summaries_basic', 'criminal_violations_high_activity']
    });

    // Minimal test set
    this.registerFixtureSet({
      name: 'minimal',
      description: 'Minimal test data for quick tests',
      fixtures: ['summaries_empty'],
      loadOrder: ['summaries_empty']
    });
  }

  /**
   * Log message if logging is enabled
   */
  private log(message: string): void {
    if (this.enableLogging) {
      console.log(`[TestFixtureManager] ${message}`);
    }
  }
}

/**
 * Test Fixture Manager Factory
 */
export class TestFixtureManagerFactory {
  /**
   * Create fixture manager with default configuration
   */
  static createDefault(database: D1Database): TestFixtureManager {
    return new TestFixtureManager(database);
  }

  /**
   * Create fixture manager for CI environment
   */
  static createForCI(database: D1Database): TestFixtureManager {
    return new TestFixtureManager(database, false); // Disable logging for CI
  }

  /**
   * Create fixture manager for local development
   */
  static createForLocal(database: D1Database): TestFixtureManager {
    return new TestFixtureManager(database, true); // Enable logging for local
  }

  /**
   * Create fixture manager with custom logging setting
   */
  static createWithLogging(database: D1Database, enableLogging: boolean): TestFixtureManager {
    return new TestFixtureManager(database, enableLogging);
  }
}