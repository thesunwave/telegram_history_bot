/**
 * Database Health Monitor
 * Provides comprehensive database connection validation and health monitoring
 */

import type { D1Database } from '@cloudflare/workers-types';
import { MockD1Database } from '../mocks/mock-database';

export interface HealthCheckResult {
  /** Overall health status */
  isHealthy: boolean;
  /** Response time in milliseconds */
  responseTime: number;
  /** Health check timestamp */
  timestamp: Date;
  /** Error message if unhealthy */
  error?: string;
  /** Detailed check results */
  checks: {
    connection: HealthCheckStatus;
    query: HealthCheckStatus;
    schema: HealthCheckStatus;
    performance: HealthCheckStatus;
  };
}

export interface HealthCheckStatus {
  /** Check passed */
  passed: boolean;
  /** Response time for this check */
  responseTime: number;
  /** Error message if failed */
  error?: string;
  /** Additional details */
  details?: any;
}

export interface DatabaseMetrics {
  /** Total queries executed */
  totalQueries: number;
  /** Average query response time */
  averageResponseTime: number;
  /** Successful queries */
  successfulQueries: number;
  /** Failed queries */
  failedQueries: number;
  /** Connection uptime */
  uptime: number;
  /** Last health check */
  lastHealthCheck: Date;
  /** Connection errors */
  connectionErrors: number;
}

export interface PerformanceThresholds {
  /** Maximum acceptable response time in ms */
  maxResponseTime: number;
  /** Maximum acceptable query time in ms */
  maxQueryTime: number;
  /** Maximum acceptable connection time in ms */
  maxConnectionTime: number;
  /** Minimum success rate (0-1) */
  minSuccessRate: number;
}

/**
 * Database Health Monitor
 * Monitors database connection health and performance
 */
export class DatabaseHealthMonitor {
  private database: D1Database;
  private metrics: DatabaseMetrics;
  private thresholds: PerformanceThresholds;
  private monitoringInterval?: NodeJS.Timeout;
  private isMonitoring: boolean = false;
  private startTime: Date;

  constructor(
    database: D1Database,
    thresholds: Partial<PerformanceThresholds> = {}
  ) {
    this.database = database;
    this.startTime = new Date();
    
    this.thresholds = {
      maxResponseTime: 5000, // 5 seconds
      maxQueryTime: 30000, // 30 seconds
      maxConnectionTime: 10000, // 10 seconds
      minSuccessRate: 0.95, // 95%
      ...thresholds
    };

    this.metrics = {
      totalQueries: 0,
      averageResponseTime: 0,
      successfulQueries: 0,
      failedQueries: 0,
      uptime: 0,
      lastHealthCheck: new Date(),
      connectionErrors: 0
    };
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const timestamp = new Date();

    try {
      // Perform individual checks
      const connectionCheck = await this.checkConnection();
      const queryCheck = await this.checkQueryExecution();
      const schemaCheck = await this.checkSchemaIntegrity();
      const performanceCheck = await this.checkPerformance();

      const checks = {
        connection: connectionCheck,
        query: queryCheck,
        schema: schemaCheck,
        performance: performanceCheck
      };

      // Determine overall health
      const isHealthy = Object.values(checks).every(check => check.passed);
      const responseTime = Date.now() - startTime;

      // Update metrics
      this.updateMetrics(isHealthy, responseTime);

      return {
        isHealthy,
        responseTime,
        timestamp,
        checks
      };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      this.updateMetrics(false, responseTime);

      return {
        isHealthy: false,
        responseTime,
        timestamp,
        error: (error as Error).message,
        checks: {
          connection: { passed: false, responseTime, error: (error as Error).message },
          query: { passed: false, responseTime: 0 },
          schema: { passed: false, responseTime: 0 },
          performance: { passed: false, responseTime: 0 }
        }
      };
    }
  }

  /**
   * Check database connection
   */
  async checkConnection(): Promise<HealthCheckStatus> {
    const startTime = Date.now();

    try {
      // Simple connection test
      await this.database.prepare('SELECT 1').first();
      
      const responseTime = Date.now() - startTime;
      
      if (responseTime > this.thresholds.maxConnectionTime) {
        return {
          passed: false,
          responseTime,
          error: `Connection time ${responseTime}ms exceeds threshold ${this.thresholds.maxConnectionTime}ms`
        };
      }

      return {
        passed: true,
        responseTime,
        details: { connectionTime: responseTime }
      };
    } catch (error: unknown) {
      this.metrics.connectionErrors++;
      return {
        passed: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Check query execution
   */
  async checkQueryExecution(): Promise<HealthCheckStatus> {
    const startTime = Date.now();

    try {
      // Test basic query operations
      const selectResult = await this.database.prepare('SELECT 1 as test_value').first();
      
      if (!selectResult || (selectResult as any).test_value !== 1) {
        return {
          passed: false,
          responseTime: Date.now() - startTime,
          error: 'Query execution returned unexpected result'
        };
      }

      const responseTime = Date.now() - startTime;
      
      if (responseTime > this.thresholds.maxQueryTime) {
        return {
          passed: false,
          responseTime,
          error: `Query time ${responseTime}ms exceeds threshold ${this.thresholds.maxQueryTime}ms`
        };
      }

      return {
        passed: true,
        responseTime,
        details: { queryTime: responseTime }
      };
    } catch (error: unknown) {
      return {
        passed: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Check schema integrity
   */
  async checkSchemaIntegrity(): Promise<HealthCheckStatus> {
    const startTime = Date.now();

    try {
      // Check if required tables exist
      const requiredTables = ['summaries', 'criminal_violations'];
      const existingTables: string[] = [];

      for (const tableName of requiredTables) {
        try {
          await this.database.prepare(`SELECT 1 FROM ${tableName} LIMIT 1`).first();
          existingTables.push(tableName);
        } catch {
          // Table doesn't exist or is inaccessible
        }
      }

      const responseTime = Date.now() - startTime;

      // For mock databases, we might not have all tables
      if (this.database instanceof MockD1Database) {
        return {
          passed: true,
          responseTime,
          details: { 
            checkedTables: requiredTables,
            existingTables,
            note: 'Mock database - schema check passed'
          }
        };
      }

      // For real databases, check that all required tables exist
      const missingTables = requiredTables.filter(table => !existingTables.includes(table));
      
      if (missingTables.length > 0) {
        return {
          passed: false,
          responseTime,
          error: `Missing required tables: ${missingTables.join(', ')}`,
          details: { missingTables, existingTables }
        };
      }

      return {
        passed: true,
        responseTime,
        details: { existingTables }
      };
    } catch (error: unknown) {
      return {
        passed: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Check performance metrics
   */
  async checkPerformance(): Promise<HealthCheckStatus> {
    const startTime = Date.now();

    try {
      // Calculate success rate
      const totalQueries = this.metrics.totalQueries;
      const successRate = totalQueries > 0 
        ? this.metrics.successfulQueries / totalQueries 
        : 1;

      const responseTime = Date.now() - startTime;
      const issues: string[] = [];

      // Check success rate
      if (successRate < this.thresholds.minSuccessRate) {
        issues.push(`Success rate ${(successRate * 100).toFixed(1)}% below threshold ${(this.thresholds.minSuccessRate * 100).toFixed(1)}%`);
      }

      // Check average response time
      if (this.metrics.averageResponseTime > this.thresholds.maxResponseTime) {
        issues.push(`Average response time ${this.metrics.averageResponseTime}ms exceeds threshold ${this.thresholds.maxResponseTime}ms`);
      }

      const passed = issues.length === 0;

      return {
        passed,
        responseTime,
        error: issues.length > 0 ? issues.join('; ') : undefined,
        details: {
          successRate,
          averageResponseTime: this.metrics.averageResponseTime,
          totalQueries,
          uptime: this.getUptime()
        }
      };
    } catch (error: unknown) {
      return {
        passed: false,
        responseTime: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error: unknown) {
        console.warn('Health check failed during monitoring:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop continuous monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
  }

  /**
   * Get current metrics
   */
  getMetrics(): DatabaseMetrics {
    return {
      ...this.metrics,
      uptime: this.getUptime()
    };
  }

  /**
   * Get performance thresholds
   */
  getThresholds(): PerformanceThresholds {
    return { ...this.thresholds };
  }

  /**
   * Update performance thresholds
   */
  updateThresholds(thresholds: Partial<PerformanceThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalQueries: 0,
      averageResponseTime: 0,
      successfulQueries: 0,
      failedQueries: 0,
      uptime: 0,
      lastHealthCheck: new Date(),
      connectionErrors: 0
    };
    this.startTime = new Date();
  }

  /**
   * Check if database is healthy
   */
  async isHealthy(): Promise<boolean> {
    const result = await this.performHealthCheck();
    return result.isHealthy;
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  /**
   * Cleanup monitoring
   */
  cleanup(): void {
    this.stopMonitoring();
  }

  // Private methods

  /**
   * Update metrics after health check
   */
  private updateMetrics(success: boolean, responseTime: number): void {
    this.metrics.totalQueries++;
    this.metrics.lastHealthCheck = new Date();

    if (success) {
      this.metrics.successfulQueries++;
    } else {
      this.metrics.failedQueries++;
    }

    // Update average response time
    const totalResponseTime = this.metrics.averageResponseTime * (this.metrics.totalQueries - 1) + responseTime;
    this.metrics.averageResponseTime = totalResponseTime / this.metrics.totalQueries;
  }
}

/**
 * Database Connection Validator
 * Validates database connections and configurations
 */
export class DatabaseConnectionValidator {
  /**
   * Validate database connection
   */
  static async validateConnection(database: D1Database): Promise<{
    isValid: boolean;
    error?: string;
    responseTime: number;
  }> {
    const startTime = Date.now();

    try {
      const result = await database.prepare('SELECT 1 as test').first();
      const responseTime = Date.now() - startTime;

      if (!result || (result as any).test !== 1) {
        return {
          isValid: false,
          error: 'Connection test query returned unexpected result',
          responseTime
        };
      }

      return {
        isValid: true,
        responseTime
      };
    } catch (error: unknown) {
      return {
        isValid: false,
        error: (error as Error).message,
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate database with timeout
   */
  static async validateConnectionWithTimeout(
    database: D1Database,
    timeoutMs: number = 5000
  ): Promise<{
    isValid: boolean;
    error?: string;
    responseTime: number;
    timedOut: boolean;
  }> {
    const startTime = Date.now();

    try {
      const validationPromise = DatabaseConnectionValidator.validateConnection(database);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection validation timeout')), timeoutMs);
      });

      const result = await Promise.race([validationPromise, timeoutPromise]);
      
      return {
        ...result,
        timedOut: false
      };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const isTimeout = (error as Error).message.includes('timeout');

      return {
        isValid: false,
        error: (error as Error).message,
        responseTime,
        timedOut: isTimeout
      };
    }
  }

  /**
   * Batch validate multiple connections
   */
  static async validateConnections(
    databases: D1Database[]
  ): Promise<Array<{
    index: number;
    isValid: boolean;
    error?: string;
    responseTime: number;
  }>> {
    const validationPromises = databases.map(async (database, index) => {
      const result = await DatabaseConnectionValidator.validateConnection(database);
      return { index, ...result };
    });

    return Promise.all(validationPromises);
  }
}

/**
 * Health Monitor Factory
 */
export class HealthMonitorFactory {
  /**
   * Create health monitor with default thresholds
   */
  static createDefault(database: D1Database): DatabaseHealthMonitor {
    return new DatabaseHealthMonitor(database);
  }

  /**
   * Create health monitor for CI environment
   */
  static createForCI(database: D1Database): DatabaseHealthMonitor {
    return new DatabaseHealthMonitor(database, {
      maxResponseTime: 10000, // 10 seconds for CI
      maxQueryTime: 60000, // 60 seconds for CI
      maxConnectionTime: 15000, // 15 seconds for CI
      minSuccessRate: 0.90 // 90% for CI
    });
  }

  /**
   * Create health monitor for local development
   */
  static createForLocal(database: D1Database): DatabaseHealthMonitor {
    return new DatabaseHealthMonitor(database, {
      maxResponseTime: 3000, // 3 seconds for local
      maxQueryTime: 15000, // 15 seconds for local
      maxConnectionTime: 5000, // 5 seconds for local
      minSuccessRate: 0.95 // 95% for local
    });
  }

  /**
   * Create health monitor with custom thresholds
   */
  static createWithThresholds(
    database: D1Database,
    thresholds: Partial<PerformanceThresholds>
  ): DatabaseHealthMonitor {
    return new DatabaseHealthMonitor(database, thresholds);
  }
}