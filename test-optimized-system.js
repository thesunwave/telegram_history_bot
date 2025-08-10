#!/usr/bin/env node

// Простой тест оптимизированной системы без моков

async function testOptimizedSystem() {
  console.log('🔍 Тестируем оптимизированную систему...\n');
  
  try {
    // Импортируем модули
    const { OptimizedSummaryController } = await import('./src/summary-optimization/summary-controller.ts');
    
    // Создаем тестовое окружение
    const mockEnv = {
      HISTORY: {
        list: () => Promise.resolve({
          keys: [
            { name: 'chat:123:1234567890', metadata: { ts: 1234567890 } },
            { name: 'chat:123:1234567891', metadata: { ts: 1234567891 } }
          ]
        }),
        get: () => Promise.resolve(JSON.stringify([
          { text: 'Привет, как дела?', date: 1234567890 },
          { text: 'Хорошо, а у тебя?', date: 1234567891 }
        ]))
      },
      AI: {
        run: () => Promise.resolve('Тестовая суммаризация')
      },
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'Test prompt',
      TOKEN: 'test-token'
    };
    
    console.log('📋 Создаем контроллер...');
    const controller = new OptimizedSummaryController(mockEnv);
    
    console.log('🚀 Тестируем summarizeChat...');
    const result = await controller.summarizeChat(123, 7);
    
    console.log('✅ Результат:', result);
    console.log('📊 Тип результата:', typeof result);
    console.log('📏 Длина результата:', result?.length || 0);
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('📚 Stack trace:', error.stack);
  }
}

// Запускаем тест
testOptimizedSystem();