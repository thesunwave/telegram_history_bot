/**
 * Tests for unified HTML utilities module
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  HTMLUtils,
  MessageTemplateBuilder,
  SeverityLevel,
  SEVERITY_EMOJIS,
  escapeHtml,
  bold,
  italic,
  getSeverityEmoji,
  getSeverityLevel,
  createSection,
  createListItem,
  formatArticleForDisplay,
  templateBuilder,
  type ViolationMessageData,
  type StatsMessageData,
  type MessageTemplate,
  type TemplateVariables
} from '../../src/utils/html-utils';

describe('HTMLUtils', () => {
  const testTimeout = 10000; // 10 seconds max per test

  describe('escapeHtml', () => {

    it('should escape HTML special characters', () => {
      expect(HTMLUtils.escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;'
      );
      expect(HTMLUtils.escapeHtml('Test & "quotes" & \'apostrophes\'')).toBe(
        'Test &amp; &quot;quotes&quot; &amp; &#x27;apostrophes&#x27;'
      );
    });

    it('should handle empty and null values', () => {
      expect(HTMLUtils.escapeHtml('')).toBe('');
      expect(HTMLUtils.escapeHtml(null as any)).toBe('');
      expect(HTMLUtils.escapeHtml(undefined as any)).toBe('');
    });
  });

  describe('HTML formatting methods', () => {

    it('should wrap text in bold tags', () => {
      expect(HTMLUtils.bold('test')).toBe('<b>test</b>');
      expect(HTMLUtils.bold('<script>')).toBe('<b>&lt;script&gt;</b>');
    });

    it('should wrap text in italic tags', () => {
      expect(HTMLUtils.italic('test')).toBe('<i>test</i>');
      expect(HTMLUtils.italic('<script>')).toBe('<i>&lt;script&gt;</i>');
    });

    it('should wrap text in underline tags', () => {
      expect(HTMLUtils.underline('test')).toBe('<u>test</u>');
    });

    it('should wrap text in strikethrough tags', () => {
      expect(HTMLUtils.strikethrough('test')).toBe('<s>test</s>');
    });

    it('should wrap text in code tags', () => {
      expect(HTMLUtils.code('test')).toBe('<code>test</code>');
    });

    it('should wrap text in preformatted tags', () => {
      expect(HTMLUtils.preformatted('test')).toBe('<pre>test</pre>');
    });
  });

  describe('getSeverityLevel', () => {

    it('should return correct severity levels', () => {
      expect(HTMLUtils.getSeverityLevel(1)).toBe(SeverityLevel.LOW);
      expect(HTMLUtils.getSeverityLevel(3)).toBe(SeverityLevel.LOW);
      expect(HTMLUtils.getSeverityLevel(4)).toBe(SeverityLevel.MEDIUM);
      expect(HTMLUtils.getSeverityLevel(6)).toBe(SeverityLevel.MEDIUM);
      expect(HTMLUtils.getSeverityLevel(7)).toBe(SeverityLevel.HIGH);
      expect(HTMLUtils.getSeverityLevel(10)).toBe(SeverityLevel.HIGH);
    });

    it('should handle invalid severity values gracefully', () => {
      expect(HTMLUtils.getSeverityLevel(0)).toBe(SeverityLevel.LOW); // Clamped to 1
      expect(HTMLUtils.getSeverityLevel(11)).toBe(SeverityLevel.HIGH); // Clamped to 10
      expect(HTMLUtils.getSeverityLevel(NaN)).toBe(SeverityLevel.LOW); // Default to low
    });
  });

  describe('getSeverityEmoji', () => {

    it('should return correct emojis for severity levels', () => {
      expect(HTMLUtils.getSeverityEmoji(1)).toBe('🟢');
      expect(HTMLUtils.getSeverityEmoji(3)).toBe('🟢');
      expect(HTMLUtils.getSeverityEmoji(4)).toBe('🟡');
      expect(HTMLUtils.getSeverityEmoji(6)).toBe('🟡');
      expect(HTMLUtils.getSeverityEmoji(7)).toBe('🔴');
      expect(HTMLUtils.getSeverityEmoji(10)).toBe('🔴');
    });
  });

  describe('createSection', () => {

    it('should create formatted section with title and content', () => {
      const result = HTMLUtils.createSection('Title', 'Content');
      expect(result).toBe('<b>Title</b>\nContent');
    });

    it('should escape HTML in title', () => {
      const result = HTMLUtils.createSection('<script>', 'Content');
      expect(result).toBe('<b>&lt;script&gt;</b>\nContent');
    });
  });

  describe('createListItem', () => {

    it('should create formatted list item', () => {
      const result = HTMLUtils.createListItem('Label', 'Value');
      expect(result).toBe('<b>Label</b>: Value');
    });

    it('should include emoji when provided', () => {
      const result = HTMLUtils.createListItem('Label', 'Value', '🟢');
      expect(result).toBe('🟢 <b>Label</b>: Value');
    });

    it('should handle numeric values', () => {
      const result = HTMLUtils.createListItem('Count', 42);
      expect(result).toBe('<b>Count</b>: 42');
    });

    it('should escape HTML in label and value', () => {
      const result = HTMLUtils.createListItem('<script>', '<alert>');
      expect(result).toBe('<b>&lt;script&gt;</b>: &lt;alert&gt;');
    });
  });

  describe('formatArticleForDisplay', () => {

    it('should format article correctly', () => {
      expect(HTMLUtils.formatArticleForDisplay('280')).toBe('Статья 280 УК РФ');
      expect(HTMLUtils.formatArticleForDisplay('Статья 280')).toBe('Статья 280 УК РФ');
      expect(HTMLUtils.formatArticleForDisplay('280 УК РФ')).toBe('Статья 280 УК РФ');
      expect(HTMLUtils.formatArticleForDisplay('Статья 280 УК РФ')).toBe('Статья 280 УК РФ');
    });

    it('should handle edge cases', () => {
      expect(HTMLUtils.formatArticleForDisplay('')).toBe('Неизвестная статья');
      expect(HTMLUtils.formatArticleForDisplay(null as any)).toBe('Неизвестная статья');
      expect(HTMLUtils.formatArticleForDisplay('   ')).toBe('Неизвестная статья');
      expect(HTMLUtils.formatArticleForDisplay('Неизвестная статья')).toBe('Неизвестная статья');
    });

    it('should handle case insensitive matching', () => {
      expect(HTMLUtils.formatArticleForDisplay('статья 280')).toBe('Статья 280 УК РФ');
      expect(HTMLUtils.formatArticleForDisplay('280 ук рф')).toBe('Статья 280 УК РФ');
      expect(HTMLUtils.formatArticleForDisplay('СТАТЬЯ 280 УК РФ')).toBe('Статья 280 УК РФ');
    });
  });
});

describe('MessageTemplateBuilder', () => {

  beforeEach(() => {
    // Clear templates before each test
    MessageTemplateBuilder['templates'].clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  describe('template registration and retrieval', () => {

    it('should register and retrieve templates', () => {
      const template: MessageTemplate = {
        id: 'test',
        name: 'Test Template',
        template: 'Hello {{name}}!',
        variables: ['name'],
        description: 'Test template'
      };

      MessageTemplateBuilder.registerTemplate(template);
      const retrieved = MessageTemplateBuilder.getTemplate('test');
      
      expect(retrieved).toEqual(template);
    });

    it('should return undefined for non-existent template', () => {
      const retrieved = MessageTemplateBuilder.getTemplate('nonexistent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('template rendering', () => {

    beforeEach(() => {
      MessageTemplateBuilder.registerTemplate({
        id: 'greeting',
        name: 'Greeting',
        template: 'Hello {{name}}, you have {{count}} messages!',
        variables: ['name', 'count'],
        description: 'Greeting template'
      });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });
    });

    it('should render template with variables', () => {
      const result = MessageTemplateBuilder.renderTemplate('greeting', {
        name: 'John',
        count: 5
      });
      
      expect(result).toBe('Hello John, you have 5 messages!');
    });

    it('should escape HTML in variables', () => {
      const result = MessageTemplateBuilder.renderTemplate('greeting', {
        name: '<script>alert("xss")</script>',
        count: 1
      });
      
      expect(result).toBe('Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;, you have 1 messages!');
    });

    it('should handle missing variables gracefully', () => {
      const result = MessageTemplateBuilder.renderTemplate('greeting', {
        name: 'John'
        // count is missing
      });
      
      expect(result).toBe('Hello John, you have {{count}} messages!');
    });

    it('should throw error for non-existent template', () => {
      expect(() => {
        MessageTemplateBuilder.renderTemplate('nonexistent', {});
      }).toThrow('Template not found: nonexistent');
    });
  });

  describe('buildViolationMessage', () => {

    it('should build violation message correctly', () => {
      const data: ViolationMessageData = { article: '280', subarticle: null, articleTitle: "Test Article Title",
        quote: 'Test quote',
        punishment: 'Test punishment',
        severity: 7,
        confidence: 0.85
      };

      const result = MessageTemplateBuilder.buildViolationMessage(data);
      
      expect(result).toContain('🔴 <b>Статья 280 УК РФ</b>');
      expect(result).toContain('<b>Цитата:</b>');
      expect(result).toContain('<i>&quot;Test quote&quot;</i>');
      expect(result).toContain('<b>Наказание:</b>');
      expect(result).toContain('Test punishment');
      expect(result).toContain('<b>Серьезность:</b> 7/10');
      expect(result).toContain('<b>Уровень доверия:</b> 85%');
    });

    it('should include confidence warning for low confidence', () => {
      const data: ViolationMessageData = { article: '280', subarticle: null, articleTitle: "Test Article Title",
        quote: 'Test quote',
        punishment: 'Test punishment',
        severity: 5,
        confidence: 0.6
      };

      const result = MessageTemplateBuilder.buildViolationMessage(data);
      
      expect(result).toContain('⚠️ <i>Низкий уровень доверия к анализу</i>');
    });

    it('should not include confidence warning for high confidence', () => {
      const data: ViolationMessageData = { article: '280', subarticle: null, articleTitle: "Test Article Title",
        quote: 'Test quote',
        punishment: 'Test punishment',
        severity: 5,
        confidence: 0.8
      };

      const result = MessageTemplateBuilder.buildViolationMessage(data);
      
      expect(result).not.toContain('⚠️');
    });
  });

  describe('buildStatsMessage', () => {

    it('should build stats message correctly', () => {
      const data: StatsMessageData = {
        title: 'Test Statistics',
        items: [
          { label: 'Total', value: 10 },
          { label: 'High Severity', value: 3, severity: 8 }
        ],
        footer: 'Test footer'
      };

      const result = MessageTemplateBuilder.buildStatsMessage(data);
      
      expect(result).toContain('<b>Test Statistics</b>');
      expect(result).toContain('<b>Total</b>: 10');
      expect(result).toContain('🔴 <b>High Severity</b>: 3');
      expect(result).toContain('Test footer');
    });

    it('should handle items without severity', () => {
      const data: StatsMessageData = {
        title: 'Test Statistics',
        items: [
          { label: 'Total', value: 10 }
        ]
      };

      const result = MessageTemplateBuilder.buildStatsMessage(data);
      
      expect(result).toContain('<b>Total</b>: 10');
      expect(result).not.toContain('🟢');
      expect(result).not.toContain('🟡');
      expect(result).not.toContain('🔴');
    });

    it('should handle message without footer', () => {
      const data: StatsMessageData = {
        title: 'Test Statistics',
        items: [
          { label: 'Total', value: 10 }
        ]
      };

      const result = MessageTemplateBuilder.buildStatsMessage(data);
      
      expect(result).toBe('<b>Test Statistics</b>\n\n<b>Total</b>: 10');
    });
  });
});

describe('convenience exports', () => {

  it('should export convenience functions', () => {
    expect(escapeHtml).toBe(HTMLUtils.escapeHtml);
    expect(bold).toBe(HTMLUtils.bold);
    expect(italic).toBe(HTMLUtils.italic);
    expect(getSeverityEmoji).toBe(HTMLUtils.getSeverityEmoji);
    expect(getSeverityLevel).toBe(HTMLUtils.getSeverityLevel);
    expect(createSection).toBe(HTMLUtils.createSection);
    expect(createListItem).toBe(HTMLUtils.createListItem);
    expect(formatArticleForDisplay).toBe(HTMLUtils.formatArticleForDisplay);
  });

  it('should export template builder', () => {
    expect(templateBuilder).toBe(MessageTemplateBuilder);
  });
});

describe('SEVERITY_EMOJIS constant', () => {

  it('should have correct emoji mappings', () => {
    expect(SEVERITY_EMOJIS[SeverityLevel.LOW]).toBe('🟢');
    expect(SEVERITY_EMOJIS[SeverityLevel.MEDIUM]).toBe('🟡');
    expect(SEVERITY_EMOJIS[SeverityLevel.HIGH]).toBe('🔴');
  });
});