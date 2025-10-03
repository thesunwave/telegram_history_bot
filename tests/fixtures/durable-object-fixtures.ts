/**
 * Durable Object Test Fixtures
 * Provides realistic test data generators for Durable Object models
 */

import { vi } from 'vitest';

/**
 * Durable Object state fixtures
 */
export class DurableObjectStateFixtures {
  /**
   * Create mock Durable Object state
   */
  static createMockState(initialData: Record<string, any> = {}) {
    const storage = new Map<string, any>(Object.entries(initialData));
    
    return {
      storage: {
        get: vi.fn().mockImplementation((key: string) => {
          return Promise.resolve(storage.get(key));
        }),
        put: vi.fn().mockImplementation((key: string, value: any) => {
          storage.set(key, value);
          return Promise.resolve();
        }),
        delete: vi.fn().mockImplementation((key: string) => {
          const existed = storage.has(key);
          storage.delete(key);
          return Promise.resolve(existed);
        }),
        list: vi.fn().mockImplementation((options?: any) => {
          const entries = Array.from(storage.entries());
          let filtered = entries;
          
          if (options?.prefix) {
            filtered = entries.filter(([key]) => key.startsWith(options.prefix));
          }
          
          if (options?.limit) {
            filtered = filtered.slice(0, options.limit);
          }
          
          const result = new Map(filtered);
          return Promise.resolve(result);
        }),
        deleteAll: vi.fn().mockImplementation(() => {
          storage.clear();
          return Promise.resolve();
        }),
        transaction: vi.fn().mockImplementation(async (callback: Function) => {
          return callback({
            get: (key: string) => storage.get(key),
            put: (key: string, value: any) => storage.set(key, value),
            delete: (key: string) => {
              const existed = storage.has(key);
              storage.delete(key);
              return existed;
            }
          });
        })
      },
      blockConcurrencyWhile: vi.fn().mockImplementation(async (callback: Function) => {
        return callback();
      }),
      id: {
        toString: () => `test-id-${Math.random().toString(36).substr(2, 9)}`,
        equals: vi.fn().mockReturnValue(false)
      },
      waitUntil: vi.fn().mockImplementation((promise: Promise<any>) => promise)
    };
  }

  /**
   * Create state with counters data
   */
  static createCountersState() {
    return this.createMockState({
      'user:123456:violations': 5,
      'user:123456:profanity': 12,
      'user:789012:violations': 2,
      'user:789012:profanity': 8,
      'chat:-1001234567890:total_violations': 7,
      'chat:-1001234567890:total_profanity': 20,
      'chat:-1001234567890:active_users': 15
    });
  }

  /**
   * Create state with message aggregator data
   */
  static createMessageAggregatorState() {
    const messages = [
      { id: 1, text: 'Hello world', userId: 123456, timestamp: Date.now() - 3600000 },
      { id: 2, text: 'How are you?', userId: 789012, timestamp: Date.now() - 1800000 },
      { id: 3, text: 'Good morning', userId: 123456, timestamp: Date.now() - 900000 }
    ];
    
    return this.createMockState({
      'messages:batch:1': messages.slice(0, 2),
      'messages:batch:2': messages.slice(2),
      'batch_count': 2,
      'total_messages': messages.length,
      'last_processed': Date.now() - 300000
    });
  }

  /**
   * Create state with criminal code analyzer data
   */
  static createCriminalCodeAnalyzerState() {
    return this.createMockState({
      'analysis:cache:msg123': {
        hasViolations: true,
        violations: [{
          article: '282',
          severity: 7,
          confidence: 0.85
        }],
        timestamp: Date.now() - 600000
      },
      'analysis:cache:msg456': {
        hasViolations: false,
        violations: [],
        timestamp: Date.now() - 300000
      },
      'analysis:stats': {
        totalAnalyzed: 150,
        violationsFound: 23,
        averageConfidence: 0.78
      }
    });
  }

  /**
   * Create state with day block manager data
   */
  static createDayBlockManagerState() {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    return this.createMockState({
      [`day:${today}:messages`]: [
        { id: 1, text: 'Morning message', userId: 123456, hour: 9 },
        { id: 2, text: 'Afternoon message', userId: 789012, hour: 14 }
      ],
      [`day:${yesterday}:messages`]: [
        { id: 3, text: 'Yesterday message', userId: 123456, hour: 10 }
      ],
      [`day:${today}:summary`]: 'Active discussion about current events',
      [`day:${yesterday}:summary`]: 'Light conversation',
      'current_day': today,
      'message_count': 3
    });
  }
}

/**
 * Durable Object request fixtures
 */
export class DurableObjectRequestFixtures {
  /**
   * Create HTTP request for Durable Object
   */
  static createRequest(method: string = 'POST', path: string = '/', body?: any) {
    const url = `https://test.example.com${path}`;
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': `req_${Math.random().toString(36).substr(2, 9)}`
      }
    };
    
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    
    return new Request(url, init);
  }

  /**
   * Create counters increment request
   */
  static createCountersIncrementRequest(userId: number, type: 'violations' | 'profanity', amount: number = 1) {
    return this.createRequest('POST', '/increment', {
      userId,
      type,
      amount,
      timestamp: Date.now()
    });
  }

  /**
   * Create counters get request
   */
  static createCountersGetRequest(userId?: number, chatId?: number) {
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId.toString());
    if (chatId) params.set('chatId', chatId.toString());
    
    const path = params.toString() ? `/get?${params.toString()}` : '/get';
    return this.createRequest('GET', path);
  }

  /**
   * Create message aggregator add request
   */
  static createMessageAggregatorAddRequest(messages: any[]) {
    return this.createRequest('POST', '/add', {
      messages,
      timestamp: Date.now()
    });
  }

  /**
   * Create message aggregator process request
   */
  static createMessageAggregatorProcessRequest(batchSize: number = 10) {
    return this.createRequest('POST', '/process', {
      batchSize,
      timestamp: Date.now()
    });
  }

  /**
   * Create criminal code analyzer analyze request
   */
  static createCriminalCodeAnalyzerRequest(message: string, userId: number, chatId: number) {
    return this.createRequest('POST', '/analyze', {
      message,
      userId,
      chatId,
      messageId: Math.floor(Math.random() * 1000000),
      timestamp: Date.now()
    });
  }

  /**
   * Create day block manager add message request
   */
  static createDayBlockManagerAddRequest(message: any) {
    return this.createRequest('POST', '/add-message', {
      ...message,
      timestamp: Date.now()
    });
  }

  /**
   * Create day block manager get summary request
   */
  static createDayBlockManagerSummaryRequest(date?: string) {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    
    const path = params.toString() ? `/summary?${params.toString()}` : '/summary';
    return this.createRequest('GET', path);
  }
}

/**
 * Durable Object response fixtures
 */
export class DurableObjectResponseFixtures {
  /**
   * Create successful response
   */
  static createSuccessResponse(data?: any) {
    return new Response(JSON.stringify({
      success: true,
      data: data || { message: 'Operation completed successfully' },
      timestamp: Date.now()
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Response-Time': `${Math.floor(Math.random() * 100) + 10}ms`
      }
    });
  }

  /**
   * Create error response
   */
  static createErrorResponse(error: string = 'Internal error', status: number = 500) {
    return new Response(JSON.stringify({
      success: false,
      error,
      timestamp: Date.now()
    }), {
      status,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Create counters response
   */
  static createCountersResponse(userId: number, violations: number = 5, profanity: number = 12) {
    return this.createSuccessResponse({
      userId,
      counters: {
        violations,
        profanity,
        total: violations + profanity
      },
      lastUpdated: Date.now() - Math.random() * 3600000
    });
  }

  /**
   * Create message aggregator response
   */
  static createMessageAggregatorResponse(processed: number = 10, remaining: number = 5) {
    return this.createSuccessResponse({
      processed,
      remaining,
      batchId: `batch_${Math.random().toString(36).substr(2, 9)}`,
      processingTime: Math.floor(Math.random() * 1000) + 100
    });
  }

  /**
   * Create criminal code analyzer response
   */
  static createCriminalCodeAnalyzerResponse(hasViolations: boolean = false) {
    const violations = hasViolations ? [{
      article: '282',
      subarticle: null,
      articleTitle: 'Возбуждение ненависти либо вражды',
      quote: 'Test violation quote',
      punishment: 'штраф до 300 тысяч рублей',
      severity: 7,
      confidence: 0.85
    }] : [];

    return this.createSuccessResponse({
      hasViolations,
      violations,
      totalSeverity: violations.reduce((sum, v) => sum + v.severity, 0),
      riskLevel: hasViolations ? 'high' : 'low',
      analysisTimestamp: new Date().toISOString(),
      processingTime: Math.floor(Math.random() * 2000) + 500
    });
  }

  /**
   * Create day block manager response
   */
  static createDayBlockManagerResponse(messageCount: number = 15, summary?: string, date?: string) {
    return this.createSuccessResponse({
      date: date || new Date().toISOString().split('T')[0],
      messageCount,
      summary: summary || 'Active discussion in the chat',
      participants: Math.floor(Math.random() * 10) + 5,
      lastActivity: Date.now() - Math.random() * 3600000
    });
  }
}

/**
 * Durable Object environment fixtures
 */
export class DurableObjectEnvironmentFixtures {
  /**
   * Create mock Durable Object environment
   */
  static createMockEnvironment() {
    return {
      HISTORY: {
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
        list: vi.fn().mockResolvedValue({ keys: [] })
      },
      COUNTERS: {
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
        list: vi.fn().mockResolvedValue({ keys: [] })
      },
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ success: true }),
            all: vi.fn().mockResolvedValue({ results: [] }),
            first: vi.fn().mockResolvedValue(undefined)
          }),
          run: vi.fn().mockResolvedValue({ success: true }),
          all: vi.fn().mockResolvedValue({ results: [] }),
          first: vi.fn().mockResolvedValue(undefined)
        }),
        exec: vi.fn().mockResolvedValue({ results: [] })
      },
      AI: {
        run: vi.fn().mockResolvedValue({ response: 'Test AI response' })
      },
      TOKEN: 'test-token',
      SECRET: 'test-secret'
    };
  }

  /**
   * Create environment with realistic data
   */
  static createRealisticEnvironment() {
    const env = this.createMockEnvironment();
    
    // Add some realistic KV data
    const historyData = new Map([
      ['chat:-1001234567890:2024-01-15', JSON.stringify([
        { id: 1, text: 'Hello', userId: 123456, timestamp: Date.now() - 3600000 },
        { id: 2, text: 'Hi there', userId: 789012, timestamp: Date.now() - 1800000 }
      ])],
      ['summary:chat:-1001234567890:2024-01-15', 'Friendly greetings exchanged']
    ]);
    
    env.HISTORY.get.mockImplementation((key: string) => {
      return Promise.resolve(historyData.get(key) || null);
    });
    
    env.HISTORY.list.mockImplementation((options?: any) => {
      const keys = Array.from(historyData.keys());
      let filtered = keys;
      
      if (options?.prefix) {
        filtered = keys.filter(key => key.startsWith(options.prefix));
      }
      
      return Promise.resolve({
        keys: filtered.slice(0, options?.limit || 1000).map(name => ({ name }))
      });
    });
    
    return env;
  }
}

/**
 * Durable Object test scenarios
 */
export class DurableObjectScenarioFixtures {
  /**
   * Create high-activity counters scenario
   */
  static createHighActivityCountersScenario() {
    const state = DurableObjectStateFixtures.createCountersState();
    
    // Add more data for high activity
    const storage = (state.storage as any);
    storage.put('user:111111:violations', 25);
    storage.put('user:111111:profanity', 45);
    storage.put('user:222222:violations', 18);
    storage.put('user:222222:profanity', 32);
    storage.put('chat:-1001234567890:total_violations', 50);
    storage.put('chat:-1001234567890:total_profanity', 120);
    
    return {
      state,
      requests: [
        DurableObjectRequestFixtures.createCountersIncrementRequest(111111, 'violations', 3),
        DurableObjectRequestFixtures.createCountersIncrementRequest(222222, 'profanity', 5),
        DurableObjectRequestFixtures.createCountersGetRequest(111111)
      ],
      expectedResponses: [
        DurableObjectResponseFixtures.createSuccessResponse({ incremented: 3 }),
        DurableObjectResponseFixtures.createSuccessResponse({ incremented: 5 }),
        DurableObjectResponseFixtures.createCountersResponse(111111, 28, 45)
      ]
    };
  }

  /**
   * Create message processing scenario
   */
  static createMessageProcessingScenario() {
    const state = DurableObjectStateFixtures.createMessageAggregatorState();
    
    const newMessages = [
      { id: 4, text: 'New message 1', userId: 123456, timestamp: Date.now() - 600000 },
      { id: 5, text: 'New message 2', userId: 789012, timestamp: Date.now() - 300000 }
    ];
    
    return {
      state,
      requests: [
        DurableObjectRequestFixtures.createMessageAggregatorAddRequest(newMessages),
        DurableObjectRequestFixtures.createMessageAggregatorProcessRequest(5)
      ],
      expectedResponses: [
        DurableObjectResponseFixtures.createSuccessResponse({ added: 2 }),
        DurableObjectResponseFixtures.createMessageAggregatorResponse(5, 0)
      ]
    };
  }

  /**
   * Create criminal code analysis scenario
   */
  static createCriminalAnalysisScenario() {
    const state = DurableObjectStateFixtures.createCriminalCodeAnalyzerState();
    
    const testMessages = [
      'This is a normal message',
      'This message contains hate speech and threats',
      'Another regular conversation'
    ];
    
    return {
      state,
      requests: testMessages.map((message, index) => 
        DurableObjectRequestFixtures.createCriminalCodeAnalyzerRequest(
          message, 
          123456 + index, 
          -1001234567890
        )
      ),
      expectedResponses: [
        DurableObjectResponseFixtures.createCriminalCodeAnalyzerResponse(false),
        DurableObjectResponseFixtures.createCriminalCodeAnalyzerResponse(true),
        DurableObjectResponseFixtures.createCriminalCodeAnalyzerResponse(false)
      ]
    };
  }

  /**
   * Create day block management scenario
   */
  static createDayBlockScenario() {
    const state = DurableObjectStateFixtures.createDayBlockManagerState();
    
    const newMessage = {
      id: 6,
      text: 'Evening message',
      userId: 123456,
      timestamp: Date.now(),
      hour: 20
    };
    
    return {
      state,
      requests: [
        DurableObjectRequestFixtures.createDayBlockManagerAddRequest(newMessage),
        DurableObjectRequestFixtures.createDayBlockManagerSummaryRequest()
      ],
      expectedResponses: [
        DurableObjectResponseFixtures.createSuccessResponse({ added: true }),
        DurableObjectResponseFixtures.createDayBlockManagerResponse(3, 'Active evening discussion')
      ]
    };
  }

  /**
   * Create error handling scenario
   */
  static createErrorHandlingScenario() {
    const state = DurableObjectStateFixtures.createMockState();
    
    // Simulate storage errors
    state.storage.get = vi.fn().mockRejectedValue(new Error('Storage unavailable'));
    state.storage.put = vi.fn().mockRejectedValue(new Error('Storage write failed'));
    
    return {
      state,
      requests: [
        DurableObjectRequestFixtures.createCountersGetRequest(123456),
        DurableObjectRequestFixtures.createCountersIncrementRequest(123456, 'violations', 1)
      ],
      expectedResponses: [
        DurableObjectResponseFixtures.createErrorResponse('Storage unavailable', 500),
        DurableObjectResponseFixtures.createErrorResponse('Storage write failed', 500)
      ]
    };
  }
}

/**
 * Comprehensive Durable Object fixtures factory
 */
export class DurableObjectFixtures {
  static readonly State = DurableObjectStateFixtures;
  static readonly Request = DurableObjectRequestFixtures;
  static readonly Response = DurableObjectResponseFixtures;
  static readonly Environment = DurableObjectEnvironmentFixtures;
  static readonly Scenario = DurableObjectScenarioFixtures;

  /**
   * Create a complete Durable Object test dataset
   */
  static createCompleteDataset(objectType: 'counters' | 'message-aggregator' | 'criminal-analyzer' | 'day-block-manager' = 'counters') {
    let state;
    let requests;
    let responses;
    
    switch (objectType) {
      case 'counters':
        state = DurableObjectStateFixtures.createCountersState();
        requests = [
          DurableObjectRequestFixtures.createCountersGetRequest(123456),
          DurableObjectRequestFixtures.createCountersIncrementRequest(123456, 'violations', 1)
        ];
        responses = [
          DurableObjectResponseFixtures.createCountersResponse(123456, 5, 12),
          DurableObjectResponseFixtures.createSuccessResponse({ incremented: 1 })
        ];
        break;
        
      case 'message-aggregator':
        state = DurableObjectStateFixtures.createMessageAggregatorState();
        requests = [
          DurableObjectRequestFixtures.createMessageAggregatorProcessRequest(10)
        ];
        responses = [
          DurableObjectResponseFixtures.createMessageAggregatorResponse(10, 0)
        ];
        break;
        
      case 'criminal-analyzer':
        state = DurableObjectStateFixtures.createCriminalCodeAnalyzerState();
        requests = [
          DurableObjectRequestFixtures.createCriminalCodeAnalyzerRequest('Test message', 123456, -1001234567890)
        ];
        responses = [
          DurableObjectResponseFixtures.createCriminalCodeAnalyzerResponse(false)
        ];
        break;
        
      case 'day-block-manager':
        state = DurableObjectStateFixtures.createDayBlockManagerState();
        requests = [
          DurableObjectRequestFixtures.createDayBlockManagerSummaryRequest()
        ];
        responses = [
          DurableObjectResponseFixtures.createDayBlockManagerResponse(15)
        ];
        break;
    }
    
    return {
      state,
      requests,
      responses,
      environment: DurableObjectEnvironmentFixtures.createRealisticEnvironment()
    };
  }

  /**
   * Create test data for specific Durable Object scenarios
   */
  static createScenarioData(scenario: 'high-activity' | 'error-handling' | 'message-processing' | 'analysis') {
    switch (scenario) {
      case 'high-activity':
        return DurableObjectScenarioFixtures.createHighActivityCountersScenario();
        
      case 'error-handling':
        return DurableObjectScenarioFixtures.createErrorHandlingScenario();
        
      case 'message-processing':
        return DurableObjectScenarioFixtures.createMessageProcessingScenario();
        
      case 'analysis':
        return DurableObjectScenarioFixtures.createCriminalAnalysisScenario();
        
      default:
        return this.createCompleteDataset();
    }
  }
}