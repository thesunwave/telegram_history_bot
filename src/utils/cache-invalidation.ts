/**
 * Cache invalidation strategies and utilities
 */

import { CacheManager, CacheInvalidationStrategy } from './cache-manager';
import { performanceMonitor } from './performance-monitor';

export interface InvalidationRule {
  pattern: string | RegExp;
  strategy: CacheInvalidationStrategy;
  priority: number;
  description: string;
}

export interface InvalidationEvent {
  type: 'data_change' | 'user_action' | 'time_based' | 'manual';
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface InvalidationResult {
  keysInvalidated: number;
  strategiesApplied: string[];
  duration: number;
  errors: string[];
}

export class CacheInvalidationManager {
  private rules: InvalidationRule[] = [];
  private cacheManagers: Map<string, CacheManager> = new Map();

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * Register a cache manager
   */
  registerCacheManager(namespace: string, manager: CacheManager): void {
    this.cacheManagers.set(namespace, manager);
  }

  /**
   * Add invalidation rule
   */
  addRule(rule: InvalidationRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove invalidation rule
   */
  removeRule(pattern: string | RegExp): void {
    this.rules = this.rules.filter(rule => rule.pattern !== pattern);
  }

  /**
   * Process invalidation event
   */
  async processInvalidationEvent(event: InvalidationEvent): Promise<InvalidationResult> {
    const perfId = performanceMonitor.startOperation('CacheInvalidation.processEvent', {
      eventType: event.type,
      entity: event.entity,
      entityId: event.entityId,
    });

    const startTime = Date.now();
    const result: InvalidationResult = {
      keysInvalidated: 0,
      strategiesApplied: [],
      duration: 0,
      errors: [],
    };

    try {
      // Find applicable rules
      const applicableRules = this.findApplicableRules(event);
      
      for (const rule of applicableRules) {
        try {
          const invalidated = await this.applyInvalidationStrategy(rule, event);
          result.keysInvalidated += invalidated;
          result.strategiesApplied.push(rule.strategy.type);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result.errors.push(`Rule ${rule.description}: ${errorMessage}`);
        }
      }

      result.duration = Date.now() - startTime;

      performanceMonitor.endOperation(perfId, {
        keysInvalidated: result.keysInvalidated,
        strategiesApplied: result.strategiesApplied.length,
        errors: result.errors.length,
      });

      return result;
    } catch (error: unknown) {
      result.duration = Date.now() - startTime;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');

      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });

      return result;
    }
  }

  /**
   * Invalidate by entity
   */
  async invalidateEntity(
    entity: 'user' | 'chat' | 'violation' | 'statistics',
    entityId: string,
    metadata?: Record<string, unknown>
  ): Promise<InvalidationResult> {
    const event: InvalidationEvent = {
      type: 'data_change',
      entity,
      entityId,
      metadata,
      timestamp: Date.now(),
    };

    return this.processInvalidationEvent(event);
  }

  /**
   * Invalidate by user action
   */
  async invalidateByUserAction(
    userId: string,
    action: string,
    chatId?: string,
    metadata?: Record<string, unknown>
  ): Promise<InvalidationResult> {
    const event: InvalidationEvent = {
      type: 'user_action',
      entity: 'user',
      entityId: userId,
      metadata: {
        action,
        chatId,
        ...metadata,
      },
      timestamp: Date.now(),
    };

    return this.processInvalidationEvent(event);
  }

  /**
   * Time-based invalidation (for scheduled cleanup)
   */
  async performTimeBasedInvalidation(): Promise<InvalidationResult> {
    const event: InvalidationEvent = {
      type: 'time_based',
      entity: 'system',
      timestamp: Date.now(),
    };

    return this.processInvalidationEvent(event);
  }

  /**
   * Manual invalidation with pattern
   */
  async manualInvalidation(
    pattern: string | RegExp,
    namespaces?: string[]
  ): Promise<InvalidationResult> {
    const perfId = performanceMonitor.startOperation('CacheInvalidation.manual', {
      pattern: pattern.toString(),
      namespaces: namespaces?.length || 0,
    });

    const startTime = Date.now();
    const result: InvalidationResult = {
      keysInvalidated: 0,
      strategiesApplied: ['manual'],
      duration: 0,
      errors: [],
    };

    try {
      const targetManagers = namespaces 
        ? Array.from(this.cacheManagers.entries()).filter(([ns]) => namespaces.includes(ns))
        : Array.from(this.cacheManagers.entries());

      for (const [namespace, manager] of targetManagers) {
        try {
          // For manual invalidation, we'll use tag-based invalidation
          // Convert pattern to tags if it's a string
          const tags = typeof pattern === 'string' 
            ? [pattern] 
            : ['manual_invalidation'];
          
          const invalidated = await manager.invalidateByTags(tags);
          result.keysInvalidated += invalidated;
        } catch (error: unknown) {
          result.errors.push(`Namespace ${namespace}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      result.duration = Date.now() - startTime;

      performanceMonitor.endOperation(perfId, {
        keysInvalidated: result.keysInvalidated,
        namespacesProcessed: targetManagers.length,
        errors: result.errors.length,
      });

      return result;
    } catch (error: unknown) {
      result.duration = Date.now() - startTime;
      result.errors.push(error instanceof Error ? error.message : 'Unknown error');

      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });

      return result;
    }
  }

  /**
   * Get invalidation statistics
   */
  getInvalidationStats(): {
    rulesCount: number;
    managersCount: number;
    rules: Array<{
      pattern: string;
      strategy: string;
      priority: number;
      description: string;
    }>;
  } {
    return {
      rulesCount: this.rules.length,
      managersCount: this.cacheManagers.size,
      rules: this.rules.map(rule => ({
        pattern: rule.pattern.toString(),
        strategy: rule.strategy.type,
        priority: rule.priority,
        description: rule.description,
      })),
    };
  }

  /**
   * Find applicable rules for an event
   */
  private findApplicableRules(event: InvalidationEvent): InvalidationRule[] {
    return this.rules.filter(rule => {
      if (typeof rule.pattern === 'string') {
        return event.entity === rule.pattern || 
               (event.entityId && event.entityId.includes(rule.pattern));
      } else {
        const testString = `${event.entity}:${event.entityId || ''}:${event.type}`;
        return rule.pattern.test(testString);
      }
    });
  }

  /**
   * Apply invalidation strategy
   */
  private async applyInvalidationStrategy(
    rule: InvalidationRule,
    event: InvalidationEvent
  ): Promise<number> {
    let totalInvalidated = 0;

    switch (rule.strategy.type) {
      case 'tag':
        if (rule.strategy.tags) {
          for (const manager of this.cacheManagers.values()) {
            totalInvalidated += await manager.invalidateByTags(rule.strategy.tags);
          }
        }
        break;

      case 'ttl':
        // TTL-based invalidation is handled automatically by the cache manager
        // This is more of a configuration strategy
        break;

      case 'lru':
        // LRU invalidation would require additional implementation
        // For now, we'll treat it as a tag-based invalidation
        const lruTags = [`lru:${event.entity}`, `entity:${event.entityId}`];
        for (const manager of this.cacheManagers.values()) {
          totalInvalidated += await manager.invalidateByTags(lruTags);
        }
        break;

      case 'manual':
        // Manual invalidation is handled by the manual invalidation method
        break;

      default:
        throw new Error(`Unknown invalidation strategy: ${rule.strategy.type}`);
    }

    return totalInvalidated;
  }

  /**
   * Initialize default invalidation rules
   */
  private initializeDefaultRules(): void {
    // User-related invalidation rules
    this.addRule({
      pattern: 'user',
      strategy: {
        type: 'tag',
        tags: ['user', 'statistics', 'violations'],
      },
      priority: 100,
      description: 'Invalidate user-related cache on user data changes',
    });

    // Chat-related invalidation rules
    this.addRule({
      pattern: 'chat',
      strategy: {
        type: 'tag',
        tags: ['chat', 'statistics', 'violations'],
      },
      priority: 90,
      description: 'Invalidate chat-related cache on chat data changes',
    });

    // Violation-related invalidation rules
    this.addRule({
      pattern: 'violation',
      strategy: {
        type: 'tag',
        tags: ['violations', 'statistics'],
      },
      priority: 80,
      description: 'Invalidate violation and statistics cache on violation changes',
    });

    // Statistics invalidation rules
    this.addRule({
      pattern: 'statistics',
      strategy: {
        type: 'tag',
        tags: ['statistics'],
      },
      priority: 70,
      description: 'Invalidate statistics cache on statistics changes',
    });

    // Time-based cleanup rule
    this.addRule({
      pattern: /time_based/,
      strategy: {
        type: 'ttl',
        maxAge: 3600, // 1 hour
      },
      priority: 10,
      description: 'Time-based cache cleanup',
    });
  }
}

// Singleton instance
export const cacheInvalidationManager = new CacheInvalidationManager();