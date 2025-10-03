/**
 * Type Guards and Runtime Validation
 * Runtime type validation functions for external data
 */

import type {
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
  TelegramChat,
  TelegramApiResponse,
  OpenAIResponse,
  CloudflareAIResponse,
  DatabaseResult,
  DatabaseRow,
  KVListResult,
  ValidationResult,
  ValidationError
} from '../types';

// Base validation utilities
export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isNull(value: unknown): value is null {
  return value === null;
}

export function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

export function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

// Telegram API Type Guards
export function isTelegramUser(value: unknown): value is TelegramUser {
  if (!isObject(value)) return false;
  
  return (
    isNumber(value.id) &&
    isBoolean(value.is_bot) &&
    isString(value.first_name) &&
    (isUndefined(value.last_name) || isString(value.last_name)) &&
    (isUndefined(value.username) || isString(value.username)) &&
    (isUndefined(value.language_code) || isString(value.language_code))
  );
}

export function isTelegramChat(value: unknown): value is TelegramChat {
  if (!isObject(value)) return false;
  
  const validTypes = ['private', 'group', 'supergroup', 'channel'];
  
  return (
    isNumber(value.id) &&
    isString(value.type) &&
    validTypes.includes(value.type as string) &&
    (isUndefined(value.title) || isString(value.title)) &&
    (isUndefined(value.username) || isString(value.username)) &&
    (isUndefined(value.first_name) || isString(value.first_name)) &&
    (isUndefined(value.last_name) || isString(value.last_name)) &&
    (isUndefined(value.description) || isString(value.description))
  );
}

export function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (!isObject(value)) return false;
  
  return (
    isNumber(value.message_id) &&
    isNumber(value.date) &&
    isTelegramChat(value.chat) &&
    (isUndefined(value.from) || isTelegramUser(value.from)) &&
    (isUndefined(value.text) || isString(value.text))
  );
}

export function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  if (!isObject(value)) return false;
  
  return (
    isNumber(value.update_id) &&
    (isUndefined(value.message) || isTelegramMessage(value.message)) &&
    (isUndefined(value.edited_message) || isTelegramMessage(value.edited_message)) &&
    (isUndefined(value.channel_post) || isTelegramMessage(value.channel_post)) &&
    (isUndefined(value.edited_channel_post) || isTelegramMessage(value.edited_channel_post))
  );
}

export function isTelegramApiResponse<T>(
  value: unknown,
  resultValidator?: (result: unknown) => result is T
): value is TelegramApiResponse<T> {
  if (!isObject(value)) return false;
  
  const isValidResponse = (
    isBoolean(value.ok) &&
    (isUndefined(value.error_code) || isNumber(value.error_code)) &&
    (isUndefined(value.description) || isString(value.description))
  );
  
  if (!isValidResponse) return false;
  
  if (value.ok && value.result !== undefined && resultValidator) {
    return resultValidator(value.result);
  }
  
  return true;
}

// AI Provider Type Guards
export function isOpenAIResponse(value: unknown): value is OpenAIResponse {
  if (!isObject(value)) return false;
  
  return (
    isString(value.id) &&
    isString(value.object) &&
    isNumber(value.created) &&
    isString(value.model) &&
    isArray(value.choices) &&
    value.choices.every(choice => 
      isObject(choice) &&
      isNumber(choice.index) &&
      isObject(choice.message) &&
      isString(choice.message.role) &&
      (isString(choice.message.content) || isNull(choice.message.content))
    )
  );
}

export function isCloudflareAIResponse(value: unknown): value is CloudflareAIResponse {
  if (!isObject(value)) return false;
  
  return (
    isObject(value.result) &&
    isString(value.result.response) &&
    isBoolean(value.success) &&
    isArray(value.errors) &&
    isArray(value.messages)
  );
}

// Database Type Guards
export function isDatabaseRow(value: unknown): value is DatabaseRow {
  if (!isObject(value)) return false;
  
  return Object.values(value).every(val => 
    isString(val) || 
    isNumber(val) || 
    isBoolean(val) || 
    isNull(val) || 
    val instanceof Date
  );
}

export function isDatabaseResult<T>(
  value: unknown,
  rowValidator?: (row: unknown) => row is T
): value is DatabaseResult<T> {
  if (!isObject(value)) return false;
  
  const hasValidStructure = (
    isArray(value.results) &&
    isBoolean(value.success) &&
    isObject(value.meta) &&
    isString(value.meta.served_by) &&
    isNumber(value.meta.duration) &&
    isNumber(value.meta.changes) &&
    isNumber(value.meta.last_row_id) &&
    isBoolean(value.meta.changed_db) &&
    isNumber(value.meta.size_after) &&
    isNumber(value.meta.rows_read) &&
    isNumber(value.meta.rows_written)
  );
  
  if (!hasValidStructure) return false;
  
  if (rowValidator) {
    return value.results.every(rowValidator);
  }
  
  return value.results.every(isDatabaseRow);
}

// KV Storage Type Guards
export function isKVListResult<T>(
  value: unknown,
  metadataValidator?: (metadata: unknown) => metadata is T
): value is KVListResult<T> {
  if (!isObject(value)) return false;
  
  const hasValidStructure = (
    isArray(value.keys) &&
    isBoolean(value.list_complete) &&
    (isUndefined(value.cursor) || isString(value.cursor))
  );
  
  if (!hasValidStructure) return false;
  
  return value.keys.every(key => 
    isObject(key) &&
    isString(key.name) &&
    (isUndefined(key.expiration) || isNumber(key.expiration)) &&
    (isUndefined(key.metadata) || !metadataValidator || metadataValidator(key.metadata))
  );
}

// Validation Result Helpers
export function createValidationError(
  field: string,
  message: string,
  value?: unknown,
  code?: string
): ValidationError {
  return {
    field,
    message,
    value,
    code
  };
}

export function createValidationResult<T>(
  isValid: boolean,
  value?: T,
  errors: ValidationError[] = []
): ValidationResult<T> {
  return {
    isValid,
    value,
    errors
  };
}

// Comprehensive Validation Functions
export function validateTelegramUpdate(value: unknown): ValidationResult<TelegramUpdate> {
  const errors: ValidationError[] = [];
  
  if (!isObject(value)) {
    errors.push(createValidationError('root', 'Value must be an object', value));
    return createValidationResult(false, undefined, errors);
  }
  
  if (!isNumber(value.update_id)) {
    errors.push(createValidationError('update_id', 'update_id must be a number', value.update_id));
  }
  
  // Validate message if present
  if (value.message !== undefined && !isTelegramMessage(value.message)) {
    errors.push(createValidationError('message', 'Invalid message format', value.message));
  }
  
  // Validate edited_message if present
  if (value.edited_message !== undefined && !isTelegramMessage(value.edited_message)) {
    errors.push(createValidationError('edited_message', 'Invalid edited_message format', value.edited_message));
  }
  
  // Validate channel_post if present
  if (value.channel_post !== undefined && !isTelegramMessage(value.channel_post)) {
    errors.push(createValidationError('channel_post', 'Invalid channel_post format', value.channel_post));
  }
  
  // Validate edited_channel_post if present
  if (value.edited_channel_post !== undefined && !isTelegramMessage(value.edited_channel_post)) {
    errors.push(createValidationError('edited_channel_post', 'Invalid edited_channel_post format', value.edited_channel_post));
  }
  
  const isValid = errors.length === 0;
  return createValidationResult(isValid, isValid ? value as TelegramUpdate : undefined, errors);
}

export function validateOpenAIResponse(value: unknown): ValidationResult<OpenAIResponse> {
  const errors: ValidationError[] = [];
  
  if (!isObject(value)) {
    errors.push(createValidationError('root', 'Value must be an object', value));
    return createValidationResult(false, undefined, errors);
  }
  
  if (!isString(value.id)) {
    errors.push(createValidationError('id', 'id must be a string', value.id));
  }
  
  if (!isString(value.object)) {
    errors.push(createValidationError('object', 'object must be a string', value.object));
  }
  
  if (!isNumber(value.created)) {
    errors.push(createValidationError('created', 'created must be a number', value.created));
  }
  
  if (!isString(value.model)) {
    errors.push(createValidationError('model', 'model must be a string', value.model));
  }
  
  if (!isArray(value.choices)) {
    errors.push(createValidationError('choices', 'choices must be an array', value.choices));
  } else {
    value.choices.forEach((choice, index) => {
      if (!isObject(choice)) {
        errors.push(createValidationError(`choices[${index}]`, 'Choice must be an object', choice));
        return;
      }
      
      if (!isNumber(choice.index)) {
        errors.push(createValidationError(`choices[${index}].index`, 'Choice index must be a number', choice.index));
      }
      
      if (!isObject(choice.message)) {
        errors.push(createValidationError(`choices[${index}].message`, 'Choice message must be an object', choice.message));
      } else {
        if (!isString(choice.message.role)) {
          errors.push(createValidationError(`choices[${index}].message.role`, 'Message role must be a string', choice.message.role));
        }
        
        if (!isString(choice.message.content) && !isNull(choice.message.content)) {
          errors.push(createValidationError(`choices[${index}].message.content`, 'Message content must be a string or null', choice.message.content));
        }
      }
    });
  }
  
  const isValid = errors.length === 0;
  return createValidationResult(isValid, isValid ? value as OpenAIResponse : undefined, errors);
}

export function validateDatabaseResult<T>(
  value: unknown,
  rowValidator?: (row: unknown) => ValidationResult<T>
): ValidationResult<DatabaseResult<T>> {
  const errors: ValidationError[] = [];
  
  if (!isObject(value)) {
    errors.push(createValidationError('root', 'Value must be an object', value));
    return createValidationResult(false, undefined, errors);
  }
  
  if (!isArray(value.results)) {
    errors.push(createValidationError('results', 'results must be an array', value.results));
  } else if (rowValidator) {
    value.results.forEach((row, index) => {
      const rowValidation = rowValidator(row);
      if (!rowValidation.isValid) {
        rowValidation.errors.forEach(error => {
          errors.push(createValidationError(`results[${index}].${error.field}`, error.message, error.value, error.code));
        });
      }
    });
  }
  
  if (!isBoolean(value.success)) {
    errors.push(createValidationError('success', 'success must be a boolean', value.success));
  }
  
  if (!isObject(value.meta)) {
    errors.push(createValidationError('meta', 'meta must be an object', value.meta));
  } else {
    const requiredMetaFields = [
      'served_by', 'duration', 'changes', 'last_row_id', 
      'changed_db', 'size_after', 'rows_read', 'rows_written'
    ];
    
    requiredMetaFields.forEach(field => {
      if (!(field in value.meta)) {
        errors.push(createValidationError(`meta.${field}`, `meta.${field} is required`, undefined));
      }
    });
  }
  
  const isValid = errors.length === 0;
  return createValidationResult(isValid, isValid ? value as DatabaseResult<T> : undefined, errors);
}

// Configuration Validation
export function validateConfiguration<T extends Record<string, unknown>>(
  value: unknown,
  schema: Record<keyof T, (value: unknown) => boolean>
): ValidationResult<T> {
  const errors: ValidationError[] = [];
  
  if (!isObject(value)) {
    errors.push(createValidationError('root', 'Configuration must be an object', value));
    return createValidationResult(false, undefined, errors);
  }
  
  Object.entries(schema).forEach(([key, validator]) => {
    const fieldValue = value[key];
    if (!validator(fieldValue)) {
      errors.push(createValidationError(key, `Invalid value for ${key}`, fieldValue));
    }
  });
  
  const isValid = errors.length === 0;
  return createValidationResult(isValid, isValid ? value as T : undefined, errors);
}

// User Input Validation
export function validateUserInput(value: unknown): ValidationResult<string> {
  const errors: ValidationError[] = [];
  
  if (!isString(value)) {
    errors.push(createValidationError('input', 'User input must be a string', value));
    return createValidationResult(false, undefined, errors);
  }
  
  // Basic sanitization checks
  if (value.length > 10000) {
    errors.push(createValidationError('input', 'Input too long (max 10000 characters)', value));
  }
  
  // Check for potentially dangerous patterns
  const dangerousPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi
  ];
  
  dangerousPatterns.forEach((pattern, index) => {
    if (pattern.test(value)) {
      errors.push(createValidationError('input', `Input contains potentially dangerous content (pattern ${index + 1})`, value));
    }
  });
  
  const isValid = errors.length === 0;
  return createValidationResult(isValid, isValid ? value : undefined, errors);
}

// Generic Array Validation
export function validateArray<T>(
  value: unknown,
  itemValidator: (item: unknown) => item is T
): ValidationResult<T[]> {
  const errors: ValidationError[] = [];
  
  if (!isArray(value)) {
    errors.push(createValidationError('root', 'Value must be an array', value));
    return createValidationResult(false, undefined, errors);
  }
  
  const validatedItems: T[] = [];
  value.forEach((item, index) => {
    if (!itemValidator(item)) {
      errors.push(createValidationError(`[${index}]`, 'Invalid array item', item));
    } else {
      validatedItems.push(item);
    }
  });
  
  const isValid = errors.length === 0;
  return createValidationResult(isValid, isValid ? validatedItems : undefined, errors);
}

// Error Handling for Validation
export class TypeValidationError extends Error {
  constructor(
    public field: string,
    message: string,
    public value?: unknown,
    public code?: string
  ) {
    super(`Validation error in field '${field}': ${message}`);
    this.name = 'TypeValidationError';
  }
}

export function throwOnValidationError<T>(result: ValidationResult<T>): T {
  if (!result.isValid) {
    const firstError = result.errors[0];
    throw new TypeValidationError(
      firstError.field || 'unknown',
      firstError.message,
      firstError.value,
      firstError.code
    );
  }
  
  return result.value!;
}

// Async Validation Support
export async function validateAsync<T>(
  value: unknown,
  validator: (value: unknown) => Promise<ValidationResult<T>>
): Promise<ValidationResult<T>> {
  try {
    return await validator(value);
  } catch (error: unknown) {
    return createValidationResult(false, undefined, [
      createValidationError('async', `Async validation failed: ${error}`, value)
    ]);
  }
}