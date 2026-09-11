import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/core/env';
import {
  formatChatCriminalReport,
  formatCriminalTopReport,
  formatPersonalCriminalReport,
  loadChatCriminalReport,
  loadCriminalTopReport,
  loadPersonalCriminalReport,
  parseCriminalReportPeriod,
} from '../src/features/criminal/telegram-reports';

function createEnv(resolveRows: (sql: string) => any[]): Env {
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((..._bindings: unknown[]) => ({
        all: vi.fn().mockResolvedValue({ success: true, results: resolveRows(sql) }),
      })),
    })),
  };

  return {
    DB: db,
    COUNTERS: {
      get: vi.fn(async (key: string) => key === 'user:1' ? 'vasya' : key === 'user:2' ? 'petya' : null),
    },
  } as unknown as Env;
}

describe('criminal Telegram reports', () => {
  it('builds exact calendar ranges for today, week and month', () => {
    const now = new Date('2026-09-11T09:00:00Z');

    expect(parseCriminalReportPeriod('today', now)).toMatchObject({
      from: '2026-09-11',
      to: '2026-09-11',
      label: 'сегодня',
    });
    expect(parseCriminalReportPeriod('week', now)).toMatchObject({
      from: '2026-09-05',
      to: '2026-09-11',
      label: '7 дней',
    });
    expect(parseCriminalReportPeriod('month', now)).toMatchObject({
      from: '2026-08-13',
      to: '2026-09-11',
      label: '30 дней',
    });
  });

  it('uses violation_day with created_at fallback and formats personal episodes without context', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('GROUP BY article')) {
        return [
          {
            article: '119',
            subarticle: null,
            article_title: 'Угроза убийством',
            punishment: 'лишение свободы на срок до 2 лет',
            count: 3,
            average_severity: 7,
          },
          {
            article: '128.1',
            subarticle: null,
            article_title: 'Клевета',
            punishment: 'штраф до 500000 рублей',
            count: 1,
            average_severity: 4,
          },
        ];
      }
      return [
        {
          id: 10,
          article: '119',
          subarticle: null,
          article_title: 'Угроза убийством',
          quote: 'короткая цитата',
          text_preview: 'да его вообще надо было пристрелить и дело с концом',
          punishment: 'лишение свободы на срок до 2 лет',
          severity: 7,
          confidence: 0.92,
          event_ts: 1789070400,
        },
      ];
    });
    const range = parseCriminalReportPeriod('week', new Date('2026-09-11T09:00:00Z'));

    const report = await loadPersonalCriminalReport(env, -100, 42, range);
    const text = formatPersonalCriminalReport(report);

    expect(report.totalViolations).toBe(4);
    expect(text).toContain('⚖️ <b>Твоё уголовное дело · 7 дней</b>');
    expect(text).toContain('Напиздел: <b>6 лет</b>');
    expect(text).toContain('ст. 119 — Угроза убийством ×3 · 6 лет');
    expect(text).toContain('1. ст. 119 — Угроза убийством · 92% · 7/10');
    expect(text).toContain('«да его вообще надо было пристрелить и дело с концом»');
    expect(text).not.toContain('Контекст');

    const prepare = vi.mocked(env.DB.prepare);
    for (const [sql] of prepare.mock.calls) {
      expect(String(sql)).toContain('violation_day IS NOT NULL');
      expect(String(sql)).toContain('violation_day IS NULL AND date(created_at)');
    }
  });

  it('ranks criminal_top by calculated sentence and includes chat total', async () => {
    const env = createEnv((sql) => {
      if (!sql.includes('GROUP BY user_id')) return [];
      return [
        {
          user_id: 1,
          article: '119',
          subarticle: null,
          article_title: 'Угроза убийством',
          punishment: 'лишение свободы до 2 лет',
          count: 3,
          average_severity: 7,
        },
        {
          user_id: 2,
          article: '128.1',
          subarticle: null,
          article_title: 'Клевета',
          punishment: 'штраф до 500000 рублей',
          count: 10,
          average_severity: 4,
        },
      ];
    });
    const range = parseCriminalReportPeriod('month', new Date('2026-09-11T09:00:00Z'));

    const report = await loadCriminalTopReport(env, -100, range, 2);
    const text = formatCriminalTopReport(report);

    expect(report.users.map(user => user.username)).toEqual(['vasya', 'petya']);
    expect(text).toContain('🏆 <b>Уголовный рейтинг · 30 дней</b>');
    expect(text).toContain('1. <b>vasya</b>');
    expect(text).toContain('3 нарушения · напиздел на 6 лет');
    expect(text).toContain('13 нарушений · 6 лет');
  });

  it('formats chat stats with popular articles, leader and the most severe episode', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('GROUP BY user_id')) {
        return [
          {
            user_id: 1,
            article: '119',
            subarticle: null,
            article_title: 'Угроза убийством',
            punishment: 'лишение свободы до 2 лет',
            count: 2,
            average_severity: 7,
          },
          {
            user_id: 2,
            article: '128.1',
            subarticle: null,
            article_title: 'Клевета',
            punishment: 'штраф до 500000 рублей',
            count: 1,
            average_severity: 4,
          },
        ];
      }
      if (sql.includes('ORDER BY severity DESC')) {
        return [
          {
            id: 20,
            article: '119',
            subarticle: null,
            article_title: 'Угроза убийством',
            quote: 'самый тяжёлый эпизод',
            text_preview: null,
            punishment: 'лишение свободы до 2 лет',
            severity: 9,
            confidence: 0.95,
            event_ts: 1789070400,
          },
        ];
      }
      return [
        {
          article: '119',
          subarticle: null,
          article_title: 'Угроза убийством',
          punishment: 'лишение свободы до 2 лет',
          count: 2,
          average_severity: 7,
        },
        {
          article: '128.1',
          subarticle: null,
          article_title: 'Клевета',
          punishment: 'штраф до 500000 рублей',
          count: 1,
          average_severity: 4,
        },
      ];
    });
    const range = parseCriminalReportPeriod('week', new Date('2026-09-11T09:00:00Z'));

    const report = await loadChatCriminalReport(env, -100, range);
    const text = formatChatCriminalReport(report);

    expect(text).toContain('⚖️ <b>УК РФ · статистика чата · 7 дней</b>');
    expect(text).toContain('Нарушений: <b>3</b>');
    expect(text).toContain('Нарушителей: <b>2</b>');
    expect(text).toContain('<b>Самые популярные статьи:</b>');
    expect(text).toContain('<b>Главный уголовник:</b>');
    expect(text).toContain('vasya · 2 нарушения · 4 года');
    expect(text).toContain('<b>Самый тяжёлый эпизод:</b>');
    expect(text).toContain('«самый тяжёлый эпизод»');
  });
});
