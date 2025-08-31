/**
 * Test Migration Runner
 * Automated migration system for test database initialization and cleanup
 */

import type { D1Database } from '@cloudflare/workers-types';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { DatabaseErrorFactory } from './database-error-handler';

export interface Migration {
  /** Migration ID/version */
  id: string;
  /** Migration name */
  name: string;
  /** Migration file path */
  filePath: string;
  /** SQL content for up migration */
  up: string;
  /** SQL content for down migration (if available) */
  down?: string;
  /** Migration timestamp */
  timestamp: Date;
  /** Migration checksum for integrity */
  checksum: string;
}

export interface MigrationResult {
  /** Migration that was executed */
  migration: Migration;
  /** Whether the migration was successful */
  success: boolean;
  /** Execution time in milliseconds */
  executionTime: number;
  /** Error message if failed */
  error?: string;
  /** SQL statements executed */
  statementsExecuted: number;
}

export interface MigrationStatus {
  /** Migration ID */
  id: string;
  /** Migration name */
  name: string;
  /** When it was applied */
  appliedAt: Date;
  /** Execution time */
  executionTime: number;
  /** Migration checksum */
  checksum: string;
}

export interface RollbackResult {
  /** Migrations that were rolled back */
  rolledBack: Migration[];
  /** Whether rollback was successful */
  success: boolean;
  /** Total rollback time */
  totalTime: number;
  /** Errors encountered during rollback */
  errors: string[];
}

export interface SchemaValidationResult {
  /** Whether schema is valid */
  isValid: boolean;
  /** Missing tables */
  missingTables: string[];
  /** Extra tables */
  extraTables: string[];
  /** Schema differences */
  differences: string[];
  /** Validation errors */
  errors: string[];
}

/**
 * Test Migration Runner
 * Manages database migrations for test environments
 */
export class TestMigrationRunner {
  private database: D1Database;
  private migrationPath: string;
  private migrationsTable: string;
  private enableLogging: boolean;

  constructor(
    database: D1Database,
    migrationPath: string = 'migrations',
    options: {
      migrationsTable?: string;
      enableLogging?: boolean;
    } = {}
  ) {
    this.database = database;
    this.migrationPath = migrationPath;
    this.migrationsTable = options.migrationsTable || 'test_migrations';
    this.enableLogging = options.enableLogging ?? true;
  }

  /**
   * Initialize migration system
   */
  async initialize(): Promise<void> {
    try {
      await this.createMigrationsTable();
      this.log('Migration system initialized');
    } catch (error: unknown) {
      throw DatabaseErrorFactory.createConfigurationError(
        `Failed to initialize migration system: ${(error as Error).message}`,
        'migration_path'
      );
    }
  }

  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<MigrationResult[]> {
    await this.initialize();

    const availableMigrations = await this.loadMigrations();
    const appliedMigrations = await this.getAppliedMigrations();
    
    // Find pending migrations
    const pendingMigrations = availableMigrations.filter(
      migration => !appliedMigrations.some(applied => applied.id === migration.id)
    );

    if (pendingMigrations.length === 0) {
      this.log('No pending migrations found');
      return [];
    }

    this.log(`Running ${pendingMigrations.length} pending migrations`);

    const results: MigrationResult[] = [];
    
    for (const migration of pendingMigrations) {
      const result = await this.runMigration(migration);
      results.push(result);
      
      if (!result.success) {
        this.log(`Migration ${migration.id} failed: ${result.error}`);
        break; // Stop on first failure
      }
    }

    return results;
  }

  /**
   * Run a specific migration
   */
  async runMigration(migration: Migration): Promise<MigrationResult> {
    const startTime = Date.now();
    let statementsExecuted = 0;

    try {
      this.log(`Running migration: ${migration.id} - ${migration.name}`);

      // Split SQL into individual statements
      const statements = this.splitSqlStatements(migration.up);
      
      // Execute each statement
      for (const statement of statements) {
        if (statement.trim()) {
          await this.database.exec(statement);
          statementsExecuted++;
        }
      }

      // Record migration as applied
      await this.recordMigration(migration, Date.now() - startTime);

      const executionTime = Date.now() - startTime;
      this.log(`Migration ${migration.id} completed in ${executionTime}ms`);

      return {
        migration,
        success: true,
        executionTime,
        statementsExecuted
      };
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      const errorMessage = (error as Error).message;
      
      this.log(`Migration ${migration.id} failed: ${errorMessage}`);

      return {
        migration,
        success: false,
        executionTime,
        error: errorMessage,
        statementsExecuted
      };
    }
  }

  /**
   * Rollback migrations
   */
  async rollbackMigrations(targetMigrationId?: string): Promise<RollbackResult> {
    const startTime = Date.now();
    const appliedMigrations = await this.getAppliedMigrations();
    const availableMigrations = await this.loadMigrations();
    
    // Determine which migrations to rollback
    let migrationsToRollback: Migration[];
    
    if (targetMigrationId) {
      // Rollback to specific migration
      const targetIndex = appliedMigrations.findIndex(m => m.id === targetMigrationId);
      if (targetIndex === -1) {
        throw DatabaseErrorFactory.createValidationError(
          `Target migration ${targetMigrationId} not found in applied migrations`
        );
      }
      
      const migrationsToRollbackIds = appliedMigrations
        .slice(targetIndex + 1)
        .map(m => m.id);
      
      migrationsToRollback = availableMigrations
        .filter(m => migrationsToRollbackIds.includes(m.id))
        .reverse(); // Rollback in reverse order
    } else {
      // Rollback all migrations
      migrationsToRollback = availableMigrations
        .filter(m => appliedMigrations.some(applied => applied.id === m.id))
        .reverse();
    }

    if (migrationsToRollback.length === 0) {
      return {
        rolledBack: [],
        success: true,
        totalTime: 0,
        errors: []
      };
    }

    this.log(`Rolling back ${migrationsToRollback.length} migrations`);

    const rolledBack: Migration[] = [];
    const errors: string[] = [];

    for (const migration of migrationsToRollback) {
      try {
        await this.rollbackMigration(migration);
        rolledBack.push(migration);
        this.log(`Rolled back migration: ${migration.id}`);
      } catch (error: unknown) {
        const errorMessage = `Failed to rollback migration ${migration.id}: ${(error as Error).message}`;
        errors.push(errorMessage);
        this.log(errorMessage);
        break; // Stop on first failure
      }
    }

    const totalTime = Date.now() - startTime;
    const success = errors.length === 0;

    return {
      rolledBack,
      success,
      totalTime,
      errors
    };
  }

  /**
   * Rollback a specific migration
   */
  async rollbackMigration(migration: Migration): Promise<void> {
    if (!migration.down) {
      // If no down migration, try to drop tables created by up migration
      await this.autoGenerateRollback(migration);
    } else {
      // Execute down migration
      const statements = this.splitSqlStatements(migration.down);
      
      for (const statement of statements) {
        if (statement.trim()) {
          await this.database.exec(statement);
        }
      }
    }

    // Remove migration record
    await this.removeMigrationRecord(migration.id);
  }

  /**
   * Validate schema completeness
   */
  async validateSchema(): Promise<SchemaValidationResult> {
    try {
      const expectedTables = await this.getExpectedTables();
      const actualTables = await this.getActualTables();
      
      const missingTables = expectedTables.filter(table => !actualTables.includes(table));
      const extraTables = actualTables.filter(table => 
        !expectedTables.includes(table) && 
        table !== this.migrationsTable
      );

      const differences: string[] = [];
      const errors: string[] = [];

      // Check for missing tables
      if (missingTables.length > 0) {
        differences.push(`Missing tables: ${missingTables.join(', ')}`);
      }

      // Check for extra tables
      if (extraTables.length > 0) {
        differences.push(`Extra tables: ${extraTables.join(', ')}`);
      }

      // Validate table structures (basic check)
      for (const table of expectedTables) {
        if (actualTables.includes(table)) {
          try {
            await this.database.prepare(`SELECT * FROM ${table} LIMIT 1`).first();
          } catch (error: unknown) {
            errors.push(`Table ${table} exists but is not accessible: ${(error as Error).message}`);
          }
        }
      }

      const isValid = missingTables.length === 0 && errors.length === 0;

      return {
        isValid,
        missingTables,
        extraTables,
        differences,
        errors
      };
    } catch (error: unknown) {
      return {
        isValid: false,
        missingTables: [],
        extraTables: [],
        differences: [],
        errors: [`Schema validation failed: ${(error as Error).message}`]
      };
    }
  }

  /**
   * Get migration status
   */
  async getMigrationStatus(): Promise<{
    appliedMigrations: MigrationStatus[];
    pendingMigrations: Migration[];
    totalMigrations: number;
  }> {
    const availableMigrations = await this.loadMigrations();
    const appliedMigrations = await this.getAppliedMigrations();
    
    const pendingMigrations = availableMigrations.filter(
      migration => !appliedMigrations.some(applied => applied.id === migration.id)
    );

    return {
      appliedMigrations,
      pendingMigrations,
      totalMigrations: availableMigrations.length
    };
  }

  /**
   * Reset database (rollback all migrations)
   */
  async resetDatabase(): Promise<RollbackResult> {
    this.log('Resetting database - rolling back all migrations');
    return this.rollbackMigrations();
  }

  /**
   * Clean up migration system
   */
  async cleanup(): Promise<void> {
    try {
      await this.database.exec(`DROP TABLE IF EXISTS ${this.migrationsTable}`);
      this.log('Migration system cleaned up');
    } catch (error: unknown) {
      this.log(`Failed to cleanup migration system: ${(error as Error).message}`);
    }
  }

  // Private methods

  /**
   * Create migrations tracking table
   */
  private async createMigrationsTable(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.migrationsTable} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        execution_time INTEGER NOT NULL,
        checksum TEXT NOT NULL
      )
    `;
    
    await this.database.exec(sql);
  }

  /**
   * Load available migrations from filesystem
   */
  private async loadMigrations(): Promise<Migration[]> {
    if (!existsSync(this.migrationPath)) {
      throw DatabaseErrorFactory.createConfigurationError(
        `Migration path does not exist: ${this.migrationPath}`,
        'migration_path'
      );
    }

    const files = readdirSync(this.migrationPath)
      .filter(file => extname(file) === '.sql')
      .sort();

    const migrations: Migration[] = [];

    for (const file of files) {
      const filePath = join(this.migrationPath, file);
      const content = readFileSync(filePath, 'utf8');
      
      // Extract migration ID from filename (e.g., "0001_init.sql" -> "0001")
      const id = file.split('_')[0];
      const name = file.replace(/^\d+_/, '').replace('.sql', '');
      
      // Split content into up and down migrations if separator exists
      const parts = content.split('-- DOWN');
      const up = parts[0].trim();
      const down = parts[1]?.trim();

      migrations.push({
        id,
        name,
        filePath,
        up,
        down,
        timestamp: new Date(),
        checksum: this.calculateChecksum(content)
      });
    }

    return migrations;
  }

  /**
   * Get applied migrations from database
   */
  private async getAppliedMigrations(): Promise<MigrationStatus[]> {
    try {
      const result = await this.database
        .prepare(`SELECT * FROM ${this.migrationsTable} ORDER BY id`)
        .all();

      return (result.results || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        appliedAt: new Date(row.applied_at),
        executionTime: row.execution_time,
        checksum: row.checksum
      }));
    } catch (error: unknown) {
      // Table might not exist yet
      return [];
    }
  }

  /**
   * Record migration as applied
   */
  private async recordMigration(migration: Migration, executionTime: number): Promise<void> {
    await this.database
      .prepare(`
        INSERT INTO ${this.migrationsTable} (id, name, applied_at, execution_time, checksum)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(
        migration.id,
        migration.name,
        new Date().toISOString(),
        executionTime,
        migration.checksum
      )
      .run();
  }

  /**
   * Remove migration record
   */
  private async removeMigrationRecord(migrationId: string): Promise<void> {
    await this.database
      .prepare(`DELETE FROM ${this.migrationsTable} WHERE id = ?`)
      .bind(migrationId)
      .run();
  }

  /**
   * Split SQL content into individual statements
   */
  private splitSqlStatements(sql: string): string[] {
    // Simple SQL statement splitting (handles basic cases)
    return sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
  }

  /**
   * Calculate checksum for migration content
   */
  private calculateChecksum(content: string): string {
    // Simple checksum calculation (in real implementation, use crypto)
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get expected tables from migrations
   */
  private async getExpectedTables(): Promise<string[]> {
    const migrations = await this.loadMigrations();
    const tables: Set<string> = new Set();

    for (const migration of migrations) {
      // Extract table names from CREATE TABLE statements
      const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
      let match;
      
      while ((match = createTableRegex.exec(migration.up)) !== null) {
        tables.add(match[1].toLowerCase());
      }
    }

    return Array.from(tables);
  }

  /**
   * Get actual tables from database
   */
  private async getActualTables(): Promise<string[]> {
    try {
      // For SQLite/D1, query sqlite_master
      const result = await this.database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all();

      return (result.results || []).map((row: any) => row.name.toLowerCase());
    } catch (error: unknown) {
      // Fallback: return empty array
      return [];
    }
  }

  /**
   * Auto-generate rollback for migration without down script
   */
  private async autoGenerateRollback(migration: Migration): Promise<void> {
    // Extract table names from CREATE TABLE statements
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
    const tablesToDrop: string[] = [];
    let match;

    while ((match = createTableRegex.exec(migration.up)) !== null) {
      tablesToDrop.push(match[1]);
    }

    // Drop tables in reverse order
    for (const table of tablesToDrop.reverse()) {
      await this.database.exec(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  /**
   * Log message if logging is enabled
   */
  private log(message: string): void {
    if (this.enableLogging) {
      console.log(`[TestMigrationRunner] ${message}`);
    }
  }
}

/**
 * Migration Runner Factory
 */
export class MigrationRunnerFactory {
  /**
   * Create migration runner with default settings
   */
  static createDefault(database: D1Database): TestMigrationRunner {
    return new TestMigrationRunner(database);
  }

  /**
   * Create migration runner for CI environment
   */
  static createForCI(database: D1Database): TestMigrationRunner {
    return new TestMigrationRunner(database, 'migrations', {
      migrationsTable: 'ci_test_migrations',
      enableLogging: false // Disable logging for CI
    });
  }

  /**
   * Create migration runner for local development
   */
  static createForLocal(database: D1Database): TestMigrationRunner {
    return new TestMigrationRunner(database, 'migrations', {
      migrationsTable: 'local_test_migrations',
      enableLogging: true // Enable logging for local development
    });
  }

  /**
   * Create migration runner with custom configuration
   */
  static createWithConfig(
    database: D1Database,
    migrationPath: string,
    options: {
      migrationsTable?: string;
      enableLogging?: boolean;
    } = {}
  ): TestMigrationRunner {
    return new TestMigrationRunner(database, migrationPath, options);
  }
}