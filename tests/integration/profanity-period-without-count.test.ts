import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleUpdate } from '../../src/api/update';
import { sendMessage } from '../../src/core/telegram';
import type { Env } from '../../src/core/env';
import { createMockEnv } from '../test-utils';
import { createKVBindings } from '../helpers/miniflare-kv';
import { createRealD1, seedProfanityWord, seedUserDay, seedUsername, type RealD1 } from '../helpers/real-d1';

vi.mock('../../src/core/telegram', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../src/core/logger', () => ({
  Logger: {
    debug: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    logApiRequestPattern: vi.fn(),
    logPerformanceInsight: vi.fn(),
  },
  PerformanceTracker: {
    start: vi.fn().mockReturnValue('mock-tracker-id'),
    end: vi.fn().mockReturnValue({ functionName: 'test', duration: 100 }),
    getActiveTrackers: vi.fn().mockReturnValue(new Map()),
    cleanup: vi.fn(),
  },
}));

vi.mock('../../src/env', async () => {
  const actual = await vi.importActual('../../src/env');
  return { ...actual, isTestEnvironment: vi.fn().mockReturnValue(false) };
});

const NO_USERS = 'Нет данных о матерной лексике';
const NO_WORDS = 'Нет данных о матерных словах';

describe('profanity commands — period without count (regression)', () => {
  let mockEnv: Env;
  let mockSendMessage: any;
  let bindings: Awaited<ReturnType<typeof createKVBindings>>;
  let d1: RealD1;
  const testChatId = -100123456789;
  const today = new Date().toISOString().slice(0, 10);

  function daysAgo(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSendMessage = vi.mocked(sendMessage);
    bindings = await createKVBindings();
    d1 = createRealD1();
    mockEnv = createMockEnv({
      HISTORY: bindings.history as any,
      DB: d1.db as any,
    });
  });

  afterEach(async () => {
    await bindings.mf.dispose();
  });

  function createMessage(text: string, userId = 123456, username = 'alice') {
    return {
      message_id: Math.floor(Math.random() * 1e6),
      chat: { id: testChatId },
      from: { id: userId, username },
      text,
      date: Math.floor(Date.now() / 1000),
    };
  }

  async function seedUsers(counts: Record<string, number>, usernames: Record<string, string> = {}) {
    for (const [userId, count] of Object.entries(counts)) {
      seedUserDay(d1, { chatId: testChatId, userId: Number(userId), day: today, profanity: count });
    }
    for (const [userId, name] of Object.entries(usernames)) {
      seedUsername(d1, testChatId, Number(userId), name);
    }
  }

  async function seedWords(counts: Record<string, number>) {
    for (const [word, count] of Object.entries(counts)) {
      seedProfanityWord(d1, testChatId, today, word, null, count);
    }
  }

  function lastReply(): string {
    expect(mockSendMessage).toHaveBeenCalled();
    return mockSendMessage.mock.calls.at(-1)![2];
  }

  describe('/profanity_top <period> (period without count — the bug)', () => {
    beforeEach(async () => {
      await seedUsers({ '111': 5, '222': 8, '333': 3 }, {
        '111': 'alice', '222': 'bob', '333': 'carol',
      });
    });

    it('returns data for /profanity_top today (default 10, period today)', async () => {
      await handleUpdate(createMessage('/profanity_top today'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_USERS);
      expect(reply).toContain('Топ матершинников');
      expect(reply).toContain('bob');
    });

    it('returns week data outside today for /profanity_top week', async () => {
      seedUserDay(d1, { chatId: testChatId, userId: 444, day: daysAgo(1), profanity: 20 });
      seedUsername(d1, testChatId, 444, 'dave');

      await handleUpdate(createMessage('/profanity_top week'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_USERS);
      expect(reply).toContain('Топ матершинников');
      expect(reply).toContain('dave');
    });

    it('returns month data outside the week for /profanity_top month', async () => {
      seedUserDay(d1, { chatId: testChatId, userId: 555, day: daysAgo(10), profanity: 20 });
      seedUsername(d1, testChatId, 555, 'eve');

      await handleUpdate(createMessage('/profanity_top month'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_USERS);
      expect(reply).toContain('Топ матершинников');
      expect(reply).toContain('eve');
    });
  });

  describe('/profanity_words <period> (period without count — the bug)', () => {
    beforeEach(async () => {
      await seedWords({ 'worda': 4, 'wordb': 9, 'wordc': 2 });
    });

    it('returns data for /profanity_words today', async () => {
      await handleUpdate(createMessage('/profanity_words today'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_WORDS);
      expect(reply).toContain('Топ матерных слов');
      expect(reply).toContain('wordb');
    });

    it('returns week data outside today for /profanity_words week', async () => {
      seedProfanityWord(d1, testChatId, daysAgo(1), 'weekword', null, 20);

      await handleUpdate(createMessage('/profanity_words week'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_WORDS);
      expect(reply).toContain('Топ матерных слов');
      expect(reply).toContain('weekword');
    });

    it('returns month data outside the week for /profanity_words month', async () => {
      seedProfanityWord(d1, testChatId, daysAgo(10), 'monthword', null, 20);

      await handleUpdate(createMessage('/profanity_words month'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_WORDS);
      expect(reply).toContain('Топ матерных слов');
      expect(reply).toContain('monthword');
    });
  });

  describe('no regression — count + period and edge cases', () => {
    beforeEach(async () => {
      await seedUsers({ '111': 5, '222': 8, '333': 3 }, {
        '111': 'alice', '222': 'bob', '333': 'carol',
      });
      await seedWords({ 'worda': 4, 'wordb': 9, 'wordc': 2 });
    });

    it('/profanity_top (bare) defaults to count 10, period today', async () => {
      await handleUpdate(createMessage('/profanity_top'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_USERS);
      expect(reply).toContain('Топ матершинников');
      expect(reply).toContain('bob');
      expect(reply).toContain('carol');
    });

    it('/profanity_top 2 today honours a small count and omits the rest', async () => {
      await handleUpdate(createMessage('/profanity_top 2 today'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_USERS);
      expect(reply).toContain('bob');
      expect(reply).toContain('alice');
      expect(reply).not.toContain('carol');
    });

    it('/profanity_top 100 today clamps count to 20', async () => {
      await handleUpdate(createMessage('/profanity_top 100 today'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_USERS);
      expect(reply).toContain('bob');
      expect(reply).toContain('alice');
      expect(reply).toContain('carol');
    });

    it('/profanity_top 0 today clamps count to 1', async () => {
      await handleUpdate(createMessage('/profanity_top 0 today'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_USERS);
      expect(reply).toContain('bob');
      expect(reply).not.toContain('alice');
    });

    it('/profanity_words 10 week (count + period) still works', async () => {
      await handleUpdate(createMessage('/profanity_words 10 week'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_WORDS);
      expect(reply).toContain('Топ матерных слов');
      expect(reply).toContain('wordb');
    });

    it('/profanity_words 2 today honours a small count', async () => {
      await handleUpdate(createMessage('/profanity_words 2 today'), mockEnv);
      const reply = lastReply();
      expect(reply).not.toBe(NO_WORDS);
      expect(reply).toContain('wordb');
      expect(reply).toContain('worda');
      expect(reply).not.toContain('wordc');
    });
  });

  describe('no regression — genuine no-data branch still fires', () => {
    it('/profanity_top today with empty counters replies no-data', async () => {
      await handleUpdate(createMessage('/profanity_top today'), mockEnv);
      expect(lastReply()).toBe(NO_USERS);
    });

    it('/profanity_words today with empty counters replies no-data', async () => {
      await handleUpdate(createMessage('/profanity_words today'), mockEnv);
      expect(lastReply()).toBe(NO_WORDS);
    });
  });

});
