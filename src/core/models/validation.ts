/**
 * Валидация моделей данных для статистики
 */

import { 
  Violation, 
  ViolationAnalysis, 
  UserStats, 
  PeriodStats, 
  GeneralStats,
  ViolationCount,
  UserViolationCount,
  PeriodComparison
} from './statistics';

/**
 * Ошибка валидации
 */
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Валидация нарушения
 */
export function validateViolation(violation: any): violation is Violation {
  if (!violation || typeof violation !== 'object') {
    throw new ValidationError('Violation must be an object');
  }

  if (!violation.article || typeof violation.article !== 'string') {
    throw new ValidationError('Article must be a non-empty string', 'article');
  }

  if (violation.subarticle !== null && violation.subarticle !== undefined && typeof violation.subarticle !== 'string') {
    throw new ValidationError('Subarticle must be a string or null', 'subarticle');
  }

  if (!violation.articleTitle || typeof violation.articleTitle !== 'string') {
    throw new ValidationError('Article title must be a non-empty string', 'articleTitle');
  }

  if (!violation.quote || typeof violation.quote !== 'string') {
    throw new ValidationError('Quote must be a non-empty string', 'quote');
  }

  if (!violation.punishment || typeof violation.punishment !== 'string') {
    throw new ValidationError('Punishment must be a non-empty string', 'punishment');
  }

  if (typeof violation.severity !== 'number' || violation.severity < 1 || violation.severity > 10) {
    throw new ValidationError('Severity must be a number between 1 and 10', 'severity');
  }

  if (typeof violation.confidence !== 'number' || violation.confidence < 0 || violation.confidence > 1) {
    throw new ValidationError('Confidence must be a number between 0 and 1', 'confidence');
  }

  return true;
}

/**
 * Валидация анализа нарушений
 */
export function validateViolationAnalysis(analysis: any): analysis is ViolationAnalysis {
  if (!analysis || typeof analysis !== 'object') {
    throw new ValidationError('ViolationAnalysis must be an object');
  }

  if (typeof analysis.hasViolations !== 'boolean') {
    throw new ValidationError('hasViolations must be a boolean', 'hasViolations');
  }

  if (!Array.isArray(analysis.violations)) {
    throw new ValidationError('violations must be an array', 'violations');
  }

  // Валидируем каждое нарушение
  analysis.violations.forEach((violation: any, index: number) => {
    try {
      validateViolation(violation);
    } catch (error) {
      throw new ValidationError(`Invalid violation at index ${index}: ${error.message}`);
    }
  });

  if (typeof analysis.totalSeverity !== 'number' || analysis.totalSeverity < 0) {
    throw new ValidationError('totalSeverity must be a non-negative number', 'totalSeverity');
  }

  const validRiskLevels = ['low', 'medium', 'high'];
  if (!validRiskLevels.includes(analysis.riskLevel)) {
    throw new ValidationError('riskLevel must be one of: low, medium, high', 'riskLevel');
  }

  if (!analysis.analysisTimestamp || typeof analysis.analysisTimestamp !== 'string') {
    throw new ValidationError('analysisTimestamp must be a non-empty string', 'analysisTimestamp');
  }

  return true;
}

/**
 * Валидация количества нарушений
 */
export function validateViolationCount(violationCount: any): violationCount is ViolationCount {
  if (!violationCount || typeof violationCount !== 'object') {
    throw new ValidationError('ViolationCount must be an object');
  }

  if (!violationCount.article || typeof violationCount.article !== 'string') {
    throw new ValidationError('Article must be a non-empty string', 'article');
  }

  if (violationCount.subarticle !== undefined && violationCount.subarticle !== null && typeof violationCount.subarticle !== 'string') {
    throw new ValidationError('subarticle must be a string, null, or undefined', 'subarticle');
  }

  if (violationCount.articleTitle !== undefined && typeof violationCount.articleTitle !== 'string') {
    throw new ValidationError('articleTitle must be a string or undefined', 'articleTitle');
  }

  if (violationCount.punishment !== undefined && typeof violationCount.punishment !== 'string') {
    throw new ValidationError('punishment must be a string or undefined', 'punishment');
  }

  if (typeof violationCount.count !== 'number' || violationCount.count < 0) {
    throw new ValidationError('Count must be a non-negative number', 'count');
  }

  if (typeof violationCount.averageSeverity !== 'number' || 
      violationCount.averageSeverity < 1 || 
      violationCount.averageSeverity > 10) {
    throw new ValidationError('averageSeverity must be a number between 1 and 10', 'averageSeverity');
  }

  if (violationCount.totalYears !== undefined &&
      (typeof violationCount.totalYears !== 'number' || violationCount.totalYears < 0)) {
    throw new ValidationError('totalYears must be a non-negative number', 'totalYears');
  }

  if (violationCount.lifeSentences !== undefined &&
      (typeof violationCount.lifeSentences !== 'number' || violationCount.lifeSentences < 0)) {
    throw new ValidationError('lifeSentences must be a non-negative number', 'lifeSentences');
  }

  return true;
}

/**
 * Валидация количества нарушений пользователя
 */
export function validateUserViolationCount(userViolationCount: any): userViolationCount is UserViolationCount {
  if (!userViolationCount || typeof userViolationCount !== 'object') {
    throw new ValidationError('UserViolationCount must be an object');
  }

  if (!userViolationCount.userId || typeof userViolationCount.userId !== 'string') {
    throw new ValidationError('userId must be a non-empty string', 'userId');
  }

  if (userViolationCount.username !== undefined && typeof userViolationCount.username !== 'string') {
    throw new ValidationError('username must be a string or undefined', 'username');
  }

  if (typeof userViolationCount.count !== 'number' || userViolationCount.count < 0) {
    throw new ValidationError('Count must be a non-negative number', 'count');
  }

  if (typeof userViolationCount.averageSeverity !== 'number' || 
      userViolationCount.averageSeverity < 1 || 
      userViolationCount.averageSeverity > 10) {
    throw new ValidationError('averageSeverity must be a number between 1 and 10', 'averageSeverity');
  }

  const validRiskLevels = ['low', 'medium', 'high'];
  if (!validRiskLevels.includes(userViolationCount.riskLevel)) {
    throw new ValidationError('riskLevel must be one of: low, medium, high', 'riskLevel');
  }

  if (userViolationCount.totalYears !== undefined &&
      (typeof userViolationCount.totalYears !== 'number' || userViolationCount.totalYears < 0)) {
    throw new ValidationError('totalYears must be a non-negative number', 'totalYears');
  }

  if (userViolationCount.lifeSentences !== undefined &&
      (typeof userViolationCount.lifeSentences !== 'number' || userViolationCount.lifeSentences < 0)) {
    throw new ValidationError('lifeSentences must be a non-negative number', 'lifeSentences');
  }

  return true;
}

/**
 * Валидация статистики пользователя
 */
export function validateUserStats(userStats: any): userStats is UserStats {
  if (!userStats || typeof userStats !== 'object') {
    throw new ValidationError('UserStats must be an object');
  }

  if (!userStats.userId || typeof userStats.userId !== 'string') {
    throw new ValidationError('userId must be a non-empty string', 'userId');
  }

  if (!userStats.chatId || typeof userStats.chatId !== 'string') {
    throw new ValidationError('chatId must be a non-empty string', 'chatId');
  }

  if (typeof userStats.totalViolations !== 'number' || userStats.totalViolations < 0) {
    throw new ValidationError('totalViolations must be a non-negative number', 'totalViolations');
  }

  if (!Array.isArray(userStats.violationsByArticle)) {
    throw new ValidationError('violationsByArticle must be an array', 'violationsByArticle');
  }

  userStats.violationsByArticle.forEach((violation: any, index: number) => {
    try {
      validateViolationCount(violation);
    } catch (error) {
      throw new ValidationError(`Invalid violationCount at index ${index}: ${error.message}`);
    }
  });

  if (typeof userStats.averageSeverity !== 'number' || 
      userStats.averageSeverity < 1 || 
      userStats.averageSeverity > 10) {
    throw new ValidationError('averageSeverity must be a number between 1 and 10', 'averageSeverity');
  }

  const validRiskLevels = ['low', 'medium', 'high'];
  if (!validRiskLevels.includes(userStats.riskLevel)) {
    throw new ValidationError('riskLevel must be one of: low, medium, high', 'riskLevel');
  }

  if (userStats.totalYears !== undefined &&
      (typeof userStats.totalYears !== 'number' || userStats.totalYears < 0)) {
    throw new ValidationError('totalYears must be a non-negative number', 'totalYears');
  }

  if (userStats.lifeSentences !== undefined &&
      (typeof userStats.lifeSentences !== 'number' || userStats.lifeSentences < 0)) {
    throw new ValidationError('lifeSentences must be a non-negative number', 'lifeSentences');
  }

  if (userStats.lastViolationDate !== undefined && !(userStats.lastViolationDate instanceof Date)) {
    throw new ValidationError('lastViolationDate must be a Date or undefined', 'lastViolationDate');
  }

  if (userStats.mostCommonViolation !== undefined && typeof userStats.mostCommonViolation !== 'string') {
    throw new ValidationError('mostCommonViolation must be a string or undefined', 'mostCommonViolation');
  }

  return true;
}

/**
 * Валидация сравнения периодов
 */
export function validatePeriodComparison(comparison: any): comparison is PeriodComparison {
  if (!comparison || typeof comparison !== 'object') {
    throw new ValidationError('PeriodComparison must be an object');
  }

  if (typeof comparison.violationsChange !== 'number') {
    throw new ValidationError('violationsChange must be a number', 'violationsChange');
  }

  if (typeof comparison.severityChange !== 'number') {
    throw new ValidationError('severityChange must be a number', 'severityChange');
  }

  if (typeof comparison.usersChange !== 'number') {
    throw new ValidationError('usersChange must be a number', 'usersChange');
  }

  return true;
}

/**
 * Валидация статистики за период
 */
export function validatePeriodStats(periodStats: any): periodStats is PeriodStats {
  if (!periodStats || typeof periodStats !== 'object') {
    throw new ValidationError('PeriodStats must be an object');
  }

  if (!periodStats.chatId || typeof periodStats.chatId !== 'string') {
    throw new ValidationError('chatId must be a non-empty string', 'chatId');
  }

  if (!(periodStats.startDate instanceof Date)) {
    throw new ValidationError('startDate must be a Date', 'startDate');
  }

  if (!(periodStats.endDate instanceof Date)) {
    throw new ValidationError('endDate must be a Date', 'endDate');
  }

  if (periodStats.startDate >= periodStats.endDate) {
    throw new ValidationError('startDate must be before endDate');
  }

  if (typeof periodStats.totalViolations !== 'number' || periodStats.totalViolations < 0) {
    throw new ValidationError('totalViolations must be a non-negative number', 'totalViolations');
  }

  if (!Array.isArray(periodStats.violationsByArticle)) {
    throw new ValidationError('violationsByArticle must be an array', 'violationsByArticle');
  }

  periodStats.violationsByArticle.forEach((violation: any, index: number) => {
    try {
      validateViolationCount(violation);
    } catch (error) {
      throw new ValidationError(`Invalid violationCount at index ${index}: ${error.message}`);
    }
  });

  if (typeof periodStats.averageSeverity !== 'number' || 
      periodStats.averageSeverity < 1 || 
      periodStats.averageSeverity > 10) {
    throw new ValidationError('averageSeverity must be a number between 1 and 10', 'averageSeverity');
  }

  if (typeof periodStats.uniqueUsers !== 'number' || periodStats.uniqueUsers < 0) {
    throw new ValidationError('uniqueUsers must be a non-negative number', 'uniqueUsers');
  }

  if (periodStats.totalYears !== undefined &&
      (typeof periodStats.totalYears !== 'number' || periodStats.totalYears < 0)) {
    throw new ValidationError('totalYears must be a non-negative number', 'totalYears');
  }

  if (periodStats.lifeSentences !== undefined &&
      (typeof periodStats.lifeSentences !== 'number' || periodStats.lifeSentences < 0)) {
    throw new ValidationError('lifeSentences must be a non-negative number', 'lifeSentences');
  }

  if (periodStats.comparisonWithPreviousPeriod !== undefined) {
    try {
      validatePeriodComparison(periodStats.comparisonWithPreviousPeriod);
    } catch (error) {
      throw new ValidationError(`Invalid period comparison: ${error.message}`);
    }
  }

  return true;
}

/**
 * Валидация общей статистики
 */
export function validateGeneralStats(generalStats: any): generalStats is GeneralStats {
  if (!generalStats || typeof generalStats !== 'object') {
    throw new ValidationError('GeneralStats must be an object');
  }

  if (!generalStats.chatId || typeof generalStats.chatId !== 'string') {
    throw new ValidationError('chatId must be a non-empty string', 'chatId');
  }

  if (typeof generalStats.totalViolations !== 'number' || generalStats.totalViolations < 0) {
    throw new ValidationError('totalViolations must be a non-negative number', 'totalViolations');
  }

  if (!Array.isArray(generalStats.topViolations)) {
    throw new ValidationError('topViolations must be an array', 'topViolations');
  }

  generalStats.topViolations.forEach((violation: any, index: number) => {
    try {
      validateViolationCount(violation);
    } catch (error) {
      throw new ValidationError(`Invalid topViolation at index ${index}: ${error.message}`);
    }
  });

  if (!Array.isArray(generalStats.topUsers)) {
    throw new ValidationError('topUsers must be an array', 'topUsers');
  }

  generalStats.topUsers.forEach((user: any, index: number) => {
    try {
      validateUserViolationCount(user);
    } catch (error) {
      throw new ValidationError(`Invalid topUser at index ${index}: ${error.message}`);
    }
  });

  const validRiskLevels = ['low', 'medium', 'high'];
  if (!validRiskLevels.includes(generalStats.overallRiskLevel)) {
    throw new ValidationError('overallRiskLevel must be one of: low, medium, high', 'overallRiskLevel');
  }

  if (typeof generalStats.averageSeverity !== 'number' || 
      generalStats.averageSeverity < 1 || 
      generalStats.averageSeverity > 10) {
    throw new ValidationError('averageSeverity must be a number between 1 and 10', 'averageSeverity');
  }

  if (generalStats.totalYears !== undefined &&
      (typeof generalStats.totalYears !== 'number' || generalStats.totalYears < 0)) {
    throw new ValidationError('totalYears must be a non-negative number', 'totalYears');
  }

  if (generalStats.lifeSentences !== undefined &&
      (typeof generalStats.lifeSentences !== 'number' || generalStats.lifeSentences < 0)) {
    throw new ValidationError('lifeSentences must be a non-negative number', 'lifeSentences');
  }

  if (!Array.isArray(generalStats.criticalViolations)) {
    throw new ValidationError('criticalViolations must be an array', 'criticalViolations');
  }

  generalStats.criticalViolations.forEach((violation: any, index: number) => {
    try {
      validateViolation(violation);
    } catch (error) {
      throw new ValidationError(`Invalid criticalViolation at index ${index}: ${error.message}`);
    }
  });

  return true;
}

/**
 * Утилитарные функции для валидации и санитизации данных
 */
export const ValidationUtils = {
  /**
   * Проверяет, является ли уровень риска валидным
   */
  isValidRiskLevel(riskLevel: string): riskLevel is 'low' | 'medium' | 'high' {
    return ['low', 'medium', 'high'].includes(riskLevel);
  },

  /**
   * Проверяет, является ли серьезность валидной
   */
  isValidSeverity(severity: number): boolean {
    return typeof severity === 'number' && severity >= 1 && severity <= 10;
  },

  /**
   * Проверяет, является ли уровень доверия валидным
   */
  isValidConfidence(confidence: number): boolean {
    return typeof confidence === 'number' && confidence >= 0 && confidence <= 1;
  },

  /**
   * Вычисляет уровень риска на основе средней серьезности
   */
  calculateRiskLevel(averageSeverity: number): 'low' | 'medium' | 'high' {
    if (averageSeverity <= 3) return 'low';
    if (averageSeverity <= 6) return 'medium';
    return 'high';
  },

  /**
   * Санитизирует и нормализует серьезность
   */
  sanitizeSeverity(severity: any): number {
    if (typeof severity === 'number' && !isNaN(severity)) {
      return Math.max(1, Math.min(10, Math.round(severity)));
    }
    if (typeof severity === 'string') {
      const parsed = parseFloat(severity);
      if (!isNaN(parsed)) {
        return Math.max(1, Math.min(10, Math.round(parsed)));
      }
    }
    return 1; // Fallback to minimum severity
  },

  /**
   * Санитизирует и нормализует уровень доверия
   */
  sanitizeConfidence(confidence: any): number {
    if (typeof confidence === 'number' && !isNaN(confidence)) {
      return Math.max(0, Math.min(1, confidence));
    }
    if (typeof confidence === 'string') {
      const parsed = parseFloat(confidence);
      if (!isNaN(parsed)) {
        return Math.max(0, Math.min(1, parsed));
      }
    }
    return 0.5; // Fallback to neutral confidence
  },

  /**
   * Санитизирует строковое поле
   */
  sanitizeString(value: any, fallback: string = ''): string {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : fallback;
    }
    if (value != null) {
      const stringified = String(value).trim();
      return stringified.length > 0 ? stringified : fallback;
    }
    return fallback;
  },

  /**
   * Санитизирует уровень риска
   */
  sanitizeRiskLevel(riskLevel: any): 'low' | 'medium' | 'high' {
    if (typeof riskLevel === 'string' && this.isValidRiskLevel(riskLevel)) {
      return riskLevel;
    }
    return 'low'; // Fallback to low risk
  },

  /**
   * Проверяет, является ли объект пустым или null/undefined
   */
  isEmpty(value: any): boolean {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
  },

  /**
   * Проверяет, является ли значение валидной датой
   */
  isValidDate(date: any): boolean {
    return date instanceof Date && !isNaN(date.getTime());
  },

  /**
   * Санитизирует дату
   */
  sanitizeDate(date: any): Date | undefined {
    if (this.isValidDate(date)) {
      return date;
    }
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (this.isValidDate(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }
};

/**
 * Функции для санитизации и восстановления данных
 */
export const DataSanitizer = {
  /**
   * Санитизирует нарушение, восстанавливая поврежденные данные
   */
  sanitizeViolation(violation: any): Violation {
    if (!violation || typeof violation !== 'object') {
      return {
        article: 'Неизвестная статья',
        subarticle: null,
        articleTitle: 'Неизвестное нарушение',
        quote: 'Данные повреждены',
        punishment: 'Не определено',
        severity: 1,
        confidence: 0.1
      };
    }

    const sanitizedArticle = ValidationUtils.sanitizeString(violation.article, 'Неизвестная статья');
    const sanitizedSubarticle = violation.subarticle ? ValidationUtils.sanitizeString(violation.subarticle, '') : null;
    const sanitizedArticleTitle = ValidationUtils.sanitizeString(violation.articleTitle, 'Неизвестное нарушение');
    const sanitizedQuote = ValidationUtils.sanitizeString(violation.quote, 'Данные повреждены');
    const sanitizedPunishment = ValidationUtils.sanitizeString(violation.punishment, 'Не определено');
    
    // Если статья пустая или является дефолтной, пропускаем это нарушение
    if (sanitizedArticle === 'Неизвестная статья' && sanitizedQuote === 'Данные повреждены') {
      return null as any; // Будет отфильтровано позже
    }

    return {
      article: sanitizedArticle,
      subarticle: sanitizedSubarticle,
      articleTitle: sanitizedArticleTitle,
      quote: sanitizedQuote,
      punishment: sanitizedPunishment,
      severity: ValidationUtils.sanitizeSeverity(violation.severity),
      confidence: ValidationUtils.sanitizeConfidence(violation.confidence)
    };
  },

  /**
   * Санитизирует анализ нарушений, восстанавливая поврежденные данные
   */
  sanitizeViolationAnalysis(analysis: any): ViolationAnalysis {
    if (!analysis || typeof analysis !== 'object') {
      return {
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: new Date().toISOString()
      };
    }

    // Санитизируем массив нарушений
    let violations: Violation[] = [];
    if (Array.isArray(analysis.violations)) {
      violations = analysis.violations
        .map((v: any) => this.sanitizeViolation(v))
        .filter((v: Violation | null) => v !== null && v.article && v.article !== 'Неизвестная статья');
    }

    // Вычисляем общую серьезность
    const totalSeverity = violations.reduce((sum, v) => sum + v.severity, 0);
    const averageSeverity = violations.length > 0 ? totalSeverity / violations.length : 0;

    return {
      hasViolations: violations.length > 0,
      violations,
      totalSeverity,
      riskLevel: ValidationUtils.calculateRiskLevel(averageSeverity),
      analysisTimestamp: ValidationUtils.sanitizeString(analysis.analysisTimestamp, new Date().toISOString())
    };
  },

  /**
   * Создает пустую статистику пользователя
   */
  createEmptyUserStats(userId: string, chatId: string): UserStats {
    return {
      userId: ValidationUtils.sanitizeString(userId, 'unknown'),
      chatId: ValidationUtils.sanitizeString(chatId, 'unknown'),
      totalViolations: 0,
      violationsByArticle: [],
      averageSeverity: 0,
      riskLevel: 'low',
      lastViolationDate: undefined,
      mostCommonViolation: undefined
    };
  },

  /**
   * Создает пустую статистику за период
   */
  createEmptyPeriodStats(chatId: string, startDate: Date, endDate: Date): PeriodStats {
    return {
      chatId: ValidationUtils.sanitizeString(chatId, 'unknown'),
      startDate: ValidationUtils.sanitizeDate(startDate) || new Date(),
      endDate: ValidationUtils.sanitizeDate(endDate) || new Date(),
      totalViolations: 0,
      violationsByArticle: [],
      averageSeverity: 0,
      uniqueUsers: 0,
      comparisonWithPreviousPeriod: undefined
    };
  },

  /**
   * Создает пустую общую статистику
   */
  createEmptyGeneralStats(chatId: string): GeneralStats {
    return {
      chatId: ValidationUtils.sanitizeString(chatId, 'unknown'),
      totalViolations: 0,
      topViolations: [],
      topUsers: [],
      overallRiskLevel: 'low',
      averageSeverity: 0,
      criticalViolations: []
    };
  }
};
