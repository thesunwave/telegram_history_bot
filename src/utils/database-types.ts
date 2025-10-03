/**
 * Database Type Definitions
 * Provides proper typing for D1 database operations
 */

/**
 * D1 Database result metadata
 */
export interface D1Meta {
  duration: number;
  rows_read: number;
  rows_written: number;
  last_row_id?: number;
  changed_db?: boolean;
  size_after?: number;
}

/**
 * Enhanced database result wrapper with proper typing
 */
export interface DatabaseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: D1Meta;
  executionTime?: number;
  queryInfo?: {
    query: string;
    parameters: (string | number | null)[];
  };
}

/**
 * D1 Database query result
 */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
  error?: string;
}

/**
 * D1 Database single row result
 */
export interface D1SingleResult<T = Record<string, unknown>> {
  success: boolean;
  meta: D1Meta;
  error?: string;
  result?: T;
}

/**
 * D1 Database execution result (for INSERT, UPDATE, DELETE)
 */
export interface D1ExecResult {
  success: boolean;
  meta: D1Meta;
  error?: string;
}

/**
 * Database row types for criminal violations table
 */
export interface CriminalViolationRow {
  id?: number;
  user_id: number;
  chat_id: number;
  article: string;
  subarticle: string | null;
  article_title: string;
  quote: string;
  punishment: string;
  severity: number;
  confidence: number;
  created_at: string;
}

/**
 * Database row types for user statistics queries
 */
export interface UserStatsRow {
  total_violations: number;
  average_severity: number;
  last_violation_date: string | null;
}

/**
 * Database row types for violation count queries
 */
export interface ViolationCountRow {
  article: string;
  subarticle: string | null;
  article_title: string;
  punishment: string;
  count: number;
  average_severity: number;
}

/**
 * Database row types for user violation count queries
 */
export interface UserViolationCountRow {
  user_id: number;
  count: number;
  average_severity: number;
}

/**
 * Database row types for period statistics queries
 */
export interface PeriodStatsRow {
  total_violations: number;
  average_severity: number;
  unique_users: number;
}

/**
 * Type-safe database query builder with fluent interface
 */
export class DatabaseQueryBuilder {
  private query: string = '';
  private params: (string | number | null)[] = [];
  private queryType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | null = null;

  /**
   * Start a SELECT query
   */
  static select(columns: string | string[]): DatabaseQueryBuilder {
    const builder = new DatabaseQueryBuilder();
    builder.queryType = 'SELECT';
    const columnStr = Array.isArray(columns) ? columns.join(', ') : columns;
    builder.query = `SELECT ${columnStr}`;
    return builder;
  }

  /**
   * Start an INSERT query
   */
  static insertInto(table: string): DatabaseQueryBuilder {
    const builder = new DatabaseQueryBuilder();
    builder.queryType = 'INSERT';
    builder.query = `INSERT INTO ${table}`;
    return builder;
  }

  /**
   * Start an UPDATE query
   */
  static update(table: string): DatabaseQueryBuilder {
    const builder = new DatabaseQueryBuilder();
    builder.queryType = 'UPDATE';
    builder.query = `UPDATE ${table}`;
    return builder;
  }

  /**
   * Start a DELETE query
   */
  static deleteFrom(table: string): DatabaseQueryBuilder {
    const builder = new DatabaseQueryBuilder();
    builder.queryType = 'DELETE';
    builder.query = `DELETE FROM ${table}`;
    return builder;
  }

  /**
   * Add FROM clause
   */
  from(table: string): DatabaseQueryBuilder {
    this.query += ` FROM ${table}`;
    return this;
  }

  /**
   * Add WHERE clause
   */
  where(condition: string, ...params: (string | number | null)[]): DatabaseQueryBuilder {
    this.query += ` WHERE ${condition}`;
    this.params.push(...params);
    return this;
  }

  /**
   * Add AND condition
   */
  and(condition: string, ...params: (string | number | null)[]): DatabaseQueryBuilder {
    this.query += ` AND ${condition}`;
    this.params.push(...params);
    return this;
  }

  /**
   * Add OR condition
   */
  or(condition: string, ...params: (string | number | null)[]): DatabaseQueryBuilder {
    this.query += ` OR ${condition}`;
    this.params.push(...params);
    return this;
  }

  /**
   * Add ORDER BY clause
   */
  orderBy(column: string, direction: 'ASC' | 'DESC' = 'ASC'): DatabaseQueryBuilder {
    this.query += ` ORDER BY ${column} ${direction}`;
    return this;
  }

  /**
   * Add LIMIT clause
   */
  limit(count: number): DatabaseQueryBuilder {
    this.query += ` LIMIT ${count}`;
    return this;
  }

  /**
   * Add GROUP BY clause
   */
  groupBy(columns: string | string[]): DatabaseQueryBuilder {
    const columnStr = Array.isArray(columns) ? columns.join(', ') : columns;
    this.query += ` GROUP BY ${columnStr}`;
    return this;
  }

  /**
   * Add VALUES clause for INSERT
   */
  values(values: Record<string, string | number | null>): DatabaseQueryBuilder {
    if (this.queryType !== 'INSERT') {
      throw new Error('VALUES clause can only be used with INSERT queries');
    }

    const columns = Object.keys(values);
    const placeholders = columns.map(() => '?').join(', ');
    const columnStr = columns.join(', ');

    this.query += ` (${columnStr}) VALUES (${placeholders})`;
    this.params.push(...Object.values(values));
    return this;
  }

  /**
   * Add SET clause for UPDATE
   */
  set(updates: Record<string, string | number | null>): DatabaseQueryBuilder {
    if (this.queryType !== 'UPDATE') {
      throw new Error('SET clause can only be used with UPDATE queries');
    }

    const setPairs = Object.keys(updates).map(key => `${key} = ?`);
    this.query += ` SET ${setPairs.join(', ')}`;
    this.params.push(...Object.values(updates));
    return this;
  }

  /**
   * Build the final query with parameters
   */
  build(): { query: string; parameters: (string | number | null)[] } {
    // Validate parameter count matches placeholders
    const placeholderCount = (this.query.match(/\?/g) || []).length;
    if (placeholderCount !== this.params.length) {
      throw new Error(
        `Parameter count mismatch: query has ${placeholderCount} placeholders but ${this.params.length} parameters provided`
      );
    }

    return { 
      query: this.query, 
      parameters: DatabaseQueryBuilder.sanitizeParameters(this.params) 
    };
  }

  /**
   * Build parameterized query with proper type checking (static method)
   */
  static buildQuery(
    query: string,
    parameters: (string | number | null)[]
  ): { query: string; parameters: (string | number | null)[] } {
    // Validate parameter count matches placeholders
    const placeholderCount = (query.match(/\?/g) || []).length;
    if (placeholderCount !== parameters.length) {
      throw new Error(
        `Parameter count mismatch: query has ${placeholderCount} placeholders but ${parameters.length} parameters provided`
      );
    }

    return { query, parameters: this.sanitizeParameters(parameters) };
  }

  /**
   * Validate and sanitize parameters
   */
  static sanitizeParameters(parameters: unknown[]): (string | number | null)[] {
    return parameters.map(param => {
      if (param === null || param === undefined) {
        return null;
      }
      if (typeof param === 'string' || typeof param === 'number') {
        return param;
      }
      if (typeof param === 'boolean') {
        return param ? 1 : 0;
      }
      if (param instanceof Date) {
        return param.toISOString();
      }
      // Convert other types to string
      return String(param);
    });
  }

  /**
   * Create common query templates
   */
  static templates = {
    /**
     * Get violations by user and chat
     */
    getUserViolations: (userId: number, chatId: number) =>
      DatabaseQueryBuilder.select([
        'article', 'subarticle', 'article_title', 'quote', 
        'punishment', 'severity', 'confidence'
      ])
      .from('criminal_violations')
      .where('user_id = ? AND chat_id = ?', userId, chatId)
      .orderBy('created_at', 'DESC')
      .build(),

    /**
     * Get violations by period
     */
    getPeriodViolations: (chatId: number, days: number) => {
      // Build query manually to match expected test format
      const query = `
        SELECT article, subarticle, article_title, quote, punishment, severity, confidence
        FROM criminal_violations 
        WHERE chat_id = ? AND created_at >= datetime('now', '-${days} days')
        ORDER BY created_at DESC
      `;
      
      const parameters = [chatId];
      
      return { query, parameters: DatabaseQueryBuilder.sanitizeParameters(parameters) };
    },

    /**
     * Insert violation
     */
    insertViolation: (violation: {
      userId: number;
      chatId: number;
      article: string;
      subarticle: string | null;
      articleTitle: string;
      quote: string;
      punishment: string;
      severity: number;
      confidence: number;
    }) => {
      // Build query manually to match expected test format
      const query = `
        INSERT INTO criminal_violations (
          user_id, chat_id, article, subarticle, article_title, quote, punishment, 
          severity, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `;
      
      const parameters = [
        violation.userId,
        violation.chatId,
        violation.article,
        violation.subarticle,
        violation.articleTitle,
        violation.quote,
        violation.punishment,
        violation.severity,
        violation.confidence
      ];
      
      return { query, parameters: DatabaseQueryBuilder.sanitizeParameters(parameters) };
    }
  };
}

/**
 * Database result validators and utilities
 */
export class DatabaseResultValidator {
  /**
   * Validate D1 query result structure
   */
  static validateQueryResult<T>(result: unknown): result is D1Result<T> {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const r = result as any;
    return (
      Array.isArray(r.results) &&
      (typeof r.success === 'boolean' || r.success === undefined) &&
      (r.meta === undefined || (r.meta && typeof r.meta === 'object'))
    );
  }

  /**
   * Validate D1 single result structure
   */
  static validateSingleResult<T>(result: unknown): result is D1SingleResult<T> {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const r = result as any;
    return (
      (typeof r.success === 'boolean' || r.success === undefined) &&
      (r.meta === undefined || (r.meta && typeof r.meta === 'object'))
    );
  }

  /**
   * Validate D1 execution result structure
   */
  static validateExecResult(result: unknown): result is D1ExecResult {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const r = result as any;
    return (
      (typeof r.success === 'boolean' || r.success === undefined) &&
      (r.meta === undefined || (r.meta && typeof r.meta === 'object'))
    );
  }

  /**
   * Extract results safely from D1 query result
   */
  static extractResults<T>(result: D1Result<T>): T[] {
    if (!this.validateQueryResult(result)) {
      throw new Error('Invalid database query result structure');
    }
    return result.results || [];
  }

  /**
   * Extract single result safely from D1 single result
   */
  static extractSingleResult<T>(result: D1SingleResult<T>): T | null {
    if (!this.validateSingleResult(result)) {
      throw new Error('Invalid database single result structure');
    }
    return result.result || null;
  }

  /**
   * Create a successful DatabaseResult
   */
  static createSuccess<T>(
    data: T,
    meta?: D1Meta,
    queryInfo?: { query: string; parameters: (string | number | null)[] },
    executionTime?: number
  ): DatabaseResult<T> {
    return {
      success: true,
      data,
      meta,
      queryInfo,
      executionTime
    };
  }

  /**
   * Create a failed DatabaseResult
   */
  static createFailure<T>(
    error: string,
    meta?: D1Meta,
    queryInfo?: { query: string; parameters: (string | number | null)[] },
    executionTime?: number
  ): DatabaseResult<T> {
    return {
      success: false,
      error,
      meta,
      queryInfo,
      executionTime
    };
  }
}

/**
 * Type guards for database operations
 */
export class DatabaseTypeGuards {
  /**
   * Check if DatabaseResult is successful
   */
  static isSuccess<T>(result: DatabaseResult<T>): result is DatabaseResult<T> & { success: true; data: T } {
    return result.success && result.data !== undefined;
  }

  /**
   * Check if DatabaseResult is a failure
   */
  static isFailure<T>(result: DatabaseResult<T>): result is DatabaseResult<T> & { success: false; error: string } {
    return !result.success && result.error !== undefined;
  }

  /**
   * Validate parameter types for database queries
   */
  static validateParameter(param: unknown): param is string | number | null {
    return param === null || typeof param === 'string' || typeof param === 'number';
  }

  /**
   * Validate all parameters in an array
   */
  static validateParameters(params: unknown[]): params is (string | number | null)[] {
    return params.every(param => this.validateParameter(param));
  }
}
/*
*
 * Query validation and optimization utilities
 */
export class QueryValidator {
  /**
   * Validate SQL query for security issues
   */
  static validateQuery(query: string): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];
    const upperQuery = query.toUpperCase();

    // Check for potential SQL injection patterns
    const dangerousPatterns = [
      /;\s*(DROP|DELETE|TRUNCATE|ALTER)\s+/i,
      /UNION\s+SELECT/i,
      /--\s*$/m,
      /\/\*.*\*\//,
      /'\s*OR\s*'1'\s*=\s*'1/i,
      /'\s*OR\s*1\s*=\s*1/i
    ];

    dangerousPatterns.forEach((pattern, index) => {
      if (pattern.test(query)) {
        issues.push(`Potential SQL injection pattern detected (pattern ${index + 1})`);
      }
    });

    // Check for proper parameterization
    if (/'[^']*'/.test(query) && !/\?/.test(query)) {
      issues.push('Query contains string literals instead of parameters');
    }

    // Check for SELECT without WHERE in potentially dangerous operations
    if (upperQuery.includes('DELETE') && !upperQuery.includes('WHERE')) {
      issues.push('DELETE query without WHERE clause detected');
    }

    if (upperQuery.includes('UPDATE') && !upperQuery.includes('WHERE')) {
      issues.push('UPDATE query without WHERE clause detected');
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  /**
   * Analyze query performance characteristics
   */
  static analyzePerformance(query: string): {
    estimatedComplexity: 'low' | 'medium' | 'high';
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    const upperQuery = query.toUpperCase();
    let complexity: 'low' | 'medium' | 'high' = 'low';

    // Check for joins
    if (upperQuery.includes('JOIN')) {
      complexity = 'medium';
      if ((upperQuery.match(/JOIN/g) || []).length > 2) {
        complexity = 'high';
        recommendations.push('Consider breaking complex joins into smaller queries');
      }
    }

    // Check for subqueries
    if ((upperQuery.match(/SELECT/g) || []).length > 1) {
      complexity = 'medium';
      recommendations.push('Consider using JOINs instead of subqueries for better performance');
    }

    // Check for ORDER BY without LIMIT
    if (upperQuery.includes('ORDER BY') && !upperQuery.includes('LIMIT')) {
      recommendations.push('Consider adding LIMIT to ORDER BY queries to improve performance');
    }

    // Check for SELECT *
    if (upperQuery.includes('SELECT *')) {
      recommendations.push('Avoid SELECT * - specify only needed columns');
    }

    // Check for functions in WHERE clause
    if (/WHERE.*\w+\s*\(/.test(upperQuery)) {
      recommendations.push('Avoid functions in WHERE clause - consider using indexes');
    }

    return {
      estimatedComplexity: complexity,
      recommendations
    };
  }
}

/**
 * Query optimization utilities
 */
export class QueryOptimizer {
  /**
   * Optimize a query for better performance
   */
  static optimizeQuery(query: string): {
    optimizedQuery: string;
    optimizations: string[];
  } {
    const optimizedQuery = query;
    const optimizations: string[] = [];

    // Replace SELECT * with specific columns (basic optimization)
    if (optimizedQuery.includes('SELECT *')) {
      // This is a placeholder - in real implementation, we'd need schema info
      optimizations.push('Consider replacing SELECT * with specific columns');
    }

    // Add LIMIT to potentially large result sets
    if (optimizedQuery.toUpperCase().includes('ORDER BY') && 
        !optimizedQuery.toUpperCase().includes('LIMIT')) {
      optimizations.push('Consider adding LIMIT clause to ORDER BY queries');
    }

    // Suggest indexes for WHERE clauses
    const whereMatch = optimizedQuery.match(/WHERE\s+(\w+)\s*=/i);
    if (whereMatch) {
      optimizations.push(`Consider adding index on column: ${whereMatch[1]}`);
    }

    return {
      optimizedQuery,
      optimizations
    };
  }

  /**
   * Generate index recommendations based on query patterns
   */
  static recommendIndexes(queries: string[]): string[] {
    const recommendations = new Set<string>();
    
    queries.forEach(query => {
      const upperQuery = query.toUpperCase();
      
      // Find WHERE clause columns
      const whereMatches = query.match(/WHERE\s+(\w+)\s*[=<>]/gi);
      whereMatches?.forEach(match => {
        const column = match.replace(/WHERE\s+/i, '').replace(/\s*[=<>].*/, '');
        recommendations.add(`CREATE INDEX idx_${column} ON table_name (${column})`);
      });

      // Find ORDER BY columns
      const orderByMatches = query.match(/ORDER BY\s+(\w+)/gi);
      orderByMatches?.forEach(match => {
        const column = match.replace(/ORDER BY\s+/i, '');
        recommendations.add(`CREATE INDEX idx_${column}_sort ON table_name (${column})`);
      });

      // Find JOIN columns
      const joinMatches = query.match(/JOIN\s+\w+\s+ON\s+\w+\.(\w+)\s*=\s*\w+\.(\w+)/gi);
      joinMatches?.forEach(match => {
        // This is simplified - real implementation would be more sophisticated
        recommendations.add('Consider indexes on JOIN columns');
      });
    });

    return Array.from(recommendations);
  }
}

/**
 * Database connection and transaction utilities
 */
export class DatabaseConnectionManager {
  /**
   * Execute query with retry logic for transient failures
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error as Error;
        
        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }
        
        if (attempt === maxRetries) {
          break;
        }
        
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  /**
   * Check if an error is retryable
   */
  private static isRetryableError(error: unknown): boolean {
    if (typeof error === 'object' && error !== null) {
      const errorMessage = (error as any).message?.toLowerCase() || '';
      
      // Common transient error patterns
      const retryablePatterns = [
        'timeout',
        'connection',
        'network',
        'temporary',
        'busy',
        'locked'
      ];
      
      return retryablePatterns.some(pattern => errorMessage.includes(pattern));
    }
    
    return false;
  }

  /**
   * Execute multiple queries in a transaction-like manner
   * Note: D1 doesn't support transactions yet, but this provides a pattern
   */
  static async executeBatch<T>(
    operations: (() => Promise<T>)[],
    onError?: (error: Error, operationIndex: number) => Promise<void>
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < operations.length; i++) {
      try {
        const result = await operations[i]();
        results.push(result);
      } catch (error: unknown) {
        if (onError) {
          await onError(error as Error, i);
        }
        throw error;
      }
    }
    
    return results;
  }
}