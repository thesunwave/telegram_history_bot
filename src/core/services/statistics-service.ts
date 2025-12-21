/**
 * StatisticsService для агрегации данных о нарушениях
 * Предоставляет методы для получения статистики пользователей, периодов и общей статистики
 */

import type { 
  UserStats, 
  PeriodStats, 
  GeneralStats,
  Violation
} from '../models/statistics';
import type { IViolationRepository } from '../repositories/violation-repository';

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
export class StatisticsService implements IStatisticsService {
  constructor(private violationRepository: IViolationRepository) {}

  /**
   * Получить статистику пользователя с группировкой по статьям УК РФ
   */
  async getUserStats(userId: string, chatId: string): Promise<UserStats> {
    try {
      // Используем готовый метод репозитория, который уже реализует всю логику
      return await this.violationRepository.getUserStats(userId, chatId);
    } catch (error) {
      console.error('❌ Error getting user stats:', error);
      throw new Error(`Failed to get user stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Получить статистику за период с подсчетом изменений
   */
  async getPeriodStats(chatId: string, days: number): Promise<PeriodStats> {
    try {
      // Используем готовый метод репозитория, который уже реализует всю логику
      return await this.violationRepository.getPeriodStats(chatId, days);
    } catch (error) {
      console.error('❌ Error getting period stats:', error);
      throw new Error(`Failed to get period stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Получить общую статистику с топ-5 нарушений и пользователей
   */
  async getGeneralStats(chatId: string): Promise<GeneralStats> {
    try {
      // Используем готовый метод репозитория, который уже реализует всю логику
      return await this.violationRepository.getGeneralStats(chatId);
    } catch (error) {
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
    } catch (error) {
      console.error('❌ Error saving violation:', error);
      throw new Error(`Failed to save violation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }


}