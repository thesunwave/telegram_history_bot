import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/core/providers/openai-provider';
import { Env } from '../../src/core/env';
import { SummaryRequest, SummaryOptions, ProviderError, ChatMessage } from '../../src/core/providers/ai-provider';

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

  describe('analyzeProfanity', () => {
    const mockProfanityResponse = {
      choices: [
        {
          message: {
            content: '{"hasProfanity": true, "words": [{"word": "тест", "baseForm": "тест", "confidence": 0.9}]}'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 30,
        completion_tokens: 20,
        total_tokens: 50
      }
    };

    it('should successfully analyze profanity with valid JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProfanityResponse)
      });

      const result = await provider.analyzeProfanity('тест текст', mockEnv);

      expect(result).toEqual({
        hasProfanity: true,
        words: [
          {
            word: 'тест',
            baseForm: 'тест',
            confidence: 0.9
          }
        ]
      });
    });

    it('should handle empty response as filtered profanity', async () => {
      const emptyResponse = {
        choices: [
          {
            message: {
              content: ''
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 0,
          total_tokens: 30
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(emptyResponse)
      });

      const result = await provider.analyzeProfanity('матерное слово', mockEnv);

      expect(result).toEqual({
        hasProfanity: true,
        words: [
          {
            word: '[filtered]',
            baseForm: '[filtered]',
            confidence: 0.8
          }
        ]
      });
    });

    it('should handle content_filter finish reason', async () => {
      const filteredResponse = {
        choices: [
          {
            message: {
              content: ''
            },
            finish_reason: 'content_filter'
          }
        ],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 0,
          total_tokens: 30
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(filteredResponse)
      });

      const result = await provider.analyzeProfanity('матерное слово', mockEnv);

      expect(result).toEqual({
        hasProfanity: true,
        words: [
          {
            word: '[content_filtered]',
            baseForm: '[content_filtered]',
            confidence: 0.9
          }
        ]
      });
    });

    it('should handle malformed JSON response', async () => {
      const malformedResponse = {
        choices: [
          {
            message: {
              content: '{"hasProfanity": true, "words": [invalid json'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 10,
          total_tokens: 40
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(malformedResponse)
      });

      const result = await provider.analyzeProfanity('тест текст', mockEnv);

      expect(result).toEqual({
        hasProfanity: false,
        words: []
      });
    });

    it('should handle network errors in profanity analysis', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(provider.analyzeProfanity('тест текст', mockEnv)).rejects.toThrow(ProviderError);
      await expect(provider.analyzeProfanity('тест текст', mockEnv)).rejects.toThrow('OpenAI profanity analysis error: Network error');
    });

    it('should handle clean text response', async () => {
      const cleanResponse = {
        choices: [
          {
            message: {
              content: '{"hasProfanity": false, "words": []}'
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 30,
          completion_tokens: 10,
          total_tokens: 40
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(cleanResponse)
      });

      const result = await provider.analyzeProfanity('чистый текст', mockEnv);

      expect(result).toEqual({
        hasProfanity: false,
        words: []
      });
    });
  });

  describe('GPT-5 model support', () => {
    it('should use max_output_tokens via Responses API for GPT-5 models', async () => {
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
        output_text: 'Test summary from GPT-5',
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

      expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/responses', {
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
      expect(requestBody.max_output_tokens).toBe(150);
      expect(requestBody).not.toHaveProperty('max_tokens');
      expect(requestBody).not.toHaveProperty('temperature'); // GPT-5-nano doesn't support sampling params
      expect(requestBody).not.toHaveProperty('top_p');
      expect(requestBody.input).toBeDefined();
      expect(requestBody.instructions).toBeDefined();
    });

    it('should omit sampling params for GPT-5-mini models', async () => {
      mockEnv.OPENAI_MODEL = 'gpt-5-mini';
      const gpt5MiniProvider = new OpenAIProvider(mockEnv);

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
        frequencyPenalty: 0.1
      };

      const mockOpenAIResponse = {
        output_text: 'Test summary from GPT-5-mini',
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

      await gpt5MiniProvider.summarize(mockRequest, mockOptions, undefined);

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.model).toBe('gpt-5-mini');
      expect(requestBody.max_output_tokens).toBe(150);
      expect(requestBody).not.toHaveProperty('temperature');
      expect(requestBody).not.toHaveProperty('top_p');
      expect(requestBody).not.toHaveProperty('frequency_penalty');
      expect(requestBody).not.toHaveProperty('presence_penalty');
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
        output_text: 'Test summary from GPT-5-nano',
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
        output_text: 'Test summary from GPT-5-turbo',
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
        output_text: 'Test summary with reasoning',
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
      expect(requestBody.max_output_tokens).toBe(150);
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.top_p).toBe(0.9);
      expect(requestBody.frequency_penalty).toBeUndefined();
      expect(requestBody.presence_penalty).toBeUndefined();
      expect(requestBody.text?.verbosity).toBe('low');
      expect(requestBody.reasoning?.effort).toBe('medium');
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
      expect(requestBody.text).toBeUndefined();
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

    it('should throw ProviderError when Responses API returns no text output', async () => {
      mockEnv.OPENAI_MODEL = 'gpt-5-mini';
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
        id: 'resp_test',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          { id: 'rs_1', type: 'reasoning', summary: [] }
        ],
        usage: {
          input_tokens: 50,
          output_tokens: 150,
          output_tokens_details: { reasoning_tokens: 150 },
          total_tokens: 200
        }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockOpenAIResponse)
      });

      await expect(gpt5Provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(gpt5Provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(/incomplete result/i);
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

  describe('Responses API truncation handling (Fix A: revive dead truncation warn)', () => {
    let gpt5Provider: OpenAIProvider;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let debugSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockEnv.OPENAI_MODEL = 'gpt-5-nano';
      gpt5Provider = new OpenAIProvider(mockEnv);
      mockFetch.mockClear();
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    });

    afterEach(() => {
      // Restore ONLY our own console spies — calling vi.restoreAllMocks() here
      // would also restore `vi.spyOn(global, 'fetch')` spies leaked by other
      // test files (e.g. tests/index.test.ts), which would clobber `global.fetch = mockFetch`
      // set at the top of this file and let real network calls leak in.
      warnSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
      debugSpy.mockRestore();
    });

    const findWarns = (predicate: (msg: any, data: any) => boolean) =>
      warnSpy.mock.calls.filter(([msg, data]) => predicate(msg, data));
    const findErrors = (predicate: (msg: any, data: any) => boolean) =>
      errorSpy.mock.calls.filter(([msg, data]) => predicate(msg, data));

    // Test A — the bug: partial-content truncation. Before the fix, the
    // early-return on `output_text` bypassed the truncation handler, so the
    // author-written warn never fired. After the fix, the warn fires and the
    // partial content is still surfaced to the caller.
    it('emits truncation warn and returns partial content when status is incomplete with output_text', async () => {
      const partialJson = '{"hasViolations": true, "violations": [{"article": "105"';
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: partialJson,
          usage: { prompt_tokens: 30, completion_tokens: 150, total_tokens: 180 }
        })
      });

      const messages: ChatMessage[] = [{ role: 'user', content: 'analyze this' }];
      const result = await (gpt5Provider as any).callOpenAI(
        messages,
        { maxTokens: 800 } as SummaryOptions,
        false
      );

      // Partial content is still surfaced to the caller (downstream parser)
      expect(result.choices[0].message.content).toBe(partialJson);
      // Real termination reason threaded through finish_reason (was always 'stop' before)
      expect(result.choices[0].finish_reason).toBe('length');

      // The author-intended truncation categorisation warn now fires
      const truncationWarns = findWarns(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('OpenAI Responses API returned incomplete result') &&
          msg.includes('max_output_tokens') &&
          data?.reason === 'max_output_tokens' &&
          data?.contentLength === partialJson.length
      );
      expect(truncationWarns).toHaveLength(1);
    });

    // Test B — zero-content truncation. The dead branch's helper
    // `extractBestAvailableContent` always returned null here so the inner
    // warn-and-return never fired. After the fix, the unified warn fires
    // (contentLength: 0) and the ProviderError is thrown as before.
    it('emits truncation warn (contentLength:0) and throws ProviderError for incomplete response with no content', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ id: 'rs_1', type: 'reasoning', summary: [] }],
          usage: { prompt_tokens: 30, completion_tokens: 150, total_tokens: 180 }
        })
      });

      const messages: ChatMessage[] = [{ role: 'user', content: 'analyze this' }];
      let thrown: unknown;
      try {
        await (gpt5Provider as any).callOpenAI(messages, { maxTokens: 800 } as SummaryOptions, false);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(ProviderError);
      expect((thrown as Error).message).toMatch(/incomplete result/i);

      // The unified truncation warn fires before the throw (contentLength: 0)
      const truncationWarns = findWarns(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('OpenAI Responses API returned incomplete result') &&
          msg.includes('max_output_tokens') &&
          data?.reason === 'max_output_tokens' &&
          data?.contentLength === 0
      );
      expect(truncationWarns).toHaveLength(1);
    });

    it('threads content_filter finish_reason for filtered Responses API output', async () => {
      const filteredContent = '{"hasViolations": false, "violations": []}';
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
          output_text: filteredContent,
          usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 }
        })
      });

      const messages: ChatMessage[] = [{ role: 'user', content: 'analyze this' }];
      const result = await (gpt5Provider as any).callOpenAI(
        messages,
        { maxTokens: 800 } as SummaryOptions,
        false
      );

      expect(result.choices[0].message.content).toBe(filteredContent);
      expect(result.choices[0].finish_reason).toBe('content_filter');
    });

    // Non-regression — completed response: no truncation warn, finish_reason: 'stop'
    it('does not warn and threads finish_reason:stop when status is completed', async () => {
      const fullJson = '{"hasViolations": false, "violations": []}';
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'completed',
          output_text: fullJson,
          usage: { prompt_tokens: 30, completion_tokens: 80, total_tokens: 110 }
        })
      });

      const messages: ChatMessage[] = [{ role: 'user', content: 'analyze this' }];
      const result = await (gpt5Provider as any).callOpenAI(
        messages,
        { maxTokens: 800 } as SummaryOptions,
        false
      );

      expect(result.choices[0].message.content).toBe(fullJson);
      expect(result.choices[0].finish_reason).toBe('stop');
      const truncationWarns = findWarns(
        (msg) => typeof msg === 'string' && msg.includes('OpenAI Responses API returned incomplete result')
      );
      expect(truncationWarns).toHaveLength(0);
    });

    // Non-regression — missing status field is treated as completed
    it('treats missing status as completed (no warn, finish_reason:stop)', async () => {
      const fullJson = '{"hasViolations": false, "violations": []}';
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          output_text: fullJson,
          usage: { prompt_tokens: 30, completion_tokens: 80, total_tokens: 110 }
        })
      });

      const messages: ChatMessage[] = [{ role: 'user', content: 'analyze this' }];
      const result = await (gpt5Provider as any).callOpenAI(
        messages,
        { maxTokens: 800 } as SummaryOptions,
        false
      );

      expect(result.choices[0].message.content).toBe(fullJson);
      expect(result.choices[0].finish_reason).toBe('stop');
      const truncationWarns = findWarns(
        (msg) => typeof msg === 'string' && msg.includes('OpenAI Responses API returned incomplete result')
      );
      expect(truncationWarns).toHaveLength(0);
    });

    // Non-regression — incomplete reason that is not a token/length reason
    // (e.g. content_filter) also surfaces the warn and threads finish_reason.
    // Pins that the warn is gated on `status !== 'completed'`, NOT on a token/
    // length reason whitelist (the original code had such a whitelist, which
    // is what made the dead branch dead in the first place).
    it('emits warn and throws ProviderError when status is incomplete due to content_filter', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'incomplete',
          incomplete_details: { reason: 'content_filter' },
          output: [{ id: 'rs_1', type: 'reasoning', summary: [] }],
          usage: { prompt_tokens: 30, completion_tokens: 0, total_tokens: 30 }
        })
      });

      const messages: ChatMessage[] = [{ role: 'user', content: 'analyze this' }];
      let thrown: unknown;
      try {
        await (gpt5Provider as any).callOpenAI(messages, { maxTokens: 800 } as SummaryOptions, false);
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(ProviderError);
      const truncationWarns = findWarns(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('OpenAI Responses API returned incomplete result') &&
          msg.includes('content_filter') &&
          data?.reason === 'content_filter'
      );
      expect(truncationWarns).toHaveLength(1);
    });

    // End-to-end through analyzeCriminalCode — partial-content truncation:
    // the operator should now see BOTH the truncation warn (categorisation)
    // AND the parser-failure error (carrying the raw partial JSON), while the
    // moderation outcome stays the deliberate fail-open clean fallback.
    it('analyzeCriminalCode: partial-content truncation returns clean fallback with truncation warn + parser error', async () => {
      const partialJson = '{"hasViolations": true, "violations": [{"article": "105"';
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: partialJson,
          usage: { prompt_tokens: 30, completion_tokens: 150, total_tokens: 180 }
        })
      });

      const result = await gpt5Provider.analyzeCriminalCode('some message text', mockEnv);

      // Author's deliberate fail-open-on-truncation moderation outcome is preserved
      expect(result).toEqual({
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: expect.any(Number)
      });

      // Categorisation: the extractResponsesContent truncation warn fires once
      const extractorWarns = findWarns(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('OpenAI Responses API returned incomplete result') &&
          msg.includes('max_output_tokens') &&
          data?.contentLength === partialJson.length
      );
      expect(extractorWarns).toHaveLength(1);

      // Visibility: the parser-failure error log still carries the raw partial JSON
      const parseErrors = findErrors(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('response parsing failed') &&
          typeof data === 'object' && data !== null &&
          data.rawResponse === partialJson
      );
      expect(parseErrors).toHaveLength(1);

      // The catch-path incompleteResult:true warn must NOT fire here, because
      // analyzeCriminalCode's catch only runs on ProviderError; partial content
      // returns cleanly through the parser fallback instead.
      const catchWarns = findWarns(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('criminal code analysis: failed') &&
          data?.incompleteResult === true
      );
      expect(catchWarns).toHaveLength(0);
    });

    it('analyzeCriminalCode: zero-content truncation returns clean fallback and emits both warn layers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [{ id: 'rs_1', type: 'reasoning', summary: [] }],
          usage: { prompt_tokens: 30, completion_tokens: 150, total_tokens: 180 }
        })
      });

      const result = await gpt5Provider.analyzeCriminalCode('some message text', mockEnv);

      // Author's deliberate fail-open-on-truncation moderation outcome
      expect(result).toEqual({
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: expect.any(Number)
      });

      // The extractResponsesContent truncation warn fires before the throw
      const extractorWarns = findWarns(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('OpenAI Responses API returned incomplete result') &&
          msg.includes('max_output_tokens') &&
          data?.contentLength === 0
      );
      expect(extractorWarns).toHaveLength(1);

      // analyzeCriminalCode's catch sees the ProviderError (regex matches
      // /incomplete result|max_output_tokens/i) and emits the incomplete-tagged warn
      const catchWarns = findWarns(
        (msg, data) => typeof msg === 'string' &&
          msg.includes('criminal code analysis: failed') &&
          data?.incompleteResult === true
      );
      expect(catchWarns).toHaveLength(1);
    });
  });
});
