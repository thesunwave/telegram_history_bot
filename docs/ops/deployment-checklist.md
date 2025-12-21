# 🚀 Deployment Checklist для Оптимизированного Саммарайза

## Pre-deployment проверки

### ✅ Код готов
- [x] Все тесты проходят (392/392)
- [x] TypeScript ошибки исправлены
- [x] Legacy fallback система работает
- [x] Feature flags настроены

### ✅ Конфигурация
- [x] `SUMMARY_OPT_ENABLED` = true в wrangler.jsonc
- [x] Durable Objects настроены (MESSAGE_FETCHER_DO, MESSAGE_AGGREGATOR_DO)
- [x] Все необходимые переменные окружения установлены

## Deployment Steps

### Шаг 1: Безопасный деплой с отключенной оптимизацией
```bash
# Временно отключаем оптимизацию для безопасности
wrangler secret put SUMMARY_OPT_ENABLED --text "false"
wrangler deploy
```

### Шаг 2: Проверка базовой функциональности
- Протестируйте обычные команды саммарайза
- Убедитесь, что legacy система работает корректно
- Проверьте логи на отсутствие ошибок

### Шаг 3: Включение оптимизации
```bash
# Включаем оптимизированную систему
wrangler secret put SUMMARY_OPT_ENABLED --text "true"
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
wrangler secret put SUMMARY_OPT_MAX_WORKERS --text "3"

# Увеличить размер батча
wrangler secret put SUMMARY_OPT_WORKER_BATCH_SIZE --text "100"
```

### Если много ошибок:
```bash
# Увеличить таймауты
wrangler secret put SUMMARY_OPT_WORKER_TIMEOUT --text "45000"

# Временно отключить параллельную обработку
wrangler secret put SUMMARY_OPT_PARALLEL_ENABLED --text "false"
```

## Rollback план

### В случае критических проблем:
```bash
# Быстрое отключение оптимизации
wrangler secret put SUMMARY_OPT_ENABLED --text "false"

# Система автоматически переключится на legacy
```

### Полный откат к предыдущей версии:
```bash
# Откат к предыдущему деплою
wrangler rollback

# Или деплой стабильной ветки
git checkout main
wrangler deploy
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