/**
 * Пример использования ViolationHandler
 * Демонстрирует основные возможности обработчика нарушений
 */

import { ViolationHandler } from '../src/violation-handler';
import type { CriminalAnalysisResult, Env } from '../src/env';

// Пример mock окружения для демонстрации
const mockEnv: Env = {
  DB: null as any, // В реальном приложении здесь будет D1 Database
  HISTORY: {} as any,
  COUNTERS: {} as any,
  COUNTERS_DO: {} as any,
  MESSAGE_FETCHER_DO: {} as any,
  MESSAGE_AGGREGATOR_DO: {} as any,
  DAY_BLOCK_MANAGER_DO: {} as any,
  CRIMINAL_CODE_ANALYZER_DO: {} as any,
  AI: {},
  TOKEN: 'demo-token',
  SECRET: 'demo-secret',
  SUMMARY_MODEL: 'demo-model',
  SUMMARY_PROMPT: 'demo-prompt'
};

async function demonstrateViolationHandler() {
  console.log('🚀 Демонстрация ViolationHandler\n');

  // Создаем экземпляр ViolationHandler
  const violationHandler = new ViolationHandler(mockEnv);

  // Пример 1: Обработка анализа с нарушениями
  console.log('📋 Пример 1: Форматирование сообщения с нарушениями');
  const violationAnalysis: ViolationAnalysis = {
    hasViolations: true,
    violations: [
      {
        article: '282',
        quote: 'Пример текста, содержащего экстремистские высказывания',
        punishment: 'Штраф в размере до трехсот тысяч рублей или лишение свободы на срок до четырех лет',
        severity: 8,
        confidence: 0.92
      },
      {
        article: '130',
        quote: 'Оскорбительные высказывания в адрес группы лиц',
        punishment: 'Штраф в размере до сорока тысяч рублей',
        severity: 4,
        confidence: 0.78
      }
    ],
    totalSeverity: 12,
    riskLevel: 'high',
    analysisTimestamp: new Date().toISOString()
  };

  try {
    const formattedMessage = await violationHandler.formatViolationMessage(violationAnalysis);
    console.log('✅ Результат форматирования:');
    console.log(formattedMessage);
    console.log('\n' + '='.repeat(80) + '\n');
  } catch (error) {
    console.error('❌ Ошибка при форматировании:', error);
  }

  // Пример 2: Обработка анализа без нарушений
  console.log('📋 Пример 2: Форматирование сообщения без нарушений');
  const cleanAnalysis: ViolationAnalysis = {
    hasViolations: false,
    violations: [],
    totalSeverity: 0,
    riskLevel: 'low',
    analysisTimestamp: new Date().toISOString()
  };

  try {
    const cleanMessage = await violationHandler.formatViolationMessage(cleanAnalysis);
    console.log('✅ Результат форматирования:');
    console.log(cleanMessage);
    console.log('\n' + '='.repeat(80) + '\n');
  } catch (error) {
    console.error('❌ Ошибка при форматировании:', error);
  }

  // Пример 3: Получение статистики пользователя (будет ошибка без БД)
  console.log('📋 Пример 3: Получение статистики пользователя');
  try {
    const userStats = await violationHandler.getUserStats('123456', '-100123456789');
    console.log('✅ Статистика пользователя:');
    console.log(userStats);
  } catch (error) {
    console.log('⚠️ Ожидаемая ошибка (нет подключения к БД):');
    console.log('Статистика недоступна без настроенной базы данных');
  }
  console.log('\n' + '='.repeat(80) + '\n');

  // Пример 4: Валидация входных данных
  console.log('📋 Пример 4: Валидация входных данных');
  const invalidAnalysis = {
    hasViolations: true,
    violations: [
      {
        article: '', // Невалидная статья
        quote: 'Тест',
        punishment: 'Тест',
        severity: 15, // Невалидная серьезность
        confidence: 0.8
      }
    ],
    totalSeverity: 5,
    riskLevel: 'medium',
    analysisTimestamp: new Date().toISOString()
  } as any;

  try {
    const result = await violationHandler.formatViolationMessage(invalidAnalysis);
    console.log('✅ Fallback сообщение при ошибке валидации:');
    console.log(result);
  } catch (error) {
    console.error('❌ Неожиданная ошибка:', error);
  }
  console.log('\n' + '='.repeat(80) + '\n');

  console.log('🎉 Демонстрация завершена!');
  console.log('\n📝 Основные возможности ViolationHandler:');
  console.log('• Форматирование сообщений о нарушениях с HTML разметкой');
  console.log('• Валидация входных данных');
  console.log('• Обработка ошибок с fallback сообщениями');
  console.log('• Интеграция со статистическими сервисами');
  console.log('• Поддержка эмодзи-индикаторов серьезности');
  console.log('• Предупреждения при низком уровне доверия');
}

// Запускаем демонстрацию, если файл выполняется напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateViolationHandler().catch(console.error);
}

export { demonstrateViolationHandler };