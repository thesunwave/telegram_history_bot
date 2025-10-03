/**
 * Mock Database Implementation
 * Provides comprehensive mock D1 database for testing
 */

import { vi } from 'vitest';
import type { D1Database, D1Result, D1PreparedStatement } from '@cloudflare/workers-types';
import { DatabaseFixtures } from '../fixtures/database-fixtures';
import type { CriminalViolationRow } from '../../src/utils/database-types';

/**
 * Mock D1 Prepared Statement
 */
export class MockD1PreparedStatement implements D1PreparedStatement {
  private query: string;
  private params: any[] = [];
  private mockDatabase: MockD1Database;

  constructor(query: string, mockDatabase: MockD1Database) {
    this.query = query;
    this.mockDatabase = mockDatabase;
  }

  bind(...params: any[]): D1PreparedStatement {
    this.params = params;
    return this;
  }

  async first<T = Record<string, unknown>>(colName?: string): Promise<any> {
    const result = await this.mockDatabase.executeQuery(this.query, this.params);
    if (result.results && result.results.length > 0) {
      const row = result.results[0] as T;
      const data = colName ? (row as any)[colName] : row;
      // Return D1SingleResult format
      return {
        success: true,
        meta: result.meta,
        result: data
      };
    }
    // Return D1SingleResult format for null case
    return {
      success: true,
      meta: result.meta,
      result: null
    };
  }

  async run(): Promise<D1Result> {
    return this.mockDatabase.executeQuery(this.query, this.params);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.mockDatabase.executeQuery(this.query, this.params) as Promise<D1Result<T>>;
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const result = await this.mockDatabase.executeQuery(this.query, this.params);
    return result.results as T[];
  }
}

/**
 * Mock D1 Database Implementation
 */
export class MockD1Database implements D1Database {
  private data: Map<string, any[]> = new Map();
  private shouldFail: boolean = false;
  private failureError: string = 'Database error';
  private queryDelay: number = 0;
  private queryLog: Array<{ query: string; params: any[]; timestamp: Date }> = [];

  // Mock functions for testing
  public prepare = vi.fn().mockImplementation((query: string) => {
    return new MockD1PreparedStatement(query, this);
  });

  public dump = vi.fn().mockResolvedValue(new ArrayBuffer(0));

  public batch = vi.fn().mockImplementation(async (statements: D1PreparedStatement[]) => {
    const results = [];
    for (const stmt of statements) {
      const result = await (stmt as MockD1PreparedStatement).run();
      results.push(result);
    }
    return results;
  });

  public exec = vi.fn().mockImplementation(async (query: string) => {
    return this.executeQuery(query, []);
  });

  public withSession = vi.fn().mockImplementation(async <T>(callback: (db: D1Database) => Promise<T>): Promise<T> => {
    return callback(this);
  });

  /**
   * Execute query with mock data
   */
  async executeQuery(query: string, params: any[] = []): Promise<D1Result> {
    // Log query for debugging
    this.queryLog.push({ query, params, timestamp: new Date() });

    // Simulate delay if configured
    if (this.queryDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.queryDelay));
    }

    // Simulate failure if configured
    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const upperQuery = query.toUpperCase().trim();

    // Handle SELECT queries
    if (upperQuery.startsWith('SELECT')) {
      return this.handleSelectQuery(query, params);
    }

    // Handle INSERT queries
    if (upperQuery.startsWith('INSERT')) {
      return this.handleInsertQuery(query, params);
    }

    // Handle UPDATE queries
    if (upperQuery.startsWith('UPDATE')) {
      return this.handleUpdateQuery(query, params);
    }

    // Handle DELETE queries
    if (upperQuery.startsWith('DELETE')) {
      return this.handleDeleteQuery(query, params);
    }

    // Default response
    return DatabaseFixtures.D1Result.createD1Result([]);
  }

  /**
   * Handle SELECT queries
   */
  private handleSelectQuery(query: string, params: any[]): D1Result {
    const upperQuery = query.toUpperCase();

    // Handle criminal violations queries
    if (upperQuery.includes('CRIMINAL_VIOLATIONS')) {
      const violations = this.data.get('criminal_violations') || [];
      let filteredViolations = [...violations];

      // Apply WHERE conditions
      if (upperQuery.includes('WHERE')) {
        filteredViolations = this.applyWhereConditions(filteredViolations, query, params);
      }

      // Handle GROUP BY for statistics FIRST (so ORDER BY and LIMIT apply to grouped results)
      if (upperQuery.includes('GROUP BY')) {
        return this.handleGroupByQuery(filteredViolations, query, params);
      }

      // Handle aggregate queries (non-grouped)
      if (upperQuery.includes('COUNT(') || upperQuery.includes('AVG(') || upperQuery.includes('MAX(')) {
        console.log('Processing aggregate query:', query);
        console.log('Filtered violations count:', filteredViolations.length);
        
        const row: Record<string, any> = {};

        // COUNT(*) AS <alias>
        const countAliasMatch = query.match(/COUNT\s*\(\s*\*\s*\)\s+[aA][sS]\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
        const countVal = filteredViolations.length;
        console.log('Count alias match:', countAliasMatch);
        if (countAliasMatch) {
          row[countAliasMatch[1]] = countVal;
          console.log('Set count field:', countAliasMatch[1], '=', countVal);
        } else if (upperQuery.includes('COUNT(')) {
          // Fallback to generic name if no alias provided
          row.count = countVal;
          console.log('Set fallback count =', countVal);
        }

        // AVG(severity) AS <alias>
        const avgSeverityMatch = query.match(/AVG\s*\(\s*[sS][eE][vV][eE][rR][iI][tT][yY]\s*\)\s+[aA][sS]\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
        console.log('Avg severity match:', avgSeverityMatch);
        if (avgSeverityMatch) {
          const sum = filteredViolations.reduce((acc, v) => acc + (Number(v.severity) || 0), 0);
          const avg = filteredViolations.length > 0 ? sum / filteredViolations.length : 0;
          row[avgSeverityMatch[1]] = avg;
          console.log('Set avg field:', avgSeverityMatch[1], '=', avg);
        }

        // MAX(created_at) AS <alias>
        const maxCreatedAtMatch = query.match(/MAX\s*\(\s*[cC][rR][eE][aA][tT][eE][dD]_[aA][tT]\s*\)\s+[aA][sS]\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
        console.log('Max created_at match:', maxCreatedAtMatch);
        if (maxCreatedAtMatch) {
          const max = filteredViolations.reduce((maxVal: string | null, v: any) => {
            const d = v.created_at;
            if (maxVal == null) return d;
            return new Date(d) > new Date(maxVal) ? d : maxVal;
          }, null as string | null);
          row[maxCreatedAtMatch[1]] = max;
          console.log('Set max field:', maxCreatedAtMatch[1], '=', max);
        }

        console.log('Final aggregate row:', row);
        return DatabaseFixtures.D1Result.createD1Result([row]);
      }

      // Apply ORDER BY (non-grouped)
      if (upperQuery.includes('ORDER BY')) {
        filteredViolations = this.applyOrderBy(filteredViolations, query);
      }

      // Apply LIMIT (non-grouped), supports numeric and parameterized forms
      if (upperQuery.includes('LIMIT')) {
        const limitMatch = query.match(/LIMIT\s+(\?|\d+)/i);
        if (limitMatch) {
          let limit = 0;
          if (limitMatch[1] === '?') {
            const before = query.slice(0, limitMatch.index!);
            const qmCount = (before.match(/\?/g) || []).length;
            const paramVal = params[qmCount];
            limit = typeof paramVal === 'number' ? paramVal : parseInt(String(paramVal), 10);
          } else {
            limit = parseInt(limitMatch[1]);
          }
          if (!Number.isNaN(limit) && limit >= 0) {
            filteredViolations = filteredViolations.slice(0, limit);
          }
        }
      }

      return DatabaseFixtures.D1Result.createD1Result(filteredViolations);
    }

    // Default empty result
    return DatabaseFixtures.D1Result.createEmptyResult();
  }

  /**
   * Handle GROUP BY queries for statistics
   */
  private handleGroupByQuery(data: any[], query: string, params: any[]): D1Result {
    const upperQuery = query.toUpperCase();
    
    if (upperQuery.includes('GROUP BY ARTICLE')) {
      const grouped = data.reduce((acc, item) => {
        const key = item.article;
        if (!acc[key]) {
          acc[key] = {
            article: item.article,
            article_title: item.article_title,
            punishment: item.punishment,
            count: 0,
            total_severity: 0
          };
        }
        acc[key].count++;
        acc[key].total_severity += item.severity;
        return acc;
      }, {} as Record<string, any>);

      let results = Object.values(grouped).map((group: any) => ({
        ...group,
        average_severity: group.total_severity / group.count
      }));

      // Apply ORDER BY on grouped results if present
      if (upperQuery.includes('ORDER BY')) {
        results = this.applyOrderBy(results, query);
      }

      // Apply LIMIT on grouped results if present, supports parameterized limit
      if (upperQuery.includes('LIMIT')) {
        const limitMatch = query.match(/LIMIT\s+(\?|\d+)/i);
        if (limitMatch) {
          let limit = 0;
          if (limitMatch[1] === '?') {
            const before = query.slice(0, limitMatch.index!);
            const qmCount = (before.match(/\?/g) || []).length;
            const paramVal = params[qmCount];
            limit = typeof paramVal === 'number' ? paramVal : parseInt(String(paramVal), 10);
          } else {
            limit = parseInt(limitMatch[1]);
          }
          if (!Number.isNaN(limit) && limit >= 0) {
            results = results.slice(0, limit);
          }
        }
      }

      return DatabaseFixtures.D1Result.createD1Result(results);
    }

    if (upperQuery.includes('GROUP BY USER_ID')) {
      const grouped = data.reduce((acc, item) => {
        const key = item.user_id;
        if (!acc[key]) {
          acc[key] = {
            user_id: item.user_id,
            count: 0,
            total_severity: 0
          };
        }
        acc[key].count++;
        acc[key].total_severity += item.severity;
        return acc;
      }, {} as Record<string, any>);

      let results = Object.values(grouped).map((group: any) => ({
        ...group,
        average_severity: group.total_severity / group.count
      }));

      // Apply ORDER BY on grouped results if present
      if (upperQuery.includes('ORDER BY')) {
        results = this.applyOrderBy(results, query);
      }

      // Apply LIMIT on grouped results if present, supports parameterized limit
      if (upperQuery.includes('LIMIT')) {
        const limitMatch = query.match(/LIMIT\s+(\?|\d+)/i);
        if (limitMatch) {
          let limit = 0;
          if (limitMatch[1] === '?') {
            const before = query.slice(0, limitMatch.index!);
            const qmCount = (before.match(/\?/g) || []).length;
            const paramVal = params[qmCount];
            limit = typeof paramVal === 'number' ? paramVal : parseInt(String(paramVal), 10);
          } else {
            limit = parseInt(limitMatch[1]);
          }
          if (!Number.isNaN(limit) && limit >= 0) {
            results = results.slice(0, limit);
          }
        }
      }

      return DatabaseFixtures.D1Result.createD1Result(results);
    }

    // Fallback: no recognized grouping, just return as-is
    return DatabaseFixtures.D1Result.createD1Result(data);
  }

  /**
   * Handle INSERT queries
   */
  private handleInsertQuery(query: string, params: any[]): D1Result {
    const upperQuery = query.toUpperCase();

    if (upperQuery.includes('CRIMINAL_VIOLATIONS')) {
      const violations = this.data.get('criminal_violations') || [];
      
      // Create new violation record
      const newViolation: CriminalViolationRow = {
        id: violations.length + 1,
        user_id: params[0],
        chat_id: params[1],
        article: params[2],
        subarticle: params[3],
        article_title: params[4],
        quote: params[5],
        punishment: params[6],
        severity: params[7],
        confidence: params[8],
        created_at: params[9] || new Date().toISOString()
      };

      violations.push(newViolation);
      this.data.set('criminal_violations', violations);

      return DatabaseFixtures.D1Result.createD1ExecResult({
        meta: DatabaseFixtures.Meta.createInsertMeta()
      });
    }

    return DatabaseFixtures.D1Result.createD1ExecResult();
  }

  /**
   * Handle UPDATE queries
   */
  private handleUpdateQuery(query: string, params: any[]): D1Result {
    const upperQuery = query.toUpperCase();

    if (upperQuery.includes('CRIMINAL_VIOLATIONS')) {
      const violations = this.data.get('criminal_violations') || [];
      let updatedCount = 0;

      // Simple update logic - this could be enhanced
      violations.forEach((violation: any) => {
        if (this.matchesWhereCondition(violation, query, params)) {
          // Update fields based on SET clause
          updatedCount++;
        }
      });

      return DatabaseFixtures.D1Result.createD1ExecResult({
        meta: DatabaseFixtures.Meta.createUpdateMeta(updatedCount)
      });
    }

    return DatabaseFixtures.D1Result.createD1ExecResult();
  }

  /**
   * Handle DELETE queries
   */
  private handleDeleteQuery(query: string, params: any[]): D1Result {
    const upperQuery = query.toUpperCase();

    if (upperQuery.includes('CRIMINAL_VIOLATIONS')) {
      const violations = this.data.get('criminal_violations') || [];
      const originalLength = violations.length;

      // Filter out matching records
      const filteredViolations = violations.filter((violation: any) => 
        !this.matchesWhereCondition(violation, query, params)
      );

      this.data.set('criminal_violations', filteredViolations);
      const deletedCount = originalLength - filteredViolations.length;

      return DatabaseFixtures.D1Result.createD1ExecResult({
        meta: DatabaseFixtures.Meta.createDeleteMeta(deletedCount)
      });
    }

    return DatabaseFixtures.D1Result.createD1ExecResult();
  }

  /**
   * Apply WHERE conditions to filter results
   */
  private applyWhereConditions(data: any[], query: string, params: any[]): any[] {
    return data.filter(item => this.matchesWhereCondition(item, query, params));
  }

  /**
   * Check if item matches WHERE condition
   */
  private matchesWhereCondition(item: any, query: string, params: any[]): boolean {
    const upperQuery = query.toUpperCase();

    // Helper: find parameter index for a given pattern by counting preceding '?'
    const findParamIndex = (q: string, pattern: RegExp): number => {
      const m = q.match(pattern);
      if (!m || m.index == null) return -1;
      const before = q.slice(0, m.index);
      return (before.match(/\?/g) || []).length;
    };

    // USER_ID = ?
    const userIdIdx = findParamIndex(query, /USER_ID\s*=\s*\?/i);
    if (userIdIdx >= 0 && params[userIdIdx] !== undefined) {
      if (item.user_id !== params[userIdIdx]) return false;
    }

    // CHAT_ID = ?
    const chatIdIdx = findParamIndex(query, /CHAT_ID\s*=\s*\?/i);
    if (chatIdIdx >= 0 && params[chatIdIdx] !== undefined) {
      if (item.chat_id !== params[chatIdIdx]) return false;
    }

    // ARTICLE = ?
    const articleIdx = findParamIndex(query, /ARTICLE\s*=\s*\?/i);
    if (articleIdx >= 0 && params[articleIdx] !== undefined) {
      if (item.article !== params[articleIdx]) return false;
    }

    // CREATED_AT >= ? (parameterized)
    const createdAtParamIdx = findParamIndex(query, /CREATED_AT\s*> =\s*\?/i);
    if (createdAtParamIdx >= 0 && params[createdAtParamIdx] !== undefined) {
      const itemDate = new Date(item.created_at);
      const filterDate = new Date(params[createdAtParamIdx]);
      if (Number.isNaN(filterDate.getTime())) return false;
      if (itemDate < filterDate) return false;
    }

    // CREATED_AT <= ? (parameterized)
    const createdAtLteParamIdx = findParamIndex(query, /CREATED_AT\s*<=\s*\?/i);
    if (createdAtLteParamIdx >= 0 && params[createdAtLteParamIdx] !== undefined) {
      const itemDate = new Date(item.created_at);
      const filterDate = new Date(params[createdAtLteParamIdx]);
      if (Number.isNaN(filterDate.getTime())) return false;
      if (itemDate > filterDate) return false;
    }

    // CREATED_AT >= datetime('now', '-X days') (inline literal)
    if (/CREATED_AT\s*>=\s*DATETIME\(/i.test(upperQuery)) {
      const inlineDaysMatch = query.match(/CREATED_AT\s*>=\s*DATETIME\(\s*'NOW'\s*,\s*'-([0-9]+)\s+DAYS'\s*\)/i);
      if (inlineDaysMatch) {
        const days = parseInt(inlineDaysMatch[1], 10);
        if (!Number.isNaN(days)) {
          const now = new Date();
          const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
          const itemDate = new Date(item.created_at);
          if (itemDate < threshold) return false;
        }
      }
    }

    // CREATED_AT >= datetime('now', '-' || ? || ' days') (parameterized days)
    const paramDaysPattern = /CREATED_AT\s*>=\s*DATETIME\(\s*'NOW'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*'\s*DAYS'\s*\)/i;
    if (paramDaysPattern.test(query)) {
      const daysParamIdx = findParamIndex(query, paramDaysPattern);
      if (daysParamIdx >= 0 && params[daysParamIdx] !== undefined) {
        const days = parseInt(String(params[daysParamIdx]), 10);
        if (!Number.isNaN(days)) {
          const now = new Date();
          const threshold = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
          const itemDate = new Date(item.created_at);
          if (itemDate < threshold) return false;
        }
      }
    }

    return true;
  }

  /**
   * Apply ORDER BY to results
   */
  private applyOrderBy(data: any[], query: string): any[] {
    const orderByMatch = query.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
    if (!orderByMatch) return data;

    const column = orderByMatch[1].toLowerCase();
    const direction = (orderByMatch[2] || 'ASC').toUpperCase();

    return [...data].sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];
      
      let comparison = 0;
      if (aVal < bVal) comparison = -1;
      else if (aVal > bVal) comparison = 1;
      
      return direction === 'DESC' ? -comparison : comparison;
    });
  }

  /**
   * Seed database with test data
   */
  seedData(tableName: string, data: any[]): void {
    this.data.set(tableName, [...data]);
  }

  /**
   * Clear all data
   */
  clearData(): void {
    this.data.clear();
    this.queryLog = [];
  }

  /**
   * Get data for table
   */
  getData(tableName: string): any[] {
    return this.data.get(tableName) || [];
  }

  /**
   * Configure database to fail
   */
  configureFail(shouldFail: boolean, error: string = 'Database error'): void {
    this.shouldFail = shouldFail;
    this.failureError = error;
  }

  /**
   * Configure query delay
   */
  configureDelay(delay: number): void {
    this.queryDelay = delay;
  }

  /**
   * Get query log
   */
  getQueryLog(): Array<{ query: string; params: any[]; timestamp: Date }> {
    return [...this.queryLog];
  }

  /**
   * Clear query log
   */
  clearQueryLog(): void {
    this.queryLog = [];
  }

  /**
   * Get query count
   */
  getQueryCount(): number {
    return this.queryLog.length;
  }

  /**
   * Reset all mocks and data
   */
  reset(): void {
    this.clearData();
    this.clearQueryLog();
    this.shouldFail = false;
    this.queryDelay = 0;
    vi.clearAllMocks();
  }
}

/**
 * Database Mock Factory
 */
export class DatabaseMockFactory {
  /**
   * Create empty mock database
   */
  static createEmptyDatabase(): MockD1Database {
    return new MockD1Database();
  }

  /**
   * Create database with realistic test data
   */
  static createRealisticDatabase(): MockD1Database {
    const db = new MockD1Database();
    
    // Seed with realistic criminal violations data
    const violations = DatabaseFixtures.Seeding.createCriminalViolationsSeedData(-1001234567890, 5, 3);
    db.seedData('criminal_violations', violations);
    
    return db;
  }

  /**
   * Create database with high activity data
   */
  static createHighActivityDatabase(): MockD1Database {
    const db = new MockD1Database();
    
    // Seed with high activity data
    const violations = DatabaseFixtures.Seeding.createScenarioSeedData('high-activity', -1001234567890);
    db.seedData('criminal_violations', violations);
    
    return db;
  }

  /**
   * Create database that fails operations
   */
  static createFailingDatabase(error: string = 'Database connection failed'): MockD1Database {
    const db = new MockD1Database();
    db.configureFail(true, error);
    return db;
  }

  /**
   * Create slow database for performance testing
   */
  static createSlowDatabase(delay: number = 1000): MockD1Database {
    const db = new MockD1Database();
    db.configureDelay(delay);
    return db;
  }

  /**
   * Create database with specific scenario
   */
  static createScenarioDatabase(scenario: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow'): MockD1Database {
    switch (scenario) {
      case 'empty':
        return this.createEmptyDatabase();
      case 'realistic':
        return this.createRealisticDatabase();
      case 'high-activity':
        return this.createHighActivityDatabase();
      case 'failing':
        return this.createFailingDatabase();
      case 'slow':
        return this.createSlowDatabase();
      default:
        return this.createEmptyDatabase();
    }
  }
}

/**
 * Database test helpers
 */
export class DatabaseTestHelpers {
  /**
   * Verify query was executed
   */
  static verifyQueryExecuted(db: MockD1Database, queryPattern: string | RegExp): boolean {
    const log = db.getQueryLog();
    return log.some(entry => {
      if (typeof queryPattern === 'string') {
        return entry.query.toUpperCase().includes(queryPattern.toUpperCase());
      }
      return queryPattern.test(entry.query);
    });
  }

  /**
   * Get queries matching pattern
   */
  static getQueriesMatching(db: MockD1Database, queryPattern: string | RegExp): Array<{ query: string; params: any[]; timestamp: Date }> {
    const log = db.getQueryLog();
    return log.filter(entry => {
      if (typeof queryPattern === 'string') {
        return entry.query.toUpperCase().includes(queryPattern.toUpperCase());
      }
      return queryPattern.test(entry.query);
    });
  }

  /**
   * Assert query count
   */
  static assertQueryCount(db: MockD1Database, expectedCount: number): void {
    const actualCount = db.getQueryCount();
    if (actualCount !== expectedCount) {
      throw new Error(`Expected ${expectedCount} queries, got ${actualCount}`);
    }
  }

  /**
   * Assert table has expected row count
   */
  static assertTableRowCount(db: MockD1Database, tableName: string, expectedCount: number): void {
    const data = db.getData(tableName);
    if (data.length !== expectedCount) {
      throw new Error(`Expected ${expectedCount} rows in ${tableName}, got ${data.length}`);
    }
  }

  /**
   * Create database with test scenario
   */
  static async withTestDatabase<T>(
    scenario: 'empty' | 'realistic' | 'high-activity' | 'failing' | 'slow',
    testFn: (db: MockD1Database) => Promise<T>
  ): Promise<T> {
    const db = DatabaseMockFactory.createScenarioDatabase(scenario);
    
    try {
      return await testFn(db);
    } finally {
      db.reset();
    }
  }
}