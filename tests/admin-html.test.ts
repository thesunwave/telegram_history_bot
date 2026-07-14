import { describe, expect, it } from 'vitest';
import { renderAdminHtml } from '../src/api/admin-html';

describe('renderAdminHtml', () => {
  it('renders hourly timezone selector persisted in localStorage', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('id="hourlyTimezone"');
    expect(html).toContain('telegramStatsAdmin.hourlyTimezoneOffset');
    expect(html).toContain('localStorage.setItem(HOURLY_TIMEZONE_STORAGE_KEY');
    expect(html).toContain('Средняя активность по часам, ');
  });

  it('renders theme selector persisted in localStorage', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('id="themeSelect"');
    expect(html).toContain('telegramStatsAdmin.theme');
    expect(html).toContain('document.documentElement.dataset.themeMode');
    expect(html).toContain('localStorage.setItem(THEME_STORAGE_KEY');
    expect(html).toContain('<option value="system">Система</option>');
    expect(html).toContain('<option value="light">День</option>');
    expect(html).toContain('<option value="dark">Ночь</option>');
  });

  it('renders profanity rate chart and table', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('id="profanityRateChart"');
    expect(html).toContain('id="profanityRateUsers"');
    expect(html).toContain('Доля мата');
    expect(html).toContain('stats.profanity.topRateUsers');
  });

  it('renders persisted manual dashboard layout controls', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('telegramStatsAdmin.dashboardLayout.v1');
    expect(html).toContain('data-block-id="activity"');
    expect(html).toContain('data-block-id="notifications"');
    expect(html).toContain('class="secondary dragHandle"');
    expect(html).toContain('class="secondary sizeToggle"');
    expect(html).toContain('Перетащить блок');
    expect(html).toContain('Изменить ширину блока');
    expect(html).toContain('setupDashboardDragAndDrop');
    expect(html).toContain('setupDashboardSizeControls');
    expect(html).toContain('applyDashboardLayout');
    expect(html).toContain('resetDashboardLayout');
  });
});
