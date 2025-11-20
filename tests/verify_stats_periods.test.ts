
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { activityByUser, activityChart } from '../src/stats';
import { Env } from '../src/env';

// Mock KVNamespace
const createMockKV = (data: Map<string, string>) => ({
    get: vi.fn(async (key: string) => data.get(key) || null),
    put: vi.fn(async (key: string, value: string) => data.set(key, value)),
    delete: vi.fn(async (key: string) => data.delete(key)),
    list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
        const prefix = options?.prefix || '';
        const keys = Array.from(data.keys())
            .filter(k => k.startsWith(prefix))
            .sort();

        return {
            keys: keys.map(name => ({ name })),
            list_complete: true,
        };
    }),
});

const mocks = vi.hoisted(() => ({
    sendMessage: vi.fn(),
    sendPhoto: vi.fn(),
}));

vi.mock('../src/telegram', () => ({
    sendMessage: mocks.sendMessage,
    sendPhoto: mocks.sendPhoto,
}));

describe('Stats Period Verification', () => {
    let env: Env;
    let kvData: Map<string, string>;

    beforeEach(() => {
        kvData = new Map();
        mocks.sendMessage.mockClear();
        mocks.sendPhoto.mockClear();

        env = {
            COUNTERS: createMockKV(kvData) as any,
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
        kvData.set(`stats_v2:${chatId}:2025-11-19:${userId}`, '10');
        // Add data for 6 days ago (2025-11-13) - Should be INCLUDED
        kvData.set(`stats_v2:${chatId}:2025-11-13:${userId}`, '5');
        // Add data for 7 days ago (2025-11-12) - Should be EXCLUDED (if logic is strictly 7 days including today)
        // Wait, WEEK_DAYS = 6. start = today - 6.
        // 19 - 6 = 13. Range [13, 19]. 13, 14, 15, 16, 17, 18, 19 = 7 days.
        // So 12th should be excluded.
        kvData.set(`stats_v2:${chatId}:2025-11-12:${userId}`, '100');

        kvData.set(`user:${userId}`, username);

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

    it('should correctly aggregate activityByUser for the last month (4 weeks / 28 days)', async () => {
        const chatId = 123;
        const userId = 456;
        const username = 'testuser';

        // Today: 2025-11-19
        // Month range: MONTH_DAYS = 27. Start = 19 - 27 = Oct 23 (approx).
        // Let's calculate exactly.
        // Nov 19. Nov has 30 days? No, 30 days hath September... November.
        // 19 days in Nov. Need 8 more days back in Oct.
        // Oct has 31 days. 31 - 8 + 1 = 24?
        // 19 (Nov) + 8 (Oct) = 27 days back.
        // 19, 18... 1 (19 days). 31, 30, 29, 28, 27, 26, 25, 24 (8 days).
        // So start date is Oct 23rd?
        // Let's verify with Date object logic in test.
        const today = new Date('2025-11-19T00:00:00Z');
        const start = new Date(today);
        start.setUTCDate(today.getUTCDate() - 27);
        const startStr = start.toISOString().slice(0, 10);
        console.log('Month Start Date:', startStr); // Should be 2025-10-23

        // Add data inside range
        kvData.set(`stats_v2:${chatId}:2025-11-19:${userId}`, '10');
        kvData.set(`stats_v2:${chatId}:${startStr}:${userId}`, '5'); // Boundary check (inclusive)

        // Add data outside range (one day before start)
        const beforeStart = new Date(start);
        beforeStart.setUTCDate(start.getUTCDate() - 1);
        const beforeStartStr = beforeStart.toISOString().slice(0, 10);
        kvData.set(`stats_v2:${chatId}:${beforeStartStr}:${userId}`, '100');

        kvData.set(`user:${userId}`, username);

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
        // activityChart uses 'activity' prefix, not 'stats_v2'
        kvData.set(`activity:${chatId}:2025-11-19`, '1'); // Wed
        kvData.set(`activity:${chatId}:2025-11-18`, '1'); // Tue
        kvData.set(`activity:${chatId}:2025-11-17`, '1'); // Mon
        kvData.set(`activity:${chatId}:2025-11-16`, '1'); // Sun
        kvData.set(`activity:${chatId}:2025-11-15`, '1'); // Sat
        kvData.set(`activity:${chatId}:2025-11-14`, '1'); // Fri
        kvData.set(`activity:${chatId}:2025-11-13`, '1'); // Thu

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

