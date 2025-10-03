/**
 * Mock Telegram API Implementation
 * Provides comprehensive mock Telegram Bot API for testing
 */

import { vi } from 'vitest';

/**
 * Mock Telegram API Response
 */
interface TelegramAPIResponse<T = any> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/**
 * Mock Telegram Message
 */
interface MockTelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    username?: string;
  };
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    username?: string;
  };
  date: number;
  text?: string;
  reply_to_message?: MockTelegramMessage;
}

/**
 * Mock Telegram Update
 */
interface MockTelegramUpdate {
  update_id: number;
  message?: MockTelegramMessage;
  edited_message?: MockTelegramMessage;
  channel_post?: MockTelegramMessage;
  edited_channel_post?: MockTelegramMessage;
}

/**
 * Mock Telegram Bot API
 */
export class MockTelegramAPI {
  private shouldFail = false;
  private failureError = 'Telegram API error';
  private responseDelay = 0;
  private requestLog: Array<{ method: string; params: any; timestamp: Date }> = [];
  private customResponses = new Map<string, any>();
  private rateLimitCount = 0;
  private rateLimitThreshold = 30; // Telegram's rate limit
  private sentMessages: MockTelegramMessage[] = [];
  private messageIdCounter = 1000;

  /**
   * Mock sendMessage method
   */
  public sendMessage = vi.fn().mockImplementation(async (params: {
    chat_id: number | string;
    text: string;
    parse_mode?: string;
    reply_to_message_id?: number;
    reply_markup?: any;
  }) => {
    await this.simulateDelay();
    this.logRequest('sendMessage', params);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    // Check rate limit
    this.rateLimitCount++;
    if (this.rateLimitCount > this.rateLimitThreshold) {
      return this.createErrorResponse(429, 'Too Many Requests: retry after 30');
    }

    // Check for custom response
    const key = `sendMessage-${params.chat_id}`;
    if (this.customResponses.has(key)) {
      return this.customResponses.get(key);
    }

    // Create mock message
    const message: MockTelegramMessage = {
      message_id: this.messageIdCounter++,
      from: {
        id: 123456789,
        is_bot: true,
        first_name: 'Test Bot',
        username: 'testbot'
      },
      chat: {
        id: typeof params.chat_id === 'string' ? parseInt(params.chat_id) : params.chat_id,
        type: params.chat_id.toString().startsWith('-100') ? 'supergroup' : 'private',
        title: 'Test Chat'
      },
      date: Math.floor(Date.now() / 1000),
      text: params.text
    };

    this.sentMessages.push(message);

    return this.createSuccessResponse(message);
  });

  /**
   * Mock editMessageText method
   */
  public editMessageText = vi.fn().mockImplementation(async (params: {
    chat_id?: number | string;
    message_id?: number;
    inline_message_id?: string;
    text: string;
    parse_mode?: string;
    reply_markup?: any;
  }) => {
    await this.simulateDelay();
    this.logRequest('editMessageText', params);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    // Check rate limit
    this.rateLimitCount++;
    if (this.rateLimitCount > this.rateLimitThreshold) {
      return this.createErrorResponse(429, 'Too Many Requests: retry after 30');
    }

    // Find and update message
    const messageIndex = this.sentMessages.findIndex(msg => 
      msg.message_id === params.message_id && 
      msg.chat.id === (typeof params.chat_id === 'string' ? parseInt(params.chat_id) : params.chat_id)
    );

    if (messageIndex >= 0) {
      this.sentMessages[messageIndex].text = params.text;
      return this.createSuccessResponse(this.sentMessages[messageIndex]);
    }

    return this.createErrorResponse(400, 'Bad Request: message not found');
  });

  /**
   * Mock deleteMessage method
   */
  public deleteMessage = vi.fn().mockImplementation(async (params: {
    chat_id: number | string;
    message_id: number;
  }) => {
    await this.simulateDelay();
    this.logRequest('deleteMessage', params);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    // Check rate limit
    this.rateLimitCount++;
    if (this.rateLimitCount > this.rateLimitThreshold) {
      return this.createErrorResponse(429, 'Too Many Requests: retry after 30');
    }

    // Remove message from sent messages
    const messageIndex = this.sentMessages.findIndex(msg => 
      msg.message_id === params.message_id && 
      msg.chat.id === (typeof params.chat_id === 'string' ? parseInt(params.chat_id) : params.chat_id)
    );

    if (messageIndex >= 0) {
      this.sentMessages.splice(messageIndex, 1);
      return this.createSuccessResponse(true);
    }

    return this.createErrorResponse(400, 'Bad Request: message not found');
  });

  /**
   * Mock getMe method
   */
  public getMe = vi.fn().mockImplementation(async () => {
    await this.simulateDelay();
    this.logRequest('getMe', {});

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    return this.createSuccessResponse({
      id: 123456789,
      is_bot: true,
      first_name: 'Test Bot',
      username: 'testbot',
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false
    });
  });

  /**
   * Mock getChat method
   */
  public getChat = vi.fn().mockImplementation(async (params: {
    chat_id: number | string;
  }) => {
    await this.simulateDelay();
    this.logRequest('getChat', params);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const chatId = typeof params.chat_id === 'string' ? parseInt(params.chat_id) : params.chat_id;

    return this.createSuccessResponse({
      id: chatId,
      type: chatId.toString().startsWith('-100') ? 'supergroup' : 'private',
      title: 'Test Chat',
      username: 'testchat',
      description: 'Test chat for unit testing',
      member_count: 42
    });
  });

  /**
   * Mock getChatMember method
   */
  public getChatMember = vi.fn().mockImplementation(async (params: {
    chat_id: number | string;
    user_id: number;
  }) => {
    await this.simulateDelay();
    this.logRequest('getChatMember', params);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    return this.createSuccessResponse({
      user: {
        id: params.user_id,
        is_bot: false,
        first_name: 'Test User',
        username: 'testuser'
      },
      status: 'member'
    });
  });

  /**
   * Mock setWebhook method
   */
  public setWebhook = vi.fn().mockImplementation(async (params: {
    url: string;
    certificate?: any;
    ip_address?: string;
    max_connections?: number;
    allowed_updates?: string[];
    drop_pending_updates?: boolean;
  }) => {
    await this.simulateDelay();
    this.logRequest('setWebhook', params);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    return this.createSuccessResponse(true);
  });

  /**
   * Mock getWebhookInfo method
   */
  public getWebhookInfo = vi.fn().mockImplementation(async () => {
    await this.simulateDelay();
    this.logRequest('getWebhookInfo', {});

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    return this.createSuccessResponse({
      url: 'https://example.com/webhook',
      has_custom_certificate: false,
      pending_update_count: 0,
      max_connections: 40,
      allowed_updates: ['message', 'edited_message']
    });
  });

  /**
   * Create success response
   */
  private createSuccessResponse<T>(result: T): TelegramAPIResponse<T> {
    return {
      ok: true,
      result
    };
  }

  /**
   * Create error response
   */
  private createErrorResponse(errorCode: number, description: string): TelegramAPIResponse {
    return {
      ok: false,
      error_code: errorCode,
      description
    };
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
  private logRequest(method: string, params: any): void {
    this.requestLog.push({ method, params, timestamp: new Date() });
  }

  /**
   * Configure failure mode
   */
  configureFail(shouldFail: boolean, error: string = 'Telegram API error'): void {
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
   * Configure rate limit
   */
  configureRateLimit(threshold: number): void {
    this.rateLimitThreshold = threshold;
  }

  /**
   * Reset rate limit counter
   */
  resetRateLimit(): void {
    this.rateLimitCount = 0;
  }

  /**
   * Set custom response for specific method and chat
   */
  setCustomResponse(method: string, chatId: number | string, response: any): void {
    const key = `${method}-${chatId}`;
    this.customResponses.set(key, response);
  }

  /**
   * Get request log
   */
  getRequestLog(): Array<{ method: string; params: any; timestamp: Date }> {
    return [...this.requestLog];
  }

  /**
   * Clear request log
   */
  clearRequestLog(): void {
    this.requestLog = [];
  }

  /**
   * Get request count
   */
  getRequestCount(): number {
    return this.requestLog.length;
  }

  /**
   * Get sent messages
   */
  getSentMessages(): MockTelegramMessage[] {
    return [...this.sentMessages];
  }

  /**
   * Clear sent messages
   */
  clearSentMessages(): void {
    this.sentMessages = [];
  }

  /**
   * Get messages for specific chat
   */
  getMessagesForChat(chatId: number): MockTelegramMessage[] {
    return this.sentMessages.filter(msg => msg.chat.id === chatId);
  }

  /**
   * Simulate incoming message
   */
  simulateIncomingMessage(message: Partial<MockTelegramMessage>): MockTelegramUpdate {
    const fullMessage: MockTelegramMessage = {
      message_id: this.messageIdCounter++,
      from: {
        id: 987654321,
        is_bot: false,
        first_name: 'Test User',
        username: 'testuser'
      },
      chat: {
        id: -1001234567890,
        type: 'supergroup',
        title: 'Test Chat'
      },
      date: Math.floor(Date.now() / 1000),
      text: 'Test message',
      ...message
    };

    return {
      update_id: Math.floor(Math.random() * 1000000),
      message: fullMessage
    };
  }

  /**
   * Reset all mocks and state
   */
  reset(): void {
    this.clearRequestLog();
    this.clearSentMessages();
    this.customResponses.clear();
    this.shouldFail = false;
    this.responseDelay = 0;
    this.resetRateLimit();
    this.messageIdCounter = 1000;
    vi.clearAllMocks();
  }
}

/**
 * Telegram API Mock Factory
 */
export class TelegramAPIMockFactory {
  /**
   * Create basic Telegram API mock
   */
  static createBasicAPI(): MockTelegramAPI {
    return new MockTelegramAPI();
  }

  /**
   * Create failing Telegram API mock
   */
  static createFailingAPI(error: string = 'Telegram API unavailable'): MockTelegramAPI {
    const api = new MockTelegramAPI();
    api.configureFail(true, error);
    return api;
  }

  /**
   * Create slow Telegram API mock
   */
  static createSlowAPI(delay: number = 2000): MockTelegramAPI {
    const api = new MockTelegramAPI();
    api.configureDelay(delay);
    return api;
  }

  /**
   * Create rate-limited Telegram API mock
   */
  static createRateLimitedAPI(threshold: number = 5): MockTelegramAPI {
    const api = new MockTelegramAPI();
    api.configureRateLimit(threshold);
    return api;
  }

  /**
   * Create Telegram API with specific scenario
   */
  static createScenarioAPI(scenario: 'healthy' | 'failing' | 'slow' | 'rate-limited'): MockTelegramAPI {
    switch (scenario) {
      case 'failing':
        return this.createFailingAPI();
      case 'slow':
        return this.createSlowAPI();
      case 'rate-limited':
        return this.createRateLimitedAPI();
      case 'healthy':
      default:
        return this.createBasicAPI();
    }
  }
}

/**
 * Telegram API test helpers
 */
export class TelegramAPITestHelpers {
  /**
   * Verify API method was called
   */
  static verifyMethodCalled(api: MockTelegramAPI, method: string, chatId?: number): boolean {
    const log = api.getRequestLog();
    return log.some(entry => {
      if (entry.method !== method) {
        return false;
      }
      
      if (chatId !== undefined) {
        const paramChatId = typeof entry.params.chat_id === 'string' 
          ? parseInt(entry.params.chat_id) 
          : entry.params.chat_id;
        return paramChatId === chatId;
      }
      
      return true;
    });
  }

  /**
   * Get method calls matching criteria
   */
  static getMethodCalls(api: MockTelegramAPI, method?: string, chatId?: number): Array<{ method: string; params: any; timestamp: Date }> {
    const log = api.getRequestLog();
    return log.filter(entry => {
      if (method && entry.method !== method) {
        return false;
      }
      
      if (chatId !== undefined) {
        const paramChatId = typeof entry.params.chat_id === 'string' 
          ? parseInt(entry.params.chat_id) 
          : entry.params.chat_id;
        return paramChatId === chatId;
      }
      
      return true;
    });
  }

  /**
   * Assert method call count
   */
  static assertMethodCallCount(api: MockTelegramAPI, method: string, expectedCount: number): void {
    const calls = this.getMethodCalls(api, method);
    if (calls.length !== expectedCount) {
      throw new Error(`Expected ${expectedCount} calls to ${method}, got ${calls.length}`);
    }
  }

  /**
   * Assert message was sent
   */
  static assertMessageSent(api: MockTelegramAPI, chatId: number, textPattern?: string | RegExp): void {
    const messages = api.getMessagesForChat(chatId);
    
    if (messages.length === 0) {
      throw new Error(`No messages sent to chat ${chatId}`);
    }
    
    if (textPattern) {
      const matchingMessages = messages.filter(msg => {
        if (!msg.text) return false;
        
        if (typeof textPattern === 'string') {
          return msg.text.includes(textPattern);
        }
        return textPattern.test(msg.text);
      });
      
      if (matchingMessages.length === 0) {
        throw new Error(`No messages matching pattern sent to chat ${chatId}`);
      }
    }
  }

  /**
   * Assert no messages sent
   */
  static assertNoMessagesSent(api: MockTelegramAPI, chatId?: number): void {
    if (chatId !== undefined) {
      const messages = api.getMessagesForChat(chatId);
      if (messages.length > 0) {
        throw new Error(`Expected no messages to chat ${chatId}, but ${messages.length} were sent`);
      }
    } else {
      const allMessages = api.getSentMessages();
      if (allMessages.length > 0) {
        throw new Error(`Expected no messages sent, but ${allMessages.length} were sent`);
      }
    }
  }

  /**
   * Create Telegram API with test scenario
   */
  static async withTestAPI<T>(
    scenario: 'healthy' | 'failing' | 'slow' | 'rate-limited',
    testFn: (api: MockTelegramAPI) => Promise<T>
  ): Promise<T> {
    const api = TelegramAPIMockFactory.createScenarioAPI(scenario);
    
    try {
      return await testFn(api);
    } finally {
      api.reset();
    }
  }

  /**
   * Simulate conversation flow
   */
  static simulateConversation(api: MockTelegramAPI, messages: Array<{
    from_user: boolean;
    text: string;
    chat_id: number;
    delay?: number;
  }>): MockTelegramUpdate[] {
    const updates: MockTelegramUpdate[] = [];
    
    messages.forEach((msg, index) => {
      if (msg.from_user) {
        // Simulate incoming message from user
        const update = api.simulateIncomingMessage({
          text: msg.text,
          chat: { id: msg.chat_id, type: 'supergroup', title: 'Test Chat' }
        });
        updates.push(update);
      } else {
        // Simulate bot response (this would be handled by the bot logic)
        // For testing purposes, we just record that the bot should respond
      }
    });
    
    return updates;
  }

  /**
   * Wait for API to be ready
   */
  static async waitForAPIReady(api: MockTelegramAPI, timeout: number = 5000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      try {
        const response = await api.getMe();
        if (response.ok) {
          return;
        }
      } catch (error: unknown) {
        // API not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Telegram API did not become ready within timeout');
  }
}