/**
 * Модели данных для статистики нарушений
 * Содержит интерфейсы и типы для агрегированных данных статистики
 */

/**
 * Базовый интерфейс для нарушения
 */
export interface Violation {
  article: string;
  subarticle: string | null;
  articleTitle: string;
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
  subarticle: string | null;
  articleTitle: string;
  punishment: string;
  count: number;
  averageSeverity: number;
  totalYears?: number;
  lifeSentences?: number;
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
  totalYears?: number;
  lifeSentences?: number;
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
  totalYears?: number;
  lifeSentences?: number;
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
  totalYears?: number;
  lifeSentences?: number;
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
  totalYears?: number;
  lifeSentences?: number;
  criticalViolations: Violation[]; // нарушения с серьезностью >= 8
}
