/**
 * MessageFormatter - Formats violation messages and statistics for Telegram display
 * 
 * This class handles the formatting of violation analysis data into user-friendly
 * HTML messages that comply with Telegram's formatting requirements.
 */

import { HTMLBuilder, htmlBuilder } from './html-builder';
import { getSeverityEmoji, escapeHtml } from './html-utils';

/**
 * Represents a single violation from the analysis
 */
export interface Violation {
  article: string;
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
 * User statistics data
 */
export interface UserStats {
  userId: string;
  chatId: string;
  totalViolations: number;
  violationsByArticle: Map<string, number>;
  averageSeverity: number;
  riskLevel: 'low' | 'medium' | 'high';
  lastViolationDate: Date;
  mostCommonViolation: string;
}

/**
 * Period statistics data
 */
export interface PeriodStats {
  chatId: string;
  startDate: Date;
  endDate: Date;
  totalViolations: number;
  violationsByArticle: Map<string, number>;
  averageSeverity: number;
  uniqueUsers: number;
  comparisonWithPreviousPeriod: {
    violationsChange: number;
    severityChange: number;
  };
}

/**
 * Interface for the MessageFormatter
 */
export interface IMessageFormatter {
  formatViolation(violation: Violation): string;
  formatViolationAnalysis(analysis: ViolationAnalysis): string;
  formatUserStats(stats: UserStats): string;
  formatPeriodStats(stats: PeriodStats): string;
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
    const { article, quote, punishment, severity, confidence } = violation;
    
    const severityEmoji = this.getSeverityEmoji(severity);
    const confidenceWarning = confidence < 0.7 ? 
      '\n⚠️ ' + this.htmlBuilder.italic('Низкий уровень доверия к анализу') : '';
    
    const lines = [
      `${severityEmoji} ${this.htmlBuilder.bold(`Статья ${article} УК РФ`)}`,
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
    const lines = [
      '📊 ' + this.htmlBuilder.bold('Статистика пользователя'),
      '',
      `${this.htmlBuilder.bold('Всего нарушений:')} ${stats.totalViolations}`,
      `${this.htmlBuilder.bold('Средняя серьезность:')} ${stats.averageSeverity.toFixed(1)}/10`,
      `${this.htmlBuilder.bold('Уровень риска:')} ${this.formatRiskLevel(stats.riskLevel)}`,
      `${this.htmlBuilder.bold('Последнее нарушение:')} ${stats.lastViolationDate.toLocaleDateString('ru-RU')}`,
      ''
    ];

    if (stats.mostCommonViolation) {
      lines.push(`${this.htmlBuilder.bold('Наиболее частое нарушение:')} ${stats.mostCommonViolation}`);
      lines.push('');
    }

    // Group violations by article
    if (stats.violationsByArticle.size > 0) {
      lines.push(this.htmlBuilder.bold('Нарушения по статьям УК РФ:'));
      
      // Convert Map to array and sort by count (descending)
      const sortedViolations = Array.from(stats.violationsByArticle.entries())
        .sort(([, a], [, b]) => b - a);
      
      sortedViolations.forEach(([article, count]) => {
        lines.push(`• ${this.htmlBuilder.bold(`Статья ${article}:`)} ${count} раз`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Formats period statistics with trends
   */
  formatPeriodStats(stats: PeriodStats): string {
    const lines = [
      '📈 ' + this.htmlBuilder.bold('Статистика за период'),
      '',
      `${this.htmlBuilder.bold('Период:')} ${stats.startDate.toLocaleDateString('ru-RU')} - ${stats.endDate.toLocaleDateString('ru-RU')}`,
      `${this.htmlBuilder.bold('Всего нарушений:')} ${stats.totalViolations}`,
      `${this.htmlBuilder.bold('Уникальных пользователей:')} ${stats.uniqueUsers}`,
      `${this.htmlBuilder.bold('Средняя серьезность:')} ${stats.averageSeverity.toFixed(1)}/10`,
      ''
    ];

    // Add comparison with previous period
    const { violationsChange, severityChange } = stats.comparisonWithPreviousPeriod;
    
    if (violationsChange !== 0) {
      const changeEmoji = violationsChange > 0 ? '📈' : '📉';
      const changeText = violationsChange > 0 ? 'увеличение' : 'уменьшение';
      lines.push(`${changeEmoji} ${this.htmlBuilder.bold('Изменение количества:')} ${changeText} на ${Math.abs(violationsChange)}`);
    }

    if (severityChange !== 0) {
      const changeEmoji = severityChange > 0 ? '⬆️' : '⬇️';
      const changeText = severityChange > 0 ? 'повышение' : 'снижение';
      lines.push(`${changeEmoji} ${this.htmlBuilder.bold('Изменение серьезности:')} ${changeText} на ${Math.abs(severityChange).toFixed(1)}`);
    }

    // Group violations by article
    if (stats.violationsByArticle.size > 0) {
      lines.push('', this.htmlBuilder.bold('Нарушения по статьям УК РФ:'));
      
      // Convert Map to array and sort by count (descending)
      const sortedViolations = Array.from(stats.violationsByArticle.entries())
        .sort(([, a], [, b]) => b - a);
      
      sortedViolations.forEach(([article, count]) => {
        lines.push(`• ${this.htmlBuilder.bold(`Статья ${article}:`)} ${count} раз`);
      });
    }

    return lines.join('\n');
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
}

// Export a default instance for convenience
export const messageFormatter = new MessageFormatter();