#!/bin/bash
# Скрипт для проверки типизации и статического анализа

echo "🔍 Проверка TypeScript типизации..."
npx tsc --noEmit --skipLibCheck

if [ $? -eq 0 ]; then
    echo "✅ TypeScript типизация корректна"
else
    echo "❌ Найдены ошибки типизации"
    exit 1
fi

echo "🔍 Проверка ESLint..."
npx eslint src/ --ext .ts --max-warnings 0

if [ $? -eq 0 ]; then
    echo "✅ ESLint проверка пройдена"
else
    echo "❌ Найдены проблемы в коде"
    exit 1
fi

echo "🔍 Проверка неиспользуемых импортов..."
npx ts-unused-exports tsconfig.json --excludePathsFromReport="test;spec"

echo "✅ Статический анализ завершен"