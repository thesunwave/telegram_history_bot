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
});
