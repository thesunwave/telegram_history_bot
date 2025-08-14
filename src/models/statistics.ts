/**
 * Модели данных для статистики нарушений
 * Содержит интерфейсы и типы для агрегированных данных статистики
 */

/**
 * Базовый интерфейс для нарушения
 */
export interface Violation {
  article: string;
  quote: string;
  punishment: string;
  severity: number; // 1-10
  confidence: number; // 0-1
}

/**
 * Анализ нарушений от LLM
 */
export interface ViolationAnalysis {
  hasViolations: boolean;
  violations: Violation[];
  totalSeverity: number;
  riskLevel: 'low' | 'medium' | 'high';
  analysisTimestamp: string;
}

/**
 * Количество нарушений по статье
 */
export interface ViolationCount {
  article: string;
  count: number;
  averageSeverity: number;
}

/**
 * Количество нарушений пользователя
 */
export interface UserViolationCount {
  userId: string;
  username?: string;
  count: number;
  averageSeverity: number;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Статистика пользователя
 */
export interface UserStats {
  userId: string;
  chatId: string;
  totalViolations: number;
  violationsByArticle: ViolationCount[];
  averageSeverity: number;
  riskLevel: 'low' | 'medium' | 'high';
  lastViolationDate?: Date;
  mostCommonViolation?: string;
}

/**
 * Сравнение с предыдущим периодом
 */
export interface PeriodComparison {
  violationsChange: number; // процентное изменение
  severityChange: number; // изменение средней серьезности
  usersChange: number; // изменение количества пользователей
}

/**
 * Статистика за период
 */
export interface PeriodStats {
  chatId: string;
  startDate: Date;
  endDate: Date;
  totalViolations: number;
  violationsByArticle: ViolationCount[];
  averageSeverity: number;
  uniqueUsers: number;
  comparisonWithPreviousPeriod?: PeriodComparison;
}

/**
 * Общая статистика чата
 */
export interface GeneralStats {
  chatId: string;
  totalViolations: number;
  topViolations: ViolationCount[]; // топ-5 самых частых нарушений
  topUsers: UserViolationCount[]; // топ-5 пользователей с наибольшим количеством нарушений
  overallRiskLevel: 'low' | 'medium' | 'high';
  averageSeverity: number;
  criticalViolations: Violation[]; // нарушения с серьезностью >= 8
}