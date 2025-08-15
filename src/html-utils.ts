/**
 * HTML utility functions for Telegram message formatting
 */

/**
 * Severity levels for emoji indicators
 */
export enum SeverityLevel {
  LOW = 'low',
  MEDIUM = 'medium', 
  HIGH = 'high'
}

/**
 * Emoji indicators for different severity levels
 */
export const SEVERITY_EMOJIS = {
  [SeverityLevel.LOW]: '🟢',
  [SeverityLevel.MEDIUM]: '🟡',
  [SeverityLevel.HIGH]: '🔴'
} as const;

/**
 * Gets severity level based on numeric value (1-10)
 */
export function getSeverityLevel(severity: number): SeverityLevel {
  if (isNaN(severity) || severity < 1 || severity > 10) {
    throw new Error('Severity must be between 1 and 10');
  }
  
  if (severity <= 3) return SeverityLevel.LOW;
  if (severity <= 6) return SeverityLevel.MEDIUM;
  return SeverityLevel.HIGH;
}

/**
 * Gets emoji for severity level
 */
export function getSeverityEmoji(severity: number): string {
  const level = getSeverityLevel(severity);
  return SEVERITY_EMOJIS[level];
}

/**
 * Escapes HTML special characters
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Creates a formatted section with title and content
 */
export function createSection(title: string, content: string): string {
  return `<b>${escapeHtml(title)}</b>\n${content}`;
}

/**
 * Creates a formatted list item with optional emoji
 */
export function createListItem(label: string, value: string | number, emoji?: string): string {
  const emojiPrefix = emoji ? `${emoji} ` : '';
  const escapedLabel = escapeHtml(label);
  const escapedValue = escapeHtml(value.toString());
  
  return `${emojiPrefix}<b>${escapedLabel}:</b> ${escapedValue}`;
}

/**
 * Returns normalized article label for display without duplicates like "Статья Статья 280 УК РФ".
 * It builds a canonical form: "Статья {core} УК РФ" while avoiding duplicate prefixes/suffixes.
 */
export function formatArticleForDisplay(article: string): string {
  const UNKNOWN = 'Неизвестная статья';
  if (!article) return UNKNOWN;

  // Normalize spaces and trim
  let raw = (article || '').toString().trim();
  if (!raw) return UNKNOWN;
  if (raw === UNKNOWN) return UNKNOWN;

  // Remove leading "Статья" (case-insensitive) and trailing "УК РФ"
  let core = raw
    .replace(/^\s*статья\s+/i, '')
    .replace(/\s*ук\s*рф\s*$/i, '')
    .trim();

  if (!core) return UNKNOWN;

  return `Статья ${core} УК РФ`;
}