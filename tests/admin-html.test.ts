import { describe, expect, it } from 'vitest';
import { renderAdminHtml } from '../src/api/admin-html';

describe('renderAdminHtml', () => {
  it('shows a logout form for an authenticated Telegram user', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: { type: 'telegram', username: 'admin', telegramId: 123 },
    });

    expect(html).toContain('<form class="logoutForm" action="/admin/logout" method="post">');
    expect(html).toContain('<button type="submit" class="secondary logoutButton">Выйти</button>');
  });

  it('shows global setup only for the owner or claim-eligible Telegram user', () => {
    const user = { type: 'telegram', username: 'participant', telegramId: 42 };
    expect(renderAdminHtml({ principal: user, canAccessSetup: true })).toContain('href="/admin/setup"');
    expect(renderAdminHtml({ principal: user, canAccessSetup: false })).not.toContain('href="/admin/setup"');
  });

  it('does not offer logout on the login screen', () => {
    const html = renderAdminHtml({ botUsername: 'stats_bot', principal: null });

    expect(html).not.toContain('action="/admin/logout"');
    expect(html).not.toContain('href="/admin/setup"');
  });

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

  it('renders the profanity view with a rate table and word contributors', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('data-view="profanity"');
    expect(html).toContain('id="profanityKpis"');
    expect(html).toContain('id="profanityRateUsers"');
    expect(html).toContain('id="profanityWords"');
    expect(html).toContain('data-profanity-sort');
    expect(html).toContain('Доля мата');
    expect(html).toContain('profanity.topRateUsers');
    expect(html).not.toContain('profanityRateChart');
  });
  it('renders side-by-side OpenAI and Qwen shadow evaluation controls', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('data-view="lab"');
    expect(html).toContain('Лаборатория моделей');
    expect(html).toContain('/admin/api/shadow-evaluations?chatId=');
    expect(html).toContain('data-shadow-filter');
    expect(html).toContain('Exact model input');
    expect(html).toContain('Raw output');
    expect(html).toContain('Совпадение не означает правильность');
  });
  it('renders sidebar navigation with hash-routed views', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    for (const view of ['overview', 'people', 'media', 'profanity', 'criminal', 'notifications', 'lab']) {
      expect(html).toContain(`href="#${view}" data-view-link="${view}"`);
      expect(html).toMatch(new RegExp(`<section class="view[^"]*" data-view="${view}"`));
    }
    expect(html).toContain('function showView');
    expect(html).toContain('function currentViewFromHash');
    expect(html).toContain("window.addEventListener('hashchange'");
    expect(html).toContain('.navLink[aria-current="page"]');
    // The drag-and-drop dashboard layout was replaced by fixed views.
    expect(html).not.toContain('dashboardLayout');
    expect(html).not.toContain('dragHandle');
  });

  it('shows period-over-period deltas, media minutes and longest recordings', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('id="overviewKpis"');
    expect(html).toContain('function deltaInfo(current, previous)');
    expect(html).toContain('stats.previous');
    expect(html).toContain('id="mediaKpis"');
    expect(html).toContain('id="mediaDailyChart"');
    expect(html).toContain('dailyMedia');
    expect(html).toContain('longestVoice');
    expect(html).toContain('voiceMaxSeconds');

    const match = html.match(/function deltaInfo\(current, previous\) \{[\s\S]*?\n    \}/);
    if (!match) throw new Error('deltaInfo not found in rendered admin HTML');
    const deltaInfo = new Function(match[0] + '\nreturn deltaInfo;')();
    expect(deltaInfo(10, null)).toBeNull();
    expect(deltaInfo(10, undefined)).toBeNull();
    expect(deltaInfo(5, 0)).toEqual({ text: 'раньше не было', tone: 'up' });
    expect(deltaInfo(0, 0)).toEqual({ text: 'без изменений', tone: '' });
    expect(deltaInfo(100, 100)).toEqual({ text: 'как в прошлом периоде', tone: '' });
    expect(deltaInfo(118, 100)).toEqual({ text: '▲ 18% к прошлому периоду', tone: 'up' });
    expect(deltaInfo(88, 100)).toEqual({ text: '▼ 12% к прошлому периоду', tone: 'down' });
  });
  it('renders an accessible participant rhythm heatmap', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('<h2>Ритм участников</h2>');
    expect(html).toContain('id="activityHeatmap"');
    expect(html).toContain('id="peopleRows"');
    expect(html).toContain('Нет активности');
    expect(html).toContain('Активен');
    expect(html).toContain('Активно общается');
    expect(html).toContain('participantTimeline');
    expect(html).toContain('timeBucketLevels');
    expect(html).toContain("{ bucket: 'night', label: 'Ночь · 22–05' }");
    expect(html).toContain("{ bucket: 'evening', label: 'Вечер · 17–22' }");
    expect(html).toContain("const ACTIVITY_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']");
    expect(html).toContain('function rhythmLevel(levels)');
    expect(html).toContain('talkativeLevels * 2 >= levels.length');
    expect(html).toContain("if (!levels.length) return 'inactive'");
    expect(html).toContain('-webkit-overflow-scrolling: touch');
    expect(html).toContain("const participants = (timeline?.participants || []).slice(0, 12)");
    expect(html).toContain('sort().slice(-90)');
    expect(html).not.toContain('participantSelect');
    expect(html).not.toContain('/admin/api/chat/user-activity');
    expect(html).not.toContain('writing-mode: vertical-rl');
  });
  it('renders criminal violation drill-down with model confidence and retained context', () => {
    const html = renderAdminHtml({
      botUsername: 'stats_bot',
      principal: {
        type: 'telegram',
        username: 'admin',
        telegramId: 123,
      },
    });

    expect(html).toContain('id="criminalDetails"');
    expect(html).toContain('id="criminalViolationList"');
    expect(html).toContain('/admin/api/criminal-violations');
    expect(html).toContain('renderCriminalRows(stats.criminal?.topUsers || [])');
    expect(html).toContain('Сообщение-триггер');
    expect(html).toContain('Возможное наказание');
    expect(html).toContain('Максимум лишения свободы по тексту наказания');
    expect(html).toContain('Уверенность модели ');
    expect(html).toContain('Уверенность модели — это confidence конкретного анализа, а не измеренная точность классификатора.');
    expect(html).toContain('История сообщений хранится до 7 дней.');
    expect(html).toContain('loadedCriminalRange: null');
    expect(html).toContain('state.loadedCriminalRange = stats.range?.from && stats.range?.to');
    expect(html).toContain('state.loadedCriminalRange,');
    expect(html).toContain("url.searchParams.set('period', 'custom')");
    expect(html).toContain("return 'нет данных'");
    expect(html).not.toContain('state.period');
    expect(html).not.toContain('new URL(buildStatsUrl(chatId, period)');

    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const script = scripts[scripts.length - 1]?.[1];
    expect(script).toContain('function buildCriminalDetailsUrl');
    expect(script).toMatch(
      /catch \(_error\) \{[\s\S]*?state\.selectedCriminalUserId = null;[\s\S]*?syncCriminalDetailButtons\(\);/,
    );
    expect(() => new Function(script!)).not.toThrow();
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

    expect(html).toContain('data-period="today" title="Сегодня · live"');
    expect(html).toContain('title="Неделя · 7 дней, включая сегодня"');
    expect(html).toContain('title="Месяц · 30 дней, включая сегодня"');
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

  it('blocks mobile zoom and lays out the people table as cards on narrow screens', () => {
    const html = renderAdminHtml({ principal: { type: 'telegram', username: 'admin', telegramId: 123 } });

    expect(html).toContain('maximum-scale=1, user-scalable=no');
    expect(html).toContain("addEventListener(type, event => event.preventDefault(), { passive: false })");
    expect(html).toMatch(/input, select, textarea, \.selectInput \{ font-size: 16px !important; \}/);
    expect(html).toContain('.app { flex-direction: column; flex-wrap: nowrap; }');
    expect(html).toContain('.peopleTable thead { display: none; }');
    expect(html).toContain('id="peopleSortSelect"');
    expect(html).toContain('td.dataset.label = PEOPLE_COLUMNS[index].label');
  });
});
