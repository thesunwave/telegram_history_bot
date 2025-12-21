/**
 * HTMLBuilder - Utility class for creating HTML markup for Telegram messages
 * Supports Telegram's HTML formatting tags: <b>, <i>, <u>, <s>, <code>, <pre>
 */

import { formatArticleForDisplay } from './html-utils';

export interface IHTMLBuilder {
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  strikethrough(text: string): string;
  code(text: string): string;
  preformatted(text: string): string;
  escapeHtml(text: string): string;
  getSeverityEmoji(severity: number): string;
  buildViolationMessage(data: ViolationMessageData): string;
  buildStatsMessage(data: StatsMessageData): string;
}

export interface ViolationMessageData {
  article: string;
  quote: string;
  punishment: string;
  severity: number;
  confidence: number;
}

export interface StatsMessageData {
  title: string;
  items: Array<{
    label: string;
    value: string | number;
    severity?: number;
  }>;
  footer?: string;
}

export class HTMLBuilder implements IHTMLBuilder {
  /**
   * Escapes HTML special characters to prevent injection and formatting issues
   */
  escapeHtml(text: string): string {
    if (!text) return '';
    
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * Wraps text in bold HTML tags
   */
  bold(text: string): string {
    return `<b>${this.escapeHtml(text)}</b>`;
  }

  /**
   * Wraps text in italic HTML tags
   */
  italic(text: string): string {
    return `<i>${this.escapeHtml(text)}</i>`;
  }

  /**
   * Wraps text in underline HTML tags
   */
  underline(text: string): string {
    return `<u>${this.escapeHtml(text)}</u>`;
  }

  /**
   * Wraps text in strikethrough HTML tags
   */
  strikethrough(text: string): string {
    return `<s>${this.escapeHtml(text)}</s>`;
  }

  /**
   * Wraps text in code HTML tags for inline code
   */
  code(text: string): string {
    return `<code>${this.escapeHtml(text)}</code>`;
  }

  /**
   * Wraps text in preformatted HTML tags for code blocks
   */
  preformatted(text: string): string {
    return `<pre>${this.escapeHtml(text)}</pre>`;
  }

  /**
   * Returns emoji indicator based on severity level (1-10)
   * 🟢 for low severity (1-3)
   * 🟡 for medium severity (4-6) 
   * 🔴 for high severity (7-10)
   */
  getSeverityEmoji(severity: number): string {
    if (severity < 1 || severity > 10) {
      throw new Error('Severity must be between 1 and 10');
    }
    
    if (severity <= 3) return '🟢';
    if (severity <= 6) return '🟡';
    return '🔴';
  }

  /**
   * Builds a formatted violation message with HTML markup
   */
  buildViolationMessage(data: ViolationMessageData): string {
    const { article, quote, punishment, severity, confidence } = data;
    
    const severityEmoji = this.getSeverityEmoji(severity);
    const confidenceWarning = confidence < 0.7 ? 
      '\n⚠️ ' + this.italic('Низкий уровень доверия к анализу') : '';
    
    return [
      `${severityEmoji} ${this.bold(formatArticleForDisplay(article))}`,
      '',
      this.bold('Цитата:'),
      this.italic(`"${quote}"`),
      '',
      this.bold('Наказание:'),
      punishment,
      '',
      `${this.bold('Серьезность:')} ${severity}/10`,
      `${this.bold('Уровень доверия:')} ${Math.round(confidence * 100)}%`,
      confidenceWarning
    ].filter(line => line !== undefined).join('\n');
  }

  /**
   * Builds a formatted statistics message with HTML markup
   */
  buildStatsMessage(data: StatsMessageData): string {
    const { title, items, footer } = data;
    
    const lines = [
      this.bold(title),
      ''
    ];
    
    items.forEach(item => {
      const emoji = item.severity ? this.getSeverityEmoji(item.severity) : '';
      const value = typeof item.value === 'number' ? item.value.toString() : item.value;
      lines.push(`${emoji} ${this.bold(item.label)}: ${value}`);
    });
    
    if (footer) {
      lines.push('', footer);
    }
    
    return lines.join('\n');
  }
}

// Export a default instance for convenience
export const htmlBuilder = new HTMLBuilder();