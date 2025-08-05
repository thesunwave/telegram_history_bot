import { describe, it, expect } from 'vitest';
import { getProfanityPrompts } from '../src/providers/ai-provider';

describe('Profanity Prompts Configuration', () => {
  it('should use default prompts when env is not provided', () => {
    const { systemPrompt, userPrompt } = getProfanityPrompts();
    
    expect(systemPrompt).toContain('Ты эксперт по анализу русского языка');
    expect(systemPrompt).toContain('ФОРМАТ ОТВЕТА');
    expect(userPrompt).toContain('Проанализируй следующий текст на наличие матерной лексики');
  });

  it('should use default prompts when env is empty', () => {
    const { systemPrompt, userPrompt } = getProfanityPrompts({});
    
    expect(systemPrompt).toContain('Ты эксперт по анализу русского языка');
    expect(userPrompt).toContain('Проанализируй следующий текст на наличие матерной лексики');
  });

  it('should use custom prompts from env when provided', () => {
    const env = {
      PROFANITY_SYSTEM_PROMPT: 'Custom system prompt for profanity analysis',
      PROFANITY_USER_PROMPT: 'Custom user prompt for analysis'
    };
    
    const { systemPrompt, userPrompt } = getProfanityPrompts(env);
    
    expect(systemPrompt).toBe('Custom system prompt for profanity analysis');
    expect(userPrompt).toBe('Custom user prompt for analysis');
  });

  it('should use default system prompt when only user prompt is provided', () => {
    const env = {
      PROFANITY_USER_PROMPT: 'Custom user prompt only'
    };
    
    const { systemPrompt, userPrompt } = getProfanityPrompts(env);
    
    expect(systemPrompt).toContain('Ты эксперт по анализу русского языка');
    expect(userPrompt).toBe('Custom user prompt only');
  });

  it('should use default user prompt when only system prompt is provided', () => {
    const env = {
      PROFANITY_SYSTEM_PROMPT: 'Custom system prompt only'
    };
    
    const { systemPrompt, userPrompt } = getProfanityPrompts(env);
    
    expect(systemPrompt).toBe('Custom system prompt only');
    expect(userPrompt).toContain('Проанализируй следующий текст на наличие матерной лексики');
  });
});