/**
 * Shared Utility Functions
 * 
 * This module contains common utility functions extracted from across the codebase,
 * including date formatting, text processing, number formatting, and string utilities.
 */

/**
 * Date formatting options
 */
export interface DateFormatOptions {
  locale?: string;
  timeZone?: string;
  includeTime?: boolean;
  includeSeconds?: boolean;
  format?: 'short' | 'medium' | 'long' | 'full';
}

/**
 * Text processing options
 */
export interface TextProcessingOptions {
  maxLength?: number;
  ellipsis?: string;
  preserveWords?: boolean;
  removeExtraSpaces?: boolean;
  normalizeQuotes?: boolean;
}

/**
 * Number formatting options
 */
export interface NumberFormatOptions {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
  currency?: string;
  style?: 'decimal' | 'currency' | 'percent';
}

/**
 * Date formatting and manipulation utilities
 */
export class DateUtils {
  /**
   * Formats a date according to specified options
   */
  static formatDate(date: Date, options: DateFormatOptions = {}): string {
    const {
      locale = 'ru-RU',
      timeZone = 'Europe/Moscow',
      includeTime = false,
      includeSeconds = false,
      format = 'medium'
    } = options;

    if (!date || isNaN(date.getTime())) {
      return 'Неверная дата';
    }

    const formatOptions: Intl.DateTimeFormatOptions = {
      timeZone,
      dateStyle: format
    };

    if (includeTime) {
      // Can't use dateStyle with timeStyle, so use individual options
      delete formatOptions.dateStyle;

      formatOptions.day = '2-digit';
      formatOptions.month = '2-digit';
      formatOptions.year = 'numeric';
      formatOptions.hour = '2-digit';
      formatOptions.minute = '2-digit';

      if (includeSeconds) {
        formatOptions.second = '2-digit';
      }
    }

    try {
      return new Intl.DateTimeFormat(locale, formatOptions).format(date);
    } catch (error: unknown) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Date formatting failed:', error);
      }
      return date.toLocaleDateString(locale);
    }
  }

  /**
   * Formats a date range
   */
  static formatDateRange(startDate: Date, endDate: Date, options: DateFormatOptions = {}): string {
    const { locale = 'ru-RU' } = options;

    if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return 'Неверный период';
    }

    const start = this.formatDate(startDate, options);
    const end = this.formatDate(endDate, options);

    return `${start} — ${end}`;
  }

  /**
   * Gets relative time description (e.g., "2 hours ago")
   */
  static getRelativeTime(date: Date, locale: string = 'ru-RU'): string {
    if (!date || isNaN(date.getTime())) {
      return 'Неверная дата';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'только что';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} мин. назад`;
    } else if (diffHours < 24) {
      return `${diffHours} ч. назад`;
    } else if (diffDays < 7) {
      return `${diffDays} дн. назад`;
    } else {
      return this.formatDate(date, { locale, format: 'short' });
    }
  }

  /**
   * Calculates the difference between two dates in various units
   */
  static dateDifference(startDate: Date, endDate: Date, unit: 'days' | 'hours' | 'minutes' | 'seconds' = 'days'): number {
    if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return 0;
    }

    const diffMs = endDate.getTime() - startDate.getTime();

    switch (unit) {
      case 'seconds':
        return Math.floor(diffMs / 1000);
      case 'minutes':
        return Math.floor(diffMs / (1000 * 60));
      case 'hours':
        return Math.floor(diffMs / (1000 * 60 * 60));
      case 'days':
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
      default:
        return 0;
    }
  }

  /**
   * Checks if a date is within a specific range
   */
  static isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
    if (!date || !startDate || !endDate) {
      return false;
    }

    const time = date.getTime();
    return time >= startDate.getTime() && time <= endDate.getTime();
  }

  /**
   * Gets the start and end of a day for a given date
   */
  static getDayBounds(date: Date): { start: Date; end: Date } {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }
}

/**
 * Text processing utilities for quotes, messages, and general text manipulation
 */
export class TextUtils {
  /**
   * Normalizes quotes in text (converts various quote types to standard quotes)
   */
  static normalizeQuotes(text: string): string {
    if (!text) return '';

    return text
      .replace(/[""]/g, '"')  // Smart quotes to regular quotes
      .replace(/['']/g, "'")  // Smart apostrophes to regular apostrophes
      .replace(/[«»]/g, '"')  // French quotes to regular quotes
      .replace(/[„"]/g, '"'); // German quotes to regular quotes
  }

  /**
   * Extracts and cleans quotes from text
   */
  static extractQuotes(text: string): string[] {
    if (!text) return [];

    const normalizedText = this.normalizeQuotes(text);
    const quoteRegex = /"([^"]+)"/g;
    const quotes: string[] = [];
    let match;

    while ((match = quoteRegex.exec(normalizedText)) !== null) {
      const quote = match[1].trim();
      if (quote.length > 0) {
        quotes.push(quote);
      }
    }

    return quotes;
  }

  /**
   * Truncates text to specified length with options
   */
  static truncateText(text: string, options: TextProcessingOptions = {}): string {
    if (!text) return '';

    const {
      maxLength = 100,
      ellipsis = '...',
      preserveWords = true,
      removeExtraSpaces = true
    } = options;

    let processedText = text;

    if (removeExtraSpaces) {
      processedText = processedText.replace(/\s+/g, ' ').trim();
    }

    if (processedText.length <= maxLength) {
      return processedText;
    }

    let truncated = processedText.substring(0, maxLength - ellipsis.length);

    if (preserveWords) {
      const lastSpaceIndex = truncated.lastIndexOf(' ');
      if (lastSpaceIndex > maxLength * 0.7) { // Don't cut too much
        truncated = truncated.substring(0, lastSpaceIndex);
      }
    }

    return truncated + ellipsis;
  }

  /**
   * Splits text into chunks of specified size
   */
  static chunkText(text: string, chunkSize: number): string[] {
    if (!text || chunkSize <= 0) return [];

    const chunks: string[] = [];
    const chars = Array.from(text); // Handle Unicode properly

    for (let i = 0; i < chars.length; i += chunkSize) {
      chunks.push(chars.slice(i, i + chunkSize).join(''));
    }

    return chunks.length ? chunks : [''];
  }

  /**
   * Removes extra whitespace and normalizes text
   */
  static normalizeWhitespace(text: string): string {
    if (!text) return '';

    return text
      .replace(/[ \t]+/g, ' ')        // Multiple spaces/tabs to single space
      .replace(/\n\s*\n\s*\n+/g, '\n\n') // Multiple newlines to double newline
      .trim();
  }

  /**
   * Capitalizes the first letter of each word
   */
  static titleCase(text: string): string {
    if (!text) return '';

    return text.replace(/\w\S*/g, (txt) =>
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  /**
   * Converts text to sentence case (first letter capitalized)
   */
  static sentenceCase(text: string): string {
    if (!text) return '';

    const trimmed = text.trim();
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  /**
   * Removes HTML tags from text
   */
  static stripHtml(text: string): string {
    if (!text) return '';

    return text.replace(/<[^>]*>/g, '');
  }

  /**
   * Counts words in text
   */
  static wordCount(text: string): number {
    if (!text) return 0;

    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Generates a simple hash from text
   */
  static hashText(text: string): string {
    if (!text) return '0';

    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }
}

/**
 * Number formatting and calculation utilities
 */
export class NumberUtils {
  /**
   * Formats a number according to specified options
   */
  static formatNumber(value: number, options: NumberFormatOptions = {}): string {
    const {
      locale = 'ru-RU',
      minimumFractionDigits = 0,
      maximumFractionDigits = 2,
      useGrouping = true,
      style = 'decimal',
      currency = 'RUB'
    } = options;

    if (isNaN(value)) {
      return '—';
    }

    const formatOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits,
      maximumFractionDigits,
      useGrouping,
      style
    };

    if (style === 'currency') {
      formatOptions.currency = currency;
    }

    try {
      return new Intl.NumberFormat(locale, formatOptions).format(value);
    } catch (error: unknown) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('Number formatting failed:', error);
      }
      return value.toString();
    }
  }

  /**
   * Formats a percentage
   */
  static formatPercentage(value: number, decimals: number = 1): string {
    if (isNaN(value)) {
      return '—';
    }

    return this.formatNumber(value * 100, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals
    }) + '%';
  }

  /**
   * Formats file size in human-readable format
   */
  static formatFileSize(bytes: number): string {
    if (isNaN(bytes) || bytes < 0) {
      return '0 Б';
    }

    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    const formatted = unitIndex === 0 ?
      size.toString() :
      this.formatNumber(size, { maximumFractionDigits: 1 });

    return `${formatted} ${units[unitIndex]}`;
  }

  /**
   * Calculates percentage change between two values
   */
  static percentageChange(oldValue: number, newValue: number): number {
    if (isNaN(oldValue) || isNaN(newValue) || oldValue === 0) {
      return 0;
    }

    return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
  }

  /**
   * Rounds a number to specified decimal places
   */
  static roundTo(value: number, decimals: number = 2): number {
    if (isNaN(value)) {
      return 0;
    }

    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * Clamps a number between min and max values
   */
  static clamp(value: number, min: number, max: number): number {
    if (isNaN(value)) {
      return min;
    }

    return Math.min(Math.max(value, min), max);
  }

  /**
   * Calculates average of an array of numbers
   */
  static average(numbers: number[]): number {
    if (!numbers || numbers.length === 0) {
      return 0;
    }

    const validNumbers = numbers.filter(n => !isNaN(n));
    if (validNumbers.length === 0) {
      return 0;
    }

    const sum = validNumbers.reduce((acc, num) => acc + num, 0);
    return sum / validNumbers.length;
  }

  /**
   * Finds median of an array of numbers
   */
  static median(numbers: number[]): number {
    if (!numbers || numbers.length === 0) {
      return 0;
    }

    const validNumbers = numbers.filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (validNumbers.length === 0) {
      return 0;
    }

    const middle = Math.floor(validNumbers.length / 2);

    if (validNumbers.length % 2 === 0) {
      return (validNumbers[middle - 1] + validNumbers[middle]) / 2;
    } else {
      return validNumbers[middle];
    }
  }
}

/**
 * String sanitization and normalization utilities
 */
export class StringUtils {
  /**
   * Sanitizes a string by removing dangerous characters and normalizing
   */
  static sanitize(text: string, options: {
    allowHtml?: boolean;
    maxLength?: number;
    removeEmojis?: boolean;
    normalizeSpaces?: boolean;
  } = {}): string {
    if (!text) return '';

    const {
      allowHtml = false,
      maxLength,
      removeEmojis = false,
      normalizeSpaces = true
    } = options;

    let sanitized = text;

    // Remove HTML if not allowed
    if (!allowHtml) {
      sanitized = TextUtils.stripHtml(sanitized);
    }

    // Remove emojis if requested
    if (removeEmojis) {
      sanitized = sanitized.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '');
      // Normalize spaces after emoji removal
      sanitized = sanitized.replace(/\s+/g, ' ').trim();
    }

    // Normalize spaces
    if (normalizeSpaces) {
      sanitized = TextUtils.normalizeWhitespace(sanitized);
    }

    // Truncate if needed
    if (maxLength && sanitized.length > maxLength) {
      sanitized = TextUtils.truncateText(sanitized, { maxLength });
    }

    return sanitized;
  }

  /**
   * Normalizes a string for comparison (lowercase, no spaces, etc.)
   */
  static normalize(text: string): string {
    if (!text) return '';

    return text
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^\w\u0400-\u04FF]/g, '') // Keep only letters, numbers, and Cyrillic
      .trim();
  }

  /**
   * Checks if two strings are similar (fuzzy matching)
   */
  static isSimilar(str1: string, str2: string, threshold: number = 0.8): boolean {
    if (!str1 && !str2) return true;
    if (!str1 || !str2) return false;
    if (str1 === str2) return true;

    const normalized1 = this.normalize(str1);
    const normalized2 = this.normalize(str2);

    if (normalized1 === normalized2) return true;

    // Simple similarity check based on common characters
    const longer = normalized1.length > normalized2.length ? normalized1 : normalized2;
    const shorter = normalized1.length > normalized2.length ? normalized2 : normalized1;

    if (longer.length === 0) return true;

    let matches = 0;
    for (const char of shorter) {
      if (longer.includes(char)) {
        matches++;
      }
    }

    const similarity = matches / longer.length;
    return similarity >= threshold;
  }

  /**
   * Generates a slug from text (URL-friendly string)
   */
  static slugify(text: string): string {
    if (!text) return '';

    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters
      .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
      .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
  }

  /**
   * Masks sensitive information in text
   */
  static maskSensitive(text: string, options: {
    maskEmails?: boolean;
    maskPhones?: boolean;
    maskUrls?: boolean;
    maskChar?: string;
  } = {}): string {
    if (!text) return '';

    const {
      maskEmails = true,
      maskPhones = true,
      maskUrls = true,
      maskChar = '*'
    } = options;

    let masked = text;

    if (maskEmails) {
      masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        (match) => match.charAt(0) + maskChar.repeat(match.length - 2) + match.charAt(match.length - 1)
      );
    }

    if (maskPhones) {
      masked = masked.replace(/\b\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}\b/g,
        (match) => maskChar.repeat(match.length)
      );
    }

    if (maskUrls) {
      masked = masked.replace(/https?:\/\/[^\s]+/g,
        (match) => 'http' + maskChar.repeat(match.length - 4)
      );
    }

    return masked;
  }
}

// Export convenience functions
export const formatDate = DateUtils.formatDate;
export const formatDateRange = DateUtils.formatDateRange;
export const getRelativeTime = DateUtils.getRelativeTime;
export const truncateText = TextUtils.truncateText;
export const chunkText = TextUtils.chunkText;
export const normalizeQuotes = TextUtils.normalizeQuotes;
export const formatNumber = NumberUtils.formatNumber;
export const formatPercentage = NumberUtils.formatPercentage;
export const sanitizeString = StringUtils.sanitize;
export const normalizeString = StringUtils.normalize;
export const hashText = TextUtils.hashText;

// Utility classes are already exported above