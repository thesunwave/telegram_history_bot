/**
 * Validation Error Handling
 * Specialized error classes and handlers for type validation failures
 */

import type { ValidationError as ValidationErrorType, ValidationResult } from '../types';

/**
 * Custom error class for validation failures
 */
export class ValidationError extends Error {
  public readonly field: string;
  public readonly value: unknown;
  public readonly code?: string;
  public readonly timestamp: Date;

  constructor(
    field: string,
    message: string,
    value?: unknown,
    code?: string
  ) {
    super(`Validation error in field '${field}': ${message}`);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.code = code;
    this.timestamp = new Date();
  }

  toJSON(): ValidationErrorType {
    return {
      field: this.field,
      message: this.message,
      value: this.value,
      code: this.code
    };
  }
}

/**
 * Error for multiple validation failures
 */
export class ValidationErrors extends Error {
  public readonly errors: ValidationError[];
  public readonly timestamp: Date;

  constructor(errors: ValidationError[] | ValidationErrorType[]) {
    const errorCount = errors.length;
    const firstError = errors[0];
    const message = errorCount === 1 
      ? `Validation failed: ${firstError.message}`
      : `${errorCount} validation errors occurred. First error: ${firstError.message}`;
    
    super(message);
    this.name = 'ValidationErrors';
    this.errors = errors.map(error => 
      error instanceof ValidationError 
        ? error 
        : new ValidationError(error.field || 'unknown', error.message, error.value, error.code)
    );
    this.timestamp = new Date();
  }

  toJSON(): ValidationErrorType[] {
    return this.errors.map(error => error.toJSON());
  }

  getErrorsByField(): Record<string, ValidationError[]> {
    const errorsByField: Record<string, ValidationError[]> = {};
    
    this.errors.forEach(error => {
      if (!errorsByField[error.field]) {
        errorsByField[error.field] = [];
      }
      errorsByField[error.field].push(error);
    });
    
    return errorsByField;
  }

  hasField(field: string): boolean {
    return this.errors.some(error => error.field === field);
  }

  getFieldErrors(field: string): ValidationError[] {
    return this.errors.filter(error => error.field === field);
  }
}

/**
 * Error for type safety violations
 */
export class TypeSafetyError extends Error {
  public readonly expectedType: string;
  public readonly actualType: string;
  public readonly value: unknown;
  public readonly context?: string;
  public readonly timestamp: Date;

  constructor(
    expectedType: string,
    actualType: string,
    value: unknown,
    context?: string
  ) {
    const message = `Type safety violation: expected ${expectedType}, got ${actualType}${context ? ` in ${context}` : ''}`;
    super(message);
    this.name = 'TypeSafetyError';
    this.expectedType = expectedType;
    this.actualType = actualType;
    this.value = value;
    this.context = context;
    this.timestamp = new Date();
  }

  toJSON() {
    return {
      expectedType: this.expectedType,
      actualType: this.actualType,
      value: this.value,
      context: this.context,
      message: this.message,
      timestamp: this.timestamp.toISOString()
    };
  }
}

/**
 * Error handler for validation failures
 */
export class ValidationErrorHandler {
  private errorCounts: Map<string, number> = new Map();
  private lastErrors: Map<string, Date> = new Map();
  private readonly maxErrorsPerField: number;
  private readonly errorCooldownMs: number;

  constructor(
    maxErrorsPerField: number = 10,
    errorCooldownMs: number = 60000 // 1 minute
  ) {
    this.maxErrorsPerField = maxErrorsPerField;
    this.errorCooldownMs = errorCooldownMs;
  }

  /**
   * Handle a validation error with rate limiting
   */
  handleValidationError(error: ValidationError): boolean {
    const now = new Date();
    const field = error.field;
    
    // Check if we're in cooldown period for this field
    const lastError = this.lastErrors.get(field);
    if (lastError && (now.getTime() - lastError.getTime()) < this.errorCooldownMs) {
      return false; // Skip handling due to cooldown
    }
    
    // Update error count
    const currentCount = this.errorCounts.get(field) || 0;
    if (currentCount >= this.maxErrorsPerField) {
      return false; // Skip handling due to rate limit
    }
    
    this.errorCounts.set(field, currentCount + 1);
    this.lastErrors.set(field, now);
    
    return true; // Error should be handled
  }

  /**
   * Reset error counts for a field
   */
  resetFieldErrors(field: string): void {
    this.errorCounts.delete(field);
    this.lastErrors.delete(field);
  }

  /**
   * Reset all error counts
   */
  resetAllErrors(): void {
    this.errorCounts.clear();
    this.lastErrors.clear();
  }

  /**
   * Get error statistics
   */
  getErrorStats(): Record<string, { count: number; lastError: Date | null }> {
    const stats: Record<string, { count: number; lastError: Date | null }> = {};
    
    for (const [field, count] of this.errorCounts.entries()) {
      stats[field] = {
        count,
        lastError: this.lastErrors.get(field) || null
      };
    }
    
    return stats;
  }
}

/**
 * Utility functions for handling validation results
 */
export class ValidationResultHandler {
  /**
   * Throw an error if validation failed
   */
  static throwOnError<T>(result: ValidationResult<T>): T {
    if (!result.isValid) {
      if (result.errors.length === 1) {
        const error = result.errors[0];
        throw new ValidationError(error.field || 'unknown', error.message, error.value, error.code);
      } else {
        throw new ValidationErrors(result.errors);
      }
    }
    
    if (result.value === undefined) {
      throw new ValidationError('result', 'Validation succeeded but no value was returned');
    }
    
    return result.value;
  }

  /**
   * Get value or return default if validation failed
   */
  static getValueOrDefault<T>(result: ValidationResult<T>, defaultValue: T): T {
    return result.isValid && result.value !== undefined ? result.value : defaultValue;
  }

  /**
   * Get value or return null if validation failed
   */
  static getValueOrNull<T>(result: ValidationResult<T>): T | null {
    return result.isValid && result.value !== undefined ? result.value : null;
  }

  /**
   * Transform validation result to a different type
   */
  static transform<T, U>(
    result: ValidationResult<T>,
    transformer: (value: T) => U
  ): ValidationResult<U> {
    if (!result.isValid || result.value === undefined) {
      return {
        isValid: false,
        errors: result.errors
      };
    }
    
    try {
      const transformedValue = transformer(result.value);
      return {
        isValid: true,
        value: transformedValue,
        errors: []
      };
    } catch (error: unknown) {
      return {
        isValid: false,
        errors: [{
          field: 'transform',
          message: `Transformation failed: ${error}`,
          value: result.value
        }]
      };
    }
  }

  /**
   * Combine multiple validation results
   */
  static combine<T>(results: ValidationResult<T>[]): ValidationResult<T[]> {
    const errors: ValidationErrorType[] = [];
    const values: T[] = [];
    
    results.forEach((result, index) => {
      if (result.isValid && result.value !== undefined) {
        values.push(result.value);
      } else {
        result.errors.forEach(error => {
          errors.push({
            field: `[${index}].${error.field}`,
            message: error.message,
            value: error.value,
            code: error.code
          });
        });
      }
    });
    
    const isValid = errors.length === 0;
    return {
      isValid,
      value: isValid ? values : undefined,
      errors
    };
  }

  /**
   * Filter out invalid results and return only valid values
   */
  static filterValid<T>(results: ValidationResult<T>[]): T[] {
    return results
      .filter(result => result.isValid && result.value !== undefined)
      .map(result => result.value!);
  }

  /**
   * Get all errors from multiple validation results
   */
  static getAllErrors<T>(results: ValidationResult<T>[]): ValidationErrorType[] {
    const errors: ValidationErrorType[] = [];
    
    results.forEach((result, index) => {
      if (!result.isValid) {
        result.errors.forEach(error => {
          errors.push({
            field: `[${index}].${error.field}`,
            message: error.message,
            value: error.value,
            code: error.code
          });
        });
      }
    });
    
    return errors;
  }
}

/**
 * Validation error formatter for different output formats
 */
export class ValidationErrorFormatter {
  /**
   * Format errors for API response
   */
  static formatForApi(errors: ValidationErrorType[]): {
    message: string;
    errors: Array<{
      field: string;
      message: string;
      code?: string;
    }>;
  } {
    return {
      message: `Validation failed with ${errors.length} error${errors.length === 1 ? '' : 's'}`,
      errors: errors.map(error => ({
        field: error.field || 'unknown',
        message: error.message,
        code: error.code
      }))
    };
  }

  /**
   * Format errors for logging
   */
  static formatForLogging(errors: ValidationErrorType[]): string {
    return errors
      .map(error => `${error.field || 'unknown'}: ${error.message}`)
      .join('; ');
  }

  /**
   * Format errors for user display
   */
  static formatForUser(errors: ValidationErrorType[]): string {
    if (errors.length === 1) {
      return errors[0].message;
    }
    
    return `Multiple validation errors occurred:\n${errors
      .map((error, index) => `${index + 1}. ${error.message}`)
      .join('\n')}`;
  }

  /**
   * Format errors as HTML
   */
  static formatAsHtml(errors: ValidationErrorType[]): string {
    if (errors.length === 1) {
      return `<p class="error">${this.escapeHtml(errors[0].message)}</p>`;
    }
    
    const errorList = errors
      .map(error => `<li>${this.escapeHtml(error.message)}</li>`)
      .join('');
    
    return `<div class="validation-errors">
      <p>Validation errors occurred:</p>
      <ul>${errorList}</ul>
    </div>`;
  }

  private static escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

/**
 * Export utility functions
 */
export function createValidationError(
  field: string,
  message: string,
  value?: unknown,
  code?: string
): ValidationError {
  return new ValidationError(field, message, value, code);
}

export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

export function isValidationErrors(error: unknown): error is ValidationErrors {
  return error instanceof ValidationErrors;
}

export function isTypeSafetyError(error: unknown): error is TypeSafetyError {
  return error instanceof TypeSafetyError;
}