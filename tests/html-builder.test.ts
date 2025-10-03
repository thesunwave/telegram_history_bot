import { describe, it, expect, vi, afterEach } from 'vitest';
import { HTMLBuilder, ViolationMessageData, StatsMessageData } from '../src/html-builder';

describe('HTMLBuilder', () => {
  const testTimeout = 10000; // 10 seconds max per test

  let htmlBuilder: HTMLBuilder;

  beforeEach(() => {
    htmlBuilder = new HTMLBuilder();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('HTML escaping', () => {

    it('should escape HTML special characters', () => {
      expect(htmlBuilder.escapeHtml('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should escape ampersands', () => {
      expect(htmlBuilder.escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should handle empty strings', () => {
      expect(htmlBuilder.escapeHtml('')).toBe('');
    });

    it('should handle null/undefined input', () => {
      expect(htmlBuilder.escapeHtml(null as any)).toBe('');
      expect(htmlBuilder.escapeHtml(undefined as any)).toBe('');
    });
  });

  describe('HTML formatting methods', () => {

    it('should create bold text', () => {
      expect(htmlBuilder.bold('test')).toBe('<b>test</b>');
    });

    it('should create italic text', () => {
      expect(htmlBuilder.italic('test')).toBe('<i>test</i>');
    });

    it('should create underlined text', () => {
      expect(htmlBuilder.underline('test')).toBe('<u>test</u>');
    });

    it('should create strikethrough text', () => {
      expect(htmlBuilder.strikethrough('test')).toBe('<s>test</s>');
    });

    it('should create code text', () => {
      expect(htmlBuilder.code('test')).toBe('<code>test</code>');
    });

    it('should create preformatted text', () => {
      expect(htmlBuilder.preformatted('test')).toBe('<pre>test</pre>');
    });

    it('should escape HTML in formatted text', () => {
      expect(htmlBuilder.bold('<script>')).toBe('<b>&lt;script&gt;</b>');
    });
  }); 
 describe('Severity emoji indicators', () => {

    it('should return green emoji for low severity (1-3)', () => {
      expect(htmlBuilder.getSeverityEmoji(1)).toBe('🟢');
      expect(htmlBuilder.getSeverityEmoji(2)).toBe('🟢');
      expect(htmlBuilder.getSeverityEmoji(3)).toBe('🟢');
    });

    it('should return yellow emoji for medium severity (4-6)', () => {
      expect(htmlBuilder.getSeverityEmoji(4)).toBe('🟡');
      expect(htmlBuilder.getSeverityEmoji(5)).toBe('🟡');
      expect(htmlBuilder.getSeverityEmoji(6)).toBe('🟡');
    });

    it('should return red emoji for high severity (7-10)', () => {
      expect(htmlBuilder.getSeverityEmoji(7)).toBe('🔴');
      expect(htmlBuilder.getSeverityEmoji(8)).toBe('🔴');
      expect(htmlBuilder.getSeverityEmoji(9)).toBe('🔴');
      expect(htmlBuilder.getSeverityEmoji(10)).toBe('🔴');
    });

    it('should throw error for invalid severity values', () => {
      expect(() => htmlBuilder.getSeverityEmoji(0)).toThrow('Severity must be between 1 and 10');
      expect(() => htmlBuilder.getSeverityEmoji(11)).toThrow('Severity must be between 1 and 10');
      expect(() => htmlBuilder.getSeverityEmoji(-1)).toThrow('Severity must be between 1 and 10');
    });
  });

  describe('Violation message building', () => {

    it('should build a complete violation message', () => {
      const data: ViolationMessageData = { article: '282 УК РФ', subarticle: null, articleTitle: "Test Article Title",
        quote: 'Пример нарушения',
        punishment: 'Штраф до 300 000 рублей',
        severity: 5,
        confidence: 0.85
      };

      const result = htmlBuilder.buildViolationMessage(data);
      
      expect(result).toContain('🟡 <b>Статья 282 УК РФ</b>');
      expect(result).toContain('<b>Цитата:</b>');
      expect(result).toContain('<i>&quot;Пример нарушения&quot;</i>');
      expect(result).toContain('<b>Наказание:</b>');
      expect(result).toContain('Штраф до 300 000 рублей');
      expect(result).toContain('<b>Серьезность:</b> 5/10');
      expect(result).toContain('<b>Уровень доверия:</b> 85%');
    });

    it('should add confidence warning for low confidence', () => {
      const data: ViolationMessageData = { article: '282 УК РФ', subarticle: null, articleTitle: "Test Article Title",
        quote: 'Пример нарушения',
        punishment: 'Штраф до 300 000 рублей',
        severity: 5,
        confidence: 0.65
      };

      const result = htmlBuilder.buildViolationMessage(data);
      expect(result).toContain('⚠️ <i>Низкий уровень доверия к анализу</i>');
    });

    it('should not add confidence warning for high confidence', () => {
      const data: ViolationMessageData = { article: '282 УК РФ', subarticle: null, articleTitle: "Test Article Title",
        quote: 'Пример нарушения',
        punishment: 'Штраф до 300 000 рублей',
        severity: 5,
        confidence: 0.85
      };

      const result = htmlBuilder.buildViolationMessage(data);
      expect(result).not.toContain('⚠️');
    });
  });

  describe('Statistics message building', () => {

    it('should build a basic stats message', () => {
      const data: StatsMessageData = {
        title: 'Статистика пользователя',
        items: [
          { label: 'Всего нарушений', value: 5 },
          { label: 'Средняя серьезность', value: '6.2' }
        ]
      };

      const result = htmlBuilder.buildStatsMessage(data);
      
      expect(result).toContain('<b>Статистика пользователя</b>');
      expect(result).toContain('<b>Всего нарушений</b>: 5');
      expect(result).toContain('<b>Средняя серьезность</b>: 6.2');
    });

    it('should include severity emojis when provided', () => {
      const data: StatsMessageData = {
        title: 'Топ нарушений',
        items: [
          { label: 'Статья 282', value: 3, severity: 8 },
          { label: 'Статья 280', value: 2, severity: 4 }
        ]
      };

      const result = htmlBuilder.buildStatsMessage(data);
      
      expect(result).toContain('🔴 <b>Статья 282</b>: 3');
      expect(result).toContain('🟡 <b>Статья 280</b>: 2');
    });

    it('should include footer when provided', () => {
      const data: StatsMessageData = {
        title: 'Статистика',
        items: [
          { label: 'Всего', value: 10 }
        ],
        footer: 'Данные за последние 30 дней'
      };

      const result = htmlBuilder.buildStatsMessage(data);
      expect(result).toContain('Данные за последние 30 дней');
    });

    it('should handle empty items array', () => {
      const data: StatsMessageData = {
        title: 'Пустая статистика',
        items: []
      };

      const result = htmlBuilder.buildStatsMessage(data);
      expect(result).toBe('<b>Пустая статистика</b>\n');
    });
  });
});