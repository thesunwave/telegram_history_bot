import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CacheService } from '../../src/services/cache-service';
import { CacheManager } from '../../src/utils/cache-manager';
import { CacheInvalidationManager } from '../../src/utils/cache-invalidation';
import { MockEnvironmentFactory } from '../mocks/mock-environment';
import type { Env } from '../../src/types/environment';

const testTimeout = 10000;

describe('CacheService', () => {

  let cacheService: CacheService;
  let env: Env;

  beforeEach(() => {
    env = MockEnvironmentFactory.createBasicEnvironment();
    cacheService = new CacheService(env, {
      enableMetrics: true,
      warmupOnStart: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe('Initialization', () => {

    it('should initialize cache service', async () => {
      await cacheService.initialize();
      expect(cacheService).toBeDefined();
    }, testTimeout);

    it('should cleanup cache service', async () => {
      await cacheService.initialize();
      await cacheService.cleanup();
      expect(cacheService).toBeDefined();
    }, testTimeout);
  });

  describe('Cache Keys', () => {

    it('should generate user profile keys', () => {
      const key = cacheService.keys.users.profile('123');
      expect(key).toContain('user');
      expect(key).toContain('123');
    }, testTimeout);

    it('should generate violation keys', () => {
      const key = cacheService.keys.violations.user('123', '456');
      expect(key).toContain('violations');
      expect(key).toContain('123');
      expect(key).toContain('456');
    }, testTimeout);

    it('should generate statistics keys', () => {
      const key = cacheService.keys.statistics.user('123', '456');
      expect(key).toContain('statistics');
      expect(key).toContain('123');
      expect(key).toContain('456');
    }, testTimeout);
  });

  describe('Cache Operations', () => {

    beforeEach(async () => {
      await cacheService.initialize();
    });

    afterEach(async () => {
      await cacheService.cleanup();
    });

    it('should cache and retrieve user data', async () => {
      const key = cacheService.keys.users.profile('123');
      const userData = {
        name: 'Test User',
        id: '123',
      };

      const setResult = await cacheService.cacheUser(key, userData);
      expect(setResult).toBe(true);

      const cachedData = await cacheService.getCachedUser(key);
      expect(cachedData).toEqual(userData);
    }, testTimeout);

    it('should cache and retrieve violations data', async () => {
      const key = cacheService.keys.violations.user('123', '456');
      const violationData = {
        article: '123',
        quote: 'test quote',
        severity: 5,
      };

      const setResult = await cacheService.cacheViolations(key, violationData);
      expect(setResult).toBe(true);

      const cachedData = await cacheService.getCachedViolations(key);
      expect(cachedData).toEqual(violationData);
    }, testTimeout);

    it('should cache and retrieve statistics data', async () => {
      const key = cacheService.keys.statistics.user('123', '456');
      const statsData = {
        totalViolations: 10,
        averageSeverity: 4.5,
      };

      const setResult = await cacheService.cacheStatistics(key, statsData);
      expect(setResult).toBe(true);

      const cachedData = await cacheService.getCachedStatistics(key);
      expect(cachedData).toEqual(statsData);
    }, testTimeout);

    it('should invalidate cache by user', async () => {
      const userId = '123';
      const chatId = '456';

      // Cache some user data
      await cacheService.cacheUser(
        cacheService.keys.users.profile(userId),
        { name: 'Test User' },
        { tags: [`user:${userId}`] }
      );

      await cacheService.cacheViolations(
        cacheService.keys.violations.user(userId, chatId),
        { violations: [] },
        { tags: [`user:${userId}`, `chat:${chatId}`] }
      );

      // Invalidate user cache
      const invalidatedCount = await cacheService.invalidateUser(userId, chatId);
      expect(invalidatedCount).toBeGreaterThan(0);
    }, testTimeout);
  });

  describe('Cache Health Monitoring', () => {

    it('should check cache health', async () => {
      // Generate some cache activity
      await cacheService.cacheViolations('test_key', { data: 'test' });
      await cacheService.getCachedViolations('test_key'); // Hit
      await cacheService.getCachedViolations('nonexistent'); // Miss

      const health = await cacheService.checkHealth();
      expect(health.status).toMatch(/healthy|degraded|unhealthy/);
      expect(Array.isArray(health.issues)).toBe(true);
      expect(health.stats).toBeDefined();
    }, testTimeout);

    it('should get comprehensive cache info', async () => {
      const info = await cacheService.getCacheInfo();

      expect(info.config).toBeDefined();
      expect(info.stats).toBeDefined();
      expect(info.details).toBeDefined();
      expect(Object.keys(info.stats)).toContain('violations');
      expect(Object.keys(info.stats)).toContain('statistics');
      expect(Object.keys(info.stats)).toContain('users');
    }, testTimeout);
  });
});

describe('CacheInvalidationManager', () => {

  let invalidationManager: CacheInvalidationManager;
  let env: Env;
  let cacheManager: CacheManager;

  beforeEach(() => {
    env = MockEnvironmentFactory.createBasicEnvironment();
    cacheManager = new CacheManager(env, { namespace: 'test_invalidation' });
    invalidationManager = new CacheInvalidationManager();
    invalidationManager.registerCacheManager('test', cacheManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.clearAllTimers();
  });

  describe('Invalidation Rules', () => {

    it('should process invalidation events', async () => {
      // Set up test data
      await cacheManager.set('user_123_data', 'user_data', { tags: ['user', 'user:123'] });
      await cacheManager.set('chat_456_data', 'chat_data', { tags: ['chat', 'chat:456'] });

      // Process user invalidation event
      const result = await invalidationManager.invalidateEntity('user', '123');

      expect(result.keysInvalidated).toBeGreaterThan(0);
      expect(result.strategiesApplied.length).toBeGreaterThan(0);
      expect(result.errors.length).toBe(0);
    }, testTimeout);

    it('should handle user action invalidation', async () => {
      const result = await invalidationManager.invalidateByUserAction(
        '123',
        'violation_added',
        '456',
        { severity: 5 }
      );

      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    }, testTimeout);

    it('should perform time-based invalidation', async () => {
      const result = await invalidationManager.performTimeBasedInvalidation();

      expect(result).toBeDefined();
      expect(result.strategiesApplied).toContain('ttl');
    }, testTimeout);

    it('should handle manual invalidation', async () => {
      // Set up test data with tags
      await cacheManager.set('manual_test', 'data', { tags: ['manual_tag'] });

      const result = await invalidationManager.manualInvalidation('manual_tag', ['test']);

      expect(result.keysInvalidated).toBeGreaterThanOrEqual(0);
      expect(result.strategiesApplied).toContain('manual');
    }, testTimeout);
  });

  describe('Invalidation Statistics', () => {

    it('should provide invalidation statistics', () => {
      const stats = invalidationManager.getInvalidationStats();

      expect(stats.rulesCount).toBeGreaterThan(0);
      expect(stats.managersCount).toBe(1);
      expect(Array.isArray(stats.rules)).toBe(true);
    }, testTimeout);
  });
});

describe('Integration Tests', () => {

  it('should work together across all caching components', async () => {
    const env = MockEnvironmentFactory.createBasicEnvironment();
    const cacheService = new CacheService(env, {
      enableMetrics: true,
      warmupOnStart: false,
    });

    await cacheService.initialize();

    // Test caching workflow
    const userId = '123';
    const chatId = '456';
    const violationData = {
      article: '123',
      quote: 'test violation',
      severity: 7,
    };

    // Cache violation data
    const violationKey = cacheService.keys.violations.user(userId, chatId);
    await cacheService.cacheViolations(violationKey, violationData, {
      tags: [`user:${userId}`, `chat:${chatId}`, 'violations'],
    });

    // Verify cached data
    const cachedViolation = await cacheService.getCachedViolations(violationKey);
    expect(cachedViolation).toEqual(violationData);

    // Test invalidation
    const invalidatedCount = await cacheService.invalidateUser(userId, chatId);
    expect(invalidatedCount).toBeGreaterThanOrEqual(0);

    // Check cache health
    const health = await cacheService.checkHealth();
    expect(health.status).toMatch(/healthy|degraded|unhealthy/);

    // Get comprehensive info
    const info = await cacheService.getCacheInfo();
    expect(info.stats).toBeDefined();
    expect(info.details).toBeDefined();

    await cacheService.cleanup();
  });
});
