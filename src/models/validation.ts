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

  if (typeof violationCount.count !== 'number' || violationCount.count < 0) {
    throw new ValidationError('Count must be a non-negative number', 'count');
  }

  if (typeof violationCount.averageSeverity !== 'number' || 
      violationCount.averageSeverity < 1 || 
      violationCount.averageSeverity > 10) {
    throw new ValidationError('averageSeverity must be a number between 1 and 10', 'averageSeverity');
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
 * Утилитарные функции для валидации
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
  }
};