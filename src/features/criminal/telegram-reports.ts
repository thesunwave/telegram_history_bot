import type { Env } from '../../core/env';
import { escapeHtml } from '../../core/html-utils';
import type { ViolationCount } from '../../core/models/statistics';
import {
  addSentenceTotals,
  calculateSentenceFromPunishment,
  calculateSentenceFromViolationCount,
  calculateSentenceFromViolationCounts,
  formatSentenceTotalValue,
  type SentenceTotal,
} from './sentence-calculator';

export type CriminalReportPeriod = 'today' | 'week' | 'month';

export interface CriminalReportRange {
  period: CriminalReportPeriod;
  from: string;
  to: string;
  label: string;
}

interface CriminalEpisode {
  article: string;
  subarticle: string | null;
  articleTitle: string;
  quote: string;
  punishment: string;
  severity: number;
  confidence: number | null;
  occurredAt: number | null;
}

interface CriminalUserRank {
  userId: string;
  username: string;
  count: number;
  averageSeverity: number;
  sentence: SentenceTotal;
}

export interface PersonalCriminalReport {
  range: CriminalReportRange;
  totalViolations: number;
  averageSeverity: number;
  sentence: SentenceTotal;
  articles: ViolationCount[];
  recentEpisodes: CriminalEpisode[];
}

export interface CriminalTopReport {
  range: CriminalReportRange;
  totalViolations: number;
  sentence: SentenceTotal;
  users: CriminalUserRank[];
}

export interface ChatCriminalReport {
  range: CriminalReportRange;
  totalViolations: number;
  uniqueUsers: number;
  averageSeverity: number;
  sentence: SentenceTotal;
  articles: ViolationCount[];
  leader: CriminalUserRank | null;
  mostSevereEpisode: CriminalEpisode | null;
}

const PERIOD_DAYS: Record<CriminalReportPeriod, number> = {
  today: 1,
  week: 7,
  month: 30,
};

const PERIOD_LABELS: Record<CriminalReportPeriod, string> = {
  today: 'сегодня',
  week: '7 дней',
  month: '30 дней',
};

const DATE_FILTER = `(
  (violation_day IS NOT NULL AND violation_day >= ? AND violation_day <= ?)
  OR (violation_day IS NULL AND date(created_at) >= ? AND date(created_at) <= ?)
)`;

const RECENT_EPISODE_LIMIT = 5;
const ARTICLE_DISPLAY_LIMIT = 5;
const CHAT_ARTICLE_DISPLAY_LIMIT = 3;
const MAX_QUOTE_LENGTH = 240;

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function parseCriminalReportPeriod(
  value: string | undefined,
  now: Date = new Date(),
): CriminalReportRange {
  const period = (value || 'today') as CriminalReportPeriod;
  if (!Object.prototype.hasOwnProperty.call(PERIOD_DAYS, period)) {
    throw new Error('Неверный период. Используйте: today, week, month');
  }

  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = addUtcDays(end, -(PERIOD_DAYS[period] - 1));

  return {
    period,
    from: toUtcDateString(start),
    to: toUtcDateString(end),
    label: PERIOD_LABELS[period],
  };
}

function rangeBindings(range: CriminalReportRange): string[] {
  return [range.from, range.to, range.from, range.to];
}

function mapViolationCount(row: any): ViolationCount {
  return {
    article: String(row.article || ''),
    subarticle: row.subarticle ? String(row.subarticle) : null,
    articleTitle: String(row.article_title || ''),
    punishment: String(row.punishment || ''),
    count: Number(row.count) || 0,
    averageSeverity: Number(row.average_severity) || 0,
  };
}

function mapEpisode(row: any): CriminalEpisode {
  const rawTimestamp = Number(row.event_ts);
  const confidence = row.confidence === null || row.confidence === undefined
    ? null
    : Number(row.confidence);

  return {
    article: String(row.article || ''),
    subarticle: row.subarticle ? String(row.subarticle) : null,
    articleTitle: String(row.article_title || ''),
    quote: String(row.text_preview || row.quote || ''),
    punishment: String(row.punishment || ''),
    severity: Number(row.severity) || 0,
    confidence: confidence !== null && Number.isFinite(confidence) ? confidence : null,
    occurredAt: Number.isFinite(rawTimestamp) && rawTimestamp > 0 ? rawTimestamp : null,
  };
}

async function loadArticleStats(
  env: Env,
  chatId: number,
  range: CriminalReportRange,
  userId?: number,
): Promise<ViolationCount[]> {
  const userFilter = userId === undefined ? '' : ' AND user_id = ?';
  const statement = env.DB.prepare(`
    SELECT article, subarticle, article_title, punishment,
           COUNT(*) AS count, AVG(severity) AS average_severity
    FROM criminal_violations
    WHERE chat_id = ?${userFilter} AND ${DATE_FILTER}
    GROUP BY article, subarticle, article_title, punishment
    ORDER BY count DESC, average_severity DESC, article ASC
  `);
  const bindings: Array<string | number> = [chatId];
  if (userId !== undefined) bindings.push(userId);
  bindings.push(...rangeBindings(range));
  const result = await statement.bind(...bindings).all();
  return (result.results || []).map(mapViolationCount);
}

async function loadEpisodes(
  env: Env,
  chatId: number,
  range: CriminalReportRange,
  options: { userId?: number; limit: number; order: 'recent' | 'severity' },
): Promise<CriminalEpisode[]> {
  const userFilter = options.userId === undefined ? '' : ' AND user_id = ?';
  const orderBy = options.order === 'severity'
    ? 'severity DESC, event_ts DESC, id DESC'
    : 'event_ts DESC, id DESC';
  const statement = env.DB.prepare(`
    SELECT id, article, subarticle, article_title, quote, text_preview, punishment,
           severity, confidence,
           COALESCE(violation_ts, CAST(strftime('%s', created_at) AS INTEGER)) AS event_ts
    FROM criminal_violations
    WHERE chat_id = ?${userFilter} AND ${DATE_FILTER}
    ORDER BY ${orderBy}
    LIMIT ?
  `);
  const bindings: Array<string | number> = [chatId];
  if (options.userId !== undefined) bindings.push(options.userId);
  bindings.push(...rangeBindings(range), options.limit);
  const result = await statement.bind(...bindings).all();
  return (result.results || []).map(mapEpisode);
}

async function loadUserRanks(
  env: Env,
  chatId: number,
  range: CriminalReportRange,
): Promise<Array<Omit<CriminalUserRank, 'username'>>> {
  const statement = env.DB.prepare(`
    SELECT user_id, article, subarticle, article_title, punishment,
           COUNT(*) AS count, AVG(severity) AS average_severity
    FROM criminal_violations
    WHERE chat_id = ? AND ${DATE_FILTER}
    GROUP BY user_id, article, subarticle, article_title, punishment
  `);
  const result = await statement.bind(chatId, ...rangeBindings(range)).all();
  const users = new Map<string, Omit<CriminalUserRank, 'username'>>();

  for (const row of result.results || []) {
    const raw = row as any;
    const userId = String(raw.user_id);
    const violation = mapViolationCount(raw);
    const articleSentence = calculateSentenceFromViolationCount(violation);
    const existing = users.get(userId) || {
      userId,
      count: 0,
      averageSeverity: 0,
      sentence: { totalYears: 0, lifeSentences: 0 },
    };
    const nextCount = existing.count + violation.count;
    const nextAverageSeverity = nextCount > 0
      ? ((existing.averageSeverity * existing.count) +
          (violation.averageSeverity * violation.count)) / nextCount
      : 0;

    users.set(userId, {
      userId,
      count: nextCount,
      averageSeverity: nextAverageSeverity,
      sentence: addSentenceTotals(existing.sentence, articleSentence),
    });
  }

  return Array.from(users.values()).sort((a, b) =>
    b.sentence.lifeSentences - a.sentence.lifeSentences ||
    b.sentence.totalYears - a.sentence.totalYears ||
    b.count - a.count ||
    Number(a.userId) - Number(b.userId)
  );
}

async function addUsernames(
  env: Env,
  users: Array<Omit<CriminalUserRank, 'username'>>,
): Promise<CriminalUserRank[]> {
  const usernames = await Promise.all(users.map(user => env.COUNTERS.get(`user:${user.userId}`)));
  return users.map((user, index) => ({
    ...user,
    username: usernames[index] || `id${user.userId}`,
  }));
}

function totalViolations(articles: ViolationCount[]): number {
  return articles.reduce((sum, article) => sum + article.count, 0);
}

function averageSeverity(articles: ViolationCount[]): number {
  const count = totalViolations(articles);
  if (count === 0) return 0;
  return articles.reduce(
    (sum, article) => sum + (article.averageSeverity * article.count),
    0,
  ) / count;
}

export async function loadPersonalCriminalReport(
  env: Env,
  chatId: number,
  userId: number,
  range: CriminalReportRange,
): Promise<PersonalCriminalReport> {
  const [articles, recentEpisodes] = await Promise.all([
    loadArticleStats(env, chatId, range, userId),
    loadEpisodes(env, chatId, range, {
      userId,
      limit: RECENT_EPISODE_LIMIT,
      order: 'recent',
    }),
  ]);

  return {
    range,
    totalViolations: totalViolations(articles),
    averageSeverity: averageSeverity(articles),
    sentence: calculateSentenceFromViolationCounts(articles),
    articles,
    recentEpisodes,
  };
}

export async function loadCriminalTopReport(
  env: Env,
  chatId: number,
  range: CriminalReportRange,
  limit: number,
): Promise<CriminalTopReport> {
  const rankedUsers = await loadUserRanks(env, chatId, range);
  const sentence = rankedUsers.reduce(
    (total, user) => addSentenceTotals(total, user.sentence),
    { totalYears: 0, lifeSentences: 0 },
  );
  const users = await addUsernames(env, rankedUsers.slice(0, limit));

  return {
    range,
    totalViolations: rankedUsers.reduce((sum, user) => sum + user.count, 0),
    sentence,
    users,
  };
}

export async function loadChatCriminalReport(
  env: Env,
  chatId: number,
  range: CriminalReportRange,
): Promise<ChatCriminalReport> {
  const [articles, rankedUsers, severeEpisodes] = await Promise.all([
    loadArticleStats(env, chatId, range),
    loadUserRanks(env, chatId, range),
    loadEpisodes(env, chatId, range, { limit: 1, order: 'severity' }),
  ]);
  const leader = rankedUsers.length > 0
    ? (await addUsernames(env, rankedUsers.slice(0, 1)))[0]
    : null;

  return {
    range,
    totalViolations: totalViolations(articles),
    uniqueUsers: rankedUsers.length,
    averageSeverity: averageSeverity(articles),
    sentence: calculateSentenceFromViolationCounts(articles),
    articles,
    leader,
    mostSevereEpisode: severeEpisodes[0] || null,
  };
}

function articleLabel(article: string, subarticle: string | null): string {
  let core = article
    .replace(/^\s*статья\s+/i, '')
    .replace(/\s*ук\s*рф\s*$/i, '')
    .trim();
  if (!core) core = '?';
  if (subarticle && !core.endsWith(`.${subarticle}`)) core += `.${subarticle}`;
  return `ст. ${core}`;
}

function sentenceValue(sentence: SentenceTotal): string {
  if (sentence.totalYears === 0 && sentence.lifeSentences === 0) return '0 лет';
  return formatSentenceTotalValue(sentence);
}

function recognizedSentenceValue(sentence: SentenceTotal): string | null {
  const value = formatSentenceTotalValue(sentence);
  return value === 'срок не распознан' ? null : value;
}

function violationCountLabel(count: number): string {
  const lastTwo = Math.abs(count) % 100;
  const last = Math.abs(count) % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} нарушений`;
  if (last === 1) return `${count} нарушение`;
  if (last >= 2 && last <= 4) return `${count} нарушения`;
  return `${count} нарушений`;
}

function sentenceSuffix(punishment: string): string {
  const value = recognizedSentenceValue(calculateSentenceFromPunishment(punishment));
  return value ? ` · срок: ${value}` : '';
}

function truncateQuote(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_QUOTE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_QUOTE_LENGTH - 1).trimEnd()}…`;
}

function formatOccurredAt(timestamp: number | null): string {
  if (!timestamp) return '';
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(timestamp * 1000));
  return `${formatted} UTC`;
}

function formatArticleLines(articles: ViolationCount[], limit: number): string[] {
  return articles.slice(0, limit).map(article => {
    const title = article.articleTitle ? ` — ${escapeHtml(article.articleTitle)}` : '';
    const sentence = recognizedSentenceValue(calculateSentenceFromViolationCount(article));
    const sentenceText = sentence ? ` · ${sentence}` : '';
    return `• ${articleLabel(article.article, article.subarticle)}${title} ×${article.count}${sentenceText}`;
  });
}

function formatEpisode(episode: CriminalEpisode, index?: number): string[] {
  const confidence = episode.confidence === null ? '' : ` · ${Math.round(episode.confidence * 100)}%`;
  const prefix = index === undefined ? '' : `${index}. `;
  const title = episode.articleTitle ? ` — ${escapeHtml(episode.articleTitle)}` : '';
  const lines = [
    `${prefix}${articleLabel(episode.article, episode.subarticle)}${title}${confidence} · ${episode.severity}/10`,
    `«${escapeHtml(truncateQuote(episode.quote))}»`,
  ];
  const occurredAt = formatOccurredAt(episode.occurredAt);
  const footer = `${occurredAt}${sentenceSuffix(episode.punishment)}`.replace(/^ · /, '');
  if (footer) lines.push(footer);
  return lines;
}

export function formatPersonalCriminalReport(report: PersonalCriminalReport): string {
  const lines = [
    `⚖️ <b>Твоё уголовное дело · ${report.range.label}</b>`,
    '',
    `Нарушений: <b>${report.totalViolations}</b>`,
    `Напиздел: <b>${sentenceValue(report.sentence)}</b>`,
    `Средняя серьёзность: <b>${report.averageSeverity.toFixed(1)}/10</b>`,
  ];

  if (report.totalViolations === 0) {
    lines.push('', '<i>За этот период уголовщина не обнаружена.</i>');
    return lines.join('\n');
  }

  lines.push('', '<b>По статьям:</b>', ...formatArticleLines(report.articles, ARTICLE_DISPLAY_LIMIT));
  if (report.articles.length > ARTICLE_DISPLAY_LIMIT) {
    lines.push(`…ещё ${report.articles.length - ARTICLE_DISPLAY_LIMIT} статей`);
  }

  lines.push('', '<b>Последние эпизоды:</b>');
  report.recentEpisodes.forEach((episode, index) => {
    if (index > 0) lines.push('');
    lines.push(...formatEpisode(episode, index + 1));
  });
  if (report.totalViolations > report.recentEpisodes.length) {
    lines.push('', `…ещё ${report.totalViolations - report.recentEpisodes.length} эпизодов`);
  }

  return lines.join('\n');
}

export function formatCriminalTopReport(report: CriminalTopReport): string {
  if (report.totalViolations === 0 || report.users.length === 0) {
    return `🏆 <b>Уголовный рейтинг · ${report.range.label}</b>\n\n<i>Нет данных о нарушениях УК РФ.</i>`;
  }

  const lines = [`🏆 <b>Уголовный рейтинг · ${report.range.label}</b>`, ''];
  report.users.forEach((user, index) => {
    lines.push(`${index + 1}. <b>${escapeHtml(user.username)}</b>`);
    lines.push(`   ${violationCountLabel(user.count)} · напиздел на ${sentenceValue(user.sentence)}`);
    if (index < report.users.length - 1) lines.push('');
  });
  lines.push(
    '',
    '<b>Всего по чату:</b>',
    `${violationCountLabel(report.totalViolations)} · ${sentenceValue(report.sentence)}`,
  );
  return lines.join('\n');
}

export function formatChatCriminalReport(report: ChatCriminalReport): string {
  const lines = [
    `⚖️ <b>УК РФ · статистика чата · ${report.range.label}</b>`,
    '',
    `Нарушений: <b>${report.totalViolations}</b>`,
    `Нарушителей: <b>${report.uniqueUsers}</b>`,
    `Совокупный срок: <b>${sentenceValue(report.sentence)}</b>`,
    `Средняя серьёзность: <b>${report.averageSeverity.toFixed(1)}/10</b>`,
  ];

  if (report.totalViolations === 0) {
    lines.push('', '<i>За этот период нарушений не зафиксировано.</i>');
    return lines.join('\n');
  }

  lines.push('', '<b>Самые популярные статьи:</b>');
  const popularArticles = formatArticleLines(report.articles, CHAT_ARTICLE_DISPLAY_LIMIT);
  popularArticles.forEach((line, index) => lines.push(`${index + 1}. ${line.slice(2)}`));

  if (report.leader) {
    lines.push(
      '',
      '<b>Главный уголовник:</b>',
      `${escapeHtml(report.leader.username)} · ${violationCountLabel(report.leader.count)} · ${sentenceValue(report.leader.sentence)}`,
    );
  }

  if (report.mostSevereEpisode) {
    lines.push('', '<b>Самый тяжёлый эпизод:</b>', ...formatEpisode(report.mostSevereEpisode));
  }

  return lines.join('\n');
}
