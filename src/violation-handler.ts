/**
 * ViolationHandler - Основной обработчик нарушений
 * Интегрирует MessageFormatter, StatisticsService и ViolationRepository
 * для полного цикла обработки нарушений
 */

import type { Env } from './env';
import type { 
  ViolationAnalysis, 
  Violation, 
  UserStats, 
  PeriodStats, 
  GeneralStats 
} from './models/statistics';
import { MessageFormatter, type IMessageFormatter } from './message-formatter';
import { StatisticsService, type IStatisticsService } from './services/statistics-service';
import { ViolationRepository, type IViolationRepository } from './repositories/violation-repository';
import { validateViolationAnalysis, ValidationError } from './models/validation';

/**
 * Интерфейс основного обработчика нарушений
 */
export interface IViolationHandler {
  formatViolationMessage(analysis: ViolationAnalysis, userId?: string, chatId?: string): Promise<string>;
  getUserStats(userId: string, chatId: string): Promise<string>;
  getPeriodStats(chatId: string, days: number): Promise<string>;
  getGeneralStats(chatId: string): Promise<string>;
}

/**
 * Реализация основного обработчика нарушений
 */
export class ViolationHandler implements IViolationHandler {
  private messageFormatter: IMessageFormatter;
  private statisticsService: IStatisticsService;
  private violationRepository: IViolationRepository;

  constructor(
    env: Env,
    messageFormatter?: IMessageFormatter,
    statisticsService?: IStatisticsService,
    violationRepository?: IViolationRepository
  ) {
    this.violationRepository = violationRepository || new ViolationRepository(env);
    this.statisticsService = statisticsService || new StatisticsService(this.violationRepository);
    this.messageFormatter = messageFormatter || new MessageFormatter();
  }

  /**
   * Форматирует сообщение о нарушении с использованием MessageFormatter
   * Сохраняет данные через ViolationRepository
   */
  async formatViolationMessage(analysis: ViolationAnalysis, userId?: string, chatId?: string): Promise<string> {
    try {
      // Валидация входных данных
      this.validateViolationAnalysis(analysis);

      // Форматируем сообщение
      const formattedMessage = this.messageFormatter.formatViolationAnalysis(analysis);

      // Сохраняем нарушения в базу данных (если есть)
      if (analysis.hasViolations && analysis.violations.length > 0 && userId && chatId) {
        await this.saveViolations(analysis.violations, userId, chatId);
      }

      return formattedMessage;

    } catch (error) {
      console.error('❌ Error formatting violation message:', error);
      
      // Возвращаем fallback сообщение при ошибке
      if (error instanceof ValidationError) {
        return this.createFallbackMessage(analysis, `Ошибка валидации: ${error.message}`);
      }
      
      return this.createFallbackMessage(analysis, 'Произошла ошибка при обработке нарушения');
    }
  }

  /**
   * Получает и форматирует статистику пользователя
   */
  async getUserStats(userId: string, chatId: string): Promise<string> {
    try {
      // Валидация входных параметров
      this.validateUserStatsParams(userId, chatId);

      // Получаем статистику
      const userStats = await this.statisticsService.getUserStats(userId, chatId);

      // Форматируем сообщение
      return this.messageFormatter.formatUserStats(userStats);

    } catch (error) {
      console.error('❌ Error getting user stats:', error);
      return this.createErrorMessage('Не удалось получить статистику пользователя', error);
    }
  }

  /**
   * Получает и форматирует статистику за период
   */
  async getPeriodStats(chatId: string, days: number): Promise<string> {
    try {
      // Валидация входных параметров
      this.validatePeriodStatsParams(chatId, days);

      // Получаем статистику
      const periodStats = await this.statisticsService.getPeriodStats(chatId, days);

      // Форматируем сообщение
      return this.messageFormatter.formatPeriodStats(periodStats);

    } catch (error) {
      console.error('❌ Error getting period stats:', error);
      return this.createErrorMessage('Не удалось получить статистику за период', error);
    }
  }

  /**
   * Получает и форматирует общую статистику
   */
  async getGeneralStats(chatId: string): Promise<string> {
    try {
      // Валидация входных параметров
      this.validateGeneralStatsParams(chatId);

      // Получаем статистику
      const generalStats = await this.statisticsService.getGeneralStats(chatId);

      // Форматируем сообщение
      return this.messageFormatter.formatGeneralStats(generalStats);

    } catch (error) {
      console.error('❌ Error getting general stats:', error);
      return this.createErrorMessage('Не удалось получить общую статистику', error);
    }
  }

  /**
   * Валидирует анализ нарушений
   */
  private validateViolationAnalysis(analysis: ViolationAnalysis): void {
    if (!analysis) {
      throw new ValidationError('ViolationAnalysis is required');
    }

    try {
      validateViolationAnalysis(analysis);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(`Invalid ViolationAnalysis: ${error.message}`);
    }
  }

  /**
   * Валидирует параметры для получения статистики пользователя
   */
  private validateUserStatsParams(userId: string, chatId: string): void {
    if (!userId || typeof userId !== 'string' || userId.trim() === '') {
      throw new ValidationError('userId must be a non-empty string');
    }

    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
      throw new ValidationError('chatId must be a non-empty string');
    }
  }

  /**
   * Валидирует параметры для получения статистики за период
   */
  private validatePeriodStatsParams(chatId: string, days: number): void {
    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
      throw new ValidationError('chatId must be a non-empty string');
    }

    if (typeof days !== 'number' || days <= 0 || days > 365) {
      throw new ValidationError('days must be a positive number not exceeding 365');
    }
  }

  /**
   * Валидирует параметры для получения общей статистики
   */
  private validateGeneralStatsParams(chatId: string): void {
    if (!chatId || typeof chatId !== 'string' || chatId.trim() === '') {
      throw new ValidationError('chatId must be a non-empty string');
    }
  }

  /**
   * Сохраняет нарушения в базу данных
   * Примечание: userId и chatId будут переданы отдельно при интеграции с ботом
   */
  private async saveViolations(violations: Violation[], userId?: string, chatId?: string): Promise<void> {
    if (!userId || !chatId) {
      // Пока не сохраняем, если нет информации о пользователе и чате
      // Это будет добавлено при интеграции с ботом
      console.warn('⚠️ Cannot save violations: userId and chatId are required');
      return;
    }

    try {
      for (const violation of violations) {
        await this.statisticsService.saveViolation(violation, userId, chatId);
      }
    } catch (error) {
      console.error('❌ Error saving violations:', error);
      // Не прерываем выполнение, если не удалось сохранить
    }
  }

  /**
   * Создает fallback сообщение при ошибке форматирования
   */
  private createFallbackMessage(analysis: ViolationAnalysis, errorMessage: string): string {
    try {
      if (!analysis.hasViolations || analysis.violations.length === 0) {
        return '✅ Нарушений не обнаружено';
      }

      // Простое сообщение без HTML форматирования
      const lines = [
        '🚨 Обнаружены нарушения УК РФ',
        '',
        `Количество нарушений: ${analysis.violations.length}`,
        `Общий уровень серьезности: ${analysis.totalSeverity}`,
        `Уровень риска: ${analysis.riskLevel}`,
        '',
        '⚠️ ' + errorMessage
      ];

      return lines.join('\n');

    } catch (fallbackError) {
      console.error('❌ Error creating fallback message:', fallbackError);
      return `🚨 Обнаружены нарушения, но произошла ошибка при форматировании: ${errorMessage}`;
    }
  }

  /**
   * Создает сообщение об ошибке
   */
  private createErrorMessage(baseMessage: string, error: unknown): string {
    const errorText = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return `❌ ${baseMessage}\n\nДетали ошибки: ${errorText}`;
  }
}