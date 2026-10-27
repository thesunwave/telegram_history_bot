import { describe, expect, it } from 'vitest';
import { resetCounters, resetCriminalCounters, resetProfanityCounters } from '../../src/features/stats/stats';
import { createMockEnv } from '../test-utils';
import { createRealD1, seedHour, seedProfanityWord, seedUserDay } from '../helpers/real-d1';
import { withRealCountersDO } from '../helpers/real-counters-do';

describe('stats reset — D1 aggregates', () => {
  it('removes every aggregate row of one chat while preserving other chats', async () => {
    const d1 = createRealD1();
    const env = withRealCountersDO(createMockEnv({ DB: d1.db as any }));

    seedUserDay(d1, { chatId: 42, userId: 7, day: '2026-10-15', messages: 3, profanity: 1 });
    seedHour(d1, 42, '2026-10-15', 10, 3);
    seedProfanityWord(d1, 42, '2026-10-15', 'word', 7, 1);
    seedUserDay(d1, { chatId: 99, userId: 7, day: '2026-10-15', messages: 5 });

    await resetCounters(env, 42);

    for (const table of ['stats_daily_user', 'stats_daily_hour', 'stats_daily_profanity_word', 'stats_daily_profanity_word_user', 'activity']) {
      expect(d1.rows(`SELECT * FROM ${table} WHERE chat_id = 42`)).toEqual([]);
    }
    expect(d1.rows('SELECT message_count FROM stats_daily_user WHERE chat_id = 99')).toEqual([{ message_count: 5 }]);
  });

  it('category resets zero only their own counters', async () => {
    const d1 = createRealD1();
    const env = withRealCountersDO(createMockEnv({ DB: d1.db as any }));
    seedUserDay(d1, { chatId: 42, userId: 7, day: '2026-10-15', messages: 3, profanity: 2, criminal: 1, criminalSeverity: 4 });
    seedProfanityWord(d1, 42, '2026-10-15', 'word', 7, 2);

    await resetProfanityCounters(env, 42);
    expect(d1.rows('SELECT message_count, profanity_count, criminal_count FROM stats_daily_user WHERE chat_id = 42'))
      .toEqual([{ message_count: 3, profanity_count: 0, criminal_count: 1 }]);
    expect(d1.rows('SELECT * FROM stats_daily_profanity_word WHERE chat_id = 42')).toEqual([]);

    await resetCriminalCounters(env, 42);
    expect(d1.rows('SELECT message_count, criminal_count, criminal_severity FROM stats_daily_user WHERE chat_id = 42'))
      .toEqual([{ message_count: 3, criminal_count: 0, criminal_severity: 0 }]);
  });
});
