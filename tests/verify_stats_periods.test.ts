
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activityByUser, activityChart } from '../src/features/stats/stats';
import { Env } from '../src/core/env';
import { createRealD1, seedUserDay, seedUsername, type RealD1 } from './helpers/real-d1';

const mocks = vi.hoisted(() => ({
    sendMessage: vi.fn(),
    sendPhoto: vi.fn(),
}));

vi.mock('../src/core/telegram', () => ({
    sendMessage: mocks.sendMessage,
    sendPhoto: mocks.sendPhoto,
}));

describe('Stats Period Verification', () => {
    let env: Env;
    let d1: RealD1;

    beforeEach(() => {
        d1 = createRealD1();
        mocks.sendMessage.mockClear();
        mocks.sendPhoto.mockClear();

        env = {
            DB: d1.db,
        } as Env;

        // Mock Date to a fixed point in time: 2025-11-19 (Wednesday)
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-11-19T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('should correctly aggregate activityByUser for the last week (7 days)', async () => {
        const chatId = 123;
        const userId = 456;
        const username = 'testuser';

        // Today is 2025-11-19 (Wednesday)
        // Week range: 2025-11-13 to 2025-11-19 (7 days)

        // Add data for today
        seedUserDay(d1, { chatId, userId, day: '2025-11-19', messages: 10 });
        // Add data for 6 days ago (2025-11-13) - Should be INCLUDED
        seedUserDay(d1, { chatId, userId, day: '2025-11-13', messages: 5 });
        // Add data for 7 days ago (2025-11-12) - Should be EXCLUDED (if logic is strictly 7 days including today)
        // Wait, WEEK_DAYS = 6. start = today - 6.
        // 19 - 6 = 13. Range [13, 19]. 13, 14, 15, 16, 17, 18, 19 = 7 days.
        // So 12th should be excluded.
        seedUserDay(d1, { chatId, userId, day: '2025-11-12', messages: 100 });

        seedUsername(d1, chatId, userId, username);

        await activityByUser(env, chatId, 'week');

        // Check the chart URL or data passed to sendPhoto
        // We can't easily parse the URL, but we can check the logic if we inspect the calls
        // But wait, activityByUser generates a chart URL.
        // Let's inspect the arguments passed to createBarChartUrl (which is internal)
        // Or we can check the mock call to sendPhoto.

        expect(mocks.sendPhoto).toHaveBeenCalled();
        const url = mocks.sendPhoto.mock.calls[0][2];
        console.log('Chart URL:', url);

        // The URL contains the data. We can decode it.
        // https://quickchart.io/chart?c={...}
        const jsonStr = decodeURIComponent(url.split('c=')[1]);
        const chartConfig = JSON.parse(jsonStr);

        const dataset = chartConfig.data.datasets[0];
        expect(dataset.data).toEqual([15]); // 10 + 5 = 15. 100 should be ignored.
        expect(chartConfig.data.labels).toEqual(['testuser']);
    });

    it('should correctly aggregate activityByUser for the last month (30 days)', async () => {
        const chatId = 123;
        const userId = 456;
        const username = 'testuser';

        // Today: 2025-11-19
        const today = new Date('2025-11-19T00:00:00Z');
        const start = new Date(today);
        start.setUTCDate(today.getUTCDate() - 29);
        const startStr = start.toISOString().slice(0, 10);
        console.log('Month Start Date:', startStr); // 30 days including today

        // Add data inside range
        seedUserDay(d1, { chatId, userId, day: '2025-11-19', messages: 10 });
        seedUserDay(d1, { chatId, userId, day: startStr, messages: 5 }); // Boundary check (inclusive)

        // Add data outside range (one day before start)
        const beforeStart = new Date(start);
        beforeStart.setUTCDate(start.getUTCDate() - 1);
        const beforeStartStr = beforeStart.toISOString().slice(0, 10);
        seedUserDay(d1, { chatId, userId, day: beforeStartStr, messages: 100 });

        seedUsername(d1, chatId, userId, username);

        await activityByUser(env, chatId, 'month');

        expect(mocks.sendPhoto).toHaveBeenCalled();
        const url = mocks.sendPhoto.mock.calls[0][2];
        const jsonStr = decodeURIComponent(url.split('c=')[1]);
        const chartConfig = JSON.parse(jsonStr);

        const dataset = chartConfig.data.datasets[0];
        expect(dataset.data).toEqual([15]); // 10 + 5. 100 ignored.
    });

    it('should correctly bucket activityChart for week', async () => {
        const chatId = 123;
        // Today 2025-11-19 (Wed)
        // Buckets: Su, Mo, Tu, We, Th, Fr, Sa
        // 19 (Wed), 18 (Tue), 17 (Mon), 16 (Sun), 15 (Sat), 14 (Fri), 13 (Thu)
        // Note: The code iterates 6 down to 0.
        // i=6: today-6 = 13 (Thu)
        // i=5: today-5 = 14 (Fri)
        // ...
        // i=0: today = 19 (Wed)

        // Let's populate one for each day
        // activityChart reads the per-day activity totals
        seedUserDay(d1, { chatId, userId: 1, day: '2025-11-19', messages: 1 }); // Wed
        seedUserDay(d1, { chatId, userId: 1, day: '2025-11-18', messages: 1 }); // Tue
        seedUserDay(d1, { chatId, userId: 1, day: '2025-11-17', messages: 1 }); // Mon
        seedUserDay(d1, { chatId, userId: 1, day: '2025-11-16', messages: 1 }); // Sun
        seedUserDay(d1, { chatId, userId: 1, day: '2025-11-15', messages: 1 }); // Sat
        seedUserDay(d1, { chatId, userId: 1, day: '2025-11-14', messages: 1 }); // Fri
        seedUserDay(d1, { chatId, userId: 1, day: '2025-11-13', messages: 1 }); // Thu

        await activityChart(env, chatId, 'week');

        expect(mocks.sendMessage).toHaveBeenCalled();
        const text = mocks.sendMessage.mock.calls[0][2];
        console.log('Week Chart Text:\n', text);

        // Verify labels match the days of week
        // 13 (Thu) -> Th
        // 14 (Fri) -> Fr
        // 15 (Sat) -> Sa
        // 16 (Sun) -> Su
        // 17 (Mon) -> Mo
        // 18 (Tue) -> Tu
        // 19 (Wed) -> We

        // The order in code:
        // for i=6 down to 0.
        // push { label: labels[d.getUTCDay()] }
        // d.getUTCDay(): 0=Sun, 1=Mon...

        // i=6 (Thu): day 4. label 'Th'.
        // i=5 (Fri): day 5. label 'Fr'.
        // ...
        // i=0 (Wed): day 3. label 'We'.

        // Max value is 1, so scale is 10/1 = 10. Bar length is 10.
        const bar = '█'.repeat(10);
        expect(text).toContain(`Th |${bar} 1`);
        expect(text).toContain(`Fr |${bar} 1`);
        expect(text).toContain(`Sa |${bar} 1`);
        expect(text).toContain(`Su |${bar} 1`);
        expect(text).toContain(`Mo |${bar} 1`);
        expect(text).toContain(`Tu |${bar} 1`);
        expect(text).toContain(`We |${bar} 1`);
    });
});
