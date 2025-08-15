# Анализ полей LLM для нарушений УК РФ

## Обзор

Анализ полей, которые возвращает большая языковая модель (LLM) при анализе нарушений Уголовного кодекса РФ, и оценка необходимости их сохранения в системе.

## Поля, возвращаемые LLM

### Интерфейс `CriminalViolation` (из `src/env.ts`)

```typescript
export interface CriminalViolation {
  article: string;          // УК РФ article number only (e.g., "282")
  subarticle: string | null; // Subarticle if exists (e.g., "1" for "282.1"), null otherwise
  articleTitle: string;     // Article title/name
  quote: string;            // Exact quote from text that violates the law
  punishment: string;       // Possible punishment description
  severity: number;         // Severity level 1-10
  confidence: number;       // AI confidence 0.0-1.0
}
```

### Интерфейс `CriminalAnalysisResult`

```typescript
export interface CriminalAnalysisResult {
  hasViolations: boolean;
  violations: CriminalViolation[];
  totalSeverity: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  analysisTimestamp: number;
}
```

## Текущее состояние сохранения

### ✅ Поля, которые СОХРАНЯЮТСЯ в базе данных

1. **`article`** → `article` (TEXT)
2. **`articleTitle`** → `article_title` (TEXT) - добавлено в миграции 0005
3. **`quote`** → `quote` (TEXT)
4. **`punishment`** → `punishment` (TEXT)
5. **`severity`** → `severity` (INTEGER)
6. **`confidence`** → `confidence` (REAL)

### ❌ Поля, которые НЕ СОХРАНЯЮТСЯ

1. **`subarticle`** - подпункт статьи (например, "1" для "282.1")

### 📊 Агрегированные поля (из `CriminalAnalysisResult`)

- **`hasViolations`** - не сохраняется (вычисляется)
- **`totalSeverity`** - не сохраняется (вычисляется как сумма)
- **`riskLevel`** - не сохраняется (вычисляется на основе severity)
- **`analysisTimestamp`** - не сохраняется (используется `created_at`)

## Анализ отсутствующих полей

### 1. Поле `subarticle` 

**Описание**: Подпункт статьи УК РФ (например, "1" для статьи "282.1")

**Текущее состояние**: НЕ сохраняется в базе данных

**Важность**: 🔴 **ВЫСОКАЯ**

**Обоснование**:
- Подпункты статей имеют разные составы преступлений и наказания
- Например, статья 282 (возбуждение ненависти) и 282.1 (организация экстремистского сообщества) - это разные преступления
- Без сохранения подпункта теряется точность юридической квалификации
- Влияет на корректность статистики и аналитики

**Пример различий**:
- Статья 282 УК РФ: штраф до 300 000 рублей
- Статья 282.1 УК РФ: лишение свободы до 6 лет
- Статья 282.2 УК РФ: лишение свободы до 3 лет

**Рекомендация**: ✅ **ДОБАВИТЬ СОХРАНЕНИЕ**

### 2. Дополнительные поля для будущего развития

#### 2.1 Поле `context` (предложение)
**Описание**: Расширенный контекст вокруг нарушения
**Важность**: 🟡 **СРЕДНЯЯ**
**Обоснование**: Может помочь в анализе ложных срабатываний

#### 2.2 Поле `legal_basis` (предложение)
**Описание**: Ссылка на конкретную норму закона
**Важность**: 🟡 **СРЕДНЯЯ**
**Обоснование**: Улучшит качество юридического анализа

#### 2.3 Поле `intent_type` (предложение)
**Описание**: Тип намерения (угроза, призыв, описание действия)
**Важность**: 🟡 **СРЕДНЯЯ**
**Обоснование**: Поможет в классификации нарушений

## Рекомендации по реализации

### 🚀 Приоритет 1: Добавить поле `subarticle`

#### Миграция базы данных
```sql
-- migrations/0006_add_subarticle.sql
ALTER TABLE criminal_violations ADD COLUMN subarticle TEXT;
CREATE INDEX idx_criminal_violations_subarticle ON criminal_violations(subarticle);
```

#### Обновление репозитория
```typescript
// В методе save()
await stmt.bind(
  // ... существующие параметры
  violation.subarticle || null,
  // ... остальные параметры
).run();

// В SQL-запросах статистики
SELECT 
  article,
  subarticle,
  article_title,
  punishment,
  COUNT(*) as count,
  AVG(severity) as average_severity
FROM criminal_violations 
GROUP BY article, subarticle, article_title, punishment
```

#### Обновление интерфейсов
```typescript
// Обновить ViolationCount
export interface ViolationCount {
  article: string;
  subarticle: string | null;  // НОВОЕ ПОЛЕ
  articleTitle: string;
  punishment: string;
  count: number;
  averageSeverity: number;
}
```

#### Обновление форматирования
```typescript
// В message-formatter.ts
const articleDisplay = violation.subarticle 
  ? `${violation.article}.${violation.subarticle}` 
  : violation.article;
```

### 🔄 Приоритет 2: Улучшение группировки статистики

С добавлением `subarticle` нужно обновить логику группировки:

```sql
-- Группировка с учетом подпунктов
GROUP BY article, subarticle, article_title, punishment
ORDER BY count DESC
```

### 📈 Приоритет 3: Аналитика и отчетность

Добавление `subarticle` позволит:
- Более точную статистику по конкретным составам преступлений
- Корректное отображение наказаний
- Лучшую аналитику для модераторов

## Влияние на производительность

### Положительное влияние
- Более точная группировка уменьшит количество дублирующих записей
- Улучшенная индексация по подпунктам

### Потенциальные риски
- Незначительное увеличение размера базы данных
- Необходимость обновления существующих запросов

## План внедрения

### Этап 1: Подготовка (1-2 дня)
1. Создать миграцию для добавления поля `subarticle`
2. Обновить интерфейсы и типы
3. Написать тесты

### Этап 2: Реализация (2-3 дня)
1. Обновить репозиторий для сохранения `subarticle`
2. Обновить SQL-запросы статистики
3. Обновить форматирование сообщений
4. Обновить валидацию

### Этап 3: Тестирование (1-2 дня)
1. Запустить все тесты
2. Проверить миграцию на тестовых данных
3. Проверить корректность отображения

### Этап 4: Развертывание (1 день)
1. Применить миграцию в продакшене
2. Мониторинг работы системы
3. Проверка корректности новых данных

## Заключение

**Критически важно** добавить сохранение поля `subarticle`, так как:

1. **Юридическая точность**: Подпункты статей - это разные составы преступлений
2. **Корректная статистика**: Без подпунктов статистика может быть неточной
3. **Правильные наказания**: Разные подпункты имеют разные наказания
4. **Будущее развитие**: Система станет более гибкой для юридического анализа

Остальные поля (`context`, `legal_basis`, `intent_type`) можно добавить в будущем по мере необходимости, но `subarticle` требует немедленного внимания.