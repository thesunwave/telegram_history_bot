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

      const result = await provider.summarize(mockRequest, mockOptions, undefined);

      expect(result).toBe('Test summary from OpenAI');
      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: expect.any(String)
      });

      // Check the request body content
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-3.5-turbo');
      expect(requestBody.max_tokens).toBe(150);
      expect(requestBody).not.toHaveProperty('max_completion_tokens');
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.top_p).toBe(0.9);
      expect(requestBody.frequency_penalty).toBe(0.1);
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

      await provider.summarize(requestWithoutSystem, mockOptions, undefined);

      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: expect.any(String)
      });

      // Check the request body content
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-3.5-turbo');
      expect(requestBody.max_tokens).toBe(150);
      expect(requestBody).not.toHaveProperty('max_completion_tokens');
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.top_p).toBe(0.9);
      expect(requestBody.frequency_penalty).toBe(0.1);
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

      await provider.summarize(mockRequest, optionsWithoutFrequencyPenalty, undefined);

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

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('Invalid OpenAI API key');
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

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('OpenAI API rate limit exceeded');
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

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('OpenAI server error');
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

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('OpenAI API error: Invalid request format');
    });

    it('should handle error response without parseable JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('OpenAI API error: 400 Bad Request');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('OpenAI provider error: Network error');
    });

    it('should handle fetch throwing non-Error objects', async () => {
      mockFetch.mockRejectedValue('String error');

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('OpenAI provider error: String error');
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

  describe('GPT-5 model support', () => {
    it('should use max_completion_tokens for GPT-5 models', async () => {
      mockEnv.OPENAI_MODEL = 'gpt-5-nano';
      const gpt5Provider = new OpenAIProvider(mockEnv);

      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9
      };

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'Test summary from GPT-5'
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await gpt5Provider.summarize(mockRequest, mockOptions, undefined);

      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: expect.any(String)
      });

      // Check the request body content for GPT-5
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-5-nano');
      expect(requestBody.max_completion_tokens).toBe(150);
      expect(requestBody).not.toHaveProperty('max_tokens');
      expect(requestBody).not.toHaveProperty('temperature'); // GPT-5-nano doesn't support sampling params
      expect(requestBody).not.toHaveProperty('top_p');
    });

    it('should use max_tokens for non-GPT-5 models', async () => {
      // This test uses the default gpt-3.5-turbo model
      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9
      };

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'Test summary from GPT-3.5'
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await provider.summarize(mockRequest, mockOptions, undefined);

      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json'
        },
        body: expect.any(String)
      });

      // Check the request body content for non-GPT-5
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-3.5-turbo');
      expect(requestBody.max_tokens).toBe(150);
      expect(requestBody).not.toHaveProperty('max_completion_tokens');
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.top_p).toBe(0.9);
    });

    it('should use default temperature (1) for GPT-5-nano model', async () => {
      mockEnv.OPENAI_MODEL = 'gpt-5-nano';
      const gpt5NanoProvider = new OpenAIProvider(mockEnv);

      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.1, // This should be ignored for GPT-5-nano
        topP: 0.9
      };

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'Test summary from GPT-5-nano'
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await gpt5NanoProvider.summarize(mockRequest, mockOptions, undefined);

      // Check that sampling parameters are excluded for GPT-5-nano
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-5-nano');
      expect(requestBody).not.toHaveProperty('temperature');
      expect(requestBody).not.toHaveProperty('top_p');
      expect(requestBody).not.toHaveProperty('frequency_penalty');
      expect(requestBody).not.toHaveProperty('presence_penalty');
    });

    it('should allow custom temperature for other GPT-5 models', async () => {
      mockEnv.OPENAI_MODEL = 'gpt-5-turbo';
      const gpt5TurboProvider = new OpenAIProvider(mockEnv);

      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.3,
        topP: 0.9
      };

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'Test summary from GPT-5-turbo'
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await gpt5TurboProvider.summarize(mockRequest, mockOptions, undefined);

      // Check that custom temperature is preserved for other GPT-5 models
      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-5-turbo');
      expect(requestBody.temperature).toBe(0.3); // Should preserve custom temperature
      expect(requestBody.top_p).toBe(0.9);
    });

    it('should include GPT-5 specific parameters when supported', async () => {
      mockEnv.OPENAI_MODEL = 'gpt-5-turbo';
      const gpt5Provider = new OpenAIProvider(mockEnv);

      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9,
        frequencyPenalty: 0.1,
        presencePenalty: 0.2,
        verbosity: 'low',
        reasoningEffort: 'medium'
      };

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'Test summary with reasoning'
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await gpt5Provider.summarize(mockRequest, mockOptions, undefined);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-5-turbo');
      expect(requestBody.max_completion_tokens).toBe(150);
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.top_p).toBe(0.9);
      expect(requestBody.frequency_penalty).toBe(0.1);
      expect(requestBody.presence_penalty).toBe(0.2);
      expect(requestBody.verbosity).toBe('low');
      expect(requestBody.reasoning_effort).toBe('medium');
    });

    it('should exclude GPT-5 parameters for non-GPT-5 models', async () => {
      // Using default gpt-3.5-turbo model
      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9,
        verbosity: 'low', // Should be ignored for non-GPT-5
        reasoningEffort: 'medium' // Should be ignored for non-GPT-5
      };

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'Test summary'
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await provider.summarize(mockRequest, mockOptions, undefined);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-3.5-turbo');
      expect(requestBody.max_tokens).toBe(150);
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.top_p).toBe(0.9);
      expect(requestBody).not.toHaveProperty('verbosity');
      expect(requestBody).not.toHaveProperty('reasoning_effort');
    });

    it('should handle presence_penalty parameter correctly', async () => {
      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9,
        presencePenalty: 0.5
      };

      const mockOpenAIResponse = {
        choices: [
          {
            message: {
              content: 'Test summary with presence penalty'
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await provider.summarize(mockRequest, mockOptions, undefined);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-3.5-turbo');
      expect(requestBody.presence_penalty).toBe(0.5);
    });

    it('should handle 400 errors with parameter information', async () => {
      const mockRequest: SummaryRequest = {
        messages: [
          { username: 'user1', text: 'Hello world', ts: 1234567890 }
        ],
        systemPrompt: 'You are a helpful assistant',
        userPrompt: 'Summarize this conversation',
        limitNote: 'Keep it under 100 characters'
      };

      const mockOptions: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9
      };

      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({
          error: { 
            message: 'Parameter temperature is not allowed for this model',
            param: 'temperature'
          }
        })
      });

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('parameter: temperature');
    });
  });
});