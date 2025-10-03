/**
 * HTML Formatting Module
 * 
 * This module provides HTML formatting utilities for Telegram messages,
 * including HTML builders, escaping functions, and severity emoji indicators.
 */

// Export HTMLBuilder classes and interfaces
export { 
  HTMLBuilder, 
  htmlBuilder,
  type IHTMLBuilder,
  type ViolationMessageData,
  type StatsMessageData 
} from '../html-builder';

// Export MessageFormatter classes and interfaces
export {
  MessageFormatter,
  messageFormatter,
  type IMessageFormatter,
  type Violation,
  type ViolationAnalysis
} from '../message-formatter';

// Export statistics types from models
export {
  type UserStats,
  type PeriodStats
} from '../models/statistics';

// Export HTML utilities
export {
  SeverityLevel,
  SEVERITY_EMOJIS,
  getSeverityLevel,
  getSeverityEmoji,
  escapeHtml,
  createSection,
  createListItem as createListItem
} from '../utils/html-utils';

// Import for re-export
import { htmlBuilder } from '../html-builder';
import { 
  getSeverityLevel,
  getSeverityEmoji,
  escapeHtml,
  createSection,
  createListItem as baseCreateListItem
} from '../utils/html-utils';

// Import MessageFormatter for re-export
import { messageFormatter } from '../message-formatter';

// Re-export for convenience
export const htmlFormatting = {
  builder: htmlBuilder,
  formatter: messageFormatter,
  utils: {
    getSeverityLevel,
    getSeverityEmoji,
    escapeHtml,
    createSection,
    // Wrapper adjusts colon placement to match integration expectations:
    // - With emoji: '🔴 <b>Label</b>: Value'
    // - Without emoji: '<b>Label:</b> Value'
    createListItem: (label: string, value: string | number, emoji?: string) => {
      if (emoji) return baseCreateListItem(label, value, emoji);
      // Force colon inside bold when no emoji
      const raw = baseCreateListItem(label, value, undefined);
      // If base puts colon outside, transform to inside
      return raw.replace(/^<b>([^<]+)<\/b>: /, '<b>$1:</b> ');
    }
  }
};
