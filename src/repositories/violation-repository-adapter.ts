/**
 * @fileoverview Violation Repository Adapter
 * 
 * Re-exports ViolationRepository with proper interface for backward compatibility.
 * The base ViolationRepository already provides the expected interface.
 * 
 * @author Telegram History Bot Team
 * @version 1.0.0
 * @since 2024-01-01
 * 
 * @deprecated Import ViolationRepository directly instead of using this adapter
 */

import type { Env } from '../env';
import type { 
  Violation, 
  UserStats, 
  PeriodStats, 
  GeneralStats
} from '../models/statistics';
import { ViolationRepository as BaseViolationRepository, type IViolationRepository as IBaseViolationRepository } from './violation-repository';

/**
 * Legacy interface for violation repository operations.
 * 
 * This interface is now identical to the base repository interface.
 * 
 * @interface IViolationRepository
 * @deprecated Import IViolationRepository from './violation-repository' instead
 */
export interface IViolationRepository extends IBaseViolationRepository {}

/**
 * Adapter class that simply re-exports the base ViolationRepository.
 * 
 * The base ViolationRepository already provides the expected interface,
 * so this adapter is no longer needed but kept for backward compatibility.
 * 
 * @class ViolationRepositoryAdapter
 * @deprecated Use ViolationRepository directly instead
 * 
 * @example
 * ```typescript
 * // Deprecated - use this
 * const adapter = new ViolationRepositoryAdapter(env);
 * 
 * // Preferred - use this instead
 * const repository = new ViolationRepository(env);
 * ```
 */
export class ViolationRepositoryAdapter extends BaseViolationRepository implements IViolationRepository {
  /**
   * Creates a new ViolationRepositoryAdapter instance.
   * 
   * @param env - The environment configuration containing database connections
   * 
   * @example
   * ```typescript
   * const adapter = new ViolationRepositoryAdapter(env);
   * ```
   */
  constructor(env: Env) {
    super(env);
  }
}

// Export the base repository for backward compatibility
export { BaseViolationRepository as ViolationRepository };