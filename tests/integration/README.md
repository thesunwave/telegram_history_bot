# Integration Tests

This directory contains comprehensive end-to-end integration tests for the Telegram History Bot.

## Test Coverage

The integration tests cover the following aspects:

### 1. Command Functionality
- **Summary Commands**: `/summary_last`, `/summary` with date ranges
- **Statistics Commands**: `/top` for active users
- **Profanity Commands**: `/profanity_top`, `/profanity_words`, `/my_profanity`, `/profanity_chart_week`, `/profanity_chart_month`, `/profanity_rate`, `/profanity_reset`
- **Activity Commands**: `/activity_week`, `/activity_month`, `/activity users week`
- **Criminal Code Commands**: `/criminal_stats`, `/my_criminal`, `/criminal_top`, `/criminal_reset`
- **Reset Commands**: `/reset` for counters
- **Admin Commands**: `/test_race_conditions` (admin-only)
- **Help Command**: `/help`

### 2. Message Processing
- Regular message analysis for profanity and criminal code violations
- Command message handling (should not be analyzed)
- Empty/null message handling
- Messages without text content

### 3. Data Storage
- Counter storage verification (Durable Objects)
- History storage verification (KV storage)
- Message recording functionality

### 4. Error Handling
- Graceful error handling for various scenarios
- Proper error responses

### 5. Integration Flows
- Complete lifecycle testing for summary commands
- Complete lifecycle testing for statistics commands
- Complete lifecycle testing for message analysis

### 6. Performance & Scalability
- Concurrent command handling
- Multiple simultaneous requests

## Running Tests

```bash
# Run all integration tests
npm test tests/integration/

# Run specific test file
npm test tests/integration/comprehensive-e2e.test.ts
```

## Test Environment

The tests use mocked Cloudflare Workers environment including:
- Mocked KV namespaces (HISTORY, COUNTERS, PROFANITY, CRIMINAL)
- Mocked Durable Objects (COUNTERS_DO, HISTORY_DO)
- Mocked Telegram API responses
- Mocked external services (OpenAI, etc.)

## Notes

- Tests are designed to work with empty data scenarios
- Activity commands may fail gracefully with empty data (expected behavior)
- All tests verify that the system handles edge cases without crashing
- Tests cover both successful operations and error conditions
