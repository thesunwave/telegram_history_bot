/**
 * Utility Types
 * Generic type definitions to replace 'any' types in utility functions
 */

// Generic Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};

export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type Maybe<T> = T | null | undefined;

// Object Manipulation Types
export type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

export type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

export type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

export type PickByType<T, U> = Pick<T, KeysOfType<T, U>>;
export type OmitByType<T, U> = Omit<T, KeysOfType<T, U>>;

// Function Types
export type AsyncFunction<TArgs extends readonly unknown[] = unknown[], TReturn = unknown> = 
  (...args: TArgs) => Promise<TReturn>;

export type SyncFunction<TArgs extends readonly unknown[] = unknown[], TReturn = unknown> = 
  (...args: TArgs) => TReturn;

export type AnyFunction<TArgs extends readonly unknown[] = unknown[], TReturn = unknown> = 
  SyncFunction<TArgs, TReturn> | AsyncFunction<TArgs, TReturn>;

export type Callback<TArgs extends readonly unknown[] = unknown[], TReturn = void> = 
  (...args: TArgs) => TReturn;

export type EventHandler<TEvent = unknown> = (event: TEvent) => void | Promise<void>;

// Promise Types
export type PromiseValue<T> = T extends Promise<infer U> ? U : T;
export type PromiseTuple<T extends readonly unknown[]> = {
  [K in keyof T]: Promise<T[K]>;
};

// Array Types
export type NonEmptyArray<T> = [T, ...T[]];
export type ReadonlyNonEmptyArray<T> = readonly [T, ...readonly T[]];
export type ArrayElement<T> = T extends readonly (infer U)[] ? U : never;

// Record Types
export type StringRecord<T = unknown> = Record<string, T>;
export type NumberRecord<T = unknown> = Record<number, T>;
export type SymbolRecord<T = unknown> = Record<symbol, T>;

export type SafeRecord<K extends string | number | symbol, V> = Record<K, V>;
export type PartialRecord<K extends string | number | symbol, V> = Partial<Record<K, V>>;

// Validation Types
export interface ValidationResult<T = unknown> {
  isValid: boolean;
  value?: T;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  field?: string;
  message: string;
  code?: string;
  value?: unknown;
}

export interface ValidationWarning {
  field?: string;
  message: string;
  code?: string;
  value?: unknown;
}

export type Validator<T> = (value: unknown) => ValidationResult<T>;
export type AsyncValidator<T> = (value: unknown) => Promise<ValidationResult<T>>;

// Type Guards
export type TypeGuard<T> = (value: unknown) => value is T;
export type AsyncTypeGuard<T> = (value: unknown) => Promise<boolean>;

// Predicate Types
export type Predicate<T> = (value: T) => boolean;
export type AsyncPredicate<T> = (value: T) => Promise<boolean>;

// Comparison Types
export type Comparator<T> = (a: T, b: T) => number;
export type EqualityComparator<T> = (a: T, b: T) => boolean;

// Transformation Types
export type Transformer<TInput, TOutput> = (input: TInput) => TOutput;
export type AsyncTransformer<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

export type Mapper<TInput, TOutput> = (item: TInput, index: number, array: TInput[]) => TOutput;
export type AsyncMapper<TInput, TOutput> = (item: TInput, index: number, array: TInput[]) => Promise<TOutput>;

export type Reducer<TInput, TAccumulator> = (accumulator: TAccumulator, current: TInput, index: number, array: TInput[]) => TAccumulator;
export type AsyncReducer<TInput, TAccumulator> = (accumulator: TAccumulator, current: TInput, index: number, array: TInput[]) => Promise<TAccumulator>;

// Filter Types
export type Filter<T> = (item: T, index: number, array: T[]) => boolean;
export type AsyncFilter<T> = (item: T, index: number, array: T[]) => Promise<boolean>;

// Event Types
export interface EventEmitter<TEvents extends StringRecord<unknown[]> = StringRecord<unknown[]>> {
  on<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  off<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): boolean;
  once<K extends keyof TEvents>(event: K, listener: (...args: TEvents[K]) => void): this;
  removeAllListeners<K extends keyof TEvents>(event?: K): this;
  listenerCount<K extends keyof TEvents>(event: K): number;
}

// Cache Types
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl?: number;
  metadata?: StringRecord;
}

export interface Cache<TKey extends string | number, TValue> {
  get(key: TKey): Promise<TValue | null>;
  set(key: TKey, value: TValue, ttl?: number): Promise<void>;
  delete(key: TKey): Promise<boolean>;
  clear(): Promise<void>;
  has(key: TKey): Promise<boolean>;
  keys(): Promise<TKey[]>;
  values(): Promise<TValue[]>;
  entries(): Promise<Array<[TKey, TValue]>>;
  size(): Promise<number>;
}

// Configuration Types
export interface ConfigurationSchema<T extends StringRecord = StringRecord> {
  [key: string]: ConfigurationField<T[keyof T]>;
}

export interface ConfigurationField<T = unknown> {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: T;
  description?: string;
  validation?: Validator<T>;
  transform?: Transformer<unknown, T>;
  sensitive?: boolean;
  deprecated?: boolean;
  deprecationMessage?: string;
}

// Logger Types
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: StringRecord;
  error?: Error;
  metadata?: StringRecord;
}

export interface Logger {
  trace(message: string, context?: StringRecord): void;
  debug(message: string, context?: StringRecord): void;
  info(message: string, context?: StringRecord): void;
  warn(message: string, context?: StringRecord): void;
  error(message: string, error?: Error, context?: StringRecord): void;
  fatal(message: string, error?: Error, context?: StringRecord): void;
  child(context: StringRecord): Logger;
}

// HTTP Types
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface HttpHeaders extends StringRecord<string> {}

export interface HttpRequest<TBody = unknown, TQuery = StringRecord<string>, TParams = StringRecord<string>> {
  method: HttpMethod;
  url: string;
  headers: HttpHeaders;
  query: TQuery;
  params: TParams;
  body: TBody;
  ip?: string;
  userAgent?: string;
}

export interface HttpResponse<TBody = unknown> {
  status: number;
  headers: HttpHeaders;
  body: TBody;
}

// Middleware Types
export type Middleware<TContext = unknown> = (
  context: TContext,
  next: () => Promise<void>
) => Promise<void>;

export type ErrorMiddleware<TContext = unknown> = (
  error: Error,
  context: TContext,
  next: (error?: Error) => Promise<void>
) => Promise<void>;

// Service Types
export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  uptime: number;
  version: string;
  dependencies: ServiceDependencyHealth[];
  metrics?: StringRecord<number>;
}

export interface ServiceDependencyHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
}

export interface ServiceConfiguration<T extends StringRecord = StringRecord> {
  name: string;
  version: string;
  environment: string;
  config: T;
  dependencies: string[];
}

// Queue Types
export interface QueueJob<TData = unknown> {
  id: string;
  type: string;
  data: TData;
  priority: number;
  attempts: number;
  maxAttempts: number;
  delay: number;
  timestamp: Date;
  processedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
}

export interface Queue<TData = unknown> {
  add(type: string, data: TData, options?: QueueJobOptions): Promise<QueueJob<TData>>;
  process<TResult = unknown>(
    type: string,
    processor: (job: QueueJob<TData>) => Promise<TResult>
  ): void;
  pause(): Promise<void>;
  resume(): Promise<void>;
  empty(): Promise<void>;
  clean(grace: number, status?: 'completed' | 'failed'): Promise<number>;
  getJob(id: string): Promise<QueueJob<TData> | null>;
  getJobs(status: 'waiting' | 'active' | 'completed' | 'failed'): Promise<QueueJob<TData>[]>;
}

export interface QueueJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
  backoff?: 'fixed' | 'exponential';
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
}

// Metrics Types
export interface MetricValue {
  value: number;
  timestamp: Date;
  tags?: StringRecord<string>;
}

export interface Metric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'timer';
  description?: string;
  unit?: string;
  values: MetricValue[];
}

export interface MetricsCollector {
  counter(name: string, value?: number, tags?: StringRecord<string>): void;
  gauge(name: string, value: number, tags?: StringRecord<string>): void;
  histogram(name: string, value: number, tags?: StringRecord<string>): void;
  timer(name: string, value: number, tags?: StringRecord<string>): void;
  increment(name: string, tags?: StringRecord<string>): void;
  decrement(name: string, tags?: StringRecord<string>): void;
  timing<T>(name: string, fn: () => Promise<T>, tags?: StringRecord<string>): Promise<T>;
  getMetrics(): Metric[];
  reset(): void;
}

// Serialization Types
export type Serializable = 
  | string 
  | number 
  | boolean 
  | null 
  | undefined
  | SerializableObject 
  | SerializableArray;

export interface SerializableObject {
  [key: string]: Serializable;
}

export interface SerializableArray extends Array<Serializable> {}

export type Serializer<T> = {
  serialize(value: T): string;
  deserialize(data: string): T;
};

// State Management Types
export interface State<T = StringRecord> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  update<K extends keyof T>(key: K, updater: (current: T[K]) => T[K]): void;
  delete<K extends keyof T>(key: K): void;
  clear(): void;
  keys(): Array<keyof T>;
  values(): Array<T[keyof T]>;
  entries(): Array<[keyof T, T[keyof T]]>;
  subscribe(listener: (state: T) => void): () => void;
}

// Error Types
export interface ErrorDetails {
  code?: string;
  message: string;
  cause?: Error;
  context?: StringRecord;
  timestamp: Date;
  stack?: string;
}

export interface ErrorHandler<TError extends Error = Error> {
  canHandle(error: Error): error is TError;
  handle(error: TError, context?: StringRecord): Promise<void> | void;
}

// Retry Types
export interface RetryOptions {
  maxAttempts: number;
  delay: number;
  backoff: 'fixed' | 'exponential' | 'linear';
  maxDelay?: number;
  jitter?: boolean;
  retryIf?: (error: Error) => boolean;
}

export type RetryableFunction<TArgs extends readonly unknown[], TReturn> = 
  (...args: TArgs) => Promise<TReturn>;

// Circuit Breaker Types
export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  expectedErrors?: Array<new (...args: unknown[]) => Error>;
}

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreaker<TArgs extends readonly unknown[], TReturn> {
  execute(...args: TArgs): Promise<TReturn>;
  getState(): CircuitBreakerState;
  getStats(): {
    failures: number;
    successes: number;
    requests: number;
    state: CircuitBreakerState;
  };
}

// Rate Limiting Types
export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (context: unknown) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  totalHits: number;
}

// Pagination Types
export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Search Types
export interface SearchOptions {
  query: string;
  filters?: StringRecord;
  facets?: string[];
  highlight?: boolean;
  fuzzy?: boolean;
  boost?: StringRecord<number>;
}

export interface SearchResult<T> {
  items: SearchResultItem<T>[];
  total: number;
  facets?: StringRecord<{
    values: Array<{ value: string; count: number; selected: boolean }>;
    total: number;
  }>;
  suggestions?: string[];
  queryTime: number;
}

export interface SearchResultItem<T> {
  item: T;
  score: number;
  highlights?: StringRecord<string[]>;
}

// SearchFacet types are defined in api-types.ts

// Generic Collection Types
export interface Collection<T> extends Iterable<T> {
  add(item: T): void;
  remove(item: T): boolean;
  contains(item: T): boolean;
  clear(): void;
  size(): number;
  isEmpty(): boolean;
  toArray(): T[];
}

export interface List<T> extends Collection<T> {
  get(index: number): T | undefined;
  set(index: number, item: T): void;
  insert(index: number, item: T): void;
  removeAt(index: number): T | undefined;
  indexOf(item: T): number;
  lastIndexOf(item: T): number;
}

export interface Set<T> extends Collection<T> {
  union(other: Set<T>): Set<T>;
  intersection(other: Set<T>): Set<T>;
  difference(other: Set<T>): Set<T>;
  isSubsetOf(other: Set<T>): boolean;
  isSupersetOf(other: Set<T>): boolean;
}

export interface Map<K, V> extends Iterable<[K, V]> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  size(): number;
  keys(): Iterable<K>;
  values(): Iterable<V>;
  entries(): Iterable<[K, V]>;
}