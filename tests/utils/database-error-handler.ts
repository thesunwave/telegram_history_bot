/**
 * Database Error Handler
 * Comprehensive error handling for database connection failures
 */

export interface DatabaseError extends Error {
  /** Error code */
  code: string;
  /** Error category */
  category: 'connection' | 'query' | 'timeout' | 'validation' | 'configuration' | 'unknown';
  /** Whether the error is retryable */
  retryable: boolean;
  /** Connection ID if applicable */
  connectionId?: string;
  /** Query that caused the error */
  query?: string;
  /** Query parameters */
  params?: any[];
  /** Timestamp when error occurred */
  timestamp: Date;
  /** Additional context */
  context?: Record<string, any>;
  /** Original error */
  originalError?: Error;
}

export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Initial delay between retries in milliseconds */
  initialDelay: number;
  /** Maximum delay between retries in milliseconds */
  maxDelay: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Jitter factor (0-1) to add randomness to delays */
  jitterFactor: number;
  /** Function to determine if error should be retried */
  shouldRetry?: (error: DatabaseError, attempt: number) => boolean;
}

export interface ErrorRecoveryStrategy {
  /** Strategy name */
  name: string;
  /** Whether this strategy can handle the error */
  canHandle: (error: DatabaseError) => boolean;
  /** Execute recovery strategy */
  execute: (error: DatabaseError, context?: any) => Promise<void>;
  /** Priority (higher = more preferred) */
  priority: number;
}

/**
 * Database Error Handler
 * Handles database connection failures with retry logic and recovery strategies
 */
export class DatabaseErrorHandler {
  private retryConfig: RetryConfig;
  private recoveryStrategies: ErrorRecoveryStrategy[] = [];
  private errorLog: DatabaseError[] = [];
  private maxErrorLogSize: number = 1000;

  constructor(retryConfig: Partial<RetryConfig> = {}) {
    this.retryConfig = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      ...retryConfig
    };

    // Register default recovery strategies
    this.registerDefaultRecoveryStrategies();
  }

  /**
   * Handle database error with retry logic
   */
  async handleError<T>(
    error: Error | DatabaseError,
    operation: () => Promise<T>,
    context?: Record<string, any>
  ): Promise<T> {
    const dbError = this.normalizeDatabaseError(error, context);
    this.logError(dbError);

    // Try recovery strategies first
    await this.attemptRecovery(dbError, context);

    // If error is not retryable, throw immediately
    if (!dbError.retryable) {
      throw dbError;
    }

    // Attempt operation with retry logic
    return this.retryOperation(operation, dbError);
  }

  /**
   * Execute operation with retry logic
   */
  async retryOperation<T>(
    operation: () => Promise<T>,
    initialError?: DatabaseError
  ): Promise<T> {
    let lastError = initialError;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        // If this is a retry attempt, wait before trying
        if (attempt > 1) {
          const delay = this.calculateDelay(attempt - 1);
          await this.sleep(delay);
        }

        return await operation();
      } catch (error: unknown) {
        const dbError = this.normalizeDatabaseError(error);
        this.logError(dbError);
        lastError = dbError;

        // Check if we should retry
        const shouldRetry = this.shouldRetryError(dbError, attempt);
        
        if (!shouldRetry || attempt === this.retryConfig.maxAttempts) {
          break;
        }

        // Attempt recovery before next retry
        try {
          await this.attemptRecovery(dbError);
        } catch (recoveryError) {
          console.warn('Recovery attempt failed:', recoveryError);
        }
      }
    }

    throw lastError || new Error('Operation failed after all retry attempts');
  }

  /**
   * Create database error from generic error
   */
  createDatabaseError(
    message: string,
    code: string,
    category: DatabaseError['category'],
    retryable: boolean = true,
    context?: Record<string, any>
  ): DatabaseError {
    const error = new Error(message) as DatabaseError;
    error.code = code;
    error.category = category;
    error.retryable = retryable;
    error.timestamp = new Date();
    error.context = context;
    return error;
  }

  /**
   * Register error recovery strategy
   */
  registerRecoveryStrategy(strategy: ErrorRecoveryStrategy): void {
    this.recoveryStrategies.push(strategy);
    // Sort by priority (highest first)
    this.recoveryStrategies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get error statistics
   */
  getErrorStatistics(): {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    errorsByCode: Record<string, number>;
    recentErrors: DatabaseError[];
    retryableErrors: number;
    nonRetryableErrors: number;
  } {
    const errorsByCategory: Record<string, number> = {};
    const errorsByCode: Record<string, number> = {};
    let retryableErrors = 0;
    let nonRetryableErrors = 0;

    for (const error of this.errorLog) {
      errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;
      errorsByCode[error.code] = (errorsByCode[error.code] || 0) + 1;
      
      if (error.retryable) {
        retryableErrors++;
      } else {
        nonRetryableErrors++;
      }
    }

    return {
      totalErrors: this.errorLog.length,
      errorsByCategory,
      errorsByCode,
      recentErrors: this.errorLog.slice(-10), // Last 10 errors
      retryableErrors,
      nonRetryableErrors
    };
  }

  /**
   * Clear error log
   */
  clearErrorLog(): void {
    this.errorLog = [];
  }

  /**
   * Update retry configuration
   */
  updateRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  // Private methods

  /**
   * Normalize error to DatabaseError
   */
  private normalizeDatabaseError(
    error: Error | DatabaseError,
    context?: Record<string, any>
  ): DatabaseError {
    if (this.isDatabaseError(error)) {
      return error;
    }

    // Analyze error message to determine category and code
    const message = error.message.toLowerCase();
    let category: DatabaseError['category'] = 'unknown';
    let code = 'UNKNOWN_ERROR';
    let retryable = true;

    // Connection errors
    if (message.includes('connection') || message.includes('connect')) {
      category = 'connection';
      if (message.includes('timeout')) {
        code = 'CONNECTION_TIMEOUT';
      } else if (message.includes('refused') || message.includes('failed')) {
        code = 'CONNECTION_REFUSED';
      } else {
        code = 'CONNECTION_ERROR';
      }
    }
    // Query errors
    else if (message.includes('syntax') || message.includes('sql')) {
      category = 'query';
      code = 'QUERY_ERROR';
      retryable = false; // Syntax errors are not retryable
    }
    // Timeout errors
    else if (message.includes('timeout')) {
      category = 'timeout';
      code = 'OPERATION_TIMEOUT';
    }
    // Validation errors
    else if (message.includes('validation') || message.includes('invalid')) {
      category = 'validation';
      code = 'VALIDATION_ERROR';
      retryable = false;
    }
    // Configuration errors
    else if (message.includes('config') || message.includes('setting')) {
      category = 'configuration';
      code = 'CONFIGURATION_ERROR';
      retryable = false;
    }

    const dbError = error as DatabaseError;
    dbError.code = code;
    dbError.category = category;
    dbError.retryable = retryable;
    dbError.timestamp = new Date();
    dbError.context = context;
    dbError.originalError = error;

    return dbError;
  }

  /**
   * Check if error is a DatabaseError
   */
  private isDatabaseError(error: any): error is DatabaseError {
    return error && 
           typeof error.code === 'string' &&
           typeof error.category === 'string' &&
           typeof error.retryable === 'boolean' &&
           error.timestamp instanceof Date;
  }

  /**
   * Log error to error log
   */
  private logError(error: DatabaseError): void {
    this.errorLog.push(error);
    
    // Trim error log if it gets too large
    if (this.errorLog.length > this.maxErrorLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxErrorLogSize);
    }
  }

  /**
   * Determine if error should be retried
   */
  private shouldRetryError(error: DatabaseError, attempt: number): boolean {
    // Use custom retry logic if provided
    if (this.retryConfig.shouldRetry) {
      return this.retryConfig.shouldRetry(error, attempt);
    }

    // Default retry logic
    if (!error.retryable) {
      return false;
    }

    // Don't retry validation or configuration errors
    if (error.category === 'validation' || error.category === 'configuration') {
      return false;
    }

    // Don't retry if we've exceeded max attempts
    if (attempt >= this.retryConfig.maxAttempts) {
      return false;
    }

    return true;
  }

  /**
   * Calculate delay for retry attempt
   */
  private calculateDelay(attempt: number): number {
    const baseDelay = Math.min(
      this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt),
      this.retryConfig.maxDelay
    );

    // Add jitter to prevent thundering herd
    const jitter = baseDelay * this.retryConfig.jitterFactor * Math.random();
    
    return Math.floor(baseDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Attempt error recovery
   */
  private async attemptRecovery(error: DatabaseError, context?: any): Promise<void> {
    for (const strategy of this.recoveryStrategies) {
      if (strategy.canHandle(error)) {
        try {
          await strategy.execute(error, context);
          return; // Recovery successful
        } catch (recoveryError) {
          console.warn(`Recovery strategy ${strategy.name} failed:`, recoveryError);
          // Continue to next strategy
        }
      }
    }
  }

  /**
   * Register default recovery strategies
   */
  private registerDefaultRecoveryStrategies(): void {
    // Connection reset strategy
    this.registerRecoveryStrategy({
      name: 'connection-reset',
      canHandle: (error) => error.category === 'connection',
      execute: async (error, context) => {
        // For mock databases, we can't really reset connections
        // This would be implemented for real database connections
        console.log('Attempting connection reset for error:', error.code);
      },
      priority: 10
    });

    // Query retry strategy
    this.registerRecoveryStrategy({
      name: 'query-retry',
      canHandle: (error) => error.category === 'query' && error.retryable,
      execute: async (error, context) => {
        console.log('Preparing query retry for error:', error.code);
        // Could implement query optimization or parameter adjustment here
      },
      priority: 5
    });

    // Timeout recovery strategy
    this.registerRecoveryStrategy({
      name: 'timeout-recovery',
      canHandle: (error) => error.category === 'timeout',
      execute: async (error, context) => {
        console.log('Attempting timeout recovery for error:', error.code);
        // Could implement connection pool refresh or timeout adjustment
      },
      priority: 8
    });
  }
}

/**
 * Database Error Factory
 * Factory for creating specific database errors
 */
export class DatabaseErrorFactory {
  /**
   * Create connection error
   */
  static createConnectionError(
    message: string,
    connectionId?: string,
    retryable: boolean = true
  ): DatabaseError {
    const error = new Error(message) as DatabaseError;
    error.code = 'CONNECTION_ERROR';
    error.category = 'connection';
    error.retryable = retryable;
    error.connectionId = connectionId;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Create query error
   */
  static createQueryError(
    message: string,
    query?: string,
    params?: any[],
    retryable: boolean = false
  ): DatabaseError {
    const error = new Error(message) as DatabaseError;
    error.code = 'QUERY_ERROR';
    error.category = 'query';
    error.retryable = retryable;
    error.query = query;
    error.params = params;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Create timeout error
   */
  static createTimeoutError(
    message: string,
    operation: string,
    timeoutMs: number
  ): DatabaseError {
    const error = new Error(message) as DatabaseError;
    error.code = 'OPERATION_TIMEOUT';
    error.category = 'timeout';
    error.retryable = true;
    error.context = { operation, timeoutMs };
    error.timestamp = new Date();
    return error;
  }

  /**
   * Create validation error
   */
  static createValidationError(
    message: string,
    validationDetails?: Record<string, any>
  ): DatabaseError {
    const error = new Error(message) as DatabaseError;
    error.code = 'VALIDATION_ERROR';
    error.category = 'validation';
    error.retryable = false;
    error.context = validationDetails;
    error.timestamp = new Date();
    return error;
  }

  /**
   * Create configuration error
   */
  static createConfigurationError(
    message: string,
    configKey?: string
  ): DatabaseError {
    const error = new Error(message) as DatabaseError;
    error.code = 'CONFIGURATION_ERROR';
    error.category = 'configuration';
    error.retryable = false;
    error.context = { configKey };
    error.timestamp = new Date();
    return error;
  }
}

/**
 * Error Handler Factory
 */
export class ErrorHandlerFactory {
  /**
   * Create error handler with default configuration
   */
  static createDefault(): DatabaseErrorHandler {
    return new DatabaseErrorHandler();
  }

  /**
   * Create error handler for CI environment
   */
  static createForCI(): DatabaseErrorHandler {
    return new DatabaseErrorHandler({
      maxAttempts: 5, // More attempts for CI
      initialDelay: 2000, // Longer initial delay
      maxDelay: 30000, // Longer max delay
      backoffMultiplier: 2,
      jitterFactor: 0.2
    });
  }

  /**
   * Create error handler for local development
   */
  static createForLocal(): DatabaseErrorHandler {
    return new DatabaseErrorHandler({
      maxAttempts: 3, // Fewer attempts for local
      initialDelay: 500, // Shorter initial delay
      maxDelay: 5000, // Shorter max delay
      backoffMultiplier: 1.5,
      jitterFactor: 0.1
    });
  }

  /**
   * Create error handler with custom configuration
   */
  static createWithConfig(config: Partial<RetryConfig>): DatabaseErrorHandler {
    return new DatabaseErrorHandler(config);
  }
}