/**
 * Type Definitions Index
 * Central export point for all type definitions
 */

// API Types
export * from './api-types';

// Database Types  
export * from './database-types';

// Utility Types
export * from './utility-types';

// Re-export commonly used types for convenience
export type {
  // Telegram Types
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
  TelegramChat,
  TelegramApiResponse,
  
  // AI Provider Types
  OpenAIResponse,
  CloudflareAIResponse,
  
  // Database Types
  DatabaseResult,
  DatabaseRow,
  
  // KV Storage Types
  KVListResult,
  KVKey,
  
  // Generic Response Types
  ApiResponse,
  ErrorResponse,
  PaginatedResponse
} from './api-types';

export type {
  // Database Entity Types
  BaseEntity,
  SoftDeletableEntity,
  MessageRecord,
  ViolationRecord,
  StatisticsRecord,
  
  // Repository Types
  Repository,
  SoftDeleteRepository,
  CreateInput,
  UpdateInput,
  DatabaseId,
  
  // Query Types
  QueryOptions,
  WhereClause,
  OrderByClause,
  JoinClause
} from './database-types';

export type {
  // Generic Utility Types
  DeepPartial,
  DeepRequired,
  DeepReadonly,
  Nullable,
  Optional,
  Maybe,
  StringRecord,
  ValidationResult,
  ValidationError,
  TypeGuard,
  AsyncFunction,
  Transformer,
  
  // Function Types
  Callback,
  EventHandler,
  Predicate,
  Mapper,
  Filter,
  
  // Collection Types
  NonEmptyArray,
  Collection,
  List,
  Set,
  Map
} from './utility-types';