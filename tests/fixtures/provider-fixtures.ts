/**
 * Provider Test Fixtures
 * Provides realistic test data generators for AI provider models
 */

/**
 * AI Provider response fixtures
 */
export class AIProviderResponseFixtures {
  /**
   * Create OpenAI-style response
   */
  static createOpenAIResponse(content: string = 'Test AI response', overrides: any = {}) {
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content
          },
          finish_reason: 'stop',
          index: 0
        }
      ],
      usage: {
        prompt_tokens: Math.floor(Math.random() * 100) + 50,
        completion_tokens: Math.floor(Math.random() * 200) + 100,
        total_tokens: Math.floor(Math.random() * 300) + 150
      },
      model: 'gpt-3.5-turbo',
      id: `chatcmpl-${Math.random().toString(36).substr(2, 9)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      ...overrides
    };
  }

  /**
   * Create Cloudflare AI response
   */
  static createCloudflareAIResponse(content: string = 'Test AI response', overrides: any = {}) {
    return {
      response: content,
      success: true,
      errors: [],
      messages: [],
      result: {
        response: content
      },
      ...overrides
    };
  }

  /**
   * Create violation analysis response
   */
  static createViolationAnalysisResponse() {
    const hasViolations = Math.random() > 0.5;
    const violations = hasViolations ? [
      {
        article: '282',
        subarticle: null,
        articleTitle: 'Возбуждение ненависти либо вражды',
        quote: 'Призыв к насилию против определенной группы',
        punishment: 'штраф до 300 тысяч рублей',
        severity: 7,
        confidence: 0.85
      }
    ] : [];

    return JSON.stringify({
      hasViolations,
      violations,
      totalSeverity: violations.reduce((sum, v) => sum + v.severity, 0),
      riskLevel: hasViolations ? 'high' : 'low',
      analysisTimestamp: new Date().toISOString()
    });
  }

  /**
   * Create profanity analysis response
   */
  static createProfanityAnalysisResponse() {
    const hasProfanity = Math.random() > 0.6;
    const words = hasProfanity ? ['censored1', 'censored2'] : [];

    return JSON.stringify({
      hasProfanity,
      profanityWords: words,
      severity: hasProfanity ? Math.floor(Math.random() * 5) + 1 : 0,
      confidence: Math.random() * 0.3 + 0.7
    });
  }

  /**
   * Create summary generation response
   */
  static createSummaryResponse() {
    const summaries = [
      'Обсуждение текущих событий в чате',
      'Активная дискуссия по различным темам',
      'Обмен мнениями между участниками',
      'Общение на повседневные темы'
    ];

    return summaries[Math.floor(Math.random() * summaries.length)];
  }

  /**
   * Create error response
   */
  static createErrorResponse(error: string = 'API Error') {
    return {
      error: {
        message: error,
        type: 'api_error',
        code: 'rate_limit_exceeded'
      }
    };
  }

  /**
   * Create rate limit response
   */
  static createRateLimitResponse() {
    return this.createErrorResponse('Rate limit exceeded. Please try again later.');
  }

  /**
   * Create timeout response
   */
  static createTimeoutResponse() {
    return this.createErrorResponse('Request timeout');
  }
}

/**
 * Provider configuration fixtures
 */
export class ProviderConfigFixtures {
  /**
   * Create OpenAI provider config
   */
  static createOpenAIConfig(overrides: any = {}) {
    return {
      type: 'openai',
      apiKey: 'sk-test-key-' + Math.random().toString(36).substr(2, 9),
      model: 'gpt-3.5-turbo',
      maxTokens: 1000,
      temperature: 0.7,
      timeout: 5000, // Reduced from 30000ms
      retries: 3,
      baseURL: 'https://api.openai.com/v1',
      ...overrides
    };
  }

  /**
   * Create Cloudflare AI provider config
   */
  static createCloudflareAIConfig(overrides: any = {}) {
    return {
      type: 'cloudflare',
      accountId: 'test-account-' + Math.random().toString(36).substr(2, 9),
      apiToken: 'test-token-' + Math.random().toString(36).substr(2, 9),
      model: '@cf/meta/llama-2-7b-chat-int8',
      maxTokens: 1000,
      timeout: 5000, // Reduced from 30000ms
      retries: 3,
      ...overrides
    };
  }

  /**
   * Create mock provider config
   */
  static createMockConfig(overrides: any = {}) {
    return {
      type: 'mock',
      delay: 100,
      successRate: 0.9,
      responses: {
        violation: AIProviderResponseFixtures.createViolationAnalysisResponse(),
        profanity: AIProviderResponseFixtures.createProfanityAnalysisResponse(),
        summary: AIProviderResponseFixtures.createSummaryResponse()
      },
      ...overrides
    };
  }
}

/**
 * Provider health status fixtures
 */
export class ProviderHealthFixtures {
  /**
   * Create healthy provider status
   */
  static createHealthyStatus(providerId: string = 'test-provider') {
    return {
      providerId,
      status: 'healthy' as const,
      lastCheck: new Date(),
      responseTime: Math.floor(Math.random() * 500) + 100, // 100-600ms
      successRate: 0.95 + Math.random() * 0.05, // 95-100%
      errorCount: Math.floor(Math.random() * 3), // 0-2 errors
      lastError: null,
      uptime: Math.random() * 100, // 0-100%
      requestCount: Math.floor(Math.random() * 1000) + 100,
      metadata: {
        version: '1.0.0',
        region: 'us-east-1'
      }
    };
  }

  /**
   * Create unhealthy provider status
   */
  static createUnhealthyStatus(providerId: string = 'test-provider') {
    return {
      providerId,
      status: 'unhealthy' as const,
      lastCheck: new Date(),
      responseTime: Math.floor(Math.random() * 5000) + 2000, // 2-7s
      successRate: Math.random() * 0.5, // 0-50%
      errorCount: Math.floor(Math.random() * 20) + 10, // 10-29 errors
      lastError: 'Connection timeout',
      uptime: Math.random() * 50, // 0-50%
      requestCount: Math.floor(Math.random() * 100) + 10,
      metadata: {
        version: '1.0.0',
        region: 'us-east-1'
      }
    };
  }

  /**
   * Create degraded provider status
   */
  static createDegradedStatus(providerId: string = 'test-provider') {
    return {
      providerId,
      status: 'degraded' as const,
      lastCheck: new Date(),
      responseTime: Math.floor(Math.random() * 2000) + 1000, // 1-3s
      successRate: 0.7 + Math.random() * 0.2, // 70-90%
      errorCount: Math.floor(Math.random() * 10) + 5, // 5-14 errors
      lastError: 'Rate limit exceeded',
      uptime: 60 + Math.random() * 30, // 60-90%
      requestCount: Math.floor(Math.random() * 500) + 50,
      metadata: {
        version: '1.0.0',
        region: 'us-east-1'
      }
    };
  }
}

/**
 * Provider metrics fixtures
 */
export class ProviderMetricsFixtures {
  /**
   * Create provider metrics
   */
  static createProviderMetrics(providerId: string = 'test-provider') {
    const now = new Date();
    const hour = 60 * 60 * 1000;
    
    return {
      providerId,
      timeRange: {
        start: new Date(now.getTime() - 24 * hour),
        end: now
      },
      requestCount: Math.floor(Math.random() * 1000) + 100,
      successCount: Math.floor(Math.random() * 900) + 90,
      errorCount: Math.floor(Math.random() * 50) + 5,
      averageResponseTime: Math.floor(Math.random() * 1000) + 200,
      p95ResponseTime: Math.floor(Math.random() * 2000) + 500,
      p99ResponseTime: Math.floor(Math.random() * 5000) + 1000,
      throughput: Math.floor(Math.random() * 100) + 10, // requests per minute
      errorRate: Math.random() * 0.1, // 0-10%
      uptime: 95 + Math.random() * 5, // 95-100%
      costs: {
        totalCost: Math.random() * 100,
        costPerRequest: Math.random() * 0.01,
        currency: 'USD'
      }
    };
  }

  /**
   * Create high-performance metrics
   */
  static createHighPerformanceMetrics(providerId: string = 'test-provider') {
    return this.createProviderMetrics(providerId).then ? this.createProviderMetrics(providerId) : {
      ...this.createProviderMetrics(providerId),
      successCount: 950,
      errorCount: 2,
      averageResponseTime: 150,
      p95ResponseTime: 300,
      p99ResponseTime: 500,
      errorRate: 0.002,
      uptime: 99.9
    };
  }

  /**
   * Create poor-performance metrics
   */
  static createPoorPerformanceMetrics(providerId: string = 'test-provider') {
    return {
      ...this.createProviderMetrics(providerId),
      successCount: 600,
      errorCount: 100,
      averageResponseTime: 3000,
      p95ResponseTime: 8000,
      p99ResponseTime: 15000,
      errorRate: 0.15,
      uptime: 85.5
    };
  }
}

/**
 * Provider request/response fixtures
 */
export class ProviderRequestFixtures {
  /**
   * Create violation analysis request
   */
  static createViolationAnalysisRequest(message: string = 'Test message') {
    return {
      type: 'violation_analysis',
      message,
      chatId: Math.floor(Math.random() * -1000000),
      userId: Math.floor(Math.random() * 1000000),
      timestamp: new Date().toISOString(),
      metadata: {
        messageId: Math.floor(Math.random() * 1000000),
        username: 'testuser'
      }
    };
  }

  /**
   * Create profanity analysis request
   */
  static createProfanityAnalysisRequest(message: string = 'Test message') {
    return {
      type: 'profanity_analysis',
      message,
      chatId: Math.floor(Math.random() * -1000000),
      userId: Math.floor(Math.random() * 1000000),
      timestamp: new Date().toISOString(),
      options: {
        strictMode: false,
        includeContext: true
      }
    };
  }

  /**
   * Create summary generation request
   */
  static createSummaryRequest(messages: string[] = ['Message 1', 'Message 2', 'Message 3']) {
    return {
      type: 'summary_generation',
      messages,
      chatId: Math.floor(Math.random() * -1000000),
      timeRange: {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString()
      },
      options: {
        maxLength: 500,
        includeStats: true,
        language: 'ru'
      }
    };
  }
}

/**
 * Provider capability fixtures
 */
export class ProviderCapabilityFixtures {
  /**
   * Create full capability set
   */
  static createFullCapabilities() {
    return {
      violationAnalysis: true,
      profanityDetection: true,
      summaryGeneration: true,
      languageSupport: ['ru', 'en'],
      maxTokens: 4000,
      streaming: false,
      batchProcessing: true,
      customModels: false,
      fineTuning: false
    };
  }

  /**
   * Create limited capability set
   */
  static createLimitedCapabilities() {
    return {
      violationAnalysis: true,
      profanityDetection: false,
      summaryGeneration: true,
      languageSupport: ['ru'],
      maxTokens: 1000,
      streaming: false,
      batchProcessing: false,
      customModels: false,
      fineTuning: false
    };
  }

  /**
   * Create advanced capability set
   */
  static createAdvancedCapabilities() {
    return {
      violationAnalysis: true,
      profanityDetection: true,
      summaryGeneration: true,
      languageSupport: ['ru', 'en', 'es', 'fr'],
      maxTokens: 8000,
      streaming: true,
      batchProcessing: true,
      customModels: true,
      fineTuning: true,
      multimodal: true,
      functionCalling: true
    };
  }
}

/**
 * Comprehensive provider fixtures factory
 */
export class ProviderFixtures {
  static readonly Response = AIProviderResponseFixtures;
  static readonly Config = ProviderConfigFixtures;
  static readonly Health = ProviderHealthFixtures;
  static readonly Metrics = ProviderMetricsFixtures;
  static readonly Request = ProviderRequestFixtures;
  static readonly Capability = ProviderCapabilityFixtures;

  /**
   * Create a complete provider test dataset
   */
  static createCompleteDataset(providerId: string = 'test-provider') {
    const config = ProviderConfigFixtures.createOpenAIConfig();
    const health = ProviderHealthFixtures.createHealthyStatus(providerId);
    const metrics = ProviderMetricsFixtures.createProviderMetrics(providerId);
    const capabilities = ProviderCapabilityFixtures.createFullCapabilities();
    const responses = {
      violation: AIProviderResponseFixtures.createViolationAnalysisResponse(),
      profanity: AIProviderResponseFixtures.createProfanityAnalysisResponse(),
      summary: AIProviderResponseFixtures.createSummaryResponse()
    };

    return {
      config,
      health,
      metrics,
      capabilities,
      responses
    };
  }

  /**
   * Create test data for specific provider scenarios
   */
  static createScenarioData(scenario: 'healthy' | 'unhealthy' | 'degraded' | 'rate-limited', providerId: string = 'test-provider') {
    switch (scenario) {
      case 'healthy':
        return {
          config: ProviderConfigFixtures.createOpenAIConfig(),
          health: ProviderHealthFixtures.createHealthyStatus(providerId),
          metrics: ProviderMetricsFixtures.createHighPerformanceMetrics(providerId),
          response: AIProviderResponseFixtures.createOpenAIResponse()
        };

      case 'unhealthy':
        return {
          config: ProviderConfigFixtures.createOpenAIConfig(),
          health: ProviderHealthFixtures.createUnhealthyStatus(providerId),
          metrics: ProviderMetricsFixtures.createPoorPerformanceMetrics(providerId),
          response: AIProviderResponseFixtures.createErrorResponse()
        };

      case 'degraded':
        return {
          config: ProviderConfigFixtures.createOpenAIConfig(),
          health: ProviderHealthFixtures.createDegradedStatus(providerId),
          metrics: ProviderMetricsFixtures.createProviderMetrics(providerId),
          response: AIProviderResponseFixtures.createOpenAIResponse()
        };

      case 'rate-limited':
        return {
          config: ProviderConfigFixtures.createOpenAIConfig(),
          health: ProviderHealthFixtures.createDegradedStatus(providerId),
          metrics: ProviderMetricsFixtures.createPoorPerformanceMetrics(providerId),
          response: AIProviderResponseFixtures.createRateLimitResponse()
        };

      default:
        return this.createCompleteDataset(providerId);
    }
  }
}