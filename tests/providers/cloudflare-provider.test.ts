import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudflareAIProvider } from '../../src/core/providers/cloudflare-provider';
import { Env } from '../../src/core/env';
import { SummaryRequest, SummaryOptions, ProviderError } from '../../src/core/providers/ai-provider';

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
      SUMMARY_PROMPT: 'Test prompt',
      SUMMARY_SYSTEM: 'Test system',
      // Add other required Env properties as needed
      HISTORY: {} as any,
      COUNTERS: {} as any,
      COUNTERS_DO: {} as any,
      MESSAGE_FETCHER_DO: {} as any,
      MESSAGE_AGGREGATOR_DO: {} as any,
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

    it('should summarize using chat model when SUMMARY_MODEL contains "chat"', async () => {
      mockEnv.SUMMARY_MODEL = 'test-chat-model';
      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      const result = await provider.summarize(mockRequest, mockOptions, undefined);

      expect(result).toBe('Test summary');
      expect(mockAI.run).toHaveBeenCalledWith('test-chat-model', {
        max_tokens: 150,
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.1,
        messages: [
          { role: 'system', content: 'You are a helpful assistant\nKeep it under 100 characters' },
          { role: 'user', content: 'Summarize this conversation\n=== СООБЩЕНИЯ ===\nuser1: Hello world;\nuser2: How are you?' }
        ]
      });
    });

    it('should summarize using completion model when SUMMARY_MODEL does not contain "chat"', async () => {
      mockEnv.SUMMARY_MODEL = 'test-completion-model';
      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      const result = await provider.summarize(mockRequest, mockOptions, undefined);

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

      const result = await provider.summarize(mockRequest, mockOptions, undefined);

      expect(result).toBe('Direct response string');
    });

    it('should omit frequency_penalty when not provided', async () => {
      const optionsWithoutFrequencyPenalty: SummaryOptions = {
        maxTokens: 150,
        temperature: 0.7,
        topP: 0.9
      };

      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      await provider.summarize(mockRequest, optionsWithoutFrequencyPenalty, undefined);

      expect(mockAI.run).toHaveBeenCalledWith('test-model', expect.not.objectContaining({
        frequency_penalty: expect.anything()
      }));
    });

    it('should handle system prompt being undefined', async () => {
      const requestWithoutSystem: SummaryRequest = {
        ...mockRequest,
        systemPrompt: undefined
      };

      mockEnv.SUMMARY_MODEL = 'test-chat-model';
      mockAI.run.mockResolvedValue({ response: 'Test summary' });

      await provider.summarize(requestWithoutSystem, mockOptions, undefined);

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

      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow(ProviderError);
      await expect(provider.summarize(mockRequest, mockOptions, undefined)).rejects.toThrow('Cloudflare AI error: AI service unavailable');
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

    it('should throw error when both CLOUDFLARE_MODEL and SUMMARY_MODEL are missing', () => {
      mockEnv.SUMMARY_MODEL = '';
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

  describe('analyzeCriminalCode', () => {
    const criminalViolation = {
      article: '119',
      subarticle: null,
      articleTitle: 'Угроза убийством или причинением тяжкого вреда здоровью',
      quote: 'я его убью',
      punishment: 'обязательные работы до 480 часов',
      severity: 6,
      confidence: 0.85,
    };

    beforeEach(() => {
      mockEnv.SUMMARY_MODEL = 'test-chat-model';
    });

    it('should set analysisTimestamp when the model omits it (prompt-compliant response)', async () => {
      const before = Date.now();
      mockAI.run.mockResolvedValue({ response: JSON.stringify({
        hasViolations: true,
        violations: [criminalViolation],
        totalSeverity: 6,
        riskLevel: 'high',
      }) });

      const result = await provider.analyzeCriminalCode('я его убью', mockEnv);

      expect(result.hasViolations).toBe(true);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].article).toBe('119');
      expect(typeof result.analysisTimestamp).toBe('number');
      expect(Number.isFinite(result.analysisTimestamp)).toBe(true);
      expect(result.analysisTimestamp).toBeGreaterThanOrEqual(before);
      expect(result.analysisTimestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should override a model-supplied, non-number analysisTimestamp with an application-controlled value', async () => {
      const before = Date.now();
      mockAI.run.mockResolvedValue({ response: JSON.stringify({
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: 'model-supplied-not-a-number',
      }) });

      const result = await provider.analyzeCriminalCode('чистый текст', mockEnv);

      expect(result.hasViolations).toBe(false);
      expect(typeof result.analysisTimestamp).toBe('number');
      expect(Number.isFinite(result.analysisTimestamp)).toBe(true);
      expect(result.analysisTimestamp).not.toBe('model-supplied-not-a-number');
      expect(result.analysisTimestamp).toBeGreaterThanOrEqual(before);
      expect(result.analysisTimestamp).toBeLessThanOrEqual(Date.now());
    });

    it('should override a model-supplied numeric analysisTimestamp with the application-controlled value', async () => {
      const before = Date.now();
      const modelSupplied = 1000;
      mockAI.run.mockResolvedValue({ response: JSON.stringify({
        hasViolations: false,
        violations: [],
        totalSeverity: 0,
        riskLevel: 'low',
        analysisTimestamp: modelSupplied,
      }) });

      const result = await provider.analyzeCriminalCode('чистый текст', mockEnv);

      expect(typeof result.analysisTimestamp).toBe('number');
      expect(result.analysisTimestamp).not.toBe(modelSupplied);
      expect(result.analysisTimestamp).toBeGreaterThanOrEqual(before);
      expect(result.analysisTimestamp).toBeLessThanOrEqual(Date.now());
    });
  });
});