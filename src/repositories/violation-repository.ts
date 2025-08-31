/**
 * ViolationRepository для хранения данных о нарушениях
 * Реализует методы для сохранения и получения статистики нарушений
 */

import type { Env } from '../env';
import type {
  Violation,
  UserStats,
  PeriodStats,
  GeneralStats,
  ViolationCount,
  UserViolationCount,
  PeriodComparison
} from '../models/statistics';
import { ValidationUtils, validateViolation } from '../models/validation';
import {
  DatabaseError,
  ErrorHandler,
  Result,
  success,
  failure,
  TypeGuards
} from '../utils/errors';
import {
  D1Result,
  D1SingleResult,
  D1ExecResult,
  CriminalViolationRow,
  UserStatsRow,
  ViolationCountRow,
  UserViolationCountRow,
  PeriodStatsRow,
  DatabaseResult,
  DatabaseQueryBuilder,
  DatabaseResultValidator,
  DatabaseTypeGuards,
  DatabaseConnectionManager,
  QueryValidator
} from '../utils/database-types';
import { DatabasePerformanceMonitor } from '../utils/database-performance';
import { performanceMonitor } from '../utils/performance-monitor';

/**
 * Интерфейс репозитория для работы с нарушениями
 * Maintains backward compatibility by returning data directly or throwing errors
 */
export interface IViolationRepository {
  save(violation: Violation, userId: string, chatId: string): Promise<void>;
  // Overloads: numeric arguments return Result, string arguments return raw array
  getUserViolations(userId: string, chatId: string): Promise<Violation[]>;
  getUserViolations(userId: number, chatId: number): Promise<Result<Violation[]>>;
  getPeriodViolations(chatId: string, days: number): Promise<Violation[]>;
  getAllViolations(chatId: string): Promise<Violation[]>;

  // Методы для статистики
  getUserStats(userId: string, chatId: string): Promise<UserStats>;
  getPeriodStats(chatId: string, days: number): Promise<PeriodStats>;
  getGeneralStats(chatId: string): Promise<GeneralStats>;
}

/**
 * Реализация репозитория для работы с нарушениями в D1 Database
 */
export class ViolationRepository implements IViolationRepository {
  private performanceThresholds = {
    save: 1000, // 1 second
    query: 500, // 500ms
    stats: 1000 // 1 second for complex stats queries
  };

  constructor(private env: Env) { }

  /**
   * Log performance metrics for database operations
   */
  private logPerformanceMetrics(
    operation: string,
    executionTime: number,
    threshold: number,
    context?: Record<string, unknown>
  ): void {
    if (executionTime > threshold) {
      console.warn(`Slow database operation detected: ${operation} took ${executionTime}ms`, {
        operation,
        executionTime,
        threshold,
        context
      });
    } else if (executionTime > threshold * 0.8) {
      console.info(`Database operation approaching threshold: ${operation} took ${executionTime}ms`, {
        operation,
        executionTime,
        threshold,
        context
      });
    }
  }

  /**
   * Execute database operation with comprehensive error handling and monitoring
   */
  private async executeWithMonitoring<T>(
    operation: () => Promise<T>,
    operationName: string,
    threshold: number,
    context?: Record<string, unknown>
  ): Promise<T> {
    const startTime = Date.now();

    try {
      const result = await DatabaseConnectionManager.executeWithRetry(operation);
      const executionTime = Date.now() - startTime;

      this.logPerformanceMetrics(operationName, executionTime, threshold, context);

      return result;
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;

      console.error(`Database operation failed: ${operationName}`, {
        operationName,
        executionTime,
        error: error instanceof Error ? error.message : String(error),
        context
      });

      throw error;
    }
  }

  /**
   * Сохранить нарушение в базе данных
   */
  async save(violation: Violation, userId: string, chatId: string): Promise<void> {
    const result = await ErrorHandler.handle(async () => {
      const perfId = performanceMonitor.startOperation('ViolationRepository.save', {
        userId,
        chatId,
        article: violation.article,
        severity: violation.severity
      });
      
      const startTime = Date.now();

      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'save_violation', userId, chatId }
        });
      }

      // Validate input parameters
      if (!TypeGuards.isString(userId) || !TypeGuards.isString(chatId)) {
        throw new DatabaseError('Invalid user ID or chat ID', {
          context: { userId, chatId, operation: 'save_violation' }
        });
      }

      const userIdNum = parseInt(userId);
      const chatIdNum = parseInt(chatId);

      if (!TypeGuards.isNumber(userIdNum) || !TypeGuards.isNumber(chatIdNum)) {
        throw new DatabaseError('User ID and chat ID must be valid numbers', {
          context: { userId, chatId, userIdNum, chatIdNum, operation: 'save_violation' }
        });
      }

      // Validate violation data
      try {
        validateViolation(violation);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown validation error';
        throw new DatabaseError(`Violation validation failed: ${message}`, {
          context: { violation, operation: 'save_violation', validationError: message }
        });
      }

      // Use query builder for type-safe query construction
      const { query, parameters } = DatabaseQueryBuilder.templates.insertViolation({
        userId: userIdNum,
        chatId: chatIdNum,
        article: violation.article,
        subarticle: violation.subarticle || null,
        articleTitle: violation.articleTitle || '',
        quote: violation.quote,
        punishment: violation.punishment,
        severity: violation.severity,
        confidence: violation.confidence
      });

      // Validate query for security
      const validation = QueryValidator.validateQuery(query);
      if (!validation.isValid) {
        throw new DatabaseError('Query validation failed', {
          query,
          parameters,
          context: { operation: 'save_violation', issues: validation.issues }
        });
      }

      // Execute with retry logic for transient failures
      const result = await DatabasePerformanceMonitor.monitorDatabaseOperation(
        'save_violation',
        'INSERT',
        query,
        parameters,
        async () => {
          const stmt = this.env.DB!.prepare(query);
          return await stmt.bind(...parameters).run();
        },
        { userId, chatId, article: violation.article }
      );

      const executionTime = Date.now() - startTime;

      if (!DatabaseResultValidator.validateExecResult(result)) {
        performanceMonitor.endOperation(perfId, {
          queryType: 'INSERT',
          errorType: 'ValidationError'
        });
        throw new DatabaseError('Invalid database execution result', {
          query,
          parameters,
          context: { operation: 'save_violation', userId, chatId, executionTime }
        });
      }

      if (result.success === false) {
        performanceMonitor.endOperation(perfId, {
          queryType: 'INSERT',
          errorType: 'DatabaseExecutionError'
        });
        throw new DatabaseError(result.error || 'Database execution failed', {
          query,
          parameters,
          context: { operation: 'save_violation', userId, chatId, executionTime }
        });
      }

      // End performance monitoring
      performanceMonitor.endOperation(perfId, {
        queryType: 'INSERT',
        rowsAffected: result.meta?.rows_written || 1
      });

      // Log performance metrics
      if (executionTime > 1000) {
        console.warn(`Slow database operation detected: save_violation took ${executionTime}ms`);
      }
    }, {
      operationName: 'ViolationRepository.save',
      context: { userId, chatId, violation }
    });

    // Maintain backward compatibility by throwing errors instead of returning Result
    if (!result.success) {
      const errorMessage = result.error?.message || 'Save operation failed';
      throw new Error(`Failed to save violation: ${errorMessage}`);
    }
  }

  /**
   * Получить все нарушения пользователя в чате
   */
  async getUserViolations(userId: string, chatId: string): Promise<Violation[]>;
  async getUserViolations(userId: number, chatId: number): Promise<Result<Violation[]>>;
  async getUserViolations(
    userId: string | number,
    chatId: string | number
  ): Promise<Violation[] | Result<Violation[]>> {
    const numericMode = typeof userId === 'number' && typeof chatId === 'number';

    const result = await ErrorHandler.handle(async () => {
      const perfId = performanceMonitor.startOperation('ViolationRepository.getUserViolations', {
        userId,
        chatId
      });
      
      const startTime = Date.now();

      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'get_user_violations', userId, chatId }
        });
      }

      // Validate input parameters
      const userIdNum = typeof userId === 'number' ? userId : parseInt(userId);
      const chatIdNum = typeof chatId === 'number' ? chatId : parseInt(chatId);

      if (!TypeGuards.isNumber(userIdNum) || !TypeGuards.isNumber(chatIdNum)) {
        throw new DatabaseError('User ID and chat ID must be valid numbers', {
          context: { userId, chatId, userIdNum, chatIdNum, operation: 'get_user_violations' }
        });
      }

      // Use query builder template
      const { query, parameters } = DatabaseQueryBuilder.templates.getUserViolations(userIdNum, chatIdNum);

      // Validate query
      const validation = QueryValidator.validateQuery(query);
      if (!validation.isValid) {
        throw new DatabaseError('Query validation failed', {
          query,
          parameters,
          context: { operation: 'get_user_violations', issues: validation.issues }
        });
      }

      // Execute with retry logic
      const queryResult = await DatabaseConnectionManager.executeWithRetry(async () => {
        const stmt = this.env.DB!.prepare(query);
        return await stmt.bind(...parameters).all();
      });

      const executionTime = Date.now() - startTime;

      if (!DatabaseResultValidator.validateQueryResult(queryResult)) {
        throw new DatabaseError('Invalid database query result', {
          query,
          parameters,
          context: { operation: 'get_user_violations', userId, chatId, executionTime }
        });
      }

      if (queryResult.success === false) {
        throw new DatabaseError(queryResult.error || 'Database query failed', {
          query,
          parameters,
          context: { operation: 'get_user_violations', userId, chatId, executionTime }
        });
      }

      const violations: Violation[] = DatabaseResultValidator.extractResults(queryResult).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

      // End performance monitoring
      performanceMonitor.endOperation(perfId, {
        queryType: 'SELECT',
        rowsAffected: violations.length
      });

      // Log performance metrics
      if (executionTime > 500) {
        console.warn(`Slow database operation detected: get_user_violations took ${executionTime}ms`);
      }

      return violations;
    }, {
      operationName: 'ViolationRepository.getUserViolations',
      context: { userId, chatId }
    });

    // Maintain dual compatibility
    if (numericMode) {
      // Return Result<Violation[]> as-is for numeric arguments (integration tests)
      return result;
    }

    // String arguments: preserve old behavior (return data or throw)
    if (!result.success) {
      const errorMessage = result.error?.message || 'Get user violations operation failed';
      throw new Error(`Failed to get user violations: ${errorMessage}`);
    }
    return result.data || [];
  }

  /**
   * Получить нарушения за определенный период
   */
  async getPeriodViolations(chatId: string, days: number): Promise<Violation[]> {
    const result = await ErrorHandler.handle(async () => {
      const startTime = Date.now();

      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'get_period_violations', chatId, days }
        });
      }

      // Validate input parameters
      const chatIdNum = parseInt(chatId);

      if (!TypeGuards.isNumber(chatIdNum) || !TypeGuards.isNumber(days) || days <= 0) {
        throw new DatabaseError('Chat ID must be a valid number and days must be positive', {
          context: { chatId, days, chatIdNum, operation: 'get_period_violations' }
        });
      }

      // Use query builder template
      const { query, parameters } = DatabaseQueryBuilder.templates.getPeriodViolations(chatIdNum, days);

      // Validate query
      const validation = QueryValidator.validateQuery(query);
      if (!validation.isValid) {
        throw new DatabaseError('Query validation failed', {
          query,
          parameters,
          context: { operation: 'get_period_violations', issues: validation.issues }
        });
      }

      // Execute with retry logic
      const result = await DatabaseConnectionManager.executeWithRetry(async () => {
        const stmt = this.env.DB!.prepare(query);
        return await stmt.bind(...parameters).all();
      });

      const executionTime = Date.now() - startTime;

      if (!DatabaseResultValidator.validateQueryResult(result)) {
        throw new DatabaseError('Invalid database query result', {
          query,
          parameters,
          context: { operation: 'get_period_violations', chatId, days, executionTime }
        });
      }

      if (result.success === false) {
        throw new DatabaseError(result.error || 'Database query failed', {
          query,
          parameters,
          context: { operation: 'get_period_violations', chatId, days, executionTime }
        });
      }

      const violations: Violation[] = DatabaseResultValidator.extractResults(result).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

      // Log performance metrics
      if (executionTime > 500) {
        console.warn(`Slow database operation detected: get_period_violations took ${executionTime}ms`);
      }

      return violations;
    }, {
      operationName: 'ViolationRepository.getPeriodViolations',
      context: { chatId, days }
    });

    // Maintain backward compatibility
    if (!result.success) {
      throw result.error || new Error('Get period violations operation failed');
    }
    return result.data || [];
  }

  /**
   * Получить все нарушения в чате
   */
  async getAllViolations(chatId: string): Promise<Violation[]> {
    const result = await ErrorHandler.handle(async () => {
      const startTime = Date.now();

      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'get_all_violations', chatId }
        });
      }

      // Validate input parameters
      const chatIdNum = parseInt(chatId);

      if (!TypeGuards.isNumber(chatIdNum)) {
        throw new DatabaseError('Chat ID must be a valid number', {
          context: { chatId, chatIdNum, operation: 'get_all_violations' }
        });
      }

      // Build query using query builder
      const { query, parameters } = DatabaseQueryBuilder
        .select(['article', 'subarticle', 'article_title', 'quote', 'punishment', 'severity', 'confidence'])
        .from('criminal_violations')
        .where('chat_id = ?', chatIdNum)
        .orderBy('created_at', 'DESC')
        .build();

      // Validate query
      const validation = QueryValidator.validateQuery(query);
      if (!validation.isValid) {
        throw new DatabaseError('Query validation failed', {
          query,
          parameters,
          context: { operation: 'get_all_violations', issues: validation.issues }
        });
      }

      // Execute with retry logic
      const result = await DatabaseConnectionManager.executeWithRetry(async () => {
        const stmt = this.env.DB!.prepare(query);
        return await stmt.bind(...parameters).all();
      });

      const executionTime = Date.now() - startTime;

      if (!DatabaseResultValidator.validateQueryResult(result)) {
        throw new DatabaseError('Invalid database query result', {
          query,
          parameters,
          context: { operation: 'get_all_violations', chatId, executionTime }
        });
      }

      if (result.success === false) {
        throw new DatabaseError(result.error || 'Database query failed', {
          query,
          parameters,
          context: { operation: 'get_all_violations', chatId, executionTime }
        });
      }

      const violations: Violation[] = DatabaseResultValidator.extractResults(result).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

      // Log performance metrics
      if (executionTime > 1000) {
        console.warn(`Slow database operation detected: get_all_violations took ${executionTime}ms`);
      }

      return violations;
    }, {
      operationName: 'ViolationRepository.getAllViolations',
      context: { chatId }
    });

    // Maintain backward compatibility
    if (!result.success) {
      throw result.error || new Error('Get all violations operation failed');
    }
    return result.data || [];
  }

  /**
   * Получить статистику пользователя
   */
  async getUserStats(userId: string, chatId: string): Promise<UserStats> {
    const result = await ErrorHandler.handle(async () => {
      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'get_user_stats', userId, chatId }
        });
      }

      // Validate input parameters
      const userIdNum = parseInt(userId);
      const chatIdNum = parseInt(chatId);

      if (!TypeGuards.isNumber(userIdNum) || !TypeGuards.isNumber(chatIdNum)) {
        throw new DatabaseError('User ID and chat ID must be valid numbers', {
          context: { userId, chatId, userIdNum, chatIdNum, operation: 'get_user_stats' }
        });
      }

      // Получаем агрегированную статистику пользователя
      const userStatsQuery = `
        SELECT 
          COUNT(*) as total_violations,
          AVG(severity) as average_severity,
          MAX(created_at) as last_violation_date
        FROM criminal_violations 
        WHERE user_id = ? AND chat_id = ?
      `;

      const userStatsStmt = this.env.DB.prepare(userStatsQuery);
      const userStatsResult = await userStatsStmt.bind(userIdNum, chatIdNum).first();

      if (!DatabaseResultValidator.validateSingleResult(userStatsResult)) {
        throw new DatabaseError('Invalid user stats query result', {
          query: userStatsQuery,
          parameters: [userIdNum, chatIdNum],
          context: { operation: 'get_user_stats', userId, chatId }
        });
      }

      // Получаем нарушения по статьям
      const violationsByArticleQuery = `
        SELECT 
          article,
          subarticle,
          article_title,
          punishment,
          COUNT(*) as count,
          AVG(severity) as average_severity
        FROM criminal_violations 
        WHERE user_id = ? AND chat_id = ?
        GROUP BY article, subarticle, article_title, punishment
        ORDER BY count DESC
      `;

      const violationsByArticleStmt = this.env.DB.prepare(violationsByArticleQuery);
      const violationsByArticleResult = await violationsByArticleStmt.bind(userIdNum, chatIdNum).all();

      if (!DatabaseResultValidator.validateQueryResult(violationsByArticleResult)) {
        throw new DatabaseError('Invalid violations by article query result', {
          query: violationsByArticleQuery,
          parameters: [userIdNum, chatIdNum],
          context: { operation: 'get_user_stats', userId, chatId }
        });
      }

      const userStats = DatabaseResultValidator.extractSingleResult(userStatsResult);
      const totalViolations = userStats?.total_violations || 0;
      const averageSeverity = userStats?.average_severity || 0;
      const lastViolationDate = userStats?.last_violation_date
        ? new Date(userStats.last_violation_date)
        : undefined;

      const violationsByArticle: ViolationCount[] = DatabaseResultValidator.extractResults(violationsByArticleResult).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        punishment: row.punishment || '',
        count: row.count,
        averageSeverity: row.average_severity
      }));

      const mostCommonViolation = violationsByArticle.length > 0
        ? violationsByArticle[0].article
        : undefined;

      const riskLevel = ValidationUtils.calculateRiskLevel(averageSeverity);

      return {
        userId,
        chatId,
        totalViolations,
        violationsByArticle,
        averageSeverity,
        riskLevel,
        lastViolationDate,
        mostCommonViolation
      };
    }, {
      operationName: 'ViolationRepository.getUserStats',
      context: { userId, chatId }
    });

    // Maintain backward compatibility
    if (!result.success) {
      throw result.error || new Error('Get user stats operation failed');
    }
    return result.data!;
  }

  /**
   * Получить статистику за период
   */
  async getPeriodStats(chatId: string, days: number): Promise<PeriodStats> {
    const result = await ErrorHandler.handle(async () => {
      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'get_period_stats', chatId, days }
        });
      }

      const chatIdNum = parseInt(chatId);
      if (!TypeGuards.isNumber(chatIdNum) || !TypeGuards.isNumber(days) || days <= 0) {
        throw new DatabaseError('Chat ID must be a valid number and days must be positive', {
          context: { chatId, days, chatIdNum, operation: 'get_period_stats' }
        });
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const endDate = new Date();

      // Current period stats
      const currentPeriodQuery = `
        SELECT 
          COUNT(*) as total_violations,
          AVG(severity) as average_severity,
          COUNT(DISTINCT user_id) as unique_users
        FROM criminal_violations 
        WHERE chat_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
      `;

      const currentPeriodStmt = this.env.DB.prepare(currentPeriodQuery);
      const currentPeriodResult = await currentPeriodStmt.bind(chatIdNum, days).first();

      // Violations by article
      const violationsByArticleQuery = `
        SELECT 
          article, subarticle, article_title, punishment,
          COUNT(*) as count, AVG(severity) as average_severity
        FROM criminal_violations 
        WHERE chat_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
        GROUP BY article, subarticle, article_title, punishment
        ORDER BY count DESC
      `;

      const violationsByArticleStmt = this.env.DB.prepare(violationsByArticleQuery);
      const violationsByArticleResult = await violationsByArticleStmt.bind(chatIdNum, days).all();

      // Previous period for comparison
      const previousPeriodQuery = `
        SELECT 
          COUNT(*) as total_violations,
          AVG(severity) as average_severity,
          COUNT(DISTINCT user_id) as unique_users
        FROM criminal_violations 
        WHERE chat_id = ? 
        AND created_at >= datetime('now', '-' || ? || ' days')
        AND created_at < datetime('now', '-' || ? || ' days')
      `;

      const previousPeriodStmt = this.env.DB.prepare(previousPeriodQuery);
      const previousPeriodResult = await previousPeriodStmt.bind(chatIdNum, days * 2, days).first();

      const currentStats = DatabaseResultValidator.extractSingleResult(currentPeriodResult);
      const totalViolations = currentStats?.total_violations || 0;
      const averageSeverity = currentStats?.average_severity || 0;
      const uniqueUsers = currentStats?.unique_users || 0;

      const violationsByArticle: ViolationCount[] = DatabaseResultValidator.extractResults(violationsByArticleResult).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        punishment: row.punishment || '',
        count: row.count,
        averageSeverity: row.average_severity
      }));

      let comparisonWithPreviousPeriod: PeriodComparison | undefined;
      const previousStats = DatabaseResultValidator.extractSingleResult(previousPeriodResult);
      if (previousStats) {
        const prevViolations = previousStats.total_violations || 0;
        const prevSeverity = previousStats.average_severity || 0;
        const prevUsers = previousStats.unique_users || 0;

        comparisonWithPreviousPeriod = {
          violationsChange: prevViolations > 0 ? ((totalViolations - prevViolations) / prevViolations) * 100 : 0,
          severityChange: averageSeverity - prevSeverity,
          usersChange: prevUsers > 0 ? ((uniqueUsers - prevUsers) / prevUsers) * 100 : 0
        };
      }

      return {
        chatId,
        startDate,
        endDate,
        totalViolations,
        violationsByArticle,
        averageSeverity,
        uniqueUsers,
        comparisonWithPreviousPeriod
      };
    }, {
      operationName: 'ViolationRepository.getPeriodStats',
      context: { chatId, days }
    });

    // Maintain backward compatibility
    if (!result.success) {
      throw result.error || new Error('Get period stats operation failed');
    }
    return result.data!;
  }

  /**
   * Получить общую статистику чата
   */
  async getGeneralStats(chatId: string): Promise<GeneralStats> {
    const result = await ErrorHandler.handle(async () => {
      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'get_general_stats', chatId }
        });
      }

      const chatIdNum = parseInt(chatId);
      if (!TypeGuards.isNumber(chatIdNum)) {
        throw new DatabaseError('Chat ID must be a valid number', {
          context: { chatId, chatIdNum, operation: 'get_general_stats' }
        });
      }

      // Execute all queries
      const [generalStatsResult, topViolationsResult, topUsersResult, criticalViolationsResult] = await Promise.all([
        this.env.DB.prepare(`
          SELECT COUNT(*) as total_violations, AVG(severity) as average_severity
          FROM criminal_violations WHERE chat_id = ?
        `).bind(chatIdNum).first(),

        this.env.DB.prepare(`
          SELECT article, subarticle, article_title, punishment, COUNT(*) as count, AVG(severity) as average_severity
          FROM criminal_violations WHERE chat_id = ?
          GROUP BY article, subarticle, article_title, punishment
          ORDER BY count DESC LIMIT 5
        `).bind(chatIdNum).all(),

        this.env.DB.prepare(`
          SELECT user_id, COUNT(*) as count, AVG(severity) as average_severity
          FROM criminal_violations WHERE chat_id = ?
          GROUP BY user_id ORDER BY count DESC LIMIT 5
        `).bind(chatIdNum).all(),

        this.env.DB.prepare(`
          SELECT article, subarticle, article_title, quote, punishment, severity, confidence
          FROM criminal_violations WHERE chat_id = ? AND severity >= 8
          ORDER BY severity DESC, created_at DESC LIMIT 10
        `).bind(chatIdNum).all()
      ]);

      const generalStats = DatabaseResultValidator.extractSingleResult(generalStatsResult);
      const totalViolations = generalStats?.total_violations || 0;
      const averageSeverity = generalStats?.average_severity || 0;

      const topViolations: ViolationCount[] = DatabaseResultValidator.extractResults(topViolationsResult).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        punishment: row.punishment || '',
        count: row.count,
        averageSeverity: row.average_severity
      }));

      const topUsers: UserViolationCount[] = DatabaseResultValidator.extractResults(topUsersResult).map(row => ({
        userId: String(row.user_id),
        count: row.count,
        averageSeverity: row.average_severity,
        riskLevel: ValidationUtils.calculateRiskLevel(row.average_severity)
      }));

      const criticalViolations: Violation[] = DatabaseResultValidator.extractResults(criticalViolationsResult).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

      const overallRiskLevel = ValidationUtils.calculateRiskLevel(averageSeverity);

      return {
        chatId,
        totalViolations,
        topViolations,
        topUsers,
        overallRiskLevel,
        averageSeverity,
        criticalViolations
      };
    }, {
      operationName: 'ViolationRepository.getGeneralStats',
      context: { chatId }
    });

    // Maintain backward compatibility
    if (!result.success) {
      throw result.error || new Error('Get general stats operation failed');
    }
    return result.data!;
  }

  // Backward compatibility methods for tests
  async storeViolation(userId: number, chatId: number, violation: Violation): Promise<Result<void>> {
    try {
      await this.save(violation, userId.toString(), chatId.toString());
      return success(undefined);
    } catch (error: unknown) {
      const appError = ErrorHandler.convertToAppError(error, {
        operationName: 'ViolationRepository.storeViolation',
        context: { userId, chatId, violation }
      });
      return failure(appError);
    }
  }

  async getChatViolations(chatId: number, limit?: number): Promise<Result<Violation[]>> {
    try {
      const violations = await this.getAllViolations(chatId.toString());
      const result = limit ? violations.slice(0, limit) : violations;
      return success(result);
    } catch (error: unknown) {
      const appError = ErrorHandler.convertToAppError(error, {
        operationName: 'ViolationRepository.getChatViolations',
        context: { chatId, limit }
      });
      return failure(appError);
    }
  }

  async getViolationsByPeriod(chatId: number, startDate: Date, endDate: Date): Promise<Result<Violation[]>> {
    try {
      // Validate input
      if (!(startDate instanceof Date) || isNaN(startDate.getTime())) {
        throw new Error('Invalid startDate');
      }
      if (!(endDate instanceof Date) || isNaN(endDate.getTime())) {
        throw new Error('Invalid endDate');
      }
      if (startDate > endDate) {
        throw new Error('startDate must be before endDate');
      }

      if (!this.env.DB) {
        throw new DatabaseError('Database not available', {
          context: { operation: 'get_violations_by_period', chatId, startDate, endDate }
        });
      }

      const startIso = startDate.toISOString();
      const endIso = endDate.toISOString();

      const { query, parameters } = DatabaseQueryBuilder
        .select(['article', 'subarticle', 'article_title', 'quote', 'punishment', 'severity', 'confidence'])
        .from('criminal_violations')
        .where('chat_id = ?', chatId)
        .and('created_at >= ?', startIso)
        .and('created_at <= ?', endIso)
        .orderBy('created_at', 'DESC')
        .build();

      const validation = QueryValidator.validateQuery(query);
      if (!validation.isValid) {
        throw new DatabaseError('Query validation failed', {
          query,
          parameters,
          context: { operation: 'get_violations_by_period', chatId, startIso, endIso, issues: validation.issues }
        });
      }

      const result = await DatabaseConnectionManager.executeWithRetry(async () => {
        const stmt = this.env.DB!.prepare(query);
        return await stmt.bind(...parameters).all();
      });

      if (!DatabaseResultValidator.validateQueryResult(result)) {
        throw new DatabaseError('Invalid database query result', {
          query,
          parameters,
          context: { operation: 'get_violations_by_period', chatId, startIso, endIso }
        });
      }

      if (result.success === false) {
        throw new DatabaseError(result.error || 'Database query failed', {
          query,
          parameters,
          context: { operation: 'get_violations_by_period', chatId, startIso, endIso }
        });
      }

      const violations: Violation[] = DatabaseResultValidator.extractResults(result).map(row => ({
        article: row.article,
        subarticle: row.subarticle,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

      return success(violations);
    } catch (error: unknown) {
      const appError = ErrorHandler.convertToAppError(error, {
        operationName: 'ViolationRepository.getViolationsByPeriod',
        context: { chatId, startDate, endDate }
      });
      return failure(appError);
    }
  }

  async getViolationCounts(chatId: number, limit?: number): Promise<Result<ViolationCount[]>> {
    try {
      const stats = await this.getGeneralStats(chatId.toString());
      const result = limit ? stats.topViolations.slice(0, limit) : stats.topViolations;
      return success(result);
    } catch (error: unknown) {
      const appError = ErrorHandler.convertToAppError(error, {
        operationName: 'ViolationRepository.getViolationCounts',
        context: { chatId, limit }
      });
      return failure(appError);
    }
  }

  async getUserViolationCounts(chatId: number, limit?: number): Promise<Result<UserViolationCount[]>> {
    try {
      const stats = await this.getGeneralStats(chatId.toString());
      const result = limit ? stats.topUsers.slice(0, limit) : stats.topUsers;
      return success(result);
    } catch (error: unknown) {
      const appError = ErrorHandler.convertToAppError(error, {
        operationName: 'ViolationRepository.getUserViolationCounts',
        context: { chatId, limit }
      });
      return failure(appError);
    }
  }
}