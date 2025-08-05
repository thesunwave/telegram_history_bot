# Исправление проблемы "AI analysis timeout" в production

## Диагноз проблемы

**Ошибка в production:**
```
Error: AI analysis timeout at index.js:3342:50
error: "AI analysis timeout"
message: "Profanity analysis: failed with detailed error context"
```

**Причина:**
Таймаут для AI анализа был установлен на крайне низкое значение **50ms**, что недостаточно для реальных AI API запросов, которые обычно занимают от 100ms до нескольких секунд. После первого исправления до 5 секунд, производительность Cloudflare Workers AI оказалась ещё хуже - запросы могут занимать до 5+ секунд.

**Местоположение проблемы:**
`src/profanity.ts:54` - `ANALYSIS_TIMEOUT = 50` → `5000` → `10000`

## Решение

### 1. Увеличение таймаута до безопасного значения
Изменил `ANALYSIS_TIMEOUT` с 50ms → 5000ms → **10000ms** (10 секунд):
```typescript
// ФИНАЛЬНАЯ ВЕРСИЯ:
private static readonly ANALYSIS_TIMEOUT = 10000; // 10 seconds timeout for analysis
```

### 2. Улучшенное логирование производительности
Добавил детальную аналитику производительности AI API:
```typescript
Logger.debug(env, 'Profanity AI analysis: completed', {
  duration,
  wordsFound: finalResult.totalCount,
  uniqueWords: finalResult.words.length,
  performanceRating: duration < 1000 ? 'excellent' : duration < 3000 ? 'good' : duration < 7000 ? 'acceptable' : 'slow',
  timeoutUtilization: (duration / ProfanityAnalyzer.ANALYSIS_TIMEOUT * 100).toFixed(1) + '%'
});
```

### 3. Расширенная диагностика таймаутов
Улучшил логирование таймаутов для лучшей диагностики:
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

## Контекст производительности

**Реальные данные из production:**
- Некоторые запросы занимают **5146ms** (5.146 секунд) для анализа всего 10 символов
- Cloudflare Workers AI может быть медленным или перегруженным
- Circuit breaker активируется при частых таймаутах

**Новая шкала производительности:**
- **< 1 секунда**: отлично
- **1-3 секунды**: хорошо  
- **3-7 секунд**: приемлемо
- **7-10 секунд**: медленно, но допустимо
- **> 10 секунд**: таймаут

## Результат

После применения исправления:
- ✅ AI API запросы до 10 секунд больше не будут прерываться по таймауту
- ✅ Circuit breaker будет срабатывать только при реальных проблемах
- ✅ Детальная диагностика производительности AI провайдеров
- ✅ Профанизм-анализ будет стабильно работать в production

## Мониторинг

Для контроля работы системы отслеживайте:
1. **Время выполнения**: большинство запросов должны быть < 7 секунд
2. **Таймауты**: редкие случаи > 10 секунд в логах
3. **Circuit breaker**: срабатывание указывает на проблемы с AI API
4. **Performance rating**: соотношение excellent/good/acceptable/slow запросов
