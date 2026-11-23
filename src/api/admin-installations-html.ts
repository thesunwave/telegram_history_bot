/** Installation list accessible through the bot owner's Telegram session. */
export function renderInstallationsHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Установки бота</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: light-dark(#f4f6f8, #15181e); color: light-dark(#19212c, #e5e9f0); }
    main { max-width: 1200px; margin: 32px auto; padding: 24px; }
    section { background: light-dark(white, #20252e); padding: 24px; border-radius: 16px; }
    h1 { font-size: 26px; margin: 8px 0 16px; }
    a { color: light-dark(#265bb0, #9ac1ff); }
    .muted { opacity: .75; }
    button { padding: 10px 16px; border: 1px solid #8793a3; border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
    button:disabled { opacity: .5; }
    .tableScroll { overflow-x: auto; margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; min-width: 850px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #8793a355; overflow-wrap: anywhere; }
    th { font-size: 13px; }
    @media (max-width: 600px) { main { margin: 12px auto; padding: 12px; } section { padding: 16px; } }
  </style>
</head>
<body><main>
  <a href="/admin">← Админка</a>
  <section id="selfHostedPanel" hidden>
    <h1>Анонимная телеметрия</h1>
    <p id="selfHostedSummary" aria-live="polite"></p>
    <p class="muted">Считаются анонимные ID с активностью чатов за 7 дней или сигналами в разные дни. Разовые сигналы без активности скрыты, поскольку среди них есть тестовые. По этим данным нельзя установить число реальных пользователей. Показаны до 200 ID, даты в UTC.</p>
    <div class="tableScroll"><table aria-label="Анонимная телеметрия">
      <thead><tr><th>Анонимный ID</th><th>Первый сигнал</th><th>Последний сигнал</th><th>Дней с сигналами</th><th>Чатов за 7 дней</th><th>Групп за 7 дней</th></tr></thead>
      <tbody id="selfHostedRows"></tbody>
    </table></div>
  </section>
  <section id="installationsPanel">
    <h1>Чаты этого бота</h1>
    <p class="muted" id="installationsSummary" aria-live="polite"></p>
    <p class="muted">Статусы фиксируются с момента включения учёта. Для старых чатов дата установки и статус могут быть неизвестны. Личные чаты — обращения к боту.</p>
    <button type="button" id="refreshInstallations">Обновить установки</button>
    <div class="tableScroll">
      <table aria-label="Установки бота">
        <thead><tr><th>Чат / ID</th><th>Достижения</th><th>Тип</th><th>Статус бота</th><th>Последняя установка</th><th>Изменение статуса</th><th>Последнее сообщение</th></tr></thead>
        <tbody id="installationRows"></tbody>
      </table>
    </div>
  </section>
</main><script>
    function achievementsCell(row) {
      const cell = document.createElement('td');
      if (row.achievementsEnabled !== false) {
        cell.textContent = row.achievementsEnabled === true ? 'Включены' : '—';
        return cell;
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Включить';
      button.setAttribute('aria-label', 'Включить достижения в чате «' + row.title + '»');
      const status = document.createElement('div');
      status.setAttribute('role', 'status');
      cell.append(button, status);
      button.addEventListener('click', async () => {
        button.disabled = true;
        status.textContent = 'Включаем…';
        try {
          const res = await fetch('/admin/api/installations/achievements?chatId=' +
            encodeURIComponent(row.chatId), { method: 'POST' });
          const body = await res.json();
          if (!res.ok || body.ok !== true) {
            status.textContent = res.status === 401 ? 'Войдите в админку ещё раз.'
              : body.error || 'Не удалось включить достижения. Попробуйте ещё раз.';
            return;
          }
          button.hidden = true;
          status.textContent = 'Включены';
        } catch {
          status.textContent = 'Не удалось включить достижения. Попробуйте ещё раз.';
        } finally {
          button.disabled = false;
        }
      });
      return cell;
    }

    async function loadInstallations() {
      const panel = document.getElementById('installationsPanel');
      const summary = document.getElementById('installationsSummary');
      const button = document.getElementById('refreshInstallations');
      panel.classList.remove('hidden');
      button.disabled = true;
      summary.textContent = 'Загрузка установок...';
      try {
        const res = await fetch('/admin/api/installations');
        if (!res.ok) throw new Error('installations unavailable');
        const body = await res.json();
        const hosted = body.selfHosted;
        document.getElementById('selfHostedPanel').hidden = !hosted;
        if (hosted) {
          document.getElementById('selfHostedSummary').textContent =
            'Анонимных ID после фильтра: ' + hosted.total + ' · Из них с сигналом за 7 дней: ' + hosted.active7d;
          const target = document.getElementById('selfHostedRows');
          target.replaceChildren();
          for (const install of hosted.rows || []) {
            const tr = document.createElement('tr');
            for (const value of [install.install_id, install.first_seen, install.last_seen,
              install.ping_days, install.active_chats_7d, install.active_groups_7d]) {
              const td = document.createElement('td');
              td.textContent = String(value);
              tr.append(td);
            }
            target.append(tr);
          }
          if (!hosted.rows?.length) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 6;
            td.textContent = 'Пока нет сигналов, прошедших фильтр';
            tr.append(td);
            target.append(tr);
          }
        }
        const rows = body.installations || [];
        const active = rows.filter(row => row.membership?.active === true).length;
        const inactive = rows.filter(row => row.membership?.active === false).length;
        summary.textContent = (body.scope === 'all' ? 'Все известные чаты' : 'Доступные вам чаты') +
          ': ' + rows.length + ' · Активных: ' + active + ' · Удалён / заблокирован: ' + inactive +
          ' · Статус неизвестен: ' + (rows.length - active - inactive);
        const tbody = document.getElementById('installationRows');
        tbody.replaceChildren();
        const statuses = { creator: 'Владелец', administrator: 'Администратор', member: 'Участник',
          restricted: 'Ограничен', left: 'Удалён / вышел', kicked: 'Заблокирован' };
        const types = { private: 'Личный', group: 'Группа', supergroup: 'Супергруппа', channel: 'Канал' };
        const date = value => value ? new Date(value * 1000).toLocaleString('ru-RU') : 'Неизвестно';
        for (const row of rows) {
          const tr = document.createElement('tr');
          tr.id = 'installation-' + row.chatId;
          const membership = row.membership;
          const values = [row.title + ' (' + row.chatId + ')', types[row.type] || 'Неизвестно',
            membership ? statuses[membership.status] + (membership.active ? ' · активен' : ' · неактивен') : 'Неизвестно',
            date(membership?.installedAt), date(membership?.statusChangedAt), date(row.lastSeenAt)];
          for (const value of values) {
            const cell = document.createElement('td');
            cell.textContent = value;
            tr.append(cell);
          }
          tr.insertBefore(achievementsCell(row), tr.children[1]);
          tbody.append(tr);
        }
        const targetRow = document.getElementById(location.hash.slice(1));
        if (targetRow?.parentElement === tbody) targetRow.scrollIntoView({ block: 'center' });
        if (!rows.length) {
          const cell = document.createElement('td');
          cell.colSpan = 7;
          cell.textContent = 'Известных установок пока нет';
          const tr = document.createElement('tr');
          tr.append(cell);
          tbody.append(tr);
        }
      } catch (_error) {
        summary.textContent = 'Не удалось обновить установки. Попробуйте ещё раз.';
      } finally {
        button.disabled = false;
      }
    }


    document.getElementById('refreshInstallations').addEventListener('click', loadInstallations);
    loadInstallations();
</script></body></html>`;
}
