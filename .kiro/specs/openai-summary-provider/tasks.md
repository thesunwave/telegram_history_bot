# Implementation Plan

- [ ] 1. Create AI provider interfaces and base types
  - Create `src/providers/ai-provider.ts` with all interfaces (ChatMessage, TelegramMessage, SummaryRequest, SummaryOptions, ProviderInfo, AIProvider)
  - Define MESSAGE_SEPARATOR constant
  - Create ProviderError class for unified error handling
  - _Requirements: 4.1, 4.3_

- [ ] 2. Implement Cloudflare AI provider wrapper
  - Create `src/providers/cloudflare-provider.ts` implementing AIProvider interface
  - Extract existing Cloudflare AI logic from summary.ts into the provider
  - Implement buildChatMessages method for chat models
  - Add configuration validation for AI binding and SUMMARY_MODEL
  - Write unit tests for CloudflareAIProvider
  - _Requirements: 3.1, 3.2, 3.3, 4.2_

- [ ] 3. Implement OpenAI provider
  - Create `src/providers/openai-provider.ts` implementing AIProvider interface
  - Implement OpenAI Chat Completions API integration with fetch
  - Add proper error handling for OpenAI API responses (401, 429, 500, network errors)
  - Implement configuration validation for OPENAI_API_KEY
  - Write unit tests for OpenAIProvider with mocked fetch calls
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.4_

- [ ] 4. Create provider factory
  - Create `src/providers/provider-factory.ts` with ProviderFactory class
  - Implement createProvider method that returns correct provider based on SUMMARY_PROVIDER env var
  - Add validation for supported provider types
  - Handle default fallback to 'cloudflare' provider
  - Write unit tests for factory with different configurations
  - _Requirements: 1.1, 1.2, 1.3, 4.3_

- [ ] 5. Update environment interface and types
  - Update `src/env.ts` to include new environment variables (SUMMARY_PROVIDER, OPENAI_API_KEY, OPENAI_MODEL)
  - Update `worker-configuration.d.ts` with new environment variables
  - Add type definitions for ProviderType
  - _Requirements: 1.1, 2.1, 2.2, 2.3_

- [ ] 6. Refactor summary functions to use provider abstraction
  - Update `summariseChat` function in `src/summary.ts` to use AIProvider interface
  - Update `summariseChatMessages` function to use AIProvider interface
  - Replace direct AI calls with provider.summarize() calls
  - Update buildAiOptions to work with SummaryOptions interface
  - Ensure all existing functionality remains intact
  - _Requirements: 3.1, 3.2, 3.3, 4.2_

- [ ] 7. Add provider initialization and logging
  - Add provider initialization in main application startup
  - Implement configuration validation on startup
  - Add logging for active provider and model information
  - Add provider information to existing debug logs
  - _Requirements: 1.3, 5.1, 5.2, 5.3_

- [ ] 8. Write integration tests
  - Create integration tests for complete summarization flow with both providers
  - Test provider switching functionality
  - Test error scenarios (missing API keys, invalid configurations)
  - Test chunking functionality with both providers
  - Verify backward compatibility with existing configurations
  - _Requirements: 3.1, 3.2, 3.3, 4.1_

- [ ] 9. Update wrangler configuration example
  - Add example configuration for OpenAI provider in wrangler.jsonc comments
  - Document new environment variables
  - Provide configuration examples for both providers
  - _Requirements: 1.1, 2.1, 2.2, 2.3_