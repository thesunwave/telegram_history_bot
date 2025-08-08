import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageAggregatorDO } from '../src/message-aggregator-do';
import type { DurableObjectState } from '@cloudflare/workers-types';
import { Env, StoredMessage } from '../src/env';
import { TelegramMessage } from '../src/providers/ai-provider';

// Mock DurableObjectState
const mockState: DurableObjectState = {
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getAlarm: vi.fn(),
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
    sync: vi.fn(),
    transaction: vi.fn(),
  },
  id: {
    toString: () => 'test-id',
    equals: () => false,
  },
  acceptWebSocket: vi.fn(),
  getWebSockets: vi.fn(),
  setWebSocketAutoResponse: vi.fn(),
  getHibernationEventType: vi.fn(),
} as unknown as DurableObjectState;

// Mock Env
const mockEnv: Env = {
  DEBUG_LOGS: 'true',
} as Env;

// Mock Logger and PerformanceTracker
vi.mock('../src/logger', () => ({
  Logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  PerformanceTracker: {
    start: vi.fn(() => 'tracker-id'),
    end: vi.fn(),
  },
}));

describe('MessageAggregatorDO', () => {
  let aggregator: MessageAggregatorDO;

  beforeEach(() => {
    vi.clearAllMocks();
    aggregator = new MessageAggregatorDO(mockState, mockEnv);
  });

  describe('Session Initialization', () => {
    it('should initialize a new session successfully', async () => {
      const request = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session-1',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.sessionId).toBe('test-session-1');
    });

    it('should reject invalid initialization requests', async () => {
      const request = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: '',
          chatId: 'invalid',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(request);
      expect(response.status).toBe(400);
    });

    it('should reject non-POST requests for initialization', async () => {
      const request = new Request('http://localhost/initialize', {
        method: 'GET',
      });

      const response = await aggregator.fetch(request);
      expect(response.status).toBe(405);
    });
  });

  describe('Message Aggregation', () => {
    beforeEach(async () => {
      // Initialize session first
      const initRequest = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(initRequest);
    });

    it('should aggregate messages successfully', async () => {
      const messages: StoredMessage[] = [
        {
          chat: 12345,
          user: 1,
          username: 'user1',
          text: 'Hello world',
          ts: 1000,
        },
        {
          chat: 12345,
          user: 2,
          username: 'user2',
          text: 'Hello back',
          ts: 2000,
        },
      ];

      const request = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.messagesAggregated).toBe(2);
      expect(result.messagesReceived).toBe(2);
    });

    it('should sort messages by timestamp', async () => {
      const messages: StoredMessage[] = [
        {
          chat: 12345,
          user: 2,
          username: 'user2',
          text: 'Second message',
          ts: 2000,
        },
        {
          chat: 12345,
          user: 1,
          username: 'user1',
          text: 'First message',
          ts: 1000,
        },
      ];

      // Add messages
      const aggregateRequest = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(aggregateRequest);

      // Get results
      const resultsRequest = new Request('http://localhost/results?sessionId=test-session');
      const response = await aggregator.fetch(resultsRequest);
      const result = await response.json();

      expect(result.messages[0].ts).toBe(1000);
      expect(result.messages[1].ts).toBe(2000);
      expect(result.messages[0].text).toBe('First message');
      expect(result.messages[1].text).toBe('Second message');
    });

    it('should deduplicate messages', async () => {
      const duplicateMessages: StoredMessage[] = [
        {
          chat: 12345,
          user: 1,
          username: 'user1',
          text: 'Duplicate message',
          ts: 1000,
        },
        {
          chat: 12345,
          user: 1,
          username: 'user1',
          text: 'Duplicate message',
          ts: 1000,
        },
        {
          chat: 12345,
          user: 2,
          username: 'user2',
          text: 'Unique message',
          ts: 2000,
        },
      ];

      const request = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages: duplicateMessages,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(request);
      const result = await response.json();

      expect(result.messagesReceived).toBe(3);
      expect(result.messagesAggregated).toBe(2); // One duplicate removed
    });

    it('should reject aggregation for non-existent session', async () => {
      const messages: StoredMessage[] = [{
        chat: 12345,
        user: 1,
        username: 'user1',
        text: 'Hello',
        ts: 1000,
      }];

      const request = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'non-existent-session',
          messages,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(request);
      expect(response.status).toBe(404);
    });
  });

  describe('Results Retrieval', () => {
    beforeEach(async () => {
      // Initialize session and add some messages
      const initRequest = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(initRequest);

      const messages: StoredMessage[] = [
        {
          chat: 12345,
          user: 1,
          username: 'user1',
          text: 'Test message',
          ts: 1000,
        },
      ];

      const aggregateRequest = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(aggregateRequest);
    });

    it('should retrieve results successfully', async () => {
      const request = new Request('http://localhost/results?sessionId=test-session');
      const response = await aggregator.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.sessionId).toBe('test-session');
      expect(result.status).toBe('completed');
      expect(result.messagesAggregated).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].username).toBe('user1');
      expect(result.messages[0].text).toBe('Test message');
      expect(result.messages[0].ts).toBe(1000);
    });

    it('should return 404 for non-existent session', async () => {
      const request = new Request('http://localhost/results?sessionId=non-existent');
      const response = await aggregator.fetch(request);
      expect(response.status).toBe(404);
    });

    it('should return 400 for missing sessionId parameter', async () => {
      const request = new Request('http://localhost/results');
      const response = await aggregator.fetch(request);
      expect(response.status).toBe(400);
    });
  });

  describe('Status Retrieval', () => {
    beforeEach(async () => {
      const initRequest = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(initRequest);
    });

    it('should retrieve status successfully', async () => {
      const request = new Request('http://localhost/status?sessionId=test-session');
      const response = await aggregator.fetch(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.sessionId).toBe('test-session');
      expect(result.status).toBe('running');
      expect(result.messagesReceived).toBe(0);
      expect(result.messagesAggregated).toBe(0);
      expect(typeof result.startTime).toBe('number');
      expect(typeof result.lastActivity).toBe('number');
    });

    it('should return 404 for non-existent session', async () => {
      const request = new Request('http://localhost/status?sessionId=non-existent');
      const response = await aggregator.fetch(request);
      expect(response.status).toBe(404);
    });
  });

  describe('Session Cleanup', () => {
    beforeEach(async () => {
      const initRequest = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(initRequest);
    });

    it('should cleanup session successfully', async () => {
      const cleanupRequest = new Request('http://localhost/cleanup', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(cleanupRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify session is gone
      const statusRequest = new Request('http://localhost/status?sessionId=test-session');
      const statusResponse = await aggregator.fetch(statusRequest);
      expect(statusResponse.status).toBe(404);
    });

    it('should return 404 for non-existent session cleanup', async () => {
      const request = new Request('http://localhost/cleanup', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'non-existent',
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(request);
      expect(response.status).toBe(404);
    });
  });

  describe('Message Validation', () => {
    beforeEach(async () => {
      const initRequest = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(initRequest);
    });

    it('should handle messages with invalid data gracefully', async () => {
      const invalidMessages: StoredMessage[] = [
        {
          chat: 12345,
          user: 1,
          username: '',
          text: '',
          ts: 0,
        },
        {
          chat: 12345,
          user: 2,
          username: 'valid_user',
          text: 'Valid message',
          ts: 1000,
        },
      ];

      const aggregateRequest = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages: invalidMessages,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(aggregateRequest);
      expect(response.status).toBe(200);

      // Get results to check validation errors
      const resultsRequest = new Request('http://localhost/results?sessionId=test-session');
      const resultsResponse = await aggregator.fetch(resultsRequest);
      const result = await resultsResponse.json();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((error: string) => error.includes('username'))).toBe(true);
      expect(result.errors.some((error: string) => error.includes('text'))).toBe(true);
      expect(result.errors.some((error: string) => error.includes('timestamp'))).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid endpoints', async () => {
      const request = new Request('http://localhost/invalid-endpoint');
      const response = await aggregator.fetch(request);
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON in requests', async () => {
      const request = new Request('http://localhost/initialize', {
        method: 'POST',
        body: 'invalid-json',
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(request);
      expect(response.status).toBe(500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message arrays', async () => {
      const initRequest = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(initRequest);

      const aggregateRequest = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages: [],
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(aggregateRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.messagesAggregated).toBe(0);
      expect(result.messagesReceived).toBe(0);
    });

    it('should handle multiple aggregation calls for same session', async () => {
      const initRequest = new Request('http://localhost/initialize', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          chatId: 12345,
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      await aggregator.fetch(initRequest);

      // First batch
      const firstBatch: StoredMessage[] = [
        { chat: 12345, user: 1, username: 'user1', text: 'Message 1', ts: 1000 },
      ];

      const firstRequest = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages: firstBatch,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      await aggregator.fetch(firstRequest);

      // Second batch
      const secondBatch: StoredMessage[] = [
        { chat: 12345, user: 2, username: 'user2', text: 'Message 2', ts: 2000 },
      ];

      const secondRequest = new Request('http://localhost/aggregate', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'test-session',
          messages: secondBatch,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      const response = await aggregator.fetch(secondRequest);
      const result = await response.json();

      expect(result.messagesReceived).toBe(2);
      expect(result.messagesAggregated).toBe(2);
    });
  });
});
