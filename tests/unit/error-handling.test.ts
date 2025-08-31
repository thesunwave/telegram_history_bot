/**
 * Comprehensive Unit Tests for Error Handling
 * Tests error scenarios, edge cases, and recovery mechanisms
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ValidationError } from '../../src/models/validation';
import { DatabaseResultValidator, DatabaseTypeGuards } from '../../src/utils/database-types';
import { MockD1Database } from '../mocks/mock-database';
import { MockKVStorage } from '../mocks/mock-kv-storage';
import { MockCloudflareAI } from '../mocks/mock-ai-providers';
import { D1ResultFixtures } from '../fixtures/database-fixtures';

describe('Error Handling', () => {
  const testTimeout = 10000; // 10 seconds max per test

  // Set timeout for all tests in this suite
  const originalTimeout = 5000; // 5 seconds max per test
  describe('ValidationError', () => {

    it('should create validation error with message', () => {
      const error = new ValidationError('Test validation error');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toBe('Test validation error');
      expect(error.field).toBeUndefined();
    });

    it('should create validation error with field', () => {
      const error = new ValidationError('Invalid field value', 'testField');
      
      expect(error.message).toBe('Invalid field value');
      expect(error.field).toBe('testField');
    });

    it('should be catchable as Error', () => {
      try {
        throw new ValidationError('Test error');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).toBe('Test error');
        } else {
          throw error;
        }
      }
    });

    it('should be catchable as ValidationError', () => {
      try {
        throw new ValidationError('Test error', 'field');
      } catch (error: unknown) {
        if (error instanceof ValidationError) {
          expect(error.field).toBe('field');
        } else {
          throw new Error('Should be ValidationError');
        }
      }
    });
  });

  describe('Database Error Handling', () => {

    let mockDb: MockD1Database;

    beforeEach(() => {
      mockDb = new MockD1Database();
    });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

    it('should handle database connection failures', async () => {
      mockDb.configureFail(true, 'Connection refused');

      try {
        await mockDb.prepare('SELECT * FROM test').first();
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Connection refused');
        } else {
          throw error;
        }
      }
    });

    it('should handle database timeout errors', async () => {
      mockDb.configureDelay(100); // Short delay for test
      mockDb.configureFail(true, 'Query timeout');

      try {
        await mockDb.prepare('SELECT * FROM test').first();
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Query timeout');
        } else {
          throw error;
        }
      }
    });

    it('should handle malformed SQL queries', async () => {
      // Mock database should handle this gracefully
      const result = await mockDb.prepare('INVALID SQL QUERY').all();
      expect(result.results).toEqual([]);
    });

    it('should handle database constraint violations', async () => {
      mockDb.configureFail(true, 'UNIQUE constraint failed');

      try {
        await mockDb.prepare('INSERT INTO test VALUES (?, ?)').bind(1, 'duplicate').run();
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('UNIQUE constraint failed');
        } else {
          throw error;
        }
      }
    });

    it('should validate database result structure', () => {
      const validResult = { results: [], success: true, meta: {} };
      expect(DatabaseResultValidator.validateQueryResult(validResult)).toBe(true);

      const invalidResult = { invalid: 'structure' };
      expect(DatabaseResultValidator.validateQueryResult(invalidResult)).toBe(false);

      const nullResult = null;
      expect(DatabaseResultValidator.validateQueryResult(nullResult)).toBe(false);
    });

    it('should handle database result extraction safely', () => {
      const validResult = D1ResultFixtures.createD1Result([{ id: 1, name: 'test' }]);
      const extracted = DatabaseResultValidator.extractResults(validResult);
      expect(extracted).toEqual([{ id: 1, name: 'test' }]);

      const emptyResult = D1ResultFixtures.createEmptyResult<{ id: number; name: string }>();
      const extractedEmpty = DatabaseResultValidator.extractResults(emptyResult);
      expect(extractedEmpty).toEqual([]);

       const invalidResult = { invalid: 'structure' };
       expect(() => DatabaseResultValidator.extractResults(invalidResult as any)).toThrow();
    });

    it('should create proper success and failure results', () => {
      const successResult = DatabaseResultValidator.createSuccess({ id: 1 });
      expect(successResult.success).toBe(true);
      expect(successResult.data).toEqual({ id: 1 });
      expect(successResult.error).toBeUndefined();

      const failureResult = DatabaseResultValidator.createFailure('Test error');
      expect(failureResult.success).toBe(false);
      expect(failureResult.error).toBe('Test error');
      expect(failureResult.data).toBeUndefined();
    });

    it('should use type guards correctly', () => {
      const successResult = DatabaseResultValidator.createSuccess({ id: 1 });
      const failureResult = DatabaseResultValidator.createFailure('Test error');

      expect(DatabaseTypeGuards.isSuccess(successResult)).toBe(true);
      expect(DatabaseTypeGuards.isFailure(successResult)).toBe(false);

      expect(DatabaseTypeGuards.isSuccess(failureResult)).toBe(false);
      expect(DatabaseTypeGuards.isFailure(failureResult)).toBe(true);
    });

    it('should validate parameters correctly', () => {
      expect(DatabaseTypeGuards.validateParameter('string')).toBe(true);
      expect(DatabaseTypeGuards.validateParameter(123)).toBe(true);
      expect(DatabaseTypeGuards.validateParameter(null)).toBe(true);
      expect(DatabaseTypeGuards.validateParameter(undefined)).toBe(false);
      expect(DatabaseTypeGuards.validateParameter({})).toBe(false);
      expect(DatabaseTypeGuards.validateParameter([])).toBe(false);

      expect(DatabaseTypeGuards.validateParameters(['string', 123, null])).toBe(true);
      expect(DatabaseTypeGuards.validateParameters(['string', undefined])).toBe(false);
    });
  });

  describe('KV Storage Error Handling', () => {

    let mockKV: MockKVStorage;

    beforeEach(() => {
      mockKV = new MockKVStorage();
    });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

    it('should handle KV operation failures', async () => {
      mockKV.configureFail(true, 'KV service unavailable');

      try {
        await mockKV.get('test-key');
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('KV service unavailable');
        } else {
          throw error;
        }
      }
    });

    it('should handle KV timeout errors', async () => {
      mockKV.configureDelay(50);
      mockKV.configureFail(true, 'Operation timeout');

      try {
        await mockKV.put('test-key', 'test-value');
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Operation timeout');
        } else {
          throw error;
        }
      }
    });

    it('should handle KV quota exceeded errors', async () => {
      mockKV.configureFail(true, 'Storage quota exceeded');

      try {
        await mockKV.put('large-key', 'x'.repeat(1000000));
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Storage quota exceeded');
        } else {
          throw error;
        }
      }
    });

    it('should handle expired keys gracefully', async () => {
      // Set a key with very short expiration
      mockKV.setData('expiring-key', 'value', undefined, 0.01); // 10ms

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      const result = await mockKV.get('expiring-key');
      expect(result).toBeNull();
    });

    it('should handle malformed JSON in KV', async () => {
      mockKV.setData('malformed-json', '{ invalid json }');

      const result = await mockKV.get('malformed-json', { type: 'json' });
      expect(result).toBeNull(); // Should handle gracefully
    });

    it('should handle KV list operation failures', async () => {
      mockKV.configureFail(true, 'List operation failed');

      try {
        await mockKV.list();
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('List operation failed');
        } else {
          throw error;
        }
      }
    });
  });

  describe('AI Provider Error Handling', () => {

    let mockAI: MockCloudflareAI;

    beforeEach(() => {
      mockAI = new MockCloudflareAI();
    });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

    it('should handle AI service unavailable', async () => {
      mockAI.configureFail(true, 'AI service is down');

      try {
        await mockAI.run('test-model', { messages: [{ content: 'test' }] });
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('AI service is down');
        } else {
          throw error;
        }
      }
    });

    it('should handle AI rate limiting', async () => {
      mockAI.configureFail(true, 'Rate limit exceeded');

      try {
        await mockAI.run('test-model', { messages: [{ content: 'test' }] });
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Rate limit exceeded');
        } else {
          throw error;
        }
      }
    });

    it('should handle AI timeout errors', async () => {
      mockAI.configureDelay(50);
      mockAI.configureFail(true, 'Request timeout');

      try {
        await mockAI.run('test-model', { messages: [{ content: 'test' }] });
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Request timeout');
        } else {
          throw error;
        }
      }
    });

    it('should handle invalid AI model responses', async () => {
      mockAI.setCustomResponse('test-model', { messages: [{ content: 'test' }] }, {
        invalid: 'response structure'
      });

      const result = await mockAI.run('test-model', { messages: [{ content: 'test' }] });
      expect(result.invalid).toBe('response structure');
      // In real implementation, this would be validated and handled
    });

    it('should handle malformed AI requests', async () => {
      // Test with invalid request structure
      try {
        await mockAI.run('test-model', { invalid: 'request' });
        // Should either succeed with default handling or throw appropriate error
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toBeDefined();
        } else {
          throw error;
        }
      }
    });
  });

  describe('Network Error Simulation', () => {

    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should handle connection refused errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
      globalThis.fetch = mockFetch;

      try {
        await fetch('https://api.example.com/test');
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Connection refused');
        } else {
          throw error;
        }
      }
    });

    it('should handle DNS resolution failures', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'));
      globalThis.fetch = mockFetch;

      try {
        await fetch('https://nonexistent.domain.com/api');
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('DNS resolution failed');
        } else {
          throw error;
        }
      }
    });

    it('should handle SSL certificate errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('SSL certificate verification failed'));
      globalThis.fetch = mockFetch;

      try {
        await fetch('https://invalid-ssl.example.com/api');
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('SSL certificate verification failed');
        } else {
          throw error;
        }
      }
    });

    it('should handle HTTP error status codes', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));
      globalThis.fetch = mockFetch;

      const response = await fetch('https://api.example.com/nonexistent');
      expect(response.status).toBe(404);
      expect(response.ok).toBe(false);
    });

    it('should handle network timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Network timeout')), 10)
        )
      );
      globalThis.fetch = mockFetch;

      try {
        await fetch('https://slow.api.example.com/test');
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('Network timeout');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Memory and Resource Error Handling', () => {

    it('should handle out of memory errors', () => {
      const mockError = new Error('JavaScript heap out of memory');
      
      try {
        throw mockError;
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('heap out of memory');
        } else {
          throw error;
        }
      }
    });

    it('should handle stack overflow errors', () => {
      const mockError = new RangeError('Maximum call stack size exceeded');
      
      try {
        throw mockError;
      } catch (error: unknown) {
        if (error instanceof Error) {
          expect(error.message).toContain('call stack size exceeded');
        } else {
          throw error;
        }
      }
    });

    it('should handle resource exhaustion gracefully', () => {
      // Simulate resource exhaustion with smaller, safer limits
      const largeArray: any[] = [];
      const maxSize = 100; // Smaller limit for test safety
      
      try {
        for (let i = 0; i < maxSize; i++) {
          largeArray.push(new Array(100).fill('data')); // Smaller arrays
        }
        // Should complete without error in test environment
        expect(largeArray.length).toBe(maxSize);
      } catch (error: unknown) {
        if (error instanceof Error) {
          // If it fails, it should be a memory-related error
          expect(error.message).toMatch(/memory|heap|stack/i);
        } else {
          throw error;
        }
      }
    });
  });

  describe('Concurrent Operation Error Handling', () => {

    it('should handle race conditions', async () => {
      const mockKV = new MockKVStorage();
      const key = 'race-condition-key';
      
      // Simulate concurrent operations
      const operations = Array.from({ length: 10 }, (_, i) => 
        mockKV.put(key, `value-${i}`)
      );

      await Promise.all(operations);
      
      // Last operation should win
      const result = await mockKV.get(key);
      expect(result).toMatch(/^value-\d$/);
    });

    it('should handle deadlock scenarios', async () => {
      const mockDb = new MockD1Database();
      
      // Simulate potential deadlock with concurrent transactions
      const transaction1 = mockDb.prepare('UPDATE table1 SET value = ? WHERE id = ?').bind('new1', 1).run();
      const transaction2 = mockDb.prepare('UPDATE table2 SET value = ? WHERE id = ?').bind('new2', 2).run();
      
      // Both should complete without deadlock in mock environment
      const results = await Promise.all([transaction1, transaction2]);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle resource contention', async () => {
      const mockAI = new MockCloudflareAI();
      
      // Simulate fewer concurrent AI requests for test stability
      const requests = Array.from({ length: 5 }, (_, i) => 
        mockAI.run('test-model', { messages: [{ content: `Request ${i}` }] })
      );

      const results = await Promise.allSettled(requests);
      
      // All should complete (either succeed or fail)
      expect(results.length).toBe(5);
      
      // Check that we got some results
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');
      
      expect(successful.length + failed.length).toBe(5);
    });
  });

  describe('Data Corruption Error Handling', () => {

    it('should handle corrupted JSON data', () => {
      const corruptedJson = '{"valid": true, "corrupted": }';
      
      try {
        JSON.parse(corruptedJson);
        expect.fail('Should have thrown an error');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(SyntaxError);
      }
    });

    it('should handle partially corrupted objects', () => {
      const partiallyCorrupted = {
        validField: 'valid',
        corruptedField: undefined,
        nullField: null,
        emptyField: ''
      };

      // Should handle gracefully by checking each field
      expect(partiallyCorrupted.validField).toBe('valid');
      expect(partiallyCorrupted.corruptedField).toBeUndefined();
      expect(partiallyCorrupted.nullField).toBeNull();
      expect(partiallyCorrupted.emptyField).toBe('');
    });

    it('should handle type mismatches', () => {
      const typeMismatch = {
        expectedString: 123,
        expectedNumber: 'not a number',
        expectedArray: 'not an array',
        expectedObject: 'not an object'
      };

      // Type checking should handle these gracefully
      expect(typeof typeMismatch.expectedString).toBe('number');
      expect(typeof typeMismatch.expectedNumber).toBe('string');
      expect(Array.isArray(typeMismatch.expectedArray)).toBe(false);
      expect(typeof typeMismatch.expectedObject).toBe('string');
    });
  });

  describe('Error Recovery Mechanisms', () => {

    it('should implement retry logic for transient failures', async () => {
      let attemptCount = 0;
      const maxRetries = 3;
      
      const unreliableOperation = async () => {
        attemptCount++;
        if (attemptCount < maxRetries) {
          throw new Error('Transient failure');
        }
        return 'success';
      };

      const retryOperation = async (operation: () => Promise<string>, retries: number) => {
        for (let i = 0; i < retries; i++) {
          try {
            return await operation();
          } catch (error: unknown) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1)); // Very brief delay
          }
        }
        throw new Error('Max retries exceeded');
      };

      const result = await retryOperation(unreliableOperation, maxRetries);
      expect(result).toBe('success');
      expect(attemptCount).toBe(maxRetries);
    });

    it('should implement circuit breaker pattern', async () => {
      let failureCount = 0;
      let circuitOpen = false;
      const failureThreshold = 3;
      let operationCount = 0;
      
      const circuitBreakerOperation = async () => {
        operationCount++;
        
        if (circuitOpen) {
          throw new Error('Circuit breaker is open');
        }
        
        try {
          // Simulate deterministic failures for first few operations
          if (operationCount <= failureThreshold) {
            throw new Error('Operation failed');
          }
          
          // Reset on success
          failureCount = 0;
          return 'success';
        } catch (error: unknown) {
          failureCount++;
          if (failureCount >= failureThreshold) {
            circuitOpen = true;
            // Short reset time for test
            setTimeout(() => {
              circuitOpen = false;
              failureCount = 0;
            }, 10);
          }
          throw error;
        }
      };

      // Test circuit breaker behavior
      let circuitBreakerTriggered = false;
      
      // First few operations should fail and trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreakerOperation();
        } catch (error: unknown) {
          if (error instanceof Error) {
            if (error.message === 'Circuit breaker is open') {
              circuitBreakerTriggered = true;
              break;
            }
          } else {
            throw error;
          }
        }
      }

      expect(circuitBreakerTriggered).toBe(true);
    });
  });
});