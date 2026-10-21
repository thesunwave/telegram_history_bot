interface AdminHtmlOptions {
  botUsername?: string | null; // Legacy caller compatibility; OIDC uses a Client ID instead.
  canAccessSetup?: boolean;
  principal: {
    type: string;
    username: string;
    displayName?: string;
    telegramId?: number;
  } | null;
}

const NAV_ICONS = {
  overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z"/>',
  people:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 010 7M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/>',
  media: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  profanity: '<path d="M4 5h16v11H8l-4 4z"/><path d="M9 9l6 4M15 9l-6 4"/>',
  criminal: '<path d="M12 3l8 4v5c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V7z"/>',
  notifications: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4"/>',
  lab: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/>',
  chats: '<path d="M4 5h11v8H8l-4 3z"/><path d="M15 9h5v8l-3-2h-6v-2"/>',
  modules: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  setup:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
} as const;

function navIcon(name: keyof typeof NAV_ICONS): string {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[name]}</svg>`;
}

export function renderAdminHtml(options: AdminHtmlOptions): string {
  const principal = JSON.stringify(options.principal || null);
  const isTelegram = options.principal?.type === 'telegram';
  const setupLink = isTelegram && options.canAccessSetup
    ? `<a class="navLink" href="/admin/setup" title="Настройки всего экземпляра бота, доступные владельцу">${navIcon('setup')}<span>Настройки бота</span></a>`
    : '';
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>История чатов · админка</title>
  <script>
    (() => {
      try {
        const storedTheme = localStorage.getItem('telegramStatsAdmin.theme');
        document.documentElement.dataset.themeMode =
          ['system', 'light', 'dark'].includes(storedTheme) ? storedTheme : 'system';
      } catch (_error) {
        document.documentElement.dataset.themeMode = 'system';
      }
    })();
    // iOS Safari ignores user-scalable=no, so block pinch zoom explicitly.
    for (const type of ['gesturestart', 'gesturechange']) {
      document.addEventListener(type, event => event.preventDefault(), { passive: false });
    }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f5f7;
      --panel: #ffffff;
      --surface: #f6f8fa;
      --text: #121a23;
      --text-2: #3b4654;
      --muted: #5b6675;
      --line: #dde2e9;
      --line-soft: #eef1f4;
      --track: #eef1f4;
      --accent: #176b87;
      --accent-strong: #0f4f66;
      --accent-soft: #e6f1f4;
      --accent-mid: #8fbfcf;
      --orange: #c8691f;
      --orange-mid: #e7a56b;
      --orange-light: #f3d2b3;
      --orange-soft: #fcefe4;
      --orange-text: #7a3e0e;
      --criminal-text: #9a4a12;
      --purple: #6d5bd0;
      --green: #16825d;
      --good: #0e6b47;
      --good-soft: #e3f4ec;
      --bad: #a3341f;
      --bad-soft: #fbe4df;
      --danger: #b42318;
      --input: #ffffff;
      --seg: #e8ecf0;
      --shadow: rgba(18, 26, 35, .12);
      --chart-grid: #eef1f4;
      --chart-tooltip-bg: #121a23;
      --chart-tooltip-text: #ffffff;
      --skeleton-base: #eef1f4;
      --skeleton-highlight: #f7f8fa;
    }
    :root[data-theme-mode="dark"] {
      color-scheme: dark;
      --bg: #0f1419;
      --panel: #171d24;
      --surface: #1c242d;
      --text: #f2f5f7;
      --text-2: #c9d2db;
      --muted: #a9b4c0;
      --line: #2b3540;
      --line-soft: #222b35;
      --track: #26303b;
      --accent: #62b6d2;
      --accent-strong: #8bd3e9;
      --accent-soft: #132a34;
      --accent-mid: #3c7f96;
      --orange: #f2a15f;
      --orange-mid: #c47b3f;
      --orange-light: #7a4a26;
      --orange-soft: #33241a;
      --orange-text: #f6c493;
      --criminal-text: #f2a15f;
      --purple: #a99df5;
      --green: #50c891;
      --good: #6fd6a6;
      --good-soft: #15302a;
      --bad: #ff9a8f;
      --bad-soft: #3a1d1a;
      --danger: #ff8f86;
      --input: #10161d;
      --seg: #222b35;
      --shadow: rgba(0, 0, 0, .45);
      --chart-grid: #28333e;
      --chart-tooltip-bg: #0b1015;
      --chart-tooltip-text: #f2f5f7;
      --skeleton-base: #222b35;
      --skeleton-highlight: #303b47;
    }
    @media (prefers-color-scheme: dark) {
      :root[data-theme-mode="system"] {
        color-scheme: dark;
        --bg: #0f1419;
        --panel: #171d24;
        --surface: #1c242d;
        --text: #f2f5f7;
        --text-2: #c9d2db;
        --muted: #a9b4c0;
        --line: #2b3540;
        --line-soft: #222b35;
        --track: #26303b;
        --accent: #62b6d2;
        --accent-strong: #8bd3e9;
        --accent-soft: #132a34;
        --accent-mid: #3c7f96;
        --orange: #f2a15f;
        --orange-mid: #c47b3f;
        --orange-light: #7a4a26;
        --orange-soft: #33241a;
        --orange-text: #f6c493;
        --criminal-text: #f2a15f;
        --purple: #a99df5;
        --green: #50c891;
        --good: #6fd6a6;
        --good-soft: #15302a;
        --bad: #ff9a8f;
        --bad-soft: #3a1d1a;
        --danger: #ff8f86;
        --input: #10161d;
        --seg: #222b35;
        --shadow: rgba(0, 0, 0, .45);
        --chart-grid: #28333e;
        --chart-tooltip-bg: #0b1015;
        --chart-tooltip-text: #f2f5f7;
        --skeleton-base: #222b35;
        --skeleton-highlight: #303b47;
      }
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; touch-action: pan-x pan-y; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    a { color: var(--accent); }
    a:hover { color: var(--accent-strong); }
    button, input, select { font: inherit; color: inherit; }
    h1, h2, h3 { margin: 0; }
    .hidden { display: none !important; }
    .muted { color: var(--muted); }
    .num { font-variant-numeric: tabular-nums; }
    .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }

    .app { display: flex; flex-wrap: wrap; min-height: 100vh; }
    .sidebar {
      flex: 1 1 232px;
      max-width: 260px;
      padding: 20px 14px;
      background: var(--panel);
      border-right: 1px solid var(--line);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 10px; padding: 0 6px; font-weight: 700; font-size: 15px; }
    .brandMark {
      width: 32px; height: 32px; border-radius: 9px; background: var(--accent); color: #fff;
      display: flex; align-items: center; justify-content: center; font-weight: 700;
    }
    .chatSwitcher { display: flex; flex-direction: column; gap: 6px; }
    .chatSwitcher select {
      width: 100%; min-height: 44px; padding: 8px 10px; border: 1px solid var(--line);
      border-radius: 12px; background: var(--surface); font-weight: 600;
    }
    .navGroup { display: flex; flex-direction: column; gap: 2px; }
    .navLabel {
      font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
      color: var(--muted); padding: 0 12px;
    }
    .navLink {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px;
      color: var(--text-2); text-decoration: none; font-weight: 500; min-height: 40px;
    }
    .navLink:hover { background: var(--surface); color: var(--text); }
    .navLink[aria-current="page"] { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
    .navDivider { height: 1px; background: var(--line-soft); }
    .sidebarFooter {
      margin-top: auto; display: flex; flex-direction: column; gap: 10px;
      padding: 12px 6px 0; border-top: 1px solid var(--line-soft);
    }
    .sidebarFooterRow { display: flex; align-items: center; gap: 8px; }
    .themeControl { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
    .themeControl select {
      min-height: 36px; border: 1px solid var(--line); border-radius: 9px; background: var(--input); padding: 4px 8px;
    }
    .logoutForm { margin: 0 0 0 auto; }

    .main {
      flex: 999 1 560px; min-width: 0; padding: 28px 32px 48px;
      display: flex; flex-direction: column; gap: 20px; max-width: 1240px;
    }
    .pageHeader { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 14px; }
    .pageTitle { display: flex; flex-direction: column; gap: 6px; }
    .pageTitle h1 { font-size: 26px; font-weight: 700; }
    .status { font-size: 13px; color: var(--muted); }
    .status.error { color: var(--danger); }
    .liveDot {
      display: inline-flex; align-items: center; gap: 6px; color: var(--good); background: var(--good-soft);
      padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 12px; margin-right: 6px;
    }
    .liveDot::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .seg { display: flex; gap: 2px; padding: 3px; background: var(--seg); border-radius: 11px; }
    .seg button {
      border: 0; background: transparent; font-size: 13px; font-weight: 500; color: var(--text-2);
      padding: 8px 14px; border-radius: 8px; cursor: pointer; min-height: 36px; white-space: nowrap;
    }
    .seg button[aria-pressed="true"] { background: var(--panel); color: var(--text); box-shadow: 0 1px 2px var(--shadow); font-weight: 600; }
    .customPeriod { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
    input[type="date"] {
      min-height: 36px; border: 1px solid var(--line); border-radius: 9px; background: var(--input); padding: 4px 8px;
    }
    button.primary, button.secondary {
      min-height: 36px; padding: 8px 14px; border-radius: 10px; font-weight: 600; cursor: pointer;
    }
    button.primary { border: 0; background: var(--accent); color: #fff; }
    button.secondary { border: 1px solid var(--line); background: var(--panel); color: var(--text); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .iconButton {
      width: 36px; height: 36px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel);
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0;
    }

    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px; min-width: 0; }
    .cardHead { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .cardHead h2 { font-size: 16px; font-weight: 600; }
    .cardHint { font-size: 12px; color: var(--muted); }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .span-3 { grid-column: span 3; }
    .span-4 { grid-column: span 4; }
    .span-5 { grid-column: span 5; }
    .span-6 { grid-column: span 6; }
    .span-7 { grid-column: span 7; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    .stack { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

    .kpi { display: flex; flex-direction: column; gap: 6px; padding: 18px; }
    .kpiLabel { font-size: 13px; color: var(--muted); font-weight: 500; display: flex; align-items: center; gap: 8px; }
    .kpiValue { font-size: 30px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    .kpiFoot { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; min-height: 26px; }
    .kpiHint { font-size: 12px; color: var(--muted); }
    .delta { font-size: 12px; font-weight: 600; color: var(--muted); }
    .delta.up { color: var(--good); }
    .delta.down { color: var(--bad); }
    .spark { display: flex; align-items: flex-end; gap: 3px; height: 26px; }
    .spark span { width: 6px; border-radius: 2px; background: var(--line); }
    .spark span.last { background: var(--accent); }
    .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }

    .chartBox { position: relative; height: 220px; }
    .chartBox.short { height: 170px; }
    .chartEmpty { color: var(--muted); padding: 40px 0; text-align: center; }
    .chartHeadControls { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .chartHeadControls select {
      min-height: 32px; border: 1px solid var(--line); border-radius: 8px; background: var(--input); padding: 2px 6px;
    }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }

    .bucketList { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .bucketRow { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .bucketRow .bucketName { width: 58px; color: var(--muted); }
    .bucketRow .bucketLeader { flex: 1; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .tabs { display: flex; gap: 2px; flex-wrap: wrap; }
    .tab {
      border: 0; background: transparent; font-size: 13px; font-weight: 500; color: var(--muted);
      padding: 6px 10px; border-radius: 8px; cursor: pointer; min-height: 32px;
    }
    .tab[aria-selected="true"] { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }
    .tab.warm[aria-selected="true"] { background: var(--orange-soft); color: var(--orange-text); }
    .rankList { display: flex; flex-direction: column; }
    .rankRow {
      display: grid; grid-template-columns: 24px minmax(120px, 182px) minmax(40px, 1fr) 80px;
      align-items: center; gap: 12px; padding: 9px 4px; border-top: 1px solid var(--line-soft);
    }
    .rankRow .rankPerson { gap: 12px; }
    .rankRow .rank { font-size: 13px; color: var(--muted); text-align: right; }
    .rankRow .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rankRow .value { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
    .avatar {
      width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: #121a23; flex: none;
    }
    .bar { height: 10px; background: var(--track); border-radius: 5px; overflow: hidden; }
    .bar > span { display: block; height: 100%; border-radius: 5px; background: var(--accent); }
    .bar.thin { height: 6px; }
    .bar.warm > span { background: var(--orange); }
    .seeAll { font-size: 13px; font-weight: 600; margin-top: 10px; display: inline-block; }
    .miniRow { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .miniRow .name { flex: 1; font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .years { font-weight: 600; color: var(--criminal-text); font-variant-numeric: tabular-nums; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { font-size: 13px; padding: 5px 10px; border-radius: 999px; background: var(--orange-soft); color: var(--orange-text); }

    .tableScroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; }
    th {
      font-size: 12px; font-weight: 600; color: var(--muted); text-align: right;
      padding: 10px 12px; white-space: nowrap;
    }
    td { text-align: right; padding: 10px 12px; border-top: 1px solid var(--line-soft); font-variant-numeric: tabular-nums; white-space: nowrap; }
    th:first-child, td:first-child { text-align: left; }
    th button.sort {
      border: 0; background: transparent; font: inherit; color: inherit; cursor: pointer; padding: 0;
    }
    th button.sort[aria-pressed="true"] { color: var(--accent-strong); }
    .personCell { display: flex; align-items: center; gap: 10px; }
    .personCell .avatar { width: 28px; height: 28px; font-size: 12px; }
    .barCell { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
    .barCell .bar { width: 64px; height: 6px; }
    .barCell > b { min-width: 3.5em; text-align: right; }
    .weekRhythm { display: inline-grid; grid-template-columns: repeat(7, 10px); gap: 3px; vertical-align: middle; }
    .weekRhythm span { width: 10px; height: 18px; border-radius: 3px; }
    .peopleTable { min-width: 920px; }
    .peopleSort { display: none; }

    .heatmap-inactive { background: var(--track); }
    .heatmap-active { background: var(--accent-mid); }
    .heatmap-talkative { background: var(--accent); }
    .heatmapLegend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
    .heatmapLegendItem { display: inline-flex; align-items: center; gap: 5px; }
    .heatmapLegendSwatch { width: 12px; height: 12px; border-radius: 3px; border: 1px solid var(--line); }
    .rhythmHeatmap { border-collapse: separate; border-spacing: 8px 6px; width: auto; }
    .rhythmHeatmap th, .rhythmHeatmap td { padding: 0; border: 0; }
    .rhythmHeatmap th[scope="row"] { position: sticky; left: 0; z-index: 1; background: var(--panel); text-align: left; font-size: 14px; font-weight: 500; color: var(--text); padding-right: 8px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
    .rhythmHeatmap .heatmapDay { text-align: center; font-size: 12px; }
    .rhythmDay { display: grid; grid-template-columns: repeat(4, 14px); gap: 2px; }
    .heatmapCell { display: block; height: 22px; border-radius: 3px; }

    .mediaGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .mediaRow {
      display: grid; grid-template-columns: 30px minmax(70px, 120px) minmax(40px, 1fr) 52px 48px 56px 56px;
      gap: 10px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line-soft);
    }
    .mediaRow.head { border-top: 0; font-size: 12px; font-weight: 600; color: var(--muted); padding-top: 0; }
    .mediaRow > .r { text-align: right; font-variant-numeric: tabular-nums; }
    .mediaRow .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mediaRow.videoNote .bar > span { background: var(--orange); }

    .wordItem { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-top: 1px solid var(--line-soft); }
    .wordItem:first-of-type { border-top: 0; }
    .wordHead { display: flex; align-items: center; gap: 10px; }
    .wordHead strong { flex: 1; font-size: 15px; }
    .stacked { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; background: var(--track); }
    .stacked span:nth-child(1) { background: var(--orange); }
    .stacked span:nth-child(2) { background: var(--orange-mid); }
    .stacked span:nth-child(3) { background: var(--orange-light); }
    .wordWho { font-size: 12px; color: var(--muted); }

    .criminalLayout { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-start; }
    .criminalList { flex: 1 1 300px; max-width: 400px; padding: 12px; display: flex; flex-direction: column; gap: 4px; }
    .criminalUserButton {
      display: grid; grid-template-columns: 30px 1fr auto; gap: 10px; align-items: center; text-align: left;
      width: 100%; border: 1px solid transparent; background: transparent; border-radius: 10px;
      padding: 10px; cursor: pointer; min-height: 56px;
    }
    .criminalUserButton:hover { background: var(--surface); }
    .criminalUserButton[aria-expanded="true"] { background: var(--accent-soft); border-color: var(--accent-mid); }
    .criminalUserMeta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .criminalUserMeta strong, .criminalUserMeta span:first-child { font-weight: 600; }
    .criminalUserMeta small { font-size: 12px; color: var(--muted); }
    .criminalDetails { flex: 999 1 480px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
    .criminalDetailsHeader { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .criminalDetailsHeader h3 { font-size: 18px; font-weight: 700; }
    .criminalConfidenceNote { font-size: 12px; color: var(--muted); margin: 0; }
    .criminalViolationList { display: flex; flex-direction: column; gap: 12px; }
    .criminalViolationCard {
      border: 1px solid var(--line); border-radius: 12px; padding: 16px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .criminalViolationHead { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
    .criminalViolationTitle { font-weight: 700; font-size: 15px; }
    .criminalBadges { display: flex; gap: 6px; flex-wrap: wrap; }
    .criminalBadge { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; background: var(--surface); color: var(--text-2); white-space: nowrap; }
    .criminalBadge.severe { background: var(--bad-soft); color: var(--bad); }
    .criminalField { display: flex; flex-direction: column; gap: 4px; }
    .criminalFieldLabel { font-size: 12px; font-weight: 600; color: var(--muted); }
    .criminalTrigger { margin: 0; padding: 10px 12px; background: var(--surface); border-radius: 8px; color: var(--text-2); white-space: pre-wrap; }
    .criminalContext { display: flex; flex-direction: column; gap: 6px; }
    .criminalContextMessage { padding: 8px 10px; border-radius: 8px; background: var(--surface); }
    .criminalContextMeta { font-size: 12px; color: var(--muted); }
    .criminalOccurredAt { font-size: 12px; color: var(--muted); }

    .narrow { width: 100%; max-width: 760px; }
    .switchRow { display: flex; align-items: center; gap: 16px; padding: 14px 0; border-top: 1px solid var(--line-soft); cursor: pointer; }
    .switchRow:first-of-type { border-top: 0; }
    .switchText { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .switchText strong { font-weight: 500; font-size: 15px; }
    .switchText span { font-size: 13px; color: var(--muted); }
    input.switch {
      appearance: none; -webkit-appearance: none; flex: none; width: 44px; height: 26px; border-radius: 13px;
      background: var(--line); position: relative; cursor: pointer; margin: 0; transition: background .15s;
    }
    input.switch::after {
      content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
      background: #fff; box-shadow: 0 1px 2px rgba(18, 26, 35, .25); transition: transform .15s;
    }
    input.switch:checked { background: var(--accent); }
    input.switch:checked::after { transform: translateX(18px); }
    input.switch:disabled { opacity: .5; cursor: not-allowed; }
    .notificationGroupTitle { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 2px; }
    .formActions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; flex-wrap: wrap; }

    .shadowSummary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    .shadowMetric { display: flex; flex-direction: column; gap: 6px; padding: 16px; }
    .shadowMetric strong { font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .shadowMetric span { font-size: 13px; color: var(--muted); }
    .shadowList { display: flex; flex-direction: column; gap: 12px; }
    .shadowCard { border: 1px solid var(--line); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .shadowCardHead { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
    .shadowColumns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .shadowProvider { display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 8px; background: var(--surface); min-width: 0; }
    .shadowProvider h3 { font-size: 13px; font-weight: 600; }
    .shadowProviderLine { font-size: 13px; overflow-wrap: anywhere; }
    .shadowCompareLine { display: flex; flex-wrap: wrap; gap: 4px; }
    .matchChip { font-size: 12px; font-weight: 600; padding: 2px 7px; border-radius: 6px; background: var(--surface); color: var(--muted); }
    .matchChip.ok { background: var(--good-soft); color: var(--good); }
    .matchChip.miss { background: var(--bad-soft); color: var(--bad); }
    .shadowRaw summary { cursor: pointer; font-size: 13px; color: var(--accent); }
    .shadowRaw pre {
      white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.5 'IBM Plex Mono', ui-monospace, monospace;
      background: var(--surface); padding: 10px; border-radius: 8px; max-height: 360px; overflow: auto;
    }

    .chatGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
    .chatCard { display: flex; flex-direction: column; gap: 12px; }
    .chatCard[aria-current="true"] { border-color: var(--accent-mid); }
    .chatCardHead { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .chatCardHead h2 { flex: 1; font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .roleBadge { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 6px; background: var(--surface); color: var(--text-2); white-space: nowrap; }
    .roleBadge.admin { background: var(--accent-soft); color: var(--accent-strong); }
    .chatPulse { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .chatPulse div { display: flex; flex-direction: column; gap: 2px; }
    .chatPulse strong { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .chatPulse span { font-size: 12px; color: var(--muted); }
    .chatPulse .lastActive strong { font-size: 15px; line-height: 27px; }
    .moduleChips { display: flex; flex-wrap: wrap; gap: 6px; }
    .moduleChip { font-size: 12px; padding: 3px 8px; border-radius: 999px; background: var(--good-soft); color: var(--good); }
    .moduleChip.off { background: var(--surface); color: var(--muted); text-decoration: line-through; }
    .moduleChip.note { background: var(--surface); color: var(--text-2); }
    .chatCard .formActions { justify-content: flex-start; }
    .selectInput {
      flex: none; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--input); color: var(--text); font: inherit; font-size: 14px;
    }
    .personButton {
      display: inline-flex; align-items: center; gap: 10px; padding: 0; border: 0; background: none;
      color: inherit; font: inherit; cursor: pointer; text-align: left; min-width: 0;
    }
    .personButton:hover .name { color: var(--accent-strong); text-decoration: underline; }
    .memberDialog {
      width: min(860px, calc(100vw - 24px)); max-height: calc(100vh - 32px); padding: 20px;
      border: 1px solid var(--line); border-radius: 16px; background: var(--bg); color: var(--text);
      box-shadow: 0 20px 60px var(--shadow);
    }
    .memberDialog::backdrop { background: rgba(10, 14, 18, .45); }
    .memberHead { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
    .memberAvatar { width: 48px; height: 48px; font-size: 20px; flex: none; }
    .memberTitle { flex: 1; min-width: 0; }
    .memberTitle h2 { font-size: 20px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .memberBody { display: flex; flex-direction: column; gap: 14px; }
    .memberCols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .memberBuckets { display: flex; flex-direction: column; gap: 10px; }
    .memberBucket { display: grid; grid-template-columns: 58px minmax(0, 1fr) 44px; align-items: center; gap: 10px; font-size: 13px; }
    .memberBucket .bars { display: flex; flex-direction: column; gap: 3px; }
    .memberBucket .bar.chat > span { background: var(--line); }
    .memberLegend { font-size: 12px; color: var(--muted); display: flex; gap: 12px; margin-top: 4px; }
    .memberLegend span { display: inline-flex; align-items: center; gap: 5px; }

    .login { max-width: 460px; margin: 10vh auto 0; display: flex; flex-direction: column; gap: 12px; }
    .login h2 { font-size: 20px; }
    .statsError { display: flex; flex-direction: column; gap: 10px; }
    .statsError h2 { font-size: 18px; }
    .statsError p { margin: 0; color: var(--text-2); }
    .statsErrorActions { display: flex; gap: 8px; }

    .isLoading .view .card { position: relative; }
    .isLoading .view .kpiValue, .isLoading .view .chartBox, .isLoading .view .rankList,
    .isLoading .view table, .isLoading .view .bucketList {
      color: transparent;
      background: linear-gradient(90deg, var(--skeleton-base), var(--skeleton-highlight), var(--skeleton-base));
      background-size: 200% 100%;
      animation: skeleton 1.2s ease-in-out infinite;
      border-radius: 8px;
    }
    .isLoading .view .chartBox canvas, .isLoading .view .rankList *, .isLoading .view table *, .isLoading .view .bucketList * { visibility: hidden; }
    @keyframes skeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (prefers-reduced-motion: reduce) { .isLoading .view * { animation: none !important; } }

    @media (max-width: 1080px) {
      .span-3 { grid-column: span 6; }
      .span-4, .span-5, .span-7, .span-8 { grid-column: span 12; }
      .shadowSummary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 860px) {
      .app { flex-direction: column; flex-wrap: nowrap; }
      .sidebar {
        max-width: none; flex: none; border-right: 0; border-bottom: 1px solid var(--line);
        padding: 12px 16px; gap: 10px;
      }
      .brand { display: none; }
      .chatSwitcher .navLabel { display: none; }
      .navLabel, .navDivider { display: none; }
      .navGroup { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
      .navGroup.settings { grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); }
      .navLink {
        justify-content: center; text-align: center; height: 40px; min-height: 40px; padding: 0 4px;
        border: 1px solid var(--line); border-radius: 8px; background: var(--surface);
        font-size: 13px; line-height: 1; white-space: nowrap;
      }
      .navLink svg { display: none; }
      .navLink[aria-current="page"] { background: var(--accent); border-color: var(--accent); color: #fff; }
      .navLink span { overflow: hidden; text-overflow: ellipsis; }
      .sidebarFooter { margin-top: 0; padding-top: 10px; flex-direction: row; flex-wrap: wrap; align-items: center; justify-content: space-between; }
      .main { padding: 16px 16px 40px; }
      .pageTitle h1 { font-size: 22px; }
      .controls, .seg { width: 100%; }
      .seg button { flex: 1; padding: 8px 4px; }
      .span-3 { grid-column: span 6; }
      .span-6 { grid-column: span 12; }
      .kpi { padding: 14px; }
      .kpiValue { font-size: 24px; }
      .spark { display: none; }
      .mediaGrid { grid-template-columns: 1fr; }
      .memberCols { grid-template-columns: 1fr; }
      .memberDialog { padding: 14px; }
      .memberAvatar { width: 40px; height: 40px; font-size: 17px; }
      .memberTitle h2 { font-size: 18px; }
      .memberMeta { font-size: 13px; }
      .shadowColumns { grid-template-columns: 1fr; }
      .rankRow { grid-template-columns: 20px minmax(90px, 1fr) 56px; }
      .rankRow .bar { display: none; }
      .mediaRow { grid-template-columns: 28px minmax(60px, 1fr) 44px 40px 48px 48px; }
      .mediaRow .bar, .mediaRow .barHead { display: none; }

      .peopleHint { display: none; }
      .peopleSort { display: flex; align-items: center; gap: 8px; width: 100%; font-size: 13px; color: var(--muted); }
      .peopleSort .selectInput { flex: 1; min-width: 0; }
      .peopleTable { min-width: 0; }
      .peopleTable thead { display: none; }
      .peopleTable, .peopleTable tbody { display: block; }
      .peopleTable tr {
        display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 12px;
        padding: 14px 0; border-top: 1px solid var(--line-soft);
      }
      .peopleTable tr:first-child { border-top: 0; padding-top: 2px; }
      .peopleTable td {
        display: flex; flex-direction: column; gap: 2px; min-width: 0;
        padding: 0; border: 0; text-align: left; white-space: normal;
      }
      .peopleTable td::before { content: attr(data-label); font-size: 12px; font-weight: 500; color: var(--muted); }
      .peopleTable td.peopleWide { grid-column: 1 / -1; }
      .peopleTable td.peopleRhythm { grid-column: span 2; }
      .peopleTable td.peopleName::before, .peopleTable td.peopleEmpty::before { content: none; }
      .peopleTable td.peopleName .avatar { width: 32px; height: 32px; font-size: 13px; }
      .peopleTable td.peopleName .name { font-size: 15px; font-weight: 600; }
      .peopleTable .barCell { justify-content: flex-start; }
      .peopleTable .barCell .bar { flex: 1; width: auto; }
      .peopleTable .barCell > b { order: -1; min-width: 0; text-align: left; }
      .peopleTable .weekRhythm { grid-template-columns: repeat(7, minmax(0, 22px)); gap: 3px; }
      .peopleTable .weekRhythm span { width: auto; }
    }
    /* Inputs under 16px make iOS Safari zoom in on focus. */
    @media (max-width: 860px), (pointer: coarse) {
      input, select, textarea, .selectInput { font-size: 16px !important; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar${isTelegram ? '' : ' hidden'}" id="sidebar">
      <div class="brand"><span class="brandMark">И</span>История чатов</div>
      <label class="chatSwitcher"><span class="navLabel">Чат</span>
        <select id="chatSelect" name="chatId" aria-label="Чат">
          <option value="">Загрузка чатов...</option>
        </select>
      </label>
      <nav class="navGroup" aria-label="Разделы">
        <a class="navLink" href="#overview" data-view-link="overview">${navIcon('overview')}<span>Обзор</span></a>
        <a class="navLink" href="#people" data-view-link="people">${navIcon('people')}<span>Люди</span></a>
        <a class="navLink" href="#media" data-view-link="media">${navIcon('media')}<span>Голос</span></a>
        <a class="navLink" href="#profanity" data-view-link="profanity">${navIcon('profanity')}<span>Мат</span></a>
        <a class="navLink" href="#criminal" data-view-link="criminal">${navIcon('criminal')}<span>УК РФ</span></a>
      </nav>
      <div class="navDivider"></div>
      <div class="navLabel">Настройки чата</div>
      <nav class="navGroup settings" aria-label="Настройки">
        <a class="navLink" href="#chats" data-view-link="chats">${navIcon('chats')}<span>Все чаты</span></a>
        <a class="navLink" href="#modules" data-view-link="modules">${navIcon('modules')}<span>Модули</span></a>
        <a class="navLink" href="#notifications" data-view-link="notifications">${navIcon('notifications')}<span>Уведомления</span></a>
        <a class="navLink" href="#lab" data-view-link="lab">${navIcon('lab')}<span>Модели</span></a>
        ${setupLink}
      </nav>
      <div class="sidebarFooter">
        <div class="muted" id="sessionLabel"></div>
        <div class="sidebarFooterRow">
          <label class="themeControl">Тема
            <select id="themeSelect" aria-label="Тема оформления">
              <option value="system">Система</option>
              <option value="light">День</option>
              <option value="dark">Ночь</option>
            </select>
          </label>
          ${isTelegram ? `<form class="logoutForm" action="/admin/logout" method="post">
          <button type="submit" class="secondary logoutButton">Выйти</button>
        </form>` : ''}
        </div>
      </div>
    </aside>

    <main class="main" id="main">
      <section class="card login hidden" id="loginPanel">
        <h2>Вход через Telegram</h2>
        <p>После входа будут показаны только чаты, где ваш Telegram-пользователь состоит участником.</p>
        <div id="telegramLogin"><button type="button" class="primary" id="telegramLoginButton" disabled>Войти через Telegram</button></div>
        <p class="muted" id="loginHint"></p>
      </section>

      <div class="pageHeader hidden" id="pageHeader">
        <div class="pageTitle">
          <h1 id="viewTitle">Обзор</h1>
          <div id="status" class="status hidden"></div>
        </div>
        <form class="controls" id="controls">
          <input type="hidden" id="period" name="period" value="week">
          <div class="seg" role="group" aria-label="Период" id="periodSeg">
            <button type="button" data-period="today" title="Сегодня · live">Сегодня</button>
            <button type="button" data-period="week" title="Неделя · 7 дней, включая сегодня">7 дней</button>
            <button type="button" data-period="month" title="Месяц · 30 дней, включая сегодня">30 дней</button>
            <button type="button" data-period="custom">Период…</button>
          </div>
          <label class="customPeriod hidden">С
            <input id="dateFrom" name="from" type="date">
          </label>
          <label class="customPeriod hidden">по
            <input id="dateTo" name="to" type="date">
          </label>
          <button id="refreshButton" class="secondary customPeriod hidden" type="submit">Показать</button>
        </form>
      </div>

      <div id="statsError" class="card statsError hidden">
        <h2 id="statsErrorTitle"></h2>
        <p id="statsErrorMessage"></p>
        <div class="statsErrorActions">
          <button type="button" id="statsErrorWeek" class="secondary hidden">Показать неделю, включая сегодня</button>
          <button type="button" id="statsErrorRetry" class="secondary hidden">Повторить</button>
        </div>
      </div>

      <div id="views" class="hidden">
        <section class="view" data-view="overview" aria-labelledby="viewTitle">
          <div class="stack">
            <div class="grid" id="overviewKpis"></div>
            <div class="grid">
              <section class="card span-8">
                <div class="cardHead">
                  <h2>Сообщения по дням</h2>
                  <span class="cardHint" id="dailyMessagesHint"></span>
                </div>
                <div class="chartBox"><canvas id="dailyMessagesChart" aria-label="Сообщения по дням" role="img"></canvas></div>
                <div class="chartEmpty hidden" id="dailyMessagesEmpty">Нет данных</div>
              </section>
              <section class="card span-4">
                <div class="cardHead">
                  <h2>Когда пишут</h2>
                  <label class="chartHeadControls">Зона
                    <select id="hourlyTimezone"></select>
                  </label>
                </div>
                <div class="cardHint" id="hourlyTitle">Средняя активность по часам</div>
                <div class="chartBox short"><canvas id="hourlyChart" aria-label="Средняя активность по часам" role="img"></canvas></div>
                <div class="chartEmpty hidden" id="hourlyEmpty">Нет данных</div>
                <div class="bucketList" id="timeBuckets"></div>
              </section>
            </div>
            <div class="grid">
              <section class="card span-8">
                <div class="cardHead">
                  <h2>Лидеры</h2>
                  <div class="tabs" role="tablist" aria-label="Метрика" id="leaderTabs">
                    <button type="button" class="tab" role="tab" data-metric="messages">Сообщения</button>
                    <button type="button" class="tab" role="tab" data-metric="words">Слова</button>
                    <button type="button" class="tab" role="tab" data-metric="voice">Голосовые, мин</button>
                    <button type="button" class="tab" role="tab" data-metric="videoNote">Кружочки, мин</button>
                    <button type="button" class="tab" role="tab" data-metric="profanity">Мат</button>
                  </div>
                </div>
                <div class="rankList" id="leaderList" role="tabpanel"></div>
                <a class="seeAll" href="#people" id="leaderSeeAll">Все участники и ритм по дням →</a>
              </section>
              <div class="stack span-4">
                <section class="card">
                  <div class="cardHead"><h2>УК РФ</h2><a class="cardHint" href="#criminal">подробнее</a></div>
                  <div id="overviewCriminal"></div>
                </section>
                <section class="card">
                  <div class="cardHead"><h2>Мат</h2><span class="cardHint" id="overviewProfanityShare"></span></div>
                  <div class="chips" id="overviewProfanityWords"></div>
                  <p class="muted" id="overviewProfanityLeader" style="margin:10px 0 0"></p>
                </section>
              </div>
            </div>
          </div>
        </section>

        <section class="view hidden" data-view="people">
          <div class="stack">
            <section class="card">
              <div class="cardHead">
                <h2>Все участники</h2>
                <span class="cardHint peopleHint">Нажмите на заголовок столбца, чтобы отсортировать</span>
                <label class="peopleSort">Сортировка
                  <select id="peopleSortSelect" class="selectInput" aria-label="Сортировка участников"></select>
                </label>
              </div>
              <div class="tableScroll">
                <table class="peopleTable" aria-label="Участники">
                  <thead><tr id="peopleHead"></tr></thead>
                  <tbody id="peopleRows"></tbody>
                </table>
              </div>
            </section>
            <section class="card">
              <div class="cardHead">
                <div>
                  <h2>Ритм участников</h2>
                  <p class="cardHint" style="margin:4px 0 0">В каждом дне четыре клетки: ночь, утро, день, вечер. Время — UTC.</p>
                </div>
                <div class="heatmapLegend" aria-label="Обозначения активности">
                  <span class="heatmapLegendItem"><span class="heatmapLegendSwatch heatmap-inactive"></span>Нет активности</span>
                  <span class="heatmapLegendItem"><span class="heatmapLegendSwatch heatmap-active"></span>Активен</span>
                  <span class="heatmapLegendItem"><span class="heatmapLegendSwatch heatmap-talkative"></span>Активно общается</span>
                </div>
              </div>
              <div class="tableScroll" id="activityHeatmap" aria-live="polite"></div>
            </section>
          </div>
        </section>

        <section class="view hidden" data-view="media">
          <div class="stack">
            <div class="grid" id="mediaKpis"></div>
            <section class="card">
              <div class="cardHead">
                <h2>Минуты по дням</h2>
                <div class="legend">
                  <span><span class="swatch" style="background:var(--accent)"></span>голосовые</span>
                  <span><span class="swatch" style="background:var(--orange)"></span>кружочки</span>
                </div>
              </div>
              <div class="chartBox"><canvas id="mediaDailyChart" aria-label="Минуты голосовых и кружочков по дням" role="img"></canvas></div>
              <div class="chartEmpty hidden" id="mediaDailyEmpty">Нет данных</div>
            </section>
            <div class="mediaGrid">
              <section class="card">
                <div class="cardHead"><h2>Голосовые</h2><span class="cardHint">кто больше наговорил</span></div>
                <div id="activityVoiceUsers"></div>
              </section>
              <section class="card">
                <div class="cardHead"><h2>Кружочки</h2><span class="cardHint">кто больше снял</span></div>
                <div id="activityVideoNoteUsers"></div>
              </section>
            </div>
          </div>
        </section>

        <section class="view hidden" data-view="profanity">
          <div class="stack">
            <div class="grid" id="profanityKpis"></div>
            <div class="grid">
              <section class="card span-7">
                <div class="cardHead">
                  <h2>Кто ругается</h2>
                  <div class="tabs" role="tablist" aria-label="Сортировка">
                    <button type="button" class="tab warm" role="tab" data-profanity-sort="rate">Доля</button>
                    <button type="button" class="tab warm" role="tab" data-profanity-sort="count">Количество</button>
                  </div>
                </div>
                <div class="tableScroll">
                  <table aria-label="Мат по участникам">
                    <thead><tr><th>Участник</th><th>Доля мата</th><th>Мат</th><th>Слова</th></tr></thead>
                    <tbody id="profanityRateUsers"></tbody>
                  </table>
                </div>
                <p class="cardHint" style="margin:10px 0 0">Доля считается для тех, кто написал хотя бы 100 слов за период.</p>
              </section>
              <section class="card span-5">
                <div class="cardHead"><h2>Популярные слова</h2></div>
                <div id="profanityWords"></div>
              </section>
            </div>
          </div>
        </section>

        <section class="view hidden" data-view="criminal">
          <div class="criminalLayout">
            <section class="card criminalList">
              <div class="cardHead" style="padding:8px 8px 0"><h2>Рейтинг</h2><span class="cardHint" id="criminalSummary"></span></div>
              <div id="criminalUsers"></div>
            </section>
            <section class="card criminalDetails" id="criminalDetails" aria-live="polite">
              <div class="criminalDetailsHeader">
                <h3 id="criminalDetailsTitle">Выберите участника</h3>
                <button class="secondary hidden" id="criminalDetailsClose" type="button">Закрыть</button>
              </div>
              <p class="criminalConfidenceNote">Уверенность модели — это confidence конкретного анализа, а не измеренная точность классификатора.</p>
              <div class="criminalViolationList" id="criminalViolationList"></div>
            </section>
          </div>
        </section>

        <section class="view hidden" data-view="chats">
          <div class="stack">
            <p class="muted" style="margin:0">Чаты, где вы состоите. Цифры за последние 7 дней, включая сегодня.</p>
            <div class="chatGrid" id="chatCards"></div>
          </div>
        </section>

        <section class="view hidden" data-view="modules">
          <div class="stack narrow">
            <p class="muted" style="margin:0">Что бот делает в этом чате. <span id="chatSettingsMeta"></span></p>
            <section class="card">
              <label class="switchRow">
                <span class="switchText"><strong>Анализ мата</strong><span id="chatProfanityHint">Считать мат и любимые слова участников</span></span>
                <input type="checkbox" class="switch" role="switch" id="chatProfanity" data-chat-setting="profanityEnabled" data-module="profanity">
              </label>
              <label class="switchRow">
                <span class="switchText"><strong>УК РФ</strong><span id="chatCriminalHint">Искать в сообщениях «статьи» и считать сроки</span></span>
                <input type="checkbox" class="switch" role="switch" id="chatCriminal" data-chat-setting="criminalEnabled" data-module="criminal">
              </label>
              <label class="switchRow">
                <span class="switchText"><strong>Ночная AI-сводка</strong><span id="chatSummaryHint">Каждую ночь бот пишет в чат, что обсуждали за день</span></span>
                <input type="checkbox" class="switch" role="switch" id="chatSummary" data-chat-setting="summaryEnabled" data-module="summary">
              </label>
            </section>
            <section class="card">
              <label class="switchRow">
                <span class="switchText"><strong>Кто видит дашборд</strong><span>Участники без доступа не увидят этот чат в списке</span></span>
                <select id="chatDashboardAccess" class="selectInput">
                  <option value="members">Все участники</option>
                  <option value="admins">Только админы</option>
                </select>
              </label>
            </section>
            <div class="formActions">
              <span class="muted" id="chatSettingsDirty"></span>
              <button class="primary" id="saveChatSettings" type="button">Сохранить</button>
            </div>
          </div>
        </section>

        <section class="view hidden" data-view="notifications">
          <div class="stack narrow">
            <p class="muted" style="margin:0">Что бот сам присылает в этот чат. <span id="notificationMeta">Настройки еще не сохранялись</span></p>
            <section class="card">
              <label class="switchRow">
                <span class="switchText"><strong>Уведомления в этом чате</strong><span id="notificationsEnabledHint">Общий выключатель для всех сводок и отчётов</span></span>
                <input type="checkbox" class="switch" role="switch" id="notificationsEnabled">
              </label>
            </section>
            <section class="card" id="notificationTypes"></section>
            <div class="formActions">
              <span class="muted" id="notificationsDirty"></span>
              <button class="primary" id="saveNotifications" type="button">Сохранить</button>
            </div>
          </div>
        </section>

        <section class="view hidden" data-view="lab">
          <div class="stack">
            <div class="cardHead" style="margin:0">
              <p class="muted" style="margin:0">OpenAI и Qwen получают один и тот же вход. Совпадение не означает правильность.</p>
              <div class="controls" style="width:auto">
                <div class="seg" role="group" aria-label="Окно" id="shadowDaysSeg">
                  <button type="button" data-shadow-days="1">24 часа</button>
                  <button type="button" data-shadow-days="3">3 дня</button>
                  <button type="button" data-shadow-days="7">7 дней</button>
                </div>
                <input type="hidden" id="shadowDays" value="3">
                <button class="secondary" id="shadowRefresh" type="button">Обновить</button>
              </div>
            </div>
            <div class="shadowSummary" id="shadowSummary"></div>
            <section class="card">
              <div class="cardHead">
                <h2>Сравнения</h2>
                <div class="tabs" role="tablist" aria-label="Фильтр">
                  <button type="button" class="tab" role="tab" data-shadow-filter="diff">Только расхождения</button>
                  <button type="button" class="tab" role="tab" data-shadow-filter="all">Все</button>
                </div>
              </div>
              <div class="shadowList" id="shadowComparisons" aria-live="polite"></div>
            </section>
          </div>
        </section>
      </div>
    </main>
  </div>
  <dialog class="memberDialog" id="memberDialog" aria-labelledby="memberName">
    <div class="memberHead">
      <span class="avatar memberAvatar" id="memberAvatar" aria-hidden="true"></span>
      <div class="memberTitle">
        <h2 id="memberName"></h2>
        <div class="muted memberMeta" id="memberMeta"></div>
      </div>
      <button type="button" class="iconButton" id="memberClose" aria-label="Закрыть">✕</button>
    </div>
    <div class="memberBody" id="memberBody">
      <div class="grid" id="memberKpis"></div>
      <section class="card">
        <div class="cardHead"><h2>Сообщения по дням</h2><span class="cardHint" id="memberDailyHint"></span></div>
        <div class="chartBox short"><canvas id="memberDailyChart" aria-label="Сообщения участника по дням" role="img"></canvas></div>
        <div class="chartEmpty hidden" id="memberDailyEmpty">Нет данных</div>
      </section>
      <div class="memberCols">
        <section class="card">
          <div class="cardHead"><h2>Когда пишет</h2><span class="cardHint">доля сообщений, UTC</span></div>
          <div class="memberBuckets" id="memberBuckets"></div>
        </section>
        <section class="card">
          <div class="cardHead"><h2>Любимые слова</h2><span class="cardHint" id="memberWordsHint"></span></div>
          <div class="chips" id="memberWords"></div>
        </section>
      </div>
      <div class="formActions">
        <button type="button" class="secondary hidden" id="memberCriminalButton">Показать нарушения УК</button>
      </div>
    </div>
    <p class="muted hidden" id="memberStatus"></p>
  </dialog>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
  <script>
    const principal = ${principal};
    const HOURLY_TIMEZONE_STORAGE_KEY = 'telegramStatsAdmin.hourlyTimezoneOffset';
    const THEME_STORAGE_KEY = 'telegramStatsAdmin.theme';
    const PERIOD_STORAGE_KEY = 'telegramStatsAdmin.period';
    const THEME_MODES = ['system', 'light', 'dark'];
    const PERIODS = ['today', 'week', 'month', 'custom'];
    const VIEWS = {
      overview: 'Обзор',
      people: 'Люди',
      media: 'Голос и кружки',
      profanity: 'Мат',
      criminal: 'УК РФ',
      notifications: 'Автоуведомления',
      lab: 'Лаборатория моделей',
      chats: 'Все чаты',
      modules: 'Модули чата'
    };
    // Views that do not depend on the stats period.
    const SETTINGS_VIEWS = ['notifications', 'lab', 'chats', 'modules'];
    const AVATAR_COLORS = ['#f6c9a8', '#bfd9f2', '#cde8d6', '#e3d3f5', '#f5e1a4', '#f2c4ce', '#d3e4f0', '#e8dcc8'];
    const state = {
      chatId: '',
      view: 'overview',
      stats: null,
      notificationTypes: [],
      notificationsDirty: false,
      chats: [],
      loading: false,
      currentActivity: null,
      leaderMetric: 'messages',
      peopleSort: { key: 'messages', dir: -1 },
      profanitySort: 'rate',
      criminalDetailsRequestId: 0,
      selectedCriminalUserId: null,
      loadedCriminalRange: null,
      shadowLoading: false,
      shadowFilter: 'diff',
      shadowPayload: null,
      modules: null,
      chatSettings: null,
      chatSettingsDirty: false,
      memberRequestId: 0,
      memberUserId: null
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
    const NOTIFICATION_GROUPS = [
      { title: 'Сводки', types: ['daily_summary', 'weekly_summary', 'monthly_summary'] },
      { title: 'Отчёты', types: ['criminal_reports', 'profanity_reports', 'activity_summary'] }
    ];
    const NOTIFICATION_DESCRIPTIONS = {
      daily_summary: 'Итоги дня',
      weekly_summary: 'Итоги недели',
      monthly_summary: 'Итоги месяца',
      criminal_reports: 'Найденные «нарушения» и сроки',
      profanity_reports: 'Кто сколько ругался',
      activity_summary: 'Сводка активности участников'
    };

    function readCssVar(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function getThemeColors() {
      return {
        text: readCssVar('--text'),
        muted: readCssVar('--muted'),
        accent: readCssVar('--accent'),
        accentMid: readCssVar('--accent-mid'),
        green: readCssVar('--green'),
        orange: readCssVar('--orange'),
        purple: readCssVar('--purple'),
        chartGrid: readCssVar('--chart-grid'),
        chartTooltipBg: readCssVar('--chart-tooltip-bg'),
        chartTooltipText: readCssVar('--chart-tooltip-text')
      };
    }

    function normalizeThemeMode(value) {
      return THEME_MODES.includes(value) ? value : 'system';
    }

    function readThemeMode() {
      try {
        return normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
      } catch (_error) {
        return 'system';
      }
    }

    function writeThemeMode(mode) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, normalizeThemeMode(mode));
      } catch (_error) {
        // Local storage can be unavailable in restricted browser modes.
      }
    }

    function readPeriod() {
      try {
        const stored = localStorage.getItem(PERIOD_STORAGE_KEY);
        return stored && PERIODS.includes(stored) && stored !== 'custom' ? stored : 'week';
      } catch (_error) {
        return 'week';
      }
    }

    function writePeriod(period) {
      try {
        if (period !== 'custom') localStorage.setItem(PERIOD_STORAGE_KEY, period);
      } catch (_error) {
        // Local storage can be unavailable in restricted browser modes.
      }
    }

    function applyThemeMode(mode) {
      const normalized = normalizeThemeMode(mode);
      document.documentElement.dataset.themeMode = normalized;
      document.getElementById('themeSelect').value = normalized;
    }

    function refreshThemedCharts() {
      if (state.stats) renderAllCharts(state.stats);
    }

    function setupThemeControl() {
      applyThemeMode(readThemeMode());
    }

    function watchSystemThemeChanges() {
      if (!window.matchMedia) return;
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => {
        if (readThemeMode() === 'system') {
          refreshThemedCharts();
        }
      };
      if (media.addEventListener) {
        media.addEventListener('change', handler);
      } else if (media.addListener) {
        media.addListener(handler);
      }
    }

    // ---------- small DOM helpers ----------

    function el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    function emptyNote(text) {
      return el('p', 'muted', text || 'Нет данных');
    }

    function formatNumber(value) {
      return (Number(value) || 0).toLocaleString('ru-RU');
    }

    function formatDecimal(value, digits = 1) {
      return (Number(value) || 0).toLocaleString('ru-RU', { maximumFractionDigits: digits });
    }

    function formatRate(value) {
      return formatDecimal(value, 2) + '%';
    }

    function formatDuration(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const minutes = Math.floor(total / 60);
      return minutes + ':' + String(total % 60).padStart(2, '0');
    }

    function pluralRu(value, forms) {
      const n = Math.abs(Number(value) || 0) % 100;
      const last = n % 10;
      if (n > 10 && n < 20) return forms[2];
      if (last > 1 && last < 5) return forms[1];
      if (last === 1) return forms[0];
      return forms[2];
    }

    function formatSentence(row) {
      if (Number(row.lifeSentences) > 0) return 'пожизненно';
      const years = Number(row.totalYears) || 0;
      if (!years) return '';
      const rounded = Math.round(years);
      return rounded + ' ' + pluralRu(rounded, ['год', 'года', 'лет']);
    }

    function isCurrentUser(userId) {
      return Boolean(principal?.telegramId) && String(userId) === String(principal.telegramId);
    }

    function nameNode(row, tag = 'span') {
      const node = el(tag, 'name');
      if (isCurrentUser(row.userId)) {
        node.append(el('strong', '', row.username));
      } else {
        node.textContent = row.username;
      }
      return node;
    }

    /** Avatar + name that opens the participant card. */
    function personButton(row) {
      const button = el('button', 'personButton');
      button.type = 'button';
      button.title = 'Открыть карточку участника';
      button.append(avatarNode(row.username), nameNode(row));
      button.addEventListener('click', () => openMember(row.userId, row.username));
      return button;
    }

    function avatarNode(username) {
      const name = String(username || '?');
      let hash = 0;
      for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      const avatar = el('span', 'avatar', (name.replace(/^@/, '')[0] || '?').toUpperCase());
      avatar.style.background = AVATAR_COLORS[hash % AVATAR_COLORS.length];
      avatar.setAttribute('aria-hidden', 'true');
      return avatar;
    }

    function barNode(percent, extraClass) {
      const bar = el('span', 'bar' + (extraClass ? ' ' + extraClass : ''));
      const fill = el('span');
      fill.style.width = Math.max(0, Math.min(100, percent)) + '%';
      bar.append(fill);
      bar.setAttribute('aria-hidden', 'true');
      return bar;
    }

    // ---------- status & errors ----------

    function setStatus(text, isError = false) {
      const status = document.getElementById('status');
      status.classList.remove('hidden');
      status.className = isError ? 'status error' : 'status';
      status.textContent = text;
    }

    function setLiveStatus(text, live) {
      const status = document.getElementById('status');
      status.className = 'status';
      status.replaceChildren();
      if (live) status.append(el('span', 'liveDot', 'live'));
      status.append(document.createTextNode(text));
    }

    const STATS_ERROR_COPY = {
      LIVE_ANALYSIS_FAILED: {
        title: 'Анализ текущего дня не завершён',
        message:
          'Анализ сообщений за текущий день (UTC) пока не завершился. ' +
          'Данные появятся после завершения анализа.',
        showWeek: false,
        showRetry: true
      },
      LIVE_PROGRESS_UNKNOWN: {
        title: 'Данные за сегодня пока недоступны',
        message:
          'Прогресс обработки текущего дня (UTC) пока неизвестен. Попробуйте позже.',
        showWeek: false,
        showRetry: true
      },
      HISTORICAL_STATS_NOT_READY: {
        title: 'Данные пока не готовы',
        message: 'Статистика за выбранный период пока не готова. Попробуйте позже.',
        showWeek: false,
        showRetry: true
      },
      ADMIN_UNAVAILABLE: {
        title: 'Сервис временно недоступен',
        message: 'Статистика временно недоступна. Попробуйте позже.',
        showWeek: false,
        showRetry: true
      }
    };
    const STATS_ERROR_GENERIC = {
      title: 'Не удалось загрузить статистику',
      message: 'Произошла ошибка при загрузке статистики. Попробуйте ещё раз.',
      showWeek: false,
      showRetry: true
    };

    async function readErrorPayload(res) {
      try {
        const payload = await res.json();
        return payload && typeof payload.error === 'object' && payload.error ? payload.error : null;
      } catch (_error) {
        return null;
      }
    }

    function renderStatsError(errorPayload) {
      const code = typeof errorPayload?.code === 'string' ? errorPayload.code : '';
      const copy = STATS_ERROR_COPY[code] || STATS_ERROR_GENERIC;
      let message = copy.message;
      if (code === 'HISTORICAL_STATS_NOT_READY' && errorPayload?.from && errorPayload?.to) {
        message = 'Статистика за период с ' + errorPayload.from + ' по ' + errorPayload.to +
          ' пока не готова. Попробуйте позже.';
      }
      document.getElementById('statsErrorTitle').textContent = copy.title;
      document.getElementById('statsErrorMessage').textContent = message;
      document.getElementById('statsErrorWeek').classList.toggle('hidden', !copy.showWeek);
      document.getElementById('statsErrorRetry').classList.toggle('hidden', !copy.showRetry);
      document.getElementById('statsError').classList.remove('hidden');
      document.getElementById('views').classList.add('hidden');
      document.getElementById('status').classList.add('hidden');
    }

    function hideStatsError() {
      document.getElementById('statsError').classList.add('hidden');
      document.getElementById('status').classList.remove('hidden');
    }

    // ---------- controls ----------

    function setControlsDisabled(disabled) {
      document.getElementById('chatSelect').disabled = disabled;
      for (const button of document.querySelectorAll('#periodSeg button')) button.disabled = disabled;
      document.getElementById('dateFrom').disabled = disabled;
      document.getElementById('dateTo').disabled = disabled;
      document.getElementById('refreshButton').disabled = disabled;
      document.getElementById('hourlyTimezone').disabled = disabled;
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
      const period = document.getElementById('period').value;
      for (const button of document.querySelectorAll('#periodSeg button')) {
        button.setAttribute('aria-pressed', String(button.dataset.period === period));
      }
      for (const node of document.querySelectorAll('.customPeriod')) {
        node.classList.toggle('hidden', period !== 'custom');
      }
    }

    function selectPeriod(period) {
      document.getElementById('period').value = PERIODS.includes(period) ? period : 'week';
      syncCustomPeriodControls();
      if (period !== 'custom') {
        writePeriod(period);
        loadDashboard();
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

    function buildCriminalDetailsUrl(chatId, userId, loadedRange) {
      if (!loadedRange?.from || !loadedRange?.to) {
        throw new Error('Loaded dashboard range is unavailable');
      }
      const url = new URL('/admin/api/criminal-violations', window.location.origin);
      url.searchParams.set('chatId', chatId);
      url.searchParams.set('userId', String(userId));
      // Pin the drill-down to the exact range that produced the visible leaderboard.
      // Using the preset again could move the range across a UTC day boundary.
      url.searchParams.set('period', 'custom');
      url.searchParams.set('from', loadedRange.from);
      url.searchParams.set('to', loadedRange.to);
      return url.pathname + url.search;
    }

    // ---------- views ----------

    function currentViewFromHash() {
      const name = String(window.location.hash || '').replace('#', '');
      return Object.prototype.hasOwnProperty.call(VIEWS, name) ? name : 'overview';
    }

    function showView(name) {
      state.view = name;
      document.getElementById('viewTitle').textContent = VIEWS[name];
      document.getElementById('controls').classList.toggle('hidden', SETTINGS_VIEWS.includes(name));
      for (const view of document.querySelectorAll('.view')) {
        view.classList.toggle('hidden', view.dataset.view !== name);
      }
      for (const link of document.querySelectorAll('[data-view-link]')) {
        if (link.dataset.viewLink === name) {
          link.setAttribute('aria-current', 'page');
        } else {
          link.removeAttribute('aria-current');
        }
      }
      if (name === 'lab' && state.chatId && !state.shadowPayload) {
        loadShadowComparisons();
      }
      // Charts drawn while hidden have zero size; redraw them once visible.
      if (state.stats) renderAllCharts(state.stats);
    }

    // ---------- loading ----------

    function renderDashboardSkeleton() {
      state.loading = true;
      closeCriminalDetails();
      document.getElementById('main').classList.add('isLoading');
      setControlsDisabled(true);
    }

    function finishDashboardLoading() {
      state.loading = false;
      document.getElementById('main').classList.remove('isLoading');
      setControlsDisabled(false);
    }

    function renderEmptyDashboard() {
      renderStats(emptyStats());
      renderNotifications({ enabled: false, notifications: {} }, [], false);
    }

    function emptyStats() {
      return {
        range: null,
        previous: null,
        activity: {
          total: 0, totalWords: 0, wordsPerMessage: 0, totalVoiceCount: 0, totalVoiceMinutes: 0,
          totalVideoNoteCount: 0, totalVideoNoteMinutes: 0, activeUsers: 0, averageDailyMessages: 0,
          averageDailyActiveUsers: 0, averageHourlyMessages: 0, topUsers: [], topTalkers: [],
          topVoiceUsers: [], topVideoNoteUsers: [], allUsers: [], dailyMessages: [], dailyActiveUsers: [],
          dailyMedia: [], hourlyAverages: [], participantTimeline: null, timeBuckets: [],
          longestVoice: null, longestVideoNote: null
        },
        profanity: { total: 0, topUsers: [], topRateUsers: [], topWords: [] },
        criminal: { topUsers: [] }
      };
    }

    // ---------- login ----------

    async function showLogin() {
      document.getElementById('loginPanel').classList.remove('hidden');
      document.getElementById('pageHeader').classList.add('hidden');
      document.getElementById('views').classList.add('hidden');
      document.getElementById('status').classList.add('hidden');
      document.getElementById('sessionLabel').textContent = 'Не авторизован';

      const hint = document.getElementById('loginHint');
      const button = document.getElementById('telegramLoginButton');
      let challenge = null;
      let submitting = false;

      async function refreshChallenge() {
        button.disabled = true;
        const response = await fetch('/auth/telegram/config', { cache: 'no-store' });
        if (!response.ok) throw new Error('Login configuration unavailable');
        const data = await response.json();
        if (!Number.isSafeInteger(data.clientId) || !data.nonce) {
          throw new Error('Telegram Login is not configured');
        }
        challenge = data;
        button.disabled = false;
      }

      hint.textContent = 'Подготовка входа через Telegram...';
      try {
        await refreshChallenge();
        // The old iframe widget points to a deprecated Telegram endpoint.
        // The new library returns an ID token to our already-verified OIDC route.
        const sdk = document.createElement('script');
        sdk.src = 'https://oauth.telegram.org/js/telegram-login.js';
        sdk.async = true;
        sdk.onload = () => {
          if (!window.Telegram?.Login?.auth) {
            button.disabled = true;
            hint.textContent = 'Не удалось инициализировать Telegram Login. Обновите страницу.';
            return;
          }
          button.disabled = false;
          hint.textContent = '';
        };
        sdk.onerror = () => {
          button.disabled = true;
          hint.textContent = 'Не удалось загрузить Telegram Login. Попробуйте обновить страницу.';
        };
        button.disabled = true;
        document.head.append(sdk);

        button.addEventListener('click', () => {
          if (button.disabled || !challenge || !window.Telegram?.Login?.auth || submitting) return;
          // Open synchronously on the click to preserve user activation on iOS Safari.
          window.Telegram.Login.auth({
            client_id: challenge.clientId,
            scope: ['profile'],
            nonce: challenge.nonce,
          }, async result => {
            if (!result?.id_token) {
              hint.textContent = 'Вход не завершён. Можно попробовать ещё раз.';
              try { await refreshChallenge(); }
              catch (_error) { hint.textContent = 'Не удалось обновить вход. Перезагрузите страницу.'; }
              return;
            }
            if (submitting) return;
            submitting = true;
            button.disabled = true;
            hint.textContent = 'Проверяем вход...';
            try {
              const response = await fetch('/auth/telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_token: result.id_token }),
              });
              if (!response.ok) throw new Error('Telegram login rejected');
              const payload = await response.json();
              if (!payload.ok || payload.redirectTo !== '/admin') throw new Error('Unexpected login response');
              window.location.assign('/admin');
            } catch (_error) {
              hint.textContent = 'Не удалось подтвердить вход. Попробуйте ещё раз.';
              try { await refreshChallenge(); }
              catch (_error) { hint.textContent = 'Не удалось обновить вход. Перезагрузите страницу.'; }
            } finally {
              submitting = false;
            }
          });
        });
      } catch (_error) {
        button.disabled = true;
        hint.textContent = 'Telegram Login недоступен. Проверьте настройку бота и обновите страницу.';
      }
    }

    function showDashboardShell() {
      document.getElementById('loginPanel').classList.add('hidden');
      document.getElementById('pageHeader').classList.remove('hidden');
      document.getElementById('views').classList.remove('hidden');
      const name = principal?.displayName || principal?.username || 'Telegram user';
      const sessionLabel = document.getElementById('sessionLabel');
      sessionLabel.textContent = 'Вошли как ';
      const user = document.createElement('strong');
      user.textContent = name;
      sessionLabel.append(user);
    }

    // ---------- KPI cards ----------

    function deltaInfo(current, previous) {
      if (previous === null || previous === undefined) return null;
      const now = Number(current) || 0;
      const before = Number(previous) || 0;
      if (before === 0) {
        return now > 0 ? { text: 'раньше не было', tone: 'up' } : { text: 'без изменений', tone: '' };
      }
      const change = Math.round(((now - before) / before) * 100);
      if (change === 0) return { text: 'как в прошлом периоде', tone: '' };
      return {
        text: (change > 0 ? '▲ ' : '▼ ') + Math.abs(change) + '% к прошлому периоду',
        tone: change > 0 ? 'up' : 'down'
      };
    }

    function sparkNode(values) {
      const numbers = (values || []).map(value => Number(value) || 0);
      const spark = el('span', 'spark');
      spark.setAttribute('aria-hidden', 'true');
      const max = Math.max(...numbers, 0);
      if (numbers.length < 2 || max <= 0) return spark;
      numbers.slice(-14).forEach((value, index, list) => {
        const bar = el('span', index === list.length - 1 ? 'last' : '');
        bar.style.height = Math.max(3, Math.round((value / max) * 26)) + 'px';
        spark.append(bar);
      });
      return spark;
    }

    function renderKpis(containerId, items) {
      const box = document.getElementById(containerId);
      box.replaceChildren();
      for (const item of items) {
        const card = el('div', 'card kpi ' + (item.span || 'span-3'));
        const label = el('div', 'kpiLabel');
        if (item.swatch) {
          const swatch = el('span', 'swatch');
          swatch.style.background = item.swatch;
          label.append(swatch);
        }
        label.append(document.createTextNode(item.label));
        const value = el('div', 'kpiValue', item.value);
        const foot = el('div', 'kpiFoot');
        const delta = item.delta;
        foot.append(el('span', 'delta' + (delta?.tone ? ' ' + delta.tone : ''), delta ? delta.text : ''));
        if (item.spark) foot.append(sparkNode(item.spark));
        card.append(label, value, foot);
        if (item.hint) card.append(el('div', 'kpiHint', item.hint));
        box.append(card);
      }
    }

    // ---------- overview ----------

    function renderOverview(stats) {
      const activity = stats.activity || {};
      const previous = stats.previous || null;
      const dailyMedia = activity.dailyMedia || [];
      renderKpis('overviewKpis', [
        {
          label: 'Сообщения',
          value: formatNumber(activity.total),
          delta: deltaInfo(activity.total, previous?.total),
          spark: (activity.dailyMessages || []).map(row => row.count),
          hint: formatNumber(activity.totalWords) + ' слов · ' + formatDecimal(activity.wordsPerMessage) + ' на сообщение'
        },
        {
          label: 'Активные участники',
          value: formatNumber(activity.activeUsers),
          delta: deltaInfo(activity.activeUsers, previous?.activeUsers),
          spark: (activity.dailyActiveUsers || []).map(row => row.count),
          hint: 'в среднем ' + formatDecimal(activity.averageDailyActiveUsers) + ' в день'
        },
        {
          label: 'Голосовые',
          value: formatNumber(activity.totalVoiceCount),
          delta: deltaInfo(activity.totalVoiceCount, previous?.totalVoiceCount),
          spark: dailyMedia.map(row => row.voiceCount),
          hint: formatDecimal(activity.totalVoiceMinutes) + ' мин'
        },
        {
          label: 'Кружочки',
          value: formatNumber(activity.totalVideoNoteCount),
          delta: deltaInfo(activity.totalVideoNoteCount, previous?.totalVideoNoteCount),
          spark: dailyMedia.map(row => row.videoNoteCount),
          hint: formatDecimal(activity.totalVideoNoteMinutes) + ' мин'
        }
      ]);

      document.getElementById('dailyMessagesHint').textContent =
        'в среднем ' + formatDecimal(activity.averageDailyMessages) + ' в день · ' +
        formatDecimal(activity.averageHourlyMessages, 2) + ' в час';
      renderTimeBuckets(activity.timeBuckets || []);
      renderLeaders(stats);
      renderOverviewSide(stats);
    }

    function renderTimeBuckets(buckets) {
      const box = document.getElementById('timeBuckets');
      box.replaceChildren();
      for (const bucket of buckets || []) {
        const row = el('div', 'bucketRow');
        const leader = (bucket.topUsers || [])[0];
        row.append(
          el('span', 'bucketName', bucket.label),
          el('span', 'bucketLeader', leader ? leader.username : '—'),
          el('span', 'num muted', leader ? formatNumber(leader.count) : '')
        );
        box.append(row);
      }
    }

    function leaderRows(stats, metric) {
      const activity = stats.activity || {};
      switch (metric) {
        case 'words':
          return (activity.topTalkers || []).map(row => ({ ...row, value: row.words, display: formatNumber(row.words) }));
        case 'voice':
          return (activity.topVoiceUsers || []).map(row => ({ ...row, value: row.voiceMinutes, display: formatDecimal(row.voiceMinutes) }));
        case 'videoNote':
          return (activity.topVideoNoteUsers || []).map(row => ({ ...row, value: row.videoNoteMinutes, display: formatDecimal(row.videoNoteMinutes) }));
        case 'profanity':
          return (stats.profanity?.topUsers || []).map(row => ({ ...row, value: row.count, display: formatNumber(row.count) }));
        default:
          return (activity.topUsers || []).map(row => ({ ...row, value: row.count, display: formatNumber(row.count) }));
      }
    }

    function renderLeaders(stats) {
      for (const tab of document.querySelectorAll('#leaderTabs .tab')) {
        tab.setAttribute('aria-selected', String(tab.dataset.metric === state.leaderMetric));
      }
      const list = document.getElementById('leaderList');
      list.replaceChildren();
      const rows = leaderRows(stats, state.leaderMetric).slice(0, 8);
      if (!rows.length) {
        list.append(emptyNote());
        return;
      }
      const max = Math.max(...rows.map(row => Number(row.value) || 0), 0);
      rows.forEach((row, index) => {
        const line = el('div', 'rankRow');
        const person = personButton(row);
        person.classList.add('rankPerson');
        line.append(
          el('span', 'rank', index + 1),
          person,
          barNode(max > 0 ? ((Number(row.value) || 0) / max) * 100 : 0, state.leaderMetric === 'profanity' ? 'warm' : ''),
          el('span', 'value', row.display)
        );
        list.append(line);
      });
    }

    function renderOverviewSide(stats) {
      const criminal = document.getElementById('overviewCriminal');
      criminal.replaceChildren();
      const criminalRows = (stats.criminal?.topUsers || []).slice(0, 3);
      if (!criminalRows.length) criminal.append(emptyNote('Нарушений нет'));
      for (const row of criminalRows) {
        const line = el('div', 'miniRow');
        line.append(
          nameNode(row),
          el('span', 'muted num', formatNumber(row.count) + ' нар.'),
          el('span', 'years', formatSentence(row))
        );
        criminal.append(line);
      }

      const profanity = stats.profanity || {};
      const totalWords = Number(stats.activity?.totalWords) || 0;
      document.getElementById('overviewProfanityShare').textContent = totalWords > 0
        ? formatRate((Number(profanity.total) || 0) / totalWords * 100) + ' всех слов'
        : '';
      const words = document.getElementById('overviewProfanityWords');
      words.replaceChildren();
      const topWords = (profanity.topWords || []).slice(0, 6);
      if (!topWords.length) words.append(emptyNote('Чисто'));
      for (const word of topWords) {
        const chip = el('span', 'chip', word.word + ' ');
        chip.append(el('b', 'num', formatNumber(word.count)));
        words.append(chip);
      }
      const leader = (profanity.topRateUsers || [])[0];
      document.getElementById('overviewProfanityLeader').textContent = leader
        ? 'Чаще всех: ' + leader.username + ' · ' + formatRate(leader.rate) + ' слов'
        : '';
    }

    // ---------- people ----------

    const PEOPLE_COLUMNS = [
      { key: 'username', label: 'Участник' },
      { key: 'messages', label: 'Сообщения' },
      { key: 'words', label: 'Слова' },
      { key: 'wordsPerMessage', label: 'Слов/сообщ.' },
      { key: 'voiceMinutes', label: 'Голос, мин' },
      { key: 'videoNoteMinutes', label: 'Кружки, мин' },
      { key: 'profanity', label: 'Мат' },
      { key: 'rate', label: 'Доля мата' },
      { key: 'criminal', label: 'УК РФ' },
      { key: 'rhythm', label: 'Ритм по дням недели', sortable: false }
    ];

    function mergePeople(stats) {
      const people = new Map();
      const entry = (userId, username) => {
        const key = String(userId);
        if (!people.has(key)) {
          people.set(key, {
            userId: key, username: username || 'id' + key, messages: 0, words: 0, wordsPerMessage: 0,
            voiceMinutes: 0, videoNoteMinutes: 0, profanity: 0, rate: null, criminal: 0, sentence: ''
          });
        }
        return people.get(key);
      };
      const activity = stats.activity || {};
      for (const row of [
        ...(activity.allUsers || []),
        ...(activity.topUsers || []), ...(activity.topTalkers || []),
        ...(activity.topVoiceUsers || []), ...(activity.topVideoNoteUsers || [])
      ]) {
        const person = entry(row.userId, row.username);
        person.messages = Number(row.count) || 0;
        person.words = Number(row.words) || 0;
        person.wordsPerMessage = Number(row.wordsPerMessage) || 0;
        person.voiceMinutes = Number(row.voiceMinutes) || 0;
        person.videoNoteMinutes = Number(row.videoNoteMinutes) || 0;
      }
      // allUsers carries per-person profanity and criminal counts beyond the top-10 lists.
      for (const row of activity.allUsers || []) {
        const person = entry(row.userId, row.username);
        person.profanity = Number(row.profanityCount) || 0;
        person.rate = row.profanityRate === null || row.profanityRate === undefined ? null : Number(row.profanityRate) || 0;
        person.criminal = Number(row.criminalCount) || 0;
        person.fromAllUsers = true;
      }
      for (const row of stats.profanity?.topUsers || []) {
        entry(row.userId, row.username).profanity = Number(row.count) || 0;
      }
      for (const row of stats.profanity?.topRateUsers || []) {
        const person = entry(row.userId, row.username);
        person.rate = Number(row.rate) || 0;
        person.profanity = Math.max(person.profanity, Number(row.profanityCount) || 0);
      }
      for (const row of stats.criminal?.topUsers || []) {
        const person = entry(row.userId, row.username);
        // Keep one count source per column: allUsers' daily criminal_count wins,
        // the top list only adds the sentence (and covers users missing from allUsers).
        if (!person.fromAllUsers) person.criminal = Number(row.count) || 0;
        person.sentence = formatSentence(row);
      }
      return [...people.values()];
    }

    function weekRhythmLevels(participant) {
      const days = (participant?.dailyLevels || []).filter(level => level?.day);
      return ACTIVITY_WEEKDAYS.map((_label, index) => rhythmLevel(
        days.filter(level => weekdayIndex(level.day) === index).map(level => activityLevel(level.level))
      ));
    }

    function renderPeople(stats) {
      const head = document.getElementById('peopleHead');
      head.replaceChildren();
      for (const column of PEOPLE_COLUMNS) {
        const th = el('th');
        th.scope = 'col';
        if (column.sortable === false) {
          th.textContent = column.label;
        } else {
          const button = el('button', 'sort', column.label);
          button.type = 'button';
          const active = state.peopleSort.key === column.key;
          button.setAttribute('aria-pressed', String(active));
          if (active) button.textContent += state.peopleSort.dir < 0 ? ' ▼' : ' ▲';
          button.addEventListener('click', () => {
            state.peopleSort = active
              ? { key: column.key, dir: -state.peopleSort.dir }
              : { key: column.key, dir: column.key === 'username' ? 1 : -1 };
            renderPeople(state.stats);
          });
          th.append(button);
        }
        head.append(th);
      }

      renderPeopleSortSelect();

      const tbody = document.getElementById('peopleRows');
      tbody.replaceChildren();
      const people = mergePeople(stats);
      if (!people.length) {
        const tr = el('tr');
        const td = el('td', 'muted peopleEmpty peopleWide', 'Нет данных');
        td.colSpan = PEOPLE_COLUMNS.length;
        tr.append(td);
        tbody.append(tr);
        return;
      }
      const { key, dir } = state.peopleSort;
      people.sort((a, b) => {
        if (key === 'username') return dir * String(a.username).localeCompare(String(b.username), 'ru');
        return dir * ((Number(a[key]) || 0) - (Number(b[key]) || 0)) || b.messages - a.messages;
      });
      const maxMessages = Math.max(...people.map(person => person.messages), 0);
      // Join on userId: the timeline renames users without a username.
      const timeline = new Map(
        (stats.activity?.participantTimeline?.participants || []).map(participant => [String(participant.userId), participant])
      );
      for (const person of people) {
        const tr = el('tr');
        const nameCell = el('td', 'peopleName peopleWide');
        const personCell = el('span', 'personCell');
        personCell.append(personButton(person));
        nameCell.append(personCell);

        const messagesCell = el('td', 'peopleWide');
        const barCell = el('span', 'barCell');
        barCell.append(barNode(maxMessages > 0 ? (person.messages / maxMessages) * 100 : 0, 'thin'), el('b', '', formatNumber(person.messages)));
        messagesCell.append(barCell);

        const rhythmCell = el('td', 'peopleRhythm');
        const participant = timeline.get(String(person.userId));
        if (participant) {
          const week = el('span', 'weekRhythm');
          week.setAttribute('role', 'img');
          const levels = weekRhythmLevels(participant);
          week.setAttribute('aria-label', person.username + ': ' + ACTIVITY_WEEKDAYS.map((day, index) => day + ' — ' + activityLevelLabel(levels[index])).join(', '));
          for (const level of levels) week.append(el('span', 'heatmap-' + level));
          rhythmCell.append(week);
        } else {
          rhythmCell.textContent = '—';
        }

        const criminalCell = el('td', 'years', person.criminal ? person.criminal + (person.sentence ? ' · ' + person.sentence : '') : '—');
        tr.append(
          nameCell,
          messagesCell,
          el('td', '', formatNumber(person.words)),
          el('td', 'muted', formatDecimal(person.wordsPerMessage)),
          el('td', '', formatDecimal(person.voiceMinutes)),
          el('td', '', formatDecimal(person.videoNoteMinutes)),
          el('td', '', person.profanity ? formatNumber(person.profanity) : '—'),
          el('td', '', person.rate === null ? '—' : formatRate(person.rate)),
          criminalCell,
          rhythmCell
        );
        // Labels for the mobile card layout, where the header row is hidden.
        [...tr.children].forEach((td, index) => { td.dataset.label = PEOPLE_COLUMNS[index].label; });
        tbody.append(tr);
      }
    }

    function renderPeopleSortSelect() {
      const select = document.getElementById('peopleSortSelect');
      if (!select.options.length) {
        for (const column of PEOPLE_COLUMNS) {
          if (column.sortable === false) continue;
          select.append(new Option(column.label, column.key));
        }
        select.addEventListener('change', () => {
          state.peopleSort = { key: select.value, dir: select.value === 'username' ? 1 : -1 };
          renderPeople(state.stats);
        });
      }
      select.value = state.peopleSort.key;
    }

    function activityLevelLabel(level) {
      return {
        inactive: 'Нет активности',
        active: 'Активен',
        talkative: 'Активно общается'
      }[level] || 'Нет активности';
    }

    function activityLevel(level) {
      return ['inactive', 'active', 'talkative'].includes(level) ? level : 'inactive';
    }

    function readableHeatmapDay(day) {
      return new Intl.DateTimeFormat('ru-RU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC'
      }).format(new Date(day + 'T00:00:00Z'));
    }

    const ACTIVITY_TIME_BUCKETS = [
      { bucket: 'night', label: 'Ночь · 22–05' },
      { bucket: 'morning', label: 'Утро · 05–12' },
      { bucket: 'noon', label: 'День · 12–17' },
      { bucket: 'evening', label: 'Вечер · 17–22' }
    ];
    const ACTIVITY_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    function weekdayIndex(day) {
      return (new Date(day + 'T00:00:00Z').getUTCDay() + 6) % 7;
    }

    function bucketLevel(dailyLevel, bucket) {
      return activityLevel((dailyLevel?.timeBucketLevels || [])
        .find(level => level.bucket === bucket)?.level);
    }

    function rhythmLevel(levels) {
      if (!levels.length) return 'inactive';
      const activeLevels = levels.filter(level => level !== 'inactive').length;
      const talkativeLevels = levels.filter(level => level === 'talkative').length;
      // These proportions make a weekday rhythm stable without exposing message totals.
      if (talkativeLevels * 2 >= levels.length) return 'talkative';
      if (activeLevels * 4 >= levels.length) return 'active';
      return 'inactive';
    }

    function renderActivityHeatmap(timeline) {
      const box = document.getElementById('activityHeatmap');
      box.replaceChildren();
      const participants = (timeline?.participants || []).slice(0, 12);
      const days = Array.from(new Set(participants.flatMap(participant =>
        (participant.dailyLevels || []).map(level => level.day).filter(Boolean)
      ))).sort().slice(-90);
      if (!participants.length || !days.length) {
        box.append(emptyNote('Нет данных об активности за выбранный период'));
        return;
      }
      const availableBuckets = new Set((timeline?.timeBuckets || []).map(bucket => bucket?.bucket));
      const timeBuckets = ACTIVITY_TIME_BUCKETS.filter(timeBucket => availableBuckets.has(timeBucket.bucket));
      if (timeBuckets.length !== ACTIVITY_TIME_BUCKETS.length) {
        box.append(emptyNote('Нет данных об активности по времени суток за выбранный период'));
        return;
      }

      const table = el('table', 'rhythmHeatmap');
      table.setAttribute('aria-label', 'Активность участников по дням и времени суток');
      const head = el('thead');
      const header = el('tr');
      const corner = el('th');
      corner.scope = 'col';
      header.append(corner);
      for (const day of days) {
        const dayHeader = el('th', 'heatmapDay');
        dayHeader.scope = 'col';
        dayHeader.title = readableHeatmapDay(day);
        dayHeader.setAttribute('aria-label', readableHeatmapDay(day));
        dayHeader.textContent = day.slice(8) + '.' + day.slice(5, 7);
        header.append(dayHeader);
      }
      head.append(header);
      table.append(head);

      const body = el('tbody');
      for (const participant of participants) {
        const username = participant.username || 'Участник';
        const row = el('tr');
        const name = el('th', '', username);
        name.scope = 'row';
        row.append(name);
        const levelsByDay = new Map((participant.dailyLevels || []).map(level => [level.day, level]));
        for (const day of days) {
          const cell = el('td');
          const group = el('span', 'rhythmDay');
          for (const timeBucket of timeBuckets) {
            const level = bucketLevel(levelsByDay.get(day), timeBucket.bucket);
            const description = username + ', ' + readableHeatmapDay(day) + ', ' + timeBucket.label + ': ' + activityLevelLabel(level);
            const mark = el('span', 'heatmapCell heatmap-' + level);
            mark.title = description;
            mark.setAttribute('role', 'img');
            mark.setAttribute('aria-label', description);
            group.append(mark);
          }
          cell.append(group);
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
      box.append(table);
    }

    // ---------- media ----------

    function renderMedia(stats) {
      const activity = stats.activity || {};
      const previous = stats.previous || null;
      const longestVoice = activity.longestVoice;
      const longestVideoNote = activity.longestVideoNote;
      const avg = (minutes, count) => count > 0 ? formatDuration((Number(minutes) || 0) * 60 / count) : '—';
      const colors = getThemeColors();
      renderKpis('mediaKpis', [
        {
          label: 'Голосовые',
          swatch: colors.accent,
          value: formatNumber(activity.totalVoiceCount),
          delta: deltaInfo(activity.totalVoiceCount, previous?.totalVoiceCount),
          hint: formatDecimal(activity.totalVoiceMinutes) + ' мин за период'
        },
        {
          label: 'Средняя длина голосового',
          swatch: colors.accent,
          value: avg(activity.totalVoiceMinutes, Number(activity.totalVoiceCount) || 0),
          hint: longestVoice
            ? 'самое длинное ' + formatDuration(longestVoice.seconds) + ', ' + longestVoice.username
            : 'самое длинное пока не известно'
        },
        {
          label: 'Кружочки',
          swatch: colors.orange,
          value: formatNumber(activity.totalVideoNoteCount),
          delta: deltaInfo(activity.totalVideoNoteCount, previous?.totalVideoNoteCount),
          hint: formatDecimal(activity.totalVideoNoteMinutes) + ' мин за период'
        },
        {
          label: 'Средняя длина кружочка',
          swatch: colors.orange,
          value: avg(activity.totalVideoNoteMinutes, Number(activity.totalVideoNoteCount) || 0),
          hint: longestVideoNote
            ? 'самый длинный ' + formatDuration(longestVideoNote.seconds) + ', ' + longestVideoNote.username
            : 'самый длинный пока не известен'
        }
      ]);
      renderMediaRows('activityVoiceUsers', activity.topVoiceUsers || [], 'voice');
      renderMediaRows('activityVideoNoteUsers', activity.topVideoNoteUsers || [], 'videoNote');
    }

    function renderMediaRows(id, rows, type) {
      const box = document.getElementById(id);
      box.replaceChildren();
      if (!rows.length) {
        box.append(emptyNote());
        return;
      }
      const minutesKey = type === 'voice' ? 'voiceMinutes' : 'videoNoteMinutes';
      const countKey = type === 'voice' ? 'voiceCount' : 'videoNoteCount';
      const maxKey = type === 'voice' ? 'voiceMaxSeconds' : 'videoNoteMaxSeconds';
      const head = el('div', 'mediaRow head');
      head.append(
        el('span'), el('span', '', 'Участник'), el('span', 'barHead', 'Минуты'),
        el('span', 'r', 'Мин'), el('span', 'r', 'Штук'), el('span', 'r', 'Средн.'), el('span', 'r', 'Макс.')
      );
      box.append(head);
      const max = Math.max(...rows.map(row => Number(row[minutesKey]) || 0), 0);
      for (const row of rows) {
        const minutes = Number(row[minutesKey]) || 0;
        const count = Number(row[countKey]) || 0;
        const line = el('div', 'mediaRow ' + type);
        line.append(
          avatarNode(row.username),
          nameNode(row),
          barNode(max > 0 ? (minutes / max) * 100 : 0),
          el('span', 'r', formatDecimal(minutes)),
          el('span', 'r', formatNumber(count)),
          el('span', 'r muted', count > 0 ? formatDuration(minutes * 60 / count) : '—'),
          el('span', 'r muted', row[maxKey] ? formatDuration(row[maxKey]) : '—')
        );
        box.append(line);
      }
    }

    // ---------- profanity ----------

    function renderProfanity(stats) {
      const profanity = stats.profanity || {};
      const activity = stats.activity || {};
      const totalWords = Number(activity.totalWords) || 0;
      const total = Number(profanity.total) || 0;
      const topWord = (profanity.topWords || [])[0];
      const share = totalWords > 0 ? (total / totalWords) * 100 : 0;
      renderKpis('profanityKpis', [
        {
          span: 'span-4',
          label: 'Матерных слов',
          value: formatNumber(total),
          delta: deltaInfo(total, stats.previous?.profanityTotal ?? null)
        },
        {
          span: 'span-4',
          label: 'Доля мата в чате',
          value: formatRate(share),
          hint: share > 0 ? 'примерно каждое ' + formatNumber(Math.round(100 / share)) + '-е слово' : ''
        },
        {
          span: 'span-4',
          label: 'Самое частое слово',
          value: topWord ? topWord.word : '—',
          hint: topWord
            ? formatNumber(topWord.count) + ' раз' + (topWord.contributors?.[0] ? ', чаще всех ' + topWord.contributors[0].username : '')
            : ''
        }
      ]);
      renderProfanityRateRows(stats);
      renderProfanityWords(profanity.topWords || []);
    }

    function renderProfanityRateRows(stats) {
      for (const tab of document.querySelectorAll('[data-profanity-sort]')) {
        tab.setAttribute('aria-selected', String(tab.dataset.profanitySort === state.profanitySort));
      }
      const profanity = stats.profanity || {};
      const byId = new Map();
      for (const row of profanity.topUsers || []) {
        byId.set(String(row.userId), { userId: row.userId, username: row.username, count: Number(row.count) || 0, rate: null, words: null });
      }
      for (const row of profanity.topRateUsers || []) {
        const existing = byId.get(String(row.userId)) || { userId: row.userId, username: row.username, count: 0 };
        byId.set(String(row.userId), {
          ...existing,
          count: Math.max(existing.count, Number(row.profanityCount) || 0),
          rate: Number(row.rate) || 0,
          words: Number(row.wordCount) || 0
        });
      }
      let rows = [...byId.values()];
      rows = state.profanitySort === 'rate'
        ? rows.filter(row => row.rate !== null).sort((a, b) => b.rate - a.rate || b.count - a.count)
        : rows.sort((a, b) => b.count - a.count);

      const tbody = document.getElementById('profanityRateUsers');
      tbody.replaceChildren();
      if (!rows.length) {
        const tr = el('tr');
        const td = el('td', 'muted', 'Нет данных');
        td.colSpan = 4;
        tr.append(td);
        tbody.append(tr);
        return;
      }
      const key = state.profanitySort === 'rate' ? 'rate' : 'count';
      const max = Math.max(...rows.map(row => Number(row[key]) || 0), 0);
      for (const row of rows) {
        const tr = el('tr');
        const nameCell = el('td');
        const person = el('span', 'personCell');
        person.append(avatarNode(row.username), nameNode(row));
        nameCell.append(person);
        const rateCell = el('td');
        const barCell = el('span', 'barCell');
        barCell.append(
          barNode(max > 0 ? ((Number(row[key]) || 0) / max) * 100 : 0, 'thin warm'),
          el('b', '', row.rate === null ? '—' : formatRate(row.rate))
        );
        rateCell.append(barCell);
        tr.append(
          nameCell,
          rateCell,
          el('td', '', formatNumber(row.count)),
          el('td', 'muted', row.words === null ? '—' : formatNumber(row.words))
        );
        tbody.append(tr);
      }
    }

    function renderProfanityWords(words) {
      const box = document.getElementById('profanityWords');
      box.replaceChildren();
      if (!words.length) {
        box.append(emptyNote());
        return;
      }
      for (const word of words) {
        const item = el('div', 'wordItem');
        const head = el('div', 'wordHead');
        head.append(el('strong', '', word.word), el('span', 'num', formatNumber(word.count)));
        item.append(head);
        const contributors = Array.isArray(word.contributors) ? word.contributors : [];
        const total = Number(word.count) || 0;
        if (contributors.length && total > 0) {
          const parts = contributors.slice(0, 2).map(row => ({ name: row.username, value: Number(row.count) || 0 }));
          const rest = Math.max(0, total - parts.reduce((sum, part) => sum + part.value, 0));
          if (rest > 0) parts.push({ name: 'другие', value: rest });
          const stacked = el('div', 'stacked');
          stacked.setAttribute('aria-hidden', 'true');
          for (const part of parts) {
            const span = el('span');
            span.style.width = ((part.value / total) * 100) + '%';
            stacked.append(span);
          }
          item.append(
            stacked,
            el('div', 'wordWho', parts.map(part => part.name + ' ' + Math.round((part.value / total) * 100) + '%').join(' · '))
          );
        }
        box.append(item);
      }
    }

    // ---------- criminal ----------

    function formatCriminalArticle(violation) {
      const article = String(violation?.article || '?')
        .replace(/^Статья\\s+/i, '')
        .replace(/\\s+УК\\s+РФ$/i, '');
      const subarticle = violation?.subarticle ? '.' + violation.subarticle : '';
      const title = violation?.articleTitle ? ' · ' + violation.articleTitle : '';
      return 'Ст. ' + article + subarticle + ' УК РФ' + title;
    }

    function formatCriminalConfidence(value) {
      if (value === null || value === undefined || value === '') return 'нет данных';
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return 'нет данных';
      const confidence = Math.min(1, Math.max(0, numeric));
      return Math.round(confidence * 100) + '%';
    }

    function appendCriminalField(card, labelText, valueText) {
      if (!valueText) return;
      const field = el('div', 'criminalField');
      field.append(el('div', 'criminalFieldLabel', labelText), el('div', '', valueText));
      card.append(field);
    }

    function appendCriminalContext(card, violation) {
      const contextMessages = Array.isArray(violation.contextMessages) ? violation.contextMessages : [];
      if (contextMessages.length) {
        const field = el('div', 'criminalField');
        const context = el('div', 'criminalContext');
        for (const message of contextMessages) {
          const item = el('div', 'criminalContextMessage');
          item.append(
            el('div', 'criminalContextMeta', (Number(message.relativePosition) < 0 ? 'До' : 'После') + ' · ' +
              (message.username || 'unknown')),
            el('div', '', message.text || '')
          );
          context.append(item);
        }
        field.append(el('div', 'criminalFieldLabel', 'Контекст переписки'), context);
        card.append(field);
      } else if (!violation.contextSummary) {
        const field = el('div', 'criminalField');
        field.append(
          el('div', 'criminalFieldLabel', 'Контекст переписки'),
          el('div', 'muted', 'Исходный контекст недоступен. История сообщений хранится до 7 дней.')
        );
        card.append(field);
      }

      if (violation.contextSummary) {
        appendCriminalField(card, 'Контекст, который учла модель', violation.contextSummary);
      }
    }

    function renderCriminalDetails(username, payload) {
      const list = document.getElementById('criminalViolationList');
      document.getElementById('criminalDetailsTitle').textContent = 'Нарушения: ' + username;
      document.getElementById('criminalDetailsClose').classList.remove('hidden');
      list.replaceChildren();
      const violations = Array.isArray(payload?.violations) ? payload.violations : [];

      if (!violations.length) {
        list.append(emptyNote('Детали нарушений за этот период не найдены.'));
        return;
      }

      for (const violation of violations) {
        const card = el('article', 'criminalViolationCard');
        const head = el('div', 'criminalViolationHead');
        const titleBox = el('div');
        titleBox.append(el('div', 'criminalViolationTitle', formatCriminalArticle(violation)));
        if (violation.occurredAt) {
          titleBox.append(el('div', 'criminalOccurredAt', new Date(Number(violation.occurredAt) * 1000).toLocaleString('ru-RU')));
        }
        const badges = el('div', 'criminalBadges');
        const severityValue = Number(violation.severity) || 0;
        if (severityValue > 0) {
          badges.append(el('span', 'criminalBadge' + (severityValue >= 7 ? ' severe' : ''), 'Серьёзность ' + violation.severity + '/10'));
        }
        const confidence = el('span', 'criminalBadge', 'Уверенность модели ' + formatCriminalConfidence(violation.confidence));
        confidence.title = 'Confidence анализа, а не измеренная точность классификатора';
        badges.append(confidence);
        head.append(titleBox, badges);
        card.append(head);

        const triggerField = el('div', 'criminalField');
        const triggerSource = violation.trigger?.source;
        const triggerLabel = el('div', 'criminalFieldLabel', triggerSource === 'history'
          ? 'Сообщение-триггер'
          : triggerSource === 'preview'
            ? 'Сохранённый фрагмент сообщения'
            : 'Фрагмент, который выделила модель');
        const trigger = el('blockquote', 'criminalTrigger', violation.trigger?.text || violation.quote || 'Текст недоступен');
        triggerField.append(triggerLabel, trigger);
        card.append(triggerField);

        appendCriminalField(
          card,
          'Возможное наказание',
          violation.punishment || 'Модель не указала наказание',
        );
        if (violation.sentence?.display && violation.sentence.display !== 'срок не распознан') {
          appendCriminalField(
            card,
            'Максимум лишения свободы по тексту наказания',
            violation.sentence.display,
          );
        }
        const explanation = violation.evidence?.whyNotBenign || violation.evidence?.intent || '';
        appendCriminalField(card, 'Почему модель сочла это нарушением', explanation);
        appendCriminalContext(card, violation);
        list.append(card);
      }

      if (payload?.hasMore) {
        list.append(emptyNote('Показаны последние 50 нарушений за выбранный период.'));
      }
    }

    function syncCriminalDetailButtons() {
      for (const button of document.querySelectorAll('.criminalUserButton')) {
        button.setAttribute(
          'aria-expanded',
          String(String(button.dataset.userId) === String(state.selectedCriminalUserId)),
        );
      }
    }

    function closeCriminalDetails() {
      state.criminalDetailsRequestId += 1;
      state.selectedCriminalUserId = null;
      document.getElementById('criminalDetailsTitle').textContent = 'Выберите участника';
      document.getElementById('criminalDetailsClose').classList.add('hidden');
      document.getElementById('criminalViolationList').replaceChildren();
      syncCriminalDetailButtons();
    }

    async function loadCriminalDetails(row) {
      const requestId = ++state.criminalDetailsRequestId;
      state.selectedCriminalUserId = row.userId;
      syncCriminalDetailButtons();
      const list = document.getElementById('criminalViolationList');
      document.getElementById('criminalDetailsTitle').textContent = 'Нарушения: ' + row.username;
      document.getElementById('criminalDetailsClose').classList.remove('hidden');
      list.replaceChildren(emptyNote('Загрузка деталей...'));

      try {
        const url = buildCriminalDetailsUrl(
          state.chatId,
          row.userId,
          state.loadedCriminalRange,
        );
        const res = await fetch(url);
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) throw new Error('details unavailable');
        const payload = await res.json();
        if (requestId !== state.criminalDetailsRequestId) return;
        renderCriminalDetails(row.username, payload);
      } catch (_error) {
        if (requestId !== state.criminalDetailsRequestId) return;
        state.selectedCriminalUserId = null;
        syncCriminalDetailButtons();
        list.replaceChildren(emptyNote('Не удалось загрузить детали нарушений. Попробуйте ещё раз.'));
      }
    }

    function renderCriminalRows(rows) {
      const box = document.getElementById('criminalUsers');
      box.replaceChildren();
      const total = rows.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
      document.getElementById('criminalSummary').textContent = rows.length
        ? formatNumber(total) + ' ' + pluralRu(total, ['нарушение', 'нарушения', 'нарушений']) + ' · ' +
          rows.length + ' ' + pluralRu(rows.length, ['человек', 'человека', 'человек'])
        : '';
      if (!rows.length) {
        box.append(emptyNote('Нарушений за период нет'));
        closeCriminalDetails();
        return;
      }

      for (const row of rows) {
        const button = el('button', 'criminalUserButton');
        button.type = 'button';
        button.dataset.userId = String(row.userId);
        button.setAttribute('aria-controls', 'criminalDetails');
        button.setAttribute('aria-expanded', 'false');
        const meta = el('span', 'criminalUserMeta');
        meta.append(nameNode(row), el('small', '', formatNumber(row.count) + ' ' + pluralRu(row.count, ['нарушение', 'нарушения', 'нарушений'])));
        button.append(avatarNode(row.username), meta, el('span', 'years', formatSentence(row)));
        button.addEventListener('click', () => {
          if (String(state.selectedCriminalUserId) === String(row.userId)) {
            closeCriminalDetails();
          } else {
            loadCriminalDetails(row);
          }
        });
        box.append(button);
      }
      syncCriminalDetailButtons();
    }

    // ---------- model shadow lab ----------

    function appendShadowMetric(container, value, label) {
      const item = el('div', 'card shadowMetric');
      item.append(el('strong', '', value), el('span', '', label));
      container.append(item);
    }

    function formatShadowRatio(matches, compared) {
      return compared > 0 ? matches + '/' + compared : '—';
    }

    function formatShadowWords(result) {
      const words = Array.isArray(result?.profanity?.words) ? result.profanity.words : [];
      if (!words.length) return 'нет';
      return words.map(word => word.word + ' ×' + word.count).join(', ');
    }

    function appendShadowRaw(parent, title, value) {
      if (!value) return;
      const details = el('details', 'shadowRaw');
      const summary = el('summary', '', title);
      const pre = el('pre', '', value);
      details.append(summary, pre);
      parent.append(details);
    }

    function renderShadowProvider(record, label) {
      const panel = el('div', 'shadowProvider');
      panel.append(el('h3', '', label + (record?.model ? ' · ' + record.model : '')));

      if (!record) {
        panel.append(el('div', 'muted', 'Результат ещё не сохранён'));
        return panel;
      }

      if (record.status !== 'ok' || !record.parsedOutput) {
        panel.append(el('div', 'shadowProviderLine', 'Ошибка: ' + (record.error || 'неизвестная ошибка')));
      } else {
        panel.append(
          el('div', 'shadowProviderLine', 'УК: ' + (record.parsedOutput.shouldAnalyze ? 'анализ' : 'пропуск') +
            ' · ' + record.parsedOutput.reason +
            ' · уверенность ' + Math.round((Number(record.parsedOutput.confidence) || 0) * 100) + '%'),
          el('div', 'shadowProviderLine', 'Мат: ' +
            (record.parsedOutput.profanity?.hasProfanity ? 'есть' : 'нет') +
            ' · ' + formatShadowWords(record.parsedOutput))
        );
      }

      panel.append(el('div', 'shadowProviderLine muted', 'Задержка: ' + record.latencyMs + ' мс' +
        (record.usage?.totalTokens ? ' · tokens ' + record.usage.totalTokens : '') +
        (record.usage?.cachedTokens ? ' · cache read ' + record.usage.cachedTokens : '') +
        (record.usage?.cacheCreationTokens ? ' · cache create ' + record.usage.cacheCreationTokens : '')));
      appendShadowRaw(panel, 'Raw output', record.rawOutput);
      return panel;
    }

    function shadowMatchChip(label, value) {
      if (value === null || value === undefined) return el('span', 'matchChip', label + ': нет пары');
      return el('span', 'matchChip ' + (value ? 'ok' : 'miss'), label + (value ? ' ✓' : ' ✗'));
    }

    function hasShadowMismatch(comparison) {
      const match = comparison?.comparison || {};
      return [match.crimeDecisionMatch, match.crimeReasonMatch, match.profanityPresenceMatch, match.profanityWordsMatch]
        .some(value => value === false);
    }

    function renderShadowComparisons(payload) {
      state.shadowPayload = payload;
      for (const tab of document.querySelectorAll('[data-shadow-filter]')) {
        tab.setAttribute('aria-selected', String(tab.dataset.shadowFilter === state.shadowFilter));
      }
      const summaryContainer = document.getElementById('shadowSummary');
      const list = document.getElementById('shadowComparisons');
      summaryContainer.replaceChildren();
      list.replaceChildren();
      const summary = payload?.summary || {};
      appendShadowMetric(summaryContainer, String(summary.completePairs || 0), 'Полных пар');
      appendShadowMetric(
        summaryContainer,
        formatShadowRatio(summary.crimeDecisionMatches || 0, summary.crimeDecisionCompared || 0),
        'УК: анализировать или нет'
      );
      appendShadowMetric(
        summaryContainer,
        formatShadowRatio(summary.crimeReasonMatches || 0, summary.crimeReasonCompared || 0),
        'УК: причина'
      );
      appendShadowMetric(
        summaryContainer,
        formatShadowRatio(summary.profanityPresenceMatches || 0, summary.profanityPresenceCompared || 0),
        'Мат: есть или нет'
      );
      appendShadowMetric(
        summaryContainer,
        formatShadowRatio(summary.profanityWordsMatches || 0, summary.profanityWordsCompared || 0),
        'Мат: какие слова'
      );
      appendShadowMetric(
        summaryContainer,
        (summary.openaiAverageLatencyMs ?? '—') + ' / ' + (summary.qwenAverageLatencyMs ?? '—') + ' мс',
        'Задержка OpenAI / Qwen'
      );

      const allComparisons = Array.isArray(payload?.comparisons) ? payload.comparisons : [];
      const comparisons = state.shadowFilter === 'diff'
        ? allComparisons.filter(hasShadowMismatch)
        : allComparisons;
      if (!comparisons.length) {
        list.append(emptyNote(allComparisons.length
          ? 'Расхождений за выбранное окно нет.'
          : 'Shadow-данных за выбранное окно пока нет.'));
        return;
      }

      for (const comparison of comparisons) {
        const card = el('article', 'shadowCard');
        const head = el('div', 'shadowCardHead');
        head.append(
          el('span', '', new Date(comparison.createdAt).toLocaleString('ru-RU')),
          el('span', 'mono', comparison.evaluationId)
        );

        const columns = el('div', 'shadowColumns');
        columns.append(
          renderShadowProvider(comparison.openai, 'OpenAI'),
          renderShadowProvider(comparison.qwen, 'Qwen')
        );

        const match = comparison.comparison || {};
        const matchLine = el('div', 'shadowCompareLine');
        matchLine.append(
          shadowMatchChip('решение', match.crimeDecisionMatch),
          shadowMatchChip('причина', match.crimeReasonMatch),
          shadowMatchChip('мат', match.profanityPresenceMatch),
          shadowMatchChip('слова', match.profanityWordsMatch)
        );

        const exactInput = [
          'TARGET:',
          comparison.input?.targetText || '',
          '',
          'SYSTEM:',
          comparison.input?.systemPrompt || '',
          '',
          'USER:',
          comparison.input?.userInput || '',
        ].join(String.fromCharCode(10));
        card.append(head, columns, matchLine);
        appendShadowRaw(card, 'Exact model input', exactInput);
        list.append(card);
      }
    }

    function syncShadowDays() {
      const days = document.getElementById('shadowDays').value;
      for (const button of document.querySelectorAll('[data-shadow-days]')) {
        button.setAttribute('aria-pressed', String(button.dataset.shadowDays === days));
      }
    }

    async function loadShadowComparisons() {
      if (!state.chatId || state.shadowLoading) return;
      state.shadowLoading = true;
      const list = document.getElementById('shadowComparisons');
      list.replaceChildren(emptyNote('Загрузка A/B результатов...'));
      try {
        const days = document.getElementById('shadowDays').value || '3';
        const url = '/admin/api/shadow-evaluations?chatId=' + encodeURIComponent(state.chatId) +
          '&days=' + encodeURIComponent(days) + '&limit=100';
        const response = await fetch(url);
        if (response.status === 401) {
          redirectToLogin();
          return;
        }
        if (!response.ok) throw new Error('shadow comparison unavailable');
        renderShadowComparisons(await response.json());
      } catch (_error) {
        document.getElementById('shadowSummary').replaceChildren();
        list.replaceChildren(emptyNote('Не удалось загрузить A/B результаты.'));
      } finally {
        state.shadowLoading = false;
      }
    }

    // ---------- charts ----------

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
      const value = String(day || '');
      return value ? value.slice(8) + '.' + value.slice(5, 7) : '-';
    }

    function makeChart(id, config) {
      if (!window.Chart) {
        setChartEmpty(id.replace('Chart', ''), true);
        return;
      }
      destroyChart(id);
      const canvas = document.getElementById(id);
      if (!canvas.offsetParent) return;
      chartInstances[id] = new Chart(canvas, config);
    }

    function commonChartOptions(extra = {}) {
      const colors = getThemeColors();
      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: colors.chartTooltipBg,
            titleColor: colors.chartTooltipText,
            bodyColor: colors.chartTooltipText,
            padding: 10,
            titleFont: { size: 12, weight: '600' },
            bodyFont: { size: 12 }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
          },
          y: {
            beginAtZero: true,
            grid: { color: colors.chartGrid },
            border: { display: false },
            ticks: { color: colors.muted, precision: 0 }
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
      select.replaceChildren();
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

    function renderAllCharts(stats) {
      renderCharts(stats.activity || {});
      renderMediaChart(stats.activity || {});
    }

    function renderCharts(activity) {
      state.currentActivity = activity;
      const colors = getThemeColors();
      const dailyMessages = activity.dailyMessages || [];
      const hourlyAverages = shiftHourlyAverages(activity.hourlyAverages || []);
      const hourlyPeak = Math.max(...hourlyAverages.map(row => Number(row.count) || 0), 0);
      const peakHour = hourlyAverages.find(row => (Number(row.count) || 0) === hourlyPeak);

      document.getElementById('hourlyTitle').textContent =
        'Средняя активность по часам, ' + formatTimezoneOffset(getHourlyTimezoneOffset()) +
        (hourlyPeak > 0 && peakHour ? ' · пик в ' + peakHour.hour + ':00' : '');

      setChartEmpty('dailyMessages', dailyMessages.length === 0);
      setChartEmpty('hourly', (activity.hourlyAverages || []).length === 0);

      if (dailyMessages.length) {
        const live = state.stats?.status === 'provisional';
        makeChart('dailyMessagesChart', {
          type: 'bar',
          data: {
            labels: dailyMessages.map(row => compactDayLabel(row.day)),
            datasets: [{
              data: dailyMessages.map(row => Number(row.count) || 0),
              backgroundColor: dailyMessages.map((_row, index) =>
                live && index === dailyMessages.length - 1 ? colors.accentMid : colors.accent),
              borderRadius: 6,
              maxBarThickness: 56
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
              backgroundColor: hourlyAverages.map(row =>
                (Number(row.count) || 0) === hourlyPeak && hourlyPeak > 0 ? colors.accent : colors.accentMid),
              borderRadius: 3,
              maxBarThickness: 14
            }]
          },
          options: commonChartOptions({
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }
              },
              y: {
                beginAtZero: true,
                grid: { color: colors.chartGrid },
                border: { display: false },
                ticks: { color: colors.muted, maxTicksLimit: 4 }
              }
            }
          })
        });
      }
    }

    function renderMediaChart(activity) {
      const colors = getThemeColors();
      const dailyMedia = activity.dailyMedia || [];
      const hasData = dailyMedia.some(row => (Number(row.voiceMinutes) || 0) + (Number(row.videoNoteMinutes) || 0) > 0);
      setChartEmpty('mediaDaily', !hasData);
      if (!hasData) return;
      makeChart('mediaDailyChart', {
        type: 'bar',
        data: {
          labels: dailyMedia.map(row => compactDayLabel(row.day)),
          datasets: [
            { label: 'Голосовые, мин', data: dailyMedia.map(row => Number(row.voiceMinutes) || 0), backgroundColor: colors.accent, borderRadius: 4, maxBarThickness: 52, stack: 'media' },
            { label: 'Кружочки, мин', data: dailyMedia.map(row => Number(row.videoNoteMinutes) || 0), backgroundColor: colors.orange, borderRadius: 4, maxBarThickness: 52, stack: 'media' }
          ]
        },
        options: commonChartOptions({
          scales: {
            x: { stacked: true, grid: { display: false }, ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { stacked: true, beginAtZero: true, grid: { color: colors.chartGrid }, border: { display: false }, ticks: { color: colors.muted } }
          }
        })
      });
    }

    // ---------- notifications ----------

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

    function setNotificationEditAllowed(canEdit) {
      document.getElementById('saveNotifications').disabled = !canEdit;
      document.getElementById('notificationsEnabled').disabled = !canEdit;
      for (const input of document.querySelectorAll('#notificationTypes input')) {
        input.disabled = !canEdit;
      }
    }

    function setNotificationsDirty(dirty) {
      state.notificationsDirty = dirty;
      document.getElementById('notificationsDirty').textContent = dirty ? 'Есть несохранённые изменения' : '';
    }

    function renderNotifications(settings, types, canEdit) {
      state.notificationTypes = types;
      document.getElementById('notificationsEnabled').checked = Boolean(settings?.enabled);
      document.getElementById('notificationMeta').textContent = formatNotificationEditMeta(settings, canEdit);
      const box = document.getElementById('notificationTypes');
      box.replaceChildren();
      const groups = NOTIFICATION_GROUPS.map(group => ({
        title: group.title,
        types: group.types.filter(type => types.includes(type))
      }));
      const known = new Set(NOTIFICATION_GROUPS.flatMap(group => group.types));
      const other = types.filter(type => !known.has(type));
      if (other.length) groups.push({ title: 'Другое', types: other });
      for (const group of groups.filter(item => item.types.length)) {
        box.append(el('h2', 'notificationGroupTitle', group.title));
        for (const type of group.types) {
          const row = el('label', 'switchRow');
          const text = el('span', 'switchText');
          text.append(el('strong', '', labels[type] || type));
          if (NOTIFICATION_DESCRIPTIONS[type]) text.append(el('span', '', NOTIFICATION_DESCRIPTIONS[type]));
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.className = 'switch';
          input.setAttribute('role', 'switch');
          input.dataset.type = type;
          input.checked = Boolean(settings?.notifications?.[type]?.enabled);
          input.addEventListener('change', () => setNotificationsDirty(true));
          row.append(text, input);
          box.append(row);
        }
      }
      if (!types.length) box.append(emptyNote('Нет доступных уведомлений'));
      setNotificationEditAllowed(Boolean(canEdit));
      setNotificationsDirty(false);
    }

    // ---------- all chats ----------

    function formatLastActive(day) {
      if (!day) return 'не было';
      const today = new Date().toISOString().slice(0, 10);
      if (day === today) return 'сегодня';
      const diff = Math.round((Date.parse(today) - Date.parse(day)) / 86400000);
      return diff === 1 ? 'вчера' : diff + ' ' + pluralRu(diff, ['день', 'дня', 'дней']) + ' назад';
    }

    function moduleChip(label, enabledHere, enabledByOwner) {
      const on = enabledHere && enabledByOwner !== false;
      const chip = el('span', 'moduleChip' + (on ? '' : ' off'), label);
      if (enabledByOwner === false) chip.title = 'Выключено владельцем бота';
      return chip;
    }

    function openChat(chatId) {
      document.getElementById('chatSelect').value = String(chatId);
      window.location.hash = '#overview';
      loadDashboard();
    }

    function renderChatCards() {
      const box = document.getElementById('chatCards');
      box.replaceChildren();
      if (!state.chats.length) {
        box.append(emptyNote('Чаты пока не найдены'));
        return;
      }
      const modules = state.modules || {};
      for (const chat of state.chats) {
        const card = el('section', 'card chatCard');
        card.setAttribute('aria-current', String(String(chat.chatId) === String(state.chatId)));
        const head = el('div', 'chatCardHead');
        head.append(avatarNode(chat.title), el('h2', '', chat.title || String(chat.chatId)));
        if (chat.role) head.append(el('span', 'roleBadge' + (chat.role === 'admin' ? ' admin' : ''), chat.role === 'admin' ? 'админ' : 'участник'));
        card.append(head);

        const pulse = el('div', 'chatPulse');
        const metric = (value, label, className) => {
          const box = el('div', className || '');
          box.append(el('strong', '', value), el('span', '', label));
          return box;
        };
        if (chat.pulse) {
          pulse.append(
            metric(formatNumber(chat.pulse.messages), pluralRu(chat.pulse.messages, ['сообщение', 'сообщения', 'сообщений'])),
            metric(formatNumber(chat.pulse.activeUsers), 'активных'),
            metric(formatLastActive(chat.pulse.lastActiveDay), 'последняя активность', 'lastActive')
          );
          card.append(pulse);
        } else {
          card.append(emptyNote('Активность временно недоступна'));
        }

        const settings = chat.settings || {};
        const chips = el('div', 'moduleChips');
        chips.append(
          moduleChip('мат', settings.profanityEnabled !== false, modules.profanity),
          moduleChip('УК РФ', settings.criminalEnabled !== false, modules.criminal),
          moduleChip('сводка', settings.summaryEnabled !== false, modules.summary)
        );
        if (settings.dashboardAccess === 'admins') chips.append(el('span', 'moduleChip note', 'дашборд только админам'));
        card.append(chips);

        const actions = el('div', 'formActions');
        const open = el('button', 'primary', 'Открыть');
        open.type = 'button';
        open.addEventListener('click', () => openChat(chat.chatId));
        actions.append(open);
        if (chat.role === 'admin') {
          const configure = el('button', 'secondary', 'Модули');
          configure.type = 'button';
          configure.addEventListener('click', () => {
            document.getElementById('chatSelect').value = String(chat.chatId);
            window.location.hash = '#modules';
            loadDashboard();
          });
          actions.append(configure);
        }
        card.append(actions);
        box.append(card);
      }
    }

    // ---------- chat modules ----------

    const MODULE_OFF_HINT = 'Выключено владельцем бота для всех чатов';

    function setChatSettingsDirty(dirty) {
      state.chatSettingsDirty = dirty;
      document.getElementById('chatSettingsDirty').textContent = dirty ? 'Есть несохранённые изменения' : '';
    }

    function renderChatSettings(payload) {
      state.chatSettings = payload;
      const settings = payload?.settings || {};
      const modules = payload?.modules || state.modules || {};
      const canEdit = Boolean(payload?.canEdit);
      for (const input of document.querySelectorAll('[data-chat-setting]')) {
        const ownerOff = modules[input.dataset.module] === false;
        input.checked = !ownerOff && settings[input.dataset.chatSetting] !== false;
        input.disabled = !canEdit || ownerOff;
        const hint = document.getElementById(input.id + 'Hint');
        if (!hint.dataset.defaultText) hint.dataset.defaultText = hint.textContent;
        hint.textContent = ownerOff ? MODULE_OFF_HINT : hint.dataset.defaultText;
      }
      const access = document.getElementById('chatDashboardAccess');
      access.value = settings.dashboardAccess === 'admins' ? 'admins' : 'members';
      access.disabled = !canEdit;
      document.getElementById('saveChatSettings').disabled = !canEdit;
      document.getElementById('chatSettingsMeta').textContent = formatNotificationEditMeta(settings, canEdit);
      setChatSettingsDirty(false);
    }

    async function saveChatSettings() {
      if (!state.chatId || state.loading || !state.chatSettings) return;
      const current = state.chatSettings.settings || {};
      const modules = state.chatSettings.modules || {};
      const payload = { dashboardAccess: document.getElementById('chatDashboardAccess').value };
      for (const input of document.querySelectorAll('[data-chat-setting]')) {
        // Keep a chat's own choice for modules the owner switched off instance-wide.
        payload[input.dataset.chatSetting] = modules[input.dataset.module] === false
          ? current[input.dataset.chatSetting] !== false
          : input.checked;
      }
      setStatus('Сохранение...');
      const res = await fetch('/admin/api/chat-settings?chatId=' + encodeURIComponent(state.chatId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok) {
        setStatus('Не удалось сохранить модули. Попробуйте ещё раз.', true);
        return;
      }
      const saved = await res.json();
      renderChatSettings(saved);
      const chat = state.chats.find(item => String(item.chatId) === String(state.chatId));
      if (chat) chat.settings = saved.settings;
      renderChatCards();
      setStatus('Сохранено');
    }

    // ---------- participant card ----------

    function buildMemberUrl(chatId, userId, loadedRange) {
      const url = new URL('/admin/api/member', window.location.origin);
      url.searchParams.set('chatId', chatId);
      url.searchParams.set('userId', String(userId));
      url.searchParams.set('period', 'custom');
      url.searchParams.set('from', loadedRange.from);
      url.searchParams.set('to', loadedRange.to);
      return url.pathname + url.search;
    }

    function memberRelative(value, chatValue, unit) {
      if (chatValue === null || chatValue === undefined || !(Number(chatValue) > 0)) return '';
      if (!(Number(value) > 0)) return '';
      const ratio = Number(value) / Number(chatValue);
      if (ratio >= 0.95 && ratio <= 1.05) return 'как в среднем по чату';
      return (ratio > 1 ? 'в ' + formatDecimal(ratio) + ' раза больше' : 'в ' + formatDecimal(1 / ratio) + ' раза меньше') + ' ' + unit;
    }

    function renderMember(payload) {
      const totals = payload.totals || {};
      const chat = payload.chat || {};
      const previous = payload.previous;
      document.getElementById('memberName').textContent = payload.username;
      const avatar = avatarNode(payload.username);
      const avatarBox = document.getElementById('memberAvatar');
      avatarBox.textContent = avatar.textContent;
      avatarBox.style.background = avatar.style.background;
      const meta = [];
      if (chat.rank) meta.push(chat.rank + '-е место из ' + chat.activeUsers + ' по сообщениям');
      if (payload.firstSeenDay) meta.push('в чате с ' + new Date(payload.firstSeenDay + 'T00:00:00Z').toLocaleDateString('ru-RU', { timeZone: 'UTC' }));
      if (payload.lastMessageTs) meta.push('последнее сообщение ' + new Date(Number(payload.lastMessageTs) * 1000).toLocaleString('ru-RU'));
      document.getElementById('memberMeta').textContent = meta.join(' · ');

      renderKpis('memberKpis', [
        {
          label: 'Сообщения',
          value: formatNumber(totals.messages),
          delta: deltaInfo(totals.messages, previous ? previous.messages : null),
          hint: formatDecimal(chat.share) + '% всех сообщений чата'
        },
        {
          label: 'Слов на сообщение',
          value: formatDecimal(totals.wordsPerMessage),
          hint: memberRelative(totals.wordsPerMessage, chat.wordsPerMessage, 'чем в среднем') || formatNumber(totals.words) + ' слов'
        },
        {
          label: 'Активных дней',
          value: formatNumber(totals.activeDays) + ' из ' + formatNumber(payload.range?.days),
          hint: formatDecimal(totals.voiceMinutes) + ' мин голосовых · ' + formatDecimal(totals.videoNoteMinutes) + ' мин кружков'
        },
        {
          label: 'Доля мата',
          value: totals.profanityRate === null ? '—' : formatRate(totals.profanityRate),
          hint: totals.profanityRate === null
            ? formatNumber(totals.profanity) + ' ' + pluralRu(totals.profanity, ['слово', 'слова', 'слов']) + ', слишком мало текста для доли'
            : (memberRelative(totals.profanityRate, chat.profanityRate, 'чем по чату') || formatNumber(totals.profanity) + ' слов')
        }
      ]);

      const daily = payload.daily || [];
      const activeDays = daily.filter(row => row.messages > 0).length;
      document.getElementById('memberDailyHint').textContent = activeDays
        ? 'в среднем ' + formatDecimal((Number(totals.messages) || 0) / activeDays) + ' в активный день'
        : '';
      const hasDaily = daily.some(row => row.messages > 0);
      setChartEmpty('memberDaily', !hasDaily);
      if (hasDaily) {
        const colors = getThemeColors();
        makeChart('memberDailyChart', {
          type: 'bar',
          data: {
            labels: daily.map(row => compactDayLabel(row.day)),
            datasets: [{ data: daily.map(row => row.messages), backgroundColor: colors.accent, borderRadius: 5, maxBarThickness: 40 }]
          },
          options: commonChartOptions()
        });
      }

      const buckets = document.getElementById('memberBuckets');
      buckets.replaceChildren();
      const userTotal = (payload.buckets || []).reduce((sum, row) => sum + (Number(row.count) || 0), 0);
      const chatTotal = (payload.buckets || []).reduce((sum, row) => sum + (Number(row.chatCount) || 0), 0);
      if (!userTotal) {
        buckets.append(emptyNote('Нет сообщений за период'));
      } else {
        for (const row of payload.buckets) {
          const own = (Number(row.count) || 0) / userTotal * 100;
          const all = chatTotal ? (Number(row.chatCount) || 0) / chatTotal * 100 : 0;
          const line = el('div', 'memberBucket');
          const bars = el('div', 'bars');
          bars.append(barNode(own), barNode(all, 'thin chat'));
          line.append(el('span', 'muted', row.label), bars, el('span', 'num', Math.round(own) + '%'));
          line.title = row.label + ': ' + Math.round(own) + '% сообщений участника, ' + Math.round(all) + '% по чату';
          buckets.append(line);
        }
        const legend = el('div', 'memberLegend');
        const own = el('span');
        const ownSwatch = el('span', 'swatch');
        ownSwatch.style.background = 'var(--accent)';
        own.append(ownSwatch, document.createTextNode('участник'));
        const all = el('span');
        const allSwatch = el('span', 'swatch');
        allSwatch.style.background = 'var(--line)';
        all.append(allSwatch, document.createTextNode('весь чат'));
        legend.append(own, all);
        buckets.append(legend);
      }

      const words = document.getElementById('memberWords');
      words.replaceChildren();
      for (const word of payload.topWords || []) {
        words.append(el('span', 'chip', word.word + ' · ' + formatNumber(word.count)));
      }
      document.getElementById('memberWordsHint').textContent = totals.profanity
        ? formatNumber(totals.profanity) + ' за период'
        : '';
      if (!(payload.topWords || []).length) words.append(emptyNote('Без мата за этот период'));

      const criminalButton = document.getElementById('memberCriminalButton');
      criminalButton.classList.toggle('hidden', !(Number(totals.criminal) > 0));
      criminalButton.textContent = 'Показать нарушения УК (' + formatNumber(totals.criminal) + ')';
    }

    function closeMember() {
      state.memberRequestId += 1;
      state.memberUserId = null;
      destroyChart('memberDailyChart');
      const dialog = document.getElementById('memberDialog');
      if (dialog.open) dialog.close();
    }

    async function openMember(userId, username) {
      if (!state.chatId || !state.loadedCriminalRange) return;
      const requestId = ++state.memberRequestId;
      state.memberUserId = userId;
      const dialog = document.getElementById('memberDialog');
      const status = document.getElementById('memberStatus');
      const body = document.getElementById('memberBody');
      document.getElementById('memberName').textContent = username || 'Участник';
      document.getElementById('memberMeta').textContent = '';
      const avatar = avatarNode(username);
      const avatarBox = document.getElementById('memberAvatar');
      avatarBox.textContent = avatar.textContent;
      avatarBox.style.background = avatar.style.background;
      body.classList.add('hidden');
      status.classList.remove('hidden');
      status.textContent = 'Загрузка...';
      if (!dialog.open) dialog.showModal();
      try {
        const res = await fetch(buildMemberUrl(state.chatId, userId, state.loadedCriminalRange));
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) throw new Error('member unavailable');
        const payload = await res.json();
        if (requestId !== state.memberRequestId) return;
        status.classList.add('hidden');
        body.classList.remove('hidden');
        renderMember(payload);
      } catch (_error) {
        if (requestId !== state.memberRequestId) return;
        status.textContent = 'Не удалось загрузить карточку участника. Попробуйте ещё раз.';
      }
    }

    // ---------- data loading ----------

    function renderChats(chats) {
      state.chats = chats;
      const select = document.getElementById('chatSelect');
      select.replaceChildren();
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
        option.textContent = chat.title || String(chat.chatId);
        select.append(option);
      }
      renderChatCards();
    }

    function redirectToLogin() {
      window.location.assign('/admin');
    }

    function renderStats(stats) {
      state.stats = stats;
      renderOverview(stats);
      renderPeople(stats);
      renderActivityHeatmap(stats.activity?.participantTimeline);
      renderMedia(stats);
      renderProfanity(stats);
      renderCriminalRows(stats.criminal?.topUsers || []);
      renderAllCharts(stats);
    }

    async function loadChats() {
      setStatus('Загрузка чатов...');
      renderDashboardSkeleton();
      try {
        const res = await fetch('/admin/api/chats');
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) throw new Error('chats unavailable');
        const body = await res.json();
        state.modules = body.modules || null;
        renderChats(body.chats || []);
        finishDashboardLoading();
        if ((body.chats || []).length) {
          await loadDashboard();
        } else {
          document.getElementById('views').classList.add('hidden');
          setStatus('Чаты появятся после новых сообщений или после обнаружения старых счетчиков.');
        }
      } catch (error) {
        finishDashboardLoading();
        renderEmptyDashboard();
        setStatus('Не удалось загрузить список чатов. Попробуйте обновить страницу.', true);
      }
    }

    async function loadDashboard() {
      if (state.loading) return;
      const chatId = document.getElementById('chatSelect').value;
      const period = document.getElementById('period').value;
      if (!chatId) return;
      if (chatId !== state.chatId) state.shadowPayload = null;
      state.chatId = chatId;

      try {
        const statsUrl = buildStatsUrl(chatId, period);
        setStatus('Загрузка...');
        renderDashboardSkeleton();
        const [statsRes, notificationsRes, chatSettingsRes] = await Promise.all([
          fetch(statsUrl),
          fetch('/admin/api/notifications?chatId=' + encodeURIComponent(chatId)),
          fetch('/admin/api/chat-settings?chatId=' + encodeURIComponent(chatId))
        ]);
        if (statsRes.status === 401 || notificationsRes.status === 401 || chatSettingsRes.status === 401) {
          redirectToLogin();
          return;
        }
        if (!statsRes.ok) {
          finishDashboardLoading();
          renderStatsError(await readErrorPayload(statsRes));
          return;
        }
        const notificationsError = !notificationsRes.ok
          ? await readErrorPayload(notificationsRes)
          : null;

        const stats = await statsRes.json();
        state.loadedCriminalRange = stats.range?.from && stats.range?.to
          ? { from: stats.range.from, to: stats.range.to }
          : null;
        const notifications = notificationsRes.ok
          ? await notificationsRes.json()
          : { settings: null, availableTypes: [], canEdit: false };

        finishDashboardLoading();
        hideStatsError();
        document.getElementById('views').classList.remove('hidden');
        renderStats(stats);
        renderNotifications(
          notifications.settings,
          notifications.availableTypes,
          notifications.canEdit
        );
        renderChatSettings(chatSettingsRes.ok
          ? await chatSettingsRes.json()
          : {
            // Unknown state: show everything off and read-only rather than guessing "on".
            settings: { profanityEnabled: false, criminalEnabled: false, summaryEnabled: false, dashboardAccess: 'admins' },
            modules: state.modules,
            canEdit: false
          });
        if (!chatSettingsRes.ok) {
          document.getElementById('chatSettingsMeta').textContent = 'Настройки чата временно недоступны.';
        }
        renderChatCards();
        if (state.view === 'lab') void loadShadowComparisons();
        const servedRange = stats.range && stats.range.from && stats.range.to
          ? stats.range.from + ' – ' + stats.range.to
          : '';
        const provisional = stats.status === 'provisional';
        const pendingAnalysis = stats.progress
          ? (Number(stats.progress.pendingAnalysis) || 0)
          : 0;
        const liveBadge = provisional ? 'включая сегодня · live' : '';
        const pendingBadge = provisional && pendingAnalysis > 0
          ? 'анализ продолжается (' + pendingAnalysis + ')'
          : '';
        const statusLine = [
          notificationsError
            ? 'Статистика загружена · ' + servedRange
            : 'Обновлено · период ' + servedRange,
          liveBadge,
          pendingBadge
        ].filter(Boolean).join(' · ');
        setLiveStatus(
          notificationsError
            ? statusLine + '. Настройки уведомлений временно недоступны.'
            : statusLine,
          provisional
        );
      } catch (error) {
        finishDashboardLoading();
        renderStatsError(null);
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
      if (res.status === 401) {
        redirectToLogin();
        return;
      }
      if (!res.ok) {
        setStatus('Не удалось сохранить настройки. Попробуйте ещё раз.', true);
        return;
      }
      await loadDashboard();
    }

    // ---------- wiring ----------

    document.getElementById('controls').addEventListener('submit', event => {
      event.preventDefault();
      loadDashboard();
    });
    for (const button of document.querySelectorAll('#periodSeg button')) {
      button.addEventListener('click', () => selectPeriod(button.dataset.period));
    }
    document.getElementById('chatSelect').addEventListener('change', () => loadDashboard());
    for (const tab of document.querySelectorAll('#leaderTabs .tab')) {
      tab.addEventListener('click', () => {
        state.leaderMetric = tab.dataset.metric;
        if (state.stats) renderLeaders(state.stats);
      });
    }
    for (const tab of document.querySelectorAll('[data-profanity-sort]')) {
      tab.addEventListener('click', () => {
        state.profanitySort = tab.dataset.profanitySort;
        if (state.stats) renderProfanityRateRows(state.stats);
      });
    }
    for (const tab of document.querySelectorAll('[data-shadow-filter]')) {
      tab.addEventListener('click', () => {
        state.shadowFilter = tab.dataset.shadowFilter;
        if (state.shadowPayload) renderShadowComparisons(state.shadowPayload);
      });
    }
    for (const button of document.querySelectorAll('[data-shadow-days]')) {
      button.addEventListener('click', () => {
        document.getElementById('shadowDays').value = button.dataset.shadowDays;
        syncShadowDays();
        loadShadowComparisons();
      });
    }
    document.getElementById('statsErrorWeek').addEventListener('click', () => {
      selectPeriod('week');
    });
    document.getElementById('statsErrorRetry').addEventListener('click', () => {
      loadDashboard();
    });
    document.getElementById('shadowRefresh').addEventListener('click', () => {
      loadShadowComparisons();
    });
    document.getElementById('themeSelect').addEventListener('change', event => {
      const mode = normalizeThemeMode(event.target.value);
      applyThemeMode(mode);
      writeThemeMode(mode);
      refreshThemedCharts();
    });
    document.getElementById('hourlyTimezone').addEventListener('change', event => {
      writeTimezoneOffset(clampTimezoneOffset(event.target.value));
      if (state.currentActivity) {
        renderCharts(state.currentActivity);
      }
    });
    document.getElementById('notificationsEnabled').addEventListener('change', () => setNotificationsDirty(true));
    document.getElementById('saveNotifications').addEventListener('click', saveNotifications);
    document.getElementById('criminalDetailsClose').addEventListener('click', closeCriminalDetails);
    document.getElementById('saveChatSettings').addEventListener('click', saveChatSettings);
    for (const input of document.querySelectorAll('[data-chat-setting], #chatDashboardAccess')) {
      input.addEventListener('change', () => setChatSettingsDirty(true));
    }
    document.getElementById('memberClose').addEventListener('click', closeMember);
    document.getElementById('memberDialog').addEventListener('close', () => {
      state.memberRequestId += 1;
      destroyChart('memberDailyChart');
    });
    document.getElementById('memberDialog').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeMember();
    });
    document.getElementById('memberCriminalButton').addEventListener('click', () => {
      const userId = state.memberUserId;
      const username = document.getElementById('memberName').textContent;
      closeMember();
      window.location.hash = '#criminal';
      if (userId) loadCriminalDetails({ userId, username });
    });
    window.addEventListener('hashchange', () => showView(currentViewFromHash()));
    setupThemeControl();
    watchSystemThemeChanges();
    setupHourlyTimezoneControl();
    setupCustomPeriodDefaults();
    document.getElementById('period').value = readPeriod();
    syncCustomPeriodControls();
    syncShadowDays();
    showView(currentViewFromHash());
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
