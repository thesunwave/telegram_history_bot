/**
 * Tests for shared utility functions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DateUtils,
  TextUtils,
  NumberUtils,
  StringUtils,
  formatDate,
  formatDateRange,
  getRelativeTime,
  truncateText,
  chunkText,
  normalizeQuotes,
  formatNumber,
  formatPercentage,
  sanitizeString,
  normalizeString,
  hashText,
  type DateFormatOptions,
  type TextProcessingOptions,
  type NumberFormatOptions
} from '../../src/utils/shared-utils';

describe('DateUtils', () => {
  const testTimeout = 10000; // 10 seconds max per test

  const testDate = new Date('2023-06-15T14:30:00Z');
  
  describe('formatDate', () => {

    it('should format date with default options', () => {
      const result = DateUtils.formatDate(testDate);
      expect(result).toMatch(/15|июн|2023/); // Should contain day, month, year
    });

    it('should format date with time', () => {
      const result = DateUtils.formatDate(testDate, { includeTime: true });
      expect(result).toMatch(/\d{2}:\d{2}/); // Should contain time
    });

    it('should handle invalid dates', () => {
      const result = DateUtils.formatDate(new Date('invalid'));
      expect(result).toBe('Неверная дата');
    });

    it('should format with different locales', () => {
      const result = DateUtils.formatDate(testDate, { locale: 'en-US' });
      expect(result).toMatch(/Jun|15|2023/);
    });
  });

  describe('formatDateRange', () => {

    it('should format date range', () => {
      const start = new Date('2023-06-01');
      const end = new Date('2023-06-30');
      const result = DateUtils.formatDateRange(start, end);
      expect(result).toContain('—');
      expect(result).toMatch(/01|июн|30/);
    });

    it('should handle invalid date range', () => {
      const result = DateUtils.formatDateRange(new Date('invalid'), new Date('invalid'));
      expect(result).toBe('Неверный период');
    });
  });

  describe('getRelativeTime', () => {

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2023-06-15T15:00:00Z'));
    });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return "только что" for recent times', () => {
      const recent = new Date('2023-06-15T14:59:30Z');
      expect(DateUtils.getRelativeTime(recent)).toBe('только что');
    });

    it('should return minutes for recent times', () => {
      const recent = new Date('2023-06-15T14:55:00Z');
      expect(DateUtils.getRelativeTime(recent)).toBe('5 мин. назад');
    });

    it('should return hours for same day', () => {
      const recent = new Date('2023-06-15T13:00:00Z');
      expect(DateUtils.getRelativeTime(recent)).toBe('2 ч. назад');
    });

    it('should return days for recent dates', () => {
      const recent = new Date('2023-06-13T15:00:00Z');
      expect(DateUtils.getRelativeTime(recent)).toBe('2 дн. назад');
    });

    it('should return formatted date for old dates', () => {
      const old = new Date('2023-05-01T15:00:00Z');
      const result = DateUtils.getRelativeTime(old);
      expect(result).toMatch(/01|мая|23/);
    });
  });

  describe('dateDifference', () => {

    it('should calculate difference in days', () => {
      const start = new Date('2023-06-01');
      const end = new Date('2023-06-05');
      expect(DateUtils.dateDifference(start, end, 'days')).toBe(4);
    });

    it('should calculate difference in hours', () => {
      const start = new Date('2023-06-01T10:00:00');
      const end = new Date('2023-06-01T14:00:00');
      expect(DateUtils.dateDifference(start, end, 'hours')).toBe(4);
    });

    it('should handle invalid dates', () => {
      expect(DateUtils.dateDifference(new Date('invalid'), new Date())).toBe(0);
    });
  });

  describe('isDateInRange', () => {

    it('should check if date is in range', () => {
      const date = new Date('2023-06-15');
      const start = new Date('2023-06-01');
      const end = new Date('2023-06-30');
      expect(DateUtils.isDateInRange(date, start, end)).toBe(true);
    });

    it('should return false for date outside range', () => {
      const date = new Date('2023-07-15');
      const start = new Date('2023-06-01');
      const end = new Date('2023-06-30');
      expect(DateUtils.isDateInRange(date, start, end)).toBe(false);
    });
  });

  describe('getDayBounds', () => {

    it('should get start and end of day', () => {
      const date = new Date('2023-06-15T14:30:00');
      const bounds = DateUtils.getDayBounds(date);
      
      expect(bounds.start.getHours()).toBe(0);
      expect(bounds.start.getMinutes()).toBe(0);
      expect(bounds.end.getHours()).toBe(23);
      expect(bounds.end.getMinutes()).toBe(59);
    });
  });
});

describe('TextUtils', () => {

  describe('normalizeQuotes', () => {

    it('should normalize various quote types', () => {
      const text = '"Hello" \'world\' «test» „example"';
      const result = TextUtils.normalizeQuotes(text);
      expect(result).toBe('"Hello" \'world\' "test" "example"');
    });

    it('should handle empty text', () => {
      expect(TextUtils.normalizeQuotes('')).toBe('');
    });
  });

  describe('extractQuotes', () => {

    it('should extract quotes from text', () => {
      const text = 'He said "Hello world" and then "Goodbye"';
      const quotes = TextUtils.extractQuotes(text);
      expect(quotes).toEqual(['Hello world', 'Goodbye']);
    });

    it('should handle text without quotes', () => {
      const quotes = TextUtils.extractQuotes('No quotes here');
      expect(quotes).toEqual([]);
    });

    it('should handle empty quotes', () => {
      const quotes = TextUtils.extractQuotes('Empty "" quotes');
      expect(quotes).toEqual([]);
    });
  });

  describe('truncateText', () => {

    it('should truncate text to specified length', () => {
      const text = 'This is a very long text that should be truncated';
      const result = TextUtils.truncateText(text, { maxLength: 20 });
      expect(result.length).toBeLessThanOrEqual(20);
      expect(result).toContain('...');
    });

    it('should preserve words when requested', () => {
      const text = 'This is a test';
      const result = TextUtils.truncateText(text, { maxLength: 10, preserveWords: true });
      expect(result).toBe('This is...');
    });

    it('should not truncate short text', () => {
      const text = 'Short';
      const result = TextUtils.truncateText(text, { maxLength: 20 });
      expect(result).toBe('Short');
    });

    it('should remove extra spaces', () => {
      const text = 'Text   with    extra   spaces';
      const result = TextUtils.truncateText(text, { removeExtraSpaces: true });
      expect(result).toBe('Text with extra spaces');
    });
  });

  describe('chunkText', () => {

    it('should split text into chunks', () => {
      const text = 'Hello world';
      const chunks = TextUtils.chunkText(text, 5);
      expect(chunks).toEqual(['Hello', ' worl', 'd']);
    });

    it('should handle Unicode characters', () => {
      const text = '🌟🌟🌟🌟';
      const chunks = TextUtils.chunkText(text, 2);
      expect(chunks).toEqual(['🌟🌟', '🌟🌟']);
    });

    it('should handle empty text', () => {
      const chunks = TextUtils.chunkText('', 5);
      expect(chunks).toEqual([]);
    });
  });

  describe('normalizeWhitespace', () => {

    it('should normalize whitespace', () => {
      const text = 'Text   with\n\n\nmultiple\t\tspaces';
      const result = TextUtils.normalizeWhitespace(text);
      expect(result).toBe('Text with\n\nmultiple spaces');
    });
  });

  describe('titleCase', () => {

    it('should convert to title case', () => {
      const result = TextUtils.titleCase('hello world test');
      expect(result).toBe('Hello World Test');
    });
  });

  describe('sentenceCase', () => {

    it('should convert to sentence case', () => {
      const result = TextUtils.sentenceCase('HELLO WORLD');
      expect(result).toBe('Hello world');
    });
  });

  describe('stripHtml', () => {

    it('should remove HTML tags', () => {
      const html = '<p>Hello <b>world</b></p>';
      const result = TextUtils.stripHtml(html);
      expect(result).toBe('Hello world');
    });
  });

  describe('wordCount', () => {

    it('should count words', () => {
      expect(TextUtils.wordCount('Hello world test')).toBe(3);
      expect(TextUtils.wordCount('  Hello   world  ')).toBe(2);
      expect(TextUtils.wordCount('')).toBe(0);
    });
  });

  describe('hashText', () => {

    it('should generate consistent hash', () => {
      const text = 'test text';
      const hash1 = TextUtils.hashText(text);
      const hash2 = TextUtils.hashText(text);
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-z0-9]+$/);
    });

    it('should generate different hashes for different text', () => {
      const hash1 = TextUtils.hashText('text1');
      const hash2 = TextUtils.hashText('text2');
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe('NumberUtils', () => {

  describe('formatNumber', () => {

    it('should format number with default options', () => {
      const result = NumberUtils.formatNumber(1234.56);
      expect(result).toMatch(/1[\s,]234[.,]56/);
    });

    it('should format currency', () => {
      const result = NumberUtils.formatNumber(1234.56, { style: 'currency', currency: 'USD' });
      expect(result).toContain('$');
    });

    it('should handle NaN', () => {
      const result = NumberUtils.formatNumber(NaN);
      expect(result).toBe('—');
    });
  });

  describe('formatPercentage', () => {

    it('should format percentage', () => {
      const result = NumberUtils.formatPercentage(0.1234, 2);
      expect(result).toBe('12,34%');
    });

    it('should handle NaN', () => {
      const result = NumberUtils.formatPercentage(NaN);
      expect(result).toBe('—');
    });
  });

  describe('formatFileSize', () => {

    it('should format bytes', () => {
      expect(NumberUtils.formatFileSize(500)).toBe('500 Б');
      expect(NumberUtils.formatFileSize(1024)).toBe('1 КБ');
      expect(NumberUtils.formatFileSize(1536)).toBe('1,5 КБ');
      expect(NumberUtils.formatFileSize(1048576)).toBe('1 МБ');
    });

    it('should handle invalid input', () => {
      expect(NumberUtils.formatFileSize(NaN)).toBe('0 Б');
      expect(NumberUtils.formatFileSize(-100)).toBe('0 Б');
    });
  });

  describe('percentageChange', () => {

    it('should calculate percentage change', () => {
      expect(NumberUtils.percentageChange(100, 150)).toBe(50);
      expect(NumberUtils.percentageChange(100, 50)).toBe(-50);
      expect(NumberUtils.percentageChange(0, 100)).toBe(0);
    });
  });

  describe('roundTo', () => {

    it('should round to specified decimals', () => {
      expect(NumberUtils.roundTo(3.14159, 2)).toBe(3.14);
      expect(NumberUtils.roundTo(3.14159, 0)).toBe(3);
      expect(NumberUtils.roundTo(NaN, 2)).toBe(0);
    });
  });

  describe('clamp', () => {

    it('should clamp values', () => {
      expect(NumberUtils.clamp(5, 1, 10)).toBe(5);
      expect(NumberUtils.clamp(0, 1, 10)).toBe(1);
      expect(NumberUtils.clamp(15, 1, 10)).toBe(10);
      expect(NumberUtils.clamp(NaN, 1, 10)).toBe(1);
    });
  });

  describe('average', () => {

    it('should calculate average', () => {
      expect(NumberUtils.average([1, 2, 3, 4, 5])).toBe(3);
      expect(NumberUtils.average([1, NaN, 3])).toBe(2);
      expect(NumberUtils.average([])).toBe(0);
      expect(NumberUtils.average([NaN, NaN])).toBe(0);
    });
  });

  describe('median', () => {

    it('should calculate median', () => {
      expect(NumberUtils.median([1, 2, 3, 4, 5])).toBe(3);
      expect(NumberUtils.median([1, 2, 3, 4])).toBe(2.5);
      expect(NumberUtils.median([5, 1, 3, 2, 4])).toBe(3);
      expect(NumberUtils.median([])).toBe(0);
    });
  });
});

describe('StringUtils', () => {

  describe('sanitize', () => {

    it('should sanitize string with default options', () => {
      const text = '<script>alert("xss")</script>  Extra   spaces  ';
      const result = StringUtils.sanitize(text);
      expect(result).toBe('alert("xss") Extra spaces');
    });

    it('should allow HTML when specified', () => {
      const text = '<b>Bold</b> text';
      const result = StringUtils.sanitize(text, { allowHtml: true });
      expect(result).toBe('<b>Bold</b> text');
    });

    it('should remove emojis when requested', () => {
      const text = 'Hello 🌟 world 😊';
      const result = StringUtils.sanitize(text, { removeEmojis: true });
      expect(result).toBe('Hello world');
    });

    it('should truncate when max length specified', () => {
      const text = 'This is a very long text';
      const result = StringUtils.sanitize(text, { maxLength: 10 });
      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  describe('normalize', () => {

    it('should normalize string for comparison', () => {
      const result = StringUtils.normalize('  Hello World!  ');
      expect(result).toBe('helloworld');
    });

    it('should preserve Cyrillic characters', () => {
      const result = StringUtils.normalize('Привет Мир!');
      expect(result).toBe('приветмир');
    });
  });

  describe('isSimilar', () => {

    it('should detect similar strings', () => {
      expect(StringUtils.isSimilar('hello', 'helo')).toBe(true);
      expect(StringUtils.isSimilar('test', 'completely different')).toBe(false);
      expect(StringUtils.isSimilar('', '')).toBe(true);
    });

    it('should handle identical strings', () => {
      expect(StringUtils.isSimilar('test', 'test')).toBe(true);
    });
  });

  describe('slugify', () => {

    it('should create URL-friendly slug', () => {
      expect(StringUtils.slugify('Hello World!')).toBe('hello-world');
      expect(StringUtils.slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
      expect(StringUtils.slugify('Special@#$Characters')).toBe('specialcharacters');
    });
  });

  describe('maskSensitive', () => {

    it('should mask email addresses', () => {
      const text = 'Contact us at test@example.com';
      const result = StringUtils.maskSensitive(text);
      expect(result).toContain('t**************m');
    });

    it('should mask phone numbers', () => {
      const text = 'Call 123-456-7890';
      const result = StringUtils.maskSensitive(text);
      expect(result).toContain('************');
    });

    it('should mask URLs', () => {
      const text = 'Visit https://example.com';
      const result = StringUtils.maskSensitive(text);
      expect(result).toContain('http***************');
    });

    it('should use custom mask character', () => {
      const text = 'test@example.com';
      const result = StringUtils.maskSensitive(text, { maskChar: '#' });
      expect(result).toContain('#');
    });
  });
});

describe('convenience exports', () => {

  it('should export convenience functions', () => {
    expect(formatDate).toBe(DateUtils.formatDate);
    expect(formatDateRange).toBe(DateUtils.formatDateRange);
    expect(getRelativeTime).toBe(DateUtils.getRelativeTime);
    expect(truncateText).toBe(TextUtils.truncateText);
    expect(chunkText).toBe(TextUtils.chunkText);
    expect(normalizeQuotes).toBe(TextUtils.normalizeQuotes);
    expect(formatNumber).toBe(NumberUtils.formatNumber);
    expect(formatPercentage).toBe(NumberUtils.formatPercentage);
    expect(sanitizeString).toBe(StringUtils.sanitize);
    expect(normalizeString).toBe(StringUtils.normalize);
    expect(hashText).toBe(TextUtils.hashText);
  });
});