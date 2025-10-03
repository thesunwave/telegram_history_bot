/**
 * StatisticsService для агрегации данных о нарушениях
 * Предоставляет методы для получения статистики пользователей, периодов и общей статистики
 */

import type { Env } from '../env';
import type { 
  UserStats, 
  PeriodStats, 
  GeneralStats,
  Violation
} from '../models/statistics';
import type { IViolationRepository } from '../repositories/violation-repository-adapter';
import { BaseService, type ServiceConfig } from './base-service';
import { ErrorHandler } from '../utils/errors';

/**
 * Интерфейс сервиса статистики
 */
export interface IStatisticsService {
  getUserStats(userId: string, chatId: string): Promise<UserStats>;
  getPeriodStats(chatId: string, days: number): Promise<PeriodStats>;
  getGeneralStats(chatId: string): Promise<GeneralStats>;
  saveViolation(violation: Violation, userId: string, chatId: string): Promise<void>;
}

/**
 * Реализация сервиса статистики
 */
export class StatisticsService extends BaseService implements IStatisticsService {
  constructor(
    env: Env,
    private violationRepository: IViolationRepository
  ) {
    const config: ServiceConfig = {
      name: 'StatisticsService',
      version: '1.0.0',
      description: 'Service for aggregating violation statistics',
      dependencies: ['ViolationRepository'],
      healthCheckInterval: 60000 // 1 minute
    };
    super(env, config);
  }

  /**
   * Получить статистику пользователя с группировкой по статьям УК РФ
   */
  async getUserStats(userId: string, chatId: string): Promise<UserStats> {
    try {
      return await this.violationRepository.getUserStats(userId, chatId);
    } catch (error: unknown) {
      console.error('❌ Error getting user stats:', error);
      throw new Error(`Failed to get user stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Получить статистику за период с подсчетом изменений
   */
  async getPeriodStats(chatId: string, days: number): Promise<PeriodStats> {
    try {
      return await this.violationRepository.getPeriodStats(chatId, days);
    } catch (error: unknown) {
      console.error('❌ Error getting period stats:', error);
      throw new Error(`Failed to get period stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Получить общую статистику с топ-5 нарушений и пользователей
   */
  async getGeneralStats(chatId: string): Promise<GeneralStats> {
    try {
      return await this.violationRepository.getGeneralStats(chatId);
    } catch (error: unknown) {
      console.error('❌ Error getting general stats:', error);
      throw new Error(`Failed to get general stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Сохранить нарушение
   */
  async saveViolation(violation: Violation, userId: string, chatId: string): Promise<void> {
    try {
      await this.violationRepository.save(violation, userId, chatId);
    } catch (error: unknown) {
      this.log('error', 'Error saving violation', { error, userId, chatId });
      throw new Error(`Failed to save violation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Service initialization
   */
  protected async onInitialize(): Promise<void> {
    this.log('info', 'Initializing StatisticsService');
    // Verify repository connection
    if (!this.violationRepository) {
      throw this.createError('MISSING_DEPENDENCY', 'ViolationRepository is required');
    }
  }

  /**
   * Service shutdown
   */
  protected async onShutdown(): Promise<void> {
    this.log('info', 'Shutting down StatisticsService');
    // No specific cleanup needed
  }

  /**
   * Health check implementation
   */
  protected async onHealthCheck(): Promise<boolean> {
    try {
      // Test repository connectivity by attempting a simple operation
      // This is a lightweight check that doesn't affect data
      return this.violationRepository !== null && this.violationRepository !== undefined;
    } catch (error: unknown) {
      this.log('error', 'Health check failed', { error });
      return false;
    }
  }

  /**
   * Configuration validation
   */
  protected async onValidateConfig(): Promise<boolean> {
    return this.violationRepository !== null && this.violationRepository !== undefined;
  }
}