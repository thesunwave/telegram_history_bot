/**
 * Cache service for managing application-level caching
 */

import { BaseService } from './base-service';
import { CacheManager, CacheOptions, CacheStats } from '../utils/cache-manager';
import type { Env } from '../env';

export interface CacheServiceConfig {
  defaultTTL: number;
  maxValueSize: number;
  enableMetrics: boolean;
  warmupOnStart: boolean;
  namespaces: {
    violations: string;
    statistics: string;
    users: string;
    general: string;
  };
}

export interface CacheKey {
  violations: {
    user: (userId: string, chatId: string) => string;
    period: (chatId: string, days: number) => string;
    all: (chatId: string) => string;
  };
  statistics: {
    user: (userId: string, chatId: string) => string;
    period: (chatId: string, days: number) => string;
    general: (chatId: string) => string;
  };
  users: {
    profile: (userId: string) => string;
    settings: (userId: string) => string;
  };
}

export class CacheService extends BaseService {
  private config: CacheServiceConfig;
  private cacheManagers: Map<string, CacheManager> = new Map();
  
  // Cache key builders
  public readonly keys: CacheKey = {
    violations: {
      user: (userId: string, chatId: string) => `violations:user:${userId}:chat:${chatId}`,
      period: (chatId: string, days: number) => `violations:period:${chatId}:days:${days}`,
      all: (chatId: string) => `violations:all:${chatId}`,
    },
    statistics: {
      user: (userId: string, chatId: string) => `statistics:user:${userId}:chat:${chatId}`,
      period: (chatId: string, days: number) => `statistics:period:${chatId}:days:${days}`,
      general: (chatId: string) => `statistics:general:${chatId}`,
    },
    users: {
      profile: (userId: string) => `user:profile:${userId}`,
      settings: (userId: string) => `user:settings:${userId}`,
    },
  };

  constructor(env: Env, config?: Partial<CacheServiceConfig>) {
    super(env);
    
    this.config = {
      defaultTTL: config?.defaultTTL ?? 3600, // 1 hour
      maxValueSize: config?.maxValueSize ?? 25 * 1024 * 1024, // 25MB
      enableMetrics: config?.enableMetrics ?? true,
      warmupOnStart: config?.warmupOnStart ?? false,
      namespaces: {
        violations: config?.namespaces?.violations ?? 'violations',
        statistics: config?.namespaces?.statistics ?? 'statistics',
        users: config?.namespaces?.users ?? 'users',
        general: config?.namespaces?.general ?? 'general',
      },
    };

    this.initializeCacheManagers();
  }

  /**
   * Get cache manager for a specific namespace
   */
  getCache(namespace: keyof CacheServiceConfig['namespaces']): CacheManager {
    const manager = this.cacheManagers.get(namespace);
    if (!manager) {
      throw new Error(`Cache manager not found for namespace: ${namespace}`);
    }
    return manager;
  }

  /**
   * Cache violation data
   */
  async cacheViolations<T>(
    key: string,
    data: T,
    options?: CacheOptions
  ): Promise<boolean> {
    const cache = this.getCache('violations');
    return cache.set(key, data, {
      ttl: options?.ttl ?? this.config.defaultTTL,
      tags: ['violations', ...(options?.tags ?? [])],
      ...options,
    });
  }

  /**
   * Get cached violation data
   */
  async getCachedViolations<T>(key: string): Promise<T | null> {
    const cache = this.getCache('violations');
    return cache.get<T>(key);
  }

  /**
   * Cache statistics data
   */
  async cacheStatistics<T>(
    key: string,
    data: T,
    options?: CacheOptions
  ): Promise<boolean> {
    const cache = this.getCache('statistics');
    return cache.set(key, data, {
      ttl: options?.ttl ?? this.config.defaultTTL,
      tags: ['statistics', ...(options?.tags ?? [])],
      ...options,
    });
  }

  /**
   * Get cached statistics data
   */
  async getCachedStatistics<T>(key: string): Promise<T | null> {
    const cache = this.getCache('statistics');
    return cache.get<T>(key);
  }

  /**
   * Cache user data
   */
  async cacheUser<T>(
    key: string,
    data: T,
    options?: CacheOptions
  ): Promise<boolean> {
    const cache = this.getCache('users');
    return cache.set(key, data, {
      ttl: options?.ttl ?? this.config.defaultTTL * 2, // Users cache longer
      tags: ['users', ...(options?.tags ?? [])],
      ...options,
    });
  }

  /**
   * Get cached user data
   */
  async getCachedUser<T>(key: string): Promise<T | null> {
    const cache = this.getCache('users');
    return cache.get<T>(key);
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[], namespace?: keyof CacheServiceConfig['namespaces']): Promise<number> {
    if (namespace) {
      const cache = this.getCache(namespace);
      return cache.invalidateByTags(tags);
    }

    // Invalidate across all namespaces
    let totalInvalidated = 0;
    for (const cache of this.cacheManagers.values()) {
      totalInvalidated += await cache.invalidateByTags(tags);
    }
    return totalInvalidated;
  }

  /**
   * Invalidate user-related cache
   */
  async invalidateUser(userId: string, chatId?: string): Promise<number> {
    const tags = chatId ? [`user:${userId}`, `chat:${chatId}`] : [`user:${userId}`];
    return this.invalidateByTags(tags);
  }

  /**
   * Invalidate chat-related cache
   */
  async invalidateChat(chatId: string): Promise<number> {
    return this.invalidateByTags([`chat:${chatId}`]);
  }

  /**
   * Get cache statistics for all namespaces
   */
  getCacheStats(): Record<string, CacheStats> {
    const stats: Record<string, CacheStats> = {};
    
    for (const [namespace, cache] of this.cacheManagers.entries()) {
      stats[namespace] = cache.getStats();
    }
    
    return stats;
  }

  /**
   * Get comprehensive cache information
   */
  async getCacheInfo(): Promise<{
    config: CacheServiceConfig;
    stats: Record<string, CacheStats>;
    details: Record<string, {
      keyCount: number;
      sampleKeys: string[];
    }>;
  }> {
    const stats = this.getCacheStats();
    const details: Record<string, { keyCount: number; sampleKeys: string[] }> = {};
    
    for (const [namespace, cache] of this.cacheManagers.entries()) {
      const info = await cache.getCacheInfo();
      details[namespace] = {
        keyCount: info.keyCount,
        sampleKeys: info.sampleKeys,
      };
    }
    
    return {
      config: this.config,
      stats,
      details,
    };
  }

  /**
   * Warm up caches with frequently accessed data
   */
  async warmupCaches(): Promise<{
    violations: number;
    statistics: number;
    users: number;
  }> {
    const results = {
      violations: 0,
      statistics: 0,
      users: 0,
    };

    try {
      // Warm up violations cache with recent data
      const violationsCache = this.getCache('violations');
      results.violations = await violationsCache.warmCache(
        async () => {
          // This would typically load frequently accessed violations
          // For now, return empty map as we don't have access to repository here
          return new Map();
        },
        { ttl: this.config.defaultTTL }
      );

      // Warm up statistics cache
      const statisticsCache = this.getCache('statistics');
      results.statistics = await statisticsCache.warmCache(
        async () => {
          // This would typically load frequently accessed statistics
          return new Map();
        },
        { ttl: this.config.defaultTTL }
      );

      // Warm up users cache
      const usersCache = this.getCache('users');
      results.users = await usersCache.warmCache(
        async () => {
          // This would typically load frequently accessed user data
          return new Map();
        },
        { ttl: this.config.defaultTTL * 2 }
      );

    } catch (error: unknown) {
      console.error('Cache warmup error:', error);
    }

    return results;
  }

  /**
   * Clear all caches
   */
  async clearAllCaches(): Promise<Record<string, number>> {
    const results: Record<string, number> = {};
    
    for (const [namespace, cache] of this.cacheManagers.entries()) {
      try {
        results[namespace] = await cache.clear();
      } catch (error: unknown) {
        console.error(`Error clearing cache ${namespace}:`, error);
        results[namespace] = 0;
      }
    }
    
    return results;
  }

  /**
   * Reset all cache statistics
   */
  resetAllStats(): void {
    for (const cache of this.cacheManagers.values()) {
      cache.resetStats();
    }
  }

  /**
   * Check cache health
   */
  async checkHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    issues: string[];
    stats: Record<string, CacheStats>;
  }> {
    const stats = this.getCacheStats();
    const issues: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check hit rates
    for (const [namespace, stat] of Object.entries(stats)) {
      if (stat.hitRate < 0.5 && stat.hits + stat.misses > 100) {
        issues.push(`Low hit rate in ${namespace}: ${(stat.hitRate * 100).toFixed(1)}%`);
        status = 'degraded';
      }
    }

    // Check for excessive operations without hits
    for (const [namespace, stat] of Object.entries(stats)) {
      if (stat.operations.get > 1000 && stat.hits === 0) {
        issues.push(`No cache hits in ${namespace} despite ${stat.operations.get} get operations`);
        status = 'unhealthy';
      }
    }

    return {
      status,
      issues,
      stats,
    };
  }

  async initialize(): Promise<void> {
    console.log('CacheService initialized with namespaces:', Object.keys(this.config.namespaces));
    
    if (this.config.warmupOnStart) {
      console.log('Starting cache warmup...');
      const results = await this.warmupCaches();
      console.log('Cache warmup completed:', results);
    }
  }

  async cleanup(): Promise<void> {
    console.log('CacheService cleanup completed');
  }

  /**
   * Initialize cache managers for each namespace
   */
  private initializeCacheManagers(): void {
    for (const [key, namespace] of Object.entries(this.config.namespaces)) {
      const manager = new CacheManager(this.env, {
        namespace,
        defaultTTL: this.config.defaultTTL,
        maxValueSize: this.config.maxValueSize,
      });
      
      this.cacheManagers.set(key, manager);
    }
  }
}