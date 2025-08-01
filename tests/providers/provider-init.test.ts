import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderInitializer } from '../../src/providers/provider-init';
import { ProviderFactory } from '../../src/providers/provider-factory';
import { CloudflareAIProvider } from '../../src/providers/cloudflare-provider';
import { OpenAIProvider } from '../../src/providers/openai-provider';
import { ProviderError } from '../../src/providers/ai-provider';
import { Env } from '../../src/env';

// Mock console methods
const mockConsoleLog = vi.fn();
const mockConsoleError = vi.fn();
const mockConsoleWarn = vi.fn();

vi.stubGlobal('console', {
  log: mockConsoleLog,
  error: mockConsoleError,
  warn: mockConsoleWarn,
  debug: vi.fn(),
});

// Mock ProviderFactory
vi.mock('../../src/providers/provider-factory');
const mockProviderFactory = vi.mocked(ProviderFactory);

// Mock providers
vi.mock('../../src/providers/cloudflare-provider');
vi.mock('../../src/providers/openai-provider');

describe('ProviderInitializer', () => {
  const mockEnv: Env = {
    SUMMARY_PROVIDER: 'cloudflare',
    SUMMARY_MODEL: 'test-model',
  } as Env;

  beforeEach(() => {
    vi.clearAllMocks();
    ProviderInitializer.reset();
  });

  describe('initializeProvider', () => {
    it('should initialize provider successfully', async () => {
      const mockProvider = {
        validateConfig: vi.fn(),
        getProviderInfo: vi.fn().mockReturnValue({
          name: 'cloudflare',
          model: 'test-model',
          version: '1.0',
        }),
      };

      mockProviderFactory.createProvider.mockReturnValue(mockProvider as any);
      mockProviderFactory.getSupportedProviders.mockReturnValue(['cloudflare', 'openai']);
      mockProviderFactory.getDefaultProvider.mockReturnValue('cloudflare');

      const result = await ProviderInitializer.initializeProvider(mockEnv);

      expect(result).toBe(mockProvider);
      expect(mockProvider.validateConfig).toHaveBeenCalled();
      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
      expect(mockConsoleLog).toHaveBeenCalledWith('Provider initialization started');
      expect(mockConsoleLog).toHaveBeenCalledWith('Provider created', {
        provider: 'cloudflare',
        model: 'test-model',
        version: '1.0',
      });
      expect(mockConsoleLog).toHaveBeenCalledWith('Provider configuration validated successfully', {
        provider: 'cloudflare',
        model: 'test-model',
      });
      expect(mockConsoleLog).toHaveBeenCalledWith('Provider initialization completed', {
        provider: 'cloudflare',
        model: 'test-model',
        supportedProviders: ['cloudflare', 'openai'],
        defaultProvider: 'cloudflare',
      });
    });

    it('should handle provider creation error', async () => {
      const error = new Error('Provider creation failed');
      mockProviderFactory.createProvider.mockImplementation(() => {
        throw error;
      });
      mockProviderFactory.getSupportedProviders.mockReturnValue(['cloudflare', 'openai']);
      mockProviderFactory.getDefaultProvider.mockReturnValue('cloudflare');

      await expect(ProviderInitializer.initializeProvider(mockEnv)).rejects.toThrow(
        'Provider initialization failed: Provider creation failed'
      );

      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
      expect(mockConsoleError).toHaveBeenCalledWith('Provider initialization failed', {
        error: 'Provider initialization failed: Provider creation failed',
        stack: error.stack,
        supportedProviders: ['cloudflare', 'openai'],
        defaultProvider: 'cloudflare',
      });
    });

    it('should handle provider validation error', async () => {
      const validationError = new Error('Invalid configuration');
      const mockProvider = {
        validateConfig: vi.fn().mockImplementation(() => {
          throw validationError;
        }),
        getProviderInfo: vi.fn().mockReturnValue({
          name: 'cloudflare',
          model: 'test-model',
        }),
      };

      mockProviderFactory.createProvider.mockReturnValue(mockProvider as any);
      mockProviderFactory.getSupportedProviders.mockReturnValue(['cloudflare', 'openai']);
      mockProviderFactory.getDefaultProvider.mockReturnValue('cloudflare');

      await expect(ProviderInitializer.initializeProvider(mockEnv)).rejects.toThrow(
        'Provider initialization failed: Invalid configuration'
      );

      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
    });

    it('should handle ProviderError specifically', async () => {
      const providerError = new ProviderError('OpenAI API key missing', 'openai');
      mockProviderFactory.createProvider.mockImplementation(() => {
        throw providerError;
      });
      mockProviderFactory.getSupportedProviders.mockReturnValue(['cloudflare', 'openai']);
      mockProviderFactory.getDefaultProvider.mockReturnValue('cloudflare');

      await expect(ProviderInitializer.initializeProvider(mockEnv)).rejects.toThrow(
        'Provider error (openai): OpenAI API key missing'
      );

      expect(mockConsoleError).toHaveBeenCalledWith('Provider initialization failed', {
        error: 'Provider error (openai): OpenAI API key missing',
        stack: providerError.stack,
        supportedProviders: ['cloudflare', 'openai'],
        defaultProvider: 'cloudflare',
      });
    });
  });

  describe('getProvider', () => {
    it('should return initialized provider', () => {
      const mockProvider = {
        validateConfig: vi.fn(),
        getProviderInfo: vi.fn().mockReturnValue({
          name: 'cloudflare',
          model: 'test-model',
        }),
      };

      // Manually set the provider as initialized
      ProviderInitializer['instance'] = mockProvider as any;
      ProviderInitializer['isInitialized'] = true;

      const result = ProviderInitializer.getProvider(mockEnv);

      expect(result).toBe(mockProvider);
    });

    it('should perform lazy initialization if not initialized', () => {
      const mockProvider = {
        validateConfig: vi.fn(),
        getProviderInfo: vi.fn().mockReturnValue({
          name: 'cloudflare',
          model: 'test-model',
        }),
      };

      mockProviderFactory.createProvider.mockReturnValue(mockProvider as any);

      const result = ProviderInitializer.getProvider(mockEnv);

      expect(result).toBe(mockProvider);
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        'Provider not initialized, performing lazy initialization'
      );
      expect(mockProviderFactory.createProvider).toHaveBeenCalledWith(mockEnv);
    });
  });

  describe('isProviderInitialized', () => {
    it('should return false when not initialized', () => {
      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
    });

    it('should return true when initialized', () => {
      ProviderInitializer['instance'] = {} as any;
      ProviderInitializer['isInitialized'] = true;

      expect(ProviderInitializer.isProviderInitialized()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset provider state', () => {
      ProviderInitializer['instance'] = {} as any;
      ProviderInitializer['isInitialized'] = true;

      ProviderInitializer.reset();

      expect(ProviderInitializer.isProviderInitialized()).toBe(false);
      expect(ProviderInitializer['instance']).toBeNull();
    });
  });

  describe('logProviderInfo', () => {
    it('should log provider information when initialized', () => {
      const mockProvider = {
        getProviderInfo: vi.fn().mockReturnValue({
          name: 'cloudflare',
          model: 'test-model',
          version: '1.0',
        }),
      };

      ProviderInitializer['instance'] = mockProvider as any;
      ProviderInitializer['isInitialized'] = true;

      ProviderInitializer.logProviderInfo(mockEnv);

      expect(mockConsoleLog).toHaveBeenCalledWith('Active provider information', {
        provider: 'cloudflare',
        model: 'test-model',
        version: '1.0',
        initialized: true,
      });
    });

    it('should handle error when logging provider info fails', () => {
      const error = new Error('Provider info failed');
      mockProviderFactory.createProvider.mockImplementation(() => {
        throw error;
      });

      ProviderInitializer.logProviderInfo(mockEnv);

      expect(mockConsoleError).toHaveBeenCalledWith('Failed to log provider information', {
        error: 'Provider info failed',
        initialized: false,
      });
    });
  });
});