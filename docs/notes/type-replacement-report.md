# Type Replacement Report

**Generated:** 2025-08-24T18:51:54.076Z

## Summary

- **Total Replacements:** 10
- **Files Modified:** 2
- **Skipped Replacements:** 0
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

## Next Steps

1. **Compile and Test:** Run TypeScript compiler and tests to ensure no breaking changes
2. **Review Changes:** Manually review all replacements for correctness
3. **Add Imports:** Add necessary import statements for new types
4. **Runtime Validation:** Add runtime type guards where needed
5. **Update Tests:** Update test files to match new type signatures

