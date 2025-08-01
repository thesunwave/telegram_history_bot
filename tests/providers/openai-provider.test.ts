import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai-provider';
import { Env } from '../../src/env';
import { SummaryRequest, SummaryOptions, ProviderError } from '../../src/providers/ai-provider';

// Mock the utils module
vi.mock('../../src/utils', () => ({
  truncateText: vi.fn((text: string, limit: number) => text.length > limit ? text.substring(0, limit) : text)
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('OpenAIProvider', () => {
  let mockEnv: any;
  let provider: OpenAIProvider;

  beforeEach(() => {
    mockEnv = {
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'gpt-3.5-turbo',
      // Add other required Env properties as needed
      HISTORY: {} as any,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      AI: {} as any,
      TOKEN: 'test-token',
      SECRET: 'test-secret',
      SUMMARY_MODEL: 'test-model',
      SUMMARY_PROMPT: 'Test prompt'
    };

    provider = new OpenAIProvider(mockEnv);
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use provided OPENAI_MODEL', () => {
      const info = provider.getProviderInfo();
      expect(info.model).toBe('gpt-3.5-turbo');
    });

    it('should use default model when OPENAI_MODEL is not provided', () => {
      delete mockEnv.OPENAI_MODEL;
      const providerWithDefault = new OpenAIProvider(mockEnv);
      const info = providerWithDefault.getProviderInfo();
      expect(info.model).toBe('gpt-3.5-turbo');
    });
  });

  describe('summarize', () => {
    const mockRequest: SummaryRequest = {
      messages: [
        { username: 'user1', text: 'Hello world', ts: 1234567890 },
        { username: 'user2', text: 'How are you?', ts: 1234567891 }
      ],
      systemPrompt: 'You are a helpful assistant',
      userPrompt: 'Summarize this conversation',
      limitNote: 'Keep it under 100 characters'
    };

    const mockOptions: SummaryOptions = {
      maxTokens: 150,
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0.1
    };

    const mockOpenAIResponse = {
      choices: [
        {
          message: {
            content: 'Test summary from OpenAI'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 25,
        total_tokens: 75
      }
    };

    it('should successfully summarize with system prompt', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      const result = await provider.summarize(mockRequest, mockOptions);

      expect(result).toBe('Test summary from OpenAI');
      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a helpful assistant\nKeep it under 100 characters' },
            { role: 'user', content: 'Summarize this conversation\n=== СООБЩЕНИЯ ===\nuser1: Hello world\nuser2: How are you?' }
          ],
          max_tokens: 150,
          temperature: 0.7,
          top_p: 0.9,
          frequency_penalty: 0.1
        })
      });
    });

    it('should handle request without system prompt', async () => {
      const requestWithoutSystem: SummaryRequest = {
        ...mockRequest,
        systemPrompt: undefined
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await provider.summarize(requestWithoutSystem, mockOptions);

      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'Keep it under 100 characters' },
            { role: 'user', content: 'Summarize this conversation\n=== СООБЩЕНИЯ ===\nuser1: Hello world\nuser2: How are you?' }
          ],
          max_tokens: 150,
          temperature: 0.7,
          top_p: 0.9,
          frequency_penalty: 0.1
        })
      });
    });

    it('should omit frequency_penalty when not provided', async () => {
      const optionsWithoutFrequencyPenalty: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await provider.summarize(mockRequest, optionsWithoutFrequencyPenalty);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody).not.toHaveProperty('frequency_penalty');
    });

    it('should handle 401 unauthorized error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({
          error: { message: 'Invalid API key' }
        })
      });

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('Invalid OpenAI API key');
    });

    it('should handle 429 rate limit error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: () => Promise.resolve({
          error: { message: 'Rate limit exceeded' }
        })
      });

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('OpenAI API rate limit exceeded');
    });

    it('should handle 500 server error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({
          error: { message: 'Server error' }
        })
      });

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('OpenAI server error');
    });

    it('should handle other HTTP errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({
          error: { message: 'Invalid request format' }
        })
      });

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('OpenAI API error: Invalid request format');
    });

    it('should handle error response without parseable JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('OpenAI API error: 400 Bad Request');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('OpenAI provider error: Network error');
    });

    it('should handle fetch throwing non-Error objects', async () => {
      mockFetch.mockRejectedValue('String error');

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('OpenAI provider error: String error');
    });
  });

  describe('validateConfig', () => {
    it('should pass validation with valid API key', () => {
      expect(() => provider.validateConfig()).not.toThrow();
    });

    it('should throw error when OPENAI_API_KEY is missing', () => {
      delete mockEnv.OPENAI_API_KEY;
      const providerWithoutKey = new OpenAIProvider(mockEnv);

      expect(() => providerWithoutKey.validateConfig()).toThrow('OPENAI_API_KEY is required for OpenAI standard provider');
    });

    it('should throw error when OPENAI_API_KEY is empty string', () => {
      mockEnv.OPENAI_API_KEY = '';
      const providerWithEmptyKey = new OpenAIProvider(mockEnv);

      expect(() => providerWithEmptyKey.validateConfig()).toThrow('OPENAI_API_KEY is required for OpenAI standard provider');
    });
  });

  describe('getProviderInfo', () => {
    it('should return correct provider info', () => {
      const info = provider.getProviderInfo();

      expect(info).toEqual({
        name: 'openai',
        model: 'gpt-3.5-turbo'
      });
    });

    it('should return correct provider info with custom model', () => {
      mockEnv.OPENAI_MODEL = 'gpt-4';
      const customProvider = new OpenAIProvider(mockEnv);
      const info = customProvider.getProviderInfo();

      expect(info).toEqual({
        name: 'openai',
        model: 'gpt-4'
      });
    });
  });
});