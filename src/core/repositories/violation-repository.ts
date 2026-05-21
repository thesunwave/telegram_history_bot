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
import { ValidationUtils } from '../models/validation';
import {
  addSentenceTotals,
  calculateSentenceFromViolationCount,
  calculateSentenceFromViolationCounts,
} from '../../features/criminal/sentence-calculator';

/**
 * Интерфейс репозитория для работы с нарушениями
 */
export interface IViolationRepository {
  save(violation: Violation, userId: string, chatId: string): Promise<void>;
  getUserViolations(userId: string, chatId: string): Promise<Violation[]>;
  getPeriodViolations(chatId: string, days: number): Promise<Violation[]>;
  getAllViolations(chatId: string): Promise<Violation[]>;
  
  // Методы для статистики
  getUserStats(userId: string, chatId: string): Promise<UserStats>;
  getPeriodStats(chatId: string, days: number): Promise<PeriodStats>;
  getGeneralStats(chatId: string): Promise<GeneralStats>;
  getTopUsersBySentenceStats?(chatId: string, days: number, limit: number): Promise<UserViolationCount[]>;
}

/**
 * Реализация репозитория для работы с нарушениями в D1 Database
 */
export class ViolationRepository implements IViolationRepository {
  constructor(private env: Env) {}

  /**
   * Сохранить нарушение в базе данных
   */
  async save(violation: Violation, userId: string, chatId: string): Promise<void> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      const stmt = this.env.DB.prepare(`
        INSERT INTO criminal_violations (
          user_id, chat_id, article, subarticle, article_title, quote, punishment, 
          severity, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      await stmt.bind(
        parseInt(userId),
        parseInt(chatId),
        violation.article,
        violation.subarticle || null,
        violation.articleTitle || '',
        violation.quote,
        violation.punishment,
        violation.severity,
        violation.confidence
      ).run();

    } catch (error) {
      console.error('❌ Error saving violation:', error);
      throw new Error(`Failed to save violation: ${error.message}`);
    }
  }

  /**
   * Получить все нарушения пользователя в чате
   */
  async getUserViolations(userId: string, chatId: string): Promise<Violation[]> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      const stmt = this.env.DB.prepare(`
        SELECT article, subarticle, article_title, quote, punishment, severity, confidence
        FROM criminal_violations 
        WHERE user_id = ? AND chat_id = ?
        ORDER BY created_at DESC
      `);

      const result = await stmt.bind(parseInt(userId), parseInt(chatId)).all();
      
      return (result.results || []).map((row: any) => ({
        article: row.article,
        subarticle: row.subarticle || null,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

    } catch (error) {
      console.error('❌ Error getting user violations:', error);
      throw new Error(`Failed to get user violations: ${error.message}`);
    }
  }

  /**
   * Получить нарушения за определенный период
   */
  async getPeriodViolations(chatId: string, days: number): Promise<Violation[]> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      const stmt = this.env.DB.prepare(`
        SELECT article, subarticle, article_title, quote, punishment, severity, confidence
        FROM criminal_violations 
        WHERE chat_id = ? AND created_at >= datetime('now', '-${days} days')
        ORDER BY created_at DESC
      `);

      const result = await stmt.bind(parseInt(chatId)).all();
      
      return (result.results || []).map((row: any) => ({
        article: row.article,
        subarticle: row.subarticle || null,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

    } catch (error) {
      console.error('❌ Error getting period violations:', error);
      throw new Error(`Failed to get period violations: ${error.message}`);
    }
  }

  /**
   * Получить все нарушения в чате
   */
  async getAllViolations(chatId: string): Promise<Violation[]> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      const stmt = this.env.DB.prepare(`
        SELECT article, subarticle, article_title, quote, punishment, severity, confidence
        FROM criminal_violations 
        WHERE chat_id = ?
        ORDER BY created_at DESC
      `);

      const result = await stmt.bind(parseInt(chatId)).all();
      
      return (result.results || []).map((row: any) => ({
        article: row.article,
        subarticle: row.subarticle || null,
        articleTitle: row.article_title || '',
        quote: row.quote,
        punishment: row.punishment,
        severity: row.severity,
        confidence: row.confidence
      }));

    } catch (error) {
      console.error('❌ Error getting all violations:', error);
      throw new Error(`Failed to get all violations: ${error.message}`);
    }
  }

  /**
   * Получить статистику пользователя
   */
  async getUserStats(userId: string, chatId: string): Promise<UserStats> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      // Получаем агрегированную статистику пользователя
      const userStatsStmt = this.env.DB.prepare(`
        SELECT 
          COUNT(*) as total_violations,
          AVG(severity) as average_severity,
          MAX(created_at) as last_violation_date
        FROM criminal_violations 
        WHERE user_id = ? AND chat_id = ?
      `);

      const userStatsResult: any = await userStatsStmt.bind(parseInt(userId), parseInt(chatId)).first();

      // Получаем нарушения по статьям
      const violationsByArticleStmt = this.env.DB.prepare(`
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
      `);

      const violationsByArticleResult = await violationsByArticleStmt.bind(parseInt(userId), parseInt(chatId)).all();

      const totalViolations = Number(userStatsResult?.total_violations || 0);
      const averageSeverity = Number(userStatsResult?.average_severity || 0);
      const lastViolationDate = userStatsResult?.last_violation_date 
        ? new Date(userStatsResult.last_violation_date as string) 
        : undefined;

      const violationsByArticle: ViolationCount[] = (violationsByArticleResult.results || [])
        .map((row: any) => this.mapViolationCount(row));
      const sentenceTotal = calculateSentenceFromViolationCounts(violationsByArticle);

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
        totalYears: sentenceTotal.totalYears,
        lifeSentences: sentenceTotal.lifeSentences,
        lastViolationDate,
        mostCommonViolation
      };

    } catch (error) {
      console.error('❌ Error getting user stats:', error);
      throw new Error(`Failed to get user stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Получить статистику за период
   */
  async getPeriodStats(chatId: string, days: number): Promise<PeriodStats> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const endDate = new Date();

      // Статистика за текущий период
      const currentPeriodStmt = this.env.DB.prepare(`
        SELECT 
          COUNT(*) as total_violations,
          AVG(severity) as average_severity,
          COUNT(DISTINCT user_id) as unique_users
        FROM criminal_violations 
        WHERE chat_id = ? AND created_at >= datetime('now', '-${days} days')
      `);

      const currentPeriodResult: any = await currentPeriodStmt.bind(parseInt(chatId)).first();

      // Нарушения по статьям за период
      const violationsByArticleStmt = this.env.DB.prepare(`
        SELECT 
          article,
          subarticle,
          article_title,
          punishment,
          COUNT(*) as count,
          AVG(severity) as average_severity
        FROM criminal_violations 
        WHERE chat_id = ? AND created_at >= datetime('now', '-${days} days')
        GROUP BY article, subarticle, article_title, punishment
        ORDER BY count DESC
      `);

      const violationsByArticleResult = await violationsByArticleStmt.bind(parseInt(chatId)).all();

      // Статистика за предыдущий период для сравнения
      const previousPeriodStmt = this.env.DB.prepare(`
        SELECT 
          COUNT(*) as total_violations,
          AVG(severity) as average_severity,
          COUNT(DISTINCT user_id) as unique_users
        FROM criminal_violations 
        WHERE chat_id = ? 
        AND created_at >= datetime('now', '-${days * 2} days')
        AND created_at < datetime('now', '-${days} days')
      `);

      const previousPeriodResult: any = await previousPeriodStmt.bind(parseInt(chatId)).first();

      const totalViolations = Number(currentPeriodResult?.total_violations || 0);
      const averageSeverity = Number(currentPeriodResult?.average_severity || 0);
      const uniqueUsers = Number(currentPeriodResult?.unique_users || 0);

      const violationsByArticle: ViolationCount[] = (violationsByArticleResult.results || [])
        .map((row: any) => this.mapViolationCount(row));
      const sentenceTotal = calculateSentenceFromViolationCounts(violationsByArticle);

      // Вычисляем сравнение с предыдущим периодом
      let comparisonWithPreviousPeriod: PeriodComparison | undefined;
      if (previousPeriodResult) {
        const prevViolations = Number(previousPeriodResult.total_violations || 0);
        const prevSeverity = Number(previousPeriodResult.average_severity || 0);
        const prevUsers = Number(previousPeriodResult.unique_users || 0);

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
        totalYears: sentenceTotal.totalYears,
        lifeSentences: sentenceTotal.lifeSentences,
        comparisonWithPreviousPeriod
      };

    } catch (error) {
      console.error('❌ Error getting period stats:', error);
      throw new Error(`Failed to get period stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Получить общую статистику чата
   */
  async getGeneralStats(chatId: string): Promise<GeneralStats> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      // Общая статистика
      const generalStatsStmt = this.env.DB.prepare(`
        SELECT 
          COUNT(*) as total_violations,
          AVG(severity) as average_severity
        FROM criminal_violations 
        WHERE chat_id = ?
      `);

      const generalStatsResult: any = await generalStatsStmt.bind(parseInt(chatId)).first();

      // Топ-5 самых частых нарушений
      const topViolationsStmt = this.env.DB.prepare(`
        SELECT 
          article,
          subarticle,
          article_title,
          punishment,
          COUNT(*) as count,
          AVG(severity) as average_severity
        FROM criminal_violations 
        WHERE chat_id = ?
        GROUP BY article, subarticle, article_title, punishment
        ORDER BY count DESC
        LIMIT 5
      `);

      const topViolationsResult = await topViolationsStmt.bind(parseInt(chatId)).all();

      // Топ-5 пользователей с наибольшим количеством нарушений
      const topUsersStmt = this.env.DB.prepare(`
        SELECT 
          user_id,
          COUNT(*) as count,
          AVG(severity) as average_severity
        FROM criminal_violations 
        WHERE chat_id = ?
        GROUP BY user_id
        ORDER BY count DESC
        LIMIT 5
      `);

      const topUsersResult = await topUsersStmt.bind(parseInt(chatId)).all();

      // Критические нарушения (серьезность >= 8)
      const criticalViolationsStmt = this.env.DB.prepare(`
        SELECT article, subarticle, article_title, quote, punishment, severity, confidence
        FROM criminal_violations 
        WHERE chat_id = ? AND severity >= 8
        ORDER BY severity DESC, created_at DESC
        LIMIT 10
      `);

      const criticalViolationsResult = await criticalViolationsStmt.bind(parseInt(chatId)).all();

      const totalViolations = Number(generalStatsResult?.total_violations || 0);
      const averageSeverity = Number(generalStatsResult?.average_severity || 0);

      const topViolations: ViolationCount[] = (topViolationsResult.results || [])
        .map((row: any) => this.mapViolationCount(row));
      const sentenceTotal = calculateSentenceFromViolationCounts(topViolations);

      const topUsers: UserViolationCount[] = (topUsersResult.results || []).map((row: any) => ({
        userId: String(row.user_id),
        count: row.count,
        averageSeverity: row.average_severity,
        riskLevel: ValidationUtils.calculateRiskLevel(row.average_severity)
      }));

      const criticalViolations: Violation[] = (criticalViolationsResult.results || []).map((row: any) => ({
        article: row.article,
        subarticle: row.subarticle || null,
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
        totalYears: sentenceTotal.totalYears,
        lifeSentences: sentenceTotal.lifeSentences,
        criticalViolations
      };

    } catch (error) {
      console.error('❌ Error getting general stats:', error);
      throw new Error(`Failed to get general stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Получить топ пользователей по суммарному сроку наказаний за период
   */
  async getTopUsersBySentenceStats(
    chatId: string,
    days: number,
    limit: number
  ): Promise<UserViolationCount[]> {
    if (!this.env.DB) {
      throw new Error('Database not available');
    }

    try {
      const safeDays = Math.max(1, Math.min(365, Math.floor(days || 1)));
      const safeLimit = Math.max(1, Math.min(20, Math.floor(limit || 5)));
      const stmt = this.env.DB.prepare(`
        SELECT 
          user_id,
          article,
          subarticle,
          article_title,
          punishment,
          COUNT(*) as count,
          AVG(severity) as average_severity
        FROM criminal_violations 
        WHERE chat_id = ? AND created_at >= datetime('now', '-${safeDays} days')
        GROUP BY user_id, article, subarticle, article_title, punishment
      `);

      const result = await stmt.bind(parseInt(chatId)).all();
      const users = new Map<string, UserViolationCount>();

      for (const row of result.results || []) {
        const rawRow = row as any;
        const userId = String(rawRow.user_id);
        const violationCount = this.mapViolationCount(rawRow);
        const sentenceTotal = calculateSentenceFromViolationCount(violationCount);
        const existing = users.get(userId) || {
          userId,
          count: 0,
          averageSeverity: 0,
          riskLevel: 'low' as const,
          totalYears: 0,
          lifeSentences: 0,
        };

        const nextCount = existing.count + violationCount.count;
        const weightedSeverity = nextCount > 0
          ? (
            (existing.averageSeverity * existing.count) +
            (violationCount.averageSeverity * violationCount.count)
          ) / nextCount
          : 0;
        const nextSentence = addSentenceTotals(
          {
            totalYears: existing.totalYears || 0,
            lifeSentences: existing.lifeSentences || 0,
          },
          sentenceTotal
        );

        users.set(userId, {
          ...existing,
          count: nextCount,
          averageSeverity: weightedSeverity,
          riskLevel: ValidationUtils.calculateRiskLevel(weightedSeverity),
          totalYears: nextSentence.totalYears,
          lifeSentences: nextSentence.lifeSentences,
        });
      }

      return Array.from(users.values())
        .sort((a, b) =>
          (b.lifeSentences || 0) - (a.lifeSentences || 0) ||
          (b.totalYears || 0) - (a.totalYears || 0) ||
          b.count - a.count
        )
        .slice(0, safeLimit);
    } catch (error) {
      console.error('❌ Error getting top users by sentence stats:', error);
      throw new Error(
        `Failed to get top users by sentence stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private mapViolationCount(row: any): ViolationCount {
    return {
      article: row.article,
      subarticle: row.subarticle || null,
      articleTitle: row.article_title || '',
      punishment: row.punishment || '',
      count: row.count || 0,
      averageSeverity: row.average_severity || 0
    };
  }
}
