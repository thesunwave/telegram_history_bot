# Design Document

## Overview

This design addresses the "Too many API requests by single worker invocation" error by implementing request batching in the message fetching functions. The solution will limit concurrent KV store requests while maintaining the existing functionality and performance characteristics.

## Architecture

The solution involves modifying the `fetchMessages` and `fetchLastMessages` functions in `src/history.ts` to process KV requests in controlled batches rather than making unlimited concurrent requests.

### Key Components

1. **Batch Processing Engine**: A utility function that processes arrays of async operations in controlled batches
2. **Enhanced Message Fetching**: Modified `fetchMessages` and `fetchLastMessages` functions with batching
3. **Configuration Management**: Environment variables to control batch sizes
4. **Error Handling**: Improved error handling for individual request failures within batches

## Components and Interfaces

### Batch Processing Utility

```typescript
interface BatchProcessorOptions {
  batchSize: number;
  delayBetweenBatches?: number;
}

async function processBatches<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: BatchProcessorOptions
): Promise<R[]>
```

### Environment Configuration

New environment variables to be added to `src/env.ts`:

```typescript
// KV request batching configuration
KV_BATCH_SIZE?: number; // Default: 50
KV_BATCH_DELAY?: number; // Default: 0 (no delay between batches)
```

### Modified History Functions

The `fetchMessages` and `fetchLastMessages` functions will be updated to use the batch processor instead of `Promise.all()` for KV requests.

## Data Models

No changes to existing data models are required. The message storage format (`StoredMessage`) and KV key structure remain unchanged.

## Error Handling

### Individual Request Failures
- Failed individual KV requests will be logged but won't stop the entire batch
- Null/undefined results from failed requests will be filtered out as they currently are
- Partial failures will be reported in debug logs

### Batch Processing Failures
- If an entire batch fails, the error will be logged and re-thrown
- Users will receive the existing error message: "Произошла непредвиденная ошибка при создании сводки"

### API Limit Handling
- Batch sizes will be conservative (default 50) to stay well below API limits
- Optional delays between batches can be configured if needed
- Detailed logging will help identify if limits are still being hit

## Testing Strategy

### Unit Tests
1. **Batch Processor Tests**
   - Test with various batch sizes (1, 10, 50, 100)
   - Test error handling for individual failures
   - Test empty arrays and edge cases

2. **Modified History Function Tests**
   - Test `fetchMessages` with different time ranges
   - Test `fetchLastMessages` with different counts
   - Verify sorting and filtering behavior is preserved
   - Test error scenarios

### Integration Tests
1. **End-to-End Summary Tests**
   - Test `/summary 7` command with large message sets
   - Verify response times stay reasonable
   - Test with different chat sizes and activity levels

2. **Performance Tests**
   - Compare performance before/after batching implementation
   - Measure API request counts in test scenarios
   - Verify no regression for smaller time periods

### Load Testing
- Test with simulated high-volume chats (1000+ messages over 7 days)
- Verify API limits are not exceeded
- Test concurrent summary requests

## Implementation Plan

### Phase 1: Core Batching Utility
1. Create `processBatches` utility function in `src/utils.ts`
2. Add environment variable configuration
3. Write comprehensive unit tests

### Phase 2: History Function Updates
1. Modify `fetchMessages` to use batching
2. Modify `fetchLastMessages` to use batching
3. Preserve existing behavior and error handling
4. Add detailed logging for monitoring

### Phase 3: Testing and Validation
1. Run integration tests with various scenarios
2. Test in development environment with real data
3. Monitor logs for any issues
4. Performance validation

### Phase 4: Deployment and Monitoring
1. Deploy to production with conservative batch sizes
2. Monitor error rates and performance metrics
3. Adjust batch sizes if needed based on operational data

## Configuration Defaults

```typescript
// Conservative defaults to ensure stability
const DEFAULT_KV_BATCH_SIZE = 50;
const DEFAULT_KV_BATCH_DELAY = 0; // No delay initially

// These can be adjusted based on operational experience:
// - Increase batch size if performance is good
// - Add delay if still hitting limits
// - Decrease batch size if seeing timeouts
```

## Monitoring and Observability

Enhanced logging will be added to track:
- Batch processing metrics (batch count, size, duration)
- Individual request failure rates
- Overall function performance
- API request patterns

This will help with future optimization and troubleshooting.