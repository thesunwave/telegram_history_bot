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
  </script>
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
      --input: #ffffff;
      --surface: #fbfcfd;
      --metric-bg: linear-gradient(180deg, #fff 0%, #f9fbfc 100%);
      --skeleton-base: #eef1f5;
      --skeleton-highlight: #f7f8fa;
      --shadow: rgba(24, 32, 42, .14);
      --chart-grid: #eef1f5;
      --chart-tooltip-bg: #18202a;
      --chart-tooltip-text: #ffffff;
      --daily-fill: rgba(23, 107, 135, .14);
    }
    :root[data-theme-mode="dark"] {
      color-scheme: dark;
      --bg: #0f1419;
      --panel: #171d24;
      --text: #f2f5f7;
      --muted: #a9b4c0;
      --line: #2b3540;
      --accent: #62b6d2;
      --accent-strong: #8bd3e9;
      --accent-soft: #132a34;
      --green: #50c891;
      --orange: #f2a15f;
      --purple: #a99df5;
      --danger: #ff8f86;
      --input: #10161d;
      --surface: #111820;
      --metric-bg: linear-gradient(180deg, #1b232c 0%, #151d25 100%);
      --skeleton-base: #222b35;
      --skeleton-highlight: #303b47;
      --shadow: rgba(0, 0, 0, .45);
      --chart-grid: #28333e;
      --chart-tooltip-bg: #0b1015;
      --chart-tooltip-text: #f2f5f7;
      --daily-fill: rgba(98, 182, 210, .18);
    }
    @media (prefers-color-scheme: dark) {
      :root:not([data-theme-mode="light"]) {
        color-scheme: dark;
        --bg: #0f1419;
        --panel: #171d24;
        --text: #f2f5f7;
        --muted: #a9b4c0;
        --line: #2b3540;
        --accent: #62b6d2;
        --accent-strong: #8bd3e9;
        --accent-soft: #132a34;
        --green: #50c891;
        --orange: #f2a15f;
        --purple: #a99df5;
        --danger: #ff8f86;
        --input: #10161d;
        --surface: #111820;
        --metric-bg: linear-gradient(180deg, #1b232c 0%, #151d25 100%);
        --skeleton-base: #222b35;
        --skeleton-highlight: #303b47;
        --shadow: rgba(0, 0, 0, .45);
        --chart-grid: #28333e;
        --chart-tooltip-bg: #0b1015;
        --chart-tooltip-text: #f2f5f7;
        --daily-fill: rgba(98, 182, 210, .18);
      }
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
    .topbarRight {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 14px;
      flex-wrap: wrap;
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
      background: var(--input);
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
      background: var(--input);
      color: var(--text);
    }
    button:disabled {
      opacity: .55;
      cursor: default;
    }
    .loadingControl {
      background:
        linear-gradient(
          90deg,
          var(--skeleton-base) 25%,
          var(--skeleton-highlight) 37%,
          var(--skeleton-base) 63%
        );
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
    section.dragging {
      opacity: .58;
      outline: 2px dashed var(--accent);
      outline-offset: 3px;
    }
    section.dragOver {
      box-shadow: 0 0 0 2px var(--accent);
    }
    .dashboardToolbar {
      display: flex;
      justify-content: flex-end;
      margin: 0 0 12px;
    }
    .dashboardToolbar button {
      min-height: 34px;
      font-size: 12px;
    }
    .blockHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .blockHeader h2 {
      margin: 0;
    }
    .blockActions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 0 0 auto;
    }
    .blockActions button {
      min-width: 34px;
      min-height: 32px;
      padding: 0 8px;
      font-size: 14px;
      line-height: 1;
    }
    .dragHandle {
      cursor: grab;
      touch-action: none;
    }
    .dragHandle:active {
      cursor: grabbing;
    }
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
      background: var(--metric-bg);
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
        linear-gradient(
          90deg,
          var(--skeleton-base) 25%,
          var(--skeleton-highlight) 37%,
          var(--skeleton-base) 63%
        );
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
        linear-gradient(
          90deg,
          var(--skeleton-base) 25%,
          var(--skeleton-highlight) 37%,
          var(--skeleton-base) 63%
        );
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
        linear-gradient(
          90deg,
          var(--skeleton-base) 25%,
          var(--skeleton-highlight) 37%,
          var(--skeleton-base) 63%
        );
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
      background: var(--surface);
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
      background: var(--surface);
    }
    .tableScroll {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }
    .activityRhythmGrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .activityRhythmCard {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }
    .activityRhythmCardHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .activityRhythmCard h3,
    .activityDetailTitle {
      margin: 0;
      font-size: 14px;
    }
    .rhythmSelect {
      min-height: 30px;
      padding: 0 9px;
      font-size: 12px;
    }
    .rhythmSelect[aria-pressed="true"] {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent-strong);
    }
    .rhythmTable,
    .activityHeatmap {
      width: max-content;
      min-width: max-content;
      border-collapse: separate;
      border-spacing: 3px;
    }
    .rhythmTable th,
    .rhythmTable td,
    .activityHeatmap th,
    .activityHeatmap td {
      border: 0;
      padding: 0;
      text-align: center;
    }
    .rhythmTable .heatmapBucket,
    .activityHeatmap .heatmapBucket,
    .activityHeatmap .heatmapCorner {
      padding: 5px 7px;
      background: var(--panel);
      color: var(--muted);
      text-align: left;
      white-space: nowrap;
      font-size: 11px;
      font-weight: 650;
    }
    .rhythmTable .heatmapDay {
      width: 28px;
      min-width: 28px;
      height: 22px;
      padding: 2px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
    }
    .activityHeatmap .heatmapDay {
      width: 40px;
      min-width: 40px;
      height: 26px;
      padding: 2px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
    }
    .activityHeatmap .heatmapBucket,
    .activityHeatmap .heatmapCorner {
      position: sticky;
      left: 0;
      z-index: 1;
    }
    .activityHeatmap .heatmapCorner {
      z-index: 2;
      color: var(--text);
    }
    .heatmapCell {
      width: 28px;
      min-width: 28px;
      height: 22px;
      border-radius: 4px;
    }
    .heatmap-inactive {
      background: var(--line);
    }
    .heatmap-active {
      background: var(--accent-soft);
    }
    .heatmap-talkative {
      background: var(--accent);
    }
    @supports (background: color-mix(in srgb, black 50%, white)) {
      .heatmap-inactive { background: color-mix(in srgb, var(--line) 72%, var(--panel)); }
      .heatmap-active { background: color-mix(in srgb, var(--accent) 48%, var(--panel)); }
      .heatmap-talkative { background: color-mix(in srgb, var(--accent) 78%, var(--panel)); }
    }
    .heatmapLegend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 12px;
      color: var(--muted);
      font-size: 12px;
    }
    .heatmapLegendItem {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .heatmapLegendSwatch {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1px solid color-mix(in srgb, var(--text) 16%, transparent);
    }
    .heatmapContext {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 12px;
    }
    .activityDetail {
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }
    .activityDetailTitle {
      margin: 0 0 10px;
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
      background: var(--surface);
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
    .statsError {
      margin-bottom: 18px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .statsError h2 {
      margin: 0 0 8px;
      color: var(--danger);
    }
    .statsError p {
      margin: 0 0 16px;
      color: var(--muted);
      max-width: 640px;
    }
    .statsErrorActions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
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
    button.criminalUserButton {
      min-height: 30px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      font-weight: 650;
      text-align: left;
      text-decoration: underline;
      text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent);
      text-underline-offset: 3px;
    }
    button.criminalUserButton:hover,
    button.criminalUserButton:focus-visible {
      color: var(--accent-strong);
      text-decoration-color: var(--accent);
    }
    .criminalDetails {
      margin-top: 14px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }
    .criminalDetailsHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
    }
    .criminalDetailsHeader h3 {
      margin: 0;
      font-size: 14px;
    }
    .criminalDetailsHeader button {
      min-height: 32px;
      padding: 0 10px;
      font-size: 12px;
    }
    .criminalConfidenceNote {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 11px;
    }
    .criminalViolationList {
      display: grid;
      gap: 10px;
    }
    .criminalViolationCard {
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }
    .criminalViolationHead {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 10px;
    }
    .criminalViolationTitle {
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .criminalBadges {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .criminalBadge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: var(--panel);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
    }
    .criminalField {
      margin-top: 9px;
    }
    .criminalFieldLabel {
      margin-bottom: 3px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 750;
    }
    .criminalTrigger {
      margin: 0;
      padding: 9px 10px;
      border-left: 3px solid var(--accent);
      background: var(--panel);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .criminalContext {
      display: grid;
      gap: 6px;
    }
    .criminalContextMessage {
      padding: 7px 9px;
      border-left: 2px solid var(--line);
      background: var(--panel);
    }
    .criminalContextMeta {
      margin-bottom: 2px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 700;
    }
    .criminalOccurredAt {
      margin-top: 9px;
      color: var(--muted);
      font-size: 10px;
    }
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
      z-index: 1;
      cursor: help;
    }
    .hasTooltip:hover,
    .hasTooltip:focus {
      z-index: 20;
    }
    .tooltip {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: min(260px, calc(100vw - 48px));
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      box-shadow: 0 10px 24px var(--shadow);
      color: var(--text);
      font-size: 12px;
      font-weight: 500;
      pointer-events: none;
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
    .themeControl {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .themeControl select {
      width: 112px;
      min-height: 32px;
      padding: 0 8px;
      font-size: 12px;
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
      .topbarRight { width: 100%; justify-content: space-between; }
      form.controls { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .charts { grid-template-columns: 1fr; }
      .chartPanel.wide { grid-column: auto; }
      .bucketGrid { grid-template-columns: 1fr; }
      .toggles { grid-template-columns: 1fr; }
      .activityRhythmGrid { grid-template-columns: 1fr; }
      .rhythmTable { width: 100%; min-width: 0; }
      .rhythmTable .heatmapBucket { min-width: 102px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap topbar">
      <h1>Telegram Stats Admin</h1>
      <div class="topbarRight">
        <label class="themeControl">Тема
          <select id="themeSelect" aria-label="Тема оформления">
            <option value="system">Система</option>
            <option value="light">День</option>
            <option value="dark">Ночь</option>
          </select>
        </label>
        <div class="muted" id="sessionLabel"></div>
      </div>
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
          <option value="today">Сегодня · live</option>
          <option value="week">Неделя · 7 дней, включая сегодня</option>
          <option value="month">Месяц · 30 дней, включая сегодня</option>
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
    <div id="statsError" class="statsError hidden">
      <h2 id="statsErrorTitle"></h2>
      <p id="statsErrorMessage"></p>
      <div class="statsErrorActions">
        <button type="button" id="statsErrorWeek" class="secondary hidden">Показать неделю, включая сегодня</button>
        <button type="button" id="statsErrorRetry" class="secondary hidden">Повторить</button>
      </div>
    </div>
    <div class="dashboardToolbar hidden" id="dashboardToolbar">
      <button class="secondary" id="resetDashboardLayout" type="button">Сбросить раскладку</button>
    </div>
    <div class="grid hidden" id="dashboard">
      <section class="wide" data-block-id="activity">
        <div class="blockHeader">
          <h2>Активность</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
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
            <div class="metric" id="activityVoiceCount">0</div>
            <div class="metricLabel">Голосовые</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityVoiceMinutes">0</div>
            <div class="metricLabel">Мин. голос.</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityVideoNoteCount">0</div>
            <div class="metricLabel">Кружочки</div>
          </div>
          <div class="metricBox">
            <div class="metric" id="activityVideoNoteMinutes">0</div>
            <div class="metricLabel">Мин. круж.</div>
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
      <section class="wide" data-block-id="time-buckets">
        <div class="blockHeader">
          <h2>Лидеры по времени суток</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <div class="bucketGrid" id="timeBuckets"></div>
      </section>
      <section class="wide" data-block-id="participant-activity">
        <div class="blockHeader">
          <h2>Ритм участников</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <p class="heatmapContext">Обзор показывает типичный ритм по дням недели; время — UTC.</p>
        <div class="heatmapLegend" aria-label="Обозначения активности">
          <span class="heatmapLegendItem"><span class="heatmapLegendSwatch heatmap-inactive"></span>Нет активности</span>
          <span class="heatmapLegendItem"><span class="heatmapLegendSwatch heatmap-active"></span>Активен</span>
          <span class="heatmapLegendItem"><span class="heatmapLegendSwatch heatmap-talkative"></span>Активно общается</span>
        </div>
        <div class="activityRhythmGrid" id="activityRhythmOverview" aria-live="polite"></div>
        <div class="activityDetail">
          <h3 class="activityDetailTitle" id="activityDetailTitle">Детали по дням</h3>
          <div class="tableScroll" id="activityHeatmap" aria-live="polite"></div>
        </div>
      </section>
      <section data-block-id="talkers">
        <div class="blockHeader">
          <h2>Болтуны</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Слова</th><th>Сообщения</th><th>Слов/сообщ.</th></tr></thead>
            <tbody id="activityTalkers"></tbody>
          </table>
        </div>
      </section>
      <section data-block-id="voice">
        <div class="blockHeader">
          <h2>Голосовые</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Минуты</th><th>Штук</th></tr></thead>
            <tbody id="activityVoiceUsers"></tbody>
          </table>
        </div>
      </section>
      <section data-block-id="video-notes">
        <div class="blockHeader">
          <h2>Кружочки</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Минуты</th><th>Штук</th></tr></thead>
            <tbody id="activityVideoNoteUsers"></tbody>
          </table>
        </div>
      </section>
      <section data-block-id="profanity-users">
        <div class="blockHeader">
          <h2>Мат</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Счет</th></tr></thead>
            <tbody id="profanityUsers"></tbody>
          </table>
        </div>
      </section>
      <section class="wide" data-block-id="profanity-rate">
        <div class="blockHeader">
          <h2>Доля мата</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
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
      <section data-block-id="profanity-words">
        <div class="blockHeader">
          <h2>Слова</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Слово</th><th>Счет</th></tr></thead>
            <tbody id="profanityWords"></tbody>
          </table>
        </div>
      </section>
      <section data-block-id="criminal">
        <div class="blockHeader">
          <h2>УК РФ</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
        <div class="tableScroll">
          <table>
            <thead><tr><th>Пользователь</th><th>Нарушения</th></tr></thead>
            <tbody id="criminalUsers"></tbody>
          </table>
        </div>
        <div class="criminalDetails hidden" id="criminalDetails" aria-live="polite">
          <div class="criminalDetailsHeader">
            <h3 id="criminalDetailsTitle">Детали нарушений</h3>
            <button class="secondary" id="criminalDetailsClose" type="button">Закрыть</button>
          </div>
          <p class="criminalConfidenceNote">Уверенность модели — это confidence конкретного анализа, а не измеренная точность классификатора.</p>
          <div class="criminalViolationList" id="criminalViolationList"></div>
        </div>
      </section>
      <section class="wide" data-block-id="notifications">
        <div class="blockHeader">
          <h2>Автоуведомления</h2>
          <div class="blockActions">
            <button class="secondary sizeToggle" type="button" aria-label="Изменить ширину блока">↔</button>
            <button class="secondary dragHandle" type="button" aria-label="Перетащить блок">⋮⋮</button>
          </div>
        </div>
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
    const THEME_STORAGE_KEY = 'telegramStatsAdmin.theme';
    const DASHBOARD_LAYOUT_STORAGE_KEY = 'telegramStatsAdmin.dashboardLayout.v1';
    const THEME_MODES = ['system', 'light', 'dark'];
    const DEFAULT_DASHBOARD_BLOCKS = [
      { id: 'activity', size: 'wide' },
      { id: 'time-buckets', size: 'wide' },
      { id: 'participant-activity', size: 'wide' },
      { id: 'talkers', size: 'normal' },
      { id: 'voice', size: 'normal' },
      { id: 'video-notes', size: 'normal' },
      { id: 'profanity-users', size: 'normal' },
      { id: 'profanity-rate', size: 'wide' },
      { id: 'profanity-words', size: 'normal' },
      { id: 'criminal', size: 'normal' },
      { id: 'notifications', size: 'wide' }
    ];
    const state = {
      chatId: '',
      notificationTypes: [],
      chats: [],
      loading: false,
      currentActivity: null,
      currentProfanityRateRows: null,
      criminalDetailsRequestId: 0,
      selectedCriminalUserId: null,
      loadedCriminalRange: null
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

    function readCssVar(name) {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    }

    function getThemeColors() {
      return {
        text: readCssVar('--text'),
        muted: readCssVar('--muted'),
        accent: readCssVar('--accent'),
        green: readCssVar('--green'),
        orange: readCssVar('--orange'),
        purple: readCssVar('--purple'),
        chartGrid: readCssVar('--chart-grid'),
        chartTooltipBg: readCssVar('--chart-tooltip-bg'),
        chartTooltipText: readCssVar('--chart-tooltip-text'),
        dailyFill: readCssVar('--daily-fill')
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

    function getDefaultDashboardLayout() {
      return {
        order: DEFAULT_DASHBOARD_BLOCKS.map(block => block.id),
        sizes: Object.fromEntries(DEFAULT_DASHBOARD_BLOCKS.map(block => [block.id, block.size]))
      };
    }

    function normalizeDashboardLayout(layout) {
      const defaults = getDefaultDashboardLayout();
      const knownIds = new Set(defaults.order);
      const order = [];
      const rawOrder = Array.isArray(layout?.order) ? layout.order : [];
      for (const id of rawOrder) {
        if (knownIds.has(id) && !order.includes(id)) {
          order.push(id);
        }
      }
      for (const id of defaults.order) {
        if (!order.includes(id)) {
          order.push(id);
        }
      }

      const sizes = {};
      for (const id of order) {
        const savedSize = layout?.sizes?.[id];
        sizes[id] = savedSize === 'wide' || savedSize === 'normal' ? savedSize : defaults.sizes[id];
      }

      return { order, sizes };
    }

    function readDashboardLayout() {
      try {
        const stored = localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
        return normalizeDashboardLayout(stored ? JSON.parse(stored) : null);
      } catch (_error) {
        return getDefaultDashboardLayout();
      }
    }

    function writeDashboardLayout(layout) {
      try {
        localStorage.setItem(
          DASHBOARD_LAYOUT_STORAGE_KEY,
          JSON.stringify(normalizeDashboardLayout(layout)),
        );
      } catch (_error) {
        // Local storage can be unavailable in restricted browser modes.
      }
    }

    function syncDashboardSizeButtons() {
      for (const section of document.querySelectorAll('#dashboard section[data-block-id]')) {
        const button = section.querySelector('.sizeToggle');
        if (!button) continue;
        const isWide = section.classList.contains('wide');
        button.setAttribute('aria-pressed', String(isWide));
        button.title = isWide ? 'Сделать блок компактным' : 'Растянуть блок на всю ширину';
      }
    }

    function applyDashboardLayout(layout) {
      const dashboard = document.getElementById('dashboard');
      const normalized = normalizeDashboardLayout(layout);
      const sections = new Map(
        Array.from(dashboard.querySelectorAll('section[data-block-id]'))
          .map(section => [section.dataset.blockId, section])
      );

      for (const id of normalized.order) {
        const section = sections.get(id);
        if (!section) continue;
        section.classList.toggle('wide', normalized.sizes[id] === 'wide');
        dashboard.append(section);
      }
      syncDashboardSizeButtons();
    }

    function getCurrentDashboardLayout() {
      const order = [];
      const sizes = {};
      for (const section of document.querySelectorAll('#dashboard section[data-block-id]')) {
        const id = section.dataset.blockId;
        order.push(id);
        sizes[id] = section.classList.contains('wide') ? 'wide' : 'normal';
      }
      return normalizeDashboardLayout({ order, sizes });
    }

    function refreshDashboardCharts() {
      for (const chart of Object.values(chartInstances)) {
        if (chart?.resize) chart.resize();
        if (chart?.update) chart.update('none');
      }
    }

    function setupDashboardSizeControls() {
      for (const button of document.querySelectorAll('#dashboard .sizeToggle')) {
        button.addEventListener('click', () => {
          const section = button.closest('section[data-block-id]');
          section.classList.toggle('wide');
          syncDashboardSizeButtons();
          writeDashboardLayout(getCurrentDashboardLayout());
          refreshDashboardCharts();
        });
      }
      syncDashboardSizeButtons();
    }

    function setupDashboardDragAndDrop() {
      let draggedBlockId = null;
      for (const section of document.querySelectorAll('#dashboard section[data-block-id]')) {
        const handle = section.querySelector('.dragHandle');
        if (!handle) continue;
        handle.addEventListener('pointerdown', () => {
          section.draggable = true;
        });
        handle.addEventListener('pointerup', () => {
          section.draggable = false;
        });
        section.addEventListener('dragstart', event => {
          draggedBlockId = section.dataset.blockId;
          section.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', draggedBlockId);
        });
        section.addEventListener('dragend', () => {
          section.draggable = false;
          section.classList.remove('dragging');
          section.classList.remove('dragOver');
          draggedBlockId = null;
        });
        section.addEventListener('dragover', event => {
          if (!draggedBlockId || draggedBlockId === section.dataset.blockId) return;
          event.preventDefault();
          section.classList.add('dragOver');
        });
        section.addEventListener('dragleave', () => {
          section.classList.remove('dragOver');
        });
        section.addEventListener('drop', event => {
          event.preventDefault();
          section.classList.remove('dragOver');
          const dragged = document.querySelector(
            '#dashboard section[data-block-id="' + draggedBlockId + '"]'
          );
          if (!dragged || dragged === section) return;

          const rect = section.getBoundingClientRect();
          const shouldPlaceAfter = event.clientY > rect.top + rect.height / 2;
          section.parentElement.insertBefore(dragged, shouldPlaceAfter ? section.nextSibling : section);
          writeDashboardLayout(getCurrentDashboardLayout());
          refreshDashboardCharts();
        });
      }
    }

    function resetDashboardLayout() {
      try {
        localStorage.removeItem(DASHBOARD_LAYOUT_STORAGE_KEY);
      } catch (_error) {
        // Local storage can be unavailable in restricted browser modes.
      }
      applyDashboardLayout(getDefaultDashboardLayout());
      refreshDashboardCharts();
    }

    function applyThemeMode(mode) {
      const normalized = normalizeThemeMode(mode);
      document.documentElement.dataset.themeMode = normalized;
      document.getElementById('themeSelect').value = normalized;
    }

    function refreshThemedCharts() {
      if (state.currentActivity) {
        renderCharts(state.currentActivity);
      }
      if (state.currentProfanityRateRows) {
        renderProfanityRateRows(state.currentProfanityRateRows);
      }
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

    function setStatus(text, isError = false) {
      const el = document.getElementById('status');
      el.classList.remove('hidden');
      el.textContent = text;
      el.className = isError ? 'status error' : 'status';
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
      document.getElementById('dashboard').classList.add('hidden');
      document.getElementById('dashboardToolbar').classList.add('hidden');
      document.getElementById('status').classList.add('hidden');
    }

    function hideStatsError() {
      document.getElementById('statsError').classList.add('hidden');
      document.getElementById('status').classList.remove('hidden');
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
      closeCriminalDetails();
      document.getElementById('dashboard').classList.remove('hidden');
      setControlsDisabled(true);
      for (const id of [
        'activityTotal',
        'activityWords',
        'activityWordsPerMessage',
        'activityVoiceCount',
        'activityVoiceMinutes',
        'activityVideoNoteCount',
        'activityVideoNoteMinutes',
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
      renderActivityHeatmap([]);
      document.getElementById('profanityRatePeak').textContent = '0%';
      setChartEmpty('profanityRate', true);
      renderTimeBuckets([]);
      renderSkeletonRows('activityUsers', 4);
      renderSkeletonRows('activityTalkers', 4);
      renderSkeletonRows('activityVoiceUsers', 3);
      renderSkeletonRows('activityVideoNoteUsers', 3);
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
        'activityVoiceCount',
        'activityVoiceMinutes',
        'activityVideoNoteCount',
        'activityVideoNoteMinutes',
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
      document.getElementById('activityVoiceCount').textContent = '0';
      document.getElementById('activityVoiceMinutes').textContent = '0';
      document.getElementById('activityVideoNoteCount').textContent = '0';
      document.getElementById('activityVideoNoteMinutes').textContent = '0';
      document.getElementById('activityActiveUsers').textContent = '0';
      document.getElementById('activityAvgDaily').textContent = '0';
      document.getElementById('activityAvgDailyUsers').textContent = '0';
      document.getElementById('activityAvgHourly').textContent = '0';
      renderCharts({ dailyMessages: [], dailyActiveUsers: [], hourlyAverages: [] });
      renderActivityHeatmap([]);
      renderTimeBuckets([]);
      renderActivityRows('activityUsers', [], 'messages');
      renderActivityRows('activityTalkers', [], 'words');
      renderMediaRows('activityVoiceUsers', [], 'voice');
      renderMediaRows('activityVideoNoteUsers', [], 'videoNote');
      renderRows('profanityUsers', [], 'username', 'count');
      renderProfanityRateRows([]);
      renderRows('profanityWords', [], 'word', 'count');
      renderCriminalRows([]);
      renderNotifications({ enabled: false, notifications: {} }, [], false);
    }

    function showLogin() {
      document.getElementById('loginPanel').classList.remove('hidden');
      document.getElementById('controls').classList.add('hidden');
      document.getElementById('dashboard').classList.add('hidden');
      document.getElementById('dashboardToolbar').classList.add('hidden');
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
      document.getElementById('dashboardToolbar').classList.remove('hidden');
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

    function formatCriminalArticle(violation) {
      const article = String(violation?.article || '?')
        .replace(/^Статья\s+/i, '')
        .replace(/\s+УК\s+РФ$/i, '');
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
      const field = document.createElement('div');
      field.className = 'criminalField';
      const label = document.createElement('div');
      label.className = 'criminalFieldLabel';
      label.textContent = labelText;
      const value = document.createElement('div');
      value.textContent = valueText;
      field.append(label, value);
      card.append(field);
    }

    function appendCriminalContext(card, violation) {
      const contextMessages = Array.isArray(violation.contextMessages) ? violation.contextMessages : [];
      if (contextMessages.length) {
        const field = document.createElement('div');
        field.className = 'criminalField';
        const label = document.createElement('div');
        label.className = 'criminalFieldLabel';
        label.textContent = 'Контекст переписки';
        const context = document.createElement('div');
        context.className = 'criminalContext';
        for (const message of contextMessages) {
          const item = document.createElement('div');
          item.className = 'criminalContextMessage';
          const meta = document.createElement('div');
          meta.className = 'criminalContextMeta';
          meta.textContent = (Number(message.relativePosition) < 0 ? 'До' : 'После') + ' · ' +
            (message.username || 'unknown');
          const text = document.createElement('div');
          text.textContent = message.text || '';
          item.append(meta, text);
          context.append(item);
        }
        field.append(label, context);
        card.append(field);
      } else if (!violation.contextSummary) {
        const field = document.createElement('div');
        field.className = 'criminalField';
        const label = document.createElement('div');
        label.className = 'criminalFieldLabel';
        label.textContent = 'Контекст переписки';
        const unavailable = document.createElement('div');
        unavailable.className = 'muted';
        unavailable.textContent = 'Исходный контекст недоступен. История сообщений хранится до 7 дней.';
        field.append(label, unavailable);
        card.append(field);
      }

      if (violation.contextSummary) {
        appendCriminalField(card, 'Контекст, который учла модель', violation.contextSummary);
      }
    }

    function renderCriminalDetails(username, payload) {
      const panel = document.getElementById('criminalDetails');
      const list = document.getElementById('criminalViolationList');
      document.getElementById('criminalDetailsTitle').textContent = 'Нарушения: ' + username;
      list.innerHTML = '';
      const violations = Array.isArray(payload?.violations) ? payload.violations : [];

      if (!violations.length) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.textContent = 'Детали нарушений за этот период не найдены.';
        list.append(empty);
        panel.classList.remove('hidden');
        return;
      }

      for (const violation of violations) {
        const card = document.createElement('article');
        card.className = 'criminalViolationCard';
        const head = document.createElement('div');
        head.className = 'criminalViolationHead';
        const title = document.createElement('div');
        title.className = 'criminalViolationTitle';
        title.textContent = formatCriminalArticle(violation);
        const badges = document.createElement('div');
        badges.className = 'criminalBadges';
        const confidence = document.createElement('span');
        confidence.className = 'criminalBadge';
        confidence.textContent = 'Уверенность модели ' + formatCriminalConfidence(violation.confidence);
        confidence.title = 'Confidence анализа, а не измеренная точность классификатора';
        badges.append(confidence);
        if (Number(violation.severity) > 0) {
          const severity = document.createElement('span');
          severity.className = 'criminalBadge';
          severity.textContent = 'Серьёзность ' + violation.severity + '/10';
          badges.append(severity);
        }
        head.append(title, badges);
        card.append(head);

        const triggerField = document.createElement('div');
        triggerField.className = 'criminalField';
        const triggerLabel = document.createElement('div');
        triggerLabel.className = 'criminalFieldLabel';
        const triggerSource = violation.trigger?.source;
        triggerLabel.textContent = triggerSource === 'history'
          ? 'Сообщение-триггер'
          : triggerSource === 'preview'
            ? 'Сохранённый фрагмент сообщения'
            : 'Фрагмент, который выделила модель';
        const trigger = document.createElement('blockquote');
        trigger.className = 'criminalTrigger';
        trigger.textContent = violation.trigger?.text || violation.quote || 'Текст недоступен';
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

        if (violation.occurredAt) {
          const occurredAt = document.createElement('div');
          occurredAt.className = 'criminalOccurredAt';
          occurredAt.textContent = new Date(Number(violation.occurredAt) * 1000).toLocaleString('ru-RU');
          card.append(occurredAt);
        }
        list.append(card);
      }

      if (payload?.hasMore) {
        const more = document.createElement('div');
        more.className = 'muted';
        more.textContent = 'Показаны последние 50 нарушений за выбранный период.';
        list.append(more);
      }
      panel.classList.remove('hidden');
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
      document.getElementById('criminalDetails').classList.add('hidden');
      document.getElementById('criminalViolationList').innerHTML = '';
      syncCriminalDetailButtons();
    }

    async function loadCriminalDetails(row) {
      const requestId = ++state.criminalDetailsRequestId;
      state.selectedCriminalUserId = row.userId;
      syncCriminalDetailButtons();
      const panel = document.getElementById('criminalDetails');
      const list = document.getElementById('criminalViolationList');
      document.getElementById('criminalDetailsTitle').textContent = 'Нарушения: ' + row.username;
      list.innerHTML = '';
      const loading = document.createElement('div');
      loading.className = 'muted';
      loading.textContent = 'Загрузка деталей...';
      list.append(loading);
      panel.classList.remove('hidden');

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
        list.innerHTML = '';
        const error = document.createElement('div');
        error.className = 'muted';
        error.textContent = 'Не удалось загрузить детали нарушений. Попробуйте ещё раз.';
        list.append(error);
      }
    }

    function renderCriminalRows(rows) {
      const tbody = document.getElementById('criminalUsers');
      tbody.innerHTML = '';
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="2" class="muted">Нет данных</td></tr>';
        closeCriminalDetails();
        return;
      }

      for (const row of rows) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        const count = document.createElement('td');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'criminalUserButton';
        button.dataset.userId = String(row.userId);
        button.setAttribute('aria-controls', 'criminalDetails');
        button.setAttribute('aria-expanded', 'false');
        const isCurrentUser = principal?.telegramId && String(row.userId) === String(principal.telegramId);
        if (isCurrentUser) {
          const currentUser = document.createElement('strong');
          currentUser.textContent = row.username;
          button.append(currentUser);
        } else {
          button.textContent = row.username;
        }
        button.addEventListener('click', () => {
          if (String(state.selectedCriminalUserId) === String(row.userId) &&
              !document.getElementById('criminalDetails').classList.contains('hidden')) {
            closeCriminalDetails();
          } else {
            loadCriminalDetails(row);
          }
        });
        name.append(button);
        count.textContent = String(row.count);
        tr.append(name, count);
        tbody.append(tr);
      }
      syncCriminalDetailButtons();
    }

    function clampTooltipPosition(value, size, viewportSize) {
      const margin = 12;
      return Math.min(Math.max(margin, value), Math.max(margin, viewportSize - size - margin));
    }

    function positionTooltip(host) {
      const horizontalOffset = 96;
      const tooltip = host.querySelector('.tooltip');
      if (!tooltip) return;

      const hostRect = host.getBoundingClientRect();
      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      tooltip.style.display = 'block';

      const tooltipRect = tooltip.getBoundingClientRect();
      const left = clampTooltipPosition(
        hostRect.left + horizontalOffset,
        tooltipRect.width,
        window.innerWidth
      );
      const top = clampTooltipPosition(hostRect.bottom - 2, tooltipRect.height, window.innerHeight);
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
      tooltip.style.removeProperty('display');
    }

    function positionActiveTooltip() {
      const activeTooltipHost = document.querySelector('.hasTooltip:hover, .hasTooltip:focus');
      if (activeTooltipHost) {
        positionTooltip(activeTooltipHost);
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

    function appendHeatmapCell(row, level, description) {
      const cell = document.createElement('td');
      cell.className = 'heatmapCell heatmap-' + level;
      cell.title = description;
      cell.setAttribute('aria-label', description);
      row.append(cell);
    }

    function renderActivityHeatmap(timeline, selectedIndex = 0) {
      const overview = document.getElementById('activityRhythmOverview');
      const detail = document.getElementById('activityHeatmap');
      const detailTitle = document.getElementById('activityDetailTitle');
      overview.replaceChildren();
      detail.replaceChildren();
      const participants = (timeline?.participants || []).slice(0, 12);
      const days = Array.from(new Set(participants.flatMap(participant =>
        (participant.dailyLevels || []).map(level => level.day).filter(Boolean)
      ))).sort().slice(-90);
      if (!participants.length || !days.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'Нет данных об активности за выбранный период';
        overview.append(empty);
        return;
      }

      const availableBuckets = new Set((timeline?.timeBuckets || []).map(bucket => bucket?.bucket));
      const timeBuckets = ACTIVITY_TIME_BUCKETS.filter(timeBucket => availableBuckets.has(timeBucket.bucket));
      if (timeBuckets.length !== ACTIVITY_TIME_BUCKETS.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'Нет данных об активности по времени суток за выбранный период';
        overview.append(empty);
        return;
      }

      const selectedParticipant = participants[Math.min(selectedIndex, participants.length - 1)];
      const weekdays = ACTIVITY_WEEKDAYS
        .map((label, index) => ({ label, index }))
        .filter(({ index }) => days.some(day => weekdayIndex(day) === index));
      for (const [index, participant] of participants.entries()) {
        const card = document.createElement('article');
        card.className = 'activityRhythmCard';
        const username = participant.username || 'Участник';
        const cardHeader = document.createElement('div');
        cardHeader.className = 'activityRhythmCardHeader';
        const name = document.createElement('h3');
        name.textContent = username;
        const select = document.createElement('button');
        select.className = 'secondary rhythmSelect';
        select.type = 'button';
        select.textContent = participant === selectedParticipant ? 'Показано ниже' : 'Показать детали';
        select.setAttribute('aria-controls', 'activityHeatmap');
        select.setAttribute('aria-pressed', String(participant === selectedParticipant));
        select.addEventListener('click', () => renderActivityHeatmap(timeline, index));
        cardHeader.append(name, select);
        const table = document.createElement('table');
        table.className = 'rhythmTable';
        table.setAttribute('aria-label', username + ': типичный ритм по дням недели');
        const tableHead = document.createElement('thead');
        const header = document.createElement('tr');
        const corner = document.createElement('th');
        corner.scope = 'col';
        corner.textContent = 'Время';
        header.append(corner);
        for (const { label } of weekdays) {
          const dayHeader = document.createElement('th');
          dayHeader.className = 'heatmapDay';
          dayHeader.scope = 'col';
          dayHeader.textContent = label;
          header.append(dayHeader);
        }
        tableHead.append(header);
        table.append(tableHead);
        const tableBody = document.createElement('tbody');
        const levelsByDay = new Map((participant.dailyLevels || []).map(level => [level.day, level]));
        for (const timeBucket of timeBuckets) {
          const row = document.createElement('tr');
          const bucketName = document.createElement('th');
          bucketName.className = 'heatmapBucket';
          bucketName.scope = 'row';
          bucketName.textContent = timeBucket.label;
          row.append(bucketName);
          for (const { index: weekday, label: weekdayLabel } of weekdays) {
            const levels = days
              .filter(day => weekdayIndex(day) === weekday)
              .map(day => bucketLevel(levelsByDay.get(day), timeBucket.bucket));
            const level = rhythmLevel(levels);
            appendHeatmapCell(
              row,
              level,
              username + ', ' + timeBucket.label + ', ' + weekdayLabel + ': ' + activityLevelLabel(level)
            );
          }
          tableBody.append(row);
        }
        table.append(tableBody);
        card.append(cardHeader, table);
        overview.append(card);
      }

      const username = selectedParticipant.username || 'Участник';
      detailTitle.textContent = 'Детали по дням: ' + username;
      const detailTable = document.createElement('table');
      detailTable.className = 'activityHeatmap';
      detailTable.setAttribute('aria-label', username + ': активность по дням и времени суток');
      const tableHead = document.createElement('thead');
      const header = document.createElement('tr');
      const corner = document.createElement('th');
      corner.className = 'heatmapCorner';
      corner.scope = 'col';
      corner.textContent = 'Время';
      header.append(corner);
      for (const day of days) {
        const dayHeader = document.createElement('th');
        dayHeader.className = 'heatmapDay';
        dayHeader.scope = 'col';
        dayHeader.title = readableHeatmapDay(day);
        dayHeader.setAttribute('aria-label', readableHeatmapDay(day));
        dayHeader.textContent = day.slice(8) + '.' + day.slice(5, 7);
        header.append(dayHeader);
      }
      tableHead.append(header);
      detailTable.append(tableHead);
      const tableBody = document.createElement('tbody');
      const levelsByDay = new Map((selectedParticipant.dailyLevels || []).map(level => [level.day, level]));
      for (const timeBucket of timeBuckets) {
        const row = document.createElement('tr');
        const bucketName = document.createElement('th');
        bucketName.className = 'heatmapBucket';
        bucketName.scope = 'row';
        bucketName.textContent = timeBucket.label;
        row.append(bucketName);
        for (const day of days) {
          const level = bucketLevel(levelsByDay.get(day), timeBucket.bucket);
          appendHeatmapCell(
            row,
            level,
            username + ', ' + timeBucket.label + ', ' + readableHeatmapDay(day) + ': ' + activityLevelLabel(level)
          );
        }
        tableBody.append(row);
      }
      detailTable.append(tableBody);
      detail.append(detailTable);
    }

    function renderMediaRows(id, rows, type) {
      const tbody = document.getElementById(id);
      tbody.innerHTML = '';
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="muted">Нет данных</td></tr>';
        return;
      }
      const minutesKey = type === 'voice' ? 'voiceMinutes' : 'videoNoteMinutes';
      const countKey = type === 'voice' ? 'voiceCount' : 'videoNoteCount';
      for (const row of rows) {
        const tr = document.createElement('tr');
        const name = document.createElement('td');
        const minutes = document.createElement('td');
        const count = document.createElement('td');
        name.textContent = row.username;
        minutes.textContent = String(row[minutesKey] || 0);
        count.textContent = String(row[countKey] || 0);
        tr.append(name, minutes, count);
        tbody.append(tr);
      }
    }

    function formatRate(value) {
      return (Number(value) || 0).toFixed(2).replace(/\\.?0+$/, '') + '%';
    }

    function renderProfanityRateRows(rows) {
      state.currentProfanityRateRows = rows || [];
      const tbody = document.getElementById('profanityRateUsers');
      tbody.innerHTML = '';
      const peak = Math.max(...(rows || []).map(row => Number(row.rate) || 0), 0);
      document.getElementById('profanityRatePeak').textContent = formatRate(peak);
      setChartEmpty('profanityRate', !rows.length);
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">Нет данных</td></tr>';
        return;
      }

      const colors = getThemeColors();
      makeChart('profanityRateChart', {
        type: 'bar',
        data: {
          labels: rows.map(row => row.username),
          datasets: [{
            data: rows.map(row => Number((Number(row.rate) || 0).toFixed(2))),
            backgroundColor: colors.orange,
            borderRadius: 5,
            maxBarThickness: 34
          }]
        },
        options: commonChartOptions({
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
            },
            y: {
              beginAtZero: true,
              grid: { color: colors.chartGrid },
              ticks: {
                color: colors.muted,
                callback: value => value + '%'
              }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: colors.chartTooltipBg,
              titleColor: colors.chartTooltipText,
              bodyColor: colors.chartTooltipText,
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
            titleFont: { size: 12, weight: '700' },
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
      const colors = getThemeColors();
      if (hour >= 5 && hour < 12) return colors.accent;
      if (hour >= 12 && hour < 17) return colors.green;
      if (hour >= 17 && hour < 22) return colors.orange;
      return colors.purple;
    }

    function renderCharts(activity) {
      state.currentActivity = activity;
      const colors = getThemeColors();
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
              borderColor: colors.accent,
              backgroundColor: colors.dailyFill,
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
              backgroundColor: colors.green,
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
                ticks: { color: colors.muted, maxRotation: 0, autoSkip: false }
              },
              y: {
                beginAtZero: true,
                grid: { color: colors.chartGrid },
                ticks: { color: colors.muted }
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

    function redirectToLogin() {
      window.location.assign('/admin');
    }

    async function loadChats() {
      setStatus('Загрузка чатов...');
      document.getElementById('chatSelect').classList.add('loadingControl');
      renderDashboardSkeleton();
      try {
        const res = await fetch('/admin/api/chats');
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) throw new Error('chats unavailable');
        const body = await res.json();
        renderChats(body.chats || []);
        if ((body.chats || []).length) {
          finishDashboardLoading();
          await loadDashboard();
        } else {
          finishDashboardLoading();
          document.getElementById('dashboard').classList.add('hidden');
          document.getElementById('dashboardToolbar').classList.add('hidden');
          setStatus('Чаты появятся после новых сообщений или после обнаружения старых счетчиков.');
        }
      } catch (error) {
        finishDashboardLoading();
        renderEmptyDashboard();
        setStatus('Не удалось загрузить список чатов. Попробуйте обновить страницу.', true);
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

      try {
        const statsUrl = buildStatsUrl(chatId, period);
        setStatus('Загрузка...');
        renderDashboardSkeleton();
        const [statsRes, notificationsRes] = await Promise.all([
          fetch(statsUrl),
          fetch('/admin/api/notifications?chatId=' + encodeURIComponent(chatId))
        ]);
        if (statsRes.status === 401 || notificationsRes.status === 401) {
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
        document.getElementById('dashboard').classList.remove('hidden');
        document.getElementById('dashboardToolbar').classList.remove('hidden');
        document.getElementById('activityTotal').textContent = String(stats.activity.total);
        document.getElementById('activityWords').textContent = String(stats.activity.totalWords || 0);
        document.getElementById('activityWordsPerMessage').textContent = String(stats.activity.wordsPerMessage || 0);
        document.getElementById('activityVoiceCount').textContent = String(stats.activity.totalVoiceCount || 0);
        document.getElementById('activityVoiceMinutes').textContent = String(stats.activity.totalVoiceMinutes || 0);
        document.getElementById('activityVideoNoteCount').textContent = String(stats.activity.totalVideoNoteCount || 0);
        document.getElementById('activityVideoNoteMinutes').textContent = String(stats.activity.totalVideoNoteMinutes || 0);
        document.getElementById('activityActiveUsers').textContent = String(stats.activity.activeUsers || 0);
        document.getElementById('activityAvgDaily').textContent = String(stats.activity.averageDailyMessages || 0);
        document.getElementById('activityAvgDailyUsers').textContent = String(stats.activity.averageDailyActiveUsers || 0);
        document.getElementById('activityAvgHourly').textContent = String(stats.activity.averageHourlyMessages || 0);
        renderCharts(stats.activity || {});
        renderTimeBuckets(stats.activity.timeBuckets || []);
        renderActivityRows('activityUsers', stats.activity.topUsers || [], 'messages');
        renderActivityRows('activityTalkers', stats.activity.topTalkers || [], 'words');
        renderActivityHeatmap(stats.activity.participantTimeline);
        renderMediaRows('activityVoiceUsers', stats.activity.topVoiceUsers || [], 'voice');
        renderMediaRows('activityVideoNoteUsers', stats.activity.topVideoNoteUsers || [], 'videoNote');
        renderRows('profanityUsers', stats.profanity.topUsers, 'username', 'count');
        renderProfanityRateRows(stats.profanity.topRateUsers || []);
        renderRows('profanityWords', stats.profanity.topWords, 'word', 'count');
        renderCriminalRows(stats.criminal.topUsers || []);
        renderNotifications(
          notifications.settings,
          notifications.availableTypes,
          notifications.canEdit
        );
        const servedRange = stats.range && stats.range.from && stats.range.to
          ? stats.range.from + ' – ' + stats.range.to
          : '';
        const provisional = stats.status === 'provisional';
        const pendingAnalysis = stats.progress
          ? (Number(stats.progress.pendingAnalysis) || 0)
          : 0;
        const liveBadge = provisional ? 'включая сегодня · live' : '';
        const pendingBadge = provisional && pendingAnalysis > 0
          ? ' · анализ продолжается (' + pendingAnalysis + ')'
          : '';
        setStatus(
          notificationsError
            ? 'Статистика загружена · ' + servedRange + ' · ' + liveBadge +
                pendingBadge + '. Настройки уведомлений временно недоступны.'
            : 'Обновлено · период ' + servedRange + ' · ' + liveBadge + pendingBadge
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

    document.getElementById('controls').addEventListener('submit', event => {
      event.preventDefault();
      loadDashboard();
    });
    document.getElementById('period').addEventListener('change', syncCustomPeriodControls);
    document.getElementById('statsErrorWeek').addEventListener('click', () => {
      document.getElementById('period').value = 'week';
      syncCustomPeriodControls();
      loadDashboard();
    });
    document.getElementById('statsErrorRetry').addEventListener('click', () => {
      loadDashboard();
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
    document.getElementById('saveNotifications').addEventListener('click', saveNotifications);
    document.getElementById('criminalDetailsClose').addEventListener('click', closeCriminalDetails);
    document.getElementById('resetDashboardLayout').addEventListener('click', resetDashboardLayout);
    document.addEventListener('mouseover', event => {
      const tooltipHost = event.target.closest?.('.hasTooltip');
      if (tooltipHost) {
        positionTooltip(tooltipHost);
      }
    });
    document.addEventListener('focusin', event => {
      const tooltipHost = event.target.closest?.('.hasTooltip');
      if (tooltipHost) {
        positionTooltip(tooltipHost);
      }
    });
    window.addEventListener('scroll', positionActiveTooltip, true);
    window.addEventListener('resize', positionActiveTooltip);
    setupThemeControl();
    watchSystemThemeChanges();
    setupHourlyTimezoneControl();
    applyDashboardLayout(readDashboardLayout());
    setupDashboardSizeControls();
    setupDashboardDragAndDrop();
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
