/**
 * Специальные тесты для проверки новых полей articleTitle и punishment в ViolationCount
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFormatter } from '../src/core/message-formatter';
import { UserStats, PeriodStats, GeneralStats } from '../src/models/statistics';

describe('ViolationCount Fields Test', () => {
  let formatter: MessageFormatter;

  beforeEach(() => {
    formatter = new MessageFormatter();
  });

  describe('articleTitle and punishment fields', () => {
    it('should display articleTitle and punishment in user stats', () => {
      const userStats: UserStats = {
        userId: 'test-user',
        chatId: 'test-chat',
        totalViolations: 2,
        violationsByArticle: [
          {
            article: '282',
            subarticle: null,
            articleTitle: 'Возбуждение ненависти либо вражды',
            punishment: 'штраф в размере до трехсот тысяч рублей или лишение свободы на срок до двух лет',
            count: 1,
            averageSeverity: 6.5
          },
          {
            article: '205',
            subarticle: '1',
            articleTitle: 'Терроризм',
            punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
            count: 1,
            averageSeverity: 9.0
          }
        ],
        averageSeverity: 7.75,
        riskLevel: 'high'
      };

      const result = formatter.formatUserStats(userStats);

      // Проверяем, что отображаются названия статей
      expect(result).toContain('<i>Возбуждение ненависти либо вражды</i>');
      expect(result).toContain('<i>Терроризм</i>');

      // Проверяем, что отображаются наказания
      expect(result).toContain('<b>Наказание:</b> штраф в размере до трехсот тысяч рублей; лишение свободы');
      expect(result).toContain('<b>Срок:</b> на срок до двух лет');
      expect(result).toContain('<b>Срок:</b> на срок от восьми до пятнадцати лет');
    });

    it('should display articleTitle and punishment in period stats', () => {
      const periodStats: PeriodStats = {
        chatId: 'test-chat',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        totalViolations: 3,
        violationsByArticle: [
          {
            article: '228',
            subarticle: '1',
            articleTitle: 'Незаконные приобретение, хранение, перевозка наркотических средств',
            punishment: 'лишение свободы на срок до трех лет',
            count: 2,
            averageSeverity: 7.0
          },
          {
            article: '159',
            subarticle: null,
            articleTitle: 'Мошенничество',
            punishment: 'штраф в размере до ста двадцати тысяч рублей',
            count: 1,
            averageSeverity: 5.0
          }
        ],
        averageSeverity: 6.33,
        uniqueUsers: 2
      };

      const result = formatter.formatPeriodStats(periodStats);

      // Проверяем, что отображаются названия статей
      expect(result).toContain('<i>Незаконные приобретение, хранение, перевозка наркотических средств</i>');
      expect(result).toContain('<i>Мошенничество</i>');

      // Проверяем, что отображаются наказания
      expect(result).toContain('<b>Наказание:</b> лишение свободы');
      expect(result).toContain('<b>Срок:</b> на срок до трех лет');
      expect(result).toContain('<b>Наказание:</b> штраф в размере до ста двадцати тысяч рублей');
    });

    it('should display articleTitle and punishment in general stats', () => {
      const generalStats: GeneralStats = {
        chatId: 'test-chat',
        totalViolations: 10,
        topViolations: [
          {
            article: '130',
            subarticle: null,
            articleTitle: 'Оскорбление',
            punishment: 'штраф в размере до сорока тысяч рублей',
            count: 5,
            averageSeverity: 4.0
          },
          {
            article: '319',
            subarticle: '1',
            articleTitle: 'Оскорбление представителя власти',
            punishment: 'штраф в размере до сорока тысяч рублей или обязательные работы на срок до ста двадцати часов',
            count: 3,
            averageSeverity: 5.5
          }
        ],
        topUsers: [],
        overallRiskLevel: 'medium',
        averageSeverity: 4.6,
        criticalViolations: []
      };

      const result = formatter.formatGeneralStats(generalStats);

      // Проверяем, что отображаются названия статей
      expect(result).toContain('<i>Оскорбление</i>');
      expect(result).toContain('<i>Оскорбление представителя власти</i>');

      // Проверяем, что отображаются наказания
      expect(result).toContain('<b>Наказание:</b> штраф в размере до сорока тысяч рублей');
      expect(result).toContain('<b>Наказание:</b> штраф в размере до сорока тысяч рублей; обязательные работы');
      expect(result).toContain('<b>Срок:</b> на срок до ста двадцати часов');
    });

    it('should handle missing articleTitle gracefully', () => {
      const userStats: UserStats = {
        userId: 'test-user',
        chatId: 'test-chat',
        totalViolations: 1,
        violationsByArticle: [
          {
            article: '282',
            subarticle: null,
            articleTitle: '', // Пустое название
            punishment: 'штраф в размере до трехсот тысяч рублей',
            count: 1,
            averageSeverity: 6.5
          }
        ],
        averageSeverity: 6.5,
        riskLevel: 'medium'
      };

      const result = formatter.formatUserStats(userStats);

      // Проверяем, что пустое название не отображается
      expect(result).not.toContain('<i></i>');
      // Но наказание должно отображаться
      expect(result).toContain('<b>Наказание:</b> штраф в размере до трехсот тысяч рублей');
    });

    it('should handle missing punishment gracefully', () => {
      const userStats: UserStats = {
        userId: 'test-user',
        chatId: 'test-chat',
        totalViolations: 1,
        violationsByArticle: [
          {
            article: '282',
            subarticle: null,
            articleTitle: 'Возбуждение ненависти либо вражды',
            punishment: '', // Пустое наказание
            count: 1,
            averageSeverity: 6.5
          }
        ],
        averageSeverity: 6.5,
        riskLevel: 'medium'
      };

      const result = formatter.formatUserStats(userStats);

      // Проверяем, что название отображается
      expect(result).toContain('<i>Возбуждение ненависти либо вражды</i>');
      // Но пустое наказание не отображается
      expect(result).not.toContain('<b>Наказание:</b> ');
    });

    it('should handle both missing articleTitle and punishment', () => {
      const userStats: UserStats = {
        userId: 'test-user',
        chatId: 'test-chat',
        totalViolations: 1,
        violationsByArticle: [
          {
            article: '282',
            subarticle: null,
            articleTitle: '', // Пустое название
            punishment: '', // Пустое наказание
            count: 1,
            averageSeverity: 6.5
          }
        ],
        averageSeverity: 6.5,
        riskLevel: 'medium'
      };

      const result = formatter.formatUserStats(userStats);

      // Проверяем, что основная информация о статье все еще отображается
      expect(result).toContain('• <b>Статья 282 УК РФ</b> 1 раз 🟡 (ср. 6.5)');
      // Но дополнительные поля не отображаются
      expect(result).not.toContain('<i></i>');
      expect(result).not.toContain('<b>Наказание:</b> ');
    });

    it('should display subarticle in article formatting', () => {
      const userStats: UserStats = {
        userId: 'test-user',
        chatId: 'test-chat',
        totalViolations: 2,
        violationsByArticle: [
          {
            article: '282',
            subarticle: '1',
            articleTitle: 'Возбуждение ненависти либо вражды',
            punishment: 'штраф в размере до трехсот тысяч рублей',
            count: 1,
            averageSeverity: 6.5
          },
          {
            article: '205',
            subarticle: null,
            articleTitle: 'Терроризм',
            punishment: 'лишение свободы на срок от восьми до пятнадцати лет',
            count: 1,
            averageSeverity: 9.0
          }
        ],
        averageSeverity: 7.75,
        riskLevel: 'high'
      };

      const result = formatter.formatUserStats(userStats);

      // Проверяем, что подпункт отображается
      expect(result).toContain('• <b>Статья 282.1 УК РФ</b> 1 раз 🟡 (ср. 6.5)');
      // Проверяем, что статья без подпункта отображается обычно
      expect(result).toContain('• <b>Статья 205 УК РФ</b> 1 раз 🔴 (ср. 9.0)');
    });
  });
});
