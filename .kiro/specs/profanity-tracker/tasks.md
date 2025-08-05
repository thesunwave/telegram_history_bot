# Implementation Plan

- [x] 1. Create core profanity analysis infrastructure
  - Set up ProfanityAnalyzer class with AI integration
  - Implement text hashing for cache keys
  - Create interfaces and types for profanity detection
  - _Requirements: 3.1, 3.4, 6.3_

- [x] 2. Implement AI provider integration for profanity detection
  - [x] 2.1 Create profanity analysis prompt templates
    - Write Russian language prompt for profanity detection
    - Include instructions for base form extraction
    - Add JSON response format specification
    - _Requirements: 3.2, 9.1, 9.4_

  - [x] 2.2 Extend existing AI providers with profanity analysis
    - Add analyzeProfanity method to OpenAI provider
    - Add analyzeProfanity method to Cloudflare provider
    - Implement response parsing and validation
    - _Requirements: 3.1, 3.4, 9.4_

  - [x] 2.3 Implement caching mechanism for AI responses
    - Create cache key generation from text hash
    - Implement cache storage and retrieval in KV
    - Add TTL management for cached results
    - _Requirements: 3.6, 6.1_

- [ ] 3. Create profanity counter system
  - [ ] 3.1 Extend Counters DO with profanity tracking
    - Add profanity counter increment methods
    - Implement user profanity counters (profanity:chat:user:day)
    - Implement word profanity counters (profanity_words:chat:word:day)
    - _Requirements: 3.3, 4.2_

  - [ ] 3.2 Integrate profanity analysis into message recording
    - Modify recordMessage function to call profanity analyzer
    - Add async profanity processing with ctx.waitUntil
    - Implement error handling for AI failures
    - _Requirements: 3.3, 3.5, 6.1_

- [ ] 4. Implement profanity statistics and commands
  - [ ] 4.1 Create profanity statistics functions
    - Implement getTopUsers function for profanity rankings
    - Implement getTopWords function for word statistics
    - Implement getUserStats function for personal statistics
    - Add period filtering (today, week, month)
    - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 8.2, 8.3_

  - [ ] 4.2 Add profanity top users command (/profanity_top)
    - Parse command parameters (count, period)
    - Fetch and format user statistics
    - Handle empty data cases
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ] 4.3 Add profanity words statistics command (/profanity_words)
    - Parse command parameters (count, period)
    - Implement word grouping by base forms
    - Add word censoring for display
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ] 4.4 Add personal profanity statistics command (/my_profanity)
    - Implement user-specific statistics retrieval
    - Format statistics for different periods
    - Handle users with no profanity data
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 5. Implement profanity charts and visualization
  - [ ] 5.1 Create profanity activity charts
    - Add /profanity_chart_week command
    - Add /profanity_chart_month command
    - Implement ASCII chart fallback for small datasets
    - _Requirements: 2.1, 2.2, 2.4_

  - [ ] 5.2 Integrate with QuickChart API for profanity graphs
    - Create chart configuration for profanity data
    - Implement chart URL generation
    - Add error handling for chart generation failures
    - _Requirements: 2.3_

- [ ] 6. Add profanity reset functionality
  - [ ] 6.1 Implement profanity-specific reset command
    - Add /profanity_reset command handler
    - Clear profanity user counters for chat
    - Clear profanity word counters for chat
    - _Requirements: 4.1, 4.2_

  - [ ] 6.2 Integrate profanity reset with general reset
    - Modify existing resetCounters function
    - Include profanity counters in general reset
    - _Requirements: 4.3_

- [ ] 7. Add comprehensive error handling and logging
  - [ ] 7.1 Implement profanity-specific logging
    - Add logging for profanity detection events (without actual words)
    - Log AI provider errors and fallbacks
    - Log counter update successes and failures
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ] 7.2 Add debug logging for profanity analysis
    - Log detailed analysis process in debug mode
    - Include timing information for performance monitoring
    - Add cache hit/miss logging
    - _Requirements: 7.4_

- [ ] 8. Implement performance optimizations
  - [ ] 8.1 Add text length limiting for analysis
    - Limit analysis to first 1000 characters
    - Add logging for truncated messages
    - _Requirements: 6.4_

  - [ ] 8.2 Implement analysis timeout protection
    - Add 50ms timeout for profanity analysis
    - Implement graceful degradation on timeout
    - _Requirements: 6.1_

  - [ ] 8.3 Add circuit breaker for AI failures
    - Track AI failure rates
    - Temporarily disable analysis on high failure rates
    - Implement recovery mechanism
    - _Requirements: 3.5_

- [ ] 9. Update help system and documentation
  - [ ] 9.1 Add profanity commands to help text
    - Update HELP_TEXT constant with new commands
    - Include parameter descriptions
    - Add usage examples
    - _Requirements: 1.1, 2.1, 4.1, 5.1, 8.1_

  - [ ] 9.2 Create command parameter validation
    - Validate numeric parameters for commands
    - Add parameter limit enforcement
    - Provide helpful error messages
    - _Requirements: 1.2, 8.2_

- [ ] 10. Write comprehensive tests
  - [ ] 10.1 Create unit tests for profanity analyzer
    - Test AI response parsing
    - Test caching functionality
    - Test error handling scenarios
    - Mock AI provider responses
    - _Requirements: 3.1, 3.2, 3.5, 3.6_

  - [ ] 10.2 Create unit tests for profanity statistics
    - Test top users calculation
    - Test top words calculation
    - Test personal statistics
    - Test word censoring
    - _Requirements: 1.1, 5.1, 8.4, 8.6_

  - [ ] 10.3 Create integration tests for profanity system
    - Test end-to-end message processing
    - Test command handling
    - Test AI provider integration
    - Test performance under load
    - _Requirements: 6.1, 7.1_