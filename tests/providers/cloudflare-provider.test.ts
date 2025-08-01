import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareAIProvider } from '../../src/providers/cloudflare-provider';
import { Env } from '../../src/env';
import { SummaryRequest, SummaryOptions, ProviderError } from '../../src/providers/ai-provider';

// Mock the utils module
vi.mock('../../src/utils', () => ({
  truncateText: vi.fn((text: string, limit: number) => text.length > limit ? text.substring(0, limit) : text)
}));

describe('CloudflareAIProvider', () => {
  let mockEnv: Env;
  let provider: CloudflareAIProvider;
  let mockAI: any;

  beforeEach(() => {
    mockAI = {
      run: vi.fn()
    };

    mockEnv = {
      AI: mockAI,
      SUMMARY_MODEL: 'test-model',
      CLOUDFLARE_MODEL: 'test-model',
      SUMMARY_PROMPT: 'Test prompt',
      SUMMARY_SYSTEM: 'Test system',
      // Add other required Env properties as needed
      HISTORY: {} as any,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      DB: {} as any,
      TOKEN: 'test-token',
      SECRET: 'test-secret'
    };

    provider = new CloudflareAIProvider(mockEnv);
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

    it('should summarize using chat model when CLOUDFLARE_MODEL contains "chat"', async () => {
      (mockEnv as any).CLOUDFLARE_MODEL = 'test-chat-model';
      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      const result = await provider.summarize(mockRequest, mockOptions);

      expect(result).toBe('Test summary');
      expect(mockAI.run).toHaveBeenCalledWith('test-chat-model', {
        max_tokens: 150,
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.1,
        messages: [
          { role: 'system', content: 'You are a helpful assistant\nKeep it under 100 characters' },
          { role: 'user', content: 'Summarize this conversation\n=== СООБЩЕНИЯ ===\nuser1: Hello world\nuser2: How are you?' }
        ]
      });
    });

    it('should summarize using completion model when CLOUDFLARE_MODEL does not contain "chat"', async () => {
      (mockEnv as any).CLOUDFLARE_MODEL = 'test-completion-model';
      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      const result = await provider.summarize(mockRequest, mockOptions);

      expect(result).toBe('Test summary');
      expect(mockAI.run).toHaveBeenCalledWith('test-completion-model', {
        max_tokens: 150,
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.1,
        prompt: 'Summarize this conversation\nKeep it under 100 characters\nuser1: Hello world\nuser2: How are you?'
      });
    });

    it('should handle response without .response property', async () => {
      mockAI.run.mockResolvedValue('Direct response string');

      const result = await provider.summarize(mockRequest, mockOptions);

      expect(result).toBe('Direct response string');
    });

    it('should omit frequency_penalty when not provided', async () => {
      const optionsWithoutFrequencyPenalty: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9
      };

      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      await provider.summarize(mockRequest, optionsWithoutFrequencyPenalty);

      expect(mockAI.run).toHaveBeenCalledWith('test-model', expect.not.objectContaining({
        frequency_penalty: expect.anything()
      }));
    });

    it('should handle system prompt being undefined', async () => {
      const requestWithoutSystem: SummaryRequest = {
        ...mockRequest,
        systemPrompt: undefined
      };

      (mockEnv as any).CLOUDFLARE_MODEL = 'test-chat-model';
      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      await provider.summarize(requestWithoutSystem, mockOptions);

      expect(mockAI.run).toHaveBeenCalledWith('test-chat-model', expect.objectContaining({
        messages: [
          { role: 'system', content: 'Keep it under 100 characters' },
          { role: 'user', content: 'Summarize this conversation\n=== СООБЩЕНИЯ ===\nuser1: Hello world\nuser2: How are you?' }
        ]
      }));
    });

    it('should throw ProviderError when AI.run fails', async () => {
      const aiError = new Error('AI service unavailable');
      mockAI.run.mockRejectedValue(aiError);

      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions)).rejects.toThrow('Cloudflare AI error: AI service unavailable');
    });
  });

  describe('validateConfig', () => {
    it('should pass validation with valid config', () => {
      expect(() => provider.validateConfig()).not.toThrow();
    });

    it('should throw error when AI binding is missing', () => {
      mockEnv.AI = undefined;
      provider = new CloudflareAIProvider(mockEnv);

      expect(() => provider.validateConfig()).toThrow('AI binding is required for Cloudflare provider');
    });

    it('should throw error when CLOUDFLARE_MODEL and SUMMARY_MODEL are missing', () => {
      mockEnv.SUMMARY_MODEL = '';
      (mockEnv as any).CLOUDFLARE_MODEL = '';
      provider = new CloudflareAIProvider(mockEnv);

      expect(() => provider.validateConfig()).toThrow('CLOUDFLARE_MODEL or SUMMARY_MODEL is required for Cloudflare provider');
    });
  });

  describe('getProviderInfo', () => {
    it('should return correct provider info', () => {
      const info = provider.getProviderInfo();

      expect(info).toEqual({
        name: 'cloudflare',
        model: 'test-model'
      });
    });
  });
});