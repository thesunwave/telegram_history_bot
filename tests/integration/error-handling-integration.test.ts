import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KVNamespace } from '@miniflare/kv';
import { MemoryStorage } from '@miniflare/storage-memory';
import { summariseChat, summariseChatMessages } from '../../src/summary';
import { sendMessage } from '../../src/telegram';
import { fetchMessages, fetchLastMessages } from '../../src/history';
import { ProviderInitializer } from '../../src/providers/provider-init';
import { Env, DEFAULT_KV_BATCH_SIZE, DEFAULT_KV_BATCH_DELAY } from '../../src/env';
import { BatchErrorType } from '../../src/utils';

// Mock the dependencies
vi.mock('../../src/telegram');
vi.mock('../../src/history');
vi.mock('../../src/providers/provider-init');

const mockSendMessage = vi.mocked(sendMessage);
const mockFetchMessages = vi.mocked(fetchMessages);
const mockFetchLastMessages = vi.mocked(fetchLastMessages);
const mockProviderInitializer = vi.mocked(ProviderInitializer);

describe('Error Handling Integration Tests', () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    
    const history = new KVNamespace(new MemoryStorage());
    
    env = {
      HISTORY: history,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      AI: {} as any,
      TOKEN: "test-token",
      SECRET: "test-secret",
      SUMMARY_MODEL: "test-model",
      SUMMARY_PROMPT: "Test prompt",
      KV_BATCH_SIZE: DEFAULT_KV_BATCH_SIZE,
      KV_BATCH_DELAY: DEFAULT_KV_BATCH_DELAY,
    };
    
    // Setup default mocks
    mockProviderInitializer.isProviderInitialized.mockReturnValue(true);
    mockProviderInitializer.getProvider.mockReturnValue({
      summarize: vi.fn().mockResolvedValue('Test summary'),
      getProviderInfo: () => ({ name: 'test', model: 'test-model' }),
      validateConfig: vi.fn()
    });
    mockSendMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('API Limit Error Handling', () => {
    it('should provide specific error message when API limits are exceeded in fetchMessages', async () => {
      const chatId = 12345;
      const days = 7;

      // Mock fetchMessages to throw API limit error
      mockFetchMessages.mockRejectedValue(
        new Error('API request limits exceeded. Please try again with a shorter time period or contact support if the issue persists.')
      );

      await summariseChat(env, chatId, days);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'API request limits exceeded. Please try again with a shorter time period or contact support if the issue persists.'
      );
    });

    it('should provide specific error message when API limits are exceeded in fetchLastMessages', async () => {
      const chatId = 12345;
      const count = 100;

      // Mock fetchLastMessages to throw API limit error
      mockFetchLastMessages.mockRejectedValue(
        new Error('API request limits exceeded. Please try requesting fewer messages or contact support if the issue persists.')
      );

      await summariseChatMessages(env, chatId, count);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'API request limits exceeded. Please try requesting fewer messages or contact support if the issue persists.'
      );
    });

    it('should handle critical failures with appropriate error message', async () => {
      const chatId = 12345;
      const days = 7;

      // Mock fetchMessages to throw critical failure error
      mockFetchMessages.mockRejectedValue(
        new Error('Critical failures occurred during message fetching. Please try again later.')
      );

      await summariseChat(env, chatId, days);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'Произошли критические ошибки при получении сообщений. Попробуйте позже или сократите период.'
      );
    });
  });

  describe('Provider Error Handling', () => {
    it('should handle provider rate limit errors with specific message', async () => {
      const chatId = 12345;
      const days = 1;

      // Mock successful message fetching
      mockFetchMessages.mockResolvedValue([
        { chat: chatId, user: 1, username: 'user1', text: 'Hello', ts: Date.now() / 1000 }
      ]);

      // Mock provider to throw rate limit error
      const mockProvider = {
        summarize: vi.fn().mockRejectedValue(new Error('Too many requests to AI service')),
        getProviderInfo: () => ({ name: 'test', model: 'test-model' }),
        validateConfig: vi.fn()
      };
      mockProviderInitializer.getProvider.mockReturnValue(mockProvider);

      await summariseChat(env, chatId, days);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'Ошибка при создании сводки. Пожалуйста, попробуйте позже.'
      );
    });

    it('should handle provider timeout errors with specific message', async () => {
      const chatId = 12345;
      const count = 50;

      // Mock successful message fetching
      mockFetchLastMessages.mockResolvedValue([
        { chat: chatId, user: 1, username: 'user1', text: 'Hello', ts: Date.now() / 1000 }
      ]);

      // Mock provider to throw timeout error
      const mockProvider = {
        summarize: vi.fn().mockRejectedValue(new Error('Request timeout occurred')),
        getProviderInfo: () => ({ name: 'test', model: 'test-model' }),
        validateConfig: vi.fn()
      };
      mockProviderInitializer.getProvider.mockReturnValue(mockProvider);

      await summariseChatMessages(env, chatId, count);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'Ошибка при создании сводки. Пожалуйста, попробуйте позже.'
      );
    });
  });

  describe('Fallback Error Handling', () => {
    it('should use fallback message when primary error notification fails', async () => {
      const chatId = 12345;
      const days = 7;

      // Mock fetchMessages to throw error
      mockFetchMessages.mockRejectedValue(new Error('Some unexpected error'));

      // Mock sendMessage to fail on first call, succeed on second
      mockSendMessage
        .mockRejectedValueOnce(new Error('Send message failed'))
        .mockResolvedValueOnce(undefined);

      await summariseChat(env, chatId, days);

      // Should try to send the original error message first, then fallback
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenNthCalledWith(
        1,
        env,
        chatId,
        'Произошла непредвиденная ошибка при создании сводки.'
      );
      expect(mockSendMessage).toHaveBeenNthCalledWith(
        2,
        env,
        chatId,
        'Ошибка сервиса. Попробуйте позже.'
      );
    });

    it('should handle complete message sending failure gracefully', async () => {
      const chatId = 12345;
      const count = 10;

      // Mock fetchLastMessages to throw error
      mockFetchLastMessages.mockRejectedValue(new Error('Some unexpected error'));

      // Mock sendMessage to always fail
      mockSendMessage.mockRejectedValue(new Error('Send message failed'));

      // Should not throw an error even if message sending fails
      await expect(summariseChatMessages(env, chatId, count)).resolves.not.toThrow();

      // Should attempt to send error messages multiple times
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('Timeout Error Handling', () => {
    it('should handle timeout errors with appropriate user message', async () => {
      const chatId = 12345;
      const days = 7;

      // Mock fetchMessages to throw timeout error
      mockFetchMessages.mockRejectedValue(new Error('Request timeout occurred'));

      await summariseChat(env, chatId, days);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'Превышено время ожидания. Попробуйте сократить период или количество дней.'
      );
    });

    it('should handle TIMEOUT errors (uppercase) with appropriate user message', async () => {
      const chatId = 12345;
      const count = 100;

      // Mock fetchLastMessages to throw TIMEOUT error
      mockFetchLastMessages.mockRejectedValue(new Error('TIMEOUT: Request took too long'));

      await summariseChatMessages(env, chatId, count);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'Превышено время ожидания. Попробуйте запросить меньше сообщений.'
      );
    });
  });

  describe('Generic Rate Limit Handling', () => {
    it('should handle generic rate limit errors', async () => {
      const chatId = 12345;
      const days = 3;

      // Mock fetchMessages to throw generic rate limit error
      mockFetchMessages.mockRejectedValue(new Error('Too many requests, please slow down'));

      await summariseChat(env, chatId, days);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'Превышен лимит запросов. Попробуйте через несколько минут.'
      );
    });

    it('should handle rate limit errors in different formats', async () => {
      const chatId = 12345;
      const count = 50;

      // Mock fetchLastMessages to throw rate limit error
      mockFetchLastMessages.mockRejectedValue(new Error('rate limit exceeded'));

      await summariseChatMessages(env, chatId, count);

      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'Превышен лимит запросов. Попробуйте через несколько минут.'
      );
    });
  });

  describe('Error Message Preservation', () => {
    it('should preserve custom error messages from batch processing', async () => {
      const chatId = 12345;
      const days = 7;
      const customMessage = 'API request limits exceeded. Please try again with a shorter time period or contact support if the issue persists.';

      // Mock fetchMessages to throw our custom error
      mockFetchMessages.mockRejectedValue(new Error(customMessage));

      await summariseChat(env, chatId, days);

      // Should use the exact custom message
      expect(mockSendMessage).toHaveBeenCalledWith(env, chatId, customMessage);
    });

    it('should handle mixed error scenarios appropriately', async () => {
      const chatId = 12345;
      const count = 100;

      // Mock successful message fetching but provider failure
      mockFetchLastMessages.mockResolvedValue([
        { chat: chatId, user: 1, username: 'user1', text: 'Hello', ts: Date.now() / 1000 }
      ]);

      // Mock provider to throw a custom error that should be handled specifically
      const mockProvider = {
        summarize: vi.fn().mockRejectedValue(new Error('API request limits exceeded. Please try requesting fewer messages or contact support if the issue persists.')),
        getProviderInfo: () => ({ name: 'test', model: 'test-model' }),
        validateConfig: vi.fn()
      };
      mockProviderInitializer.getProvider.mockReturnValue(mockProvider);

      await summariseChatMessages(env, chatId, count);

      // Should use the specific API limit message
      expect(mockSendMessage).toHaveBeenCalledWith(
        env,
        chatId,
        'API request limits exceeded. Please try requesting fewer messages or contact support if the issue persists.'
      );
    });
  });
});