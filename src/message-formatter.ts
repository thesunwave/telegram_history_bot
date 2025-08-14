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

// Import statistics models from the models directory
import { 
  UserStats, 
  PeriodStats, 
  GeneralStats, 
  ViolationCount, 
  UserViolationCount 
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
    // Handle null/undefined stats
    if (!stats) {
      return '❌ ' + this.htmlBuilder.bold('Ошибка: данные статистики недоступны');
    }

    const lines = [
      '📊 ' + this.htmlBuilder.bold('Статистика пользователя'),
      '',
      `${this.htmlBuilder.bold('Всего нарушений:')} ${stats.totalViolations || 0}`,
      `${this.htmlBuilder.bold('Средняя серьезность:')} ${(stats.averageSeverity || 0).toFixed(1)}/10`,
      `${this.htmlBuilder.bold('Уровень риска:')} ${this.formatRiskLevel(stats.riskLevel || 'low')}`
    ];

    if (stats.lastViolationDate) {
      try {
        lines.push(`${this.htmlBuilder.bold('Последнее нарушение:')} ${stats.lastViolationDate.toLocaleDateString('ru-RU')}`);
      } catch (dateError) {
        console.warn('⚠️ Invalid lastViolationDate:', dateError);
      }
    }

    lines.push('');

    if (stats.mostCommonViolation) {
      lines.push(`${this.htmlBuilder.bold('Наиболее частое нарушение:')} ${stats.mostCommonViolation}`);
      lines.push('');
    }

    // Handle empty violations case
    if (stats.totalViolations === 0) {
      lines.push(this.htmlBuilder.italic('У пользователя пока нет нарушений'));
      return lines.join('\n');
    }

    // Group violations by article
    if (stats.violationsByArticle && stats.violationsByArticle.length > 0) {
      lines.push(this.htmlBuilder.bold('Нарушения по статьям УК РФ:'));
      
      // Sort by count (descending)
      const sortedViolations = [...stats.violationsByArticle]
        .filter(v => v && v.article && v.count > 0) // Filter out invalid entries
        .sort((a, b) => (b.count || 0) - (a.count || 0));
      
      if (sortedViolations.length > 0) {
        sortedViolations.forEach(({ article, count, averageSeverity }) => {
          try {
            const severityEmoji = this.getSeverityEmoji(Math.floor(averageSeverity || 1));
            lines.push(`• ${this.htmlBuilder.bold(`Статья ${article}:`)} ${count} раз ${severityEmoji} (ср. ${(averageSeverity || 0).toFixed(1)})`);
          } catch (emojiError) {
            console.warn('⚠️ Error formatting violation:', emojiError);
            lines.push(`• ${this.htmlBuilder.bold(`Статья ${article}:`)} ${count} раз (ср. ${(averageSeverity || 0).toFixed(1)})`);
          }
        });
      } else {
        lines.push(this.htmlBuilder.italic('Детали нарушений недоступны'));
      }
    } else {
      lines.push(this.htmlBuilder.italic('Детали нарушений недоступны'));
    }

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

    const lines = [
      '📈 ' + this.htmlBuilder.bold('Статистика за период'),
      ''
    ];

    // Safe date formatting
    try {
      const startDateStr = stats.startDate ? stats.startDate.toLocaleDateString('ru-RU') : 'неизвестно';
      const endDateStr = stats.endDate ? stats.endDate.toLocaleDateString('ru-RU') : 'неизвестно';
      lines.push(`${this.htmlBuilder.bold('Период:')} ${startDateStr} - ${endDateStr}`);
    } catch (dateError) {
      console.warn('⚠️ Error formatting period dates:', dateError);
      lines.push(`${this.htmlBuilder.bold('Период:')} данные недоступны`);
    }

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
    if (stats.comparisonWithPreviousPeriod) {
      const { violationsChange, severityChange, usersChange } = stats.comparisonWithPreviousPeriod;
      
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
    }

    // Group violations by article
    if (stats.violationsByArticle && stats.violationsByArticle.length > 0) {
      lines.push('', this.htmlBuilder.bold('Нарушения по статьям УК РФ:'));
      
      // Sort by count (descending) and filter out invalid entries
      const sortedViolations = [...stats.violationsByArticle]
        .filter(v => v && v.article && (v.count || 0) > 0)
        .sort((a, b) => (b.count || 0) - (a.count || 0));
      
      if (sortedViolations.length > 0) {
        sortedViolations.forEach(({ article, count, averageSeverity }) => {
          try {
            const severityEmoji = this.getSeverityEmoji(Math.floor(averageSeverity || 1));
            lines.push(`• ${this.htmlBuilder.bold(`Статья ${article}:`)} ${count || 0} раз ${severityEmoji} (ср. ${(averageSeverity || 0).toFixed(1)})`);
          } catch (emojiError) {
            console.warn('⚠️ Error formatting period violation:', emojiError);
            lines.push(`• ${this.htmlBuilder.bold(`Статья ${article}:`)} ${count || 0} раз (ср. ${(averageSeverity || 0).toFixed(1)})`);
          }
        });
      } else {
        lines.push(this.htmlBuilder.italic('Детали нарушений недоступны'));
      }
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

    const lines = [
      '📊 ' + this.htmlBuilder.bold('Общая статистика чата'),
      '',
      `${this.htmlBuilder.bold('Всего нарушений:')} ${stats.totalViolations || 0}`,
      `${this.htmlBuilder.bold('Средняя серьезность:')} ${(stats.averageSeverity || 0).toFixed(1)}/10`,
      `${this.htmlBuilder.bold('Общий уровень риска:')} ${this.formatRiskLevel(stats.overallRiskLevel || 'low')}`,
      ''
    ];

    // Handle empty stats case
    if ((stats.totalViolations || 0) === 0) {
      lines.push(this.htmlBuilder.italic('В чате пока не зафиксировано нарушений'));
      return lines.join('\n');
    }

    // Top 5 violations
    if (stats.topViolations && stats.topViolations.length > 0) {
      lines.push(this.htmlBuilder.bold('🏆 Топ-5 самых частых нарушений:'));
      
      const validViolations = stats.topViolations
        .filter(v => v && v.article && (v.count || 0) > 0)
        .slice(0, 5);
      
      if (validViolations.length > 0) {
        validViolations.forEach((violation, index) => {
          try {
            const position = index + 1;
            const positionEmoji = this.getPositionEmoji(position);
            const severityEmoji = this.getSeverityEmoji(Math.floor(violation.averageSeverity || 1));
            
            lines.push(`${positionEmoji} ${this.htmlBuilder.bold(`Статья ${violation.article}:`)} ${violation.count || 0} раз ${severityEmoji} (ср. ${(violation.averageSeverity || 0).toFixed(1)})`);
          } catch (violationError) {
            console.warn('⚠️ Error formatting top violation:', violationError);
            lines.push(`${index + 1}. ${this.htmlBuilder.bold(`Статья ${violation.article}:`)} ${violation.count || 0} раз`);
          }
        });
      } else {
        lines.push(this.htmlBuilder.italic('Детали нарушений недоступны'));
      }
      
      lines.push('');
    }

    // Top 5 users
    if (stats.topUsers && stats.topUsers.length > 0) {
      lines.push(this.htmlBuilder.bold('👤 Топ-5 пользователей с наибольшим количеством нарушений:'));
      
      const validUsers = stats.topUsers
        .filter(u => u && u.userId && (u.count || 0) > 0)
        .slice(0, 5);
      
      if (validUsers.length > 0) {
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
            console.warn('⚠️ Error formatting top user:', userError);
            const username = user.username ? `@${user.username}` : `ID: ${user.userId}`;
            lines.push(`${index + 1}. ${this.htmlBuilder.bold(username)}: ${user.count || 0} нарушений`);
          }
        });
      } else {
        lines.push(this.htmlBuilder.italic('Данные о пользователях недоступны'));
      }
      
      lines.push('');
    }

    // Critical violations (severity >= 8)
    if (stats.criticalViolations && stats.criticalViolations.length > 0) {
      lines.push('🚨 ' + this.htmlBuilder.bold('Критические нарушения (серьезность ≥ 8):'));
      
      const validCriticalViolations = stats.criticalViolations
        .filter(v => v && v.article && (v.severity || 0) >= 8);
      
      if (validCriticalViolations.length > 0) {
        validCriticalViolations.forEach((violation) => {
          try {
            const severityEmoji = this.getSeverityEmoji(violation.severity || 8);
            lines.push(`${severityEmoji} ${this.htmlBuilder.bold(`Статья ${violation.article}:`)} серьезность ${violation.severity || 8}/10`);
            
            const quote = violation.quote || 'Цитата недоступна';
            const truncatedQuote = quote.length > 100 ? 
              quote.substring(0, 100) + '...' : 
              quote;
            lines.push(`   ${this.htmlBuilder.italic(`"${this.escapeHtml(truncatedQuote)}"`)}`)
          } catch (criticalError) {
            console.warn('⚠️ Error formatting critical violation:', criticalError);
            lines.push(`🔴 ${this.htmlBuilder.bold(`Статья ${violation.article}:`)} серьезность ${violation.severity || 8}/10`);
          }
        });
      } else {
        lines.push(this.htmlBuilder.italic('Критические нарушения не найдены'));
      }
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
}

// Export a default instance for convenience
export const messageFormatter = new MessageFormatter();