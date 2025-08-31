/**
 * Test Database Manager
 * Provides comprehensive test database configuration and connection management
 */

import type { D1Database } from '@cloudflare/workers-types';
import { MockD1Database, DatabaseMockFactory } from '../mocks/mock-database';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface TestDatabaseConfig {
  /** Database URL for test environment */
  databaseUrl?: string;
  /** Path to migration files */
  migrationPath: string;
  /** Path to test fixtures */
  fixturesPath: string;
  /** Database cleanup strategy */
  cleanupStrategy: 'truncate' | 'drop' | 'rollback';
  /** Test isolation level */
  isolationLevel: 'test' | 'suite' | 'file';
  /** Connection pool size */
  poolSize: number;
  /** Connection timeout in milliseconds */
  connectionTimeout: number;
  /** Query timeout in milliseconds */
  queryTimeout: number;
  /** Enable query logging */
  enableQueryLogging: boolean;
  /** Maximum retry attempts for failed connections */
  maxRetryAttempts: number;
  /** Retry delay in milliseconds */
  retryDelay: number;
}

export interface DatabaseConnection {
  database: D1Database;
  isConnected: boolean;
  connectionId: string;
  createdAt: Date;
  lastUsed: Date;
}

export interface ConnectionHealthCheck {
  isHealthy: boolean;
  responseTime: number;
  error?: string;
  timestamp: Date;
}

export interface DatabaseConnectionError extends Error {
  code: string;
  connectionId?: string;
  retryable: boolean;
}

/**
 * Test Database Manager
 * Manages test database connections, configuration, and health monitoring
 */
export class TestDatabaseManager {
  private config: TestDatabaseConfig;
  private connections: Map<string, DatabaseConnection> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private isInitialized: boolean = false;
  private queryLog: Array<{ query: string; params: any[]; timestamp: Date; connectionId: string }> = [];

  constructor(config: Partial<TestDatabaseConfig> = {}) {
    this.config = {
      migrationPath: 'migrations',
      fixturesPath: 'tests/fixtures',
      cleanupStrategy: 'truncate',
      isolationLevel: 'test',
      poolSize: 5,
      connectionTimeout: 5000,
      queryTimeout: 5000,
      enableQueryLogging: true,
      maxRetryAttempts: 3,
      retryDelay: 1000,
      ...config
    };
  }

  /**
   * Initialize the test database manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Validate configuration
      this.validateConfiguration();

      // Initialize connection pool
      await this.initializeConnectionPool();

      // Start health monitoring
      this.startHealthMonitoring();

      this.isInitialized = true;
    } catch (error: unknown) {
      throw this.createConnectionError(
        'Failed to initialize test database manager',
        'INIT_FAILED',
        error as Error,
        false
      );
    }
  }

  /**
   * Get a database connection from the pool
   */
  async getConnection(): Promise<DatabaseConnection> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Try to get an existing healthy connection
    for (const [id, connection] of this.connections) {
      if (connection.isConnected && await this.isConnectionHealthy(connection)) {
        connection.lastUsed = new Date();
        return connection;
      }
    }

    // Create new connection if pool not full
    if (this.connections.size < this.config.poolSize) {
      return await this.createConnection();
    }

    // Wait for a connection to become available
    return await this.waitForAvailableConnection();
  }

  /**
   * Release a database connection back to the pool
   */
  releaseConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.lastUsed = new Date();
    }
  }

  /**
   * Create a test database connection
   */
  async createTestDatabase(): Promise<D1Database> {
    const connection = await this.getConnection();
    return connection.database;
  }

  /**
   * Perform database health check
   */
  async performHealthCheck(connectionId?: string): Promise<ConnectionHealthCheck> {
    const startTime = Date.now();
    
    try {
      const connection = connectionId 
        ? this.connections.get(connectionId)
        : Array.from(this.connections.values())[0];

      if (!connection) {
        return {
          isHealthy: false,
          responseTime: Date.now() - startTime,
          error: 'No connection available',
          timestamp: new Date()
        };
      }

      // Perform simple health check query
      await connection.database.prepare('SELECT 1').first();

      return {
        isHealthy: true,
        responseTime: Date.now() - startTime,
        timestamp: new Date()
      };
    } catch (error: unknown) {
      return {
        isHealthy: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Validate database connection
   */
  async validateConnection(database: D1Database): Promise<boolean> {
    try {
      const result = await database.prepare('SELECT 1 as test').first();
      return result !== null;
    } catch (error: unknown) {
      return false;
    }
  }

  /**
   * Get connection pool status
   */
  getPoolStatus(): {
    totalConnections: number;
    activeConnections: number;
    availableConnections: number;
    poolSize: number;
  } {
    const totalConnections = this.connections.size;
    const activeConnections = Array.from(this.connections.values())
      .filter(conn => conn.isConnected).length;

    return {
      totalConnections,
      activeConnections,
      availableConnections: this.config.poolSize - activeConnections,
      poolSize: this.config.poolSize
    };
  }

  /**
   * Get query log
   */
  getQueryLog(): Array<{ query: string; params: any[]; timestamp: Date; connectionId: string }> {
    return [...this.queryLog];
  }

  /**
   * Clear query log
   */
  clearQueryLog(): void {
    this.queryLog = [];
  }

  /**
   * Close all connections and cleanup
   */
  async cleanup(): Promise<void> {
    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Close all connections
    for (const [id, connection] of this.connections) {
      try {
        connection.isConnected = false;
      } catch (error: unknown) {
        console.warn(`Failed to close connection ${id}:`, error);
      }
    }

    this.connections.clear();
    this.queryLog = [];
    this.isInitialized = false;
  }

  /**
   * Reset database manager for testing
   */
  async reset(): Promise<void> {
    await this.cleanup();
    await this.initialize();
  }

  // Private methods

  /**
   * Validate configuration
   */
  private validateConfiguration(): void {
    if (this.config.poolSize <= 0) {
      throw new Error('Pool size must be greater than 0');
    }

    if (this.config.connectionTimeout <= 0) {
      throw new Error('Connection timeout must be greater than 0');
    }

    if (this.config.queryTimeout <= 0) {
      throw new Error('Query timeout must be greater than 0');
    }

    if (!existsSync(this.config.migrationPath)) {
      throw new Error(`Migration path does not exist: ${this.config.migrationPath}`);
    }
  }

  /**
   * Initialize connection pool
   */
  private async initializeConnectionPool(): Promise<void> {
    // Create initial connections
    const initialConnections = Math.min(2, this.config.poolSize);
    
    for (let i = 0; i < initialConnections; i++) {
      await this.createConnection();
    }
  }

  /**
   * Create a new database connection
   */
  private async createConnection(): Promise<DatabaseConnection> {
    const connectionId = `test-db-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // For testing, we use MockD1Database
      const database = this.createMockDatabase();
      
      const connection: DatabaseConnection = {
        database,
        isConnected: true,
        connectionId,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      // Validate connection
      const isValid = await this.validateConnection(database);
      if (!isValid) {
        throw new Error('Failed to validate database connection');
      }

      this.connections.set(connectionId, connection);
      return connection;
    } catch (error: unknown) {
      throw this.createConnectionError(
        `Failed to create database connection ${connectionId}`,
        'CONNECTION_FAILED',
        error as Error,
        true
      );
    }
  }

  /**
   * Create mock database for testing
   */
  private createMockDatabase(): MockD1Database {
    // Create realistic mock database with proper test data
    const mockDb = DatabaseMockFactory.createRealisticDatabase();
    
    // Enable query logging if configured
    if (this.config.enableQueryLogging) {
      const originalPrepare = mockDb.prepare.bind(mockDb);
      mockDb.prepare = (query: string) => {
        const stmt = originalPrepare(query);
        const originalRun = stmt.run.bind(stmt);
        const originalAll = stmt.all.bind(stmt);
        const originalFirst = stmt.first.bind(stmt);

        // Log queries
        const logQuery = (params: any[] = []) => {
          if (this.config.enableQueryLogging) {
            this.queryLog.push({
              query,
              params,
              timestamp: new Date(),
              connectionId: 'mock-connection'
            });
          }
        };

        // Wrap methods to log queries
        stmt.run = async () => {
          logQuery();
          return originalRun();
        };

        stmt.all = async () => {
          logQuery();
          return originalAll();
        };

        stmt.first = async (colName?: string) => {
          logQuery();
          return originalFirst(colName);
        };

        return stmt;
      };
    }

    return mockDb;
  }

  /**
   * Check if connection is healthy
   */
  private async isConnectionHealthy(connection: DatabaseConnection): Promise<boolean> {
    try {
      const healthCheck = await this.performHealthCheck(connection.connectionId);
      return healthCheck.isHealthy;
    } catch {
      return false;
    }
  }

  /**
   * Wait for an available connection
   */
  private async waitForAvailableConnection(): Promise<DatabaseConnection> {
    const maxWaitTime = this.config.connectionTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      // Check for available connections
      for (const [id, connection] of this.connections) {
        if (connection.isConnected && await this.isConnectionHealthy(connection)) {
          connection.lastUsed = new Date();
          return connection;
        }
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw this.createConnectionError(
      'Timeout waiting for available database connection',
      'CONNECTION_TIMEOUT',
      new Error('No connections available within timeout period'),
      true
    );
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Check connection health every 30 seconds
    this.healthCheckInterval = setInterval(async () => {
      for (const [id, connection] of this.connections) {
        if (connection.isConnected) {
          const isHealthy = await this.isConnectionHealthy(connection);
          if (!isHealthy) {
            connection.isConnected = false;
            console.warn(`Connection ${id} marked as unhealthy`);
          }
        }
      }
    }, 10000);
  }

  /**
   * Create connection error
   */
  private createConnectionError(
    message: string,
    code: string,
    cause: Error,
    retryable: boolean,
    connectionId?: string
  ): DatabaseConnectionError {
    const error = new Error(message) as DatabaseConnectionError;
    error.code = code;
    error.connectionId = connectionId;
    error.retryable = retryable;
    error.cause = cause;
    return error;
  }
}

/**
 * Test Database Manager Factory
 */
export class TestDatabaseManagerFactory {
  /**
   * Create test database manager with default configuration
   */
  static createDefault(): TestDatabaseManager {
    return new TestDatabaseManager();
  }

  /**
   * Create test database manager for CI environment
   */
  static createForCI(): TestDatabaseManager {
    return new TestDatabaseManager({
      poolSize: 2, // Smaller pool for CI
      connectionTimeout: 3000, // Optimized timeout for CI
      queryTimeout: 5000, // Optimized query timeout for CI
      cleanupStrategy: 'drop', // More thorough cleanup for CI
      isolationLevel: 'suite', // Suite-level isolation for CI
      enableQueryLogging: false // Disable logging for CI performance
    });
  }

  /**
   * Create test database manager for local development
   */
  static createForLocal(): TestDatabaseManager {
    return new TestDatabaseManager({
      poolSize: 5, // Larger pool for local development
      connectionTimeout: 3000, // Shorter timeout for local
      queryTimeout: 5000, // Optimized query timeout
      cleanupStrategy: 'truncate', // Faster cleanup for local
      isolationLevel: 'test', // Test-level isolation for local
      enableQueryLogging: true // Enable logging for debugging
    });
  }

  /**
   * Create test database manager with custom configuration
   */
  static createWithConfig(config: Partial<TestDatabaseConfig>): TestDatabaseManager {
    return new TestDatabaseManager(config);
  }
}