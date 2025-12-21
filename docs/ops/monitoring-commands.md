# 📊 Команды для мониторинга оптимизированного саммарайза

Все параметры оптимизации задаются в `wrangler.jsonc`. После изменений выполняйте `npx wrangler deploy`.

## Основные команды мониторинга

### Просмотр логов в реальном времени
```bash
# Красивый формат логов
npx wrangler tail --format=pretty

# Фильтр только ошибок
npx wrangler tail --format=pretty | grep -i error

# Фильтр логов оптимизации
npx wrangler tail --format=pretty | grep -i "optimized\|legacy\|fallback"
```

### Проверка состояния Durable Objects
```bash
# Список активных DO
npx wrangler d1 execute summaries --command "SELECT COUNT(*) as total_summaries FROM summaries WHERE created_at > datetime('now', '-1 hour')"

# Последние сводки
npx wrangler d1 execute summaries --command "SELECT chat_id, period_start, period_end, length(summary) as summary_length FROM summaries ORDER BY created_at DESC LIMIT 10"
```

## Ключевые метрики для отслеживания

### 1. Производительность
- **Время выполнения**: Должно быть меньше чем в legacy системе
- **Успешность**: > 95% успешных саммарайзов
- **Fallback rate**: < 5% переключений на legacy

### 2. Качество
- **Длина сводок**: Соответствует ожиданиям
- **Релевантность**: Пользователи довольны результатами
- **Ошибки AI**: Минимальные проблемы с провайдерами

### 3. Ресурсы
- **Использование токенов**: Оптимальное для выбранного провайдера
- **Durable Objects**: Стабильная работа без ошибок
- **Memory usage**: В пределах лимитов Cloudflare

## Типичные проблемы и решения

### Проблема: Много fallback'ов на legacy
```bash
# Проверить логи на ошибки
npx wrangler tail | grep -i "fallback\|error"

# Возможные решения:
# В wrangler.jsonc:
# SUMMARY_OPT_WORKER_TIMEOUT=45000  # Увеличить таймаут
# SUMMARY_OPT_MAX_WORKERS=3         # Уменьшить нагрузку
npx wrangler deploy
```

### Проблема: Медленная работа
```bash
# Оптимизация параллельной обработки
# В wrangler.jsonc:
# SUMMARY_OPT_WORKER_BATCH_SIZE=100  # Больше сообщений на воркер
# SUMMARY_OPT_MAX_WORKERS=3          # Меньше параллельных воркеров
npx wrangler deploy
```

### Проблема: Ошибки Durable Objects
```bash
# Проверить статус DO
npx wrangler tail | grep -i "durable\|aggregator\|fetcher"

# Временно отключить параллельную обработку
# В wrangler.jsonc: SUMMARY_OPT_PARALLEL_ENABLED=false
npx wrangler deploy
```

## Команды для настройки производительности

### Консервативные настройки (для начала)
```bash
# В wrangler.jsonc:
# SUMMARY_OPT_MAX_WORKERS=2
# SUMMARY_OPT_WORKER_BATCH_SIZE=30
# SUMMARY_OPT_WORKER_TIMEOUT=45000
# SUMMARY_OPT_MIN_MESSAGES_THRESHOLD=150
npx wrangler deploy
```

### Агрессивные настройки (после стабилизации)
```bash
# В wrangler.jsonc:
# SUMMARY_OPT_MAX_WORKERS=8
# SUMMARY_OPT_WORKER_BATCH_SIZE=100
# SUMMARY_OPT_WORKER_TIMEOUT=30000
# SUMMARY_OPT_MIN_MESSAGES_THRESHOLD=50
npx wrangler deploy
```

## Экстренные команды

### Быстрое отключение оптимизации
```bash
# В wrangler.jsonc: SUMMARY_OPT_ENABLED=false
npx wrangler deploy
```

### Отключение только параллельной обработки
```bash
# В wrangler.jsonc: SUMMARY_OPT_PARALLEL_ENABLED=false
npx wrangler deploy
```

### Полный откат к предыдущей версии
```bash
npx wrangler rollback
```

## Полезные алиасы для .bashrc/.zshrc

```bash
# Добавьте в ваш .bashrc или .zshrc
alias wtail='npx wrangler tail --format=pretty'
alias werror='npx wrangler tail --format=pretty | grep -i error'
alias wopt='npx wrangler tail --format=pretty | grep -i "optimized\|legacy\|fallback"'
alias wstats='npx wrangler d1 execute summaries --command "SELECT COUNT(*) as total FROM summaries WHERE created_at > datetime(\"now\", \"-1 hour\")"'
```
