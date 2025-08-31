/**
 * Providers module exports
 */

// Core provider interfaces and types
export type { 
  AIProvider, 
  ChatMessage, 
  SummaryRequest, 
  SummaryOptions, 
  ProviderInfo, 
  ProfanityAnalysisResult, 
  CriminalAnalysisResult, 
  CriminalViolation, 
  TelegramMessage 
} from './ai-provider';

export { ProviderError, getProfanityPrompts, getCriminalCodePrompts } from './ai-provider';

// Provider implementations
export { CloudflareAIProvider } from './cloudflare-provider';
export { OpenAIProvider } from './openai-provider';
export { MockProvider } from './mock-provider';

// Provider factory and management
export { 
  ProviderFactory, 
  type ProviderType, 
  type ProviderConfigValidation 
} from './provider-factory';

export { 
  ProviderManager, 
  type ProviderConfig, 
  type ProviderManagerConfig, 
  type FailoverStrategy, 
  type RequestContext, 
  type ProviderExecutionResult 
} from './provider-manager';

// Provider health monitoring
export { 
  ProviderHealthMonitor, 
  type ProviderHealthStatus, 
  type ProviderMetrics, 
  type ProviderHealthReport, 
  type ProviderCapabilities, 
  type HealthCheckConfig 
} from './provider-health-monitor';