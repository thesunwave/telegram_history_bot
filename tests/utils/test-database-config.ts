/**
 * Test Database Configuration
 * Environment-specific database URL configuration and validation
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface DatabaseEnvironmentConfig {
  /** Environment name */
  environment: 'test' | 'ci' | 'local' | 'development';
  /** Database URL */
  databaseUrl?: string;
  /** Database type */
  databaseType: 'sqlite' | 'd1' | 'mock';
  /** Database file path (for SQLite) */
  databasePath?: string;
  /** Enable SSL */
  ssl: boolean;
  /** Connection pool configuration */
  pool: {
    min: number;
    max: number;
    acquireTimeoutMillis: number;
    createTimeoutMillis: number;
    destroyTimeoutMillis: number;
    idleTimeoutMillis: number;
    reapIntervalMillis: number;
    createRetryIntervalMillis: number;
  };
  /** Migration configuration */
  migrations: {
    directory: string;
    tableName: string;
    schemaName?: string;
  };
  /** Seed configuration */
  seeds: {
    directory: string;
  };
}

export interface DatabaseValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  config: DatabaseEnvironmentConfig;
}

/**
 * Test Database Configuration Manager
 */
export class TestDatabaseConfig {
  private static instance: TestDatabaseConfig;
  private currentConfig?: DatabaseEnvironmentConfig;
  private configCache: Map<string, DatabaseEnvironmentConfig> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): TestDatabaseConfig {
    if (!TestDatabaseConfig.instance) {
      TestDatabaseConfig.instance = new TestDatabaseConfig();
    }
    return TestDatabaseConfig.instance;
  }

  /**
   * Get database configuration for environment
   */
  getConfig(environment?: string): DatabaseEnvironmentConfig {
    const env = environment || this.detectEnvironment();
    
    // Check cache first
    if (this.configCache.has(env)) {
      return this.configCache.get(env)!;
    }

    // Load configuration
    const config = this.loadConfiguration(env);
    
    // Cache configuration
    this.configCache.set(env, config);
    this.currentConfig = config;
    
    return config;
  }

  /**
   * Get current configuration
   */
  getCurrentConfig(): DatabaseEnvironmentConfig | undefined {
    return this.currentConfig;
  }

  /**
   * Validate database configuration
   */
  validateConfig(config: DatabaseEnvironmentConfig): DatabaseValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate environment
    if (!['test', 'ci', 'local', 'development'].includes(config.environment)) {
      errors.push(`Invalid environment: ${config.environment}`);
    }

    // Validate database type
    if (!['sqlite', 'd1', 'mock'].includes(config.databaseType)) {
      errors.push(`Invalid database type: ${config.databaseType}`);
    }

    // Validate database URL or path
    if (config.databaseType === 'sqlite' && !config.databasePath) {
      errors.push('Database path is required for SQLite');
    }

    if (config.databaseType === 'd1' && !config.databaseUrl) {
      warnings.push('Database URL not specified for D1, using default');
    }

    // Validate migration directory
    if (!existsSync(config.migrations.directory)) {
      errors.push(`Migration directory does not exist: ${config.migrations.directory}`);
    }

    // Validate seed directory
    if (!existsSync(config.seeds.directory)) {
      warnings.push(`Seed directory does not exist: ${config.seeds.directory}`);
    }

    // Validate pool configuration
    if (config.pool.min < 0) {
      errors.push('Pool minimum connections cannot be negative');
    }

    if (config.pool.max <= config.pool.min) {
      errors.push('Pool maximum connections must be greater than minimum');
    }

    if (config.pool.acquireTimeoutMillis <= 0) {
      errors.push('Pool acquire timeout must be positive');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      config
    };
  }

  /**
   * Get database URL for environment
   */
  getDatabaseUrl(environment?: string): string | undefined {
    const config = this.getConfig(environment);
    
    if (config.databaseType === 'sqlite' && config.databasePath) {
      return `sqlite:${config.databasePath}`;
    }
    
    if (config.databaseType === 'd1' && config.databaseUrl) {
      return config.databaseUrl;
    }
    
    if (config.databaseType === 'mock') {
      return 'mock://test-database';
    }
    
    return undefined;
  }

  /**
   * Create test database URL
   */
  createTestDatabaseUrl(testName?: string): string {
    const config = this.getConfig();
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substr(2, 9);
    
    if (config.databaseType === 'sqlite') {
      const testId = testName ? `${testName}-${timestamp}-${randomId}` : `test-${timestamp}-${randomId}`;
      return `sqlite::memory:${testId}`;
    }
    
    if (config.databaseType === 'd1') {
      const testId = testName ? `test-${testName}-${timestamp}` : `test-${timestamp}`;
      return `d1://test-database-${testId}`;
    }
    
    // Default to mock
    const testId = testName ? `mock-${testName}-${timestamp}` : `mock-test-${timestamp}`;
    return `mock://${testId}`;
  }

  /**
   * Clear configuration cache
   */
  clearCache(): void {
    this.configCache.clear();
    this.currentConfig = undefined;
  }

  /**
   * Reset configuration
   */
  reset(): void {
    this.clearCache();
  }

  // Private methods

  /**
   * Detect current environment
   */
  private detectEnvironment(): string {
    // Check NODE_ENV
    if (process.env.NODE_ENV === 'test') {
      return 'test';
    }
    
    // Check CI environment
    if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
      return 'ci';
    }
    
    // Check for development indicators
    if (process.env.NODE_ENV === 'development') {
      return 'development';
    }
    
    // Default to local
    return 'local';
  }

  /**
   * Load configuration for environment
   */
  private loadConfiguration(environment: string): DatabaseEnvironmentConfig {
    // Try to load from config file first
    const configFromFile = this.loadConfigFromFile(environment);
    if (configFromFile) {
      return configFromFile;
    }

    // Fall back to default configuration
    return this.getDefaultConfiguration(environment as any);
  }

  /**
   * Load configuration from file
   */
  private loadConfigFromFile(environment: string): DatabaseEnvironmentConfig | null {
    const configPaths = [
      join(process.cwd(), `database.${environment}.json`),
      join(process.cwd(), 'config', `database.${environment}.json`),
      join(process.cwd(), 'tests', 'config', `database.${environment}.json`)
    ];

    for (const configPath of configPaths) {
      if (existsSync(configPath)) {
        try {
          const configData = JSON.parse(readFileSync(configPath, 'utf8'));
          return {
            environment: environment as any,
            ...configData
          };
        } catch (error: unknown) {
          console.warn(`Failed to load config from ${configPath}:`, error);
        }
      }
    }

    return null;
  }

  /**
   * Get default configuration for environment
   */
  private getDefaultConfiguration(environment: 'test' | 'ci' | 'local' | 'development'): DatabaseEnvironmentConfig {
    const baseConfig = {
      environment,
      ssl: false,
      migrations: {
        directory: 'migrations',
        tableName: 'knex_migrations'
      },
      seeds: {
        directory: 'tests/fixtures'
      }
    };

    switch (environment) {
      case 'test':
        return {
          ...baseConfig,
          databaseType: 'mock' as const,
          pool: {
            min: 1,
            max: 5,
            acquireTimeoutMillis: 5000,
            createTimeoutMillis: 5000,
            destroyTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
            createRetryIntervalMillis: 200
          }
        };

      case 'ci':
        return {
          ...baseConfig,
          databaseType: 'mock' as const,
          pool: {
            min: 1,
            max: 2,
            acquireTimeoutMillis: 8000,
            createTimeoutMillis: 8000,
            destroyTimeoutMillis: 5000,
            idleTimeoutMillis: 20000,
            reapIntervalMillis: 2000,
            createRetryIntervalMillis: 500
          }
        };

      case 'local':
        return {
          ...baseConfig,
          databaseType: 'sqlite' as const,
          databasePath: ':memory:',
          pool: {
            min: 2,
            max: 10,
            acquireTimeoutMillis: 3000,
            createTimeoutMillis: 3000,
            destroyTimeoutMillis: 3000,
            idleTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
            createRetryIntervalMillis: 100
          }
        };

      case 'development':
        return {
          ...baseConfig,
          databaseType: 'sqlite' as const,
          databasePath: 'test-development.db',
          pool: {
            min: 2,
            max: 10,
            acquireTimeoutMillis: 3000,
            createTimeoutMillis: 3000,
            destroyTimeoutMillis: 3000,
            idleTimeoutMillis: 30000,
            reapIntervalMillis: 1000,
            createRetryIntervalMillis: 100
          }
        };

      default:
        throw new Error(`Unknown environment: ${environment}`);
    }
  }
}

/**
 * Database Configuration Utilities
 */
export class DatabaseConfigUtils {
  /**
   * Get database configuration for current environment
   */
  static getCurrentConfig(): DatabaseEnvironmentConfig {
    return TestDatabaseConfig.getInstance().getConfig();
  }

  /**
   * Get database URL for current environment
   */
  static getCurrentDatabaseUrl(): string | undefined {
    return TestDatabaseConfig.getInstance().getDatabaseUrl();
  }

  /**
   * Create test database URL with unique identifier
   */
  static createTestDatabaseUrl(testName?: string): string {
    return TestDatabaseConfig.getInstance().createTestDatabaseUrl(testName);
  }

  /**
   * Validate current database configuration
   */
  static validateCurrentConfig(): DatabaseValidationResult {
    const config = TestDatabaseConfig.getInstance().getCurrentConfig();
    if (!config) {
      return {
        isValid: false,
        errors: ['No configuration loaded'],
        warnings: [],
        config: {} as DatabaseEnvironmentConfig
      };
    }
    
    return TestDatabaseConfig.getInstance().validateConfig(config);
  }

  /**
   * Check if database configuration is valid
   */
  static isConfigValid(): boolean {
    const validation = DatabaseConfigUtils.validateCurrentConfig();
    return validation.isValid;
  }

  /**
   * Get configuration errors and warnings
   */
  static getConfigIssues(): { errors: string[]; warnings: string[] } {
    const validation = DatabaseConfigUtils.validateCurrentConfig();
    return {
      errors: validation.errors,
      warnings: validation.warnings
    };
  }

  /**
   * Reset database configuration
   */
  static reset(): void {
    TestDatabaseConfig.getInstance().reset();
  }
}

/**
 * Environment Detection Utilities
 */
export class EnvironmentDetection {
  /**
   * Check if running in test environment
   */
  static isTest(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  }

  /**
   * Check if running in CI environment
   */
  static isCI(): boolean {
    return process.env.CI === 'true' || 
           process.env.GITHUB_ACTIONS === 'true' ||
           process.env.GITLAB_CI === 'true' ||
           process.env.TRAVIS === 'true' ||
           process.env.CIRCLECI === 'true';
  }

  /**
   * Check if running in local development
   */
  static isLocal(): boolean {
    return !EnvironmentDetection.isTest() && !EnvironmentDetection.isCI();
  }

  /**
   * Get current environment name
   */
  static getCurrentEnvironment(): 'test' | 'ci' | 'local' | 'development' {
    if (EnvironmentDetection.isTest()) {
      return 'test';
    }
    
    if (EnvironmentDetection.isCI()) {
      return 'ci';
    }
    
    if (process.env.NODE_ENV === 'development') {
      return 'development';
    }
    
    return 'local';
  }
}