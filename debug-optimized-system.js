#!/usr/bin/env node

// Простой тест для отладки оптимизированной системы

const { vi } = require('vitest');

async function testOptimizedSystem() {
  console.log('🔍 Отладка оптимизированной системы...\n');
  
  try {
    // Импортируем модули
    const { summariseChat } = await import('./src/summary.js');
    const { sendMessage } = await import('./src/telegram.js');
    
    // Создаем мок окружения
    const mockEnv = {
      HISTORY: {},
      AI: {
        run: vi.fn().mockResolvedValue('Legacy AI response')
      },
      SUMMARY_OPT_ENABLED: 'true', // Включаем оптимизированную систему
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'Test prompt',
      TOKEN: 'test-token'
    };
    
    // Мокаем sendMessage
    vi.mocked(sendMessage).mockResolvedValue();
    
    console.log('📋 Тестовое окружение создано');
    console.log('🔧 SUMMARY_OPT_ENABLED:', mockEnv.SUMMARY_OPT_ENABLED);
    
    // Пытаемся вызвать summariseChat
    console.log('🚀 Вызываем summariseChat...');
    
    await summariseChat(mockEnv, 123, 7);
    
    console.log('✅ summariseChat завершился без ошибок');
    console.log('📞 sendMessage вызовов:', vi.mocked(sendMessage).mock.calls.length);
    console.log('🤖 AI.run вызовов:', mockEnv.AI.run.mock.calls.length);
    
    if (vi.mocked(sendMessage).mock.calls.length > 0) {
      console.log('📨 Последний вызов sendMessage:', vi.mocked(sendMessage).mock.calls[vi.mocked(sendMessage).mock.calls.length - 1]);
    }
    
  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error.message);
    console.error('📚 Stack trace:', error.stack);
  }
}

// Запускаем тест
testOptimizedSystem();