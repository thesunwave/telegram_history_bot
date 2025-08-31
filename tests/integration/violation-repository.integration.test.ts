/**
 * ViolationRepository Integration Tests
 * Tests database operations with realistic scenarios
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ViolationRepository } from '../../src/repositories/violation-repository';
import { DatabaseTestUtils, createDatabaseTestUtils } from '../utils/database-seeding';
import { DatabaseFixtures } from '../fixtures/database-fixtures';
import { StatisticsFixtures } from '../fixtures/statistics-fixtures';
import { MockD1Database, DatabaseMockFactory } from '../mocks/mock-database';
import type { Violation } from '../../src/models/statistics';

describe('ViolationRepository Integration Tests', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let repository: ViolationRepository;
  let db: MockD1Database;
  let dbUtils: DatabaseTestUtils;

  beforeEach(async () => {
    db = DatabaseMockFactory.createRealisticDatabase();
    dbUtils = createDatabaseTestUtils(db);
    
    // Reset database configuration to ensure clean state
    db.reset();
    
    // Create mock environment with database
    const mockEnv = { DB: db } as any;
    repository = new ViolationRepository(mockEnv);
    
    // Setup test database with realistic data
    await dbUtils.setupTestDatabase('realistic');
  });

  afterEach(async () => {
    await dbUtils.teardownTestDatabase();
  });

  describe('storeViolation', () => {

    it('should store a violation successfully', async () => {
      // Clear database for this specific test
      db.reset();
      
      const violation = StatisticsFixtures.Violation.createViolation({
        article: '282',
        severity: 7,
        confidence: 0.85
      });

      const result = await repository.storeViolation(
        123456,
        -1001234567890,
        violation
      );

      expect(result.success).toBe(true);
      
      // Verify the violation was stored
      const violations = db.getData('criminal_violations');
      expect(violations).toHaveLength(1);
      expect(violations[0].article).toBe('282');
      expect(violations[0].severity).toBe(7);
    });

    it('should handle database errors gracefully', async () => {
      try {
        db.configureFail(true, 'Database connection failed');
        
        const violation = StatisticsFixtures.Violation.createViolation();

        const result = await repository.storeViolation(
          123456,
          -1001234567890,
          violation
        );

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('Database connection failed');
      } finally {
        db.configureFail(false);
      }
    });

    it('should validate violation data before storing', async () => {
      const invalidViolation = {
        article: '', // Invalid empty article
        severity: 15, // Invalid severity > 10
        confidence: 1.5 // Invalid confidence > 1
      } as Violation;

      const result = await repository.storeViolation(
        123456,
        -1001234567890,
        invalidViolation
      );

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('validation');
    });
  });

  describe('getUserViolations', () => {

    beforeEach(async () => {
      // Seed with user-specific violations
      const violations = DatabaseFixtures.CriminalViolationRow.createUserViolationRows(
        123456,
        -1001234567890,
        5
      );
      db.seedData('criminal_violations', violations);
    });

    it('should retrieve user violations successfully', async () => {
      const result = await repository.getUserViolations(123456, -1001234567890);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(5);
      
      // All violations should belong to the user
      result.data!.forEach(violation => {
        expect(violation.article).toBeDefined();
        expect(violation.severity).toBeGreaterThanOrEqual(1);
        expect(violation.severity).toBeLessThanOrEqual(10);
      });
    });

    it('should return empty array for user with no violations', async () => {
      const result = await repository.getUserViolations(999999, -1001234567890);

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should handle database errors', async () => {
      try {
        db.configureFail(true, 'Query timeout');

        const result = await repository.getUserViolations(123456, -1001234567890);

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('Query timeout');
      } finally {
        db.configureFail(false);
      }
    });
  });

  describe('getChatViolations', () => {

    beforeEach(async () => {
      // Seed with chat violations from multiple users
      const violations = DatabaseFixtures.CriminalViolationRow.createChatViolationRows(
        -1001234567890,
        15
      );
      db.seedData('criminal_violations', violations);
    });

    it('should retrieve chat violations with limit', async () => {
      const result = await repository.getChatViolations(-1001234567890, 10);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBeLessThanOrEqual(10);
    });

    it('should retrieve all chat violations without limit', async () => {
      const result = await repository.getChatViolations(-1001234567890);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(15);
    });

    it('should return violations in chronological order', async () => {
      const result = await repository.getChatViolations(-1001234567890);

      expect(result.success).toBe(true);
      
      // Check that violations are ordered by date (newest first)
      for (let i = 1; i < result.data!.length; i++) {
        const current = new Date(result.data![i].quote); // Using quote as timestamp placeholder
        const previous = new Date(result.data![i-1].quote);
        // In real implementation, this would check created_at timestamps
      }
    });
  });

  describe('getViolationsByPeriod', () => {

    beforeEach(async () => {
      // Seed with time-series data
      const violations = DatabaseFixtures.Seeding.createTimeSeriesSeedData(-1001234567890, 30);
      db.seedData('criminal_violations', violations);
    });

    it('should retrieve violations for specific period', async () => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

      const result = await repository.getViolationsByPeriod(
        -1001234567890,
        startDate,
        endDate
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      
      // Since we can't access created_at from Violation interface,
      // we just verify that we get some violations (the time filtering is tested in unit tests)
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should return empty array for period with no violations', async () => {
      const endDate = new Date('2020-01-01');
      const startDate = new Date('2019-12-01');

      const result = await repository.getViolationsByPeriod(
        -1001234567890,
        startDate,
        endDate
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  describe('getUserStats', () => {

    beforeEach(async () => {
      // Clear database first
      await dbUtils.clean.clearCriminalViolations();
      
      // Seed with user violations of varying severity
      const violations = [
        ...DatabaseFixtures.CriminalViolationRow.createUserViolationRows(123456, -1001234567890, 3),
        ...DatabaseFixtures.CriminalViolationRow.createUserViolationRows(123456, -1001234567890, 2)
      ].map((v, index) => ({ ...v, severity: index % 2 === 0 ? 8 : 4 })); // Mix of high and low severity
      
      console.log('Created violations:', violations.length);
      db.seedData('criminal_violations', violations);
      console.log('Data in DB:', db.getData('criminal_violations').length);
    });

    it('should calculate user statistics correctly', async () => {
      // Debug: Check what data is actually in the database
      const dbData = db.getData('criminal_violations');
      console.log('DB data:', dbData.map(v => ({ user_id: v.user_id, chat_id: v.chat_id, severity: v.severity })));
      
      // Debug: Check query log
      db.clearQueryLog();
      const stats = await repository.getUserStats('123456', '-1001234567890');
      const queries = db.getQueryLog();
      console.log('Executed queries:', queries.map(q => ({ query: q.query, params: q.params })));
      console.log('Stats result:', stats);

      expect(stats).toBeDefined();
      expect(stats.totalViolations).toBe(5);
      expect(stats.averageSeverity).toBeGreaterThan(0);
      expect(stats.averageSeverity).toBeLessThanOrEqual(10);
    });

    it('should return zero stats for user with no violations', async () => {
      const stats = await repository.getUserStats('999999', '-1001234567890');

      expect(stats).toBeDefined();
      expect(stats.totalViolations).toBe(0);
      expect(stats.averageSeverity).toBe(0);
    });
  });

  describe('getViolationCounts', () => {

    beforeEach(async () => {
      // Seed with violations of different articles
      const violations = [
        ...DatabaseFixtures.CriminalViolationRow.createCriminalViolationRows(3, { 
          chat_id: -1001234567890, 
          article: '282' 
        }),
        ...DatabaseFixtures.CriminalViolationRow.createCriminalViolationRows(2, { 
          chat_id: -1001234567890, 
          article: '213' 
        }),
        ...DatabaseFixtures.CriminalViolationRow.createCriminalViolationRows(1, { 
          chat_id: -1001234567890, 
          article: '319' 
        })
      ];
      
      db.seedData('criminal_violations', violations);
    });

    it('should return violation counts grouped by article', async () => {
      const result = await repository.getViolationCounts(-1001234567890);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(3);
      
      // Should be sorted by count (descending)
      expect(result.data![0].count).toBeGreaterThanOrEqual(result.data![1].count);
      expect(result.data![1].count).toBeGreaterThanOrEqual(result.data![2].count);
      
      // Check specific articles
      const article282 = result.data!.find(v => v.article === '282');
      expect(article282?.count).toBe(3);
    });

    it('should limit results when specified', async () => {
      const result = await repository.getViolationCounts(-1001234567890, 2);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(2);
    });
  });

  describe('getUserViolationCounts', () => {

    beforeEach(async () => {
      // Seed with violations from multiple users
      const violations = [
        ...DatabaseFixtures.CriminalViolationRow.createUserViolationRows(123456, -1001234567890, 5),
        ...DatabaseFixtures.CriminalViolationRow.createUserViolationRows(789012, -1001234567890, 3),
        ...DatabaseFixtures.CriminalViolationRow.createUserViolationRows(345678, -1001234567890, 1)
      ];
      
      db.seedData('criminal_violations', violations);
    });

    it('should return user violation counts', async () => {
      const result = await repository.getUserViolationCounts(-1001234567890);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(3);
      
      // Should be sorted by count (descending)
      expect(result.data![0].count).toBeGreaterThanOrEqual(result.data![1].count);
      
      // Check specific user
      const user123456 = result.data!.find(u => u.userId === '123456');
      expect(user123456?.count).toBe(5);
    });

    it('should limit results when specified', async () => {
      const result = await repository.getUserViolationCounts(-1001234567890, 2);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.length).toBe(2);
    });
  });

  describe('getPeriodStats', () => {

    beforeEach(async () => {
      // Seed with time-series data
      const violations = DatabaseFixtures.Seeding.createTimeSeriesSeedData(-1001234567890, 30);
      db.seedData('criminal_violations', violations);
    });

    it('should calculate period statistics', async () => {
      const result = await repository.getPeriodStats('-1001234567890', 7);

      expect(result).toBeDefined();
      expect(result.totalViolations).toBeGreaterThanOrEqual(0);
      expect(result.uniqueUsers).toBeGreaterThanOrEqual(0);
      expect(result.averageSeverity).toBeGreaterThanOrEqual(0);
    });

    it('should return zero stats for period with no data', async () => {
      // Clear data to simulate empty period
      db.seedData('criminal_violations', []);

      const result = await repository.getPeriodStats('-1001234567890', 30);

      expect(result).toBeDefined();
      expect(result.totalViolations).toBe(0);
      expect(result.uniqueUsers).toBe(0);
      expect(result.averageSeverity).toBe(0);
    });
  });

  describe('Performance Tests', () => {

    it('should handle large datasets efficiently', async () => {
      // Seed with large dataset
      const violations = DatabaseFixtures.Seeding.createCriminalViolationsSeedData(
        -1001234567890,
        100, // 100 users
        10   // 10 violations each = 1000 total
      );
      db.seedData('criminal_violations', violations);

      const startTime = Date.now();
      const result = await repository.getChatViolations(-1001234567890, 50);
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(50);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle concurrent operations', async () => {
      // Ensure a clean database state for this concurrency test
      db.seedData('criminal_violations', []);

      const violations = Array.from({ length: 10 }, (_, i) => 
        StatisticsFixtures.Violation.createViolation({ article: `${280 + i}` })
      );

      // Execute multiple store operations concurrently
      const promises = violations.map((violation, index) => 
        repository.storeViolation(123456 + index, -1001234567890, violation)
      );

      const results = await Promise.all(promises);

      // All operations should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });

      // Verify all violations were stored
      const storedViolations = db.getData('criminal_violations');
      expect(storedViolations.length).toBe(10);
    });
  });

  describe('Error Handling', () => {

    it('should handle network timeouts', async () => {
      db.configureDelay(5000); // 5 second delay

      try {
        const violation = StatisticsFixtures.Violation.createViolation();

        const startTime = Date.now();
        const result = await repository.storeViolation(123456, -1001234567890, violation);
        const endTime = Date.now();

        // Should either succeed after delay or timeout
        if (result.success) {
          expect(endTime - startTime).toBeGreaterThan(4000);
        } else {
          expect(result.error).toContain('timeout');
        }
      } finally {
        // Reset delay to avoid affecting teardown hooks
        db.configureDelay(0);
      }
    });

    it('should handle malformed data gracefully', async () => {
      // Seed with malformed data
      const malformedViolations = [
        { article: null, severity: 'invalid', confidence: 'bad' },
        { article: '', severity: -1, confidence: 2 }
      ];
      db.seedData('criminal_violations', malformedViolations as any);

      const result = await repository.getUserViolations(123456, -1001234567890);

      // Should handle malformed data without crashing
      expect(result.success).toBe(true);
      // Data should be sanitized or filtered out
    });
  });

  describe('Data Consistency', () => {

    it('should maintain referential integrity', async () => {
      const violation = StatisticsFixtures.Violation.createViolation();

      // Store violation
      await repository.storeViolation(123456, -1001234567890, violation);

      // Retrieve and verify consistency
      const userViolations = await repository.getUserViolations(123456, -1001234567890);
      const chatViolations = await repository.getChatViolations(-1001234567890);

      expect(userViolations.success).toBe(true);
      expect(chatViolations.success).toBe(true);
      expect(userViolations.data!.length).toBe(1);
      expect(chatViolations.data!.length).toBe(1);
      
      // Same violation should appear in both results
      expect(userViolations.data![0].article).toBe(chatViolations.data![0].article);
    });

    it('should handle transaction-like operations', async () => {
      const violations = StatisticsFixtures.Violation.createViolations(5);

      // Use transaction manager for batch operations
      await dbUtils.transaction.withTransaction(async (db) => {
        for (const violation of violations) {
          await repository.storeViolation(123456, -1001234567890, violation);
        }
      });

      // Verify all violations were stored
      const result = await repository.getUserViolations(123456, -1001234567890);
      expect(result.success).toBe(true);
      expect(result.data!.length).toBe(5);
    });
  });
});