/**
 * Model Policy Unit Tests
 * ADR-001: Tests for logical model role mappings
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    ModelPolicy,
    resetModelPolicy,
    getModelPolicy,
    ModelRole,
} from '../../src/core/llm';

describe('ModelPolicy', () => {
    beforeEach(() => {
        resetModelPolicy();
    });

    describe('getModel', () => {
        it('should return default nano model', () => {
            const policy = new ModelPolicy();
            expect(policy.getModel('nano')).toBe('gpt-4.1-nano');
        });

        it('should return default mini model', () => {
            const policy = new ModelPolicy();
            expect(policy.getModel('mini')).toBe('gpt-4.1-mini');
        });

        it('should return default heavy model', () => {
            const policy = new ModelPolicy();
            expect(policy.getModel('heavy')).toBe('gpt-4.1');
        });

        it('should use env override for nano model', () => {
            const policy = new ModelPolicy({
                LLM_NANO_MODEL: 'gpt-5-nano',
            });
            expect(policy.getModel('nano')).toBe('gpt-5-nano');
        });

        it('should use env override for mini model', () => {
            const policy = new ModelPolicy({
                LLM_MINI_MODEL: 'gpt-5-mini',
            });
            expect(policy.getModel('mini')).toBe('gpt-5-mini');
        });

        it('should trim whitespace from env values', () => {
            const policy = new ModelPolicy({
                LLM_NANO_MODEL: '  gpt-5-nano  ',
            });
            expect(policy.getModel('nano')).toBe('gpt-5-nano');
        });

        it('should ignore empty env values', () => {
            const policy = new ModelPolicy({
                LLM_NANO_MODEL: '',
            });
            expect(policy.getModel('nano')).toBe('gpt-4.1-nano');
        });
    });

    describe('getRoleForModel', () => {
        it('should detect nano role from exact mapping', () => {
            const policy = new ModelPolicy();
            expect(policy.getRoleForModel('gpt-4.1-nano')).toBe('nano');
        });

        it('should detect mini role from exact mapping', () => {
            const policy = new ModelPolicy();
            expect(policy.getRoleForModel('gpt-4.1-mini')).toBe('mini');
        });

        it('should detect nano role from pattern', () => {
            const policy = new ModelPolicy();
            expect(policy.getRoleForModel('gpt-5-nano')).toBe('nano');
            expect(policy.getRoleForModel('some-model-nano-v2')).toBe('nano');
        });

        it('should detect mini role from pattern', () => {
            const policy = new ModelPolicy();
            expect(policy.getRoleForModel('gpt-5-mini')).toBe('mini');
        });

        it('should detect heavy role for turbo models', () => {
            const policy = new ModelPolicy();
            expect(policy.getRoleForModel('gpt-4-turbo')).toBe('heavy');
        });

        it('should return null for unknown models', () => {
            const policy = new ModelPolicy();
            expect(policy.getRoleForModel('claude-3')).toBeNull();
            expect(policy.getRoleForModel('llama-70b')).toBeNull();
        });

        it('should be case-insensitive', () => {
            const policy = new ModelPolicy();
            expect(policy.getRoleForModel('GPT-4.1-NANO')).toBe('nano');
            expect(policy.getRoleForModel('GPT-4.1-Mini')).toBe('mini');
        });
    });

    describe('getMappings', () => {
        it('should return all current mappings', () => {
            const policy = new ModelPolicy();
            const mappings = policy.getMappings();

            expect(mappings.nano).toBe('gpt-4.1-nano');
            expect(mappings.mini).toBe('gpt-4.1-mini');
            expect(mappings.heavy).toBe('gpt-4.1');
        });

        it('should reflect env overrides', () => {
            const policy = new ModelPolicy({
                LLM_NANO_MODEL: 'custom-nano',
                LLM_MINI_MODEL: 'custom-mini',
            });
            const mappings = policy.getMappings();

            expect(mappings.nano).toBe('custom-nano');
            expect(mappings.mini).toBe('custom-mini');
        });
    });

    describe('getModelPolicy (singleton)', () => {
        it('should return same instance on multiple calls', () => {
            const policy1 = getModelPolicy();
            const policy2 = getModelPolicy();

            expect(policy1).toBe(policy2);
        });

        it('should reset on resetModelPolicy', () => {
            const policy1 = getModelPolicy();
            resetModelPolicy();
            const policy2 = getModelPolicy();

            expect(policy1).not.toBe(policy2);
        });
    });
});
