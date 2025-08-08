import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai-provider';
import { SummaryRequest, SummaryOptions } from '../../src/providers/ai-provider';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GPT-5-nano Smoke Tests', () => {
  let mockEnv: any;
  let provider: OpenAIProvider;

  beforeEach(() => {
    mockEnv = {
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'gpt-5-nano',
      // Add other required Env properties
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

  it('should make a successful GPT-5-nano request with correct parameters', async () => {
    const mockRequest: SummaryRequest = {
      messages: [
        { username: 'user1', text: 'Hello, how are you?', ts: 1234567890 }
      ],
      systemPrompt: 'You are a helpful assistant',
      userPrompt: 'Summarize this conversation briefly',
      limitNote: 'Keep it under 50 characters'
    };

    const mockOptions: SummaryOptions = {
      maxTokens: 100,
      temperature: 0.7, // Should be ignored
      topP: 0.9, // Should be ignored
      verbosity: 'low',
      reasoningEffort: 'minimal'
    };

    const mockOpenAIResponse = {
      choices: [
        {
          message: {
            content: 'Brief greeting exchange'
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
      json: () => Promise.resolve(mockOpenAIResponse)
    });

    const result = await provider.summarize(mockRequest, mockOptions);

    expect(result).toBe('Brief greeting exchange');
    expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-api-key',
        'Content-Type': 'application/json'
      },
      body: expect.any(String)
    });

    // Verify request body structure for GPT-5-nano
    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // Should have GPT-5 token parameter
    expect(requestBody.max_completion_tokens).toBe(100);
    expect(requestBody).not.toHaveProperty('max_tokens');
    
    // Should NOT have sampling parameters
    expect(requestBody).not.toHaveProperty('temperature');
    expect(requestBody).not.toHaveProperty('top_p');
    expect(requestBody).not.toHaveProperty('frequency_penalty');
    expect(requestBody).not.toHaveProperty('presence_penalty');
    
    // Should have GPT-5 specific parameters
    expect(requestBody.verbosity).toBe('low');
    expect(requestBody.reasoning_effort).toBe('minimal');
    
    // Should have basic required fields
    expect(requestBody.model).toBe('gpt-5-nano');
    expect(requestBody.messages).toHaveLength(2);
    expect(requestBody.messages[0].role).toBe('system');
    expect(requestBody.messages[1].role).toBe('user');
  });

  it('should handle GPT-5-nano without optional parameters', async () => {
    const mockRequest: SummaryRequest = {
      messages: [
        { username: 'user1', text: 'Test message', ts: 1234567890 }
      ],
      userPrompt: 'Summarize',
      limitNote: 'Brief summary'
    };

    const mockOptions: SummaryOptions = {
      maxTokens: 50,
      temperature: 0.5,
      topP: 0.8
      // No verbosity or reasoningEffort
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
        prompt_tokens: 20,
        completion_tokens: 5,
        total_tokens: 25
      }
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOpenAIResponse)
    });

    const result = await provider.summarize(mockRequest, mockOptions);

    expect(result).toBe('Test summary');

    const callArgs = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(callArgs[1].body);
    
    // Should not include optional GPT-5 parameters when not provided
    expect(requestBody).not.toHaveProperty('verbosity');
    expect(requestBody).not.toHaveProperty('reasoning_effort');
    
    // Should still exclude sampling parameters
    expect(requestBody).not.toHaveProperty('temperature');
    expect(requestBody).not.toHaveProperty('top_p');
    expect(requestBody).not.toHaveProperty('frequency_penalty');
    expect(requestBody).not.toHaveProperty('presence_penalty');
  });
});