# Исправление проблемы "AI analysis timeout" в production

## Диагноз проблемы

**Ошибка в production:**
```
Error: AI analysis timeout at index.js:3342:50
error: "AI analysis timeout"
message: "Profanity analysis: failed with detailed error context"
```

**Причина:**
Таймаут для AI анализа был установлен на крайне низкое значение **50ms**, что недостаточно для реальных AI API запросов, которые обычно занимают от 100ms до нескольких секунд.

**Местоположение проблемы:**
`src/profanity.ts:54` - `ANALYSIS_TIMEOUT = 50`

## Решение

### 1. Увеличение таймаута
Изменил `ANALYSIS_TIMEOUT` с 50ms на **5000ms** (5 секунд):
```typescript
// ДО:
private static readonly ANALYSIS_TIMEOUT = 50; // 50ms timeout for analysis

// ПОСЛЕ:
private static readonly ANALYSIS_TIMEOUT = 5000; // 5 seconds timeout for analysis
```

### 2. Улучшенное логирование
Добавил более информативные логи для отслеживания таймаутов:
```typescript
Logger.error('Profanity AI analysis: timeout exceeded - this indicates AI API is slow or unavailable', { 
  textLength: text.length, 
  duration,
  timeoutThreshold: ProfanityAnalyzer.ANALYSIS_TIMEOUT,
  circuitBreakerFailures: this.circuitBreakerState.failures,
  timeoutRatio: (duration / ProfanityAnalyzer.ANALYSIS_TIMEOUT * 100).toFixed(1) + '%',
  recommendation: 'Check AI provider status or increase timeout if this persists'
});
```

## Контекст архитектуры

**Circuit Breaker:** 
После 5 неудачных попыток (включая таймауты) анализ профанизма временно отключается на 1 минуту для защиты системы.

**Асинхронная обработка:**
Анализ профанизма выполняется асинхронно через `ctx.waitUntil()`, поэтому не блокирует основную обработку сообщений.

## Результат

После применения исправления:
- ✅ AI API запросы больше не будут прерываться по таймауту при нормальной работе
- ✅ Circuit breaker перестанет срабатывать из-за ложных таймаутов
- ✅ Профанизм-анализ снова будет работать в production
- ✅ Улучшенная диагностика для future debugging

## Мониторинг

Для контроля работы системы рекомендую отслеживать:
1. Логи "Profanity AI analysis: timeout exceeded" - не должны появляться часто
2. Логи "Profanity circuit breaker: opening circuit" - индикатор проблем с AI
3. Время выполнения анализа в логах - должно быть < 5000ms в большинстве случаев
