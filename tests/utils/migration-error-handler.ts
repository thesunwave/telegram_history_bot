/**
 * Migration Error Handler
 * Specialized error handling for database migration operations
 */

import { DatabaseErrorHandler, DatabaseError, DatabaseErrorFactory } from './database-error-handler';

export interface MigrationError extends DatabaseError {
  /** Migration ID that caused the error */
  migrationId?: string;
  /** Migration name */
  migrationName?: string;
  /** SQL statement that failed */
  failedStatement?: string;
  /** Statement index in migration */
  statementIndex?: number;
  /** Migration operation type */
  operationType: 'up' | 'down' | 'validation' | 'rollback';
  /** Whether migration state is corrupted */
  stateCorrupted: boolean;
}

export interface MigrationRecoveryContext {
  /** Migration that was being executed */
  migrationId: string;
  /** Operation that failed */
  operationType: 'up' | 'down' | 'validation' | 'rollback';
  /** Statements executed before failure */
  executedStatements: string[];
  /** Remaining statements */
  remainingStatements: string[];
  /** Database state before migration */
  previousState?: any;
}

export interface MigrationLogEntry {
  /** Log entry timestamp */
  timestamp: Date;
  /** Log level */
  level: 'info' | 'warn' | 'error' | 'debug';
  /** Migration ID */
  migrationId?: string;
  /** Log message */
  message: string;
  /** Additional context */
  context?: Record<string, any>;
  /** Error details if applicable */
  error?: MigrationError;
}

/**
 * Migration Error Handler
 * Handles errors specific to database migration operations
 */
export class MigrationErrorHandler extends DatabaseErrorHandler {
  private migrationLog: MigrationLogEntry[] = [];
  private maxLogSize: number = 500;
  private enableDetailedLogging: boolean;

  constructor(enableDetailedLogging: boolean = true) {
    super({
      maxAttempts: 1, // Migrations typically shouldn't be retried automatically
      initialDelay: 0,
      maxDelay: 0,
      backoffMultiplier: 1,
      jitterFactor: 0
    });
    
    this.enableDetailedLogging = enableDetailedLogging;
    this.registerMigrationRecoveryStrategies();
  }

  /**
   * Handle migration error with specialized recovery
   */
  async handleMigrationError(
    error: Error | MigrationError,
    context: MigrationRecoveryContext
  ): Promise<void> {
    const migrationError = this.normalizeMigrationError(error, context);
    this.logMigrationError(migrationError, context);

    // Attempt specialized recovery
    await this.attemptMigrationRecovery(migrationError, context);

    // If recovery fails, throw the error
    throw migrationError;
  }

  /**
   * Create migration error
   */
  createMigrationError(
    message: string,
    code: string,
    operationType: 'up' | 'down' | 'validation' | 'rollback',
    migrationId?: string,
    migrationName?: string,
    stateCorrupted: boolean = false
  ): MigrationError {
    const error = new Error(message) as MigrationError;
    error.code = code;
    error.category = 'query';
    error.retryable = false; // Migrations are typically not retryable
    error.migrationId = migrationId;
    error.migrationName = migrationName;
    error.operationType = operationType;
    error.stateCorrupted = stateCorrupted;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Log migration operation
   */
  logMigrationOperation(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    migrationId?: string,
    context?: Record<string, any>
  ): void {
    if (!this.enableDetailedLogging && level === 'debug') {
      return;
    }

    const logEntry: MigrationLogEntry = {
      timestamp: new Date(),
      level,
      migrationId,
      message,
      context
    };

    this.migrationLog.push(logEntry);
    this.trimLogIfNeeded();

    // Also log to console based on level
    const logMessage = migrationId 
      ? `[Migration ${migrationId}] ${message}`
      : `[Migration] ${message}`;

    switch (level) {
      case 'error':
        console.error(logMessage, context);
        break;
      case 'warn':
        console.warn(logMessage, context);
        break;
      case 'info':
        console.log(logMessage, context);
        break;
      case 'debug':
        if (this.enableDetailedLogging) {
          console.debug(logMessage, context);
        }
        break;
    }
  }

  /**
   * Get migration logs
   */
  getMigrationLogs(migrationId?: string): MigrationLogEntry[] {
    if (migrationId) {
      return this.migrationLog.filter(entry => entry.migrationId === migrationId);
    }
    return [...this.migrationLog];
  }

  /**
   * Get migration error summary
   */
  getMigrationErrorSummary(): {
    totalErrors: number;
    errorsByMigration: Record<string, number>;
    errorsByOperation: Record<string, number>;
    recentErrors: MigrationLogEntry[];
    corruptedMigrations: string[];
  } {
    const errorEntries = this.migrationLog.filter(entry => entry.level === 'error');
    const errorsByMigration: Record<string, number> = {};
    const errorsByOperation: Record<string, number> = {};
    const corruptedMigrations: string[] = [];

    for (const entry of errorEntries) {
      if (entry.migrationId) {
        errorsByMigration[entry.migrationId] = (errorsByMigration[entry.migrationId] || 0) + 1;
      }

      if (entry.error?.operationType) {
        const opType = entry.error.operationType;
        errorsByOperation[opType] = (errorsByOperation[opType] || 0) + 1;
      }

      if (entry.error?.stateCorrupted && entry.migrationId) {
        if (!corruptedMigrations.includes(entry.migrationId)) {
          corruptedMigrations.push(entry.migrationId);
        }
      }
    }

    return {
      totalErrors: errorEntries.length,
      errorsByMigration,
      errorsByOperation,
      recentErrors: errorEntries.slice(-10),
      corruptedMigrations
    };
  }

  /**
   * Clear migration logs
   */
  clearMigrationLogs(): void {
    this.migrationLog = [];
  }

  /**
   * Validate migration state
   */
  async validateMigrationState(
    migrationId: string,
    expectedTables: string[],
    database: any
  ): Promise<{
    isValid: boolean;
    issues: string[];
    recommendations: string[];
  }> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check if migration is recorded as applied
      const migrationRecord = await database
        .prepare('SELECT * FROM test_migrations WHERE id = ?')
        .bind(migrationId)
        .first();

      if (!migrationRecord) {
        issues.push(`Migration ${migrationId} is not recorded as applied`);
        recommendations.push('Run the migration again or manually record it');
      }

      // Check if expected tables exist
      for (const table of expectedTables) {
        try {
          await database.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
        } catch (error: unknown) {
          issues.push(`Expected table ${table} does not exist or is not accessible`);
          recommendations.push(`Verify table ${table} was created correctly`);
        }
      }

      // Check for orphaned tables (tables that exist but shouldn't)
      // This would require more sophisticated schema tracking

      return {
        isValid: issues.length === 0,
        issues,
        recommendations
      };
    } catch (error: unknown) {
      return {
        isValid: false,
        issues: [`Failed to validate migration state: ${(error as Error).message}`],
        recommendations: ['Check database connectivity and migration table integrity']
      };
    }
  }

  // Private methods

  /**
   * Normalize error to MigrationError
   */
  private normalizeMigrationError(
    error: Error | MigrationError,
    context: MigrationRecoveryContext
  ): MigrationError {
    if (this.isMigrationError(error)) {
      return error;
    }

    const message = error.message.toLowerCase();
    let code = 'MIGRATION_ERROR';
    let stateCorrupted = false;

    // Analyze error to determine specific type
    if (message.includes('syntax')) {
      code = 'MIGRATION_SYNTAX_ERROR';
    } else if (message.includes('table') && message.includes('exists')) {
      code = 'MIGRATION_TABLE_EXISTS';
    } else if (message.includes('column') && message.includes('exists')) {
      code = 'MIGRATION_COLUMN_EXISTS';
    } else if (message.includes('constraint')) {
      code = 'MIGRATION_CONSTRAINT_ERROR';
      stateCorrupted = true;
    } else if (message.includes('foreign key')) {
      code = 'MIGRATION_FOREIGN_KEY_ERROR';
      stateCorrupted = true;
    } else if (message.includes('timeout')) {
      code = 'MIGRATION_TIMEOUT';
    } else if (message.includes('lock')) {
      code = 'MIGRATION_LOCK_ERROR';
    }

    const migrationError = error as MigrationError;
    migrationError.code = code;
    migrationError.category = 'query';
    migrationError.retryable = false;
    migrationError.migrationId = context.migrationId;
    migrationError.operationType = context.operationType;
    migrationError.stateCorrupted = stateCorrupted;
    migrationError.timestamp = new Date();

    return migrationError;
  }

  /**
   * Check if error is a MigrationError
   */
  private isMigrationError(error: any): error is MigrationError {
    return error && 
           typeof error.operationType === 'string' &&
           typeof error.stateCorrupted === 'boolean';
  }

  /**
   * Log migration error
   */
  private logMigrationError(error: MigrationError, context: MigrationRecoveryContext): void {
    this.logMigrationOperation(
      'error',
      `Migration failed: ${error.message}`,
      error.migrationId,
      {
        code: error.code,
        operationType: error.operationType,
        stateCorrupted: error.stateCorrupted,
        executedStatements: context.executedStatements.length,
        remainingStatements: context.remainingStatements.length
      }
    );

    // Add error to log entry
    const lastEntry = this.migrationLog[this.migrationLog.length - 1];
    if (lastEntry) {
      lastEntry.error = error;
    }
  }

  /**
   * Attempt migration-specific recovery
   */
  private async attemptMigrationRecovery(
    error: MigrationError,
    context: MigrationRecoveryContext
  ): Promise<void> {
    this.logMigrationOperation(
      'info',
      `Attempting recovery for migration error: ${error.code}`,
      error.migrationId
    );

    // Recovery strategies based on error type
    switch (error.code) {
      case 'MIGRATION_TABLE_EXISTS':
        await this.recoverFromTableExists(error, context);
        break;
      case 'MIGRATION_COLUMN_EXISTS':
        await this.recoverFromColumnExists(error, context);
        break;
      case 'MIGRATION_CONSTRAINT_ERROR':
        await this.recoverFromConstraintError(error, context);
        break;
      case 'MIGRATION_TIMEOUT':
        await this.recoverFromTimeout(error, context);
        break;
      default:
        this.logMigrationOperation(
          'warn',
          `No specific recovery strategy for error code: ${error.code}`,
          error.migrationId
        );
    }
  }

  /**
   * Recover from table already exists error
   */
  private async recoverFromTableExists(
    error: MigrationError,
    context: MigrationRecoveryContext
  ): Promise<void> {
    this.logMigrationOperation(
      'info',
      'Attempting recovery from table exists error',
      error.migrationId
    );

    // This might be recoverable if we can modify the statement to use IF NOT EXISTS
    // For now, just log the attempt
    this.logMigrationOperation(
      'warn',
      'Table exists error - consider using IF NOT EXISTS in migration',
      error.migrationId
    );
  }

  /**
   * Recover from column already exists error
   */
  private async recoverFromColumnExists(
    error: MigrationError,
    context: MigrationRecoveryContext
  ): Promise<void> {
    this.logMigrationOperation(
      'info',
      'Attempting recovery from column exists error',
      error.migrationId
    );

    // Similar to table exists, might be recoverable
    this.logMigrationOperation(
      'warn',
      'Column exists error - consider using IF NOT EXISTS or ALTER TABLE IF NOT EXISTS',
      error.migrationId
    );
  }

  /**
   * Recover from constraint error
   */
  private async recoverFromConstraintError(
    error: MigrationError,
    context: MigrationRecoveryContext
  ): Promise<void> {
    this.logMigrationOperation(
      'error',
      'Constraint error detected - database state may be corrupted',
      error.migrationId
    );

    // Mark state as corrupted
    error.stateCorrupted = true;
    
    this.logMigrationOperation(
      'warn',
      'Manual intervention may be required to fix constraint violations',
      error.migrationId
    );
  }

  /**
   * Recover from timeout error
   */
  private async recoverFromTimeout(
    error: MigrationError,
    context: MigrationRecoveryContext
  ): Promise<void> {
    this.logMigrationOperation(
      'info',
      'Attempting recovery from timeout error',
      error.migrationId
    );

    // Timeout might be recoverable with retry
    error.retryable = true;
    
    this.logMigrationOperation(
      'info',
      'Timeout error marked as retryable',
      error.migrationId
    );
  }

  /**
   * Register migration-specific recovery strategies
   */
  private registerMigrationRecoveryStrategies(): void {
    // Override parent recovery strategies with migration-specific ones
    this.registerRecoveryStrategy({
      name: 'migration-state-validation',
      canHandle: (error) => this.isMigrationError(error as MigrationError),
      execute: async (error, context) => {
        const migrationError = error as MigrationError;
        this.logMigrationOperation(
          'info',
          `Validating migration state after error: ${migrationError.code}`,
          migrationError.migrationId
        );
      },
      priority: 15
    });

    this.registerRecoveryStrategy({
      name: 'migration-rollback-suggestion',
      canHandle: (error) => {
        const migrationError = error as MigrationError;
        return this.isMigrationError(migrationError) && migrationError.stateCorrupted;
      },
      execute: async (error, context) => {
        const migrationError = error as MigrationError;
        this.logMigrationOperation(
          'warn',
          'Database state corrupted - consider rolling back migration',
          migrationError.migrationId
        );
      },
      priority: 12
    });
  }

  /**
   * Trim log if it exceeds maximum size
   */
  private trimLogIfNeeded(): void {
    if (this.migrationLog.length > this.maxLogSize) {
      this.migrationLog = this.migrationLog.slice(-this.maxLogSize);
    }
  }
}

/**
 * Migration Error Factory
 * Factory for creating migration-specific errors
 */
export class MigrationErrorFactory extends DatabaseErrorFactory {
  /**
   * Create migration syntax error
   */
  static createSyntaxError(
    message: string,
    migrationId: string,
    statement: string,
    statementIndex: number
  ): MigrationError {
    const error = new Error(message) as MigrationError;
    error.code = 'MIGRATION_SYNTAX_ERROR';
    error.category = 'query';
    error.retryable = false;
    error.migrationId = migrationId;
    error.failedStatement = statement;
    error.statementIndex = statementIndex;
    error.operationType = 'up';
    error.stateCorrupted = false;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Create migration rollback error
   */
  static createRollbackError(
    message: string,
    migrationId: string,
    stateCorrupted: boolean = true
  ): MigrationError {
    const error = new Error(message) as MigrationError;
    error.code = 'MIGRATION_ROLLBACK_ERROR';
    error.category = 'query';
    error.retryable = false;
    error.migrationId = migrationId;
    error.operationType = 'down';
    error.stateCorrupted = stateCorrupted;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Create migration validation error
   */
  static createValidationError(
    message: string,
    migrationId: string,
    validationDetails?: Record<string, any>
  ): MigrationError {
    const error = new Error(message) as MigrationError;
    error.code = 'MIGRATION_VALIDATION_ERROR';
    error.category = 'validation';
    error.retryable = false;
    error.migrationId = migrationId;
    error.operationType = 'validation';
    error.stateCorrupted = false;
    error.context = validationDetails;
    error.timestamp = new Date();
    return error;
  }
}