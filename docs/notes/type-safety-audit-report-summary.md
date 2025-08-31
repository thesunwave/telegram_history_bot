# Type Safety Audit Report

**Generated:** 2025-08-24T18:01:05.848Z

## Summary

Found 1097 'any' type usages across 64 files (avg: 17.1 per file). Critical: 330, Warning: 419, Info: 348. Priority should be given to critical issues in public APIs and exported functions.

## Severity Breakdown

| Severity | Count | Percentage |
|----------|-------|------------|
| Critical | 330 | 30.1% |
| Warning | 419 | 38.2% |
| Info | 348 | 31.7% |

## Files by Priority

| File | Usage Count | Priority |
|------|-------------|----------|
| src/stats.ts | 81 | High |
| src/message-formatter.ts | 59 | High |
| src/summary.ts | 54 | High |
| src/summary-legacy.ts | 44 | Medium |
| src/summary-optimization/hierarchical-processor.ts | 44 | Medium |
| src/update.ts | 36 | Medium |
| src/models/validation.ts | 34 | Medium |
| src/providers/openai-provider.ts | 31 | Low |
| src/providers/cloudflare-provider.ts | 28 | Low |
| src/profanity.ts | 27 | Low |

*... and 54 more files*

## Critical Issues (Top 10)

### 1. base-service.ts:287

**Type:** AnyKeyword  
**Complexity:** 5  
**Suggestion:** Replace with specific object type or interface  

```typescript
| 'error', message: string, data?: Record<string, any>): void {
    const contextData = {
      service
```

### 2. stats.ts:17

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific object type or interface  

```typescript
cord<string, number> = {};
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
```

### 3. stats.ts:111

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific type based on usage  

```typescript
chats = new Set<number>();
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
```

### 4. stats.ts:392

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific object type or interface  

```typescript
ord<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
```

### 5. stats.ts:441

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific object type or interface  

```typescript
ord<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
```

### 6. stats.ts:834

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific object type or interface  

```typescript
ord<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
```

### 7. day-block-manager.ts:369

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific Promise type: Promise<YourType>  

```typescript
// Save shards
      const promises: Promise<any>[] = [];
      for (let i = affectedStartShard; i
```

### 8. service-health-monitor.ts:59

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific object type or interface  

```typescript
ber;
  error?: string;
  details?: Record<string, any>;
}

/**
 * Service health monitor
 */
export cla
```

### 9. service-config-validator.ts:17

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with typed array: YourType[]  

```typescript
warnings: string[];
  details?: Record<string, any>;
}

/**
 * Service configuration requirements
 *
```

### 10. notification-service.ts:41

**Type:** AnyKeyword  
**Complexity:** 4  
**Suggestion:** Replace with specific Promise type: Promise<YourType>  

```typescript
on(chatId: string, type: NotificationType, data?: any): Promise<string>;
  sendNotification(context: No
```

## Recommendations

1. **Start with Critical Issues**: Focus on public APIs and exported functions first
2. **File-by-File Approach**: Work through files in priority order
3. **Test Coverage**: Ensure tests exist before making type changes
4. **Incremental Changes**: Make small, focused changes to avoid breaking functionality
5. **Runtime Validation**: Add type guards for external data sources

