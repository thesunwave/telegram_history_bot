interface AdminHtmlOptions {
  botUsername: string | null;
  principal: {
    type: string;
    username: string;
    displayName?: string;
    telegramId?: number;
  } | null;
}

export function renderAdminHtml(options: AdminHtmlOptions): string {
  const botUsername = JSON.stringify(options.botUsername || '');
  const principal = JSON.stringify(options.principal || null);
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Telegram Stats Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f5f7;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #176b87;
      --accent-strong: #0f4f66;
      --accent-soft: #e8f3f6;
      --green: #16825d;
      --orange: #b75d19;
      --purple: #6d5bd0;
      --danger: #b42318;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
    }
    .wrap {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 64px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0;
    }
    main { padding: 24px 0 40px; }
    form.controls {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) 180px 150px 150px auto;
      gap: 14px;
      align-items: end;
      margin-bottom: 18px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }
    input, select, button {
      min-height: 40px;
      border-radius: 6px;
      border: 1px solid var(--line);
      font: inherit;
    }
    input, select {
      width: 100%;
      background: #fff;
      color: var(--text);
      padding: 0 10px;
    }
    button {
      padding: 0 14px;
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
      font-weight: 650;
      cursor: pointer;
    }
    button.secondary {
      border-color: var(--line);
      background: #fff;
      color: var(--text);
    }
    button:disabled {
      opacity: .55;
      cursor: default;
    }
    .loadingControl {
      background:
        linear-gradient(90deg, #eef1f5 25%, #f7f8fa 37%, #eef1f5 63%);
      background-size: 400% 100%;
      animation: skeletonPulse 1.35s ease-in-out infinite;
      color: transparent;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      min-width: 0;
    }
    section.wide { grid-column: 1 / -1; }
    h2 {
      margin: 0 0 12px;
      font-size: 16px;
      letter-spacing: 0;
    }
    .metric {
      font-size: 30px;
      font-weight: 750;
      line-height: 1;
      margin-bottom: 12px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .metricBox {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      min-width: 0;
      background: linear-gradient(180deg, #fff 0%, #f9fbfc 100%);
    }
    .metricBox .metric {
      font-size: 26px;
      margin-bottom: 4px;
    }
    .skeletonText {
      display: block;
      width: 100%;
      height: 1em;
      border-radius: 999px;
      background:
        linear-gradient(90deg, #eef1f5 25%, #f7f8fa 37%, #eef1f5 63%);
      background-size: 400% 100%;
      color: transparent;
      animation: skeletonPulse 1.35s ease-in-out infinite;
    }
    .metric.skeletonText {
      width: 68px;
      height: 26px;
      margin-top: 2px;
    }
    .skeletonCell {
      display: block;
      height: 14px;
      border-radius: 999px;
      background:
        linear-gradient(90deg, #eef1f5 25%, #f7f8fa 37%, #eef1f5 63%);
      background-size: 400% 100%;
      animation: skeletonPulse 1.35s ease-in-out infinite;
    }
    .skeletonCell.short { width: 42%; }
    .skeletonCell.medium { width: 64%; }
    .skeletonCell.long { width: 86%; }
    .skeletonCheck {
      width: min(260px, 100%);
      height: 18px;
      border-radius: 999px;
      background:
        linear-gradient(90deg, #eef1f5 25%, #f7f8fa 37%, #eef1f5 63%);
      background-size: 400% 100%;
      animation: skeletonPulse 1.35s ease-in-out infinite;
    }
    .metricLabel {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .charts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .chartPanel {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-width: 0;
      min-height: 300px;
      background: #fff;
    }
    .chartPanel.wide { grid-column: 1 / -1; }
    .chartHead {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .chartHeadControls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .chartTitle {
      color: var(--muted);
      font-size: 12px;
      font-weight: 750;
    }
    .chartValue {
      font-size: 12px;
      font-weight: 750;
      color: var(--text);
    }
    .chartTimezone {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .chartTimezone select {
      width: 122px;
      min-height: 32px;
      padding: 0 8px;
      font-size: 12px;
    }
    .chartCanvas {
      position: relative;
      height: 238px;
    }
    .chartCanvas.tall { height: 300px; }
    .chartEmpty {
      color: var(--muted);
      display: grid;
      place-items: center;
      height: 220px;
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: #fbfcfd;
    }
    .tableScroll {
      overflow-x: auto;
    }
    .activityTable {
      margin-top: 16px;
    }
    .bucketGrid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .bucket {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      min-width: 0;
      background: #fbfcfd;
    }
    .bucket h3 {
      margin: 0 0 8px;
      font-size: 13px;
      letter-spacing: 0;
    }
    .bucket ol {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
    }
    .bucket li {
      margin: 4px 0;
      overflow-wrap: anywhere;
    }
    .bucketCount {
      color: var(--text);
      font-weight: 750;
    }
    table {
      width: 100%;
      min-width: 520px;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 9px 6px;
      border-top: 1px solid var(--line);
      text-align: left;
      overflow-wrap: anywhere;
    }
    th {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .status {
      min-height: 22px;
      margin-bottom: 12px;
      color: var(--muted);
    }
    .status.error { color: var(--danger); }
    .notificationMeta {
      margin: 2px 0 12px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }
    .toggles {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
      margin: 12px 0 16px;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text);
      font-weight: 500;
    }
    .check input {
      width: 18px;
      min-height: 18px;
    }
    .muted { color: var(--muted); }
    .login {
      display: grid;
      gap: 14px;
      max-width: 420px;
      margin-top: 24px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
    }
    .login p {
      margin: 0;
      color: var(--muted);
    }
    #sessionLabel strong {
      color: var(--text);
      font-weight: 750;
    }
    td strong {
      color: var(--text);
      font-weight: 750;
    }
    .hasTooltip {
      position: relative;
      cursor: help;
    }
    .tooltip {
      display: none;
      position: absolute;
      z-index: 5;
      left: 6px;
      top: calc(100% - 2px);
      width: min(260px, calc(100vw - 48px));
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      box-shadow: 0 10px 24px rgba(24, 32, 42, .14);
      color: var(--text);
      font-size: 12px;
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .hasTooltip:hover .tooltip,
    .hasTooltip:focus .tooltip {
      display: block;
    }
    .tooltipTitle {
      margin-bottom: 6px;
      color: var(--muted);
      font-weight: 700;
    }
    .tooltipRow {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 2px 0;
    }
    .tooltipCount {
      flex: 0 0 auto;
      font-weight: 750;
    }
    @keyframes skeletonPulse {
      0% { background-position: 100% 50%; }
      100% { background-position: 0 50%; }
    }
    .hidden { display: none !important; }
    @media (max-width: 720px) {
      .topbar { align-items: flex-start; flex-direction: column; padding: 14px 0; }
      form.controls { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .charts { grid-template-columns: 1fr; }
      .chartPanel.wide { grid-column: auto; }
      .bucketGrid { grid-template-columns: 1fr; }
      .toggles { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <h1>Telegram Stats Admin</h1>
      <div class="muted" id="sessionLabel"></div>
    </div>
  </header>
  <main class="wrap">
    <section class="login hidden" id="loginPanel">
      <h2>Вход через Telegram</h2>
      <p>После входа будут показаны только чаты, где ваш Telegram-пользователь состоит участником.</p>
      <div id="telegramLogin"></div>
      <p class="muted" id="loginHint"></p>
    </section>
    <form class="controls hidden" id="controls">
      <label>Чат
        <select id="chatSelect" name="chatId" required>
          <option value="">Загрузка чатов...</option>
        </select>
      </label>
      <label>Период
        <select id="period" name="period">
          <option value="today">Сегодня</option>
          <option value="week">Неделя</option>
          <option value="month">Месяц</option>
          <option value="custom">Период</option>
        </select>
      </label>
      <label class="customPeriod hidden">С
        <input id="dateFrom" name="from" type="date">
      </label>
      <label class="customPeriod hidden">По
        <input id="dateTo" name="to" type="date">
      </label>
      <button id="refreshButton" type="submit">Обновить</button>
    </form>
    <div id="status" class="status hidden"></div>
    <div class="grid hidden" id="dashboard">
      <section class="wide">
        <h2>Активность</h2>
        <div class="metrics">
          <div class="metricBox">
            <div class="metric" id="activityTotal">0</div>
            <div class="metricLabel">Сообщения</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityWords">0</div>
            <div class="metricLabel">Слова</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityWordsPerMessage">0</div>
            <div class="metricLabel">Слов/сообщ.</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityActiveUsers">0</div>
            <div class="metricLabel">Активные</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityAvgDaily">0</div>
            <div class="metricLabel">Сообщ./день</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityAvgDailyUsers">0</div>
            <div class="metricLabel">Активн./день</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityAvgHourly">0</div>
            <div class="metricLabel">Сообщ./час</div>
          </div>
        </div>
        <div class="charts">
          <div class="chartPanel">
            <div class="chartHead">
              <div class="chartTitle">Сообщения по дням</div>
              <div class="chartValue" id="dailyMessagesTotal">0</div>
            </div>
            <div class="chartCanvas"><canvas id="dailyMessagesChart"></canvas></div>
            <div class="chartEmpty hidden" id="dailyMessagesEmpty">Нет данных</div>
          </div>
          <div class="chartPanel">
            <div class="chartHead">
              <div class="chartTitle">Активные пользователи по дням</div>
              <div class="chartValue" id="dailyActiveUsersPeak">0 peak</div>
            </div>
            <div class="chartCanvas"><canvas id="dailyActiveUsersChart"></canvas></div>
            <div class="chartEmpty hidden" id="dailyActiveUsersEmpty">Нет данных</div>
          </div>
          <div class="chartPanel wide">
            <div class="chartHead">
              <div class="chartTitle" id="hourlyTitle">Средняя активность по часам</div>
              <div class="chartHeadControls">
                <label class="chartTimezone">Зона
                  <select id="hourlyTimezone"></select>
                </label>
                <div class="chartValue" id="hourlyPeak">0 peak</div>
              </div>
            </div>
            <div class="chartCanvas tall"><canvas id="hourlyChart"></canvas></div>
            <div class="chartEmpty hidden" id="hourlyEmpty">Нет данных</div>
          </div>
        </div>
        <div class="tableScroll activityTable">
          <table>
            <thead><tr><th>Пользователь</th><th>Сообщения</th><th>Слова</th><th>Слов/сообщ.</th></tr></thead>
            <tbody id="activityUsers"></tbody>
          </table>
        </div>
      </section>
      <section class="wide">
        <h2>Лидеры по времени суток</h2>
        <div class="bucketGrid" id="timeBuckets"></div>
      </section>
      <section>
        <h2>Болтуны</h2>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Слова</th><th>Сообщения</th><th>Слов/сообщ.</th></tr></thead>
            <tbody id="activityTalkers"></tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Мат</h2>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Счет</th></tr></thead>
            <tbody id="profanityUsers"></tbody>
          </table>
        </div>
      </section>
      <section class="wide">
        <h2>Доля мата</h2>
        <div class="chartPanel wide">
          <div class="chartHead">
            <div class="chartTitle">Мат среди всех слов, минимум 100 слов</div>
            <div class="chartValue" id="profanityRatePeak">0%</div>
          </div>
          <div class="chartCanvas"><canvas id="profanityRateChart"></canvas></div>
          <div class="chartEmpty hidden" id="profanityRateEmpty">Нет данных</div>
        </div>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Доля</th><th>Мат</th><th>Слова</th></tr></thead>
            <tbody id="profanityRateUsers"></tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Слова</h2>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Слово</th><th>Счет</th></tr></thead>
            <tbody id="profanityWords"></tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>УК РФ</h2>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Нарушения</th></tr></thead>
            <tbody id="criminalUsers"></tbody>
          </table>
        </div>
      </section>
      <section class="wide">
        <h2>Автоуведомления</h2>
        <div class="notificationMeta" id="notificationMeta">Настройки еще не сохранялись</div>
        <label class="check"><input type="checkbox" id="notificationsEnabled"> Включены</label>
        <div class="toggles" id="notificationTypes"></div>
        <button class="secondary" id="saveNotifications" type="button">Сохранить настройки</button>
      </section>
    </div>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <script>
    const botUsername = ${botUsername};
    const principal = ${principal};
    const HOURLY_TIMEZONE_STORAGE_KEY = 'telegramStatsAdmin.hourlyTimezoneOffset';
    const state = {
      chatId: '',
      period: 'today',
      notificationTypes: [],
      chats: [],
      loading: false,
      currentActivity: null
    };
    const chartInstances = {};
    const labels = {
      criminal_reports: 'УК РФ',
      profanity_reports: 'Мат',
      activity_summary: 'Активность',
      daily_summary: 'Дневная сводка',
      weekly_summary: 'Недельная сводка',
      monthly_summary: 'Месячная сводка'
    };

    function setStatus(text, isError = false) {
      const el = document.getElementById('status');
      el.classList.remove('hidden');
      el.textContent = text;
      el.className = isError ? 'status error' : 'status';
    }

    function setControlsDisabled(disabled) {
      document.getElementById('chatSelect').disabled = disabled;
      document.getElementById('period').disabled = disabled;
      document.getElementById('dateFrom').disabled = disabled;
      document.getElementById('dateTo').disabled = disabled;
      document.getElementById('refreshButton').disabled = disabled;
      document.getElementById('hourlyTimezone').disabled = disabled;
      document.getElementById('saveNotifications').disabled = disabled;
      document.getElementById('notificationsEnabled').disabled = disabled;
      for (const input of document.querySelectorAll('#notificationTypes input')) {
        input.disabled = disabled;
      }
    }

    function toDayInputValue(date) {
      return date.toISOString().slice(0, 10);
    }

    function setupCustomPeriodDefaults() {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const weekAgo = new Date(today);
      weekAgo.setUTCDate(today.getUTCDate() - 6);
      const todayValue = toDayInputValue(today);
      document.getElementById('dateFrom').value = toDayInputValue(weekAgo);
      document.getElementById('dateTo').value = todayValue;
      document.getElementById('dateFrom').max = todayValue;
      document.getElementById('dateTo').max = todayValue;
    }

    function syncCustomPeriodControls() {
      const isCustom = document.getElementById('period').value === 'custom';
      for (const el of document.querySelectorAll('.customPeriod')) {
        el.classList.toggle('hidden', !isCustom);
      }
    }

    function buildStatsUrl(chatId, period) {
      const url = new URL('/admin/api/chat', window.location.origin);
      url.searchParams.set('chatId', chatId);
      url.searchParams.set('period', period);

      if (period === 'custom') {
        const from = document.getElementById('dateFrom').value;
        const to = document.getElementById('dateTo').value;
        if (!from || !to) {
          throw new Error('Выберите даты начала и конца периода');
        }
        if (from > to) {
          throw new Error('Дата начала должна быть раньше или равна дате конца');
        }
        url.searchParams.set('from', from);
        url.searchParams.set('to', to);
      }

      return url.pathname + url.search;
    }

    function setNotificationEditAllowed(canEdit) {
      document.getElementById('saveNotifications').disabled = !canEdit;
      document.getElementById('notificationsEnabled').disabled = !canEdit;
      for (const input of document.querySelectorAll('#notificationTypes input')) {
        input.disabled = !canEdit;
      }
    }

    function renderSkeletonRows(id, columns, rows = 4) {
      const tbody = document.getElementById(id);
      tbody.innerHTML = '';
      for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
        const tr = document.createElement('tr');
        for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
          const td = document.createElement('td');
          const line = document.createElement('span');
          line.className =
            'skeletonCell ' + (columnIndex === 0 ? 'long' : columnIndex % 2 ? 'short' : 'medium');
          td.append(line);
          tr.append(td);
        }
        tbody.append(tr);
      }
    }

    function renderNotificationSkeleton() {
      document.getElementById('notificationsEnabled').checked = false;
      document.getElementById('notificationMeta').textContent = 'Загрузка настроек...';
      const box = document.getElementById('notificationTypes');
      box.innerHTML = '';
      for (let index = 0; index < 6; index += 1) {
        const item = document.createElement('div');
        item.className = 'skeletonCheck';
        box.append(item);
      }
    }

    function renderDashboardSkeleton() {
      state.loading = true;
      document.getElementById('dashboard').classList.remove('hidden');
      setControlsDisabled(true);
      for (const id of [
        'activityTotal',
        'activityWords',
        'activityWordsPerMessage',
        'activityActiveUsers',
        'activityAvgDaily',
        'activityAvgDailyUsers',
        'activityAvgHourly'
      ]) {
        const el = document.getElementById(id);
        el.textContent = '';
        el.classList.add('skeletonText');
      }
      renderCharts({ dailyMessages: [], dailyActiveUsers: [], hourlyAverages: [] });
      document.getElementById('profanityRatePeak').textContent = '0%';
      setChartEmpty('profanityRate', true);
      renderTimeBuckets([]);
      renderSkeletonRows('activityUsers', 4);
      renderSkeletonRows('activityTalkers', 4);
      renderSkeletonRows('profanityUsers', 2, 3);
      renderSkeletonRows('profanityRateUsers', 4, 3);
      renderSkeletonRows('profanityWords', 2, 3);
      renderSkeletonRows('criminalUsers', 2, 3);
      renderNotificationSkeleton();
    }

    function finishDashboardLoading() {
      state.loading = false;
      setControlsDisabled(false);
      for (const id of [
        'activityTotal',
        'activityWords',
        'activityWordsPerMessage',
        'activityActiveUsers',
        'activityAvgDaily',
        'activityAvgDailyUsers',
        'activityAvgHourly'
      ]) {
        document.getElementById(id).classList.remove('skeletonText');
      }
    }

    function renderEmptyDashboard() {
      document.getElementById('activityTotal').textContent = '0';
      document.getElementById('activityWords').textContent = '0';
      document.getElementById('activityWordsPerMessage').textContent = '0';
      document.getElementById('activityActiveUsers').textContent = '0';
      document.getElementById('activityAvgDaily').textContent = '0';
      document.getElementById('activityAvgDailyUsers').textContent = '0';
      document.getElementById('activityAvgHourly').textContent = '0';
      renderCharts({ dailyMessages: [], dailyActiveUsers: [], hourlyAverages: [] });
      renderTimeBuckets([]);
      renderActivityRows('activityUsers', [], 'messages');
      renderActivityRows('activityTalkers', [], 'words');
      renderRows('profanityUsers', [], 'username', 'count');
      renderProfanityRateRows([]);
      renderRows('profanityWords', [], 'word', 'count');
      renderRows('criminalUsers', [], 'username', 'count');
      renderNotifications({ enabled: false, notifications: {} }, [], false);
    }

    function showLogin() {
      document.getElementById('loginPanel').classList.remove('hidden');
      document.getElementById('controls').classList.add('hidden');
      document.getElementById('dashboard').classList.add('hidden');
      document.getElementById('status').classList.add('hidden');
      document.getElementById('sessionLabel').textContent = 'Не авторизован';

      if (!botUsername) {
        document.getElementById('loginHint').textContent = 'Не удалось получить username бота для Telegram Login.';
        return;
      }

      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.dataset.telegramLogin = botUsername;
      script.dataset.size = 'large';
      script.dataset.authUrl = '/admin/login';
      script.dataset.requestAccess = 'write';
      document.getElementById('telegramLogin').append(script);
    }

    function showDashboardShell() {
      document.getElementById('loginPanel').classList.add('hidden');
      document.getElementById('controls').classList.remove('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      const name = principal?.displayName || principal?.username || 'Telegram user';
      const sessionLabel = document.getElementById('sessionLabel');
      sessionLabel.textContent = 'Вошли как ';
      const user = document.createElement('strong');
      user.textContent = name;
      sessionLabel.append(user);
    }

    function renderRows(id, rows, nameKey, countKey) {
      const tbody = document.getElementById(id);
      tbody.innerHTML = '';
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="muted">Нет данных</td></tr>';
        return;
      }
      for (const row of rows) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        const count = document.createElement('td');
        const isCurrentUser = principal?.telegramId && String(row.userId) === String(principal.telegramId);
        const contributors = Array.isArray(row.contributors) ? row.contributors : [];
        if (isCurrentUser) {
          const currentUser = document.createElement('strong');
          currentUser.textContent = row[nameKey];
          name.append(currentUser);
        } else {
          name.textContent = row[nameKey];
        }
        if (contributors.length) {
          const tooltip = document.createElement('span');
          tooltip.className = 'tooltip';
          const title = document.createElement('div');
          title.className = 'tooltipTitle';
          title.textContent = 'Кто произносил';
          tooltip.append(title);
          for (const contributor of contributors) {
            const line = document.createElement('div');
            line.className = 'tooltipRow';
            const username = document.createElement('span');
            const value = document.createElement('span');
            value.className = 'tooltipCount';
            username.textContent = contributor.username;
            value.textContent = String(contributor.count);
            line.append(username, value);
            tooltip.append(line);
          }
          name.classList.add('hasTooltip');
          name.tabIndex = 0;
          name.append(tooltip);
        }
        count.textContent = String(row[countKey]);
        tr.append(name, count);
        tbody.append(tr);
      }
    }

    function renderActivityRows(id, rows, mode) {
      const tbody = document.getElementById(id);
      tbody.innerHTML = '';
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">Нет данных</td></tr>';
        return;
      }
      for (const row of rows) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        const primary = document.createElement('td');
        const secondary = document.createElement('td');
        const rate = document.createElement('td');
        const isCurrentUser = principal?.telegramId && String(row.userId) === String(principal.telegramId);
        if (isCurrentUser) {
          const currentUser = document.createElement('strong');
          currentUser.textContent = row.username;
          name.append(currentUser);
        } else {
          name.textContent = row.username;
        }
        primary.textContent = String(mode === 'words' ? row.words : row.count);
        secondary.textContent = String(mode === 'words' ? row.count : row.words);
        rate.textContent = String(row.wordsPerMessage || 0);
        tr.append(name, primary, secondary, rate);
        tbody.append(tr);
      }
    }

    function formatRate(value) {
      return (Number(value) || 0).toFixed(2).replace(/\\.?0+$/, '') + '%';
    }

    function renderProfanityRateRows(rows) {
      const tbody = document.getElementById('profanityRateUsers');
      tbody.innerHTML = '';
      const peak = Math.max(...(rows || []).map(row => Number(row.rate) || 0), 0);
      document.getElementById('profanityRatePeak').textContent = formatRate(peak);
      setChartEmpty('profanityRate', !rows.length);
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">Нет данных</td></tr>';
        return;
      }

      makeChart('profanityRateChart', {
        type: 'bar',
        data: {
          labels: rows.map(row => row.username),
          datasets: [{
            data: rows.map(row => Number((Number(row.rate) || 0).toFixed(2))),
            backgroundColor: '#b75d19',
            borderRadius: 5,
            maxBarThickness: 34
          }]
        },
        options: commonChartOptions({
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#667085', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
            },
            y: {
              beginAtZero: true,
              grid: { color: '#eef1f5' },
              ticks: {
                color: '#667085',
                callback: value => value + '%'
              }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#18202a',
              padding: 10,
              callbacks: {
                label: context => formatRate(context.raw)
              }
            }
          }
        })
      });

      for (const row of rows) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        const rate = document.createElement('td');
        const profanity = document.createElement('td');
        const words = document.createElement('td');
        const isCurrentUser = principal?.telegramId && String(row.userId) === String(principal.telegramId);
        if (isCurrentUser) {
          const currentUser = document.createElement('strong');
          currentUser.textContent = row.username;
          name.append(currentUser);
        } else {
          name.textContent = row.username;
        }
        rate.textContent = formatRate(row.rate);
        profanity.textContent = String(row.profanityCount || 0);
        words.textContent = String(row.wordCount || 0);
        tr.append(name, rate, profanity, words);
        tbody.append(tr);
      }
    }

    function destroyChart(id) {
      if (chartInstances[id]) {
        chartInstances[id].destroy();
        delete chartInstances[id];
      }
    }

    function setChartEmpty(id, isEmpty) {
      document.getElementById(id + 'Empty').classList.toggle('hidden', !isEmpty);
      document.getElementById(id + 'Chart').parentElement.classList.toggle('hidden', isEmpty);
      if (isEmpty) destroyChart(id + 'Chart');
    }

    function compactDayLabel(day) {
      return String(day || '').slice(5) || '-';
    }

    function makeChart(id, config) {
      if (!window.Chart) {
        setChartEmpty(id.replace('Chart', ''), true);
        return;
      }
      destroyChart(id);
      const ctx = document.getElementById(id);
      chartInstances[id] = new Chart(ctx, config);
    }

    function commonChartOptions(extra = {}) {
      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#18202a',
            padding: 10,
            titleFont: { size: 12, weight: '700' },
            bodyFont: { size: 12 }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#667085', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#eef1f5' },
            ticks: { color: '#667085', precision: 0 }
          }
        },
        ...extra
      };
    }

    function padHour(value) {
      return String(value).padStart(2, '0');
    }

    function clampTimezoneOffset(value) {
      const offset = Number(value);
      if (!Number.isInteger(offset) || offset < -12 || offset > 14) {
        return 0;
      }
      return offset;
    }

    function formatTimezoneOffset(offset) {
      if (offset === 0) return 'UTC';
      return 'UTC' + (offset > 0 ? '+' : '-') + padHour(Math.abs(offset)) + ':00';
    }

    function getBrowserTimezoneOffset() {
      return clampTimezoneOffset(Math.round(-new Date().getTimezoneOffset() / 60));
    }

    function readTimezoneOffset() {
      try {
        const stored = localStorage.getItem(HOURLY_TIMEZONE_STORAGE_KEY);
        if (stored !== null) return clampTimezoneOffset(stored);
      } catch (_error) {
        return getBrowserTimezoneOffset();
      }
      return getBrowserTimezoneOffset();
    }

    function writeTimezoneOffset(offset) {
      try {
        localStorage.setItem(HOURLY_TIMEZONE_STORAGE_KEY, String(offset));
      } catch (_error) {
        // Local storage can be unavailable in restricted browser modes.
      }
    }

    function setupHourlyTimezoneControl() {
      const select = document.getElementById('hourlyTimezone');
      select.innerHTML = '';
      for (let offset = -12; offset <= 14; offset += 1) {
        const option = document.createElement('option');
        option.value = String(offset);
        option.textContent = formatTimezoneOffset(offset);
        select.append(option);
      }
      select.value = String(readTimezoneOffset());
    }

    function getHourlyTimezoneOffset() {
      return clampTimezoneOffset(document.getElementById('hourlyTimezone').value);
    }

    function shiftHourlyAverages(hourlyAverages) {
      const byUtcHour = new Map(
        (hourlyAverages || []).map(row => [padHour(Number(row.hour) || 0), Number(row.count) || 0])
      );
      const offset = getHourlyTimezoneOffset();
      return Array.from({ length: 24 }, (_, localHour) => {
        const utcHour = (localHour - offset + 24) % 24;
        return {
          hour: padHour(localHour),
          count: byUtcHour.get(padHour(utcHour)) || 0
        };
      });
    }

    function getHourColor(hour) {
      if (hour >= 5 && hour < 12) return '#176b87';
      if (hour >= 12 && hour < 17) return '#16825d';
      if (hour >= 17 && hour < 22) return '#b75d19';
      return '#6d5bd0';
    }

    function renderCharts(activity) {
      state.currentActivity = activity;
      const dailyMessages = activity.dailyMessages || [];
      const dailyActiveUsers = activity.dailyActiveUsers || [];
      const hourlyAverages = shiftHourlyAverages(activity.hourlyAverages || []);
      const dailyMessageTotal = dailyMessages.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
      const activePeak = Math.max(...dailyActiveUsers.map(row => Number(row.count) || 0), 0);
      const hourlyPeak = Math.max(...hourlyAverages.map(row => Number(row.count) || 0), 0);

      document.getElementById('dailyMessagesTotal').textContent = String(dailyMessageTotal);
      document.getElementById('dailyActiveUsersPeak').textContent = activePeak + ' peak';
      document.getElementById('hourlyPeak').textContent = hourlyPeak + ' peak';
      document.getElementById('hourlyTitle').textContent =
        'Средняя активность по часам, ' + formatTimezoneOffset(getHourlyTimezoneOffset());

      setChartEmpty('dailyMessages', dailyMessages.length === 0);
      setChartEmpty('dailyActiveUsers', dailyActiveUsers.length === 0);
      setChartEmpty('hourly', (activity.hourlyAverages || []).length === 0);

      if (dailyMessages.length) {
        makeChart('dailyMessagesChart', {
          type: 'line',
          data: {
            labels: dailyMessages.map(row => compactDayLabel(row.day)),
            datasets: [{
              data: dailyMessages.map(row => Number(row.count) || 0),
              borderColor: '#176b87',
              backgroundColor: 'rgba(23,107,135,.14)',
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
              tension: .3,
              fill: true
            }]
          },
          options: commonChartOptions()
        });
      }

      if (dailyActiveUsers.length) {
        makeChart('dailyActiveUsersChart', {
          type: 'bar',
          data: {
            labels: dailyActiveUsers.map(row => compactDayLabel(row.day)),
            datasets: [{
              data: dailyActiveUsers.map(row => Number(row.count) || 0),
              backgroundColor: '#16825d',
              borderRadius: 5,
              maxBarThickness: 28
            }]
          },
          options: commonChartOptions()
        });
      }

      if ((activity.hourlyAverages || []).length) {
        makeChart('hourlyChart', {
          type: 'bar',
          data: {
            labels: hourlyAverages.map(row => row.hour),
            datasets: [{
              data: hourlyAverages.map(row => Number(row.count) || 0),
              backgroundColor: hourlyAverages.map(row => {
                const hour = Number(row.hour);
                return getHourColor(hour);
              }),
              borderRadius: 5,
              maxBarThickness: 20
            }]
          },
          options: commonChartOptions({
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: '#667085', maxRotation: 0, autoSkip: false }
              },
              y: {
                beginAtZero: true,
                grid: { color: '#eef1f5' },
                ticks: { color: '#667085' }
              }
            }
          })
        });
      }
    }

    function renderTimeBuckets(buckets) {
      const box = document.getElementById('timeBuckets');
      box.innerHTML = '';
      for (const bucket of buckets || []) {
        const card = document.createElement('div');
        card.className = 'bucket';
        const title = document.createElement('h3');
        title.textContent = bucket.label;
        const users = bucket.topUsers || [];
        if (!users.length) {
          const empty = document.createElement('div');
          empty.className = 'muted';
          empty.textContent = 'Нет данных';
          card.append(title, empty);
          box.append(card);
          continue;
        }
        const list = document.createElement('ol');
        for (const user of users) {
          const item = document.createElement('li');
          item.textContent = user.username + ': ';
          const count = document.createElement('span');
          count.className = 'bucketCount';
          count.textContent = String(user.count);
          item.append(count);
          list.append(item);
        }
        card.append(title, list);
        box.append(card);
      }
    }

    function formatNotificationEditMeta(settings, canEdit) {
      if (!settings?.updatedAt) {
        return canEdit
          ? 'Настройки еще не сохранялись'
          : 'Настройки еще не сохранялись. Редактировать может только администратор чата.';
      }

      const date = new Date(settings.updatedAt);
      const formattedDate = Number.isNaN(date.getTime())
        ? String(settings.updatedAt)
        : date.toLocaleString('ru-RU');
      const editor = settings.updatedByName || settings.updatedBy || 'неизвестный пользователь';
      const suffix = canEdit ? '' : '. Редактировать может только администратор чата.';
      return 'Последнее изменение: ' + editor + ', ' + formattedDate + suffix;
    }

    function renderNotifications(settings, types, canEdit) {
      state.notificationTypes = types;
      document.getElementById('notificationsEnabled').checked = Boolean(settings?.enabled);
      document.getElementById('notificationMeta').textContent = formatNotificationEditMeta(settings, canEdit);
      const box = document.getElementById('notificationTypes');
      box.innerHTML = '';
      for (const type of types) {
        const label = document.createElement('label');
        label.className = 'check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.type = type;
        input.checked = Boolean(settings?.notifications?.[type]?.enabled);
        label.append(input, document.createTextNode(labels[type] || type));
        box.append(label);
      }
      setNotificationEditAllowed(Boolean(canEdit));
    }

    function renderChats(chats) {
      state.chats = chats;
      const select = document.getElementById('chatSelect');
      select.innerHTML = '';
      if (!chats.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Чаты пока не найдены';
        select.append(option);
        return;
      }

      for (const chat of chats) {
        const option = document.createElement('option');
        option.value = String(chat.chatId);
        option.textContent = chat.title + ' (' + chat.chatId + ')';
        select.append(option);
      }
    }

    async function loadChats() {
      setStatus('Загрузка чатов...');
      document.getElementById('chatSelect').classList.add('loadingControl');
      renderDashboardSkeleton();
      try {
        const res = await fetch('/admin/api/chats');
        if (res.status === 401) {
          showLogin();
          return;
        }
        if (!res.ok) throw new Error(await res.text());
        const body = await res.json();
        renderChats(body.chats || []);
        if ((body.chats || []).length) {
          finishDashboardLoading();
          await loadDashboard();
        } else {
          finishDashboardLoading();
          document.getElementById('dashboard').classList.add('hidden');
          setStatus('Чаты появятся после новых сообщений или после обнаружения старых счетчиков.');
        }
      } catch (error) {
        finishDashboardLoading();
        renderEmptyDashboard();
        setStatus(error.message || String(error), true);
      } finally {
        document.getElementById('chatSelect').classList.remove('loadingControl');
      }
    }

    async function loadDashboard() {
      if (state.loading) return;
      const chatId = document.getElementById('chatSelect').value;
      const period = document.getElementById('period').value;
      if (!chatId) return;
      state.chatId = chatId;
      state.period = period;

      try {
        const statsUrl = buildStatsUrl(chatId, period);
        setStatus('Загрузка...');
        renderDashboardSkeleton();
        const [statsRes, notificationsRes] = await Promise.all([
          fetch(statsUrl),
          fetch('/admin/api/notifications?chatId=' + encodeURIComponent(chatId))
        ]);
        if (!statsRes.ok) throw new Error(await statsRes.text());
        if (!notificationsRes.ok) throw new Error(await notificationsRes.text());

        const stats = await statsRes.json();
        const notifications = await notificationsRes.json();

        finishDashboardLoading();
        document.getElementById('activityTotal').textContent = String(stats.activity.total);
        document.getElementById('activityWords').textContent = String(stats.activity.totalWords || 0);
        document.getElementById('activityWordsPerMessage').textContent = String(stats.activity.wordsPerMessage || 0);
        document.getElementById('activityActiveUsers').textContent = String(stats.activity.activeUsers || 0);
        document.getElementById('activityAvgDaily').textContent = String(stats.activity.averageDailyMessages || 0);
        document.getElementById('activityAvgDailyUsers').textContent = String(stats.activity.averageDailyActiveUsers || 0);
        document.getElementById('activityAvgHourly').textContent = String(stats.activity.averageHourlyMessages || 0);
        renderCharts(stats.activity || {});
        renderTimeBuckets(stats.activity.timeBuckets || []);
        renderActivityRows('activityUsers', stats.activity.topUsers || [], 'messages');
        renderActivityRows('activityTalkers', stats.activity.topTalkers || [], 'words');
        renderRows('profanityUsers', stats.profanity.topUsers, 'username', 'count');
        renderProfanityRateRows(stats.profanity.topRateUsers || []);
        renderRows('profanityWords', stats.profanity.topWords, 'word', 'count');
        renderRows('criminalUsers', stats.criminal.topUsers, 'username', 'count');
        renderNotifications(
          notifications.settings,
          notifications.availableTypes,
          notifications.canEdit
        );
        setStatus('Обновлено');
      } catch (error) {
        finishDashboardLoading();
        renderEmptyDashboard();
        setStatus(error.message || String(error), true);
      }
    }

    async function saveNotifications() {
      if (!state.chatId || state.loading) return;
      const notifications = {};
      for (const input of document.querySelectorAll('#notificationTypes input')) {
        notifications[input.dataset.type] = { enabled: input.checked };
      }
      setStatus('Сохранение...');
      const res = await fetch('/admin/api/notifications?chatId=' + encodeURIComponent(state.chatId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: document.getElementById('notificationsEnabled').checked,
          notifications
        })
      });
      if (!res.ok) {
        setStatus(await res.text(), true);
        return;
      }
      await loadDashboard();
    }

    document.getElementById('controls').addEventListener('submit', event => {
      event.preventDefault();
      loadDashboard();
    });
    document.getElementById('period').addEventListener('change', syncCustomPeriodControls);
    document.getElementById('hourlyTimezone').addEventListener('change', event => {
      writeTimezoneOffset(clampTimezoneOffset(event.target.value));
      if (state.currentActivity) {
        renderCharts(state.currentActivity);
      }
    });
    document.getElementById('saveNotifications').addEventListener('click', saveNotifications);
    setupHourlyTimezoneControl();
    setupCustomPeriodDefaults();
    syncCustomPeriodControls();
    if (principal?.type === 'telegram') {
      showDashboardShell();
      loadChats();
    } else {
      showLogin();
    }
  </script>
</body>
</html>`;
}
