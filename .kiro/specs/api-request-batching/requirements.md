# Requirements Document

## Introduction

The Telegram history bot is experiencing "Too many API requests by single worker invocation" errors when processing `/summary 7` commands. This occurs because the current implementation makes too many concurrent KV store requests when fetching messages for longer time periods (7 days), exceeding Cloudflare Workers' API request limits.

## Requirements

### Requirement 1

**User Story:** As a user, I want to be able to request 7-day summaries without encountering API limit errors, so that I can get comprehensive chat summaries for longer periods.

#### Acceptance Criteria

1. WHEN a user requests `/summary 7` THEN the system SHALL process the request without hitting API request limits
2. WHEN fetching messages for any time period THEN the system SHALL batch KV store requests to stay within Cloudflare Workers limits
3. WHEN processing large message sets THEN the system SHALL maintain reasonable response times (under 30 seconds)

### Requirement 2

**User Story:** As a system administrator, I want the message fetching process to be resilient and efficient, so that the bot can handle high-volume chats without errors.

#### Acceptance Criteria

1. WHEN fetching messages from KV store THEN the system SHALL limit concurrent requests to a safe threshold (e.g., 50-100 concurrent requests)
2. WHEN processing message batches THEN the system SHALL implement proper error handling for individual request failures
3. WHEN encountering API limits THEN the system SHALL provide meaningful error messages to users
4. WHEN fetching messages THEN the system SHALL maintain the same filtering and sorting behavior as the current implementation

### Requirement 3

**User Story:** As a developer, I want the batching implementation to be configurable and maintainable, so that we can adjust limits based on operational experience.

#### Acceptance Criteria

1. WHEN implementing request batching THEN the system SHALL use configurable batch sizes via environment variables
2. WHEN batching requests THEN the system SHALL provide detailed logging for monitoring and debugging
3. WHEN processing batches THEN the system SHALL maintain backward compatibility with existing message storage format
4. WHEN implementing the solution THEN the system SHALL not break existing functionality for shorter time periods (1-3 days)