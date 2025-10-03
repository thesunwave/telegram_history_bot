#!/bin/bash
# Комплексная проверка системы

set -e

echo "🔍 Запуск комплексной проверки системы..."
echo "================================================"

# 1. Статический анализ
echo "📝 Этап 1: Статический анализ"
./scripts/verify-types.sh

# 2. Smoke тесты
echo ""
echo "🚀 Этап 2: Smoke тесты"
npx ts-node scripts/smoke-test.ts

# 3. Проверка существующих тестов
echo ""
echo "🧪 Этап 3: Запуск доступных тестов"
npm test -- --run --reporter=verbose tests/html-formatting-integration.test.ts tests/message-formatter.test.ts tests/models/validation.test.ts tests/html-builder.test.ts

# 4. Проверка сборки
echo ""
echo "🏗️ Этап 4: Проверка сборки"
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Сборка успешна"
else
    echo "❌ Ошибка сборки"
    exit 1
fi

echo ""
echo "🎉 Комплексная проверка завершена успешно!"
echo "================================================"
echo ""
echo "📋 Следующие шаги:"
echo "1. Выполните ручное тестирование по docs/manual-testing-guide.md"
echo "2. Проверьте Health Check endpoint после развертывания"
echo "3. Мониторьте логи в первые часы после развертывания"
echo ""
echo "🚀 Система готова к развертыванию!"