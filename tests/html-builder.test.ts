import { describe, it, expect } from 'vitest';
import { HTMLBuilder } from '../src/core/html-builder';

describe('HTMLBuilder', () => {
  let htmlBuilder: HTMLBuilder;

  beforeEach(() => {
    htmlBuilder = new HTMLBuilder();
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
});