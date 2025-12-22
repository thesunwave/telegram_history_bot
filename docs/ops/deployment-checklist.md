# 🚀 Deployment Checklist для Оптимизированного Саммарайза

## Pre-deployment проверки

### ✅ Код готов
- [x] Все тесты проходят (`npm test`)
- [x] TypeScript ошибки исправлены
- [x] Legacy fallback система работает
- [x] Feature flags настроены

### ✅ Конфигурация
- [x] `SUMMARY_OPT_ENABLED` = true в `wrangler.jsonc`
- [x] Durable Objects настроены (COUNTERS_DO, MESSAGE_FETCHER_DO, MESSAGE_AGGREGATOR_DO, DAY_BLOCK_MANAGER_DO, CRIMINAL_CODE_ANALYZER_DO)
- [x] Все необходимые переменные окружения установлены

## Deployment Steps

### Шаг 1: Безопасный деплой с отключенной оптимизацией
```bash
# Временно отключаем оптимизацию для безопасности
# 1) В wrangler.jsonc: SUMMARY_OPT_ENABLED=false
# 2) Деплой
npx wrangler deploy
```

### Шаг 2: Проверка базовой функциональности
- Протестируйте обычные команды саммарайза
- Убедитесь, что legacy система работает корректно
- Проверьте логи на отсутствие ошибок

### Шаг 3: Включение оптимизации
```bash
# Включаем оптимизированную систему
# 1) В wrangler.jsonc: SUMMARY_OPT_ENABLED=true
# 2) Деплой
npx wrangler deploy
```

### Шаг 4: Постепенное тестирование
1. **Малые чаты** (< 100 сообщений) - должны использовать legacy
2. **Средние чаты** (100-500 сообщений) - первые тесты оптимизации
3. **Большие чаты** (500+ сообщений) - полная оптимизация

## Мониторинг после деплоя

### Ключевые метрики для отслеживания:
- Время выполнения саммарайза
- Количество fallback'ов на legacy систему
- Ошибки в Durable Objects
- Использование токенов AI

### Команды для мониторинга:
```bash
# Просмотр логов
wrangler tail

# Просмотр метрик Durable Objects
wrangler d1 execute summaries --command "SELECT * FROM summaries ORDER BY created_at DESC LIMIT 10"
```

## Настройка производительности

### Если система работает медленно:
```bash
# Уменьшить количество параллельных воркеров
# В wrangler.jsonc: SUMMARY_OPT_MAX_WORKERS=3
# Затем деплой
npx wrangler deploy

# Увеличить размер батча
# В wrangler.jsonc: SUMMARY_OPT_WORKER_BATCH_SIZE=100
# Затем деплой
npx wrangler deploy
```

### Если много ошибок:
```bash
# Увеличить таймауты
# В wrangler.jsonc: SUMMARY_OPT_WORKER_TIMEOUT=45000
# Затем деплой
npx wrangler deploy

# Временно отключить параллельную обработку
# В wrangler.jsonc: SUMMARY_OPT_PARALLEL_ENABLED=false
# Затем деплой
npx wrangler deploy
```

## Rollback план

### В случае критических проблем:
```bash
# Быстрое отключение оптимизации
# 1) В wrangler.jsonc: SUMMARY_OPT_ENABLED=false
# 2) Деплой
npx wrangler deploy
```

### Полный откат к предыдущей версии:
```bash
# Откат к предыдущему деплою
npx wrangler rollback

# Или деплой стабильной ветки
git checkout main
npx wrangler deploy
```

## Успешные индикаторы

### ✅ Система работает корректно если:
- Саммарайз генерируется быстрее чем раньше
- Нет ошибок в логах
- Пользователи получают качественные сводки
- Fallback на legacy происходит редко (< 5%)

### ⚠️ Требует внимания если:
- Много fallback'ов на legacy (> 20%)
- Увеличилось время ответа
- Появились новые типы ошибок
- Жалобы пользователей на качество

### 🚨 Критические проблемы:
- Саммарайз не работает вообще
- Массовые ошибки в логах
- Durable Objects недоступны
- Превышение лимитов AI провайдера

## Контакты для поддержки
- Логи: `wrangler tail`
- Метрики: Cloudflare Dashboard
- Durable Objects: `wrangler d1 execute`
