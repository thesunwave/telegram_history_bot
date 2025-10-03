/**
 * Redis-like caching layer using Cloudflare KV storage
 */

import type { Env } from '../env';
import { performanceMonitor } from './performance-monitor';

export interface CacheEntry<T = unknown> {
  value: T;
  timestamp: number;
  ttl?: number;
  metadata?: {
    hits: number;
    lastAccessed: number;
    size?: number;
    tags?: string[];
  };
}

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for cache invalidation
  compress?: boolean; // Whether to compress large values
  namespace?: string; // Cache namespace
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
  totalSize: number;
  operations: {
    get: number;
    set: number;
    delete: number;
    clear: number;
  };
}

export interface CacheInvalidationStrategy {
  type: 'ttl' | 'lru' | 'tag' | 'manual';
  maxAge?: number;
  maxSize?: number;
  tags?: string[];
}

export class CacheManager {
  private env: Env;
  private namespace: string;
  private stats: CacheStats;
  private defaultTTL: number;
  private maxValueSize: number;

  constructor(
    env: Env,
    options: {
      namespace?: string;
      defaultTTL?: number;
      maxValueSize?: number;
    } = {}
  ) {
    this.env = env;
    this.namespace = options.namespace || 'cache';
    this.defaultTTL = options.defaultTTL || 3600; // 1 hour default
    this.maxValueSize = options.maxValueSize || 25 * 1024 * 1024; // 25MB KV limit

    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalKeys: 0,
      totalSize: 0,
      operations: {
        get: 0,
        set: 0,
        delete: 0,
        clear: 0,
      },
    };
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, options?: { updateStats?: boolean }): Promise<T | null> {
    const perfId = performanceMonitor.startOperation('Cache.get', {
      key: this.sanitizeKey(key),
      namespace: this.namespace,
    });

    try {
      const cacheKey = this.buildCacheKey(key);
      const cached = await this.env.HISTORY.get(cacheKey, 'json') as CacheEntry<T> | null;

      this.stats.operations.get++;

      if (!cached) {
        this.stats.misses++;
        this.updateHitRate();
        
        performanceMonitor.endOperation(perfId, {
          cacheHit: false,
          result: 'miss',
        });
        
        return null;
      }

      // Check TTL
      if (this.isExpired(cached)) {
        await this.delete(key, { updateStats: false });
        this.stats.misses++;
        this.updateHitRate();
        
        performanceMonitor.endOperation(perfId, {
          cacheHit: false,
          result: 'expired',
        });
        
        return null;
      }

      // Update access metadata
      if (cached.metadata) {
        cached.metadata.hits++;
        cached.metadata.lastAccessed = Date.now();
        
        // Update the cache entry with new metadata (fire and forget)
        this.env.HISTORY.put(cacheKey, JSON.stringify(cached), {
          expirationTtl: cached.ttl || this.defaultTTL,
        }).catch(() => {
          // Ignore metadata update errors
        });
      }

      this.stats.hits++;
      this.updateHitRate();

      performanceMonitor.endOperation(perfId, {
        cacheHit: true,
        result: 'hit',
        dataSize: cached.value ? JSON.stringify(cached.value).length : 0,
      });

      return cached.value;
    } catch (error: unknown) {
      this.stats.misses++;
      this.updateHitRate();
      
      performanceMonitor.endOperation(perfId, {
        cacheHit: false,
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<boolean> {
    const perfId = performanceMonitor.startOperation('Cache.set', {
      key: this.sanitizeKey(key),
      namespace: this.namespace,
      ttl: options.ttl,
      hasValue: value !== null && value !== undefined,
    });

    try {
      const cacheKey = this.buildCacheKey(key);
      const ttl = options.ttl || this.defaultTTL;
      
      const cacheEntry: CacheEntry<T> = {
        value,
        timestamp: Date.now(),
        ttl,
        metadata: {
          hits: 0,
          lastAccessed: Date.now(),
          size: JSON.stringify(value).length,
          tags: options.tags,
        },
      };

      const serialized = JSON.stringify(cacheEntry);
      
      // Check size limit
      if (serialized.length > this.maxValueSize) {
        console.warn(`Cache value too large: ${serialized.length} bytes (max: ${this.maxValueSize})`);
        
        performanceMonitor.endOperation(perfId, {
          result: 'size_limit_exceeded',
          dataSize: serialized.length,
        });
        
        return false;
      }

      await this.env.HISTORY.put(cacheKey, serialized, {
        expirationTtl: ttl,
      });

      this.stats.operations.set++;
      this.stats.totalSize += serialized.length;

      performanceMonitor.endOperation(perfId, {
        result: 'success',
        dataSize: serialized.length,
        ttl,
      });

      return true;
    } catch (error: unknown) {
      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async delete(key: string, options?: { updateStats?: boolean }): Promise<boolean> {
    const perfId = performanceMonitor.startOperation('Cache.delete', {
      key: this.sanitizeKey(key),
      namespace: this.namespace,
    });

    try {
      const cacheKey = this.buildCacheKey(key);
      await this.env.HISTORY.delete(cacheKey);

      if (options?.updateStats !== false) {
        this.stats.operations.delete++;
      }

      performanceMonitor.endOperation(perfId, {
        result: 'success',
      });

      return true;
    } catch (error: unknown) {
      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    const value = await this.get(key, { updateStats: false });
    return value !== null;
  }

  /**
   * Get multiple values from cache
   */
  async mget<T>(keys: string[]): Promise<Map<string, T | null>> {
    const perfId = performanceMonitor.startOperation('Cache.mget', {
      keyCount: keys.length,
      namespace: this.namespace,
    });

    const results = new Map<string, T | null>();
    
    try {
      const promises = keys.map(async (key) => {
        const value = await this.get<T>(key, { updateStats: false });
        return { key, value };
      });

      const resolved = await Promise.all(promises);
      
      for (const { key, value } of resolved) {
        results.set(key, value);
      }

      performanceMonitor.endOperation(perfId, {
        result: 'success',
        keysProcessed: keys.length,
        hits: Array.from(results.values()).filter(v => v !== null).length,
      });

      return results;
    } catch (error: unknown) {
      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      throw error;
    }
  }

  /**
   * Set multiple values in cache
   */
  async mset<T>(entries: Map<string, T>, options: CacheOptions = {}): Promise<boolean> {
    const perfId = performanceMonitor.startOperation('Cache.mset', {
      entryCount: entries.size,
      namespace: this.namespace,
    });

    try {
      const promises = Array.from(entries.entries()).map(([key, value]) =>
        this.set(key, value, options)
      );

      const results = await Promise.all(promises);
      const success = results.every(result => result);

      performanceMonitor.endOperation(perfId, {
        result: success ? 'success' : 'partial_failure',
        entriesProcessed: entries.size,
        successCount: results.filter(r => r).length,
      });

      return success;
    } catch (error: unknown) {
      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      throw error;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    const perfId = performanceMonitor.startOperation('Cache.invalidateByTags', {
      tagCount: tags.length,
      namespace: this.namespace,
    });

    try {
      let invalidatedCount = 0;
      const prefix = `${this.namespace}:`;
      
      // List all keys with our prefix
      const list = await this.env.HISTORY.list({ prefix });
      
      for (const key of list.keys) {
        try {
          const cached = await this.env.HISTORY.get(key.name, 'json') as CacheEntry | null;
          
          if (cached?.metadata?.tags) {
            const hasMatchingTag = tags.some(tag => cached.metadata!.tags!.includes(tag));
            
            if (hasMatchingTag) {
              await this.env.HISTORY.delete(key.name);
              invalidatedCount++;
            }
          }
        } catch (error: unknown) {
          console.warn(`Error checking cache entry ${key.name}:`, error);
        }
      }

      performanceMonitor.endOperation(perfId, {
        result: 'success',
        invalidatedCount,
        checkedKeys: list.keys.length,
      });

      return invalidatedCount;
    } catch (error: unknown) {
      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      throw error;
    }
  }

  /**
   * Clear all cache entries for this namespace
   */
  async clear(): Promise<number> {
    const perfId = performanceMonitor.startOperation('Cache.clear', {
      namespace: this.namespace,
    });

    try {
      let clearedCount = 0;
      const prefix = `${this.namespace}:`;
      
      const list = await this.env.HISTORY.list({ prefix });
      
      const deletePromises = list.keys.map(async (key) => {
        try {
          await this.env.HISTORY.delete(key.name);
          clearedCount++;
        } catch (error: unknown) {
          console.warn(`Error deleting cache entry ${key.name}:`, error);
        }
      });

      await Promise.all(deletePromises);

      this.stats.operations.clear++;
      this.stats.totalKeys = 0;
      this.stats.totalSize = 0;

      performanceMonitor.endOperation(perfId, {
        result: 'success',
        clearedCount,
      });

      return clearedCount;
    } catch (error: unknown) {
      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      hitRate: 0,
      totalKeys: 0,
      totalSize: 0,
      operations: {
        get: 0,
        set: 0,
        delete: 0,
        clear: 0,
      },
    };
  }

  /**
   * Get cache info for monitoring
   */
  async getCacheInfo(): Promise<{
    stats: CacheStats;
    keyCount: number;
    sampleKeys: string[];
  }> {
    const prefix = `${this.namespace}:`;
    const list = await this.env.HISTORY.list({ prefix, limit: 10 });
    
    return {
      stats: this.getStats(),
      keyCount: list.keys.length,
      sampleKeys: list.keys.map(k => k.name.replace(prefix, '')),
    };
  }

  /**
   * Warm cache with frequently accessed data
   */
  async warmCache<T>(
    dataLoader: () => Promise<Map<string, T>>,
    options: CacheOptions = {}
  ): Promise<number> {
    const perfId = performanceMonitor.startOperation('Cache.warmCache', {
      namespace: this.namespace,
    });

    try {
      const data = await dataLoader();
      const success = await this.mset(data, options);
      
      performanceMonitor.endOperation(perfId, {
        result: success ? 'success' : 'partial_failure',
        entriesWarmed: data.size,
      });

      return data.size;
    } catch (error: unknown) {
      performanceMonitor.endOperation(perfId, {
        result: 'error',
        errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      });
      
      throw error;
    }
  }

  /**
   * Build cache key with namespace
   */
  private buildCacheKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    if (!entry.ttl) return false;
    
    const age = (Date.now() - entry.timestamp) / 1000;
    return age > entry.ttl;
  }

  /**
   * Update hit rate statistics
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Sanitize key for logging (remove sensitive data)
   */
  private sanitizeKey(key: string): string {
    return key.replace(/\d{10,}/g, '[ID]').substring(0, 50);
  }
}