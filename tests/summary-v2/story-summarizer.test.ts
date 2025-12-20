/**
 * Story Summarizer Tests
 */

import { describe, it, expect } from 'vitest';
import { getStorySystemPrompt } from '../../src/summary-v2/story-summarizer';
import { Env } from '../../src/env';

describe('Story Summarizer', () => {
    describe('getStorySystemPrompt', () => {
        it('should return default prompt when env var is not set', () => {
            const mockEnv = {} as Env;
            const prompt = getStorySystemPrompt(mockEnv);
            expect(prompt).toContain('Создай интересную сводку чата');
            expect(prompt).toContain('СТИЛЬ:');
        });

        it('should return custom prompt when SUMMARY_SYSTEM is set', () => {
            const mockEnv = {
                SUMMARY_SYSTEM: 'Ты злобный комик. Сделай прожарку чата.'
            } as any;
            const prompt = getStorySystemPrompt(mockEnv);
            expect(prompt).toBe('Ты злобный комик. Сделай прожарку чата.');
        });

        it('should prefer env var even if empty string (though unlikely use case)', () => {
            // Technically if user sets it to empty string, it might fallback depending on implementation || vs ??
            // Our implementation uses || so empty string falls back.
            // Let's verify that behavior.
            const mockEnv = {
                SUMMARY_SYSTEM: ''
            } as any;
            const prompt = getStorySystemPrompt(mockEnv);
            expect(prompt).toContain('Создай интересную сводку чата');
        });
    });
});
