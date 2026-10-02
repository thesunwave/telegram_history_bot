/**
 * HTMLBuilder - Utility class for creating HTML markup for Telegram messages
 * Supports Telegram's HTML formatting tags: <b>, <i>, <u>, <s>, <code>, <pre>
 */

export interface IHTMLBuilder {
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  strikethrough(text: string): string;
  code(text: string): string;
  preformatted(text: string): string;
  escapeHtml(text: string): string;
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
}

// Export a default instance for convenience
export const htmlBuilder = new HTMLBuilder();