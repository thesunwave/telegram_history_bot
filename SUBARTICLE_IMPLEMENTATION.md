# Реализация поля `subarticle` для нарушений УК РФ

## Обзор

Добавлено поле `subarticle` для корректного сохранения и отображения подпунктов статей Уголовного кодекса РФ. Это критически важное изменение для юридической точности системы.

## Проблема

LLM возвращал поле `subarticle` (например, "1" для статьи "282.1"), но система его не сохраняла, что приводило к:
- Потере юридической точности (282 и 282.1 - разные преступления)
- Неверной группировке в статистике
- Некорректному отображению наказаний

## Реализованные изменения

### 1. База данных

#### Миграция `migrations/0006_add_subarticle.sql`
```sql
-- Добавление поля subarticle
ALTER TABLE criminal_violations ADD COLUMN subarticle TEXT;

-- Индексы для оптимизации
CREATE INDEX idx_criminal_violations_subarticle ON criminal_violations(subarticle);
CREATE INDEX idx_criminal_violations_article_subarticle ON criminal_violations(article, subarticle);
```

### 2. Модели данных

#### Обновлен интерфейс `ViolationCount`
```typescript
export interface ViolationCount {
  article: string;
  subarticle: string | null;  // НОВОЕ ПОЛЕ
  articleTitle: string;
  punishment: string;
  count: number;
  averageSeverity: number;
}
```

### 3. Репозиторий

#### Обновлен `ViolationRepository`
- **Метод `save()`**: Сохраняет `subarticle` в базу данных
- **SQL-запросы**: Извлекают `subarticle` из базы
- **Группировка**: Учитывает подпункты при группировке статистики

```sql
-- Новая группировка с учетом подпунктов
GROUP BY article, subarticle, article_title, punishment
```

### 4. Форматирование сообщений

#### Обновлен `MessageFormatter`
- Добавлена функция `formatFullArticle()` для корректного отображения
- Обновлены все методы статистики для показа подпунктов

```typescript
function formatFullArticle(article: string, subarticle: string | null): string {
  if (subarticle) {
    return `${article}.${subarticle}`;
  }
  return article;
}
```

#### Примеры отображения:
- Статья без подпункта: `Статья 282 УК РФ`
- Статья с подпунктом: `Статья 282.1 УК РФ`

### 5. Валидация

#### Обновлена `validateViolationCount()`
```typescript
if (violationCount.subarticle !== undefined && 
    violationCount.subarticle !== null && 
    typeof violationCount.subarticle !== 'string') {
  throw new ValidationError('subarticle must be a string, null, or undefined', 'subarticle');
}
```

### 6. Тесты

#### Обновлены все существующие тесты:
- `tests/models/statistics.test.ts`
- `tests/models/validation.test.ts`
- `tests/message-formatter.test.ts`
- `tests/services/statistics-service.test.ts`
- `tests/violation-count-fields.test.ts`
- `tests/repositories/violation-repository-fields.test.ts`

#### Добавлены новые тесты:
- Проверка отображения подпунктов
- Валидация поля `subarticle`
- Корректность группировки с подпунктами

## Влияние на систему

### ✅ Положительные изменения:

1. **Юридическая точность**: Различение подпунктов статей
2. **Корректная статистика**: Правильная группировка нарушений
3. **Точные наказания**: Каждый подпункт имеет свое наказание
4. **Улучшенная аналитика**: Более детальная статистика

### 📊 Примеры различий:

| Статья | Название | Наказание |
|--------|----------|-----------|
| 282 | Возбуждение ненависти | Штраф до 300 000 руб |
| 282.1 | Организация экстремистского сообщества | Лишение свободы до 6 лет |
| 282.2 | Участие в экстремистском сообществе | Лишение свободы до 3 лет |

### 🔄 Обратная совместимость:

- Существующие записи работают с `subarticle = null`
- Старый код продолжает функционировать
- Постепенное заполнение новых данных

## Результаты тестирования

Все тесты проходят успешно:
- ✅ `tests/models/statistics.test.ts` (13 тестов)
- ✅ `tests/models/validation.test.ts` (42 теста)
- ✅ `tests/violation-count-fields.test.ts` (7 тестов)
- ✅ `tests/repositories/violation-repository-fields.test.ts` (8 тестов)

## Развертывание

### Шаги для применения:

1. **Применить миграцию**:
   ```bash
   npx wrangler d1 migrations apply summaries
   ```

2. **Развернуть код**:
   ```bash
   npm run deploy
   ```

3. **Проверить работу**:
   - Новые нарушения будут сохраняться с подпунктами
   - Статистика будет корректно группироваться
   - Отображение будет показывать полные номера статей

## Мониторинг

После развертывания следует проверить:
- Корректность сохранения новых нарушений
- Правильность отображения подпунктов в статистике
- Отсутствие ошибок в логах

## Заключение

Реализация поля `subarticle` критически важна для:
- **Юридической корректности** системы
- **Точности статистики** и аналитики
- **Правильного отображения** наказаний
- **Будущего развития** функциональности

Изменения полностью обратно совместимы и не нарушают существующую функциональность.