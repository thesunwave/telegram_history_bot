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
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #18202a;
      --muted: #667085;
      --line: #d9dee7;
      --accent: #176b87;
      --accent-strong: #0f4f66;
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
      grid-template-columns: minmax(260px, 1fr) 160px auto;
      gap: 12px;
      align-items: end;
      margin-bottom: 20px;
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
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      min-width: 0;
    }
    section.wide { grid-column: 1 / -1; }
    h2 {
      margin: 0 0 12px;
      font-size: 16px;
      letter-spacing: 0;
    }
    .metric {
      font-size: 32px;
      font-weight: 750;
      line-height: 1;
      margin-bottom: 12px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .metricBox {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      min-width: 0;
    }
    .metricBox .metric {
      font-size: 26px;
      margin-bottom: 4px;
    }
    .metricLabel {
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    table {
      width: 100%;
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
    .hidden { display: none !important; }
    @media (max-width: 720px) {
      .topbar { align-items: flex-start; flex-direction: column; padding: 14px 0; }
      form.controls { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr; }
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
        </select>
      </label>
      <button type="submit">Обновить</button>
    </form>
    <div id="status" class="status hidden"></div>
    <div class="grid hidden" id="dashboard">
      <section>
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
        </div>
        <table>
          <thead><tr><th>Пользователь</th><th>Сообщения</th><th>Слова</th><th>Слов/сообщ.</th></tr></thead>
          <tbody id="activityUsers"></tbody>
        </table>
      </section>
      <section>
        <h2>Болтуны</h2>
        <table>
          <thead><tr><th>Пользователь</th><th>Слова</th><th>Сообщения</th><th>Слов/сообщ.</th></tr></thead>
          <tbody id="activityTalkers"></tbody>
        </table>
      </section>
      <section>
        <h2>Мат</h2>
        <table>
          <thead><tr><th>Пользователь</th><th>Счет</th></tr></thead>
          <tbody id="profanityUsers"></tbody>
        </table>
      </section>
      <section>
        <h2>Слова</h2>
        <table>
          <thead><tr><th>Слово</th><th>Счет</th></tr></thead>
          <tbody id="profanityWords"></tbody>
        </table>
      </section>
      <section>
        <h2>УК РФ</h2>
        <table>
          <thead><tr><th>Пользователь</th><th>Нарушения</th></tr></thead>
          <tbody id="criminalUsers"></tbody>
        </table>
      </section>
      <section class="wide">
        <h2>Автоуведомления</h2>
        <label class="check"><input type="checkbox" id="notificationsEnabled"> Включены</label>
        <div class="toggles" id="notificationTypes"></div>
        <button class="secondary" id="saveNotifications" type="button">Сохранить настройки</button>
      </section>
    </div>
  </main>
  <script>
    const botUsername = ${botUsername};
    const principal = ${principal};
    const state = { chatId: '', period: 'today', notificationTypes: [], chats: [] };
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
        if (isCurrentUser) {
          const currentUser = document.createElement('strong');
          currentUser.textContent = row[nameKey];
          name.append(currentUser);
        } else {
          name.textContent = row[nameKey];
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

    function renderNotifications(settings, types) {
      state.notificationTypes = types;
      document.getElementById('notificationsEnabled').checked = Boolean(settings?.enabled);
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
          await loadDashboard();
        } else {
          setStatus('Чаты появятся после новых сообщений или после обнаружения старых счетчиков.');
        }
      } catch (error) {
        setStatus(error.message || String(error), true);
      }
    }

    async function loadDashboard() {
      const chatId = document.getElementById('chatSelect').value;
      const period = document.getElementById('period').value;
      if (!chatId) return;
      state.chatId = chatId;
      state.period = period;
      setStatus('Загрузка...');

      try {
        const [statsRes, notificationsRes] = await Promise.all([
          fetch('/admin/api/chat?chatId=' + encodeURIComponent(chatId) + '&period=' + encodeURIComponent(period)),
          fetch('/admin/api/notifications?chatId=' + encodeURIComponent(chatId))
        ]);
        if (!statsRes.ok) throw new Error(await statsRes.text());
        if (!notificationsRes.ok) throw new Error(await notificationsRes.text());

        const stats = await statsRes.json();
        const notifications = await notificationsRes.json();

        document.getElementById('activityTotal').textContent = String(stats.activity.total);
        document.getElementById('activityWords').textContent = String(stats.activity.totalWords || 0);
        document.getElementById('activityWordsPerMessage').textContent = String(stats.activity.wordsPerMessage || 0);
        renderActivityRows('activityUsers', stats.activity.topUsers || [], 'messages');
        renderActivityRows('activityTalkers', stats.activity.topTalkers || [], 'words');
        renderRows('profanityUsers', stats.profanity.topUsers, 'username', 'count');
        renderRows('profanityWords', stats.profanity.topWords, 'word', 'count');
        renderRows('criminalUsers', stats.criminal.topUsers, 'username', 'count');
        renderNotifications(notifications.settings, notifications.availableTypes);
        setStatus('Обновлено');
      } catch (error) {
        setStatus(error.message || String(error), true);
      }
    }

    async function saveNotifications() {
      if (!state.chatId) return;
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
    document.getElementById('saveNotifications').addEventListener('click', saveNotifications);
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
