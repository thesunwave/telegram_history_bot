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

  it('renders an accessible participant rhythm overview and daily detail heatmap', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('<h2>Ритм участников</h2>');
    expect(html).toContain('id="activityRhythmOverview"');
    expect(html).toContain('id="activityHeatmap"');
    expect(html).toContain('id="activityDetailTitle"');
    expect(html).toContain('Обзор показывает типичный ритм по дням недели; время — UTC.');
    expect(html).toContain('Нет активности');
    expect(html).toContain('Активен');
    expect(html).toContain('Активно общается');
    expect(html).toContain('stats.activity.participantTimeline');
    expect(html).toContain('timeBucketLevels');
    expect(html).toContain("{ bucket: 'night', label: 'Ночь · 22–05' }");
    expect(html).toContain("{ bucket: 'evening', label: 'Вечер · 17–22' }");
    expect(html).toContain("const ACTIVITY_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']");
    expect(html).toContain(".filter(({ index }) => days.some(day => weekdayIndex(day) === index))");
    expect(html).toContain('function rhythmLevel(levels)');
    expect(html).toContain('talkativeLevels * 2 >= levels.length');
    expect(html).toContain('activeLevels * 4 >= levels.length');
    expect(html).toContain("if (!levels.length) return 'inactive'");
    expect(html).toContain("select.setAttribute('aria-pressed', String(participant === selectedParticipant))");
    expect(html).toContain("select.setAttribute('aria-controls', 'activityHeatmap')");
    expect(html).toContain("select.addEventListener('click', () => renderActivityHeatmap(timeline, index))");
    expect(html).toContain("dayHeader.textContent = day.slice(8) + '.' + day.slice(5, 7)");
    expect(html).toContain("bucketName.scope = 'row'");
    expect(html).toContain('.activityRhythmGrid');
    expect(html).toContain('grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))');
    expect(html).toContain('-webkit-overflow-scrolling: touch');
    expect(html).not.toContain('function activityLevelMark(level)');
    expect(html).not.toContain('cell.textContent = activityLevelMark(level)');
    expect(html).not.toContain('writing-mode: vertical-rl');
    expect(html).not.toContain('• Активен');
    expect(html).toContain("const participants = (timeline?.participants || []).slice(0, 12)");
    expect(html).toContain('sort().slice(-90)');
    expect(html).not.toContain('participantSelect');
    expect(html).not.toContain('participantActivityChart');
    expect(html).not.toContain('/admin/api/chat/user-activity');
    expect(html).not.toContain('participantRequestId');
    expect(html).not.toContain("participant.userId");
  });

  it('renders designed Russian error states and never raw serialized payload text', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('id="statsError"');
    expect(html).toContain('id="statsErrorTitle"');
    expect(html).toContain('id="statsErrorMessage"');
    expect(html).toContain('id="statsErrorWeek"');
    expect(html).toContain('id="statsErrorRetry"');
    expect(html).toContain('LIVE_ANALYSIS_FAILED');
    expect(html).toContain('LIVE_PROGRESS_UNKNOWN');
    expect(html).toContain('HISTORICAL_STATS_NOT_READY');
    expect(html).toContain('ADMIN_UNAVAILABLE');
    expect(html).toContain('Анализ текущего дня не завершён');
    expect(html).toContain('Данные за сегодня пока недоступны');
    expect(html).toContain('Данные пока не готовы');
    expect(html).toContain('Сервис временно недоступен');
    expect(html).toContain('Не удалось загрузить статистику');
    expect(html).toContain('Повторить');
    // Never render raw response text/JSON or thrown error messages.
    expect(html).not.toContain('await res.text()');
    expect(html).not.toContain('error.message || String(error)');
    expect(html).not.toContain('JSON.stringify(error)');
  });

  it('labels week and month presets as rolling windows including today', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: null,
    });

    expect(html).toContain('<option value="today">Сегодня · live</option>');
    expect(html).toContain('Неделя · 7 дней, включая сегодня');
    expect(html).toContain('Месяц · 30 дней, включая сегодня');
    expect(html).toContain('включая сегодня · live');
  });

  it('builds the post-load status line with separators only between non-empty segments', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: null,
    });

    // The status line must join non-empty segments with " · " rather than
    // hard-coding separators around optional badges, which left a dangling
    // trailing "·" on every final response and a " · . " sandwich in the
    // notifications-degraded branch.
    expect(html).toContain(".filter(Boolean).join(' · ')");
    expect(html).not.toContain("' · ' + liveBadge");
    expect(html).not.toContain("servedRange + ' · ' + liveBadge");
    expect(html).not.toContain('+ liveBadge + pendingBadge');
    expect(html).not.toContain("' · анализ продолжается");
    expect(html).not.toContain("pendingBadge + '. Настройки");

    // The live/provisional badge copy, both branch prefixes, and the
    // degraded-branch suffix are all preserved on the fixed path.
    expect(html).toContain("'включая сегодня · live'");
    expect(html).toContain("'анализ продолжается (' + pendingAnalysis + ')'");
    expect(html).toContain("'Статистика загружена · ' + servedRange");
    expect(html).toContain("'Обновлено · период ' + servedRange");
    expect(html).toContain("'. Настройки уведомлений временно недоступны.'");

    // Extract the real status-line algorithm out of the rendered inline
    // script and evaluate it against every status shape to prove separators
    // only appear between non-empty segments.
    const match = html.match(
      /const liveBadge = provisional[\s\S]*?\.filter\(Boolean\)\.join\(' · '\);/
    );
    if (!match) throw new Error('status-line algorithm not found in rendered admin HTML');
    const buildStatus = new Function(
      'servedRange',
      'provisional',
      'pendingAnalysis',
      'notificationsError',
      match[0] +
        "\nreturn notificationsError ? statusLine + '. Настройки уведомлений временно недоступны.' : statusLine;"
    );
    const range = '2024-08-25 – 2024-08-31';
    const sep = ' · ';
    const live = 'включая сегодня · live';
    const pending = 'анализ продолжается (3)';
    const happyPrefix = 'Обновлено · период ' + range;
    const degradedPrefix = 'Статистика загружена · ' + range;
    const degradedSuffix = '. Настройки уведомлений временно недоступны.';

    // Happy path: no notifications error.
    expect(buildStatus(range, false, 0, null)).toBe(happyPrefix);
    expect(buildStatus(range, true, 0, null)).toBe(happyPrefix + sep + live);
    expect(buildStatus(range, true, 3, null)).toBe(happyPrefix + sep + live + sep + pending);

    // Degraded path: notifications endpoint returned a 503 object error.
    expect(buildStatus(range, false, 0, { code: 'ADMIN_UNAVAILABLE' })).toBe(
      degradedPrefix + degradedSuffix
    );
    expect(buildStatus(range, true, 0, { code: 'ADMIN_UNAVAILABLE' })).toBe(
      degradedPrefix + sep + live + degradedSuffix
    );
    expect(buildStatus(range, true, 3, { code: 'ADMIN_UNAVAILABLE' })).toBe(
      degradedPrefix + sep + live + sep + pending + degradedSuffix
    );

    // No output for any shape may contain a dangling or sandwiched separator.
    const allOutputs = [
      buildStatus(range, false, 0, null),
      buildStatus(range, true, 0, null),
      buildStatus(range, true, 3, null),
      buildStatus(range, false, 0, { code: 'ADMIN_UNAVAILABLE' }),
      buildStatus(range, true, 0, { code: 'ADMIN_UNAVAILABLE' }),
      buildStatus(range, true, 3, { code: 'ADMIN_UNAVAILABLE' }),
    ];
    for (const output of allOutputs) {
      expect(output).not.toMatch(/ · $/);
      expect(output).not.toMatch(/ · \./);
      expect(output).not.toMatch(/^ · /);
    }
  });
});
