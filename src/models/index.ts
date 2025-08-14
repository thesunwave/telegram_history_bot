/**
 * Экспорт всех моделей данных и функций валидации
 */

// Экспорт типов и интерфейсов
export {
  Violation,
  ViolationAnalysis,
  ViolationCount,
  UserViolationCount,
  UserStats,
  PeriodComparison,
  PeriodStats,
  GeneralStats
} from './statistics';

// Экспорт функций валидации
export {
  ValidationError,
  validateViolation,
  validateViolationAnalysis,
  validateViolationCount,
  validateUserViolationCount,
  validateUserStats,
  validatePeriodComparison,
  validatePeriodStats,
  validateGeneralStats,
  ValidationUtils
} from './validation';