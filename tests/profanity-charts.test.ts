import { describe, it, expect, beforeEach, vi } from "vitest";
import { profanityChart } from "../src/features/stats/stats";
import type { Env } from "../src/core/env";
import { createRealD1, seedUserDay, type RealD1 } from "./helpers/real-d1";

vi.mock("../src/core/telegram", () => ({
  sendMessage: vi.fn(),
  sendPhoto: vi.fn(),
}));

import { sendMessage, sendPhoto } from "../src/core/telegram";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayOffset(offset: number): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return new Date(today.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

describe("Profanity Charts", () => {
  let env: Env;
  let d1: RealD1;

  beforeEach(() => {
    vi.clearAllMocks();
    d1 = createRealD1();
    env = { DB: d1.db, TOKEN: "test-token" } as unknown as Env;
  });

  describe("profanityChart", () => {
    it("should generate weekly profanity chart with ASCII fallback when no data", async () => {
      await profanityChart(env, 123, "week");

      expect(sendMessage).toHaveBeenCalledWith(env, 123, "Нет данных о матерной лексике");
      expect(sendPhoto).not.toHaveBeenCalled();
    });

    it("should generate weekly profanity chart with data", async () => {
      for (let i = 0; i < 7; i++) {
        seedUserDay(d1, { chatId: 123, userId: 456, day: dayOffset(i), profanity: i + 1 });
      }

      await profanityChart(env, 123, "week");

      expect(sendMessage).toHaveBeenCalledWith(env, 123, expect.stringContaining("Статистика мата за неделю"));
      expect(sendMessage).toHaveBeenCalledWith(env, 123, expect.stringContaining("Всего: 28"));
      expect(sendPhoto).toHaveBeenCalledWith(env, 123, expect.stringContaining("https://quickchart.io/chart?c="));
    });

    it("should generate monthly profanity chart with weekly aggregation", async () => {
      for (let week = 0; week < 4; week++) {
        for (let day = 0; day < 7; day++) {
          seedUserDay(d1, { chatId: 123, userId: 456, day: dayOffset(week * 7 + day), profanity: week + 1 });
        }
      }

      await profanityChart(env, 123, "month");

      expect(sendMessage).toHaveBeenCalledWith(env, 123, expect.stringContaining("Статистика мата за месяц"));
      expect(sendPhoto).toHaveBeenCalledWith(env, 123, expect.stringContaining("https://quickchart.io/chart?c="));
    });

    it("should handle QuickChart generation errors gracefully", async () => {
      seedUserDay(d1, { chatId: 123, userId: 456, day: dayOffset(0), profanity: 5 });
      vi.mocked(sendPhoto).mockRejectedValue(new Error("Chart generation failed"));

      await profanityChart(env, 123, "week");

      expect(sendMessage).toHaveBeenCalledWith(env, 123, expect.stringContaining("Статистика мата за неделю"));
      expect(sendPhoto).toHaveBeenCalled();
    });

    it("sums profanity across users and ignores other chats", async () => {
      seedUserDay(d1, { chatId: 123, userId: 456, day: dayOffset(0), profanity: 3 });
      seedUserDay(d1, { chatId: 123, userId: 789, day: dayOffset(0), profanity: 2 });
      seedUserDay(d1, { chatId: 999, userId: 456, day: dayOffset(0), profanity: 50 });

      await profanityChart(env, 123, "week");

      expect(sendMessage).toHaveBeenCalledWith(env, 123, expect.stringContaining("Всего: 5"));
    });
  });
});
