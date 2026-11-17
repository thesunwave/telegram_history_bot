import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTopCriminalUsersBySentence,
  getTopProfanityRateUsers,
  getTopProfanityUsers,
  getTopProfanityWords
} from '../src/features/stats/stats';
import { Env } from '../src/core/env';
import { createRealD1, seedProfanityWord, seedUserDay, seedUsername, type RealD1 } from './helpers/real-d1';

describe("Profanity Stats Optimization", () => {
  let mockEnv: Env;
  let d1: RealD1;
  const chatId = 123;
  let todayStr: string;
  let yesterdayStr: string;
  const today = () => todayStr;
  const yesterday = () => yesterdayStr;

  beforeEach(() => {
    const now = Date.now();
    todayStr = new Date(now).toISOString().slice(0, 10);
    yesterdayStr = new Date(now - 86400000).toISOString().slice(0, 10);
    d1 = createRealD1();
    mockEnv = {
      DB: d1.db,
      COUNTERS_DO: {
        idFromName: vi.fn(),
        get: vi.fn(),
      },
    } as any;
  });

  describe("getTopProfanityUsers", () => {
    it("only counts rows inside the 'today' period", async () => {
      seedUserDay(d1, { chatId, userId: 1, day: today(), profanity: 5 });
      seedUserDay(d1, { chatId, userId: 2, day: yesterday(), profanity: 10 });
      seedUserDay(d1, { chatId, userId: 3, day: today(), profanity: 5 });
      seedUsername(d1, chatId, 1, "one");
      seedUsername(d1, chatId, 3, "three");

      const result = await getTopProfanityUsers(mockEnv, chatId, 5, "today");

      expect(result.map((u) => [u.userId, u.username, u.count])).toEqual([
        [1, "one", 5],
        [3, "three", 5],
      ]);
    });

    it("caps the result at the requested limit", async () => {
      for (let i = 1; i <= 15; i++) {
        seedUserDay(d1, { chatId, userId: i, day: today(), profanity: 1 });
      }

      const result = await getTopProfanityUsers(mockEnv, chatId, 10, "today");

      expect(result).toHaveLength(10);
    });
  });

  describe("getTopProfanityRateUsers", () => {
    it("should rank users by profanity share and ignore users below the word threshold", async () => {
      seedUserDay(d1, { chatId, userId: 1, day: today(), profanity: 50, words: 5000 });
      seedUserDay(d1, { chatId, userId: 2, day: today(), profanity: 20, words: 400 });
      seedUserDay(d1, { chatId, userId: 3, day: today(), profanity: 1, words: 2 });
      seedUsername(d1, chatId, 1, "anna");
      seedUsername(d1, chatId, 2, "boris");
      seedUsername(d1, chatId, 3, "short");

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
    it("only counts words inside the period", async () => {
      seedProfanityWord(d1, chatId, today(), "заебал", null, 5);
      seedProfanityWord(d1, chatId, yesterday(), "пиздец", null, 5);
      seedProfanityWord(d1, chatId, today(), "ебаный", null, 5);

      const result = await getTopProfanityWords(mockEnv, chatId, 5, "today");

      expect(result.map((w) => w.word).sort()).toEqual(["ебаный", "заебал"]);
    });

    it("should include top users for each profanity word", async () => {
      seedProfanityWord(d1, chatId, today(), "заебал", 1, 60);
      seedProfanityWord(d1, chatId, today(), "заебал", 2, 32);
      seedUsername(d1, chatId, 1, "alice");
      seedUsername(d1, chatId, 2, "bob");

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
      const sentenceRows = [
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
      ];
      const usernameRows = [
        { user_id: 1, username: 'first_user' },
        { user_id: 2, username: 'life_user' },
      ];

      mockEnv.DB = {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({
              results: sql.includes('stats_chat_user_profile')
                ? usernameRows
                : sql.includes('stats_user_profile')
                  ? []
                  : sentenceRows,
            }),
          }),
        })),
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
