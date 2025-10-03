/**
 * Mock AI Provider Implementations
 * Provides comprehensive mock AI providers for testing
 */

import { vi } from 'vitest';
import { ProviderFixtures } from '../fixtures/provider-fixtures';

/**
 * Mock AI Provider Interface
 */
export interface MockAIProvider {
  run(model: string, options: any): Promise<any>;
  getCapabilities(): any;
  getHealth(): any;
  reset(): void;
}

/**
 * Mock Cloudflare AI Implementation
 */
export class MockCloudflareAI implements MockAIProvider {
  private shouldFail = false;
  private failureError = 'AI service unavailable';
  private responseDelay = 0;
  private requestLog: Array<{ model: string; options: any; timestamp: Date }> = [];
  private customResponses = new Map<string, any>();

  public run = vi.fn().mockImplementation(async (model: string, options: any) => {
    await this.simulateDelay();
    this.logRequest(model, options);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    // Check for custom response
    const key = `${model}-${JSON.stringify(options)}`;
    if (this.customResponses.has(key)) {
      return this.customResponses.get(key);
    }

    // Generate response based on request type
    return this.generateResponse(model, options);
  });

  /**
   * Generate appropriate response based on model and options
   */
  private generateResponse(model: string, options: any): any {
    const messages = options.messages || [];
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage?.content || '';

    // Violation analysis
    if (content.includes('analyze for violations') || content.includes('criminal code')) {
      return ProviderFixtures.Response.createCloudflareAIResponse(
        ProviderFixtures.Response.createViolationAnalysisResponse()
      );
    }

    // Profanity detection
    if (content.includes('profanity') || content.includes('inappropriate language')) {
      return ProviderFixtures.Response.createCloudflareAIResponse(
        ProviderFixtures.Response.createProfanityAnalysisResponse()
      );
    }

    // Summary generation
    if (content.includes('summarize') || content.includes('summary')) {
      return ProviderFixtures.Response.createCloudflareAIResponse(
        ProviderFixtures.Response.createSummaryResponse()
      );
    }

    // Default response
    return ProviderFixtures.Response.createCloudflareAIResponse('Mock AI response');
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
  private logRequest(model: string, options: any): void {
    this.requestLog.push({ model, options, timestamp: new Date() });
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): any {
    return ProviderFixtures.Capability.createFullCapabilities();
  }

  /**
   * Get provider health
   */
  getHealth(): any {
    return this.shouldFail 
      ? ProviderFixtures.Health.createUnhealthyStatus('cloudflare-ai')
      : ProviderFixtures.Health.createHealthyStatus('cloudflare-ai');
  }

  /**
   * Configure failure mode
   */
  configureFail(shouldFail: boolean, error: string = 'AI service unavailable'): void {
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
   * Set custom response for specific request
   */
  setCustomResponse(model: string, options: any, response: any): void {
    const key = `${model}-${JSON.stringify(options)}`;
    this.customResponses.set(key, response);
  }

  /**
   * Get request log
   */
  getRequestLog(): Array<{ model: string; options: any; timestamp: Date }> {
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
   * Reset all mocks and state
   */
  reset(): void {
    this.clearRequestLog();
    this.customResponses.clear();
    this.shouldFail = false;
    this.responseDelay = 0;
    vi.clearAllMocks();
  }
}

/**
 * Mock OpenAI Provider Implementation
 */
export class MockOpenAIProvider implements MockAIProvider {
  private shouldFail = false;
  private failureError = 'OpenAI API error';
  private responseDelay = 0;
  private requestLog: Array<{ model: string; options: any; timestamp: Date }> = [];
  private customResponses = new Map<string, any>();
  private rateLimitCount = 0;
  private rateLimitThreshold = 100;

  public run = vi.fn().mockImplementation(async (model: string, options: any) => {
    await this.simulateDelay();
    this.logRequest(model, options);

    // Check rate limit
    this.rateLimitCount++;
    if (this.rateLimitCount > this.rateLimitThreshold) {
      throw new Error('Rate limit exceeded');
    }

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    // Check for custom response
    const key = `${model}-${JSON.stringify(options)}`;
    if (this.customResponses.has(key)) {
      return this.customResponses.get(key);
    }

    // Generate response based on request type
    return this.generateResponse(model, options);
  });

  /**
   * Generate appropriate response based on model and options
   */
  private generateResponse(model: string, options: any): any {
    const messages = options.messages || [];
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage?.content || '';

    // Violation analysis
    if (content.includes('analyze for violations') || content.includes('criminal code')) {
      return ProviderFixtures.Response.createOpenAIResponse(
        ProviderFixtures.Response.createViolationAnalysisResponse()
      );
    }

    // Profanity detection
    if (content.includes('profanity') || content.includes('inappropriate language')) {
      return ProviderFixtures.Response.createOpenAIResponse(
        ProviderFixtures.Response.createProfanityAnalysisResponse()
      );
    }

    // Summary generation
    if (content.includes('summarize') || content.includes('summary')) {
      return ProviderFixtures.Response.createOpenAIResponse(
        ProviderFixtures.Response.createSummaryResponse()
      );
    }

    // Default response
    return ProviderFixtures.Response.createOpenAIResponse('Mock OpenAI response');
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
  private logRequest(model: string, options: any): void {
    this.requestLog.push({ model, options, timestamp: new Date() });
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): any {
    return ProviderFixtures.Capability.createAdvancedCapabilities();
  }

  /**
   * Get provider health
   */
  getHealth(): any {
    return this.shouldFail 
      ? ProviderFixtures.Health.createUnhealthyStatus('openai')
      : ProviderFixtures.Health.createHealthyStatus('openai');
  }

  /**
   * Configure failure mode
   */
  configureFail(shouldFail: boolean, error: string = 'OpenAI API error'): void {
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
   * Set custom response for specific request
   */
  setCustomResponse(model: string, options: any, response: any): void {
    const key = `${model}-${JSON.stringify(options)}`;
    this.customResponses.set(key, response);
  }

  /**
   * Get request log
   */
  getRequestLog(): Array<{ model: string; options: any; timestamp: Date }> {
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
   * Reset all mocks and state
   */
  reset(): void {
    this.clearRequestLog();
    this.customResponses.clear();
    this.shouldFail = false;
    this.responseDelay = 0;
    this.resetRateLimit();
    vi.clearAllMocks();
  }
}

/**
 * Mock Generic AI Provider
 */
export class MockGenericAIProvider implements MockAIProvider {
  private responses: Record<string, any> = {};
  private shouldFail = false;
  private failureError = 'Generic AI error';
  private responseDelay = 0;
  private requestLog: Array<{ model: string; options: any; timestamp: Date }> = [];

  public run = vi.fn().mockImplementation(async (model: string, options: any) => {
    await this.simulateDelay();
    this.logRequest(model, options);

    if (this.shouldFail) {
      throw new Error(this.failureError);
    }

    const key = `${model}-${JSON.stringify(options)}`;
    return this.responses[key] || { response: 'Mock generic AI response' };
  });

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
  private logRequest(model: string, options: any): void {
    this.requestLog.push({ model, options, timestamp: new Date() });
  }

  /**
   * Set response for specific request
   */
  setResponse(model: string, options: any, response: any): void {
    const key = `${model}-${JSON.stringify(options)}`;
    this.responses[key] = response;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): any {
    return ProviderFixtures.Capability.createLimitedCapabilities();
  }

  /**
   * Get provider health
   */
  getHealth(): any {
    return this.shouldFail 
      ? ProviderFixtures.Health.createUnhealthyStatus('generic-ai')
      : ProviderFixtures.Health.createHealthyStatus('generic-ai');
  }

  /**
   * Configure failure mode
   */
  configureFail(shouldFail: boolean, error: string = 'Generic AI error'): void {
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
  getRequestLog(): Array<{ model: string; options: any; timestamp: Date }> {
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
   * Reset all mocks and state
   */
  reset(): void {
    this.clearRequestLog();
    this.responses = {};
    this.shouldFail = false;
    this.responseDelay = 0;
    vi.clearAllMocks();
  }
}

/**
 * AI Provider Mock Factory
 */
export class AIProviderMockFactory {
  /**
   * Create Cloudflare AI mock
   */
  static createCloudflareAI(): MockCloudflareAI {
    return new MockCloudflareAI();
  }

  /**
   * Create OpenAI mock
   */
  static createOpenAI(): MockOpenAIProvider {
    return new MockOpenAIProvider();
  }

  /**
   * Create generic AI mock
   */
  static createGenericAI(): MockGenericAIProvider {
    return new MockGenericAIProvider();
  }

  /**
   * Create AI mock by type
   */
  static createAIProvider(type: 'cloudflare' | 'openai' | 'generic'): MockAIProvider {
    switch (type) {
      case 'cloudflare':
        return this.createCloudflareAI();
      case 'openai':
        return this.createOpenAI();
      case 'generic':
        return this.createGenericAI();
      default:
        return this.createGenericAI();
    }
  }

  /**
   * Create AI provider with specific scenario
   */
  static createScenarioProvider(
    type: 'cloudflare' | 'openai' | 'generic',
    scenario: 'healthy' | 'failing' | 'slow' | 'rate-limited'
  ): MockAIProvider {
    const provider = this.createAIProvider(type);

    switch (scenario) {
      case 'failing':
        provider.configureFail(true, 'AI service is down');
        break;
      case 'slow':
        provider.configureDelay(5000);
        break;
      case 'rate-limited':
        if (provider instanceof MockOpenAIProvider) {
          provider.configureRateLimit(5);
        }
        break;
      case 'healthy':
      default:
        // Provider is healthy by default
        break;
    }

    return provider;
  }

  /**
   * Create multi-provider setup
   */
  static createMultiProviderSetup(): {
    primary: MockAIProvider;
    fallback: MockAIProvider;
    providers: Record<string, MockAIProvider>;
  } {
    const primary = this.createOpenAI();
    const fallback = this.createCloudflareAI();
    
    const providers = {
      'openai': primary,
      'cloudflare': fallback,
      'generic': this.createGenericAI()
    };

    return { primary, fallback, providers };
  }
}

/**
 * AI Provider test helpers
 */
export class AIProviderTestHelpers {
  /**
   * Verify request was made
   */
  static verifyRequest(provider: MockAIProvider, model?: string, contentPattern?: string | RegExp): boolean {
    const log = provider.getRequestLog();
    return log.some(entry => {
      if (model && entry.model !== model) {
        return false;
      }
      
      if (contentPattern) {
        const messages = entry.options.messages || [];
        const content = messages.map((m: any) => m.content).join(' ');
        
        if (typeof contentPattern === 'string') {
          return content.includes(contentPattern);
        }
        return contentPattern.test(content);
      }
      
      return true;
    });
  }

  /**
   * Get requests matching criteria
   */
  static getRequestsMatching(
    provider: MockAIProvider,
    model?: string,
    contentPattern?: string | RegExp
  ): Array<{ model: string; options: any; timestamp: Date }> {
    const log = provider.getRequestLog();
    return log.filter(entry => {
      if (model && entry.model !== model) {
        return false;
      }
      
      if (contentPattern) {
        const messages = entry.options.messages || [];
        const content = messages.map((m: any) => m.content).join(' ');
        
        if (typeof contentPattern === 'string') {
          return content.includes(contentPattern);
        }
        return contentPattern.test(content);
      }
      
      return true;
    });
  }

  /**
   * Assert request count
   */
  static assertRequestCount(provider: MockAIProvider, expectedCount: number): void {
    const actualCount = provider.getRequestCount();
    if (actualCount !== expectedCount) {
      throw new Error(`Expected ${expectedCount} requests, got ${actualCount}`);
    }
  }

  /**
   * Setup violation detection scenario
   */
  static setupViolationDetection(provider: MockAIProvider, hasViolations: boolean = true): void {
    const response = hasViolations 
      ? ProviderFixtures.Response.createViolationAnalysisResponse()
      : JSON.stringify({ hasViolations: false, violations: [], riskLevel: 'low' });

    if (provider instanceof MockCloudflareAI || provider instanceof MockOpenAIProvider) {
      provider.setCustomResponse('test-model', { 
        messages: [{ content: 'analyze for violations' }] 
      }, { response });
    } else if (provider instanceof MockGenericAIProvider) {
      provider.setResponse('test-model', { 
        messages: [{ content: 'analyze for violations' }] 
      }, { response });
    }
  }

  /**
   * Setup profanity detection scenario
   */
  static setupProfanityDetection(provider: MockAIProvider, hasProfanity: boolean = true): void {
    const response = hasProfanity 
      ? ProviderFixtures.Response.createProfanityAnalysisResponse()
      : JSON.stringify({ hasProfanity: false, profanityWords: [], severity: 0 });

    if (provider instanceof MockCloudflareAI || provider instanceof MockOpenAIProvider) {
      provider.setCustomResponse('test-model', { 
        messages: [{ content: 'check for profanity' }] 
      }, { response });
    } else if (provider instanceof MockGenericAIProvider) {
      provider.setResponse('test-model', { 
        messages: [{ content: 'check for profanity' }] 
      }, { response });
    }
  }

  /**
   * Create AI provider with test scenario
   */
  static async withTestProvider<T>(
    type: 'cloudflare' | 'openai' | 'generic',
    scenario: 'healthy' | 'failing' | 'slow' | 'rate-limited',
    testFn: (provider: MockAIProvider) => Promise<T>
  ): Promise<T> {
    const provider = AIProviderMockFactory.createScenarioProvider(type, scenario);
    
    try {
      return await testFn(provider);
    } finally {
      provider.reset();
    }
  }

  /**
   * Test with multiple providers
   */
  static async withMultipleProviders<T>(
    testFn: (providers: { primary: MockAIProvider; fallback: MockAIProvider; providers: Record<string, MockAIProvider> }) => Promise<T>
  ): Promise<T> {
    const setup = AIProviderMockFactory.createMultiProviderSetup();
    
    try {
      return await testFn(setup);
    } finally {
      Object.values(setup.providers).forEach(provider => provider.reset());
    }
  }
}