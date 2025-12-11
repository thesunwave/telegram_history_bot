/**
 * Model Policy - Logical model roles for LLM usage
 * 
 * ADR-001: Provides abstraction over specific model names using logical roles.
 * Features can request a role (nano/mini/heavy) instead of hardcoding model names.
 */

import { Env } from '../env';

/**
 * Logical model roles:
 * - nano: cheap, lightweight layer for preprocessing, filtering, simple classification
 * - mini: main workhorse for structured summarization, deeper analysis
 * - heavy: rare, expensive tasks (reserved for future use)
 */
export type ModelRole = 'nano' | 'mini' | 'heavy';

/**
 * Default model mappings for each role.
 * These can be overridden via environment variables.
 */
const DEFAULT_MODEL_MAPPINGS: Record<ModelRole, string> = {
  nano: 'gpt-4.1-nano',
  mini: 'gpt-4.1-mini',
  heavy: 'gpt-4.1',  // Reserved for future use
};

/**
 * Environment variable names for model overrides
 */
const MODEL_ENV_KEYS: Record<ModelRole, keyof Env | string> = {
  nano: 'LLM_NANO_MODEL',
  mini: 'LLM_MINI_MODEL',
  heavy: 'LLM_HEAVY_MODEL',
};

/**
 * Model policy that maps logical roles to actual model names.
 */
export interface IModelPolicy {
  /**
   * Get the model name for a given role.
   * @param role - Logical role (nano, mini, heavy)
   * @returns The model name to use
   */
  getModel(role: ModelRole): string;

  /**
   * Attempt to detect the role for a given model name.
   * @param model - Model name
   * @returns The detected role, or null if not recognized
   */
  getRoleForModel(model: string): ModelRole | null;

  /**
   * Get all available roles and their current model mappings.
   */
  getMappings(): Record<ModelRole, string>;
}

/**
 * Default implementation of ModelPolicy using environment-based configuration.
 */
export class ModelPolicy implements IModelPolicy {
  private readonly mappings: Record<ModelRole, string>;

  constructor(env?: Partial<Env> & Record<string, unknown>) {
    this.mappings = {
      nano: this.resolveModel('nano', env),
      mini: this.resolveModel('mini', env),
      heavy: this.resolveModel('heavy', env),
    };
  }

  private resolveModel(role: ModelRole, env?: Partial<Env> & Record<string, unknown>): string {
    if (!env) {
      return DEFAULT_MODEL_MAPPINGS[role];
    }

    const envKey = MODEL_ENV_KEYS[role];
    const envValue = env[envKey as keyof typeof env];

    if (typeof envValue === 'string' && envValue.trim().length > 0) {
      return envValue.trim();
    }

    return DEFAULT_MODEL_MAPPINGS[role];
  }

  getModel(role: ModelRole): string {
    return this.mappings[role];
  }

  getRoleForModel(model: string): ModelRole | null {
    const modelLower = model.toLowerCase();

    // Check exact matches first
    for (const [role, mappedModel] of Object.entries(this.mappings)) {
      if (mappedModel.toLowerCase() === modelLower) {
        return role as ModelRole;
      }
    }

    // Heuristic detection based on model name patterns
    if (modelLower.includes('nano')) {
      return 'nano';
    }
    if (modelLower.includes('mini')) {
      return 'mini';
    }
    if (modelLower.includes('turbo') || modelLower.includes('gpt-4') || modelLower.includes('gpt-5')) {
      // Larger models that aren't nano/mini are considered heavy
      if (!modelLower.includes('nano') && !modelLower.includes('mini')) {
        return 'heavy';
      }
    }

    return null;
  }

  getMappings(): Record<ModelRole, string> {
    return { ...this.mappings };
  }
}

/**
 * Singleton instance for the current model policy.
 * Lazily initialized on first access.
 */
let globalPolicy: IModelPolicy | null = null;

/**
 * Get or create the global model policy instance.
 * @param env - Environment configuration (only used for initialization)
 */
export function getModelPolicy(env?: Partial<Env> & Record<string, unknown>): IModelPolicy {
  if (!globalPolicy) {
    globalPolicy = new ModelPolicy(env);
  }
  return globalPolicy;
}

/**
 * Reset the global model policy (primarily for testing).
 */
export function resetModelPolicy(): void {
  globalPolicy = null;
}
