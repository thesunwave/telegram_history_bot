/**
 * Mock Durable Object Implementations
 * Provides comprehensive mock Durable Objects for testing
 */

import { vi } from 'vitest';
import type { DurableObjectNamespace, DurableObjectId, DurableObjectStub, SocketAddress, SocketOptions, Socket } from '@cloudflare/workers-types';
import { DurableObjectFixtures } from '../fixtures/durable-object-fixtures';

/**
 * Mock Durable Object ID
 */
export class MockDurableObjectId implements DurableObjectId {
  private id: string;

  constructor(id?: string) {
    this.id = id || `mock-id-${Math.random().toString(36).substr(2, 9)}`;
  }

  toString(): string {
    return this.id;
  }

  equals(other: DurableObjectId): boolean {
    return this.id === other.toString();
  }
}

/**
 * Mock Durable Object Stub
 */
export class MockDurableObjectStub implements DurableObjectStub {
  public readonly id: DurableObjectId;
  private responses = new Map<string, any>();
  private shouldFail = false;
  private failureError = 'Durable Object error';
  private responseDelay = 0;
  private requestLog: Array<{ request: Request; timestamp: Date }> = [];
  private stubType: 'counters' | 'aggregator' | 'analyzer' | 'day-block' | null = null;
  private countersState: Map<string, number> = new Map();

  public fetch = vi.fn().mockImplementation(async (request: Request) => {
    await this.simulateDelay();
    this.logRequest(request);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const key = `${method}:${path}`;

    // Check for custom response
    if (this.responses.has(key)) {
      const cachedResponse = this.responses.get(key);
      // Clone the response to avoid "Body has already been read" errors
      return cachedResponse?.clone() || cachedResponse;
    }

    // Generate default response based on path
    return this.generateResponse(request);
  });

  constructor(id?: DurableObjectId) {
    this.id = id || new MockDurableObjectId();
  }

  /**
   * Generate appropriate response based on request
   */
  private async generateResponse(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // If stub type is configured, use specific handler
    if (this.stubType) {
      switch (this.stubType) {
        case 'counters':
          return this.handleCountersRequest(request);
        case 'aggregator':
          return this.handleMessageAggregatorRequest(request);
        case 'analyzer':
          return this.handleCriminalAnalyzerRequest(request);
        case 'day-block':
          return this.handleDayBlockManagerRequest(request);
      }
    }

    // Fallback to path-based detection
    if (path.includes('/increment') || path.includes('/counters')) {
      return this.handleCountersRequest(request);
    }

    if (path.includes('/add') || path.includes('/process') || path.includes('/aggregator')) {
      return this.handleMessageAggregatorRequest(request);
    }

    if (path.includes('/analyze') || path.includes('/criminal')) {
      return this.handleCriminalAnalyzerRequest(request);
    }

    if (path.includes('/summary') || path.includes('/day-block')) {
      return this.handleDayBlockManagerRequest(request);
    }

    // Default response
    return DurableObjectFixtures.Response.createSuccessResponse({
      message: 'Mock Durable Object response',
      path,
      method
    });
  }

  /**
   * Handle counters Durable Object requests
   */
  private async handleCountersRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle GET requests for retrieving counter data
    if (method === 'GET' && path === '/get') {
      const userId = url.searchParams.get('userId');
      const chatId = url.searchParams.get('chatId');
      
      if (userId) {
        const violationsKey = `user:${userId}:violations`;
        const profanityKey = `user:${userId}:profanity`;
        const violations = this.countersState.get(violationsKey) || 0;
        const profanity = this.countersState.get(profanityKey) || 0;
        
        return DurableObjectFixtures.Response.createCountersResponse(
          parseInt(userId),
          violations,
          profanity
        );
      }

      return DurableObjectFixtures.Response.createSuccessResponse({
        counters: {
          totalViolations: Math.floor(Math.random() * 100) + 10,
          totalProfanity: Math.floor(Math.random() * 200) + 50
        }
      });
    }

    // Return 405 for non-POST methods (except GET /get)
    if (method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Handle POST endpoints
    if (path === '/inc' || path.includes('/increment')) {
      const body = await request.json() as any;
      const userId = body.userId;
      const type = body.type; // 'violations' or 'profanity'
      const amount = body.amount || 1;
      
      if (userId && type) {
        const key = `user:${userId}:${type}`;
        const currentValue = this.countersState.get(key) || 0;
        this.countersState.set(key, currentValue + amount);
      }
      
      return DurableObjectFixtures.Response.createSuccessResponse({
        incremented: amount,
        userId: userId,
        type: type
      });
    }

    if (path === '/profanity') {
      return new Response('ok');
    }

    if (path === '/criminal') {
      return new Response('ok');
    }

    if (path === '/batch') {
      return new Response('ok');
    }

    // Return 404 for unknown endpoints - this matches CountersDO behavior
    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle message aggregator Durable Object requests
   */
  private async handleMessageAggregatorRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'POST' && path.includes('/add')) {
      const body = await request.json() as any;
      return DurableObjectFixtures.Response.createSuccessResponse({
        added: body.messages?.length || 1,
        batchId: `batch_${Math.random().toString(36).substr(2, 9)}`
      });
    }

    if (method === 'POST' && path.includes('/process')) {
      const body = await request.json() as any;
      const batchSize = body.batchSize || 10;
      return DurableObjectFixtures.Response.createMessageAggregatorResponse(
        batchSize, // Use the actual batchSize from request
        Math.max(0, Math.floor(Math.random() * 5))
      );
    }

    return DurableObjectFixtures.Response.createErrorResponse('Invalid aggregator request');
  }

  /**
   * Handle criminal analyzer Durable Object requests
   */
  private async handleCriminalAnalyzerRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'POST' && path.includes('/analyze')) {
      const body = await request.json() as any;
      const message = body.message || '';
      
      // Simple heuristic for violation detection
      const hasViolations = message.toLowerCase().includes('threat') || 
                           message.toLowerCase().includes('violence') ||
                           message.toLowerCase().includes('hate');
      
      return DurableObjectFixtures.Response.createCriminalCodeAnalyzerResponse(hasViolations);
    }

    return DurableObjectFixtures.Response.createErrorResponse('Invalid analyzer request');
  }

  /**
   * Handle day block manager Durable Object requests
   */
  private async handleDayBlockManagerRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'POST' && path.includes('/add-message')) {
      const body = await request.json() as any;
      return DurableObjectFixtures.Response.createSuccessResponse({
        added: true,
        messageId: body.id || Math.floor(Math.random() * 1000000)
      });
    }

    if (method === 'GET' && path.includes('/summary')) {
      const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
      return DurableObjectFixtures.Response.createDayBlockManagerResponse(
        Math.floor(Math.random() * 50) + 10,
        `Summary for ${date}: Active discussion in the chat`,
        date
      );
    }

    return DurableObjectFixtures.Response.createErrorResponse('Invalid day block request');
  }

  /**
   * Simulate response delay
   */
  private async simulateDelay(): Promise<void> {
    if (this.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.responseDelay));
    }
  }

  /**
   * Log request for testing
   */
  private logRequest(request: Request): void {
    this.requestLog.push({ request: request.clone(), timestamp: new Date() });
  }

  /**
   * Set custom response for specific request
   */
  setResponse(method: string, path: string, response: Response): void {
    const key = `${method}:${path}`;
    this.responses.set(key, response);
  }

  /**
   * Configure failure mode
   */
  configureFail(shouldFail: boolean, error: string = 'Durable Object error'): void {
    this.shouldFail = shouldFail;
    this.failureError = error;
  }

  /**
   * Configure response delay
   */
  configureDelay(delay: number): void {
    this.responseDelay = delay;
  }

  /**
   * Get request log
   */
  getRequestLog(): Array<{ request: Request; timestamp: Date }> {
    return [...this.requestLog];
  }

  /**
   * Clear request log
   */
  clearRequestLog(): void {
    this.requestLog = [];
  }

  /**
   * Set stub type for specific Durable Object behavior
   */
  setStubType(type: 'counters' | 'aggregator' | 'analyzer' | 'day-block' | null): void {
    this.stubType = type;
  }

  /**
   * Get request count
   */
  getRequestCount(): number {
    return this.requestLog.length;
  }

  /**
   * Mock implementation of connect method
   */
  connect(address: string | SocketAddress, options?: SocketOptions): Socket {
    throw new Error('Socket connections not supported in mock');
  }

  /**
   * Get Durable Object ID
   */
  getId(): DurableObjectId {
    return this.id;
  }

  /**
   * Reset all mocks and state
   */
  reset(): void {
    this.clearRequestLog();
    this.responses.clear();
    this.shouldFail = false;
    this.responseDelay = 0;
    vi.clearAllMocks();
  }
}

/**
 * Mock Durable Object Namespace
 */
export class MockDurableObjectNamespace implements DurableObjectNamespace {
  private stubs = new Map<string, MockDurableObjectStub>();
  private shouldFail = false;
  private failureError = 'Namespace error';

  public idFromName = vi.fn().mockImplementation((name: string) => {
    return new MockDurableObjectId(`name-${name}`);
  });

  public idFromString = vi.fn().mockImplementation((id: string) => {
    return new MockDurableObjectId(id);
  });

  public newUniqueId = vi.fn().mockImplementation(() => {
    return new MockDurableObjectId();
  });

  public get = vi.fn().mockImplementation((id: DurableObjectId) => {
    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const idString = id.toString();
    if (!this.stubs.has(idString)) {
      this.stubs.set(idString, new MockDurableObjectStub(id));
    }
    return this.stubs.get(idString)!;
  });

  public jurisdiction = (jurisdiction: any) => {
    return new MockDurableObjectNamespace();
  };

  /**
   * Configure failure mode
   */
  configureFail(shouldFail: boolean, error: string = 'Namespace error'): void {
    this.shouldFail = shouldFail;
    this.failureError = error;
  }

  /**
   * Get stub by ID
   */
  getStub(id: string): MockDurableObjectStub | undefined {
    return this.stubs.get(id);
  }

  /**
   * Get all stubs
   */
  getAllStubs(): MockDurableObjectStub[] {
    return Array.from(this.stubs.values());
  }

  /**
   * Clear all stubs
   */
  clearStubs(): void {
    this.stubs.clear();
  }

  /**
   * Reset all mocks and state
   */
  reset(): void {
    this.stubs.forEach(stub => stub.reset());
    this.clearStubs();
    this.shouldFail = false;
    vi.clearAllMocks();
  }
}

/**
 * Durable Object Mock Factory
 */
export class DurableObjectMockFactory {
  /**
   * Create mock Durable Object namespace
   */
  static createNamespace(): MockDurableObjectNamespace {
    return new MockDurableObjectNamespace();
  }

  /**
   * Create mock Durable Object stub
   */
  static createStub(id?: string): MockDurableObjectStub {
    const durableObjectId = id ? new MockDurableObjectId(id) : new MockDurableObjectId();
    return new MockDurableObjectStub(durableObjectId);
  }

  /**
   * Create namespace with pre-configured stubs
   */
  static createNamespaceWithStubs(stubConfigs: Array<{ id: string; type: 'counters' | 'aggregator' | 'analyzer' | 'day-block' }>): MockDurableObjectNamespace {
    const namespace = new MockDurableObjectNamespace();
    
    stubConfigs.forEach(config => {
      const stub = this.createStub(config.id);
      this.configureStubForType(stub, config.type);
      namespace['stubs'].set(config.id, stub);
    });
    
    return namespace;
  }

  /**
   * Configure stub for specific Durable Object type
   */
  static configureStubForType(stub: MockDurableObjectStub, type: 'counters' | 'aggregator' | 'analyzer' | 'day-block'): void {
    // Set the stub type to ensure proper routing
    stub.setStubType(type);
    
    switch (type) {
      case 'counters':
        // Don't set static responses for counters - use dynamic state management
        // The handleCountersRequest method will handle all requests dynamically
        break;
        
      case 'aggregator':
        // Don't set static responses for aggregator - use dynamic request handling
        // The handleMessageAggregatorRequest method will handle all requests dynamically
        break;
        
      case 'analyzer':
        stub.setResponse('POST', '/analyze', DurableObjectFixtures.Response.createCriminalCodeAnalyzerResponse(false));
        break;
        
      case 'day-block':
        stub.setResponse('POST', '/add-message', DurableObjectFixtures.Response.createSuccessResponse({ added: true }));
        // Use dynamic request handling for /summary endpoint
        break;
    }
  }

  /**
   * Create namespace with specific scenario
   */
  static createScenarioNamespace(scenario: 'healthy' | 'failing' | 'slow' | 'mixed'): MockDurableObjectNamespace {
    const namespace = new MockDurableObjectNamespace();
    
    // Create stubs for different DO types
    const stubTypes: Array<{ id: string; type: 'counters' | 'aggregator' | 'analyzer' | 'day-block' }> = [
      { id: 'counters-1', type: 'counters' },
      { id: 'aggregator-1', type: 'aggregator' },
      { id: 'analyzer-1', type: 'analyzer' },
      { id: 'day-block-1', type: 'day-block' }
    ];
    
    stubTypes.forEach(config => {
      const stub = this.createStub(config.id);
      this.configureStubForType(stub, config.type);
      
      switch (scenario) {
        case 'failing':
          stub.configureFail(true, `${config.type} Durable Object failed`);
          break;
        case 'slow':
          stub.configureDelay(2000);
          break;
        case 'mixed':
          if (config.type === 'analyzer') {
            stub.configureFail(true, 'Analyzer temporarily unavailable');
          } else if (config.type === 'aggregator') {
            stub.configureDelay(1000);
          }
          break;
        case 'healthy':
        default:
          // Stubs are healthy by default
          break;
      }
      
      namespace['stubs'].set(config.id, stub);
    });
    
    return namespace;
  }

  /**
   * Create complete Durable Object environment
   */
  static createDurableObjectEnvironment(): {
    COUNTERS_DO: MockDurableObjectNamespace;
    MESSAGE_FETCHER_DO: MockDurableObjectNamespace;
    MESSAGE_AGGREGATOR_DO: MockDurableObjectNamespace;
    DAY_BLOCK_MANAGER_DO: MockDurableObjectNamespace;
  } {
    return {
      COUNTERS_DO: this.createScenarioNamespace('healthy'),
      MESSAGE_FETCHER_DO: this.createScenarioNamespace('healthy'),
      MESSAGE_AGGREGATOR_DO: this.createScenarioNamespace('healthy'),
      DAY_BLOCK_MANAGER_DO: this.createScenarioNamespace('healthy')
    };
  }
}

/**
 * Durable Object test helpers
 */
export class DurableObjectTestHelpers {
  /**
   * Verify request was made to Durable Object
   */
  static verifyRequest(stub: MockDurableObjectStub, method?: string, pathPattern?: string | RegExp): boolean {
    const log = stub.getRequestLog();
    return log.some(entry => {
      const request = entry.request;
      const url = new URL(request.url);
      
      if (method && request.method !== method) {
        return false;
      }
      
      if (pathPattern) {
        if (typeof pathPattern === 'string') {
          return url.pathname.includes(pathPattern);
        }
        return pathPattern.test(url.pathname);
      }
      
      return true;
    });
  }

  /**
   * Get requests matching criteria
   */
  static getRequestsMatching(
    stub: MockDurableObjectStub,
    method?: string,
    pathPattern?: string | RegExp
  ): Array<{ request: Request; timestamp: Date }> {
    const log = stub.getRequestLog();
    return log.filter(entry => {
      const request = entry.request;
      const url = new URL(request.url);
      
      if (method && request.method !== method) {
        return false;
      }
      
      if (pathPattern) {
        if (typeof pathPattern === 'string') {
          return url.pathname.includes(pathPattern);
        }
        return pathPattern.test(url.pathname);
      }
      
      return true;
    });
  }

  /**
   * Assert request count
   */
  static assertRequestCount(stub: MockDurableObjectStub, expectedCount: number): void {
    const actualCount = stub.getRequestCount();
    if (actualCount !== expectedCount) {
      throw new Error(`Expected ${expectedCount} requests, got ${actualCount}`);
    }
  }

  /**
   * Wait for Durable Object to be ready
   */
  static async waitForDurableObjectReady(stub: MockDurableObjectStub, timeout: number = 5000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      try {
        const response = await stub.fetch(new Request('https://test.com/health'));
        if (response.ok) {
          return;
        }
      } catch (error: unknown) {
        // Durable Object not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Durable Object did not become ready within timeout');
  }

  /**
   * Create Durable Object with test scenario
   */
  static async withTestDurableObject<T>(
    type: 'counters' | 'aggregator' | 'analyzer' | 'day-block',
    scenario: 'healthy' | 'failing' | 'slow',
    testFn: (stub: MockDurableObjectStub) => Promise<T>
  ): Promise<T> {
    const stub = DurableObjectMockFactory.createStub();
    DurableObjectMockFactory.configureStubForType(stub, type);
    
    switch (scenario) {
      case 'failing':
        stub.configureFail(true, `${type} Durable Object failed`);
        break;
      case 'slow':
        stub.configureDelay(2000);
        break;
      case 'healthy':
      default:
        // Stub is healthy by default
        break;
    }
    
    try {
      return await testFn(stub);
    } finally {
      stub.reset();
    }
  }

  /**
   * Test with complete Durable Object environment
   */
  static async withDurableObjectEnvironment<T>(
    scenario: 'healthy' | 'failing' | 'slow' | 'mixed',
    testFn: (env: {
      COUNTERS_DO: MockDurableObjectNamespace;
      MESSAGE_FETCHER_DO: MockDurableObjectNamespace;
      MESSAGE_AGGREGATOR_DO: MockDurableObjectNamespace;
      DAY_BLOCK_MANAGER_DO: MockDurableObjectNamespace;
    }) => Promise<T>
  ): Promise<T> {
    const env = {
      COUNTERS_DO: DurableObjectMockFactory.createScenarioNamespace(scenario),
      MESSAGE_FETCHER_DO: DurableObjectMockFactory.createScenarioNamespace(scenario),
      MESSAGE_AGGREGATOR_DO: DurableObjectMockFactory.createScenarioNamespace(scenario),
      DAY_BLOCK_MANAGER_DO: DurableObjectMockFactory.createScenarioNamespace(scenario)
    };
    
    try {
      return await testFn(env);
    } finally {
      Object.values(env).forEach(namespace => namespace.reset());
    }
  }

  /**
   * Verify all Durable Objects in namespace are healthy
   */
  static async verifyNamespaceHealth(namespace: MockDurableObjectNamespace): Promise<boolean> {
    const stubs = namespace.getAllStubs();
    
    for (const stub of stubs) {
      try {
        const response = await stub.fetch(new Request('https://test.com/health'));
        if (!response.ok) {
          return false;
        }
      } catch (error: unknown) {
        return false;
      }
    }
    
    return true;
  }
}