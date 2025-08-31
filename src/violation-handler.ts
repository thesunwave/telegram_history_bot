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
import type { IMessageFormatter } from './message-formatter';
import type { IStatisticsService } from './services/statistics-service';
import type { IViolationRepository } from './repositories/violation-repository-adapter';
import { ServiceRegistry } from './services/service-registry';
import { validateViolationAnalysis, ValidationError, DataSanitizer, ValidationUtils } from './models/validation';
import { BaseAppError } from './utils/errors';

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
 * Реализация основного обработчика нарушений с dependency injection
 */
export class ViolationHandler implements IViolationHandler {
  private messageFormatter: IMessageFormatter;
  private statisticsService: IStatisticsService;
  private violationRepository: IViolationRepository;
  private serviceRegistry?: ServiceRegistry;

  constructor(
    env: Env,
    serviceRegistry?: ServiceRegistry,
    messageFormatter?: IMessageFormatter,
    statisticsService?: IStatisticsService,
    violationRepository?: IViolationRepository
  ) {
    if (serviceRegistry) {
      // Use dependency injection
      this.serviceRegistry = serviceRegistry;
      this.messageFormatter = messageFormatter || serviceRegistry.getMessageFormatter();
      this.statisticsService = statisticsService || serviceRegistry.getStatisticsService();
      this.violationRepository = violationRepository || serviceRegistry.getViolationRepository();
    } else {
      // Fallback to direct instantiation for backward compatibility
      console.warn('⚠️ ViolationHandler: Using direct instantiation instead of dependency injection');
      
      // For backward compatibility, require dependencies to be passed explicitly
      if (!messageFormatter || !statisticsService || !violationRepository) {
        throw new BaseAppError(
          'MISSING_DEPENDENCIES',
          'When not using ServiceRegistry, all dependencies must be provided explicitly'
        );
      }
      
      this.violationRepository = violationRepository;
      this.statisticsService = statisticsService;
      this.messageFormatter = messageFormatter;
    }
  }

  /**
   * Create ViolationHandler with dependency injection
   */
  static async create(env: Env): Promise<ViolationHandler> {
    const serviceRegistry = await ServiceRegistry.createAndInitialize(env);
    return new ViolationHandler(env, serviceRegistry);
  }

  /**
   * Create ViolationHandler with existing service registry
   */
  static createWithRegistry(env: Env, serviceRegistry: ServiceRegistry): ViolationHandler {
    return new ViolationHandler(env, serviceRegistry);
  }

  /**
   * Create ViolationHandler without dependency injection (for backward compatibility)
   */
  static async createWithoutDI(env: Env): Promise<ViolationHandler> {
    // Import modules dynamically to avoid circular dependencies
    const { MessageFormatter } = await import('./message-formatter');
    const { StatisticsService } = await import('./services/statistics-service');
    const { ViolationRepositoryAdapter } = await import('./repositories/violation-repository-adapter');
    
    const violationRepository = new ViolationRepositoryAdapter(env);
    const statisticsService = new StatisticsService(env, violationRepository);
    const messageFormatter = new MessageFormatter();
    
    return new ViolationHandler(
      env,
      undefined, // no service registry
      messageFormatter,
      statisticsService,
      violationRepository
    );
  }

  /**
   * Форматирует сообщение о нарушении с использованием MessageFormatter
   * Сохраняет данные через ViolationRepository
   */
  async formatViolationMessage(analysis: ViolationAnalysis, userId?: string, chatId?: string): Promise<string> {
    try {
      // Санитизируем и валидируем входные данные
      const sanitizedAnalysis = this.sanitizeAndValidateAnalysis(analysis);

      // Форматируем сообщение
      const formattedMessage = this.messageFormatter.formatViolationAnalysis(sanitizedAnalysis);

      // Сохраняем нарушения в базу данных (если есть)
      if (sanitizedAnalysis.hasViolations && sanitizedAnalysis.violations.length > 0 && userId && chatId) {
        await this.saveViolations(sanitizedAnalysis.violations, userId, chatId);
      }

      return formattedMessage;

    } catch (error: unknown) {
      console.error('❌ Error formatting violation message:', error);
      
      // Пытаемся восстановить данные и создать fallback сообщение
      return this.createRobustFallbackMessage(analysis, error);
    }
  }

  /**
   * Получает и форматирует статистику пользователя
   */
  async getUserStats(userId: string, chatId: string): Promise<string> {
    try {
      // Валидация и санитизация входных параметров
      const sanitizedUserId = ValidationUtils.sanitizeString(userId);
      const sanitizedChatId = ValidationUtils.sanitizeString(chatId);
      
      this.validateUserStatsParams(sanitizedUserId, sanitizedChatId);

      // Получаем статистику
      const userStats = await this.statisticsService.getUserStats(sanitizedUserId, sanitizedChatId);

      // Проверяем на пустую статистику
      if (!userStats || userStats.totalViolations === 0) {
        return this.messageFormatter.formatUserStats(
          DataSanitizer.createEmptyUserStats(sanitizedUserId, sanitizedChatId)
        );
      }

      // Форматируем сообщение
      return this.messageFormatter.formatUserStats(userStats);

    } catch (error: unknown) {
      console.error('❌ Error getting user stats:', error instanceof Error ? error.message : String(error));
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('❌ Error details:', {
        userId,
        chatId,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorType: typeof error,
        errorConstructor: error?.constructor?.name
      });
      
      // Возвращаем пустую статистику при ошибке
      try {
        const fallbackStats = DataSanitizer.createEmptyUserStats(
          ValidationUtils.sanitizeString(userId), 
          ValidationUtils.sanitizeString(chatId)
        );
        return this.messageFormatter.formatUserStats(fallbackStats) + 
               '\n\n⚠️ Данные могут быть неполными из-за технических проблем';
      } catch (fallbackError) {
        console.error('❌ Fallback error:', fallbackError);
        return this.createErrorMessage('Не удалось получить статистику пользователя', error);
      }
    }
  }

  /**
   * Получает и форматирует статистику за период
   */
  async getPeriodStats(chatId: string, days: number): Promise<string> {
    try {
      // Валидация и санитизация входных параметров
      const sanitizedChatId = ValidationUtils.sanitizeString(chatId);
      const sanitizedDays = Math.max(1, Math.min(365, Math.floor(days || 7)));
      
      this.validatePeriodStatsParams(sanitizedChatId, sanitizedDays);

      // Получаем статистику
      const periodStats = await this.statisticsService.getPeriodStats(sanitizedChatId, sanitizedDays);

      // Проверяем на пустую статистику
      if (!periodStats || periodStats.totalViolations === 0) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - sanitizedDays);
        
        return this.messageFormatter.formatPeriodStats(
          DataSanitizer.createEmptyPeriodStats(sanitizedChatId, startDate, endDate)
        );
      }

      // Форматируем сообщение
      return this.messageFormatter.formatPeriodStats(periodStats);

    } catch (error: unknown) {
      console.error('❌ Error getting period stats:', error);
      
      // Возвращаем пустую статистику при ошибке
      try {
        const endDate = new Date();
        const startDate = new Date();
        const sanitizedDays = Math.max(1, Math.min(365, Math.floor(days || 7)));
        startDate.setDate(endDate.getDate() - sanitizedDays);
        
        const fallbackStats = DataSanitizer.createEmptyPeriodStats(
          ValidationUtils.sanitizeString(chatId), 
          startDate, 
          endDate
        );
        return this.messageFormatter.formatPeriodStats(fallbackStats) + 
               '\n\n⚠️ Данные могут быть неполными из-за технических проблем';
      } catch (fallbackError) {
        return this.createErrorMessage('Не удалось получить статистику за период', error);
      }
    }
  }

  /**
   * Получает и форматирует общую статистику
   */
  async getGeneralStats(chatId: string): Promise<string> {
    try {
      // Валидация и санитизация входных параметров
      const sanitizedChatId = ValidationUtils.sanitizeString(chatId);
      this.validateGeneralStatsParams(sanitizedChatId);

      // Получаем статистику
      const generalStats = await this.statisticsService.getGeneralStats(sanitizedChatId);

      // Проверяем на пустую статистику
      if (!generalStats || generalStats.totalViolations === 0) {
        return this.messageFormatter.formatGeneralStats(
          DataSanitizer.createEmptyGeneralStats(sanitizedChatId)
        );
      }

      // Форматируем сообщение
      return this.messageFormatter.formatGeneralStats(generalStats);

    } catch (error: unknown) {
      console.error('❌ Error getting general stats:', error);
      
      // Возвращаем пустую статистику при ошибке
      try {
        const fallbackStats = DataSanitizer.createEmptyGeneralStats(
          ValidationUtils.sanitizeString(chatId)
        );
        return this.messageFormatter.formatGeneralStats(fallbackStats) + 
               '\n\n⚠️ Данные могут быть неполными из-за технических проблем';
      } catch (fallbackError) {
        return this.createErrorMessage('Не удалось получить общую статистику', error);
      }
    }
  }

  /**
   * Санитизирует и валидирует анализ нарушений
   */
  private sanitizeAndValidateAnalysis(analysis: any): ViolationAnalysis {
    // Для null/undefined создаем пустой анализ
    if (!analysis) {
      return DataSanitizer.sanitizeViolationAnalysis(null);
    }

    try {
      // Сначала пытаемся валидировать как есть
      validateViolationAnalysis(analysis);
      return analysis;
    } catch (validationError) {
      console.warn('⚠️ ViolationAnalysis validation failed, attempting to sanitize:', validationError.message);
      
      // Если валидация не прошла, пытаемся санитизировать данные
      try {
        const sanitized = DataSanitizer.sanitizeViolationAnalysis(analysis);
        validateViolationAnalysis(sanitized);
        return sanitized;
      } catch (sanitizationError) {
        // Если санитизация тоже не удалась, возвращаем пустой анализ
        console.warn('⚠️ Sanitization failed, returning empty analysis:', sanitizationError.message);
        return DataSanitizer.sanitizeViolationAnalysis(null);
      }
    }
  }

  /**
   * Валидирует анализ нарушений (устаревший метод, оставлен для совместимости)
   */
  private validateViolationAnalysis(analysis: ViolationAnalysis): void {
    if (!analysis) {
      throw new ValidationError('ViolationAnalysis is required');
    }

    try {
      validateViolationAnalysis(analysis);
    } catch (error: unknown) {
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
    } catch (error: unknown) {
      console.error('❌ Error saving violations:', error);
      // Не прерываем выполнение, если не удалось сохранить
    }
  }

  /**
   * Создает надежное fallback сообщение при любых ошибках
   */
  private createRobustFallbackMessage(analysis: any, error: unknown): string {
    try {
      // Пытаемся санитизировать данные
      const sanitized = DataSanitizer.sanitizeViolationAnalysis(analysis);
      return this.createFallbackMessage(sanitized, this.getErrorMessage(error));
    } catch (sanitizationError) {
      // Если санитизация не удалась, создаем минимальное сообщение
      return this.createMinimalFallbackMessage(analysis, error);
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
      return this.createMinimalFallbackMessage(analysis, fallbackError);
    }
  }

  /**
   * Создает минимальное fallback сообщение при критических ошибках
   */
  private createMinimalFallbackMessage(analysis: any, error: unknown): string {
    const errorMsg = this.getErrorMessage(error);
    
    // Пытаемся определить, есть ли нарушения
    let hasViolations = false;
    let violationCount = 0;
    
    try {
      if (analysis && typeof analysis === 'object') {
        hasViolations = Boolean(analysis.hasViolations);
        if (Array.isArray(analysis.violations)) {
          violationCount = analysis.violations.length;
        }
      }
    } catch {
      // Игнорируем ошибки при попытке извлечь информацию
    }

    if (hasViolations && violationCount > 0) {
      return `🚨 Обнаружены нарушения (${violationCount}), но произошла ошибка при обработке данных.\n\n⚠️ ${errorMsg}`;
    } else {
      return `✅ Нарушений не обнаружено\n\n⚠️ Предупреждение: ${errorMsg}`;
    }
  }

  /**
   * Извлекает сообщение об ошибке
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof ValidationError) {
      return `Ошибка валидации: ${error.message}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'Неизвестная ошибка';
  }

  /**
   * Создает сообщение об ошибке
   */
  private createErrorMessage(baseMessage: string, error: unknown): string {
    const errorText = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return `❌ ${baseMessage}\n\nДетали ошибки: ${errorText}`;
  }
}