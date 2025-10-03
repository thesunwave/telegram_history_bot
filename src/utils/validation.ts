/**
 * Unified Validation System
 * 
 * This module combines ValidationUtils and DataSanitizer functionality into a single,
 * comprehensive validation and sanitization system with schema-based validation
 * for all data models and data recovery utilities.
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
} from '../models/statistics';

/**
 * Validation error with detailed context
 */
export class ValidationError extends Error {
  constructor(
    message: string, 
    public field?: string,
    public code?: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validation result with detailed information
 */
export interface ValidationResult<T = unknown> {
  isValid: boolean;
  data?: T;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  sanitizedData?: T;
}

/**
 * Validation warning for non-critical issues
 */
export interface ValidationWarning {
  field?: string;
  message: string;
  code?: string;
}

/**
 * Schema definition for validation
 */
export interface ValidationSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'date';
  required?: boolean;
  properties?: Record<string, ValidationSchema>;
  items?: ValidationSchema;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: unknown[];
  custom?: (value: unknown) => boolean | string;
}

/**
 * Validation options
 */
export interface ValidationOptions {
  strict?: boolean;
  sanitize?: boolean;
  allowUnknownProperties?: boolean;
  removeUnknownProperties?: boolean;
}

/**
 * Core validation utilities
 */
export class ValidationCore {
  /**
   * Validates data against a schema
   */
  static validateSchema<T>(
    data: unknown, 
    schema: ValidationSchema, 
    options: ValidationOptions = {}
  ): ValidationResult<T> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const { strict = false, sanitize = false } = options;

    try {
      const result = this.validateValue(data, schema, '', errors, warnings, options);
      
      return {
        isValid: errors.length === 0,
        data: errors.length === 0 ? result as T : undefined,
        errors,
        warnings,
        sanitizedData: sanitize ? result as T : undefined
      };
    } catch (error: unknown) {
      errors.push(new ValidationError(
        `Schema validation failed: ${error.message}`,
        undefined,
        'SCHEMA_ERROR'
      ));
      
      return {
        isValid: false,
        errors,
        warnings
      };
    }
  }

  /**
   * Validates a single value against schema
   */
  private static validateValue(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options: ValidationOptions
  ): unknown {
    // Handle required validation
    if (schema.required && (value === null || value === undefined)) {
      errors.push(new ValidationError(
        `Required field is missing`,
        path,
        'REQUIRED_FIELD'
      ));
      return value;
    }

    // Handle optional fields
    if (!schema.required && (value === null || value === undefined)) {
      return value;
    }

    // Type validation
    switch (schema.type) {
      case 'string':
        return this.validateString(value, schema, path, errors, warnings, options);
      case 'number':
        return this.validateNumber(value, schema, path, errors, warnings, options);
      case 'boolean':
        return this.validateBoolean(value, schema, path, errors, warnings, options);
      case 'date':
        return this.validateDate(value, schema, path, errors, warnings, options);
      case 'array':
        return this.validateArray(value, schema, path, errors, warnings, options);
      case 'object':
        return this.validateObject(value, schema, path, errors, warnings, options);
      default:
        errors.push(new ValidationError(
          `Unknown schema type: ${schema.type}`,
          path,
          'UNKNOWN_TYPE'
        ));
        return value;
    }
  }

  private static validateString(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options: ValidationOptions
  ): string {
    if (typeof value !== 'string') {
      if (options.sanitize && value != null) {
        const sanitized = String(value);
        warnings.push({
          field: path,
          message: `Value converted from ${typeof value} to string`,
          code: 'TYPE_COERCION'
        });
        value = sanitized;
      } else {
        errors.push(new ValidationError(
          `Expected string, got ${typeof value}`,
          path,
          'TYPE_MISMATCH'
        ));
        return value as string;
      }
    }

    const stringValue = value as string;

    // Length validation
    if (schema.min !== undefined && stringValue.length < schema.min) {
      errors.push(new ValidationError(
        `String length ${stringValue.length} is less than minimum ${schema.min}`,
        path,
        'MIN_LENGTH'
      ));
    }

    if (schema.max !== undefined && stringValue.length > schema.max) {
      if (options.sanitize) {
        warnings.push({
          field: path,
          message: `String truncated from ${stringValue.length} to ${schema.max} characters`,
          code: 'TRUNCATED'
        });
        return stringValue.substring(0, schema.max);
      } else {
        errors.push(new ValidationError(
          `String length ${stringValue.length} exceeds maximum ${schema.max}`,
          path,
          'MAX_LENGTH'
        ));
      }
    }

    // Pattern validation
    if (schema.pattern && !schema.pattern.test(stringValue)) {
      errors.push(new ValidationError(
        `String does not match required pattern`,
        path,
        'PATTERN_MISMATCH'
      ));
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(stringValue)) {
      errors.push(new ValidationError(
        `Value "${stringValue}" is not in allowed values: ${schema.enum.join(', ')}`,
        path,
        'ENUM_MISMATCH'
      ));
    }

    // Custom validation
    if (schema.custom) {
      const customResult = schema.custom(stringValue);
      if (customResult !== true) {
        errors.push(new ValidationError(
          typeof customResult === 'string' ? customResult : 'Custom validation failed',
          path,
          'CUSTOM_VALIDATION'
        ));
      }
    }

    return stringValue;
  }

  private static validateNumber(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options: ValidationOptions
  ): number {
    if (typeof value !== 'number') {
      if (options.sanitize && (typeof value === 'string' || typeof value === 'boolean')) {
        const parsed = Number(value);
        if (!isNaN(parsed)) {
          warnings.push({
            field: path,
            message: `Value converted from ${typeof value} to number`,
            code: 'TYPE_COERCION'
          });
          value = parsed;
        } else {
          errors.push(new ValidationError(
            `Cannot convert ${typeof value} to number`,
            path,
            'TYPE_CONVERSION_FAILED'
          ));
          return value as number;
        }
      } else {
        errors.push(new ValidationError(
          `Expected number, got ${typeof value}`,
          path,
          'TYPE_MISMATCH'
        ));
        return value as number;
      }
    }

    const numberValue = value as number;

    if (isNaN(numberValue)) {
      errors.push(new ValidationError(
        `Number is NaN`,
        path,
        'INVALID_NUMBER'
      ));
      return numberValue;
    }

    // Range validation
    if (schema.min !== undefined && numberValue < schema.min) {
      if (options.sanitize) {
        warnings.push({
          field: path,
          message: `Number ${numberValue} clamped to minimum ${schema.min}`,
          code: 'CLAMPED_MIN'
        });
        return schema.min;
      } else {
        errors.push(new ValidationError(
          `Number ${numberValue} is less than minimum ${schema.min}`,
          path,
          'MIN_VALUE'
        ));
      }
    }

    if (schema.max !== undefined && numberValue > schema.max) {
      if (options.sanitize) {
        warnings.push({
          field: path,
          message: `Number ${numberValue} clamped to maximum ${schema.max}`,
          code: 'CLAMPED_MAX'
        });
        return schema.max;
      } else {
        errors.push(new ValidationError(
          `Number ${numberValue} exceeds maximum ${schema.max}`,
          path,
          'MAX_VALUE'
        ));
      }
    }

    // Custom validation
    if (schema.custom) {
      const customResult = schema.custom(numberValue);
      if (customResult !== true) {
        errors.push(new ValidationError(
          typeof customResult === 'string' ? customResult : 'Custom validation failed',
          path,
          'CUSTOM_VALIDATION'
        ));
      }
    }

    return numberValue;
  }

  private static validateBoolean(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options: ValidationOptions
  ): boolean {
    if (typeof value !== 'boolean') {
      if (options.sanitize) {
        warnings.push({
          field: path,
          message: `Value converted from ${typeof value} to boolean`,
          code: 'TYPE_COERCION'
        });
        return Boolean(value);
      } else {
        errors.push(new ValidationError(
          `Expected boolean, got ${typeof value}`,
          path,
          'TYPE_MISMATCH'
        ));
        return value as boolean;
      }
    }

    return value as boolean;
  }

  private static validateDate(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options: ValidationOptions
  ): Date {
    if (!(value instanceof Date)) {
      if (options.sanitize && (typeof value === 'string' || typeof value === 'number')) {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          warnings.push({
            field: path,
            message: `Value converted from ${typeof value} to Date`,
            code: 'TYPE_COERCION'
          });
          value = parsed;
        } else {
          errors.push(new ValidationError(
            `Cannot convert ${typeof value} to Date`,
            path,
            'TYPE_CONVERSION_FAILED'
          ));
          return value as Date;
        }
      } else {
        errors.push(new ValidationError(
          `Expected Date, got ${typeof value}`,
          path,
          'TYPE_MISMATCH'
        ));
        return value as Date;
      }
    }

    const dateValue = value as Date;

    if (isNaN(dateValue.getTime())) {
      errors.push(new ValidationError(
        `Invalid Date`,
        path,
        'INVALID_DATE'
      ));
    }

    return dateValue;
  }

  private static validateArray(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options: ValidationOptions
  ): unknown[] {
    if (!Array.isArray(value)) {
      errors.push(new ValidationError(
        `Expected array, got ${typeof value}`,
        path,
        'TYPE_MISMATCH'
      ));
      return value as unknown[];
    }

    const arrayValue = value as unknown[];

    // Length validation
    if (schema.min !== undefined && arrayValue.length < schema.min) {
      errors.push(new ValidationError(
        `Array length ${arrayValue.length} is less than minimum ${schema.min}`,
        path,
        'MIN_LENGTH'
      ));
    }

    if (schema.max !== undefined && arrayValue.length > schema.max) {
      errors.push(new ValidationError(
        `Array length ${arrayValue.length} exceeds maximum ${schema.max}`,
        path,
        'MAX_LENGTH'
      ));
    }

    // Validate items
    if (schema.items) {
      return arrayValue.map((item, index) => 
        this.validateValue(item, schema.items!, `${path}[${index}]`, errors, warnings, options)
      );
    }

    return arrayValue;
  }

  private static validateObject(
    value: unknown,
    schema: ValidationSchema,
    path: string,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    options: ValidationOptions
  ): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(new ValidationError(
        `Expected object, got ${typeof value}`,
        path,
        'TYPE_MISMATCH'
      ));
      return value as Record<string, unknown>;
    }

    const objectValue = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // Validate known properties
    if (schema.properties) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        const propertyPath = path ? `${path}.${key}` : key;
        result[key] = this.validateValue(
          objectValue[key], 
          propertySchema, 
          propertyPath, 
          errors, 
          warnings, 
          options
        );
      }
    }

    // Handle unknown properties
    const knownKeys = new Set(Object.keys(schema.properties || {}));
    const unknownKeys = Object.keys(objectValue).filter(key => !knownKeys.has(key));

    if (unknownKeys.length > 0) {
      if (!options.allowUnknownProperties) {
        for (const key of unknownKeys) {
          warnings.push({
            field: path ? `${path}.${key}` : key,
            message: `Unknown property`,
            code: 'UNKNOWN_PROPERTY'
          });
        }
      }

      if (!options.removeUnknownProperties) {
        for (const key of unknownKeys) {
          result[key] = objectValue[key];
        }
      }
    }

    return result;
  }
}

/**
 * Specialized validation utilities for common patterns
 */
export class ValidationUtils {
  /**
   * Checks if a value is a valid risk level
   */
  static isValidRiskLevel(riskLevel: string): riskLevel is 'low' | 'medium' | 'high' {
    return ['low', 'medium', 'high'].includes(riskLevel);
  }

  /**
   * Checks if severity is valid (1-10)
   */
  static isValidSeverity(severity: number): boolean {
    return typeof severity === 'number' && severity >= 1 && severity <= 10 && !isNaN(severity);
  }

  /**
   * Checks if confidence is valid (0-1)
   */
  static isValidConfidence(confidence: number): boolean {
    return typeof confidence === 'number' && confidence >= 0 && confidence <= 1 && !isNaN(confidence);
  }

  /**
   * Calculates risk level based on average severity
   */
  static calculateRiskLevel(averageSeverity: number): 'low' | 'medium' | 'high' {
    if (averageSeverity <= 3) return 'low';
    if (averageSeverity <= 6) return 'medium';
    return 'high';
  }

  /**
   * Checks if a value is empty
   */
  static isEmpty(value: unknown): boolean {
    if (value == null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
  }

  /**
   * Checks if a date is valid
   */
  static isValidDate(date: unknown): date is Date {
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Validates email format
   */
  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validates URL format
   */
  static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Data sanitization utilities
 */
export class DataSanitizer {
  /**
   * Sanitizes and normalizes severity (1-10)
   */
  static sanitizeSeverity(severity: unknown): number {
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
  }

  /**
   * Sanitizes and normalizes confidence (0-1)
   */
  static sanitizeConfidence(confidence: unknown): number {
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
  }

  /**
   * Sanitizes string field with fallback
   */
  static sanitizeString(value: unknown, fallback: string = ''): string {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : fallback;
    }
    if (value != null) {
      const stringified = String(value).trim();
      return stringified.length > 0 ? stringified : fallback;
    }
    return fallback;
  }

  /**
   * Sanitizes risk level
   */
  static sanitizeRiskLevel(riskLevel: unknown): 'low' | 'medium' | 'high' {
    if (typeof riskLevel === 'string' && ValidationUtils.isValidRiskLevel(riskLevel)) {
      return riskLevel;
    }
    return 'low'; // Fallback to low risk
  }

  /**
   * Sanitizes date
   */
  static sanitizeDate(date: unknown): Date | undefined {
    if (ValidationUtils.isValidDate(date)) {
      return date;
    }
    if (typeof date === 'string' || typeof date === 'number') {
      const parsed = new Date(date);
      if (ValidationUtils.isValidDate(parsed)) {
        return parsed;
      }
    }
    return undefined;
  }

  /**
   * Sanitizes number with bounds
   */
  static sanitizeNumber(value: unknown, min?: number, max?: number, fallback: number = 0): number {
    let result = fallback;
    
    if (typeof value === 'number' && !isNaN(value)) {
      result = value;
    } else if (typeof value === 'string') {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        result = parsed;
      }
    }

    if (min !== undefined) {
      result = Math.max(min, result);
    }
    if (max !== undefined) {
      result = Math.min(max, result);
    }

    return result;
  }

  /**
   * Deep cleans an object by removing null/undefined values and empty strings
   */
  static deepClean(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return undefined;
    }

    if (Array.isArray(obj)) {
      const cleaned = obj
        .map(item => this.deepClean(item))
        .filter(item => item !== undefined);
      return cleaned.length > 0 ? cleaned : undefined;
    }

    if (typeof obj === 'object') {
      const cleaned: Record<string, unknown> = {};
      let hasValidProperties = false;

      for (const [key, value] of Object.entries(obj)) {
        const cleanedValue = this.deepClean(value);
        if (cleanedValue !== undefined) {
          cleaned[key] = cleanedValue;
          hasValidProperties = true;
        }
      }

      return hasValidProperties ? cleaned : undefined;
    }

    if (typeof obj === 'string') {
      const trimmed = obj.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    return obj;
  }
}

// Export legacy compatibility
export const validationUtils = ValidationUtils;
export const dataSanitizer = DataSanitizer;