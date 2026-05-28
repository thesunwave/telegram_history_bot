import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTopCriminalUsersBySentence,
  getTopProfanityRateUsers,
  getTopProfanityUsers,
  getTopProfanityWords
} from '../src/features/stats/stats';
import { Env } from '../src/core/env';

describe("Profanity Stats Optimization", () => {
  let mockEnv: Env;
  let mockCounters: any;

  beforeEach(() => {
    mockCounters = {
      list: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    mockEnv = {
      COUNTERS: mockCounters,
      COUNTERS_DO: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    } as any;
  });

  describe("getTopProfanityUsers", () => {
    it("should filter keys by date before fetching values for 'today'", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const chatId = 123;

      // Mock list response with keys from today and yesterday
      mockCounters.list.mockResolvedValue({
        keys: [
          { name: `profanity:${chatId}:1:${today}` },
          { name: `profanity:${chatId}:2:${yesterday}` },
          { name: `profanity:${chatId}:3:${today}` },
        ],
        list_complete: true,
      });

      // Mock get response
      mockCounters.get.mockImplementation((key: string) => {
        if (key.includes(today)) return Promise.resolve("5");
        return Promise.resolve("10");
      });

      // Call function
      await getTopProfanityUsers(mockEnv, chatId, 5, "today");

      // Verify list was called
      expect(mockCounters.list).toHaveBeenCalledWith({
        prefix: `profanity:${chatId}:`,
        cursor: undefined,
      });

      // Verify get was called ONLY for today's keys
      expect(mockCounters.get).toHaveBeenCalledWith(`profanity:${chatId}:1:${today}`);
      expect(mockCounters.get).toHaveBeenCalledWith(`profanity:${chatId}:3:${today}`);
      expect(mockCounters.get).not.toHaveBeenCalledWith(`profanity:${chatId}:2:${yesterday}`);
      
      // We also expect get calls for usernames at the end
      expect(mockCounters.get).toHaveBeenCalledWith(`user:1`);
      expect(mockCounters.get).toHaveBeenCalledWith(`user:3`);
    });

    it("should process keys in batches", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const chatId = 123;
      
      // Generate 15 keys (batch size is 10)
      const keys = [];
      for (let i = 1; i <= 15; i++) {
        keys.push({ name: `profanity:${chatId}:${i}:${today}` });
      }

      mockCounters.list.mockResolvedValue({
        keys,
        list_complete: true,
      });

      mockCounters.get.mockResolvedValue("1");

      await getTopProfanityUsers(mockEnv, chatId, 20, "today");

      // Verify all gets were called (15 for stats + 15 for usernames)
      // Note: we can't easily verify batching via spy, but we verify functionality holds
      expect(mockCounters.get).toHaveBeenCalledTimes(15 + 15);
    });
  });

  describe("getTopProfanityRateUsers", () => {
    it("should rank users by profanity share and ignore users below the word threshold", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const chatId = 123;

      mockCounters.list.mockImplementation(({ prefix }: { prefix: string }) => {
        if (prefix === `profanity:${chatId}:`) {
          return Promise.resolve({
            keys: [
              { name: `profanity:${chatId}:1:${today}` },
              { name: `profanity:${chatId}:2:${today}` },
              { name: `profanity:${chatId}:3:${today}` },
            ],
            list_complete: true,
          });
        }
        if (prefix === `word_stats_v2:${chatId}:`) {
          return Promise.resolve({
            keys: [
              { name: `word_stats_v2:${chatId}:${today}:1` },
              { name: `word_stats_v2:${chatId}:${today}:2` },
              { name: `word_stats_v2:${chatId}:${today}:3` },
            ],
            list_complete: true,
          });
        }
        return Promise.resolve({ keys: [], list_complete: true });
      });

      mockCounters.get.mockImplementation((key: string) => {
        if (key === `profanity:${chatId}:1:${today}`) return Promise.resolve("50");
        if (key === `profanity:${chatId}:2:${today}`) return Promise.resolve("20");
        if (key === `profanity:${chatId}:3:${today}`) return Promise.resolve("1");
        if (key === `word_stats_v2:${chatId}:${today}:1`) return Promise.resolve("5000");
        if (key === `word_stats_v2:${chatId}:${today}:2`) return Promise.resolve("400");
        if (key === `word_stats_v2:${chatId}:${today}:3`) return Promise.resolve("2");
        if (key === "user:1") return Promise.resolve("anna");
        if (key === "user:2") return Promise.resolve("boris");
        if (key === "user:3") return Promise.resolve("short");
        return Promise.resolve(null);
      });

      const result = await getTopProfanityRateUsers(mockEnv, chatId, 10, "today", 100);

      expect(result).toEqual([
        {
          userId: 2,
          username: "boris",
          profanityCount: 20,
          wordCount: 400,
          rate: 5,
        },
        {
          userId: 1,
          username: "anna",
          profanityCount: 50,
          wordCount: 5000,
          rate: 1,
        },
      ]);
    });
  });
  
  describe("getTopProfanityWords", () => {
      it("should filter keys by date before fetching values", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const chatId = 123;

      // Mock list response with keys from today and yesterday
      mockCounters.list.mockResolvedValue({
        keys: [
          { name: `profanity_words:${chatId}:заебал:${today}` },
          { name: `profanity_words:${chatId}:пиздец:${yesterday}` },
          { name: `profanity_words:${chatId}:ебаный:${today}` },
        ],
        list_complete: true,
      });

      // Mock get response
      mockCounters.get.mockResolvedValue("5");

      // Call function
      await getTopProfanityWords(mockEnv, chatId, 5, "today");

      // Verify list was called
      expect(mockCounters.list).toHaveBeenCalledWith({
        prefix: `profanity_words:${chatId}:`,
        cursor: undefined,
      });

      // Verify get was called ONLY for today's keys
      expect(mockCounters.get).toHaveBeenCalledWith(`profanity_words:${chatId}:заебал:${today}`);
      expect(mockCounters.get).toHaveBeenCalledWith(`profanity_words:${chatId}:ебаный:${today}`);
      expect(mockCounters.get).not.toHaveBeenCalledWith(`profanity_words:${chatId}:пиздец:${yesterday}`);
    });

    it("should include top users for each profanity word", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const chatId = 123;

      mockCounters.list.mockImplementation(({ prefix }: { prefix: string }) => {
        if (prefix === `profanity_words:${chatId}:`) {
          return Promise.resolve({
            keys: [{ name: `profanity_words:${chatId}:заебал:${today}` }],
            list_complete: true,
          });
        }
        if (prefix === `profanity_word_users:${chatId}:заебал:`) {
          return Promise.resolve({
            keys: [
              { name: `profanity_word_users:${chatId}:заебал:${today}:1` },
              { name: `profanity_word_users:${chatId}:заебал:${today}:2` },
            ],
            list_complete: true,
          });
        }
        return Promise.resolve({ keys: [], list_complete: true });
      });

      mockCounters.get.mockImplementation((key: string) => {
        if (key === `profanity_words:${chatId}:заебал:${today}`) return Promise.resolve("92");
        if (key === `profanity_word_users:${chatId}:заебал:${today}:1`) return Promise.resolve("60");
        if (key === `profanity_word_users:${chatId}:заебал:${today}:2`) return Promise.resolve("32");
        if (key === "user:1") return Promise.resolve("alice");
        if (key === "user:2") return Promise.resolve("bob");
        return Promise.resolve(null);
      });

      const result = await getTopProfanityWords(mockEnv, chatId, 5, "today");

      expect(result).toEqual([
        {
          word: "заебал",
          count: 92,
          censored: "з****л",
          contributors: [
            { userId: 1, username: "alice", count: 60 },
            { userId: 2, username: "bob", count: 32 },
          ],
        },
      ]);
    });
  });

  describe("getTopCriminalUsersBySentence", () => {
    it("should rank criminal users by sentence totals from D1", async () => {
      const chatId = 123;
      mockCounters.get.mockImplementation((key: string) => {
        if (key === 'user:1') return Promise.resolve('first_user');
        if (key === 'user:2') return Promise.resolve('life_user');
        return Promise.resolve(null);
      });

      mockEnv.DB = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  user_id: 1,
                  article: '205',
                  subarticle: null,
                  article_title: 'Терроризм',
                  punishment: 'лишение свободы на срок до 15 лет',
                  count: 2,
                  average_severity: 9,
                },
                {
                  user_id: 2,
                  article: '105',
                  subarticle: null,
                  article_title: 'Убийство',
                  punishment: 'пожизненное лишение свободы',
                  count: 1,
                  average_severity: 10,
                },
              ],
            }),
          }),
        }),
      } as any;

      const result = await getTopCriminalUsersBySentence(mockEnv, chatId, 2, 'today');

      expect(result).toEqual([
        {
          userId: 2,
          username: 'life_user',
          count: 1,
          totalYears: 0,
          lifeSentences: 1,
        },
        {
          userId: 1,
          username: 'first_user',
          count: 2,
          totalYears: 30,
          lifeSentences: 0,
        },
      ]);
    });
  });
});
