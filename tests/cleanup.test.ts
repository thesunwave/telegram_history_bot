
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanupOldData } from '../src/features/stats/stats';
import { createMockEnv } from './test-utils';

describe('cleanupOldData', () => {
    let env: any;

    beforeEach(() => {
        env = createMockEnv();
        // Default mocks are already set up by createMockEnv, but we need specific returns
    });

    it('should cleanup summaries, violations, and cache in D1', async () => {
        // Setup D1 mocks for delete queries
        const runMock = vi.fn().mockResolvedValue({ meta: { changes: 5 } });
        const bindMock = vi.fn().mockReturnValue({ run: runMock, all: vi.fn(), first: vi.fn() });
        env.DB.prepare = vi.fn().mockReturnValue({ bind: bindMock, run: runMock });

        const result = await cleanupOldData(env, 7, 30);

        expect(env.DB.prepare).toHaveBeenCalledWith('DELETE FROM summaries WHERE period_end < ?');
        expect(env.DB.prepare).toHaveBeenCalledWith("DELETE FROM criminal_violations WHERE created_at < datetime('now', '-' || ? || ' days')");
        expect(env.DB.prepare).toHaveBeenCalledWith("DELETE FROM criminal_analysis_cache WHERE expires_at < datetime('now')");

        expect(result.deletedSummaries).toBe(5);
        expect(result.deletedViolations).toBe(5);
    });

    it('should not clean summaries if DB is missing', async () => {
        env.DB = undefined;
        const result = await cleanupOldData(env);
        expect(result.deletedSummaries).toBe(0);
    });

    it('should cleanup Durable Objects based on activity table', async () => {
        // Mock DB response for activity
        const activityRows = [
            { chat_id: 123, day: '2023-01-01' },
            { chat_id: 456, day: '2023-01-02' }
        ];

        const runMock = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
        const allMock = vi.fn().mockResolvedValue({ results: activityRows });
        const bindMock = vi.fn().mockReturnValue({ run: runMock, all: allMock });

        env.DB.prepare = vi.fn().mockReturnValue({ bind: bindMock, run: runMock });

        // Mock DO fetch
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ deleted: 1 }))));
        const stubMock = { fetch: fetchMock };
        const idMock = {};

        env.DAY_BLOCK_MANAGER_DO.idFromName = vi.fn().mockReturnValue(idMock);
        env.DAY_BLOCK_MANAGER_DO.get = vi.fn().mockReturnValue(stubMock);

        const result = await cleanupOldData(env, 7, 30);

        // Verify DB activity query
        expect(env.DB.prepare).toHaveBeenCalledWith('SELECT chat_id, day FROM activity WHERE day < ?');

        // Verify DO calls
        expect(env.DAY_BLOCK_MANAGER_DO.idFromName).toHaveBeenCalledWith('dayblock:123:2023-01-01');
        expect(env.DAY_BLOCK_MANAGER_DO.idFromName).toHaveBeenCalledWith('dayblock:456:2023-01-02');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.cleanedDOs).toBe(2);
    });

    it('should handle errors during cleanup gracefully', async () => {
        env.DB.prepare = vi.fn().mockImplementation(() => { throw new Error('DB error'); });

        // Should not throw
        const result = await cleanupOldData(env);
        expect(result.deletedSummaries).toBe(0);
    });
});
