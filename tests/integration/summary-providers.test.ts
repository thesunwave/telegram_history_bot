import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import worker, { CountersDO } from '../../src/index';
import { KVNamespace } from '@miniflare/kv';
import { MemoryStorage } from '@miniflare/storage-memory';
import { D1Database } from '@miniflare/d1';
import { ProviderInitializer } from '../../src/providers/provider-init';

interface Env {
  HISTORY: KVNamespace;
  COUNTERS: KVNamespace;
  COUNTERS_DO: any;
  DB: D1Database;
  AI: { run: (model: string, opts: any) => Promise<any> };
  TOKEN: string;
  SECRET: string;
  SUMMARY_MODEL: string;
  SUMMARY_PROMPT: string;
  SUMMARY_SYSTEM?: string;
  SUMMARY_CHUNK_SIZE?: number;
  SUMMARY_PROVIDER?: 'cloudflare' | 'openai';
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  SUMMARY_MAX_TOKENS?: number;
  SUMMARY_TEMPERATURE?: number;
  SUMMARY_TOP_P?: number;
  SUMMARY_FREQUENCY_PENALTY?: number;
}

function createCountersNamespace(env: Env) {
  const objects = new Map<string, { obj: any; chain: Promise<any> }>();
  return {
    idFromName(name: string) {
      return name as any;
    },
    get(id: string) {
      let entry = objects.get(id);
      if (!entry) {
        const state = {
          blockConcurrencyWhile: async (fn: () => Promise<any>) => await fn(),
        } as any;
        entry = { obj: new CountersDO(state, env), chain: Promise.resolve() };
        objects.set(id, entry);
      }
      return {
        fetch: (url: string, init?: RequestInit) => {
          entry!.chain = entry!.chain.then(() =>
            entry!.obj.fetch(new Request(url, init)),
          );
          return entry!.chain;
        },
      } as any;
    },
  };
}

describe('Summary Providers Integration Tests', () => {
  let env: Env;
  let ctx: any;
  let tasks: Promise<any>[];
  let fetchMock: any;

  beforeEach(async () => {
    tasks = [];
    ctx = { waitUntil: (p: Promise<any>) => tasks.push(p) };
    ProviderInitializer.reset();
    
    const history = new KVNamespace(new MemoryStorage());
    const counters = new KVNamespace(new MemoryStorage());
    const db = {
      prepare: vi.fn(() => ({
        bind: () => ({
          run: vi.fn(),
          all: vi.fn(async () => ({ results: [] })),
        }),
      })),
    } as unknown as D1Database;

    env = {
      HISTORY: history,
      COUNTERS: counters,
      COUNTERS_DO: {} as any,
      DB: db,
      AI: { run: vi.fn(async () => ({ response: "Cloudflare AI summary" })) },
      TOKEN: "test-token",
      SECRET: "test-secret",
      SUMMARY_MODEL: "test-model",
      SUMMARY_PROMPT: "Summarize this conversation",
      SUMMARY_SYSTEM: "You are a helpful assistant",
      SUMMARY_CHUNK_SIZE: undefined,
      SUMMARY_PROVIDER: undefined,
      OPENAI_API_KEY: undefined,
      OPENAI_MODEL: undefined,
      SUMMARY_MAX_TOKENS: 400,
      SUMMARY_TEMPERATURE: 0.2,
      SUMMARY_TOP_P: 0.95,
      SUMMARY_FREQUENCY_PENALTY: 0.1,
    };
    
    env.COUNTERS_DO = createCountersNamespace(env);
    
    fetchMock = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Complete summarization flow with both providers', () => {
    async function setupMessages(count: number = 3) {
      const now = Math.floor(Date.now() / 1000);
      const messages = [];
      
      for (let i = 0; i < count; i++) {
        const message = {
          message: {
            message_id: i + 1,
            text: `Test message ${i + 1}`,
            chat: { id: 1 },
            from: { id: 2 + i, username: `user${i + 1}` },
            date: now + i,
          },
        };
        
        const req = new Request("http://localhost/tg/test-token/webhook", {
          method: "POST",
          headers: {
            "X-Telegram-Bot-Api-Secret-Token": "test-secret",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(message),
        });
        
        await worker.fetch(req, env, ctx);
        messages.push(message);
      }
      
      await Promise.all(tasks);
      tasks = [];
      return messages;
    }

    it('should complete summarization flow with Cloudflare provider', async () => {
      env.SUMMARY_PROVIDER = 'cloudflare';
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(3);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Verify Cloudflare AI was called
      expect(env.AI.run).toHaveBeenCalledWith(
        "test-model",
        expect.objectContaining({
          prompt: expect.stringContaining("Test message"),
        })
      );
      
      // Verify Telegram message was sent
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Cloudflare AI summary')
        })
      );
    });

    it('should complete summarization flow with OpenAI provider', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-openai-key';
      env.OPENAI_MODEL = 'gpt-3.5-turbo';
      
      // Mock OpenAI API response
      const openaiResponse = {
        choices: [
          {
            message: {
              content: 'OpenAI summary of the conversation'
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
      
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(3);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Verify OpenAI API was called
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-openai-key',
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('gpt-3.5-turbo')
        })
      );
      
      // Verify Telegram message was sent with OpenAI response
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('OpenAI summary of the conversation')
        })
      );
    });

    it('should complete summarization flow with /summary_last command', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-openai-key';
      
      const openaiResponse = {
        choices: [{ message: { content: 'Last messages summary' } }],
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }
      };
      
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(5);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary_last 3",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Verify OpenAI was called for last messages
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          body: expect.stringContaining('Test message')
        })
      );
      
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Last messages summary')
        })
      );
    });
  });

  describe('Provider switching functionality', () => {
    it('should switch from Cloudflare to OpenAI provider', async () => {
      // First request with Cloudflare
      env.SUMMARY_PROVIDER = 'cloudflare';
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd1 = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      let req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd1),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      expect(env.AI.run).toHaveBeenCalled();
      
      // Reset for second request
      vi.clearAllMocks();
      fetchMock.mockClear();
      tasks = [];
      ProviderInitializer.reset();
      
      // Second request with OpenAI
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-openai-key';
      
      const openaiResponse = {
        choices: [{ message: { content: 'OpenAI switched summary' } }],
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
      };
      
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      const summaryCmd2 = {
        message: {
          message_id: 11,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000) + 1,
        },
      };
      
      req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd2),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Verify OpenAI was called instead of Cloudflare
      expect(env.AI.run).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.any(Object)
      );
    });

    it('should handle provider switching with different models', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-key';
      env.OPENAI_MODEL = 'gpt-4';
      
      const openaiResponse = {
        choices: [{ message: { content: 'GPT-4 summary' } }],
        usage: { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90 }
      };
      
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Verify GPT-4 model was used
      const openaiCall = fetchMock.mock.calls.find(call => 
        call[0].includes('chat/completions')
      );
      expect(openaiCall).toBeDefined();
      const requestBody = JSON.parse(openaiCall[1].body);
      expect(requestBody.model).toBe('gpt-4');
    });
  });

  describe('Error scenarios', () => {
    it('should handle missing OpenAI API key', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      // OPENAI_API_KEY is undefined
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Should send error message to user
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Ошибка при создании сводки')
        })
      );
    });

    it('should handle OpenAI API 401 unauthorized error', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'invalid-key';
      
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({
            error: { message: 'Invalid API key' }
          })
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Should send error message to user
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Ошибка при создании сводки')
        })
      );
    });

    it('should handle OpenAI API 429 rate limit error', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-key';
      
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          json: () => Promise.resolve({
            error: { message: 'Rate limit exceeded' }
          })
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Ошибка при создании сводки')
        })
      );
    });

    it('should handle Cloudflare AI binding missing', async () => {
      env.SUMMARY_PROVIDER = 'cloudflare';
      env.AI = undefined as any;
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Ошибка при создании сводки')
        })
      );
    });

    it('should handle invalid provider configuration', async () => {
      env.SUMMARY_PROVIDER = 'invalid-provider' as any;
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Произошла непредвиденная ошибка')
        })
      );
    });
  });

  describe('Chunking functionality with both providers', () => {
    it('should handle chunking with Cloudflare provider', async () => {
      env.SUMMARY_PROVIDER = 'cloudflare';
      env.SUMMARY_CHUNK_SIZE = 100; // Small chunk size to force chunking
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      // Create a long message that will exceed chunk size
      const longMessage = {
        message: {
          message_id: 1,
          text: "a".repeat(200), // Long text to trigger chunking
          chat: { id: 1 },
          from: { id: 2, username: "user1" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req1 = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(longMessage),
      });
      
      await worker.fetch(req1, env, ctx);
      await Promise.all(tasks);
      tasks = [];
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req2 = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req2, env, ctx);
      await Promise.all(tasks);
      
      // Should call AI multiple times for chunking (parts + final summary)
      expect(env.AI.run).toHaveBeenCalledTimes(4); // 3 parts + 1 final
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.any(Object)
      );
    });

    it('should handle chunking with OpenAI provider', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-key';
      env.SUMMARY_CHUNK_SIZE = 100;
      
      const openaiResponse = {
        choices: [{ message: { content: 'Chunk summary' } }],
        usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
      };
      
      // Mock multiple OpenAI calls for chunking (3 parts + 1 final + telegram message)
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ...openaiResponse, choices: [{ message: { content: 'Final summary' } }] })
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      // Create a long message
      const longMessage = {
        message: {
          message_id: 1,
          text: "b".repeat(200),
          chat: { id: 1 },
          from: { id: 2, username: "user1" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req1 = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(longMessage),
      });
      
      await worker.fetch(req1, env, ctx);
      await Promise.all(tasks);
      tasks = [];
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req2 = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req2, env, ctx);
      await Promise.all(tasks);
      
      // Should call OpenAI API multiple times for chunking
      const openaiCalls = fetchMock.mock.calls.filter(call => 
        call[0].includes('chat/completions')
      );
      expect(openaiCalls).toHaveLength(4); // 3 parts + 1 final
      
      // Verify final message was sent
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Final summary')
        })
      );
    });

    it('should handle chunking error scenarios', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-key';
      env.SUMMARY_CHUNK_SIZE = 100;
      
      // Mock first chunk success, second chunk failure
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            choices: [{ message: { content: 'First chunk' } }],
            usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 }
          })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({
            error: { message: 'Server error' }
          })
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      const longMessage = {
        message: {
          message_id: 1,
          text: "c".repeat(200),
          chat: { id: 1 },
          from: { id: 2, username: "user1" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req1 = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(longMessage),
      });
      
      await worker.fetch(req1, env, ctx);
      await Promise.all(tasks);
      tasks = [];
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req2 = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req2, env, ctx);
      await Promise.all(tasks);
      
      // Should send error message when chunking fails
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Ошибка при создании сводки')
        })
      );
    });
  });

  describe('Backward compatibility with existing configurations', () => {
    it('should default to Cloudflare provider when SUMMARY_PROVIDER is not set', async () => {
      // SUMMARY_PROVIDER is undefined (default behavior)
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Should use Cloudflare AI (existing behavior)
      expect(env.AI.run).toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.any(Object)
      );
    });

    it('should work with existing SUMMARY_MODEL configurations', async () => {
      env.SUMMARY_MODEL = 'existing-model';
      (env as any).CLOUDFLARE_MODEL = undefined; // Clear to test fallback
      // No SUMMARY_PROVIDER set, should default to cloudflare
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Should use the existing model with Cloudflare provider
      expect(env.AI.run).toHaveBeenCalledWith(
        'existing-model',
        expect.any(Object)
      );
    });

    it('should work with existing chat model configurations', async () => {
      env.SUMMARY_MODEL = 'existing-chat-model';
      (env as any).CLOUDFLARE_MODEL = undefined; // Clear to test fallback
      // No SUMMARY_PROVIDER set, should default to cloudflare
      
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Should use chat format with existing model
      expect(env.AI.run).toHaveBeenCalledWith(
        'existing-chat-model',
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'system'
            }),
            expect.objectContaining({
              role: 'user'
            })
          ])
        })
      );
    });

    it('should preserve existing summary options and parameters', async () => {
      env.SUMMARY_MAX_TOKENS = 500;
      env.SUMMARY_TEMPERATURE = 0.8;
      env.SUMMARY_TOP_P = 0.95;
      env.SUMMARY_FREQUENCY_PENALTY = 0.2;
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-key';
      // Clear new config variables to test fallback to old ones
      (env as any).OPENAI_MAX_TOKENS = undefined;
      (env as any).OPENAI_TEMPERATURE = undefined;
      (env as any).OPENAI_TOP_P = undefined;
      (env as any).OPENAI_FREQUENCY_PENALTY = undefined;
      
      const openaiResponse = {
        choices: [{ message: { content: 'Custom params summary' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      };
      
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Verify custom parameters were used
      const openaiCall = fetchMock.mock.calls.find(call => 
        call[0].includes('chat/completions')
      );
      expect(openaiCall).toBeDefined();
      const requestBody = JSON.parse(openaiCall[1].body);
      
      expect(requestBody.max_tokens).toBe(500);
      expect(requestBody.temperature).toBe(0.8); // Should use SUMMARY_TEMPERATURE as fallback
      expect(requestBody.top_p).toBe(0.95);
      expect(requestBody.frequency_penalty).toBe(0.2);
    });

    it('should handle missing OPENAI_MODEL gracefully with default', async () => {
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-key';
      // OPENAI_MODEL is not set, should use default
      
      const openaiResponse = {
        choices: [{ message: { content: 'Default model summary' } }],
        usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 }
      };
      
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Should use default OpenAI model
      const openaiCall = fetchMock.mock.calls.find(call => 
        call[0].includes('chat/completions')
      );
      expect(openaiCall).toBeDefined();
      const requestBody = JSON.parse(openaiCall[1].body);
      expect(requestBody.model).toBe('gpt-3.5-turbo'); // Default model
    });

    it('should maintain existing prompt and system message behavior', async () => {
      env.SUMMARY_PROMPT = 'Custom summary prompt';
      env.SUMMARY_SYSTEM = 'Custom system message';
      env.SUMMARY_PROVIDER = 'openai';
      env.OPENAI_API_KEY = 'test-key';
      
      const openaiResponse = {
        choices: [{ message: { content: 'Custom prompt summary' } }],
        usage: { prompt_tokens: 60, completion_tokens: 30, total_tokens: 90 }
      };
      
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(openaiResponse)
        })
        .mockResolvedValueOnce(new Response(null, { status: 200 }));
      
      await setupMessages(2);
      
      const summaryCmd = {
        message: {
          message_id: 10,
          text: "/summary 1",
          chat: { id: 1 },
          from: { id: 10, username: "requester" },
          date: Math.floor(Date.now() / 1000),
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(summaryCmd),
      });
      
      await worker.fetch(req, env, ctx);
      await Promise.all(tasks);
      
      // Verify custom prompts were used
      const openaiCall = fetchMock.mock.calls.find(call => 
        call[0].includes('chat/completions')
      );
      expect(openaiCall).toBeDefined();
      const requestBody = JSON.parse(openaiCall[1].body);
      
      expect(requestBody.messages[0].content).toContain('Custom system message');
      expect(requestBody.messages[1].content).toContain('Custom summary prompt');
    });
  });

  async function setupMessages(count: number = 3) {
    const now = Math.floor(Date.now() / 1000);
    const messages = [];
    
    for (let i = 0; i < count; i++) {
      const message = {
        message: {
          message_id: i + 1,
          text: `Test message ${i + 1}`,
          chat: { id: 1 },
          from: { id: 2 + i, username: `user${i + 1}` },
          date: now + i,
        },
      };
      
      const req = new Request("http://localhost/tg/test-token/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "test-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });
      
      await worker.fetch(req, env, ctx);
      messages.push(message);
    }
    
    await Promise.all(tasks);
    tasks = [];
    return messages;
  }
});