# Type Replacement Report

**Generated:** 2025-08-24T18:51:22.208Z

## Summary

- **Total Replacements:** 50
- **Files Modified:** 14
- **Skipped Replacements:** 19
- **Errors:** 0

## Modified Files

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/update.ts

**Replacements:** 1

1. **Line 749** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/stats.ts

**Replacements:** 9

1. **Line 20** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

2. **Line 239** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

3. **Line 295** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

4. **Line 395** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

5. **Line 444** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

6. **Line 500** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

7. **Line 734** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

8. **Line 837** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

9. **Line 898** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/race-condition-tests.ts

**Replacements:** 2

1. **Line 57** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

2. **Line 142** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `Error | unknown`
   - **Reasoning:** Error handling should use Error | unknown type

### src/migration-utils.ts

**Replacements:** 1

1. **Line 97** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/message-fetcher-do.ts

**Replacements:** 1

1. **Line 482** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/history-optimized.ts

**Replacements:** 1

1. **Line 127** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

### src/summary-optimization/message-aggregator-utils.ts

**Replacements:** 1

1. **Line 459** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/summary-optimization/hierarchical-processor.ts

**Replacements:** 7

1. **Line 375** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

2. **Line 623** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

3. **Line 624** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

4. **Line 625** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

5. **Line 631** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

6. **Line 632** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

7. **Line 633** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/summary-optimization/direct-processor.ts

**Replacements:** 10

1. **Line 196** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

2. **Line 197** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

3. **Line 198** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

4. **Line 200** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

5. **Line 204** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

6. **Line 212** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

7. **Line 213** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

8. **Line 214** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

9. **Line 216** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

10. **Line 220** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/services/notification-service.ts

**Replacements:** 1

1. **Line 413** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/services/base-service.ts

**Replacements:** 2

1. **Line 71** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `Error | unknown`
   - **Reasoning:** Error handling should use Error | unknown type

2. **Line 72** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `Error | unknown`
   - **Reasoning:** Error handling should use Error | unknown type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/providers/provider-factory.ts

**Replacements:** 2

1. **Line 116** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

2. **Line 132** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/providers/openai-provider.ts

**Replacements:** 10

1. **Line 506** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

2. **Line 506** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

3. **Line 507** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

4. **Line 507** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

5. **Line 508** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

6. **Line 508** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

7. **Line 512** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

8. **Line 512** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

9. **Line 515** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

10. **Line 515** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `OpenAIResponse`
   - **Reasoning:** OpenAI responses should use OpenAIResponse type

### /Users/arturmalev/Documents/Work/test/telegram_history_bot/src/violation-handler.ts

**Replacements:** 2

1. **Line 373** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

2. **Line 415** (Confidence: 80%)
   - **Old:** `any`
   - **New:** `TelegramMessage`
   - **Reasoning:** Telegram messages should use TelegramMessage type

## Next Steps

1. **Compile and Test:** Run TypeScript compiler and tests to ensure no breaking changes
2. **Review Changes:** Manually review all replacements for correctness
3. **Add Imports:** Add necessary import statements for new types
4. **Runtime Validation:** Add runtime type guards where needed
5. **Update Tests:** Update test files to match new type signatures

