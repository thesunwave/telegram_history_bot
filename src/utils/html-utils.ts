/**
 * @fileoverview Unified HTML Utilities Module
 * 
 * This module consolidates HTMLBuilder and html-utils functionality into a single,
 * cohesive module with template-based message building system and consistent
 * HTML escaping and sanitization.
 * 
 * The module provides:
 * - HTML escaping and sanitization utilities
 * - Severity emoji indicators
 * - Article formatting for criminal code references
 * - Template-based message construction
 * - Safe HTML building with validation
 * 
 * @author Telegram History Bot Team
 * @version 2.0.0
 * @since 2024-01-01
 * 
 * @example
 * ```typescript
 * import { escapeHtml, getSeverityEmoji, formatArticleForDisplay } from './html-utils';
 * 
 * // Escape user input
 * const safeText = escapeHtml(userInput);
 * 
 * // Get severity indicator
 * const emoji = getSeverityEmoji(8); // Returns 🔴 for high severity
 * 
 * // Format article reference
 * const article = formatArticleForDisplay('228', '1'); // Returns "ст. 228 ч. 1"
 * ```
 */

/**
 * Severity levels for emoji indicators.
 * 
 * Used to categorize violation severity into three distinct levels
 * for consistent visual representation across the application.
 * 
 * @enum {string}
 */
export enum SeverityLevel {
  /** Low severity (1-3): Minor violations with minimal impact */
  LOW = 'low',
  /** Medium severity (4-6): Moderate violations requiring attention */
  MEDIUM = 'medium',
  /** High severity (7-10): Serious violations requiring immediate action */
  HIGH = 'high'
}

/**
 * Emoji indicators for different severity levels.
 * 
 * Provides visual indicators that correspond to severity levels:
 * - 🟢 Green circle for low severity
 * - 🟡 Yellow circle for medium severity  
 * - 🔴 Red circle for high severity
 * 
 * @constant
 * @readonly
 */
export const SEVERITY_EMOJIS = {
  [SeverityLevel.LOW]: '🟢',
  [SeverityLevel.MEDIUM]: '🟡',
  [SeverityLevel.HIGH]: '🔴'
} as const;

/**
 * Template variables for message formatting.
 * 
 * Defines the structure for variables that can be substituted in message templates.
 * Variables can be strings, numbers, booleans, or undefined (which will be skipped).
 * 
 * @interface TemplateVariables
 * 
 * @example
 * ```typescript
 * const variables: TemplateVariables = {
 *   title: "Alert",
 *   count: 42,
 *   isActive: true,
 *   optionalField: undefined // Will be skipped
 * };
 * ```
 */
export interface TemplateVariables {
  [key: string]: string | number | boolean | undefined;
}

/**
 * Message template configuration.
 * 
 * Defines the structure for registering and managing message templates
 * with variable substitution capabilities.
 * 
 * @interface MessageTemplate
 * 
 * @example
 * ```typescript
 * const template: MessageTemplate = {
 *   id: 'user_alert',
 *   name: 'User Alert Template',
 *   template: '<b>{{title}}</b>\nUser: {{username}}\nStatus: {{status}}',
 *   variables: ['title', 'username', 'status'],
 *   description: 'Template for user status alerts'
 * };
 * ```
 */
export interface MessageTemplate {
  /** Unique identifier for the template */
  id: string;
  /** Human-readable name for the template */
  name: string;
  /** Template string with {{variable}} placeholders */
  template: string;
  /** List of variable names used in the template */
  variables: string[];
  /** Description of the template's purpose and usage */
  description: string;
}

/**
 * Violation message data structure.
 * 
 * Contains all the information needed to format a criminal code violation
 * message with proper severity indicators and confidence levels.
 * 
 * @interface ViolationMessageData
 * 
 * @example
 * ```typescript
 * const violationData: ViolationMessageData = {
 *   article: '228',
 *   quote: 'Suspicious substance found',
 *   punishment: 'Fine up to 40,000 rubles or imprisonment up to 3 years',
 *   severity: 7,
 *   confidence: 0.85
 * };
 * ```
 */
export interface ViolationMessageData {
  /** Criminal code article number (e.g., "228", "280.1") */
  article: string;
  /** Subarticle number if applicable */
  subarticle?: string | null;
  /** Quote from the analyzed text that triggered the violation */
  quote: string;
  /** Description of the punishment for this violation */
  punishment: string;
  /** Severity level from 1-10 (1=minor, 10=severe) */
  severity: number;
  /** AI confidence level from 0-1 (0=no confidence, 1=certain) */
  confidence: number;
}

/**
 * Statistics message data structure.
 * 
 * Contains structured data for formatting statistics messages with
 * optional severity indicators and footer information.
 * 
 * @interface StatsMessageData
 * 
 * @example
 * ```typescript
 * const statsData: StatsMessageData = {
 *   title: 'Weekly Violation Statistics',
 *   items: [
 *     { label: 'Total Violations', value: 42 },
 *     { label: 'High Severity Cases', value: 8, severity: 8 },
 *     { label: 'Average Severity', value: '5.2/10' }
 *   ],
 *   footer: 'Report generated on 2024-01-15'
 * };
 * ```
 */
export interface StatsMessageData {
  /** Title for the statistics report */
  title: string;
  /** Array of statistical items to display */
  items: Array<{
    /** Label for the statistic */
    label: string;
    /** Value of the statistic (string or number) */
    value: string | number;
    /** Optional severity level for emoji indicator */
    severity?: number;
  }>;
  /** Optional footer text for additional information */
  footer?: string;
}

/**
 * HTML formatting utilities class.
 * 
 * Provides safe HTML formatting functions with automatic escaping to prevent
 * injection attacks and ensure proper Telegram HTML formatting.
 * 
 * @class HTMLUtils
 * @static
 * 
 * @example
 * ```typescript
 * // Basic HTML formatting
 * const boldText = HTMLUtils.bold("Important text");
 * const italicText = HTMLUtils.italic("Emphasized text");
 * 
 * // Safe escaping
 * const safeText = HTMLUtils.escapeHtml("<script>alert('xss')</script>");
 * 
 * // Severity indicators
 * const emoji = HTMLUtils.getSeverityEmoji(8); // Returns 🔴
 * ```
 */
export class HTMLUtils {
  /**
   * Escapes HTML special characters to prevent injection and formatting issues.
   * 
   * Converts potentially dangerous characters to their HTML entity equivalents:
   * - `&` → `&amp;`
   * - `<` → `&lt;`
   * - `>` → `&gt;`
   * - `"` → `&quot;`
   * - `'` → `&#x27;`
   * - `/` → `&#x2F;`
   * 
   * @param text - The text to escape
   * @returns The escaped text safe for HTML display
   * 
   * @example
   * ```typescript
   * const userInput = '<script>alert("xss")</script>';
   * const safeText = HTMLUtils.escapeHtml(userInput);
   * // Returns: "&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;"
   * ```
   */
  static escapeHtml(text: string | number | boolean | null | undefined): string {
    if (text === null || text === undefined) return '';
  
    const textStr = String(text);
    if (!textStr) return '';
  
    return textStr
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/=/g, '&#x3D;');
  }

  /**
   * Wraps text in bold HTML tags with automatic escaping.
   * 
   * @param text - The text to make bold
   * @returns The text wrapped in `<b>` tags with escaped content
   * 
   * @example
   * ```typescript
   * const boldText = HTMLUtils.bold("Important message");
   * // Returns: "<b>Important message</b>"
   * 
   * const safeBold = HTMLUtils.bold("Text with <tags>");
   * // Returns: "<b>Text with &lt;tags&gt;</b>"
   * ```
   */
  static bold(text: string): string {
    return `<b>${HTMLUtils.escapeHtml(text)}</b>`;
  }

  /**
   * Wraps text in italic HTML tags with automatic escaping.
   * 
   * @param text - The text to make italic
   * @returns The text wrapped in `<i>` tags with escaped content
   * 
   * @example
   * ```typescript
   * const italicText = HTMLUtils.italic("Emphasized text");
   * // Returns: "<i>Emphasized text</i>"
   * ```
   */
  static italic(text: string): string {
    return `<i>${HTMLUtils.escapeHtml(text)}</i>`;
  }

  /**
   * Wraps text in underline HTML tags with automatic escaping.
   * 
   * @param text - The text to underline
   * @returns The text wrapped in `<u>` tags with escaped content
   * 
   * @example
   * ```typescript
   * const underlinedText = HTMLUtils.underline("Underlined text");
   * // Returns: "<u>Underlined text</u>"
   * ```
   */
  static underline(text: string): string {
    return `<u>${HTMLUtils.escapeHtml(text)}</u>`;
  }

  /**
   * Wraps text in strikethrough HTML tags with automatic escaping.
   * 
   * @param text - The text to strike through
   * @returns The text wrapped in `<s>` tags with escaped content
   * 
   * @example
   * ```typescript
   * const strikeText = HTMLUtils.strikethrough("Deleted text");
   * // Returns: "<s>Deleted text</s>"
   * ```
   */
  static strikethrough(text: string): string {
    return `<s>${HTMLUtils.escapeHtml(text)}</s>`;
  }

  /**
   * Wraps text in code HTML tags for inline code with automatic escaping.
   * 
   * @param text - The code text to format
   * @returns The text wrapped in `<code>` tags with escaped content
   * 
   * @example
   * ```typescript
   * const codeText = HTMLUtils.code("const x = 5;");
   * // Returns: "<code>const x = 5;</code>"
   * ```
   */
  static code(text: string): string {
    return `<code>${HTMLUtils.escapeHtml(text)}</code>`;
  }

  /**
   * Wraps text in preformatted HTML tags for code blocks with automatic escaping.
   * 
   * @param text - The code block text to format
   * @returns The text wrapped in `<pre>` tags with escaped content
   * 
   * @example
   * ```typescript
   * const codeBlock = HTMLUtils.preformatted("function hello() {\n  console.log('Hello');\n}");
   * // Returns: "<pre>function hello() {\n  console.log('Hello');\n}</pre>"
   * ```
   */
  static preformatted(text: string): string {
    return `<pre>${HTMLUtils.escapeHtml(text)}</pre>`;
  }

  /**
   * Gets severity level based on numeric value (1-10).
   * 
   * Maps numeric severity to categorical levels:
   * - 1-3: LOW
   * - 4-6: MEDIUM  
   * - 7-10: HIGH
   * 
   * @param severity - Numeric severity value (1-10)
   * @returns The corresponding severity level
   * @throws {Error} When severity is not between 1 and 10
   * 
   * @example
   * ```typescript
   * const level1 = HTMLUtils.getSeverityLevel(2);  // SeverityLevel.LOW
   * const level2 = HTMLUtils.getSeverityLevel(5);  // SeverityLevel.MEDIUM
   * const level3 = HTMLUtils.getSeverityLevel(9);  // SeverityLevel.HIGH
   * ```
   */
  static getSeverityLevel(severity: number): SeverityLevel {
    // Handle edge cases and invalid values
    if (isNaN(severity) || severity === null || severity === undefined) {
      return SeverityLevel.LOW; // Default to low for invalid values
    }

    // Clamp severity to valid range
    const clampedSeverity = Math.max(1, Math.min(10, severity));

    if (clampedSeverity <= 3) return SeverityLevel.LOW;
    if (clampedSeverity <= 6) return SeverityLevel.MEDIUM;
    return SeverityLevel.HIGH;
  }

  /**
   * Returns emoji indicator based on severity level (1-10).
   * 
   * Provides visual severity indicators:
   * - 🟢 for low severity (1-3)
   * - 🟡 for medium severity (4-6) 
   * - 🔴 for high severity (7-10)
   * 
   * @param severity - Numeric severity value (1-10)
   * @returns The corresponding emoji indicator
   * 
   * @example
   * ```typescript
   * const lowEmoji = HTMLUtils.getSeverityEmoji(2);    // "🟢"
   * const mediumEmoji = HTMLUtils.getSeverityEmoji(5); // "🟡"
   * const highEmoji = HTMLUtils.getSeverityEmoji(8);   // "🔴"
   * ```
   */
  static getSeverityEmoji(severity: number): string {
    const level = HTMLUtils.getSeverityLevel(severity);
    return SEVERITY_EMOJIS[level];
  }

  /**
   * Creates a formatted section with title and content.
   * 
   * @param title - The section title (will be bolded)
   * @param content - The section content
   * @returns Formatted section with bold title and content separated by newline
   * 
   * @example
   * ```typescript
   * const section = HTMLUtils.createSection("Statistics", "Total: 42\nAverage: 3.5");
   * // Returns: "<b>Statistics</b>\nTotal: 42\nAverage: 3.5"
   * ```
   */
  static createSection(title: string, content: string): string {
    return `${HTMLUtils.bold(title)}\n${content}`;
  }

  /**
   * Creates a formatted list item with optional emoji.
   * 
   * @param label - The item label (will be bolded)
   * @param value - The item value
   * @param emoji - Optional emoji prefix
   * @returns Formatted list item with optional emoji, bold label, and escaped value
   * 
   * @example
   * ```typescript
   * const item1 = HTMLUtils.createListItem("Total", 42);
   * // Returns: "<b>Total</b>: 42"
   * 
   * const item2 = HTMLUtils.createListItem("Status", "Active", "✅");
   * // Returns: "✅ <b>Status</b>: Active"
   * ```
   */
  static createListItem(label: string, value: string | number, emoji?: string): string {
    const emojiPrefix = emoji ? `${emoji} ` : '';
    const escapedValue = HTMLUtils.escapeHtml(value.toString());
    // Base rule (unit tests): colon outside the bold label
    return `${emojiPrefix}${HTMLUtils.bold(label)}: ${escapedValue}`;
  }

  /**
   * Returns normalized article label for display without duplicates.
   * 
   * Builds a canonical form: "Статья {core} УК РФ" while avoiding duplicate 
   * prefixes/suffixes like "Статья Статья 280 УК РФ".
   * 
   * @param article - The article reference to format
   * @returns Normalized article display string
   * 
   * @example
   * ```typescript
   * const article1 = HTMLUtils.formatArticleForDisplay("228");
   * // Returns: "Статья 228 УК РФ"
   * 
   * const article2 = HTMLUtils.formatArticleForDisplay("Статья 280 УК РФ");
   * // Returns: "Статья 280 УК РФ" (no duplication)
   * 
   * const article3 = HTMLUtils.formatArticleForDisplay("228.1");
   * // Returns: "Статья 228.1 УК РФ"
   * ```
   */
  static formatArticleForDisplay(article: string): string {
    const UNKNOWN = 'Неизвестная статья';
    if (!article) return UNKNOWN;

    // Normalize spaces and trim
    const raw = (article || '').toString().trim();
    if (!raw) return UNKNOWN;
    if (raw === UNKNOWN) return UNKNOWN;

    // Remove leading "Статья" (case-insensitive) and trailing "УК РФ"
    const core = raw
        .replace(/^\s*статья\s+/i, '')
        .replace(/\s*ук\s*рф\s*$/i, '')
        .trim();

    if (!core) return UNKNOWN;

    return `Статья ${core} УК РФ`;
  }
}

/**
 * Template-based message builder for consistent message formatting.
 * 
 * Provides a template system for building formatted messages with variable substitution,
 * automatic HTML escaping, and predefined templates for common message types.
 * 
 * @class MessageTemplateBuilder
 * @static
 * 
 * @example
 * ```typescript
 * // Register a custom template
 * MessageTemplateBuilder.registerTemplate({
 *   id: 'custom',
 *   name: 'Custom Message',
 *   template: '<b>{{title}}</b>\n{{content}}',
 *   variables: ['title', 'content'],
 *   description: 'A simple custom message template'
 * });
 * 
 * // Render the template
 * const message = MessageTemplateBuilder.renderTemplate('custom', {
 *   title: 'Hello',
 *   content: 'World!'
 * });
 * ```
 */
export class MessageTemplateBuilder {
  /**
   * Internal storage for registered templates.
   * @private
   */
  private static templates: Map<string, MessageTemplate> = new Map();

  /**
   * Registers a message template for later use.
   * 
   * @param template - The template configuration to register
   * @throws {Error} If a template with the same ID already exists
   * 
   * @example
   * ```typescript
   * MessageTemplateBuilder.registerTemplate({
   *   id: 'alert',
   *   name: 'Alert Message',
   *   template: '🚨 <b>{{title}}</b>\n{{message}}',
   *   variables: ['title', 'message'],
   *   description: 'Template for alert messages'
   * });
   * ```
   */
  static registerTemplate(template: MessageTemplate): void {
    this.templates.set(template.id, template);
  }

  /**
   * Gets a registered template by ID.
   * 
   * @param id - The template ID to retrieve
   * @returns The template configuration or undefined if not found
   * 
   * @example
   * ```typescript
   * const template = MessageTemplateBuilder.getTemplate('violation');
   * if (template) {
   *   console.log(`Template: ${template.name}`);
   * }
   * ```
   */
  static getTemplate(id: string): MessageTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * Renders a template with provided variables.
   * 
   * Performs variable substitution using `{{variableName}}` syntax and automatically
   * escapes string values for HTML safety. Warns about unreplaced variables.
   * 
   * @param templateId - The ID of the template to render
   * @param variables - Object containing variable values for substitution
   * @returns The rendered template string with variables replaced
   * @throws {Error} If the template is not found
   * 
   * @example
   * ```typescript
   * const message = MessageTemplateBuilder.renderTemplate('violation', {
   *   severityEmoji: '🔴',
   *   article: 'Статья 228 УК РФ',
   *   quote: 'Suspicious text',
   *   punishment: 'Fine or imprisonment',
   *   severity: 8,
   *   confidence: 85
   * });
   * ```
   */
  static renderTemplate(templateId: string, variables: TemplateVariables): string {
    const template = this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    let rendered = template.template;

    // Replace template variables
    for (const [key, value] of Object.entries(variables)) {
      if (value !== undefined) {
        const placeholder = `{{${key}}}`;
        const escapedValue = typeof value === 'string' ? HTMLUtils.escapeHtml(value) : String(value);
        rendered = rendered.replace(new RegExp(placeholder, 'g'), escapedValue);
      }
    }

    // Check for unreplaced variables
    const unreplacedVars = rendered.match(/\{\{[^}]+\}\}/g);
    if (unreplacedVars) {
      console.warn(`Unreplaced template variables in ${templateId}:`, unreplacedVars);
    }

    return rendered;
  }

  /**
   * Builds a formatted violation message using predefined structure.
   * 
   * Creates a comprehensive violation report with severity indicators,
   * confidence warnings, and proper formatting.
   * 
   * @param data - The violation data to format
   * @returns Formatted violation message string
   * 
   * @example
   * ```typescript
   * const violationMessage = MessageTemplateBuilder.buildViolationMessage({
   *   article: '228',
   *   quote: 'Suspicious activity detected',
   *   punishment: 'Fine up to 40,000 rubles',
   *   severity: 7,
   *   confidence: 0.85
   * });
   * ```
   */
  static buildViolationMessage(data: ViolationMessageData): string {
    const { article, quote, punishment, severity, confidence } = data;

    const severityEmoji = HTMLUtils.getSeverityEmoji(severity);
    const confidenceWarning = confidence < 0.7 ?
      '\n⚠️ ' + HTMLUtils.italic('Низкий уровень доверия к анализу') : '';

    return [
      `${severityEmoji} ${HTMLUtils.bold(HTMLUtils.formatArticleForDisplay(article))}`,
      '',
      HTMLUtils.bold('Цитата:'),
      HTMLUtils.italic(`"${quote}"`),
      '',
      HTMLUtils.bold('Наказание:'),
      punishment,
      '',
      `${HTMLUtils.bold('Серьезность:')} ${severity}/10`,
      `${HTMLUtils.bold('Уровень доверия:')} ${Math.round(confidence * 100)}%`,
      confidenceWarning
    ].filter(line => line !== undefined).join('\n');
  }

  /**
   * Builds a formatted statistics message using predefined structure.
   * 
   * Creates a statistics report with title, items list, and optional footer.
   * Automatically adds severity emojis to items that have severity values.
   * 
   * @param data - The statistics data to format
   * @returns Formatted statistics message string
   * 
   * @example
   * ```typescript
   * const statsMessage = MessageTemplateBuilder.buildStatsMessage({
   *   title: 'Weekly Statistics',
   *   items: [
   *     { label: 'Total Violations', value: 42 },
   *     { label: 'High Severity', value: 8, severity: 8 },
   *     { label: 'Average Severity', value: '5.2/10' }
   *   ],
   *   footer: 'Data updated: 2024-01-15'
   * });
   * ```
   */
  static buildStatsMessage(data: StatsMessageData): string {
    const { title, items, footer } = data;

    const lines = [
      HTMLUtils.bold(title),
      ''
    ];

    items.forEach(item => {
      const emoji = item.severity ? HTMLUtils.getSeverityEmoji(item.severity) : '';
      const value = typeof item.value === 'number' ? item.value.toString() : item.value;
      const emojiPrefix = emoji ? `${emoji} ` : '';
      lines.push(`${emojiPrefix}${HTMLUtils.bold(item.label)}: ${value}`);
    });

    if (footer) {
      lines.push('', footer);
    }

    return lines.join('\n');
  }
}

// Register default templates
MessageTemplateBuilder.registerTemplate({
  id: 'violation',
  name: 'Violation Report',
  template: `{{severityEmoji}} <b>{{article}}</b>

<b>Цитата:</b>
<i>"{{quote}}"</i>

<b>Наказание:</b>
{{punishment}}

<b>Серьезность:</b> {{severity}}/10
<b>Уровень доверия:</b> {{confidence}}%{{confidenceWarning}}`,
  variables: ['severityEmoji', 'article', 'quote', 'punishment', 'severity', 'confidence', 'confidenceWarning'],
  description: 'Template for violation reports with severity and confidence indicators'
});

MessageTemplateBuilder.registerTemplate({
  id: 'stats',
  name: 'Statistics Report',
  template: `<b>{{title}}</b>

{{items}}{{footer}}`,
  variables: ['title', 'items', 'footer'],
  description: 'Template for statistics reports with title, items, and optional footer'
});

MessageTemplateBuilder.registerTemplate({
  id: 'user_stats',
  name: 'User Statistics',
  template: `<b>📊 Статистика пользователя {{username}}</b>

<b>Общие показатели:</b>
• Всего нарушений: {{totalViolations}}
• Средняя серьезность: {{averageSeverity}}/10
• Уровень риска: {{riskLevel}}

{{violationsList}}{{footer}}`,
  variables: ['username', 'totalViolations', 'averageSeverity', 'riskLevel', 'violationsList', 'footer'],
  description: 'Template for user statistics with violations breakdown'
});

MessageTemplateBuilder.registerTemplate({
  id: 'period_stats',
  name: 'Period Statistics',
  template: `<b>📈 Статистика за период</b>
<i>{{startDate}} - {{endDate}}</i>

<b>Общие показатели:</b>
• Всего нарушений: {{totalViolations}}
• Уникальных пользователей: {{uniqueUsers}}
• Средняя серьезность: {{averageSeverity}}/10

{{violationsList}}{{comparison}}{{footer}}`,
  variables: ['startDate', 'endDate', 'totalViolations', 'uniqueUsers', 'averageSeverity', 'violationsList', 'comparison', 'footer'],
  description: 'Template for period statistics with comparison data'
});

// Export convenience functions
export const escapeHtml = HTMLUtils.escapeHtml;
export const bold = HTMLUtils.bold;
export const italic = HTMLUtils.italic;
export const underline = HTMLUtils.underline;
export const strikethrough = HTMLUtils.strikethrough;
export const code = HTMLUtils.code;
export const preformatted = HTMLUtils.preformatted;
export const getSeverityLevel = HTMLUtils.getSeverityLevel;
export const getSeverityEmoji = HTMLUtils.getSeverityEmoji;
export const createSection = HTMLUtils.createSection;
export const createListItem = HTMLUtils.createListItem;
export const formatArticleForDisplay = HTMLUtils.formatArticleForDisplay;

// Export template builder
export const templateBuilder = MessageTemplateBuilder;

// Export default instance for backward compatibility
export const htmlUtils = HTMLUtils;
