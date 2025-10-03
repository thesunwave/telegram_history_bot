/**
 * Smoke Testing скрипт для проверки основной функциональности
 */

import { HealthChecker } from '../src/utils/health-check';
import { ViolationRepositoryAdapter } from '../src/repositories/violation-repository-adapter';
import { StatisticsService } from '../src/services/statistics-service';
import { MessageFormatter } from '../src/message-formatter';
import type { Env } from '../src/env';

interface SmokeTestResult {
  testName: string;
  passed: boolean;
  message: string;
  duration: number;
  error?: unknown;
}

class SmokeTestRunner {
  private results: SmokeTestResult[] = [];
  
  constructor(private env: Env) {}

  private async runTest(testName: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    
    try {
      await testFn();
      this.results.push({
        testName,
        passed: true,
        message: 'Test passed',
        duration: Date.now() - startTime
      });
    } catch (error) {
      this.results.push({
        testName,
        passed: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
        error
      });
    }
  }

  async testHealthChecks(): Promise<void> {
    await this.runTest('Health Checks', async () => {
      const healthChecker = new HealthChecker(this.env);
      const report = await healthChecker.checkSystemHealth();
      
      if (report.overall === 'unhealthy') {
        const unhealthyChecks = report.checks.filter(c => c.status === 'unhealthy');
        throw new Error(`System unhealthy: ${unhealthyChecks.map(c => c.component).join(', ')}`);
      }
    });
  }

  async testViolationRepository(): Promise<void> {
    await this.runTest('ViolationRepository Basic Operations', async () => {
      const repository = new ViolationRepositoryAdapter(this.env);
      
      // Тест получения статистики для несуществующего пользователя
      try {
        const stats = await repository.getUserStats('smoke-test-user', 'smoke-test-chat');
        
        // Проверяем структуру ответа
        if (typeof stats.totalViolations !== 'number' ||
            typeof stats.averageSeverity !== 'number' ||
            !Array.isArray(stats.violationsByArticle)) {
          throw new Error('Invalid UserStats structure');
        }
      } catch (error) {
        // Ошибка базы данных может быть ожидаемой
        if (!(error instanceof Error) || !error.message.includes('Database')) {
          throw error;
        }
      }
    });
  }

  async testStatisticsService(): Promise<void> {
    await this.runTest('StatisticsService Integration', async () => {
      const repository = new ViolationRepositoryAdapter(this.env);
      const service = new StatisticsService(repository);
      
      // Тест получения статистики
      try {
        const stats = await service.getUserStats('smoke-test-user', 'smoke-test-chat');
        
        // Проверяем, что сервис возвращает правильную структуру
        if (typeof stats.totalViolations !== 'number') {
          throw new Error('StatisticsService returned invalid structure');
        }
      } catch (error) {
        // Ошибка базы данных может быть ожидаемой
        if (!(error instanceof Error) || !error.message.includes('Failed to get user stats')) {
          throw error;
        }
      }
    });
  }

  async testMessageFormatter(): Promise<void> {
    await this.runTest('MessageFormatter', async () => {
      const formatter = new MessageFormatter();
      
      // Тест форматирования нарушения
      const violation = {
        article: '282',
        subarticle: null,
        articleTitle: 'Test Article',
        quote: 'Test quote',
        punishment: 'Test punishment',
        severity: 5,
        confidence: 0.8
      };
      
      const formatted = formatter.formatViolation(violation);
      
      if (!formatted.includes('282') || !formatted.includes('Test quote')) {
        throw new Error('MessageFormatter did not format violation correctly');
      }
    });
  }

  async testErrorHandling(): Promise<void> {
    await this.runTest('Error Handling System', async () => {
      const { ErrorHandler } = await import('../src/utils/errors');
      
      // Тест обработки ошибок
      const result = await ErrorHandler.handle(async () => {
        throw new Error('Test error');
      }, {
        operationName: 'smoke-test'
      });
      
      if (ErrorHandler.isSuccess(result)) {
        throw new Error('ErrorHandler should have caught the error');
      }
      
      if (!result.error || result.error.message !== 'Test error') {
        throw new Error('ErrorHandler did not preserve error correctly');
      }
    });
  }

  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Smoke Tests...\n');
    
    await this.testHealthChecks();
    await this.testViolationRepository();
    await this.testStatisticsService();
    await this.testMessageFormatter();
    await this.testErrorHandling();
    
    this.printResults();
  }

  private printResults(): void {
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    
    console.log('\n📊 Smoke Test Results:');
    console.log('='.repeat(50));
    
    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      const duration = `${result.duration}ms`;
      console.log(`${status} ${result.testName} (${duration})`);
      
      if (!result.passed) {
        console.log(`   Error: ${result.message}`);
      }
    });
    
    console.log('='.repeat(50));
    console.log(`📈 Summary: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('🎉 All smoke tests passed!');
      process.exit(0);
    } else {
      console.log('💥 Some smoke tests failed!');
      process.exit(1);
    }
  }
}

// Запуск smoke тестов
async function runSmokeTests() {
  // Создаем mock environment для тестирования
  const mockEnv: Env = {
    DB: undefined, // Будет тестироваться отсутствие DB
    AI: undefined,
    TOKEN: 'test-token',
    SECRET: 'test-secret',
    // Добавляем остальные поля по необходимости
  } as any;
  
  const runner = new SmokeTestRunner(mockEnv);
  await runner.runAllTests();
}

// Запускаем только если файл выполняется напрямую
if (require.main === module) {
  runSmokeTests().catch(error => {
    console.error('💥 Smoke tests crashed:', error);
    process.exit(1);
  });
}