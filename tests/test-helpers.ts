/**
 * Test helpers for creating test objects
 */

import type { Violation, ViolationCount, UserViolationCount } from '../src/models/statistics';

/**
 * Create a test Violation object with all required fields
 */
export function createTestViolation(overrides: Partial<Violation> = {}): Violation {
  return {
    article: '282',
    subarticle: null,
    articleTitle: 'Возбуждение ненависти либо вражды',
    quote: 'Test quote',
    punishment: 'штраф до 300 тысяч рублей',
    severity: 5,
    confidence: 0.8,
    ...overrides
  };
}

/**
 * Create a test ViolationCount object with all required fields
 */
export function createTestViolationCount(overrides: Partial<ViolationCount> = {}): ViolationCount {
  return {
    article: '282',
    subarticle: null,
    articleTitle: 'Возбуждение ненависти либо вражды',
    punishment: 'штраф до 300 тысяч рублей',
    count: 1,
    averageSeverity: 5.0,
    ...overrides
  };
}

/**
 * Create a test UserViolationCount object with all required fields
 */
export function createTestUserViolationCount(overrides: Partial<UserViolationCount> = {}): UserViolationCount {
  return {
    userId: '12345',
    username: 'testuser',
    count: 1,
    averageSeverity: 5.0,
    riskLevel: 'medium',
    ...overrides
  };
}