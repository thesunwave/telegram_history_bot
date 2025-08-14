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
  type ViolationAnalysis,
  type UserStats,
  type PeriodStats
} from '../message-formatter';

// Export HTML utilities
export {
  SeverityLevel,
  SEVERITY_EMOJIS,
  getSeverityLevel,
  getSeverityEmoji,
  escapeHtml,
  createSection,
  createListItem
} from '../html-utils';

// Import for re-export
import { htmlBuilder } from '../html-builder';
import { 
  getSeverityLevel,
  getSeverityEmoji,
  escapeHtml,
  createSection,
  createListItem
} from '../html-utils';

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
    createListItem
  }
};