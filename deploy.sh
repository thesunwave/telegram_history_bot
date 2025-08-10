#!/bin/bash

# 🚀 Безопасный деплой оптимизированного саммарайза
# Этот скрипт выполняет поэтапное развертывание с проверками

set -e  # Остановка при ошибке

echo "🚀 Начинаем безопасный деплой оптимизированного саммарайза..."

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для вывода цветного текста
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Проверка готовности
print_status "Проверяем готовность к деплою..."

# Проверка тестов
print_status "Запускаем тесты..."
if npm test; then
    print_success "Все тесты прошли успешно!"
else
    print_error "Тесты не прошли! Деплой отменен."
    exit 1
fi

# Проверка TypeScript
print_status "Проверяем типы TypeScript..."
if npx tsc --noEmit; then
    print_success "Проверка типов прошла успешно!"
else
    print_error "Ошибки TypeScript! Деплой отменен."
    exit 1
fi

# Этап 1: Деплой с отключенной оптимизацией
print_status "Этап 1: Деплой с отключенной оптимизацией для безопасности..."
echo "false" | npx wrangler secret put SUMMARY_OPT_ENABLED

print_status "Выполняем деплой..."
if npx wrangler deploy; then
    print_success "Деплой выполнен успешно!"
else
    print_error "Ошибка деплоя!"
    exit 1
fi

# Пауза для стабилизации
print_status "Ждем стабилизации системы (30 секунд)..."
sleep 30

# Этап 2: Включение оптимизации
print_warning "Готовы включить оптимизированную систему?"
print_warning "Убедитесь, что базовая функциональность работает корректно."
read -p "Продолжить? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Этап 2: Включаем оптимизированную систему..."
    echo "true" | npx wrangler secret put SUMMARY_OPT_ENABLED
    print_success "Оптимизированная система включена!"
else
    print_warning "Деплой остановлен пользователем. Система работает в legacy режиме."
    exit 0
fi

# Финальные инструкции
print_success "🎉 Деплой завершен успешно!"
echo
print_status "Следующие шаги:"
echo "1. Мониторьте логи: wrangler tail"
echo "2. Тестируйте саммарайз на разных чатах"
echo "3. Следите за метриками производительности"
echo
print_status "Для отключения оптимизации в случае проблем:"
echo "npx wrangler secret put SUMMARY_OPT_ENABLED --text \"false\""
echo
print_status "Для мониторинга:"
echo "npx wrangler tail --format=pretty"