/**
 * Tests for unified validation system
 */

import { describe, it, expect } from 'vitest';
import {
  ValidationCore,
  ValidationUtils,
  DataSanitizer,
  ValidationError,
  type ValidationSchema,
  type ValidationOptions,
  type ValidationResult
} from '../../src/utils/validation';

describe('ValidationCore', () => {
  const testTimeout = 10000; // 10 seconds max per test

  describe('schema validation', () => {

    it('should validate string schema', () => {
      const schema: ValidationSchema = {
        type: 'string',
        required: true,
        min: 3,
        max: 10
      };

      const validResult = ValidationCore.validateSchema('hello', schema);
      expect(validResult.isValid).toBe(true);
      expect(validResult.data).toBe('hello');

      const tooShortResult = ValidationCore.validateSchema('hi', schema);
      expect(tooShortResult.isValid).toBe(false);
      expect(tooShortResult.errors[0].code).toBe('MIN_LENGTH');

      const tooLongResult = ValidationCore.validateSchema('this is too long', schema);
      expect(tooLongResult.isValid).toBe(false);
      expect(tooLongResult.errors[0].code).toBe('MAX_LENGTH');
    });

    it('should validate number schema', () => {
      const schema: ValidationSchema = {
        type: 'number',
        required: true,
        min: 1,
        max: 10
      };

      const validResult = ValidationCore.validateSchema(5, schema);
      expect(validResult.isValid).toBe(true);
      expect(validResult.data).toBe(5);

      const tooSmallResult = ValidationCore.validateSchema(0, schema);
      expect(tooSmallResult.isValid).toBe(false);
      expect(tooSmallResult.errors[0].code).toBe('MIN_VALUE');

      const tooLargeResult = ValidationCore.validateSchema(15, schema);
      expect(tooLargeResult.isValid).toBe(false);
      expect(tooLargeResult.errors[0].code).toBe('MAX_VALUE');
    });

    it('should validate object schema', () => {
      const schema: ValidationSchema = {
        type: 'object',
        required: true,
        properties: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true, min: 0, max: 150 },
          email: { type: 'string', required: false }
        }
      };

      const validData = { name: 'John', age: 30, email: 'john@example.com' };
      const validResult = ValidationCore.validateSchema(validData, schema);
      expect(validResult.isValid).toBe(true);
      expect(validResult.data).toEqual(validData);

      const missingRequiredResult = ValidationCore.validateSchema({ age: 30 }, schema);
      expect(missingRequiredResult.isValid).toBe(false);
      expect(missingRequiredResult.errors[0].code).toBe('REQUIRED_FIELD');
      expect(missingRequiredResult.errors[0].field).toBe('name');
    });

    it('should validate array schema', () => {
      const schema: ValidationSchema = {
        type: 'array',
        required: true,
        min: 1,
        max: 5,
        items: { type: 'string', required: true }
      };

      const validResult = ValidationCore.validateSchema(['a', 'b', 'c'], schema);
      expect(validResult.isValid).toBe(true);

      const emptyResult = ValidationCore.validateSchema([], schema);
      expect(emptyResult.isValid).toBe(false);
      expect(emptyResult.errors[0].code).toBe('MIN_LENGTH');

      const tooManyResult = ValidationCore.validateSchema(['a', 'b', 'c', 'd', 'e', 'f'], schema);
      expect(tooManyResult.isValid).toBe(false);
      expect(tooManyResult.errors[0].code).toBe('MAX_LENGTH');
    });

    it('should handle sanitization', () => {
      const schema: ValidationSchema = {
        type: 'object',
        properties: {
          severity: { type: 'number', min: 1, max: 10 },
          confidence: { type: 'number', min: 0, max: 1 }
        }
      };

      const options: ValidationOptions = { sanitize: true };
      const data = { severity: 15, confidence: -0.5 };
      
      const result = ValidationCore.validateSchema(data, schema, options);
      expect(result.sanitizedData).toEqual({ severity: 10, confidence: 0 });
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0].code).toBe('CLAMPED_MAX');
      expect(result.warnings[1].code).toBe('CLAMPED_MIN');
    });

    it('should handle type coercion', () => {
      const schema: ValidationSchema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
          active: { type: 'boolean' },
          name: { type: 'string' }
        }
      };

      const options: ValidationOptions = { sanitize: true };
      const data = { count: '42', active: 1, name: 123 };
      
      const result = ValidationCore.validateSchema(data, schema, options);
      expect(result.sanitizedData).toEqual({ count: 42, active: true, name: '123' });
      expect(result.warnings).toHaveLength(3);
      expect(result.warnings.every(w => w.code === 'TYPE_COERCION')).toBe(true);
    });

    it('should validate custom validation functions', () => {
      const schema: ValidationSchema = {
        type: 'string',
        custom: (value) => {
          if (typeof value === 'string' && value.includes('test')) {
            return true;
          }
          return 'String must contain "test"';
        }
      };

      const validResult = ValidationCore.validateSchema('test123', schema);
      expect(validResult.isValid).toBe(true);

      const invalidResult = ValidationCore.validateSchema('hello', schema);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors[0].code).toBe('CUSTOM_VALIDATION');
      expect(invalidResult.errors[0].message).toBe('String must contain "test"');
    });

    it('should handle enum validation', () => {
      const schema: ValidationSchema = {
        type: 'string',
        enum: ['low', 'medium', 'high']
      };

      const validResult = ValidationCore.validateSchema('medium', schema);
      expect(validResult.isValid).toBe(true);

      const invalidResult = ValidationCore.validateSchema('extreme', schema);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors[0].code).toBe('ENUM_MISMATCH');
    });

    it('should handle pattern validation', () => {
      const schema: ValidationSchema = {
        type: 'string',
        pattern: /^[a-zA-Z0-9]+$/
      };

      const validResult = ValidationCore.validateSchema('abc123', schema);
      expect(validResult.isValid).toBe(true);

      const invalidResult = ValidationCore.validateSchema('abc-123', schema);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors[0].code).toBe('PATTERN_MISMATCH');
    });
  });
});

describe('ValidationUtils', () => {

  describe('isValidRiskLevel', () => {

    it('should validate risk levels', () => {
      expect(ValidationUtils.isValidRiskLevel('low')).toBe(true);
      expect(ValidationUtils.isValidRiskLevel('medium')).toBe(true);
      expect(ValidationUtils.isValidRiskLevel('high')).toBe(true);
      expect(ValidationUtils.isValidRiskLevel('extreme')).toBe(false);
      expect(ValidationUtils.isValidRiskLevel('')).toBe(false);
    });
  });

  describe('isValidSeverity', () => {

    it('should validate severity values', () => {
      expect(ValidationUtils.isValidSeverity(1)).toBe(true);
      expect(ValidationUtils.isValidSeverity(5)).toBe(true);
      expect(ValidationUtils.isValidSeverity(10)).toBe(true);
      expect(ValidationUtils.isValidSeverity(0)).toBe(false);
      expect(ValidationUtils.isValidSeverity(11)).toBe(false);
      expect(ValidationUtils.isValidSeverity(NaN)).toBe(false);
      expect(ValidationUtils.isValidSeverity('5' as any)).toBe(false);
    });
  });

  describe('isValidConfidence', () => {

    it('should validate confidence values', () => {
      expect(ValidationUtils.isValidConfidence(0)).toBe(true);
      expect(ValidationUtils.isValidConfidence(0.5)).toBe(true);
      expect(ValidationUtils.isValidConfidence(1)).toBe(true);
      expect(ValidationUtils.isValidConfidence(-0.1)).toBe(false);
      expect(ValidationUtils.isValidConfidence(1.1)).toBe(false);
      expect(ValidationUtils.isValidConfidence(NaN)).toBe(false);
    });
  });

  describe('calculateRiskLevel', () => {

    it('should calculate correct risk levels', () => {
      expect(ValidationUtils.calculateRiskLevel(1)).toBe('low');
      expect(ValidationUtils.calculateRiskLevel(3)).toBe('low');
      expect(ValidationUtils.calculateRiskLevel(4)).toBe('medium');
      expect(ValidationUtils.calculateRiskLevel(6)).toBe('medium');
      expect(ValidationUtils.calculateRiskLevel(7)).toBe('high');
      expect(ValidationUtils.calculateRiskLevel(10)).toBe('high');
    });
  });

  describe('isEmpty', () => {

    it('should detect empty values', () => {
      expect(ValidationUtils.isEmpty(null)).toBe(true);
      expect(ValidationUtils.isEmpty(undefined)).toBe(true);
      expect(ValidationUtils.isEmpty([])).toBe(true);
      expect(ValidationUtils.isEmpty({})).toBe(true);
      expect(ValidationUtils.isEmpty('')).toBe(true);
      expect(ValidationUtils.isEmpty('   ')).toBe(true);
      
      expect(ValidationUtils.isEmpty('hello')).toBe(false);
      expect(ValidationUtils.isEmpty([1])).toBe(false);
      expect(ValidationUtils.isEmpty({ a: 1 })).toBe(false);
      expect(ValidationUtils.isEmpty(0)).toBe(false);
      expect(ValidationUtils.isEmpty(false)).toBe(false);
    });
  });

  describe('isValidDate', () => {

    it('should validate dates', () => {
      expect(ValidationUtils.isValidDate(new Date())).toBe(true);
      expect(ValidationUtils.isValidDate(new Date('2023-01-01'))).toBe(true);
      expect(ValidationUtils.isValidDate(new Date('invalid'))).toBe(false);
      expect(ValidationUtils.isValidDate('2023-01-01')).toBe(false);
      expect(ValidationUtils.isValidDate(null)).toBe(false);
    });
  });

  describe('isValidEmail', () => {

    it('should validate email addresses', () => {
      expect(ValidationUtils.isValidEmail('test@example.com')).toBe(true);
      expect(ValidationUtils.isValidEmail('user.name+tag@domain.co.uk')).toBe(true);
      expect(ValidationUtils.isValidEmail('invalid-email')).toBe(false);
      expect(ValidationUtils.isValidEmail('@domain.com')).toBe(false);
      expect(ValidationUtils.isValidEmail('test@')).toBe(false);
    });
  });

  describe('isValidUrl', () => {

    it('should validate URLs', () => {
      expect(ValidationUtils.isValidUrl('https://example.com')).toBe(true);
      expect(ValidationUtils.isValidUrl('http://localhost:3000')).toBe(true);
      expect(ValidationUtils.isValidUrl('ftp://files.example.com')).toBe(true);
      expect(ValidationUtils.isValidUrl('not-a-url')).toBe(false);
      expect(ValidationUtils.isValidUrl('http://')).toBe(false);
    });
  });
});

describe('DataSanitizer', () => {

  describe('sanitizeSeverity', () => {

    it('should sanitize severity values', () => {
      expect(DataSanitizer.sanitizeSeverity(5)).toBe(5);
      expect(DataSanitizer.sanitizeSeverity(0)).toBe(1);
      expect(DataSanitizer.sanitizeSeverity(15)).toBe(10);
      expect(DataSanitizer.sanitizeSeverity(5.7)).toBe(6);
      expect(DataSanitizer.sanitizeSeverity('7')).toBe(7);
      expect(DataSanitizer.sanitizeSeverity('invalid')).toBe(1);
      expect(DataSanitizer.sanitizeSeverity(null)).toBe(1);
    });
  });

  describe('sanitizeConfidence', () => {

    it('should sanitize confidence values', () => {
      expect(DataSanitizer.sanitizeConfidence(0.5)).toBe(0.5);
      expect(DataSanitizer.sanitizeConfidence(-0.1)).toBe(0);
      expect(DataSanitizer.sanitizeConfidence(1.5)).toBe(1);
      expect(DataSanitizer.sanitizeConfidence('0.7')).toBe(0.7);
      expect(DataSanitizer.sanitizeConfidence('invalid')).toBe(0.5);
      expect(DataSanitizer.sanitizeConfidence(null)).toBe(0.5);
    });
  });

  describe('sanitizeString', () => {

    it('should sanitize string values', () => {
      expect(DataSanitizer.sanitizeString('hello')).toBe('hello');
      expect(DataSanitizer.sanitizeString('  hello  ')).toBe('hello');
      expect(DataSanitizer.sanitizeString('')).toBe('');
      expect(DataSanitizer.sanitizeString('', 'default')).toBe('default');
      expect(DataSanitizer.sanitizeString('   ', 'default')).toBe('default');
      expect(DataSanitizer.sanitizeString(123)).toBe('123');
      expect(DataSanitizer.sanitizeString(null)).toBe('');
      expect(DataSanitizer.sanitizeString(null, 'default')).toBe('default');
    });
  });

  describe('sanitizeRiskLevel', () => {

    it('should sanitize risk level values', () => {
      expect(DataSanitizer.sanitizeRiskLevel('low')).toBe('low');
      expect(DataSanitizer.sanitizeRiskLevel('medium')).toBe('medium');
      expect(DataSanitizer.sanitizeRiskLevel('high')).toBe('high');
      expect(DataSanitizer.sanitizeRiskLevel('extreme')).toBe('low');
      expect(DataSanitizer.sanitizeRiskLevel('')).toBe('low');
      expect(DataSanitizer.sanitizeRiskLevel(null)).toBe('low');
    });
  });

  describe('sanitizeDate', () => {

    it('should sanitize date values', () => {
      const validDate = new Date('2023-01-01');
      expect(DataSanitizer.sanitizeDate(validDate)).toBe(validDate);
      expect(DataSanitizer.sanitizeDate('2023-01-01')).toEqual(new Date('2023-01-01'));
      expect(DataSanitizer.sanitizeDate(1672531200000)).toEqual(new Date(1672531200000));
      expect(DataSanitizer.sanitizeDate('invalid')).toBeUndefined();
      expect(DataSanitizer.sanitizeDate(null)).toBeUndefined();
    });
  });

  describe('sanitizeNumber', () => {

    it('should sanitize number values', () => {
      expect(DataSanitizer.sanitizeNumber(5)).toBe(5);
      expect(DataSanitizer.sanitizeNumber('7')).toBe(7);
      expect(DataSanitizer.sanitizeNumber('invalid')).toBe(0);
      expect(DataSanitizer.sanitizeNumber(null)).toBe(0);
      expect(DataSanitizer.sanitizeNumber(null, undefined, undefined, 10)).toBe(10);
    });

    it('should apply bounds', () => {
      expect(DataSanitizer.sanitizeNumber(5, 1, 10)).toBe(5);
      expect(DataSanitizer.sanitizeNumber(0, 1, 10)).toBe(1);
      expect(DataSanitizer.sanitizeNumber(15, 1, 10)).toBe(10);
      expect(DataSanitizer.sanitizeNumber(-5, 0)).toBe(0);
      expect(DataSanitizer.sanitizeNumber(15, undefined, 10)).toBe(10);
    });
  });

  describe('deepClean', () => {

    it('should clean simple values', () => {
      expect(DataSanitizer.deepClean(null)).toBeUndefined();
      expect(DataSanitizer.deepClean(undefined)).toBeUndefined();
      expect(DataSanitizer.deepClean('')).toBeUndefined();
      expect(DataSanitizer.deepClean('   ')).toBeUndefined();
      expect(DataSanitizer.deepClean('hello')).toBe('hello');
      expect(DataSanitizer.deepClean(42)).toBe(42);
      expect(DataSanitizer.deepClean(false)).toBe(false);
    });

    it('should clean arrays', () => {
      expect(DataSanitizer.deepClean([])).toBeUndefined();
      expect(DataSanitizer.deepClean([null, undefined, ''])).toBeUndefined();
      expect(DataSanitizer.deepClean([1, null, 'hello', ''])).toEqual([1, 'hello']);
      expect(DataSanitizer.deepClean([1, 2, 3])).toEqual([1, 2, 3]);
    });

    it('should clean objects', () => {
      expect(DataSanitizer.deepClean({})).toBeUndefined();
      expect(DataSanitizer.deepClean({ a: null, b: undefined, c: '' })).toBeUndefined();
      expect(DataSanitizer.deepClean({ a: 1, b: null, c: 'hello' })).toEqual({ a: 1, c: 'hello' });
      expect(DataSanitizer.deepClean({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    });

    it('should clean nested structures', () => {
      const input = {
        user: {
          name: 'John',
          email: '',
          profile: {
            bio: null,
            age: 30
          }
        },
        items: [1, null, '', 'valid'],
        empty: {}
      };

      const expected = {
        user: {
          name: 'John',
          profile: {
            age: 30
          }
        },
        items: [1, 'valid']
      };

      expect(DataSanitizer.deepClean(input)).toEqual(expected);
    });
  });
});

describe('ValidationError', () => {

  it('should create validation error with context', () => {
    const error = new ValidationError(
      'Test error',
      'field.name',
      'TEST_CODE',
      { additional: 'info' }
    );

    expect(error.message).toBe('Test error');
    expect(error.field).toBe('field.name');
    expect(error.code).toBe('TEST_CODE');
    expect(error.context).toEqual({ additional: 'info' });
    expect(error.name).toBe('ValidationError');
  });
});