# 📊 Команды для мониторинга оптимизированного саммарайза

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
npx wrangler secret put SUMMARY_OPT_WORKER_TIMEOUT --text "45000"  # Увеличить таймаут
npx wrangler secret put SUMMARY_OPT_MAX_WORKERS --text "3"        # Уменьшить нагрузку
```

### Проблема: Медленная работа
```bash
# Оптимизация параллельной обработки
npx wrangler secret put SUMMARY_OPT_WORKER_BATCH_SIZE --text "100"  # Больше сообщений на воркер
npx wrangler secret put SUMMARY_OPT_MAX_WORKERS --text "3"          # Меньше параллельных воркеров
```

### Проблема: Ошибки Durable Objects
```bash
# Проверить статус DO
npx wrangler tail | grep -i "durable\|aggregator\|fetcher"

# Временно отключить параллельную обработку
npx wrangler secret put SUMMARY_OPT_PARALLEL_ENABLED --text "false"
```

## Команды для настройки производительности

### Консервативные настройки (для начала)
```bash
npx wrangler secret put SUMMARY_OPT_MAX_WORKERS --text "2"
npx wrangler secret put SUMMARY_OPT_WORKER_BATCH_SIZE --text "30"
npx wrangler secret put SUMMARY_OPT_WORKER_TIMEOUT --text "45000"
npx wrangler secret put SUMMARY_OPT_MIN_MESSAGES_THRESHOLD --text "150"
```

### Агрессивные настройки (после стабилизации)
```bash
npx wrangler secret put SUMMARY_OPT_MAX_WORKERS --text "8"
npx wrangler secret put SUMMARY_OPT_WORKER_BATCH_SIZE --text "100"
npx wrangler secret put SUMMARY_OPT_WORKER_TIMEOUT --text "30000"
npx wrangler secret put SUMMARY_OPT_MIN_MESSAGES_THRESHOLD --text "50"
```

## Экстренные команды

### Быстрое отключение оптимизации
```bash
npx wrangler secret put SUMMARY_OPT_ENABLED --text "false"
```

### Отключение только параллельной обработки
```bash
npx wrangler secret put SUMMARY_OPT_PARALLEL_ENABLED --text "false"
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