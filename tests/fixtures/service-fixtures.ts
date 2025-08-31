/**
 * Service Test Fixtures
 * Provides realistic test data generators for service layer models
 */

/**
 * Service configuration fixtures
 */
export class ServiceConfigFixtures {
  /**
   * Create base service config
   */
  static createBaseServiceConfig(serviceName: string = 'test-service') {
    return {
      name: serviceName,
      version: '1.0.0',
      enabled: true,
      timeout: 5000, // Reduced from 30000ms
      retries: 3,
      healthCheck: {
        enabled: true,
        interval: 60000,
        timeout: 5000
      },
      logging: {
        level: 'info',
        enabled: true
      },
      metrics: {
        enabled: true,
        interval: 300000
      }
    };
  }

  /**
   * Create violation handler service config
   */
  static createViolationHandlerConfig() {
    return {
      ...this.createBaseServiceConfig('violation-handler'),
      providers: {
        primary: 'openai',
        fallback: 'cloudflare',
        timeout: 5000 // Reduced from 15000ms
      },
      analysis: {
        batchSize: 10,
        maxConcurrency: 5,
        cacheResults: true,
        cacheTTL: 3600000
      },
      thresholds: {
        minConfidence: 0.7,
        maxSeverity: 10,
        criticalSeverity: 8
      }
    };
  }

  /**
   * Create notification service config
   */
  static createNotificationServiceConfig() {
    return {
      ...this.createBaseServiceConfig('notification-service'),
      delivery: {
        maxRetries: 5,
        retryDelay: 1000,
        batchSize: 50,
        rateLimit: {
          requests: 30,
          window: 60000
        }
      },
      templates: {
        cacheEnabled: true,
        cacheTTL: 1800000,
        defaultLanguage: 'ru'
      },
      scheduling: {
        enabled: true,
        maxScheduled: 1000,
        cleanupInterval: 86400000
      }
    };
  }

  /**
   * Create statistics service config
   */
  static createStatisticsServiceConfig() {
    return {
      ...this.createBaseServiceConfig('statistics-service'),
      aggregation: {
        batchSize: 100,
        interval: 300000,
        retention: {
          raw: 2592000000, // 30 days
          hourly: 7776000000, // 90 days
          daily: 31536000000 // 1 year
        }
      },
      cache: {
        enabled: true,
        ttl: 600000, // 10 minutes
        maxSize: 1000
      },
      reporting: {
        enabled: true,
        formats: ['json', 'csv'],
        compression: true
      }
    };
  }
}

/**
 * Service health status fixtures
 */
export class ServiceHealthFixtures {
  /**
   * Create healthy service status
   */
  static createHealthyStatus(serviceName: string = 'test-service') {
    return {
      serviceName,
      status: 'healthy' as const,
      timestamp: new Date(),
      uptime: Math.floor(Math.random() * 86400000) + 3600000, // 1-24 hours
      version: '1.0.0',
      dependencies: {
        database: 'healthy',
        cache: 'healthy',
        providers: 'healthy'
      },
      metrics: {
        requestCount: Math.floor(Math.random() * 1000) + 100,
        errorCount: Math.floor(Math.random() * 5),
        averageResponseTime: Math.floor(Math.random() * 500) + 50,
        memoryUsage: Math.floor(Math.random() * 100) + 50, // MB
        cpuUsage: Math.random() * 50 + 10 // 10-60%
      },
      lastError: null
    };
  }

  /**
   * Create unhealthy service status
   */
  static createUnhealthyStatus(serviceName: string = 'test-service') {
    return {
      serviceName,
      status: 'unhealthy' as const,
      timestamp: new Date(),
      uptime: Math.floor(Math.random() * 3600000), // 0-1 hour
      version: '1.0.0',
      dependencies: {
        database: Math.random() > 0.5 ? 'unhealthy' : 'healthy',
        cache: Math.random() > 0.5 ? 'unhealthy' : 'healthy',
        providers: Math.random() > 0.5 ? 'unhealthy' : 'healthy'
      },
      metrics: {
        requestCount: Math.floor(Math.random() * 100) + 10,
        errorCount: Math.floor(Math.random() * 50) + 20,
        averageResponseTime: Math.floor(Math.random() * 5000) + 2000,
        memoryUsage: Math.floor(Math.random() * 200) + 150, // MB
        cpuUsage: Math.random() * 40 + 60 // 60-100%
      },
      lastError: 'Service dependency failure'
    };
  }

  /**
   * Create degraded service status
   */
  static createDegradedStatus(serviceName: string = 'test-service') {
    return {
      serviceName,
      status: 'degraded' as const,
      timestamp: new Date(),
      uptime: Math.floor(Math.random() * 43200000) + 3600000, // 1-12 hours
      version: '1.0.0',
      dependencies: {
        database: 'healthy',
        cache: Math.random() > 0.5 ? 'degraded' : 'healthy',
        providers: Math.random() > 0.5 ? 'degraded' : 'healthy'
      },
      metrics: {
        requestCount: Math.floor(Math.random() * 500) + 50,
        errorCount: Math.floor(Math.random() * 20) + 5,
        averageResponseTime: Math.floor(Math.random() * 2000) + 1000,
        memoryUsage: Math.floor(Math.random() * 150) + 100, // MB
        cpuUsage: Math.random() * 30 + 50 // 50-80%
      },
      lastError: 'Performance degradation detected'
    };
  }
}

/**
 * Service metrics fixtures
 */
export class ServiceMetricsFixtures {
  /**
   * Create service metrics
   */
  static createServiceMetrics(serviceName: string = 'test-service') {
    const now = new Date();
    const hour = 60 * 60 * 1000;
    
    return {
      serviceName,
      timeRange: {
        start: new Date(now.getTime() - 24 * hour),
        end: now
      },
      requests: {
        total: Math.floor(Math.random() * 10000) + 1000,
        successful: Math.floor(Math.random() * 9000) + 900,
        failed: Math.floor(Math.random() * 500) + 50,
        rate: Math.floor(Math.random() * 100) + 10 // per minute
      },
      performance: {
        averageResponseTime: Math.floor(Math.random() * 1000) + 100,
        p50ResponseTime: Math.floor(Math.random() * 800) + 80,
        p95ResponseTime: Math.floor(Math.random() * 2000) + 500,
        p99ResponseTime: Math.floor(Math.random() * 5000) + 1000
      },
      resources: {
        averageMemoryUsage: Math.floor(Math.random() * 200) + 50, // MB
        peakMemoryUsage: Math.floor(Math.random() * 300) + 100, // MB
        averageCpuUsage: Math.random() * 80 + 10, // 10-90%
        peakCpuUsage: Math.random() * 20 + 80 // 80-100%
      },
      errors: {
        total: Math.floor(Math.random() * 100) + 10,
        rate: Math.random() * 0.1, // 0-10%
        byType: {
          timeout: Math.floor(Math.random() * 20) + 2,
          validation: Math.floor(Math.random() * 15) + 1,
          database: Math.floor(Math.random() * 10) + 1,
          provider: Math.floor(Math.random() * 25) + 3,
          unknown: Math.floor(Math.random() * 5)
        }
      }
    };
  }

  /**
   * Create high-performance metrics
   */
  static createHighPerformanceMetrics(serviceName: string = 'test-service') {
    return {
      ...this.createServiceMetrics(serviceName),
      requests: {
        total: 50000,
        successful: 49500,
        failed: 25,
        rate: 500
      },
      performance: {
        averageResponseTime: 50,
        p50ResponseTime: 40,
        p95ResponseTime: 100,
        p99ResponseTime: 200
      },
      errors: {
        total: 25,
        rate: 0.0005,
        byType: {
          timeout: 5,
          validation: 8,
          database: 2,
          provider: 7,
          unknown: 3
        }
      }
    };
  }

  /**
   * Create poor-performance metrics
   */
  static createPoorPerformanceMetrics(serviceName: string = 'test-service') {
    return {
      ...this.createServiceMetrics(serviceName),
      requests: {
        total: 1000,
        successful: 700,
        failed: 300,
        rate: 10
      },
      performance: {
        averageResponseTime: 5000,
        p50ResponseTime: 3000,
        p95ResponseTime: 10000,
        p99ResponseTime: 20000
      },
      errors: {
        total: 300,
        rate: 0.3,
        byType: {
          timeout: 100,
          validation: 50,
          database: 75,
          provider: 60,
          unknown: 15
        }
      }
    };
  }
}

/**
 * Service registry fixtures
 */
export class ServiceRegistryFixtures {
  /**
   * Create service registry entry
   */
  static createServiceRegistryEntry(serviceName: string = 'test-service') {
    return {
      name: serviceName,
      version: '1.0.0',
      type: 'business-logic',
      status: 'active' as const,
      registeredAt: new Date(Date.now() - Math.random() * 86400000), // Within last 24 hours
      lastHeartbeat: new Date(),
      config: ServiceConfigFixtures.createBaseServiceConfig(serviceName),
      dependencies: [
        'database-service',
        'cache-service'
      ],
      endpoints: [
        `/api/${serviceName}/health`,
        `/api/${serviceName}/metrics`,
        `/api/${serviceName}/config`
      ],
      metadata: {
        owner: 'platform-team',
        environment: 'test',
        region: 'us-east-1'
      }
    };
  }

  /**
   * Create multiple service registry entries
   */
  static createServiceRegistry() {
    return [
      this.createServiceRegistryEntry('violation-handler'),
      this.createServiceRegistryEntry('notification-service'),
      this.createServiceRegistryEntry('statistics-service'),
      this.createServiceRegistryEntry('provider-manager'),
      this.createServiceRegistryEntry('health-monitor')
    ];
  }

  /**
   * Create service dependency graph
   */
  static createServiceDependencyGraph() {
    return {
      'violation-handler': {
        dependencies: ['provider-manager', 'statistics-service'],
        dependents: ['notification-service']
      },
      'notification-service': {
        dependencies: ['violation-handler', 'statistics-service'],
        dependents: []
      },
      'statistics-service': {
        dependencies: ['database-service'],
        dependents: ['violation-handler', 'notification-service']
      },
      'provider-manager': {
        dependencies: ['health-monitor'],
        dependents: ['violation-handler']
      },
      'health-monitor': {
        dependencies: [],
        dependents: ['provider-manager']
      }
    };
  }
}

/**
 * Service event fixtures
 */
export class ServiceEventFixtures {
  /**
   * Create service event
   */
  static createServiceEvent(serviceName: string = 'test-service', eventType: string = 'info') {
    const eventTypes = ['info', 'warning', 'error', 'critical'];
    const type = eventTypes.includes(eventType) ? eventType : eventTypes[Math.floor(Math.random() * eventTypes.length)];
    
    return {
      id: `event_${Math.random().toString(36).substr(2, 9)}`,
      serviceName,
      type,
      timestamp: new Date(),
      message: `Test ${type} event for ${serviceName}`,
      details: {
        component: 'core',
        operation: 'process_request',
        duration: Math.floor(Math.random() * 1000) + 100,
        metadata: {
          requestId: `req_${Math.random().toString(36).substr(2, 9)}`,
          userId: Math.floor(Math.random() * 1000000)
        }
      },
      severity: this.getSeverityForType(type),
      resolved: type === 'info' || Math.random() > 0.3
    };
  }

  /**
   * Create service startup event
   */
  static createStartupEvent(serviceName: string = 'test-service') {
    return this.createServiceEvent(serviceName, 'info').then ? this.createServiceEvent(serviceName, 'info') : {
      ...this.createServiceEvent(serviceName, 'info'),
      message: `Service ${serviceName} started successfully`,
      details: {
        component: 'lifecycle',
        operation: 'startup',
        duration: Math.floor(Math.random() * 5000) + 1000,
        metadata: {
          version: '1.0.0',
          environment: 'test'
        }
      }
    };
  }

  /**
   * Create service error event
   */
  static createErrorEvent(serviceName: string = 'test-service') {
    return {
      ...this.createServiceEvent(serviceName, 'error'),
      message: `Error in ${serviceName}: Operation failed`,
      details: {
        component: 'core',
        operation: 'process_request',
        duration: Math.floor(Math.random() * 2000) + 500,
        error: {
          type: 'ValidationError',
          message: 'Invalid input parameters',
          stack: 'Error: Invalid input parameters\n    at validate (/app/src/service.js:123:45)'
        },
        metadata: {
          requestId: `req_${Math.random().toString(36).substr(2, 9)}`,
          userId: Math.floor(Math.random() * 1000000)
        }
      }
    };
  }

  /**
   * Create service performance warning event
   */
  static createPerformanceWarningEvent(serviceName: string = 'test-service') {
    return {
      ...this.createServiceEvent(serviceName, 'warning'),
      message: `Performance degradation detected in ${serviceName}`,
      details: {
        component: 'performance',
        operation: 'health_check',
        duration: 0,
        metrics: {
          averageResponseTime: 2500,
          errorRate: 0.15,
          memoryUsage: 85
        },
        metadata: {
          threshold: 2000,
          current: 2500
        }
      }
    };
  }

  private static getSeverityForType(type: string): number {
    switch (type) {
      case 'info': return 1;
      case 'warning': return 3;
      case 'error': return 7;
      case 'critical': return 10;
      default: return 1;
    }
  }
}

/**
 * Service operation fixtures
 */
export class ServiceOperationFixtures {
  /**
   * Create service operation result
   */
  static createOperationResult(success: boolean = true, operationName: string = 'test-operation') {
    return {
      operationName,
      success,
      startTime: new Date(Date.now() - Math.random() * 5000),
      endTime: new Date(),
      duration: Math.floor(Math.random() * 5000) + 100,
      result: success ? { data: 'operation completed successfully' } : undefined,
      error: success ? undefined : {
        type: 'OperationError',
        message: 'Operation failed',
        code: 'OP_FAILED'
      },
      metadata: {
        operationId: `op_${Math.random().toString(36).substr(2, 9)}`,
        retryCount: success ? 0 : Math.floor(Math.random() * 3) + 1,
        resourcesUsed: {
          memory: Math.floor(Math.random() * 100) + 10,
          cpu: Math.random() * 50 + 10
        }
      }
    };
  }

  /**
   * Create successful operation result
   */
  static createSuccessfulOperation(operationName: string = 'test-operation') {
    return this.createOperationResult(true, operationName);
  }

  /**
   * Create failed operation result
   */
  static createFailedOperation(operationName: string = 'test-operation') {
    return this.createOperationResult(false, operationName);
  }

  /**
   * Create batch operation result
   */
  static createBatchOperationResult(batchSize: number = 10, successRate: number = 0.8) {
    const successful = Math.floor(batchSize * successRate);
    const failed = batchSize - successful;
    
    return {
      operationName: 'batch-operation',
      success: failed === 0,
      startTime: new Date(Date.now() - Math.random() * 10000),
      endTime: new Date(),
      duration: Math.floor(Math.random() * 10000) + 1000,
      batchSize,
      results: {
        successful,
        failed,
        total: batchSize
      },
      errors: failed > 0 ? Array.from({ length: failed }, (_, i) => ({
        index: i,
        error: 'Item processing failed'
      })) : [],
      metadata: {
        batchId: `batch_${Math.random().toString(36).substr(2, 9)}`,
        processingRate: batchSize / (Math.random() * 10 + 1), // items per second
        resourcesUsed: {
          memory: Math.floor(Math.random() * 500) + 100,
          cpu: Math.random() * 80 + 20
        }
      }
    };
  }
}

/**
 * Comprehensive service fixtures factory
 */
export class ServiceFixtures {
  static readonly Config = ServiceConfigFixtures;
  static readonly Health = ServiceHealthFixtures;
  static readonly Metrics = ServiceMetricsFixtures;
  static readonly Registry = ServiceRegistryFixtures;
  static readonly Event = ServiceEventFixtures;
  static readonly Operation = ServiceOperationFixtures;

  /**
   * Create a complete service test dataset
   */
  static createCompleteDataset(serviceName: string = 'test-service') {
    const config = ServiceConfigFixtures.createBaseServiceConfig(serviceName);
    const health = ServiceHealthFixtures.createHealthyStatus(serviceName);
    const metrics = ServiceMetricsFixtures.createServiceMetrics(serviceName);
    const registryEntry = ServiceRegistryFixtures.createServiceRegistryEntry(serviceName);
    const events = [
      ServiceEventFixtures.createStartupEvent(serviceName),
      ServiceEventFixtures.createServiceEvent(serviceName, 'info'),
      ServiceEventFixtures.createServiceEvent(serviceName, 'warning')
    ];
    const operations = [
      ServiceOperationFixtures.createSuccessfulOperation('process-request'),
      ServiceOperationFixtures.createSuccessfulOperation('validate-input'),
      ServiceOperationFixtures.createBatchOperationResult(20, 0.9)
    ];

    return {
      config,
      health,
      metrics,
      registryEntry,
      events,
      operations
    };
  }

  /**
   * Create test data for specific service scenarios
   */
  static createScenarioData(scenario: 'healthy' | 'unhealthy' | 'degraded' | 'high-load', serviceName: string = 'test-service') {
    switch (scenario) {
      case 'healthy':
        return {
          config: ServiceConfigFixtures.createBaseServiceConfig(serviceName),
          health: ServiceHealthFixtures.createHealthyStatus(serviceName),
          metrics: ServiceMetricsFixtures.createHighPerformanceMetrics(serviceName),
          events: [ServiceEventFixtures.createStartupEvent(serviceName)],
          operations: [ServiceOperationFixtures.createSuccessfulOperation()]
        };

      case 'unhealthy':
        return {
          config: ServiceConfigFixtures.createBaseServiceConfig(serviceName),
          health: ServiceHealthFixtures.createUnhealthyStatus(serviceName),
          metrics: ServiceMetricsFixtures.createPoorPerformanceMetrics(serviceName),
          events: [ServiceEventFixtures.createErrorEvent(serviceName)],
          operations: [ServiceOperationFixtures.createFailedOperation()]
        };

      case 'degraded':
        return {
          config: ServiceConfigFixtures.createBaseServiceConfig(serviceName),
          health: ServiceHealthFixtures.createDegradedStatus(serviceName),
          metrics: ServiceMetricsFixtures.createServiceMetrics(serviceName),
          events: [ServiceEventFixtures.createPerformanceWarningEvent(serviceName)],
          operations: [ServiceOperationFixtures.createBatchOperationResult(10, 0.6)]
        };

      case 'high-load':
        return {
          config: ServiceConfigFixtures.createBaseServiceConfig(serviceName),
          health: ServiceHealthFixtures.createHealthyStatus(serviceName),
          metrics: {
            ...ServiceMetricsFixtures.createServiceMetrics(serviceName),
            requests: { total: 100000, successful: 95000, failed: 5000, rate: 1000 }
          },
          events: [ServiceEventFixtures.createPerformanceWarningEvent(serviceName)],
          operations: [ServiceOperationFixtures.createBatchOperationResult(100, 0.95)]
        };

      default:
        return this.createCompleteDataset(serviceName);
    }
  }
}