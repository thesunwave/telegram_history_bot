import { describe, it, expect } from 'vitest';
import { 
  SeverityLevel, 
  SEVERITY_EMOJIS, 
  getSeverityLevel, 
  getSeverityEmoji, 
  escapeHtml, 
  createSection, 
  createListItem 
} from '../src/utils/html-utils';

describe('HTML Utils', () => {
  const testTimeout = 10000; // 10 seconds max per test

  describe('getSeverityLevel', () => {

    it('should return LOW for severity 1-3', () => {
      expect(getSeverityLevel(1)).toBe(SeverityLevel.LOW);
      expect(getSeverityLevel(2)).toBe(SeverityLevel.LOW);
      expect(getSeverityLevel(3)).toBe(SeverityLevel.LOW);
    });

    it('should return MEDIUM for severity 4-6', () => {
      expect(getSeverityLevel(4)).toBe(SeverityLevel.MEDIUM);
      expect(getSeverityLevel(5)).toBe(SeverityLevel.MEDIUM);
      expect(getSeverityLevel(6)).toBe(SeverityLevel.MEDIUM);
    });

    it('should return HIGH for severity 7-10', () => {
      expect(getSeverityLevel(7)).toBe(SeverityLevel.HIGH);
      expect(getSeverityLevel(8)).toBe(SeverityLevel.HIGH);
      expect(getSeverityLevel(9)).toBe(SeverityLevel.HIGH);
      expect(getSeverityLevel(10)).toBe(SeverityLevel.HIGH);
    });

    it('should handle invalid severity gracefully', () => {
      expect(getSeverityLevel(0)).toBe('low');
      expect(getSeverityLevel(11)).toBe('high'); // Clamped to 10
      expect(getSeverityLevel(-1)).toBe('low'); // Clamped to 1
    });
  });

  describe('getSeverityEmoji', () => {

    it('should return correct emojis for different severities', () => {
      expect(getSeverityEmoji(1)).toBe('🟢');
      expect(getSeverityEmoji(5)).toBe('🟡');
      expect(getSeverityEmoji(8)).toBe('🔴');
    });
  });

  describe('escapeHtml', () => {

    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("test")</script>'))
        .toBe('&lt;script&gt;alert(&quot;test&quot;)&lt;&#x2F;script&gt;');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('createSection', () => {

    it('should create formatted section', () => {
      const result = createSection('Title', 'Content here');
      expect(result).toBe('<b>Title</b>\nContent here');
    });

    it('should escape HTML in title', () => {
      const result = createSection('<script>', 'Content');
      expect(result).toBe('<b>&lt;script&gt;</b>\nContent');
    });
  });

  describe('createListItem', () => {

    it('should create basic list item', () => {
      const result = createListItem('Label', 'Value');
      expect(result).toBe('<b>Label</b>: Value');
    });

    it('should include emoji when provided', () => {
      const result = createListItem('Label', 'Value', '🔴');
      expect(result).toBe('🔴 <b>Label</b>: Value');
    });

    it('should handle numeric values', () => {
      const result = createListItem('Count', 42);
      expect(result).toBe('<b>Count</b>: 42');
    });

    it('should escape HTML in label and value', () => {
      const result = createListItem('<script>', '<alert>');
      expect(result).toBe('<b>&lt;script&gt;</b>: &lt;alert&gt;');
    });
  });
});