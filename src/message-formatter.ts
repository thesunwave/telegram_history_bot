/**
 * MessageFormatter - Formats violation messages and statistics for Telegram display
 * 
 * This class handles the formatting of violation analysis data into user-friendly
 * HTML messages that comply with Telegram's formatting requirements.
 */

import { HTMLBuilder } from './html-builder';
import { getSeverityEmoji, escapeHtml, formatArticleForDisplay } from './utils/html-utils';

/**
 * Formats article number with subarticle if present
 */
function formatFullArticle(article: string, subarticle?: string | null): string {
  if (subarticle) {
    return `${article}.${subarticle}`;
  }
  return article;
}

/**
 * Represents a single violation from the analysis
 */
export interface Violation {
  article: string;
  subarticle?: string | null;
  articleTitle: string;
  quote: string;
  punishment: string;
  severity: number; // 1-10
  confidence: number; // 0-1
}

/**
 * Complete violation analysis data
 */
export interface ViolationAnalysis {
  hasViolations: boolean;
  violations: Violation[];
  totalSeverity: number;
  riskLevel: 'low' | 'medium' | 'high';
  analysisTimestamp: string;
}

/**
 * Template for message formatting
 */
export interface MessageTemplate {
  header: string;
  sections: MessageSection[];
  footer?: string;
}

/**
 * Section within a message template
 */
export interface MessageSection {
  title?: string;
  content: string | (() => string);
  condition?: () => boolean;
  separator?: string;
}

/**
 * Template context for dynamic content generation
 */
export interface TemplateContext {
  [key: string]: any;
}

/**
 * Message builder for fluent interface construction
 */
export class MessageBuilder {
  private sections: string[] = [];
  private htmlBuilder: HTMLBuilder;

  constructor(htmlBuilder?: HTMLBuilder) {
    this.htmlBuilder = htmlBuilder || new HTMLBuilder();
  }

  /**
   * Adds a header section
   */
  header(text: string, icon?: string): this {
    const headerText = icon ? `${icon} ${this.htmlBuilder.bold(text)}` : this.htmlBuilder.bold(text);
    this.sections.push(headerText, '');
    return this;
  }

  /**
   * Adds a section with optional title
   */
  section(content: string, title?: string): this {
    if (title) {
      this.sections.push(this.htmlBuilder.bold(title));
    }
    this.sections.push(content, '');
    return this;
  }

  /**
   * Adds a list section
   */
  list(items: string[], title?: string): this {
    if (title) {
      this.sections.push(this.htmlBuilder.bold(title));
    }
    items.forEach(item => {
      this.sections.push(item);
    });
    this.sections.push('');
    return this;
  }

  /**
   * Adds a separator
   */
  separator(text: string = '━━━━━━━━━━━━━━━━━━━━'): this {
    this.sections.push('', text, '');
    return this;
  }

  /**
   * Adds content conditionally
   */
  when(condition: boolean, callback: (builder: this) => this): this {
    if (condition) {
      return callback(this);
    }
    return this;
  }

  /**
   * Adds a footer section
   */
  footer(text: string): this {
    this.sections.push(text);
    return this;
  }

  /**
   * Builds the final message
   */
  build(): string {
    // Clean up extra empty lines at the end
    while (this.sections.length > 0 && this.sections[this.sections.length - 1] === '') {
      this.sections.pop();
    }
    return this.sections.join('\n');
  }

  /**
   * Clears the builder for reuse
   */
  clear(): this {
    this.sections = [];
    return this;
  }
}

/**
 * Specialized builder for violation analysis messages
 */
export class ViolationAnalysisBuilder extends MessageBuilder {
  constructor(private formatter: MessageFormatter, htmlBuilder?: HTMLBuilder) {
    super(htmlBuilder);
  }

  /**
   * Adds violation analysis header
   */
  violationHeader(hasViolations: boolean): ViolationAnalysisBuilder {
    const headerText = hasViolations ? 'Обнаружены нарушения УК РФ' : 'Нарушений не обнаружено';
    const icon = hasViolations ? '🚨' : '✅';
    this.header(headerText, icon);
    return this;
  }

  /**
   * Adds violations list
   */
  violationsList(violations: Violation[]): ViolationAnalysisBuilder {
    violations.forEach((violation, index) => {
      if (index > 0) {
        this.separator();
      }
      this.section(this.formatter.formatViolation(violation));
    });
    return this;
  }

  /**
   * Adds violation summary
   */
  violationSummary(analysis: ViolationAnalysis): ViolationAnalysisBuilder {
    this.separator();
    this.section([
      this.formatter['htmlBuilder'].bold('Общая информация:'),
      `${this.formatter['htmlBuilder'].bold('Всего нарушений:')} ${analysis.violations.length}`,
      `${this.formatter['htmlBuilder'].bold('Общий уровень серьезности:')} ${analysis.totalSeverity}`,
      `${this.formatter['htmlBuilder'].bold('Уровень риска:')} ${this.formatter['formatRiskLevel'](analysis.riskLevel)}`
    ].join('\n'));
    return this;
  }
}

/**
 * Specialized builder for statistics messages
 */
export class StatsBuilder extends MessageBuilder {
  constructor(private formatter: MessageFormatter, htmlBuilder?: HTMLBuilder) {
    super(htmlBuilder);
  }

  /**
   * Adds stats header
   */
  statsHeader(title: string, icon: string): StatsBuilder {
    this.header(title, icon);
    return this;
  }

  /**
   * Adds basic stats info
   */
  basicStats(totalViolations: number, averageSeverity: number, riskLevel?: string): StatsBuilder {
    const lines = this.formatter['formatBasicStatsInfo'](totalViolations, averageSeverity, riskLevel as any);
    this.section(lines.join('\n'));
    return this;
  }

  /**
   * Adds violations by article
   */
  violationsByArticle(violations: any[], title?: string): StatsBuilder {
    const lines = this.formatter['formatViolationsByArticle'](violations, title);
    if (lines.length > 0) {
      this.section(lines.join('\n'));
    }
    return this;
  }

  /**
   * Adds top violations
   */
  topViolations(violations: any[], limit: number = 5): StatsBuilder {
    const lines = this.formatter['formatTopViolations'](violations, limit);
    if (lines.length > 0) {
      this.section(lines.join('\n'));
    }
    return this;
  }

  /**
   * Adds top users
   */
  topUsers(users: any[], limit: number = 5): StatsBuilder {
    const lines = this.formatter['formatTopUsers'](users, limit);
    if (lines.length > 0) {
      this.section(lines.join('\n'));
    }
    return this;
  }

  /**
   * Adds critical violations
   */
  criticalViolations(violations: any[]): StatsBuilder {
    const lines = this.formatter['formatCriticalViolations'](violations);
    if (lines.length > 0) {
      this.section(lines.join('\n'));
    }
    return this;
  }

  /**
   * Adds period comparison
   */
  periodComparison(comparison: any): StatsBuilder {
    const lines = this.formatter['formatComparisonChanges'](comparison);
    if (lines.length > 0) {
      this.section(lines.join('\n'));
    }
    return this;
  }

  /**
   * Adds empty state message
   */
  emptyState(message: string): StatsBuilder {
    this.section(this.formatter['htmlBuilder'].italic(message));
    return this;
  }
}

// Import statistics models from the models directory
import {
  UserStats,
  PeriodStats,
  GeneralStats
} from './models/statistics';

/**
 * Interface for the MessageFormatter
 */
export interface IMessageFormatter {
  formatViolation(violation: Violation): string;
  formatViolationAnalysis(analysis: ViolationAnalysis): string;
  formatUserStats(stats: UserStats): string;
  formatPeriodStats(stats: PeriodStats): string;
  formatGeneralStats(stats: GeneralStats): string;
  getSeverityEmoji(severity: number): string;
  escapeHtml(text: string): string;
}

/**
 * MessageFormatter implementation
 */
export class MessageFormatter implements IMessageFormatter {
  private htmlBuilder: HTMLBuilder;

  constructor(htmlBuilder?: HTMLBuilder) {
    this.htmlBuilder = htmlBuilder || new HTMLBuilder();
  }

  /**
   * Gets emoji indicator for severity level (1-10)
   * 🟢 for low severity (1-3)
   * 🟡 for medium severity (4-6) 
   * 🔴 for high severity (7-10)
   */
  getSeverityEmoji(severity: number): string {
    return getSeverityEmoji(severity);
  }

  /**
   * Escapes HTML special characters
   */
  escapeHtml(text: string): string {
    return escapeHtml(text);
  }

  /**
   * Formats a single violation with full information
   */
  formatViolation(violation: Violation): string {
    const { article, subarticle, quote, punishment, severity, confidence } = violation;

    const severityEmoji = this.getSeverityEmoji(severity);
    const confidenceWarning = confidence < 0.7 ?
      '\n⚠️ ' + this.htmlBuilder.italic('Низкий уровень доверия к анализу') : '';

    // Format article with subarticle if present
    const fullArticle = formatFullArticle(article, subarticle);

    const lines = [
      `${severityEmoji} ${this.htmlBuilder.bold(`${formatArticleForDisplay(fullArticle)}`)}`,
      '',
      this.htmlBuilder.bold('Цитата из текста:'),
      this.htmlBuilder.italic(`"${quote}"`),
      '',
      this.htmlBuilder.bold('Наказание:'),
      punishment,
      '',
      `${this.htmlBuilder.bold('Уровень серьезности:')} ${severity}/10 ${severityEmoji}`,
      `${this.htmlBuilder.bold('Уровень доверия:')} ${Math.round(confidence * 100)}%`
    ];

    if (confidenceWarning) {
      lines.push(confidenceWarning);
    }

    return lines.join('\n');
  }

  /**
   * Formats complete violation analysis with multiple violations
   */
  formatViolationAnalysis(analysis: ViolationAnalysis): string {
    if (!analysis.hasViolations || analysis.violations.length === 0) {
      return '✅ ' + this.htmlBuilder.bold('Нарушений не обнаружено');
    }

    try {
      // Try builder pattern first
      return this.formatViolationAnalysisWithBuilder(analysis);
    } catch (builderError) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Builder pattern failed, trying template:', builderError);
      }
      
      try {
        // Fallback to template system
        const template = this.createViolationAnalysisTemplate(analysis);
        if (this.validateTemplate(template)) {
          return this.renderTemplate(template);
        }
      } catch (templateError) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template system failed:', templateError);
      }
      }
      
      // Final fallback to legacy implementation
      return this.formatViolationAnalysisLegacy(analysis);
    }
  }

  /**
   * Legacy violation analysis formatting (fallback)
   */
  private formatViolationAnalysisLegacy(analysis: ViolationAnalysis): string {
    const lines = [
      '🚨 ' + this.htmlBuilder.bold('Обнаружены нарушения УК РФ'),
      ''
    ];

    // Format each violation
    analysis.violations.forEach((violation, index) => {
      if (index > 0) {
        lines.push('', '━━━━━━━━━━━━━━━━━━━━', ''); // Separator between violations
      }
      lines.push(this.formatViolation(violation));
    });

    // Add summary information
    lines.push(
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      this.htmlBuilder.bold('Общая информация:'),
      `${this.htmlBuilder.bold('Всего нарушений:')} ${analysis.violations.length}`,
      `${this.htmlBuilder.bold('Общий уровень серьезности:')} ${analysis.totalSeverity}`,
      `${this.htmlBuilder.bold('Уровень риска:')} ${this.formatRiskLevel(analysis.riskLevel)}`
    );

    return lines.join('\n');
  }

  /**
   * Formats user statistics
   */
  formatUserStats(stats: UserStats): string {
    // Handle null/undefined stats
    if (!stats) {
      return '❌ ' + this.htmlBuilder.bold('Ошибка: данные статистики недоступны');
    }

    try {
      // Try builder pattern first
      return this.formatUserStatsWithBuilder(stats);
    } catch (builderError) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Builder pattern failed, trying template:', builderError);
      }
      
      try {
        // Fallback to template system
        const template = this.createUserStatsTemplate(stats);
        if (this.validateTemplate(template)) {
          return this.renderTemplate(template);
        }
      } catch (templateError) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template system failed:', templateError);
      }
      }
      
      // Final fallback to legacy implementation
      return this.formatUserStatsLegacy(stats);
    }
  }

  /**
   * Legacy user stats formatting (fallback)
   */
  private formatUserStatsLegacy(stats: UserStats): string {
    const lines = [
      this.formatStatsHeader('Статистика пользователя', '📊'),
      '',
      ...this.formatBasicStatsInfo(stats.totalViolations || 0, stats.averageSeverity || 0, stats.riskLevel || 'low')
    ];

    // Add last violation date if available
    if (stats.lastViolationDate) {
      const dateStr = this.formatDateSafely(stats.lastViolationDate);
      if (dateStr !== 'неизвестно') {
        lines.push(`${this.htmlBuilder.bold('Последнее нарушение:')} ${dateStr}`);
      }
    }

    lines.push('');

    // Add most common violation if available
    if (stats.mostCommonViolation) {
      lines.push(`${this.htmlBuilder.bold('Наиболее частое нарушение:')} ${stats.mostCommonViolation}`);
      lines.push('');
    }

    // Handle empty violations case
    if ((stats.totalViolations || 0) === 0) {
      lines.push(this.htmlBuilder.italic('У пользователя пока нет нарушений'));
      return lines.join('\n');
    }

    // Add violations by article
    lines.push(...this.formatViolationsByArticle(stats.violationsByArticle || []));

    return lines.join('\n');
  }

  /**
   * Formats period statistics with trends
   */
  formatPeriodStats(stats: PeriodStats): string {
    // Handle null/undefined stats
    if (!stats) {
      return '❌ ' + this.htmlBuilder.bold('Ошибка: данные статистики за период недоступны');
    }

    try {
      // Try builder pattern first
      return this.formatPeriodStatsWithBuilder(stats);
    } catch (builderError) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Builder pattern failed, trying template:', builderError);
      }
      
      try {
        // Fallback to template system
        const template = this.createPeriodStatsTemplate(stats);
        if (this.validateTemplate(template)) {
          return this.renderTemplate(template);
        }
      } catch (templateError) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template system failed:', templateError);
      }
      }
      
      // Final fallback to legacy implementation
      return this.formatPeriodStatsLegacy(stats);
    }
  }

  /**
   * Legacy period stats formatting (fallback)
   */
  private formatPeriodStatsLegacy(stats: PeriodStats): string {
    const lines = [
      this.formatStatsHeader('Статистика за период', '📈'),
      ''
    ];

    // Add period date range
    const startDateStr = this.formatDateSafely(stats.startDate);
    const endDateStr = this.formatDateSafely(stats.endDate);
    if (startDateStr !== 'неизвестно' && endDateStr !== 'неизвестно') {
      lines.push(`${this.htmlBuilder.bold('Период:')} ${startDateStr} - ${endDateStr}`);
    } else {
      lines.push(`${this.htmlBuilder.bold('Период:')} данные недоступны`);
    }

    // Add basic stats
    lines.push(
      `${this.htmlBuilder.bold('Всего нарушений:')} ${stats.totalViolations || 0}`,
      `${this.htmlBuilder.bold('Уникальных пользователей:')} ${stats.uniqueUsers || 0}`,
      `${this.htmlBuilder.bold('Средняя серьезность:')} ${(stats.averageSeverity || 0).toFixed(1)}/10`,
      ''
    );

    // Handle empty period case
    if ((stats.totalViolations || 0) === 0) {
      lines.push(this.htmlBuilder.italic('За указанный период нарушений не зафиксировано'));
      return lines.join('\n');
    }

    // Add comparison with previous period
    const comparisonLines = this.formatComparisonChanges(stats.comparisonWithPreviousPeriod);
    if (comparisonLines.length > 0) {
      lines.push(...comparisonLines);
    }

    // Add violations by article
    const violationLines = this.formatViolationsByArticle(stats.violationsByArticle || []);
    if (violationLines.length > 0) {
      lines.push('', ...violationLines);
    }

    return lines.join('\n');
  }

  /**
   * Formats general statistics with top violations and users
   */
  formatGeneralStats(stats: GeneralStats): string {
    // Handle null/undefined stats
    if (!stats) {
      return '❌ ' + this.htmlBuilder.bold('Ошибка: данные общей статистики недоступны');
    }

    try {
      // Try builder pattern first
      return this.formatGeneralStatsWithBuilder(stats);
    } catch (builderError) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Builder pattern failed, trying template:', builderError);
      }
      
      try {
        // Fallback to template system
        const template = this.createGeneralStatsTemplate(stats);
        if (this.validateTemplate(template)) {
          return this.renderTemplate(template);
        }
      } catch (templateError) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template system failed:', templateError);
      }
      }
      
      // Final fallback to legacy implementation
      return this.formatGeneralStatsLegacy(stats);
    }
  }

  /**
   * Legacy general stats formatting (fallback)
   */
  private formatGeneralStatsLegacy(stats: GeneralStats): string {
    const lines = [
      this.formatStatsHeader('Общая статистика чата', '📊'),
      '',
      ...this.formatBasicStatsInfo(stats.totalViolations || 0, stats.averageSeverity || 0),
      `${this.htmlBuilder.bold('Общий уровень риска:')} ${this.formatRiskLevel(stats.overallRiskLevel || 'low')}`,
      ''
    ];

    // Handle empty stats case
    if ((stats.totalViolations || 0) === 0) {
      lines.push(this.htmlBuilder.italic('В чате пока не зафиксировано нарушений'));
      return lines.join('\n');
    }

    // Add top violations
    const topViolationsLines = this.formatTopViolations(stats.topViolations || [], 5);
    if (topViolationsLines.length > 0) {
      lines.push(...topViolationsLines, '');
    }

    // Add top users
    const topUsersLines = this.formatTopUsers(stats.topUsers || [], 5);
    if (topUsersLines.length > 0) {
      lines.push(...topUsersLines, '');
    }

    // Add critical violations
    const criticalViolationsLines = this.formatCriticalViolations(stats.criticalViolations || []);
    if (criticalViolationsLines.length > 0) {
      lines.push(...criticalViolationsLines);
    }

    return lines.join('\n');
  }

  /**
   * Formats date safely with error handling
   */
  private formatDateSafely(date: Date | undefined, fallback: string = 'неизвестно'): string {
    if (!date) return fallback;
    try {
      return date.toLocaleDateString('ru-RU');
    } catch (dateError) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Invalid date:', dateError);
      }
      return fallback;
    }
  }

  /**
   * Formats stats header with icon and title
   */
  private formatStatsHeader(title: string, icon: string): string {
    return `${icon} ${this.htmlBuilder.bold(title)}`;
  }

  /**
   * Formats basic stats information (violations, severity, risk)
   */
  private formatBasicStatsInfo(totalViolations: number, averageSeverity: number, riskLevel?: 'low' | 'medium' | 'high'): string[] {
    const lines = [
      `${this.htmlBuilder.bold('Всего нарушений:')} ${totalViolations || 0}`,
      `${this.htmlBuilder.bold('Средняя серьезность:')} ${(averageSeverity || 0).toFixed(1)}/10`
    ];

    if (riskLevel) {
      lines.push(`${this.htmlBuilder.bold('Уровень риска:')} ${this.formatRiskLevel(riskLevel)}`);
    }

    return lines;
  }

  /**
   * Formats a single violation entry with emoji, title, and punishment
   */
  private formatSingleViolationEntry(violation: any): string[] {
    const lines: string[] = [];
    
    try {
      const severityEmoji = this.getSeverityEmoji(Math.floor(violation.averageSeverity || 1));
      const fullArticle = formatFullArticle(violation.article, violation.subarticle);
      lines.push(`• ${this.htmlBuilder.bold(`${formatArticleForDisplay(fullArticle)}`)} ${violation.count || 0} раз ${severityEmoji} (ср. ${(violation.averageSeverity || 0).toFixed(1)})`);
      
      if (violation.articleTitle) {
        lines.push(`  ${this.htmlBuilder.italic(violation.articleTitle)}`);
      }
      if (violation.punishment) {
        lines.push(`  ${this.htmlBuilder.bold('Наказание:')} ${violation.punishment}`);
      }
    } catch (emojiError) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Error formatting violation:', emojiError);
      }
      const fullArticle = formatFullArticle(violation.article, violation.subarticle);
      lines.push(`• ${this.htmlBuilder.bold(`${formatArticleForDisplay(fullArticle)}`)} ${violation.count || 0} раз (ср. ${(violation.averageSeverity || 0).toFixed(1)})`);
    }
    
    return lines;
  }

  /**
   * Formats violations by article list with sorting and filtering
   */
  private formatViolationsByArticle(violations: any[], title: string = 'Нарушения по статьям УК РФ:'): string[] {
    const lines: string[] = [];
    
    if (!violations || violations.length === 0) {
      return [this.htmlBuilder.italic('Детали нарушений недоступны')];
    }

    // Sort by count (descending) and filter out invalid entries
    const sortedViolations = [...violations]
      .filter(v => v && v.article && (v.count || 0) > 0)
      .sort((a, b) => (b.count || 0) - (a.count || 0));

    if (sortedViolations.length === 0) {
      return [this.htmlBuilder.italic('Детали нарушений недоступны')];
    }

    lines.push(this.htmlBuilder.bold(title));
    
    sortedViolations.forEach(violation => {
      lines.push(...this.formatSingleViolationEntry(violation));
    });

    return lines;
  }

  /**
   * Formats period comparison changes
   */
  private formatComparisonChanges(comparison: any): string[] {
    const lines: string[] = [];
    
    if (!comparison) return lines;

    const { violationsChange, severityChange, usersChange } = comparison;

    if (typeof violationsChange === 'number' && violationsChange !== 0) {
      const changeEmoji = violationsChange > 0 ? '📈' : '📉';
      const changeText = violationsChange > 0 ? 'увеличение' : 'уменьшение';
      lines.push(`${changeEmoji} ${this.htmlBuilder.bold('Изменение количества:')} ${changeText} на ${Math.abs(violationsChange).toFixed(1)}%`);
    }

    if (typeof severityChange === 'number' && severityChange !== 0) {
      const changeEmoji = severityChange > 0 ? '⬆️' : '⬇️';
      const changeText = severityChange > 0 ? 'повышение' : 'снижение';
      lines.push(`${changeEmoji} ${this.htmlBuilder.bold('Изменение серьезности:')} ${changeText} на ${Math.abs(severityChange).toFixed(1)}`);
    }

    if (typeof usersChange === 'number' && usersChange !== 0) {
      const changeEmoji = usersChange > 0 ? '👥📈' : '👥📉';
      const changeText = usersChange > 0 ? 'увеличение' : 'уменьшение';
      lines.push(`${changeEmoji} ${this.htmlBuilder.bold('Изменение пользователей:')} ${changeText} на ${Math.abs(usersChange).toFixed(1)}%`);
    }

    return lines;
  }

  /**
   * Formats top violations with position emojis
   */
  private formatTopViolations(violations: any[], limit: number = 5): string[] {
    const lines: string[] = [];
    
    if (!violations || violations.length === 0) {
      return [this.htmlBuilder.italic('Детали нарушений недоступны')];
    }

    const validViolations = violations
      .filter(v => v && v.article && (v.count || 0) > 0)
      .slice(0, limit);

    if (validViolations.length === 0) {
      return [this.htmlBuilder.italic('Детали нарушений недоступны')];
    }

    lines.push(this.htmlBuilder.bold('🏆 Топ-5 самых частых нарушений:'));

    validViolations.forEach((violation, index) => {
      try {
        const position = index + 1;
        const positionEmoji = this.getPositionEmoji(position);
        const severityEmoji = this.getSeverityEmoji(Math.floor(violation.averageSeverity || 1));
        const fullArticle = formatFullArticle(violation.article, violation.subarticle);

        lines.push(`${positionEmoji} ${this.htmlBuilder.bold(`${formatArticleForDisplay(fullArticle)}`)} ${violation.count || 0} раз ${severityEmoji} (ср. ${(violation.averageSeverity || 0).toFixed(1)})`);
        if (violation.articleTitle) {
          lines.push(`   ${this.htmlBuilder.italic(violation.articleTitle)}`);
        }
        if (violation.punishment) {
          lines.push(`   ${this.htmlBuilder.bold('Наказание:')} ${violation.punishment}`);
        }
      } catch (violationError) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Error formatting top violation:', violationError);
      }
        const fullArticle = formatFullArticle(violation.article, violation.subarticle);
        lines.push(`${index + 1}. ${this.htmlBuilder.bold(`${formatArticleForDisplay(fullArticle)}`)} ${violation.count || 0} раз`);
      }
    });

    return lines;
  }

  /**
   * Formats top users with usernames and risk levels
   */
  private formatTopUsers(users: any[], limit: number = 5): string[] {
    const lines: string[] = [];
    
    if (!users || users.length === 0) {
      return [this.htmlBuilder.italic('Данные о пользователях недоступны')];
    }

    const validUsers = users
      .filter(u => u && u.userId && (u.count || 0) > 0)
      .slice(0, limit);

    if (validUsers.length === 0) {
      return [this.htmlBuilder.italic('Данные о пользователях недоступны')];
    }

    lines.push(this.htmlBuilder.bold('👤 Топ-5 пользователей с наибольшим количеством нарушений:'));

    validUsers.forEach((user, index) => {
      try {
        const position = index + 1;
        const positionEmoji = this.getPositionEmoji(position);
        const riskEmoji = this.formatRiskLevel(user.riskLevel || 'low');
        const username = user.username ? `@${user.username}` : `ID: ${user.userId}`;

        const count = user.count || 0;
        const violationsText = count === 1 ? 'нарушение' :
          count < 5 ? 'нарушения' : 'нарушений';
        lines.push(`${positionEmoji} ${this.htmlBuilder.bold(username)}: ${count} ${violationsText}, риск: ${riskEmoji} (ср. ${(user.averageSeverity || 0).toFixed(1)})`);
      } catch (userError) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Error formatting top user:', userError);
      }
        const username = user.username ? `@${user.username}` : `ID: ${user.userId}`;
        lines.push(`${index + 1}. ${this.htmlBuilder.bold(username)}: ${user.count || 0} нарушений`);
      }
    });

    return lines;
  }

  /**
   * Formats critical violations with quote truncation
   */
  private formatCriticalViolations(violations: any[]): string[] {
    const lines: string[] = [];
    
    if (!violations || violations.length === 0) {
      return [];
    }

    const validCriticalViolations = violations
      .filter(v => v && v.article && (v.severity || 0) >= 8);

    if (validCriticalViolations.length === 0) {
      return [this.htmlBuilder.italic('Критические нарушения не найдены')];
    }

    lines.push('🚨 ' + this.htmlBuilder.bold('Критические нарушения (серьезность ≥ 8):'));

    validCriticalViolations.forEach((violation) => {
      try {
        const severityEmoji = this.getSeverityEmoji(violation.severity || 8);
        lines.push(`${severityEmoji} ${this.htmlBuilder.bold(`${formatArticleForDisplay(violation.article)}`)} серьезность ${violation.severity || 8}/10`);

        const quote = violation.quote || 'Цитата недоступна';
        const truncatedQuote = quote.length > 100 ?
          quote.substring(0, 100) + '...' :
          quote;
        lines.push(`   ${this.htmlBuilder.italic(`"${this.escapeHtml(truncatedQuote)}"`)}`)
      } catch (criticalError) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Error formatting critical violation:', criticalError);
      }
        lines.push(`🔴 ${this.htmlBuilder.bold(`${formatArticleForDisplay(violation.article)}`)} серьезность ${violation.severity || 8}/10`);
      }
    });

    return lines;
  }

  /**
   * Formats risk level with appropriate emoji
   */
  private formatRiskLevel(riskLevel: 'low' | 'medium' | 'high'): string {
    switch (riskLevel) {
      case 'low':
        return '🟢 Низкий';
      case 'medium':
        return '🟡 Средний';
      case 'high':
        return '🔴 Высокий';
      default:
        return '❓ Неопределенный';
    }
  }

  /**
   * Gets position emoji for top rankings
   */
  private getPositionEmoji(position: number): string {
    switch (position) {
      case 1:
        return '🥇';
      case 2:
        return '🥈';
      case 3:
        return '🥉';
      default:
        return `${position}.`;
    }
  }

  /**
   * Creates a message template for violation analysis
   */
  private createViolationAnalysisTemplate(analysis: ViolationAnalysis): MessageTemplate {
    return {
      header: analysis.hasViolations ? 
        '🚨 ' + this.htmlBuilder.bold('Обнаружены нарушения УК РФ') :
        '✅ ' + this.htmlBuilder.bold('Нарушений не обнаружено'),
      sections: [
        {
          content: () => this.renderViolationsList(analysis.violations),
          condition: () => analysis.hasViolations && analysis.violations.length > 0
        },
        {
          content: () => this.renderViolationSummary(analysis),
          condition: () => analysis.hasViolations,
          separator: '━━━━━━━━━━━━━━━━━━━━'
        }
      ]
    };
  }

  /**
   * Creates a message template for user statistics
   */
  private createUserStatsTemplate(stats: UserStats): MessageTemplate {
    return {
      header: this.formatStatsHeader('Статистика пользователя', '📊'),
      sections: [
        {
          content: () => this.formatBasicStatsInfo(
            stats.totalViolations || 0, 
            stats.averageSeverity || 0, 
            stats.riskLevel || 'low'
          ).join('\n')
        },
        {
          content: () => this.renderUserAdditionalInfo(stats),
          condition: () => !!(stats.lastViolationDate || stats.mostCommonViolation)
        },
        {
          content: () => stats.totalViolations === 0 ? 
            this.htmlBuilder.italic('У пользователя пока нет нарушений') :
            this.formatViolationsByArticle(stats.violationsByArticle || []).join('\n'),
          condition: () => true
        }
      ]
    };
  }

  /**
   * Creates a message template for period statistics
   */
  private createPeriodStatsTemplate(stats: PeriodStats): MessageTemplate {
    return {
      header: this.formatStatsHeader('Статистика за период', '📈'),
      sections: [
        {
          content: () => this.renderPeriodInfo(stats)
        },
        {
          content: () => this.formatComparisonChanges(stats.comparisonWithPreviousPeriod).join('\n'),
          condition: () => !!(stats.comparisonWithPreviousPeriod && (stats.totalViolations || 0) > 0)
        },
        {
          content: () => (stats.totalViolations || 0) === 0 ?
            this.htmlBuilder.italic('За указанный период нарушений не зафиксировано') :
            this.formatViolationsByArticle(stats.violationsByArticle || []).join('\n'),
          condition: () => true
        }
      ]
    };
  }

  /**
   * Creates a message template for general statistics
   */
  private createGeneralStatsTemplate(stats: GeneralStats): MessageTemplate {
    return {
      header: this.formatStatsHeader('Общая статистика чата', '📊'),
      sections: [
        {
          content: () => [
            ...this.formatBasicStatsInfo(stats.totalViolations || 0, stats.averageSeverity || 0),
            `${this.htmlBuilder.bold('Общий уровень риска:')} ${this.formatRiskLevel(stats.overallRiskLevel || 'low')}`
          ].join('\n')
        },
        {
          content: () => (stats.totalViolations || 0) === 0 ?
            this.htmlBuilder.italic('В чате пока не зафиксировано нарушений') :
            [
              this.formatTopViolations(stats.topViolations || [], 5).join('\n'),
              this.formatTopUsers(stats.topUsers || [], 5).join('\n'),
              this.formatCriticalViolations(stats.criticalViolations || []).join('\n')
            ].filter(section => section.trim()).join('\n\n'),
          condition: () => true
        }
      ]
    };
  }

  /**
   * Renders a message template to string
   */
  private renderTemplate(template: MessageTemplate): string {
    const lines: string[] = [];
    
    // Add header
    lines.push(template.header, '');
    
    // Add sections
    template.sections.forEach((section, index) => {
      // Check condition if present
      if (section.condition && !section.condition()) {
        return;
      }
      
      // Add separator if specified and not first section
      if (section.separator && index > 0) {
        lines.push('', section.separator, '');
      }
      
      // Add section title if present
      if (section.title) {
        lines.push(section.title);
      }
      
      // Add section content
      const content = typeof section.content === 'function' ? section.content() : section.content;
      if (content.trim()) {
        lines.push(content);
        lines.push(''); // Add spacing after section
      }
    });
    
    // Add footer if present
    if (template.footer) {
      lines.push(template.footer);
    }
    
    // Clean up extra empty lines at the end
    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    
    return lines.join('\n');
  }

  /**
   * Renders violations list for template
   */
  private renderViolationsList(violations: Violation[]): string {
    const lines: string[] = [];
    
    violations.forEach((violation, index) => {
      if (index > 0) {
        lines.push('', '━━━━━━━━━━━━━━━━━━━━', '');
      }
      lines.push(this.formatViolation(violation));
    });
    
    return lines.join('\n');
  }

  /**
   * Renders violation summary for template
   */
  private renderViolationSummary(analysis: ViolationAnalysis): string {
    return [
      this.htmlBuilder.bold('Общая информация:'),
      `${this.htmlBuilder.bold('Всего нарушений:')} ${analysis.violations.length}`,
      `${this.htmlBuilder.bold('Общий уровень серьезности:')} ${analysis.totalSeverity}`,
      `${this.htmlBuilder.bold('Уровень риска:')} ${this.formatRiskLevel(analysis.riskLevel)}`
    ].join('\n');
  }

  /**
   * Renders user additional info for template
   */
  private renderUserAdditionalInfo(stats: UserStats): string {
    const lines: string[] = [];
    
    if (stats.lastViolationDate) {
      const dateStr = this.formatDateSafely(stats.lastViolationDate);
      if (dateStr !== 'неизвестно') {
        lines.push(`${this.htmlBuilder.bold('Последнее нарушение:')} ${dateStr}`);
      }
    }
    
    if (stats.mostCommonViolation) {
      lines.push(`${this.htmlBuilder.bold('Наиболее частое нарушение:')} ${stats.mostCommonViolation}`);
    }
    
    return lines.join('\n');
  }

  /**
   * Renders period info for template
   */
  private renderPeriodInfo(stats: PeriodStats): string {
    const lines: string[] = [];
    
    // Add period date range
    const startDateStr = this.formatDateSafely(stats.startDate);
    const endDateStr = this.formatDateSafely(stats.endDate);
    if (startDateStr !== 'неизвестно' && endDateStr !== 'неизвестно') {
      lines.push(`${this.htmlBuilder.bold('Период:')} ${startDateStr} - ${endDateStr}`);
    } else {
      lines.push(`${this.htmlBuilder.bold('Период:')} данные недоступны`);
    }
    
    // Add basic stats
    lines.push(
      `${this.htmlBuilder.bold('Всего нарушений:')} ${stats.totalViolations || 0}`,
      `${this.htmlBuilder.bold('Уникальных пользователей:')} ${stats.uniqueUsers || 0}`,
      `${this.htmlBuilder.bold('Средняя серьезность:')} ${(stats.averageSeverity || 0).toFixed(1)}/10`
    );
    
    return lines.join('\n');
  }

  /**
   * Validates a message template
   */
  private validateTemplate(template: MessageTemplate): boolean {
    try {
      // Check required fields
      if (!template.header) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template missing header');
      }
        return false;
      }
      
      if (!template.sections || !Array.isArray(template.sections)) {
        if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template missing or invalid sections');
      }
        return false;
      }
      
      // Validate each section
      for (const section of template.sections) {
        if (!section.content) {
          if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template section missing content');
      }
          return false;
        }
      }
      
      return true;
    } catch (error: unknown) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('⚠️ Template validation error:', error);
      }
      return false;
    }
  }

  /**
   * Creates a new message builder
   */
  createBuilder(): MessageBuilder {
    return new MessageBuilder(this.htmlBuilder);
  }

  /**
   * Creates a violation analysis builder
   */
  createViolationAnalysisBuilder(): ViolationAnalysisBuilder {
    return new ViolationAnalysisBuilder(this, this.htmlBuilder);
  }

  /**
   * Creates a stats builder
   */
  createStatsBuilder(): StatsBuilder {
    return new StatsBuilder(this, this.htmlBuilder);
  }

  /**
   * Formats violation analysis using builder pattern
   */
  private formatViolationAnalysisWithBuilder(analysis: ViolationAnalysis): string {
    const builder = this.createViolationAnalysisBuilder();
    
    return builder
      .violationHeader(analysis.hasViolations)
      .when(analysis.hasViolations && analysis.violations.length > 0, b => 
        b.violationsList(analysis.violations)
         .violationSummary(analysis)
      )
      .build();
  }

  /**
   * Formats user stats using builder pattern
   */
  private formatUserStatsWithBuilder(stats: UserStats): string {
    const builder = this.createStatsBuilder();
    
    return builder
      .statsHeader('Статистика пользователя', '📊')
      .basicStats(stats.totalViolations || 0, stats.averageSeverity || 0, stats.riskLevel || 'low')
      .when(!!(stats.lastViolationDate || stats.mostCommonViolation), b => {
        const additionalInfo = this.renderUserAdditionalInfo(stats);
        if (additionalInfo.trim()) {
          b.section(additionalInfo);
        }
        return b;
      })
      .when((stats.totalViolations || 0) === 0, b => 
        b.emptyState('У пользователя пока нет нарушений')
      )
      .when((stats.totalViolations || 0) > 0, b => 
        b.violationsByArticle(stats.violationsByArticle || [])
      )
      .build();
  }

  /**
   * Formats period stats using builder pattern
   */
  private formatPeriodStatsWithBuilder(stats: PeriodStats): string {
    const builder = this.createStatsBuilder();
    
    return builder
      .statsHeader('Статистика за период', '📈')
      .section(this.renderPeriodInfo(stats))
      .when(!!(stats.comparisonWithPreviousPeriod && (stats.totalViolations || 0) > 0), b => 
        b.periodComparison(stats.comparisonWithPreviousPeriod)
      )
      .when((stats.totalViolations || 0) === 0, b => 
        b.emptyState('За указанный период нарушений не зафиксировано')
      )
      .when((stats.totalViolations || 0) > 0, b => 
        b.violationsByArticle(stats.violationsByArticle || [])
      )
      .build();
  }

  /**
   * Formats general stats using builder pattern
   */
  private formatGeneralStatsWithBuilder(stats: GeneralStats): string {
    const builder = this.createStatsBuilder();
    
    return builder
      .statsHeader('Общая статистика чата', '📊')
      .basicStats(stats.totalViolations || 0, stats.averageSeverity || 0)
      .section(`${this.htmlBuilder.bold('Общий уровень риска:')} ${this.formatRiskLevel(stats.overallRiskLevel || 'low')}`)
      .when((stats.totalViolations || 0) === 0, b => 
        b.emptyState('В чате пока не зафиксировано нарушений')
      )
      .when((stats.totalViolations || 0) > 0, b => 
        b.topViolations(stats.topViolations || [], 5)
         .topUsers(stats.topUsers || [], 5)
         .criticalViolations(stats.criticalViolations || [])
      )
      .build();
  }
}

// Export a default instance for convenience
export const messageFormatter = new MessageFormatter();