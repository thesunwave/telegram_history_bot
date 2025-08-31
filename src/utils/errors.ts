/**
 * Unified Error Handling System
 * Provides consistent error handling patterns across the application
 */

import { Logger } from '../logger';

/**
 * Base application error interface
 */
export interface AppError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
  correlationId?: string;
  context?: Record<string, unknown>;
  stack?: string;
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Base AppError class
 */
export class BaseAppError extends Error implements AppError {
  public readonly code: string;
  public readonly timestamp: Date;
  public readonly correlationId?: string;
  public readonly context?: Record<string, unknown>;
  public readonly severity: ErrorSeverity;

  constructor(
    code: string,
    message: string,
    options: {
      details?: unknown;
      correlationId?: string;
      context?: Record<string, unknown>;
      severity?: ErrorSeverity;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.timestamp = new Date();
    this.correlationId = options.correlationId || this.generateCorrelationId();
    this.context = options.context;
    this.severity = options.severity || ErrorSeverity.MEDIUM;

    if (options.cause) {
      this.stack = options.cause.stack;
    }

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  private generateCorrelationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  toJSON(): AppError {
    return {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
      context: this.context,
      stack: this.stack
    };
  }
}

/**
 * Database operation errors
 */
export class DatabaseError extends BaseAppError {
  constructor(
    message: string,
    options: {
      query?: string;
      parameters?: unknown[];
      details?: unknown;
      correlationId?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super('DATABASE_ERROR', message, {
      ...options,
      severity: ErrorSeverity.HIGH,
      context: {
        ...options.context,
        query: options.query,
        parameters: options.parameters
      }
    });
  }
}

/**
 * Validation errors
 */
export class ValidationError extends BaseAppError {
  constructor(
    message: string,
    options: {
      field?: string;
      value?: unknown;
      rule?: string;
      details?: unknown;
      correlationId?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super('VALIDATION_ERROR', message, {
      ...options,
      severity: ErrorSeverity.MEDIUM,
      context: {
        ...options.context,
        field: options.field,
        value: options.value,
        rule: options.rule
      }
    });
  }
}

/**
 * External service errors (AI providers, Telegram API, etc.)
 */
export class ExternalServiceError extends BaseAppError {
  constructor(
    message: string,
    options: {
      service?: string;
      statusCode?: number;
      response?: unknown;
      details?: unknown;
      correlationId?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super('EXTERNAL_SERVICE_ERROR', message, {
      ...options,
      severity: ErrorSeverity.HIGH,
      context: {
        ...options.context,
        service: options.service,
        statusCode: options.statusCode,
        response: options.response
      }
    });
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends BaseAppError {
  constructor(
    message: string,
    options: {
      configKey?: string;
      expectedType?: string;
      actualValue?: unknown;
      details?: unknown;
      correlationId?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super('CONFIGURATION_ERROR', message, {
      ...options,
      severity: ErrorSeverity.CRITICAL,
      context: {
        ...options.context,
        configKey: options.configKey,
        expectedType: options.expectedType,
        actualValue: options.actualValue
      }
    });
  }
}

/**
 * Business logic errors
 */
export class BusinessLogicError extends BaseAppError {
  constructor(
    message: string,
    options: {
      operation?: string;
      details?: unknown;
      correlationId?: string;
      context?: Record<string, unknown>;
      cause?: Error;
    } = {}
  ) {
    super('BUSINESS_LOGIC_ERROR', message, {
      ...options,
      severity: ErrorSeverity.MEDIUM,
      context: {
        ...options.context,
        operation: options.operation
      }
    });
  }
}

/**
 * Result wrapper for consistent error handling
 */
export interface Result<T> {
  success: boolean;
  data?: T;
  error?: AppError;
  metadata?: {
    executionTime?: number;
    cacheHit?: boolean;
    source?: string;
    correlationId?: string;
  };
}

/**
 * Success result factory
 */
export function success<T>(
  data: T,
  metadata?: Result<T>['metadata']
): Result<T> {
  return {
    success: true,
    data,
    metadata
  };
}

/**
 * Error result factory
 */
export function failure<T>(
  error: AppError,
  metadata?: Result<T>['metadata']
): Result<T> {
  return {
    success: false,
    error,
    metadata
  };
}

/**
 * Error handler utility class
 */
export class ErrorHandler {
  /**
   * Safely execute an operation and return a Result
   */
  static async handle<T>(
    operation: () => Promise<T> | T,
    context: {
      operationName: string;
      correlationId?: string;
      context?: Record<string, unknown>;
    }
  ): Promise<Result<T>> {
    const startTime = Date.now();
    const correlationId = context.correlationId || new BaseAppError('', '').correlationId;

    try {
      const result = await operation();
      const executionTime = Date.now() - startTime;

      return success(result, {
        executionTime,
        correlationId,
        source: context.operationName
      });
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      const appError = this.convertToAppError(error, {
        operationName: context.operationName,
        correlationId,
        context: context.context
      });

      this.logError(appError, context.operationName);

      return failure(appError, {
        executionTime,
        correlationId,
        source: context.operationName
      });
    }
  }

  /**
   * Convert unknown error to AppError
   */
  static convertToAppError(
    error: unknown,
    context: {
      operationName: string;
      correlationId?: string;
      context?: Record<string, unknown>;
    }
  ): AppError {
    if (error instanceof BaseAppError) {
      return error;
    }

    if (error instanceof Error) {
      return new BaseAppError('UNKNOWN_ERROR', error.message, {
        correlationId: context.correlationId,
        context: {
          ...context.context,
          operationName: context.operationName,
          originalErrorName: error.name
        },
        cause: error
      });
    }

    return new BaseAppError('UNKNOWN_ERROR', String(error), {
      correlationId: context.correlationId,
      context: {
        ...context.context,
        operationName: context.operationName,
        originalError: error
      }
    });
  }

  /**
   * Log error with proper context
   */
  static logError(error: AppError, operationName: string): void {
    Logger.error(`Operation failed: ${operationName}`, {
      code: error.code,
      message: error.message,
      correlationId: error.correlationId,
      timestamp: error.timestamp,
      context: error.context,
      stack: error.stack
    });
  }

  /**
   * Create type guard for checking if result is successful
   */
  static isSuccess<T>(result: Result<T>): result is Result<T> & { success: true; data: T } {
    return result.success;
  }

  /**
   * Create type guard for checking if result is failure
   */
  static isFailure<T>(result: Result<T>): result is Result<T> & { success: false; error: AppError } {
    return !result.success;
  }
}

/**
 * Type guards for runtime validation
 */
export class TypeGuards {
  /**
   * Check if value is a string
   */
  static isString(value: unknown): value is string {
    return typeof value === 'string';
  }

  /**
   * Check if value is a number
   */
  static isNumber(value: unknown): value is number {
    return typeof value === 'number' && !isNaN(value);
  }

  /**
   * Check if value is a valid date
   */
  static isDate(value: unknown): value is Date {
    return value instanceof Date && !isNaN(value.getTime());
  }

  /**
   * Check if value is an object
   */
  static isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  /**
   * Check if value is an array
   */
  static isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
  }

  /**
   * Check if value is defined (not null or undefined)
   */
  static isDefined<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
  }

  /**
   * Validate database result structure
   */
  static isDatabaseResult(value: unknown): value is { results?: unknown[]; success?: boolean; meta?: unknown } {
    return this.isObject(value) && 
           (value.results === undefined || this.isArray(value.results)) &&
           (value.success === undefined || typeof value.success === 'boolean');
  }
}