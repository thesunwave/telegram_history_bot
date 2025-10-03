/**
 * Service Configuration Validator
 * Validates service configurations and ensures proper setup
 */

import type { Env } from '../env';
import type { ServiceConfig } from './base-service';
import { BaseAppError } from '../utils/errors';

/**
 * Configuration validation result
 */
export interface ConfigValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  details?: Record<string, any>;
}

/**
 * Service configuration requirements
 */
export interface ServiceConfigRequirements {
  requiredEnvVars?: string[];
  optionalEnvVars?: string[];
  requiredDependencies?: string[];
  minVersion?: string;
  maxVersion?: string;
  customValidators?: Array<(config: ServiceConfig, env: Env) => ConfigValidationResult>;
}

/**
 * Service configuration validator
 */
export class ServiceConfigValidator {
  private static readonly DEFAULT_REQUIREMENTS: ServiceConfigRequirements = {
    requiredEnvVars: [],
    optionalEnvVars: [],
    requiredDependencies: [],
    customValidators: []
  };

  /**
   * Validate service configuration
   */
  static validate(
    config: ServiceConfig,
    env: Env,
    requirements: ServiceConfigRequirements = {}
  ): ConfigValidationResult {
    const mergedRequirements = { ...this.DEFAULT_REQUIREMENTS, ...requirements };
    const result: ConfigValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      details: {}
    };

    // Validate basic config structure
    this.validateBasicConfig(config, result);

    // Validate environment variables
    this.validateEnvironmentVariables(env, mergedRequirements, result);

    // Validate dependencies
    this.validateDependencies(config, mergedRequirements, result);

    // Validate version constraints
    this.validateVersionConstraints(config, mergedRequirements, result);

    // Run custom validators
    this.runCustomValidators(config, env, mergedRequirements, result);

    // Set overall validity
    result.isValid = result.errors.length === 0;

    return result;
  }

  /**
   * Validate basic configuration structure
   */
  private static validateBasicConfig(config: ServiceConfig, result: ConfigValidationResult): void {
    if (!config.name || typeof config.name !== 'string' || config.name.trim() === '') {
      result.errors.push('Service name is required and must be a non-empty string');
    }

    if (config.version && typeof config.version !== 'string') {
      result.errors.push('Service version must be a string');
    }

    if (config.description && typeof config.description !== 'string') {
      result.errors.push('Service description must be a string');
    }

    if (config.dependencies && !Array.isArray(config.dependencies)) {
      result.errors.push('Service dependencies must be an array');
    }

    if (config.healthCheckInterval !== undefined) {
      if (typeof config.healthCheckInterval !== 'number' || config.healthCheckInterval < 0) {
        result.errors.push('Health check interval must be a non-negative number');
      }
    }
  }

  /**
   * Validate environment variables
   */
  private static validateEnvironmentVariables(
    env: Env,
    requirements: ServiceConfigRequirements,
    result: ConfigValidationResult
  ): void {
    const envObj = env as any;

    // Check required environment variables
    if (requirements.requiredEnvVars) {
      for (const envVar of requirements.requiredEnvVars) {
        if (!envObj[envVar]) {
          result.errors.push(`Required environment variable '${envVar}' is missing`);
        }
      }
    }

    // Check optional environment variables (warnings only)
    if (requirements.optionalEnvVars) {
      for (const envVar of requirements.optionalEnvVars) {
        if (!envObj[envVar]) {
          result.warnings.push(`Optional environment variable '${envVar}' is not set`);
        }
      }
    }
  }

  /**
   * Validate service dependencies
   */
  private static validateDependencies(
    config: ServiceConfig,
    requirements: ServiceConfigRequirements,
    result: ConfigValidationResult
  ): void {
    if (requirements.requiredDependencies) {
      const configDeps = config.dependencies || [];
      
      for (const requiredDep of requirements.requiredDependencies) {
        if (!configDeps.includes(requiredDep)) {
          result.errors.push(`Required dependency '${requiredDep}' is not declared`);
        }
      }
    }
  }

  /**
   * Validate version constraints
   */
  private static validateVersionConstraints(
    config: ServiceConfig,
    requirements: ServiceConfigRequirements,
    result: ConfigValidationResult
  ): void {
    if (!config.version) {
      if (requirements.minVersion || requirements.maxVersion) {
        result.warnings.push('Service version is not specified but version constraints are defined');
      }
      return;
    }

    try {
      const version = this.parseVersion(config.version);
      
      if (requirements.minVersion) {
        const minVersion = this.parseVersion(requirements.minVersion);
        if (this.compareVersions(version, minVersion) < 0) {
          result.errors.push(`Service version ${config.version} is below minimum required version ${requirements.minVersion}`);
        }
      }

      if (requirements.maxVersion) {
        const maxVersion = this.parseVersion(requirements.maxVersion);
        if (this.compareVersions(version, maxVersion) > 0) {
          result.errors.push(`Service version ${config.version} is above maximum allowed version ${requirements.maxVersion}`);
        }
      }
    } catch (error: unknown) {
      result.errors.push(`Invalid version format: ${config.version}`);
    }
  }

  /**
   * Run custom validators
   */
  private static runCustomValidators(
    config: ServiceConfig,
    env: Env,
    requirements: ServiceConfigRequirements,
    result: ConfigValidationResult
  ): void {
    if (requirements.customValidators) {
      for (const validator of requirements.customValidators) {
        try {
          const customResult = validator(config, env);
          
          // Merge results
          result.errors.push(...customResult.errors);
          result.warnings.push(...customResult.warnings);
          
          if (customResult.details) {
            result.details = { ...result.details, ...customResult.details };
          }
        } catch (error: unknown) {
          result.errors.push(`Custom validator failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  /**
   * Parse semantic version string
   */
  private static parseVersion(version: string): { major: number; minor: number; patch: number } {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/);
    if (!match) {
      throw new Error(`Invalid version format: ${version}`);
    }

    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10)
    };
  }

  /**
   * Compare two version objects
   * Returns: -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
   */
  private static compareVersions(
    v1: { major: number; minor: number; patch: number },
    v2: { major: number; minor: number; patch: number }
  ): number {
    if (v1.major !== v2.major) {
      return v1.major < v2.major ? -1 : 1;
    }
    if (v1.minor !== v2.minor) {
      return v1.minor < v2.minor ? -1 : 1;
    }
    if (v1.patch !== v2.patch) {
      return v1.patch < v2.patch ? -1 : 1;
    }
    return 0;
  }

  /**
   * Create configuration requirements for common service types
   */
  static createRequirements(serviceType: 'statistics' | 'notification' | 'repository' | 'provider'): ServiceConfigRequirements {
    switch (serviceType) {
      case 'statistics':
        return {
          requiredDependencies: ['ViolationRepository'],
          minVersion: '1.0.0'
        };

      case 'notification':
        return {
          requiredDependencies: ['NotificationRepository'],
          requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
          minVersion: '1.0.0'
        };

      case 'repository':
        return {
          requiredEnvVars: ['DB'],
          minVersion: '1.0.0'
        };

      case 'provider':
        return {
          optionalEnvVars: ['SUMMARY_PROVIDER', 'OPENAI_API_KEY', 'CLOUDFLARE_ACCOUNT_ID'],
          minVersion: '1.0.0'
        };

      default:
        return this.DEFAULT_REQUIREMENTS;
    }
  }

  /**
   * Validate multiple service configurations
   */
  static validateMultiple(
    configs: Array<{ config: ServiceConfig; env: Env; requirements?: ServiceConfigRequirements }>,
    stopOnFirstError = false
  ): Map<string, ConfigValidationResult> {
    const results = new Map<string, ConfigValidationResult>();

    for (const { config, env, requirements } of configs) {
      const result = this.validate(config, env, requirements);
      results.set(config.name, result);

      if (stopOnFirstError && !result.isValid) {
        break;
      }
    }

    return results;
  }

  /**
   * Create validation error from result
   */
  static createValidationError(serviceName: string, result: ConfigValidationResult): BaseAppError {
    const errorMessage = `Service configuration validation failed for '${serviceName}'`;
    const details = {
      serviceName,
      errors: result.errors,
      warnings: result.warnings,
      ...result.details
    };

    return new BaseAppError('SERVICE_CONFIG_VALIDATION_FAILED', errorMessage, { context: details });
  }
}