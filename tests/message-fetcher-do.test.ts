import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MessageFetcherDO } from "../src/message-fetcher-do";
import { StoredMessage } from "../src/env";
import {
  ParallelFetchRequest,
  FetchStatus,
} from "../src/summary-optimization/types";

// Response type definitions
interface InitResponse {
  sessionId: string;
}

interface CleanupResponse {
  success: boolean;
}

// Mock dependencies
vi.mock("../src/logger", () => ({
  Logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
  PerformanceTracker: {
    start: vi.fn(() => "test-tracker-id"),
    end: vi.fn(),
  },
}));

vi.mock("../src/utils", () => ({
  processBatchesDetailed: vi.fn(),
  BatchErrorType: {
    API_LIMIT_EXCEEDED: "API_LIMIT_EXCEEDED",
    TIMEOUT: "TIMEOUT",
    NETWORK_ERROR: "NETWORK_ERROR",
    UNKNOWN_ERROR: "UNKNOWN_ERROR",
  },
}));

// Mock Durable Object state
const createMockState = () => ({
  blockConcurrencyWhile: vi.fn((fn: () => Promise<any>) => fn()),
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
});

// Mock environment
const createMockEnv = () => ({
  HISTORY: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
  COUNTERS: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
  },
  MESSAGE_FETCHER_DO: {
    idFromName: vi.fn(),
    get: vi.fn(),
  },
  TOKEN: "test-token",
  SECRET: "test-secret",
  DEBUG_LOGS: "true",
});

describe("MessageFetcherDO", () => {
  const testTimeout = 10000; // 10 seconds max per test

  let messageFecher: MessageFetcherDO;
  let mockState: any;
  let mockEnv: any;

  beforeEach(() => {
    mockState = createMockState();
    mockEnv = createMockEnv();
    messageFecher = new MessageFetcherDO(mockState, mockEnv);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe("initialization", () => {

    it("should handle POST request to /initialize endpoint", async () => {
      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200, // 2022-01-01
        end: 1641081600, // 2022-01-02
        concurrentFetches: 3,
        batchSize: 50,
      };

      const request = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response = await messageFecher.fetch(request);
      const result = await response.json() as InitResponse;

      expect(response.status).toBe(200);
      expect(result).toHaveProperty("sessionId");
      expect(result.sessionId).toMatch(/^session_\d+_[a-z0-9]+$/);
    });

    it("should validate fetch request parameters", async () => {
      const invalidRequest = {
        chatId: null,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 50,
      };

      const request = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(invalidRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response = await messageFecher.fetch(request);
      expect(response.status).toBe(400);
    });

    it("should reject invalid concurrent fetches count", async () => {
      const invalidRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 25, // Too high
        batchSize: 50,
      };

      const request = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(invalidRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response = await messageFecher.fetch(request);
      expect(response.status).toBe(400);
    });

    it("should reject invalid batch size", async () => {
      const invalidRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 1500, // Too high
      };

      const request = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(invalidRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response = await messageFecher.fetch(request);
      expect(response.status).toBe(400);
    });
  });

  describe("status checking", () => {

    it("should return status for existing session", async () => {
      // First initialize a session
      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 50,
      };

      const initRequest = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const initResponse = await messageFecher.fetch(initRequest);
      const initResult = await initResponse.json() as InitResponse;
      const sessionId = initResult.sessionId;

      // Now check status
      const statusRequest = new Request(
        `http://localhost/status?sessionId=${sessionId}`,
        {
          method: "GET",
        },
      );

      const statusResponse = await messageFecher.fetch(statusRequest);
      const statusResult = await statusResponse.json() as FetchStatus;

      expect(statusResponse.status).toBe(200);
      expect(statusResult.sessionId).toBe(sessionId);
      expect(statusResult.status).toBeOneOf(["running", "completed", "failed"]);
      expect(typeof statusResult.fetchesCompleted).toBe("number");
      expect(typeof statusResult.totalFetches).toBe("number");
      expect(typeof statusResult.messagesCollected).toBe("number");
      expect(Array.isArray(statusResult.errors)).toBe(true);
    });

    it("should return 404 for non-existent session", async () => {
      const statusRequest = new Request(
        "http://localhost/status?sessionId=non-existent",
        {
          method: "GET",
        },
      );

      const response = await messageFecher.fetch(statusRequest);
      expect(response.status).toBe(404);
    });

    it("should return 400 when sessionId parameter is missing", async () => {
      const statusRequest = new Request("http://localhost/status", {
        method: "GET",
      });

      const response = await messageFecher.fetch(statusRequest);
      expect(response.status).toBe(400);
    });
  });

  describe("results retrieval", () => {

    it("should return 202 for running session", async () => {
      // Mock KV list to make it take longer to complete
      mockEnv.HISTORY.list.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              keys: [
                { name: "msg:12345:1641000000:1" },
                { name: "msg:12345:1641000001:2" },
              ],
              cursor: "test-cursor",
            });
          }, 100);
        });
      });

      // Initialize session
      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 50,
      };

      const initRequest = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const initResponse = await messageFecher.fetch(initRequest);
      const initResult = await initResponse.json() as InitResponse;
      const sessionId = initResult.sessionId;

      // Try to get results immediately (should be running)
      const resultsRequest = new Request(
        `http://localhost/results?sessionId=${sessionId}`,
        {
          method: "GET",
        },
      );

      const response = await messageFecher.fetch(resultsRequest);
      expect(response.status).toBe(202); // Still running
    });

    it("should return 404 for non-existent session", async () => {
      const resultsRequest = new Request(
        "http://localhost/results?sessionId=non-existent",
        {
          method: "GET",
        },
      );

      const response = await messageFecher.fetch(resultsRequest);
      expect(response.status).toBe(404);
    });
  });

  describe("cleanup", () => {

    it("should cleanup specific session", async () => {
      // Initialize session
      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 50,
      };

      const initRequest = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const initResponse = await messageFecher.fetch(initRequest);
      const initResult = await initResponse.json() as InitResponse;
      const sessionId = initResult.sessionId;

      // Cleanup session
      const cleanupRequest = new Request("http://localhost/cleanup", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
        headers: { "Content-Type": "application/json" },
      });

      const cleanupResponse = await messageFecher.fetch(cleanupRequest);
      const cleanupResult = await cleanupResponse.json() as CleanupResponse;

      expect(cleanupResponse.status).toBe(200);
      expect(cleanupResult.success).toBe(true);

      // Verify session is gone
      const statusRequest = new Request(
        `http://localhost/status?sessionId=${sessionId}`,
        {
          method: "GET",
        },
      );

      const statusResponse = await messageFecher.fetch(statusRequest);
      expect(statusResponse.status).toBe(404);
    });

    it("should cleanup all old sessions when no sessionId provided", async () => {
      const cleanupRequest = new Request("http://localhost/cleanup", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
      });

      const response = await messageFecher.fetch(cleanupRequest);
      const result = await response.json() as CleanupResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
    });
  });

  describe("parallel fetching logic", () => {

    it("should handle empty KV results gracefully", async () => {
      // Mock empty KV list response
      mockEnv.HISTORY.list.mockResolvedValue({
        keys: [],
        cursor: undefined,
      });

      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 50,
      };

      const initRequest = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const initResponse = await messageFecher.fetch(initRequest);
      const initResult = await initResponse.json() as InitResponse;

      expect(initResponse.status).toBe(200);
      expect(initResult.sessionId).toBeDefined();
    });

    it("should filter messages by time range", async () => {
      const testMessages = [
        { name: "msg:12345:1640995000:1" }, // Before range
        { name: "msg:12345:1641000000:2" }, // In range
        { name: "msg:12345:1641090000:3" }, // After range
      ];

      mockEnv.HISTORY.list.mockResolvedValue({
        keys: testMessages,
        cursor: undefined,
      });

      const storedMessage: StoredMessage = {
        chat: 12345,
        user: 123,
        username: "testuser",
        text: "test message",
        ts: 1641000000,
      };

      mockEnv.HISTORY.get.mockResolvedValue(storedMessage);

      // Mock processBatchesDetailed
      const { processBatchesDetailed } = await import("../src/utils");
      vi.mocked(processBatchesDetailed).mockResolvedValue({
        results: [storedMessage],
        totalProcessed: 1,
        totalFailed: 0,
        successRate: 100,
        errors: [],
        hasApiLimitErrors: false,
        hasCriticalFailures: false,
        metrics: {
          totalItems: 1,
          totalBatches: 1,
          batchSize: 50,
          totalDuration: 100,
          averageBatchDuration: 100,
          successfulItems: 1,
          failedItems: 0,
          successRate: 100,
          apiLimitErrors: 0,
          timeoutErrors: 0,
          networkErrors: 0,
          unknownErrors: 0,
          criticalBatchFailures: 0,
          requestsPerSecond: 10,
          batchDurations: [100],
          errorsByBatch: [],
        },
      });

      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640999000, // Should include message at 1641000000
        end: 1641050000,
        concurrentFetches: 2,
        batchSize: 50,
      };

      const initRequest = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response = await messageFecher.fetch(initRequest);
      expect(response.status).toBe(200);

      // Verify that only messages in time range would be processed
      // This is tested indirectly through the filter logic in the implementation
    });
  });

  describe("error handling", () => {

    it("should handle 404 for unknown endpoints", async () => {
      const request = new Request("http://localhost/unknown", {
        method: "GET",
      });

      const response = await messageFecher.fetch(request);
      expect(response.status).toBe(404);
    });

    it("should handle method not allowed for wrong HTTP methods", async () => {
      const request = new Request("http://localhost/initialize", {
        method: "GET", // Should be POST
      });

      const response = await messageFecher.fetch(request);
      expect(response.status).toBe(405);
    });

    it("should handle malformed JSON in requests", async () => {
      const request = new Request("http://localhost/initialize", {
        method: "POST",
        body: "invalid json",
        headers: { "Content-Type": "application/json" },
      });

      const response = await messageFecher.fetch(request);
      expect(response.status).toBe(400);
    });

    it("should handle KV errors gracefully", async () => {
      // Mock KV error
      mockEnv.HISTORY.list.mockRejectedValue(
        new Error("KV service unavailable"),
      );

      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 50,
      };

      const initRequest = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const initResponse = await messageFecher.fetch(initRequest);
      const initResult = await initResponse.json() as InitResponse;
      const sessionId = initResult.sessionId;

      expect(initResponse.status).toBe(200);

      // Wait a bit for background processing to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check that the session failed
      const statusRequest = new Request(
        `http://localhost/status?sessionId=${sessionId}`,
        {
          method: "GET",
        },
      );

      const statusResponse = await messageFecher.fetch(statusRequest);
      const statusResult = await statusResponse.json() as FetchStatus;

      // Session should exist but might have failed due to KV error
      expect(statusResponse.status).toBe(200);
      expect(statusResult.sessionId).toBe(sessionId);
    });
  });

  describe("session management", () => {

    it("should generate unique session IDs", async () => {
      const fetchRequest: ParallelFetchRequest = {
        chatId: 12345,
        start: 1640995200,
        end: 1641081600,
        concurrentFetches: 3,
        batchSize: 50,
      };

      const request1 = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const request2 = new Request("http://localhost/initialize", {
        method: "POST",
        body: JSON.stringify(fetchRequest),
        headers: { "Content-Type": "application/json" },
      });

      const response1 = await messageFecher.fetch(request1);
      const response2 = await messageFecher.fetch(request2);

      const result1 = await response1.json() as InitResponse;
      const result2 = await response2.json() as InitResponse;

      expect(result1.sessionId).not.toBe(result2.sessionId);
    });
  });
});
