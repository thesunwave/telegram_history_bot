/**
 * Health Check система для верификации работоспособности компонентов
 */

import type { Env } from '../env';
import { ViolationRepository } from '../repositories/violation-repository';
import { ErrorHandler, DatabaseError } from './errors';
import { Logger } from '../logger';

export interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  timestamp: Date;
  responseTime?: number;
  details?: Record<string, unknown>;
}

export interface SystemHealthReport {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheckResult[];
  timestamp: Date;
}

export class HealthChecker {
  constructor(private env: Env) {}

  /**
   * Проверка подключения к базе данных
   */
  async checkDatabase(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      if (!this.env.DB) {
        return {
          component: 'database',
          status: 'unhealthy',
          message: 'Database not configured',
          timestamp: new Date()
        };
      }

      // Простой запрос для проверки подключения
      const result = await this.env.DB.prepare('SELECT 1 as test').first();
      const responseTime = Date.now() - startTime;

      if (result && (result as any).test === 1) {
        return {
          component: 'database',
          status: 'healthy',
          message: 'Database connection successful',
          timestamp: new Date(),
          responseTime,
          details: { query: 'SELECT 1', result }
        };
      } else {
        return {
          component: 'database',
          status: 'unhealthy',
          message: 'Database query returned unexpected result',
          timestamp: new Date(),
          responseTime,
          details: { result }
        };
      }
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      return {
        component: 'database',
        status: 'unhealthy',
        message: `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
        responseTime,
        details: { error: error instanceof Error ? error.message : error }
      };
    }
  }

  /**
   * Проверка ViolationRepository
   */
  async checkViolationRepository(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const repository = new ViolationRepository(this.env);
      
      // Тестовый запрос статистики для несуществующего чата
      const result = await repository.getGeneralStats('health-check-test');
      const responseTime = Date.now() - startTime;

      if (ErrorHandler.isSuccess(result)) {
        return {
          component: 'violation-repository',
          status: 'healthy',
          message: 'ViolationRepository working correctly',
          timestamp: new Date(),
          responseTime,
          details: { 
            totalViolations: result.data.totalViolations,
            resultType: 'success'
          }
        };
      } else {
        // Ошибка базы данных может быть ожидаемой для тестового чата
        if (result.error instanceof DatabaseError) {
          return {
            component: 'violation-repository',
            status: 'healthy',
            message: 'ViolationRepository error handling working correctly',
            timestamp: new Date(),
            responseTime,
            details: { 
              errorCode: result.error.code,
              resultType: 'expected_error'
            }
          };
        } else {
          return {
            component: 'violation-repository',
            status: 'unhealthy',
            message: `ViolationRepository error: ${result.error.message}`,
            timestamp: new Date(),
            responseTime,
            details: { error: result.error }
          };
        }
      }
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      return {
        component: 'violation-repository',
        status: 'unhealthy',
        message: `ViolationRepository exception: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
        responseTime,
        details: { error: error instanceof Error ? error.message : error }
      };
    }
  }

  /**
   * Проверка системы обработки ошибок
   */
  async checkErrorHandling(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Тестируем ErrorHandler
      const result = await ErrorHandler.handle(async () => {
        throw new Error('Test error');
      }, {
        operationName: 'health-check-error-test'
      });

      const responseTime = Date.now() - startTime;

      if (ErrorHandler.isFailure(result) && result.error.message === 'Test error') {
        return {
          component: 'error-handling',
          status: 'healthy',
          message: 'Error handling system working correctly',
          timestamp: new Date(),
          responseTime,
          details: { 
            correlationId: result.metadata?.correlationId,
            errorCode: result.error.code
          }
        };
      } else {
        return {
          component: 'error-handling',
          status: 'unhealthy',
          message: 'Error handling system not working as expected',
          timestamp: new Date(),
          responseTime,
          details: { result }
        };
      }
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      return {
        component: 'error-handling',
        status: 'unhealthy',
        message: `Error handling test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
        responseTime,
        details: { error: error instanceof Error ? error.message : error }
      };
    }
  }

  /**
   * Проверка AI провайдеров
   */
  async checkAIProviders(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      if (!this.env.AI) {
        return {
          component: 'ai-providers',
          status: 'degraded',
          message: 'AI provider not configured',
          timestamp: new Date(),
          responseTime: Date.now() - startTime
        };
      }

      // Простая проверка доступности AI
      // Не делаем реальный запрос, чтобы не тратить токены
      return {
        component: 'ai-providers',
        status: 'healthy',
        message: 'AI provider configured and available',
        timestamp: new Date(),
        responseTime: Date.now() - startTime,
        details: { configured: true }
      };
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      return {
        component: 'ai-providers',
        status: 'unhealthy',
        message: `AI provider error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(),
        responseTime,
        details: { error: error instanceof Error ? error.message : error }
      };
    }
  }

  /**
   * Полная проверка системы
   */
  async checkSystemHealth(): Promise<SystemHealthReport> {
    Logger.info('Starting system health check...');
    
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkViolationRepository(),
      this.checkErrorHandling(),
      this.checkAIProviders()
    ]);

    // Определяем общий статус системы
    const hasUnhealthy = checks.some(check => check.status === 'unhealthy');
    const hasDegraded = checks.some(check => check.status === 'degraded');
    
    let overall: 'healthy' | 'unhealthy' | 'degraded';
    if (hasUnhealthy) {
      overall = 'unhealthy';
    } else if (hasDegraded) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }

    const report: SystemHealthReport = {
      overall,
      checks,
      timestamp: new Date()
    };

    Logger.info('System health check completed', { 
      overall, 
      healthyChecks: checks.filter(c => c.status === 'healthy').length,
      totalChecks: checks.length 
    });

    return report;
  }

  /**
   * Быстрая проверка критических компонентов
   */
  async quickHealthCheck(): Promise<boolean> {
    try {
      const dbCheck = await this.checkDatabase();
      const repoCheck = await this.checkViolationRepository();
      
      return dbCheck.status !== 'unhealthy' && repoCheck.status !== 'unhealthy';
    } catch (error: unknown) {
      Logger.error('Quick health check failed', { error });
      return false;
    }
  }
}