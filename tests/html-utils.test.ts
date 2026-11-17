import { describe, it, expect } from 'vitest';
import { 
  SeverityLevel, 
  SEVERITY_EMOJIS, 
  getSeverityLevel, 
  getSeverityEmoji, 
  escapeHtml 
} from '../src/core/html-utils';

describe('HTML Utils', () => {
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

    it('should throw error for invalid severity', () => {
      expect(() => getSeverityLevel(0)).toThrow('Severity must be between 1 and 10');
      expect(() => getSeverityLevel(11)).toThrow('Severity must be between 1 and 10');
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
        .toBe('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;');
    });

    it('should handle empty strings', () => {
      expect(escapeHtml('')).toBe('');
    });
  });
});
