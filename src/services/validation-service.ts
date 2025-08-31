/**
 * Validation Service
 * Centralized runtime type validation service
 */

import { BaseService } from './base-service';
import type { Env } from '../env';
import type {
  TelegramUpdate,
  OpenAIResponse,
  CloudflareAIResponse,
  DatabaseResult,
  ValidationResult,
  ValidationError,
  StringRecord
} from '../types';
import {
  validateTelegramUpdate,
  validateOpenAIResponse,
  validateDatabaseResult,
  validateUserInput,
  validateConfiguration,
  validateArray,
  createValidationError,
  createValidationResult,
  throwOnValidationError,
  isObject,
  isString,
  isNumber,
  isBoolean
} from '../utils/type-guards';

export interface ValidationServiceConfig {
  strictMode: boolean;
  logValidationErrors: boolean;
  throwOnValidationError: boolean;
  maxValidationErrors: number;
}

export class ValidationService extends BaseService {
  private config: ValidationServiceConfig;

  constructor(env: Env, config: Partial<ValidationServiceConfig> = {}) {
    super('ValidationService', env);
    
    this.config = {
      strictMode: config.strictMode ?? true,
      logValidationErrors: config.logValidationErrors ?? true,
      throwOnValidationError: config.throwOnValidationError ?? false,
      maxValidationErrors: config.maxValidationErrors ?? 10,
      ...config
    };
  }

  /**
   * Validate Telegram webhook update
   */
  async validateTelegramWebhook(data: unknown): Promise<ValidationResult<TelegramUpdate>> {
    const result = validateTelegramUpdate(data);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('Telegram webhook validation failed', {
        errors: result.errors,
        data: this.config.strictMode ? '[REDACTED]' : data
      });
    }
    
    if (!result.isValid && this.config.throwOnValidationError) {
      throwOnValidationError(result);
    }
    
    return result;
  }

  /**
   * Validate OpenAI API response
   */
  async validateOpenAIResponse(data: unknown): Promise<ValidationResult<OpenAIResponse>> {
    const result = validateOpenAIResponse(data);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('OpenAI response validation failed', {
        errors: result.errors,
        data: this.config.strictMode ? '[REDACTED]' : data
      });
    }
    
    if (!result.isValid && this.config.throwOnValidationError) {
      throwOnValidationError(result);
    }
    
    return result;
  }

  /**
   * Validate Cloudflare AI response
   */
  async validateCloudflareAIResponse(data: unknown): Promise<ValidationResult<CloudflareAIResponse>> {
    const errors: ValidationError[] = [];
    
    if (!isObject(data)) {
      errors.push(createValidationError('root', 'Response must be an object', data));
      return createValidationResult(false, undefined, errors);
    }
    
    if (!isObject(data.result) || !isString(data.result.response)) {
      errors.push(createValidationError('result.response', 'Response must contain result.response string', data.result));
    }
    
    if (!isBoolean(data.success)) {
      errors.push(createValidationError('success', 'Response must contain success boolean', data.success));
    }
    
    if (!Array.isArray(data.errors)) {
      errors.push(createValidationError('errors', 'Response must contain errors array', data.errors));
    }
    
    if (!Array.isArray(data.messages)) {
      errors.push(createValidationError('messages', 'Response must contain messages array', data.messages));
    }
    
    const isValid = errors.length === 0;
    const result = createValidationResult(isValid, isValid ? data as CloudflareAIResponse : undefined, errors);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('Cloudflare AI response validation failed', {
        errors: result.errors,
        data: this.config.strictMode ? '[REDACTED]' : data
      });
    }
    
    if (!result.isValid && this.config.throwOnValidationError) {
      throwOnValidationError(result);
    }
    
    return result;
  }

  /**
   * Validate database query result
   */
  async validateDatabaseResult<T>(
    data: unknown,
    rowValidator?: (row: unknown) => ValidationResult<T>
  ): Promise<ValidationResult<DatabaseResult<T>>> {
    const result = validateDatabaseResult(data, rowValidator);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('Database result validation failed', {
        errors: result.errors,
        data: this.config.strictMode ? '[REDACTED]' : data
      });
    }
    
    if (!result.isValid && this.config.throwOnValidationError) {
      throwOnValidationError(result);
    }
    
    return result;
  }

  /**
   * Validate user input for security and format
   */
  async validateUserInput(input: unknown): Promise<ValidationResult<string>> {
    const result = validateUserInput(input);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logWarning('User input validation failed', {
        errors: result.errors,
        input: this.config.strictMode ? '[REDACTED]' : input
      });
    }
    
    return result;
  }

  /**
   * Validate configuration object
   */
  async validateConfig<T extends StringRecord>(
    config: unknown,
    schema: Record<keyof T, (value: unknown) => boolean>
  ): Promise<ValidationResult<T>> {
    const result = validateConfiguration(config, schema);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('Configuration validation failed', {
        errors: result.errors,
        config: this.config.strictMode ? '[REDACTED]' : config
      });
    }
    
    if (!result.isValid && this.config.throwOnValidationError) {
      throwOnValidationError(result);
    }
    
    return result;
  }

  /**
   * Validate array of items
   */
  async validateArrayData<T>(
    data: unknown,
    itemValidator: (item: unknown) => item is T,
    maxItems?: number
  ): Promise<ValidationResult<T[]>> {
    const result = validateArray(data, itemValidator);
    
    if (result.isValid && maxItems && result.value && result.value.length > maxItems) {
      const errors = [createValidationError('length', `Array exceeds maximum length of ${maxItems}`, result.value.length)];
      return createValidationResult(false, undefined, errors);
    }
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('Array validation failed', {
        errors: result.errors,
        data: this.config.strictMode ? '[REDACTED]' : data
      });
    }
    
    if (!result.isValid && this.config.throwOnValidationError) {
      throwOnValidationError(result);
    }
    
    return result;
  }

  /**
   * Validate JSON data from external sources
   */
  async validateExternalJSON<T>(
    jsonString: string,
    validator: (data: unknown) => ValidationResult<T>
  ): Promise<ValidationResult<T>> {
    const errors: ValidationError[] = [];
    
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(jsonString);
    } catch (error: unknown) {
      errors.push(createValidationError('json', `Invalid JSON: ${error}`, jsonString));
      return createValidationResult(false, undefined, errors);
    }
    
    const result = validator(parsedData);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('External JSON validation failed', {
        errors: result.errors,
        json: this.config.strictMode ? '[REDACTED]' : jsonString
      });
    }
    
    if (!result.isValid && this.config.throwOnValidationError) {
      throwOnValidationError(result);
    }
    
    return result;
  }

  /**
   * Validate API request parameters
   */
  async validateApiParams(
    params: unknown,
    requiredFields: string[],
    optionalFields: string[] = []
  ): Promise<ValidationResult<StringRecord>> {
    const errors: ValidationError[] = [];
    
    if (!isObject(params)) {
      errors.push(createValidationError('params', 'Parameters must be an object', params));
      return createValidationResult(false, undefined, errors);
    }
    
    // Check required fields
    requiredFields.forEach(field => {
      if (!(field in params) || params[field] === undefined || params[field] === null) {
        errors.push(createValidationError(field, `Required field '${field}' is missing or null`, params[field]));
      }
    });
    
    // Check for unexpected fields
    const allowedFields = new Set([...requiredFields, ...optionalFields]);
    Object.keys(params).forEach(field => {
      if (!allowedFields.has(field)) {
        errors.push(createValidationError(field, `Unexpected field '${field}'`, params[field]));
      }
    });
    
    const isValid = errors.length === 0;
    const result = createValidationResult(isValid, isValid ? params as StringRecord : undefined, errors);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('API parameters validation failed', {
        errors: result.errors,
        params: this.config.strictMode ? '[REDACTED]' : params
      });
    }
    
    return result;
  }

  /**
   * Validate webhook signature (for security)
   */
  async validateWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): Promise<ValidationResult<boolean>> {
    const errors: ValidationError[] = [];
    
    if (!isString(payload)) {
      errors.push(createValidationError('payload', 'Payload must be a string', payload));
    }
    
    if (!isString(signature)) {
      errors.push(createValidationError('signature', 'Signature must be a string', signature));
    }
    
    if (!isString(secret)) {
      errors.push(createValidationError('secret', 'Secret must be a string', secret));
    }
    
    if (errors.length > 0) {
      return createValidationResult(false, undefined, errors);
    }
    
    try {
      // Simple HMAC validation (in real implementation, use crypto.subtle)
      const expectedSignature = `sha256=${secret}${payload}`;
      const isValid = signature === expectedSignature;
      
      if (!isValid) {
        errors.push(createValidationError('signature', 'Invalid webhook signature', signature));
        
        if (this.config.logValidationErrors) {
          this.logWarning('Webhook signature validation failed', {
            signature: this.config.strictMode ? '[REDACTED]' : signature,
            expected: this.config.strictMode ? '[REDACTED]' : expectedSignature
          });
        }
      }
      
      return createValidationResult(isValid, isValid, errors);
    } catch (error: unknown) {
      errors.push(createValidationError('signature', `Signature validation error: ${error}`, signature));
      return createValidationResult(false, undefined, errors);
    }
  }

  /**
   * Batch validate multiple items
   */
  async validateBatch<T>(
    items: unknown[],
    validator: (item: unknown) => Promise<ValidationResult<T>>,
    stopOnFirstError: boolean = false
  ): Promise<ValidationResult<T[]>> {
    const errors: ValidationError[] = [];
    const validatedItems: T[] = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = await validator(item);
      
      if (result.isValid && result.value !== undefined) {
        validatedItems.push(result.value);
      } else {
        result.errors.forEach(error => {
          errors.push(createValidationError(`[${i}].${error.field}`, error.message, error.value, error.code));
        });
        
        if (stopOnFirstError) {
          break;
        }
      }
      
      // Prevent too many validation errors
      if (errors.length >= this.config.maxValidationErrors) {
        errors.push(createValidationError('batch', `Too many validation errors (max: ${this.config.maxValidationErrors})`, items.length));
        break;
      }
    }
    
    const isValid = errors.length === 0;
    const result = createValidationResult(isValid, isValid ? validatedItems : undefined, errors);
    
    if (!result.isValid && this.config.logValidationErrors) {
      this.logError('Batch validation failed', {
        totalItems: items.length,
        validItems: validatedItems.length,
        errorCount: errors.length,
        errors: errors.slice(0, 5) // Log only first 5 errors
      });
    }
    
    return result;
  }

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    totalValidations: number;
    successfulValidations: number;
    failedValidations: number;
    errorRate: number;
  } {
    // This would be implemented with actual metrics collection
    return {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      errorRate: 0
    };
  }

  /**
   * Update validation configuration
   */
  updateConfig(newConfig: Partial<ValidationServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logInfo('Validation service configuration updated', { config: this.config });
  }
}