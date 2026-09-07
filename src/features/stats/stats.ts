import { Env, DAY, MONTH_DAYS, WEEK_DAYS } from '../../core/env';
import type { KVNamespace } from '@cloudflare/workers-types';
import { sendMessage, sendPhoto } from '../../core/telegram';
import { summariseChat } from '../summary/summary';
import { ViolationHandler } from './violation-handler';
import { ViolationRepository } from '../../core/repositories/violation-repository';
import { formatSentenceTotalValue } from '../criminal/sentence-calculator';

const WEEK_LENGTH_DAYS = 7;
const MONTH_LENGTH_DAYS = 30;
const MAX_ACTIVITY_RANGE_DAYS = 180;
export const PROFANITY_RATE_MIN_WORDS = 100;

export interface ActivityDateRange {
  startDate: string;
  endDate: string;
  label: string;
  dayCount: number;
}

export function parseActivityCommand(text: string): { name: string; args: string[] } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const [rawName = '', ...args] = parts;
  const name = rawName.split('@')[0];
  return { name, args };
}

function toUtcDay(date: Date): Date {
  const utc = new Date(date);
  utc.setUTCHours(0, 0, 0, 0);
  return utc;
}

function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return formatDate(date) === value ? date : null;
}

function buildRange(start: Date, end: Date, label?: string): ActivityDateRange {
  const startDate = formatDate(start);
  const endDate = formatDate(end);
  const dayCount = Math.floor((end.getTime() - start.getTime()) / (DAY * 1000)) + 1;
  if (dayCount <= 0) throw new Error('Начальная дата должна быть раньше конечной');
  if (dayCount > MAX_ACTIVITY_RANGE_DAYS) {
    throw new Error(`Период не должен превышать ${MAX_ACTIVITY_RANGE_DAYS} дней`);
  }
  return {
    startDate,
    endDate,
    label: label || `${startDate} - ${endDate}`,
    dayCount,
  };
}

function lastNDaysRange(today: Date, days: number, label: string): ActivityDateRange {
  return buildRange(addUtcDays(today, -(days - 1)), today, label);
}

export function parseActivityPeriod(args: string[], now: Date = new Date()): ActivityDateRange {
  const today = toUtcDay(now);
  const [first = 'week', second] = args;

  if (second !== undefined) {
    const start = parseIsoDate(first);
    const end = parseIsoDate(second);
    if (!start || !end) throw new Error('Используйте даты в формате YYYY-MM-DD YYYY-MM-DD');
    return buildRange(start, end);
  }

  if (first === 'week') return lastNDaysRange(today, WEEK_LENGTH_DAYS, 'последние 7 дней');
  if (first === 'month') return lastNDaysRange(today, MONTH_LENGTH_DAYS, 'последние 30 дней');
  if (first === 'prev_week') {
    const end = addUtcDays(today, -WEEK_LENGTH_DAYS);
    return buildRange(addUtcDays(end, -(WEEK_LENGTH_DAYS - 1)), end, 'предыдущие 7 дней');
  }
  if (first === 'prev_month') {
    const currentMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const end = addUtcDays(currentMonthStart, -1);
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    return buildRange(start, end, 'предыдущий месяц');
  }

  const duration = first.match(/^(\d+)([dmw])$/);
  if (duration) {
    const value = parseInt(duration[1], 10);
    const unit = duration[2];
    if (value <= 0) throw new Error('Период должен быть больше нуля');
    const days = unit === 'd' ? value : unit === 'w' ? value * WEEK_LENGTH_DAYS : value * MONTH_LENGTH_DAYS;
    return lastNDaysRange(today, days, `последние ${days} дней`);
  }

  const singleDate = parseIsoDate(first);
  if (singleDate) return buildRange(singleDate, singleDate);

  throw new Error('Неверный период. Используйте week, month, 2m, 14d, 8w, prev_week, prev_month или YYYY-MM-DD YYYY-MM-DD');
}

export function listActivityDays(range: ActivityDateRange): string[] {
  const days: string[] = [];
  const start = parseIsoDate(range.startDate);
  const end = parseIsoDate(range.endDate);
  if (!start || !end) return days;
  for (let d = new Date(start); d <= end; d = addUtcDays(d, 1)) {
    days.push(formatDate(d));
  }
  return days;
}

function formatRangeTitle(prefix: string, range: ActivityDateRange): string {
  return `${prefix}: ${range.startDate} - ${range.endDate}`;
}

function resolveActivityRange(periodArgs: string[] | string | ActivityDateRange): ActivityDateRange {
  if (typeof periodArgs === 'string') return parseActivityPeriod([periodArgs]);
  if (Array.isArray(periodArgs)) return parseActivityPeriod(periodArgs);
  return periodArgs;
}

export interface UserActivityStat {
  userId: string;
  username: string;
  messages: number;
  words: number;
  wordsPerMessage: number;
}

async function aggregateUserActivity(
  env: Env,
  chatId: number,
  days: string[],
): Promise<Record<string, { messages: number; words: number }>> {
  const totals: Record<string, { messages: number; words: number }> = {};

  for (const day of days) {
    const messagePrefix = `stats_v2:${chatId}:${day}:`;
    let cursor: string | undefined;
    do {
      const list: any = await env.COUNTERS.list({
        prefix: messagePrefix,
        cursor,
      });
      cursor = !list.list_complete ? list.cursor : undefined;

      const BATCH_SIZE = 10;
      for (let i = 0; i < list.keys.length; i += BATCH_SIZE) {
        const batch = list.keys.slice(i, i + BATCH_SIZE);
        const messageValues = await Promise.all(
          batch.map((k: any) => env.COUNTERS.get(k.name)),
        );
        const wordValues = await Promise.all(
          batch.map((k: any) => {
            const [, , , userId] = k.name.split(':');
            return env.COUNTERS.get(`word_stats_v2:${chatId}:${day}:${userId}`);
          }),
        );

        for (let j = 0; j < batch.length; j++) {
          const [, , , userId] = batch[j].name.split(':');
          const messages = parseInt(messageValues[j] || '0', 10);
          const words = parseInt(wordValues[j] || '0', 10);
          const current = totals[userId] || { messages: 0, words: 0 };
          totals[userId] = {
            messages: current.messages + messages,
            words: current.words + words,
          };
        }
      }
    } while (cursor);
  }

  return totals;
}

async function hydrateUserActivityStats(
  env: Env,
  entries: Array<[string, { messages: number; words: number }]>,
): Promise<UserActivityStat[]> {
  const names = await Promise.all(
    entries.map(([userId]) => env.COUNTERS.get(`user:${userId}`)),
  );
  return entries.map(([userId, stat], index) => ({
    userId,
    username: names[index] || `id${userId}`,
    messages: stat.messages,
    words: stat.words,
    wordsPerMessage: stat.messages > 0 ? Number((stat.words / stat.messages).toFixed(1)) : 0,
  }));
}

export async function topChat(
  env: Env,
  chatId: number,
  n: number,
  day: string,
): Promise<string | void> {
  // Use new optimized key format: stats_v2:chatId:day:userId
  // This allows listing only keys for the specific day, avoiding full history scan
  const prefix = `stats_v2:${chatId}:${day}:`;
  let cursor: string | undefined = undefined;
  const counts: Record<string, number> = {};
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    const BATCH_SIZE = 10;
    for (let i = 0; i < list.keys.length; i += BATCH_SIZE) {
      const batch = list.keys.slice(i, i + BATCH_SIZE);
      const values = await Promise.all(
        batch.map((k: any) => env.COUNTERS.get(k.name)),
      );
      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const [_, chat, d, user] = key.name.split(':');
        // No need to check d === day because prefix ensures it
        const c = parseInt(values[j] || '0');
        counts[user] = (counts[user] || 0) + c;
      }
    }
  } while (cursor);
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
  const lines = [];
  const names = await Promise.all(
    sorted.map(([u]) => env.COUNTERS.get(`user:${u}`)),
  );
  for (let i = 0; i < sorted.length; i++) {
    const [u, c] = sorted[i];
    const name = names[i] || `id${u}`;
    lines.push(`${i + 1}. ${name}: ${c}`);
  }
  const text = lines.join('\n') || 'Нет данных';
  return await sendMessage(env, chatId, text);
}

export async function topTalkers(
  env: Env,
  chatId: number,
  n: number,
  periodArgs: string[] | string | ActivityDateRange = ['week'],
): Promise<string | void> {
  let range: ActivityDateRange;
  try {
    range = resolveActivityRange(periodArgs);
  } catch (error: any) {
    return await sendMessage(env, chatId, error.message || 'Неверный период');
  }

  const totals = await aggregateUserActivity(
    env,
    chatId,
    listActivityDays(range),
  );
  const sorted = Object.entries(totals)
    .filter(([, stat]) => stat.messages > 0)
    .sort((a, b) => b[1].words - a[1].words || b[1].messages - a[1].messages)
    .slice(0, n);

  if (sorted.length === 0) {
    return await sendMessage(
      env,
      chatId,
      `${formatRangeTitle('Топ болтунов', range)}\nНет данных`,
    );
  }

  const stats = await hydrateUserActivityStats(env, sorted);
  const lines = stats.map((stat, index) =>
    `${index + 1}. ${stat.username}: ${stat.words} слов, ${stat.messages} сообщений, ${stat.wordsPerMessage} слов/сообщение`,
  );

  return await sendMessage(
    env,
    chatId,
    `${formatRangeTitle('Топ болтунов', range)}\n${lines.join('\n')}`,
  );
}

export async function resetCounters(env: Env, chatId: number) {
  const prefix = `stats:${chatId}:`;
  let cursor: string | undefined = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);
  const v2Prefix = `stats_v2:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: v2Prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);
  const aPrefix = `activity:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: aPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);
  const hourPrefix = `activity_hour:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: hourPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  const timeBucketPrefix = `activity_time_bucket:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: timeBucketPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  const lastMessagePrefix = `last_message:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: lastMessagePrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  const wordPrefix = `word_stats:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: wordPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  const wordV2Prefix = `word_stats_v2:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: wordV2Prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  const wordActivityPrefix = `word_activity:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: wordActivityPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  // Reset profanity user counters
  const pPrefix = `profanity:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: pPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  // Reset profanity word counters
  const pwPrefix = `profanity_words:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: pwPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  const pwuPrefix = `profanity_word_users:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: pwuPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  if (env.DB) {
    try {
      await env.DB.prepare('DELETE FROM activity WHERE chat_id = ?')
        .bind(chatId)
        .run();
    } catch (e) {
      console.error('activity reset db error', {
        chat: chatId.toString(36),
        err: (e as Error).message || String(e),
      });
    }
  }
}

export async function dailySummary(env: Env) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = Math.floor((today.getTime() - DAY * 1000) / 1000);
  const date = new Date(start * 1000).toISOString().slice(0, 10);
  const prefix = 'stats:';
  let cursor: string | undefined = undefined;
  const chats = new Set<number>();
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      const [_, chat, , d] = key.name.split(':');
      if (d === date) chats.add(parseInt(chat));
    }
  } while (cursor);
  for (const c of chats) {
    await summariseChat(env, c, 1);
  }
}

function drawGraph(data: { label: string; value: number }[]): string {
  const max = Math.max(...data.map((d) => d.value), 1);
  const scale = max > 0 ? 10 / max : 0;
  return data
    .map(({ label, value }) => {
      const bar = '█'.repeat(Math.round(value * scale));
      return `${label.padStart(3, ' ')} |${bar} ${value}`;
    })
    .join('\n');
}

function sanitizeLabel(label: string): string {
  const truncated = label.slice(0, 32);
  const allowlist = /^[a-zA-Z0-9_.@-]+$/;
  if (allowlist.test(truncated)) return truncated;
  const sanitized = truncated.replace(/[^a-zA-Z0-9_.@-]+/g, '');
  return sanitized || 'unknown';
}

function formatActivityText(data: { label: string; value: number }[]): string {
  if (data.length === 0) return 'Нет данных';
  const text = drawGraph(data);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return total > 0 ? `${text}\nTotal: ${total}` : text;
}

function formatActivityTextWithTitle(
  data: { label: string; value: number }[],
  title: string,
): string {
  return `${title}\n${formatActivityText(data)}`;
}

interface ChartDataset {
  label: string;
  data: number[];
}

interface ChartConfig {
  type: 'bar';
  data: { labels: string[]; datasets: ChartDataset[] };
  options?: {
    title?: {
      display: boolean;
      text: string;
      fontSize?: number;
    };
    legend?: {
      display: boolean;
    };
    plugins: {
      title: { display: boolean; text: string };
      legend?: {
        display: boolean;
      };
      datalabels?: {
        anchor?: 'start' | 'center' | 'end' | string;
        align?: 'top' | 'bottom' | 'center' | 'start' | 'end' | string;
        color?: string;
      };
    };
  };
}

function createBarChartUrl(
  labels: string[],
  data: number[],
  name: string,
  title?: string,
): string {
  if (
    labels.length === 0 ||
    data.length === 0 ||
    labels.length !== data.length
  ) {
    throw new Error(
      `Invalid chart data: labels and data arrays must have equal lengths and contain at least one element each. ` +
      `Received labels.length=${labels.length}, data.length=${data.length}.`,
    );
  }
  const chart: ChartConfig = {
    type: 'bar',
    data: { labels, datasets: [{ label: name, data }] },
    options: {
      title: { display: Boolean(title), text: title ?? '', fontSize: 18 },
      legend: { display: false },
      plugins: {
        title: { display: Boolean(title), text: title ?? '' },
        legend: { display: false },
        datalabels: { anchor: 'end', align: 'top' },
      },
    },
  };
  return (
    'https://quickchart.io/chart?c=' + encodeURIComponent(JSON.stringify(chart))
  );
}

export async function activityChart(
  env: Env,
  chatId: number,
  periodArgs: string[] | string | ActivityDateRange = ['week'],
): Promise<string | void> {
  let range: ActivityDateRange;
  try {
    range = resolveActivityRange(periodArgs);
  } catch (error: any) {
    return await sendMessage(env, chatId, error.message || 'Неверный период');
  }

  const totals: Record<string, number> = {};
  let dbOk = false;
  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        'SELECT day, count FROM activity WHERE chat_id = ? AND day >= ? AND day <= ? ORDER BY day',
      )
        .bind(chatId, range.startDate, range.endDate)
        .all();
      const rows = (res.results as { day: string; count: number }[]) || [];
      for (const row of rows) {
        totals[row.day] = row.count;
      }
      dbOk = rows.length > 0;
    } catch (e) {
      console.error('activity db read error', {
        chat: chatId.toString(36),
        err: (e as any).message || String(e),
      });
    }
  }
  if (!dbOk) {
    const days = listActivityDays(range);

    // Process in chunks to avoid hitting subrequest limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < days.length; i += BATCH_SIZE) {
      const batchDays = days.slice(i, i + BATCH_SIZE);
      const keys = batchDays.map(day => `activity:${chatId}:${day}`);
      const values = await Promise.all(
        keys.map(key => env.COUNTERS.get(key))
      );

      for (let j = 0; j < batchDays.length; j++) {
        const day = batchDays[j];
        const count = parseInt(values[j] || '0', 10);
        totals[day] = count;
      }
    }
  }

  let data: { label: string; value: number }[] = [];
  const days = listActivityDays(range);
  if (range.dayCount <= 31) {
    const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (const day of days) {
      const d = new Date(`${day}T00:00:00Z`);
      const suffix = range.dayCount <= 7 ? labels[d.getUTCDay()] : day.slice(5);
      data.push({ label: suffix, value: totals[day] || 0 });
    }
  } else {
    for (let i = 0; i < days.length; i += WEEK_LENGTH_DAYS) {
      const bucketDays = days.slice(i, i + WEEK_LENGTH_DAYS);
      const value = bucketDays.reduce((sum, day) => sum + (totals[day] || 0), 0);
      data.push({ label: bucketDays[0].slice(5), value });
    }
  }

  return await sendMessage(env, chatId, formatActivityTextWithTitle(data, formatRangeTitle('Активность', range)));
}

export async function activityByUser(
  env: Env,
  chatId: number,
  periodArgs: string[] | string | ActivityDateRange = ['week'],
): Promise<string | void> {
  let range: ActivityDateRange;
  try {
    range = resolveActivityRange(periodArgs);
  } catch (error: any) {
    return await sendMessage(env, chatId, error.message || 'Неверный период');
  }

  const totals: Record<string, number> = {};

  // Limit KV scans to the required date range to avoid exceeding subrequest limits
  const days = listActivityDays(range);

  for (const day of days) {
    const prefix = `stats_v2:${chatId}:${day}:`;
    let cursor: string | undefined;
    do {
      const list: any = await env.COUNTERS.list({ prefix, cursor });
      cursor = !list.list_complete ? list.cursor : undefined;

      const BATCH_SIZE = 10;
      for (let i = 0; i < list.keys.length; i += BATCH_SIZE) {
        const batch = list.keys.slice(i, i + BATCH_SIZE);
        const values = await Promise.all(
          batch.map((k: any) => env.COUNTERS.get(k.name)),
        );
        for (let j = 0; j < batch.length; j++) {
          const [, , , user] = batch[j].name.split(':');
          const c = parseInt(values[j] || '0', 10);
          totals[user] = (totals[user] || 0) + c;
        }
      }
    }
    while (cursor);
  }

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (sorted.length === 0) {
    return await sendMessage(env, chatId, `${formatRangeTitle('Активность пользователей', range)}\nНет данных`);
  }
  const names = await Promise.all(
    sorted.map(([u]) => env.COUNTERS.get(`user:${u}`)),
  );
  const labels = names.map((n: string | null, i: number) => sanitizeLabel(n || `id${sorted[i][0]}`));
  const data = sorted.map(([, c]) => c);
  const title = formatRangeTitle('Активность пользователей', range);
  const url = createBarChartUrl(labels, data, 'Messages', title);
  return await sendPhoto(env, chatId, url);
}

export async function activityHours(
  env: Env,
  chatId: number,
  periodArgs: string[] | string | ActivityDateRange = ['week'],
): Promise<string | void> {
  let range: ActivityDateRange;
  try {
    range = resolveActivityRange(periodArgs);
  } catch (error: any) {
    return await sendMessage(env, chatId, error.message || 'Неверный период');
  }

  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  const totals: Record<string, number> = Object.fromEntries(hours.map(hour => [hour, 0]));
  let foundData = false;
  const days = listActivityDays(range);

  for (const day of days) {
    const keys = hours.map(hour => `activity_hour:${chatId}:${day}:${hour}`);
    const BATCH_SIZE = 12;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      const values = await Promise.all(batch.map(key => env.COUNTERS.get(key)));
      for (let j = 0; j < batch.length; j++) {
        const value = parseInt(values[j] || '0', 10);
        if (value > 0) foundData = true;
        const hour = batch[j].split(':')[3];
        totals[hour] += value;
      }
    }
  }

  if (!foundData) {
    return await sendMessage(
      env,
      chatId,
      `${formatRangeTitle('Почасовая активность', range)}\nНет почасовых данных за выбранный период. Почасовая статистика собирается с первого сообщения после деплоя этой функции.`,
    );
  }

  const data = hours.map(hour => Number((totals[hour] / range.dayCount).toFixed(2)));
  const url = createBarChartUrl(hours, data, 'Avg messages/day', formatRangeTitle('Почасовая активность', range));
  return await sendPhoto(env, chatId, url);
}

// Profanity statistics interfaces
export interface UserProfanityStat {
  userId: number;
  username: string;
  count: number;
}

export interface UserProfanityRateStat {
  userId: number;
  username: string;
  profanityCount: number;
  wordCount: number;
  rate: number;
}

export interface WordProfanityStat {
  word: string;
  count: number;
  censored: string;
  contributors: UserProfanityStat[];
}

export interface UserPersonalProfanityStats {
  today: number;
  week: number;
  month: number;
}

// Helper function to get date range for period
function getDateRange(period: string): { startStr: string; endStr: string } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endStr = today.toISOString().slice(0, 10);

  let startStr: string;
  switch (period) {
    case 'week':
      const weekStart = new Date(today);
      weekStart.setUTCDate(weekStart.getUTCDate() - WEEK_DAYS);
      startStr = weekStart.toISOString().slice(0, 10);
      break;
    case 'month':
      const monthStart = new Date(today);
      monthStart.setUTCDate(monthStart.getUTCDate() - MONTH_DAYS);
      startStr = monthStart.toISOString().slice(0, 10);
      break;
    case 'today':
    default:
      startStr = endStr;
      break;
  }

  return { startStr, endStr };
}

// Helper function to censor profanity words
function censorWord(word: string): string {
  if (word.length <= 2) return word;
  if (word.length <= 4) return word[0] + '*'.repeat(word.length - 2) + word[word.length - 1];

  const visibleChars = Math.ceil(word.length * 0.3);
  const startChars = Math.ceil(visibleChars / 2);
  const endChars = visibleChars - startChars;

  return word.slice(0, startChars) +
    '*'.repeat(word.length - startChars - endChars) +
    word.slice(-endChars);
}

function isInProfanityPeriod(day: string, startStr: string, period: string): boolean {
  if (period === 'today') return day === startStr;
  return day >= startStr;
}

async function getTopProfanityWordUsers(
  env: Env,
  chatId: number,
  word: string,
  limit: number,
  period: string,
): Promise<UserProfanityStat[]> {
  const { startStr } = getDateRange(period);
  const prefix = `profanity_word_users:${chatId}:${word}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    const keysToFetch = list.keys.filter((k: any) => {
      const parts = k.name.split(':');
      // format: profanity_word_users:chatId:word:day:userId
      if (parts.length !== 5) return false;
      return isInProfanityPeriod(parts[3], startStr, period);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((k: any) => env.COUNTERS.get(k.name)));

      for (let j = 0; j < batch.length; j++) {
        const parts = batch[j].name.split(':');
        const userId = parts[4];
        const count = parseInt(values[j] || '0', 10);
        totals[userId] = (totals[userId] || 0) + count;
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const names = await Promise.all(sorted.map(([userId]) => env.COUNTERS.get(`user:${userId}`)));

  return sorted.map(([userId, count], index) => ({
    userId: parseInt(userId, 10),
    username: names[index] || `id${userId}`,
    count,
  }));
}

// Get top users by profanity count for a specific period
export async function getTopProfanityUsers(
  env: Env,
  chatId: number,
  limit: number = 5,
  period: string = 'today'
): Promise<UserProfanityStat[]> {
  const { startStr } = getDateRange(period);
  const prefix = `profanity:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    // Filter keys BEFORE fetching values to reduce subrequests
    const keysToFetch = list.keys.filter((k: any) => {
      const parts = k.name.split(':');
      // format: profanity:chatId:userId:day
      if (parts.length !== 4) return false;
      const day = parts[3];

      return isInProfanityPeriod(day, startStr, period);
    });

    if (keysToFetch.length === 0) continue;

    // Process in chunks to avoid hitting subrequest limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < keysToFetch.length; i += BATCH_SIZE) {
      const batch = keysToFetch.slice(i, i + BATCH_SIZE);
      const values = await Promise.all(
        batch.map((k: any) => env.COUNTERS.get(k.name))
      );

      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const parts = key.name.split(':');
        const userId = parts[2];
        const count = parseInt(values[j] || '0', 10);
        totals[userId] = (totals[userId] || 0) + count;
      }
    }
  } while (cursor);

  // Sort and limit results
  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  // Get usernames
  const names = await Promise.all(
    sorted.map(([userId]) => env.COUNTERS.get(`user:${userId}`))
  );

  return sorted.map(([userId, count], index) => ({
    userId: parseInt(userId, 10),
    username: names[index] || `id${userId}`,
    count,
  }));
}

async function aggregateProfanityUserTotals(
  env: Env,
  chatId: number,
  period: string,
): Promise<Record<string, number>> {
  const { startStr } = getDateRange(period);
  const prefix = `profanity:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    const keysToFetch = list.keys.filter((k: any) => {
      const parts = k.name.split(':');
      if (parts.length !== 4) return false;
      return isInProfanityPeriod(parts[3], startStr, period);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((k: any) => env.COUNTERS.get(k.name)));

      for (let j = 0; j < batch.length; j++) {
        const parts = batch[j].name.split(':');
        const userId = parts[2];
        const count = parseInt(values[j] || '0', 10);
        totals[userId] = (totals[userId] || 0) + count;
      }
    }
  } while (cursor);

  return totals;
}

async function aggregateUserWordTotals(
  env: Env,
  chatId: number,
  period: string,
): Promise<Record<string, number>> {
  const { startStr } = getDateRange(period);
  const prefix = `word_stats_v2:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    const keysToFetch = list.keys.filter((k: any) => {
      const parts = k.name.split(':');
      // format: word_stats_v2:chatId:day:userId
      if (parts.length !== 4) return false;
      return isInProfanityPeriod(parts[2], startStr, period);
    });

    for (let i = 0; i < keysToFetch.length; i += 10) {
      const batch = keysToFetch.slice(i, i + 10);
      const values = await Promise.all(batch.map((k: any) => env.COUNTERS.get(k.name)));

      for (let j = 0; j < batch.length; j++) {
        const parts = batch[j].name.split(':');
        const userId = parts[3];
        const count = parseInt(values[j] || '0', 10);
        totals[userId] = (totals[userId] || 0) + count;
      }
    }
  } while (cursor);

  return totals;
}

export async function getTopProfanityRateUsers(
  env: Env,
  chatId: number,
  limit: number = 10,
  period: string = 'week',
  minWords: number = PROFANITY_RATE_MIN_WORDS,
): Promise<UserProfanityRateStat[]> {
  const [profanityTotals, wordTotals] = await Promise.all([
    aggregateProfanityUserTotals(env, chatId, period),
    aggregateUserWordTotals(env, chatId, period),
  ]);

  const ranked = Object.entries(profanityTotals)
    .map(([userId, profanityCount]) => {
      const wordCount = wordTotals[userId] || 0;
      return {
        userId,
        profanityCount,
        wordCount,
        rate: wordCount > 0 ? (profanityCount / wordCount) * 100 : 0,
      };
    })
    .filter((stat) => stat.profanityCount > 0 && stat.wordCount >= minWords)
    .sort((a, b) =>
      b.rate - a.rate ||
      b.profanityCount - a.profanityCount ||
      b.wordCount - a.wordCount,
    )
    .slice(0, limit);

  const names = await Promise.all(
    ranked.map((stat) => env.COUNTERS.get(`user:${stat.userId}`)),
  );

  return ranked.map((stat, index) => ({
    userId: parseInt(stat.userId, 10),
    username: names[index] || `id${stat.userId}`,
    profanityCount: stat.profanityCount,
    wordCount: stat.wordCount,
    rate: stat.rate,
  }));
}

// Get top profanity words for a specific period
export async function getTopProfanityWords(
  env: Env,
  chatId: number,
  limit: number = 10,
  period: string = 'today'
): Promise<WordProfanityStat[]> {
  const { startStr } = getDateRange(period);
  const prefix = `profanity_words:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    // Filter keys BEFORE fetching values to reduce subrequests
    const keysToFetch = list.keys.filter((k: any) => {
      const parts = k.name.split(':');
      // format: profanity_words:chatId:word:day
      if (parts.length !== 4) return false;
      const day = parts[3];

      return isInProfanityPeriod(day, startStr, period);
    });

    if (keysToFetch.length === 0) continue;

    // Process in chunks to avoid hitting subrequest limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < keysToFetch.length; i += BATCH_SIZE) {
      const batch = keysToFetch.slice(i, i + BATCH_SIZE);
      const values = await Promise.all(
        batch.map((k: any) => env.COUNTERS.get(k.name))
      );

      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const parts = key.name.split(':');
        const word = parts[2];
        const count = parseInt(values[j] || '0', 10);
        totals[word] = (totals[word] || 0) + count;
      }
    }
  } while (cursor);

  // Sort and limit results
  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const contributorsByWord = await Promise.all(
    sorted.map(([word]) => getTopProfanityWordUsers(env, chatId, word, 10, period))
  );

  return sorted.map(([word, count], index) => ({
    word,
    count,
    censored: censorWord(word),
    contributors: contributorsByWord[index],
  }));
}

// Get personal profanity statistics for a user
export async function getUserProfanityStats(
  env: Env,
  chatId: number,
  userId: number
): Promise<UserPersonalProfanityStats> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - WEEK_DAYS);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const monthStart = new Date(today);
  monthStart.setUTCDate(monthStart.getUTCDate() - MONTH_DAYS);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const prefix = `profanity:${chatId}:${userId}:`;
  let cursor: string | undefined = undefined;
  let todayCount = 0;
  let weekCount = 0;
  let monthCount = 0;

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const values = await Promise.all(
      list.keys.map((k: any) => env.COUNTERS.get(k.name)),
    );

    for (let i = 0; i < list.keys.length; i++) {
      const key = list.keys[i];
      const [_, chat, user, day] = key.name.split(':');
      const count = parseInt(values[i] || '0', 10);

      if (day === todayStr) {
        todayCount += count;
      }
      if (day >= weekStartStr) {
        weekCount += count;
      }
      if (day >= monthStartStr) {
        monthCount += count;
      }
    }
  } while (cursor);

  return {
    today: todayCount,
    week: weekCount,
    month: monthCount,
  };
}

// Reset only profanity counters for a chat
export async function resetProfanityCounters(env: Env, chatId: number) {
  // Reset profanity user counters
  const pPrefix = `profanity:${chatId}:`;
  let cursor: string | undefined = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: pPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  // Reset profanity word counters
  const pwPrefix = `profanity_words:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: pwPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  const pwuPrefix = `profanity_word_users:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: pwuPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);
}

// Command handler for profanity top users
export async function profanityTopUsers(
  env: Env,
  chatId: number,
  count: number = 5,
  period: string = 'today'
): Promise<string | void> {
  // Validate parameters
  const validPeriods = ['today', 'week', 'month'];
  if (!validPeriods.includes(period)) {
    return await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
  }

  const limit = Number.isFinite(count) ? Math.min(Math.max(count, 1), 20) : 10; // Limit between 1 and 20

  try {
    const topUsers = await getTopProfanityUsers(env, chatId, limit, period);

    if (topUsers.length === 0) {
      return await sendMessage(env, chatId, 'Нет данных о матерной лексике');
    }

    const periodText = period === 'today' ? 'сегодня' :
      period === 'week' ? 'за деделю' : 'за месяц';

    const lines = [`Топ матершинников ${periodText}:`];
    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i];
      lines.push(`${i + 1}. ${user.username}: ${user.count}`);
    }

    const text = lines.join('\n');
    return await sendMessage(env, chatId, text);
  } catch (error: any) {
    console.error('profanity top users error', {
      chatId,
      error: error.message || String(error)
    });
    return await sendMessage(env, chatId, 'Ошибка при получении статистики');
  }
}

// Command handler for profanity words statistics
export async function profanityWordsStats(
  env: Env,
  chatId: number,
  count: number = 10,
  period: string = 'today'
): Promise<string | void> {
  // Validate parameters
  const validPeriods = ['today', 'week', 'month'];
  if (!validPeriods.includes(period)) {
    return await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
  }

  const limit = Number.isFinite(count) ? Math.min(Math.max(count, 1), 20) : 10; // Limit between 1 and 20

  try {
    const topWords = await getTopProfanityWords(env, chatId, limit, period);

    if (topWords.length === 0) {
      return await sendMessage(env, chatId, 'Нет данных о матерных словах');
    }

    const periodText = period === 'today' ? 'сегодня' :
      period === 'week' ? 'за неделю' : 'за месяц';

    const lines = [`Топ матерных слов ${periodText}:`];
    for (let i = 0; i < topWords.length; i++) {
      const word = topWords[i];
      lines.push(`${i + 1}. ${word.word}: ${word.count}`);
    }

    const text = lines.join('\n');
    return await sendMessage(env, chatId, text);
  } catch (error: any) {
    console.error('profanity words stats error', {
      chatId,
      error: error.message || String(error)
    });
    return await sendMessage(env, chatId, 'Ошибка при получении статистики слов');
  }
}

function formatPercent(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '') + '%';
}

export async function profanityRateChart(
  env: Env,
  chatId: number,
  count: number = 10,
  period: string = 'week',
): Promise<{ text: string; imageUrl?: string } | void> {
  const validPeriods = ['today', 'week', 'month'];
  if (!validPeriods.includes(period)) {
    await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
    return;
  }

  const limit = Math.min(Math.max(count, 1), 20);
  const periodText = period === 'today' ? 'сегодня' :
    period === 'week' ? 'за неделю' : 'за месяц';

  try {
    const topUsers = await getTopProfanityRateUsers(
      env,
      chatId,
      limit,
      period,
      PROFANITY_RATE_MIN_WORDS,
    );

    if (topUsers.length === 0) {
      const text = `Нет данных для графика доли мата ${periodText}. Минимум: ${PROFANITY_RATE_MIN_WORDS} слов на пользователя.`;
      if (env.DRY_RUN) return { text };
      await sendMessage(env, chatId, text);
      return;
    }

    const title = `Доля мата ${periodText} (мин. ${PROFANITY_RATE_MIN_WORDS} слов)`;
    const lines = [title];
    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i];
      lines.push(
        `${i + 1}. ${user.username}: ${formatPercent(user.rate)} (${user.profanityCount}/${user.wordCount} слов)`,
      );
    }

    let imageUrl: string | undefined;
    try {
      const labels = topUsers.map((user) => sanitizeLabel(user.username));
      const values = topUsers.map((user) => Number(user.rate.toFixed(2)));
      imageUrl = createBarChartUrl(labels, values, '% мата', title);
    } catch (error: any) {
      console.error('profanity rate chart generation error', {
        chatId,
        period,
        error: error.message || String(error),
      });
    }

    const text = lines.join('\n');
    if (env.DRY_RUN) {
      return { text, imageUrl };
    }

    await sendMessage(env, chatId, text);
    if (imageUrl) {
      try {
        await sendPhoto(env, chatId, imageUrl);
      } catch (error: any) {
        console.error('profanity rate chart send photo error', {
          chatId,
          error: error.message || String(error),
        });
      }
    }
  } catch (error: any) {
    console.error('profanity rate chart error', {
      chatId,
      period,
      error: error.message || String(error),
    });
    await sendMessage(env, chatId, 'Ошибка при построении графика доли мата');
    return;
  }
}

// Command handler for personal profanity statistics
export async function myProfanityStats(
  env: Env,
  chatId: number,
  userId: number,
  period?: string
): Promise<string | void> {
  try {
    if (period) {
      // Show stats for specific period
      const validPeriods = ['today', 'week', 'month'];
      if (!validPeriods.includes(period)) {
        return await sendMessage(env, chatId, 'Неверный periods. Используйте: today, week, month');
      }

      const stats = await getUserProfanityStats(env, chatId, userId);
      let count: number;
      let periodText: string;

      switch (period) {
        case 'today':
          count = stats.today;
          periodText = 'сегодня';
          break;
        case 'week':
          count = stats.week;
          periodText = 'за неделю';
          break;
        case 'month':
          count = stats.month;
          periodText = 'за месяц';
          break;
        default:
          count = stats.today;
          periodText = 'сегодня';
      }

      if (count === 0) {
        return await sendMessage(env, chatId, `У вас чистая речь ${periodText}!`);
      } else {
        return await sendMessage(env, chatId, `Ваша статистика ${periodText}: ${count} матерных слов`);
      }
    } else {
      // Show stats for all periods
      const stats = await getUserProfanityStats(env, chatId, userId);

      if (stats.today === 0 && stats.week === 0 && stats.month === 0) {
        return await sendMessage(env, chatId, 'У вас чистая речь!');
      }

      const lines = [
        'Ваша статистика матерной лексики:',
        `Сегодня: ${stats.today}`,
        `За неделю: ${stats.week}`,
        `За месяц: ${stats.month}`
      ];

      const text = lines.join('\n');
      return await sendMessage(env, chatId, text);
    }
  } catch (error: any) {
    console.error('my profanity stats error', {
      chatId,
      userId,
      error: error.message || String(error)
    });
    return await sendMessage(env, chatId, 'Ошибка при получении вашей статистики');
  }
}

// Profanity chart functionality
export async function profanityChart(
  env: Env,
  chatId: number,
  period: 'week' | 'month',
): Promise<{ text: string; imageUrl?: string } | void> {
  const prefix = `profanity:${chatId}:`;
  let cursor: string | undefined = undefined;
  const dailyTotals: Record<string, number> = {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(
    start.getUTCDate() - (period === 'month' ? MONTH_DAYS : WEEK_DAYS),
  );
  const startStr = start.toISOString().slice(0, 10);

  // Collect profanity data from KV storage
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    // Filter keys BEFORE fetching values to reduce subrequests
    const keysToFetch = list.keys.filter((k: any) => {
      const parts = k.name.split(':');
      // format: profanity:chatId:userId:day
      if (parts.length !== 4) return false;
      const day = parts[3];
      return day >= startStr;
    });

    if (keysToFetch.length === 0) continue;

    // Process in chunks to avoid hitting subrequest limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < keysToFetch.length; i += BATCH_SIZE) {
      const batch = keysToFetch.slice(i, i + BATCH_SIZE);
      const values = await Promise.all(
        batch.map((k: any) => env.COUNTERS.get(k.name))
      );

      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const parts = key.name.split(':');
        const day = parts[3];
        const count = parseInt(values[j] || '0', 10);
        dailyTotals[day] = (dailyTotals[day] || 0) + count;
      }
    }
  } while (cursor);

  let data: { label: string; value: number }[] = [];

  if (period === 'week') {
    // Show daily data for the week
    const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY * 1000);
      const key = d.toISOString().slice(0, 10);
      data.push({ label: labels[d.getUTCDay()], value: dailyTotals[key] || 0 });
    }
  } else {
    // Show weekly data for the month
    const weeks = [0, 0, 0, 0];
    for (const day in dailyTotals) {
      const diff = Math.floor(
        (today.getTime() - new Date(day).getTime()) / (DAY * 1000),
      );
      const idx = 3 - Math.floor(diff / 7);
      if (idx >= 0 && idx < 4) weeks[idx] += dailyTotals[day];
    }
    for (let i = 0; i < 4; i++)
      data.push({ label: `W${i + 1}`, value: weeks[i] });
  }

  // Format text output with ASCII chart
  const periodText = period === 'week' ? 'за неделю' : 'за месяц';
  const title = `Статистика мата ${periodText}`;
  const textOutput = formatProfanityActivityText(data, title);

  // Try to generate QuickChart image if there's data
  const hasData = data.some(d => d.value > 0);
  let imageUrl: string | undefined;
  if (hasData) {
    try {
      const labels = data.map(d => d.label);
      const values = data.map(d => d.value);
      const chartTitle = `Матерная лексика ${periodText}`;
      imageUrl = createBarChartUrl(labels, values, 'Количество', chartTitle);
    } catch (error: any) {
      console.error('profanity chart generation error', {
        chatId,
        period,
        error: error.message || String(error)
      });
      // Chart generation failure is not critical, text chart was already sent
    }
  }

  // In DRY_RUN mode, return both text and imageUrl
  if (env.DRY_RUN) {
    return { text: textOutput, imageUrl };
  }

  await sendMessage(env, chatId, textOutput);
  if (imageUrl) {
    try {
      await sendPhoto(env, chatId, imageUrl);
    } catch (error: any) {
      console.error('profanity chart send photo error', {
        chatId,
        error: error.message || String(error)
      });
      // Failed to send photo, but text chart was already sent
    }
  }
}

// Helper function to format profanity activity text with ASCII chart
function formatProfanityActivityText(data: { label: string; value: number }[], title: string): string {
  if (data.length === 0) return 'Нет данных о матерной лексике';

  const hasData = data.some(d => d.value > 0);
  if (!hasData) return 'Нет данных о матерной лексике';

  const text = drawGraph(data);
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return `${title}\n${text}\nВсего: ${total}`;
}

// Criminal Code analysis statistics interfaces
export interface UserCriminalStat {
  userId: number;
  username: string;
  count: number;
  totalYears?: number;
  lifeSentences?: number;
}

export interface UserPersonalCriminalStats {
  today: number;
  week: number;
  month: number;
}

// Get top users by criminal violations count for a specific period
export async function getTopCriminalUsers(
  env: Env,
  chatId: number,
  limit: number = 5,
  period: string = 'today'
): Promise<UserCriminalStat[]> {
  const { startStr } = getDateRange(period);
  const prefix = `criminal:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;

    // Filter keys BEFORE fetching values to reduce subrequests
    const keysToFetch = list.keys.filter((k: any) => {
      const parts = k.name.split(':');
      // format: criminal:chatId:userId:day
      if (parts.length !== 4) return false;
      const day = parts[3];
      return day >= startStr;
    });

    if (keysToFetch.length === 0) continue;

    // Process in chunks to avoid hitting subrequest limits
    const BATCH_SIZE = 10;
    for (let i = 0; i < keysToFetch.length; i += BATCH_SIZE) {
      const batch = keysToFetch.slice(i, i + BATCH_SIZE);
      const values = await Promise.all(
        batch.map((k: any) => env.COUNTERS.get(k.name))
      );

      for (let j = 0; j < batch.length; j++) {
        const key = batch[j];
        const parts = key.name.split(':');
        const user = parts[2];
        const count = parseInt(values[j] || '0', 10);
        totals[user] = (totals[user] || 0) + count;
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const result: UserCriminalStat[] = [];
  const usernames = await Promise.all(
    sorted.map(([userId]) => env.COUNTERS.get(`user:${userId}`)),
  );

  for (let i = 0; i < sorted.length; i++) {
    const [userId, count] = sorted[i];
    const username = usernames[i] || `id${userId}`;
    result.push({
      userId: parseInt(userId, 10),
      username,
      count,
    });
  }

  return result;
}

export async function getTopCriminalUsersBySentence(
  env: Env,
  chatId: number,
  limit: number = 5,
  period: string = 'today'
): Promise<UserCriminalStat[]> {
  if (!env.DB) {
    return getTopCriminalUsers(env, chatId, limit, period);
  }

  const repository = new ViolationRepository(env);
  const sentenceUsers = await repository.getTopUsersBySentenceStats(
    chatId.toString(),
    criminalPeriodToDays(period),
    limit
  );
  if (sentenceUsers.length === 0) {
    return getTopCriminalUsers(env, chatId, limit, period);
  }

  const usernames = await Promise.all(
    sentenceUsers.map(user => env.COUNTERS.get(`user:${user.userId}`)),
  );

  return sentenceUsers.map((user, index) => ({
    userId: parseInt(user.userId, 10),
    username: usernames[index] || `id${user.userId}`,
    count: user.count,
    totalYears: user.totalYears || 0,
    lifeSentences: user.lifeSentences || 0,
  }));
}

// Get personal criminal violations statistics for a user
export async function getUserCriminalStats(
  env: Env,
  chatId: number,
  userId: number
): Promise<UserPersonalCriminalStats> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const weekStart = new Date(today);
  weekStart.setUTCDate(weekStart.getUTCDate() - WEEK_DAYS);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const monthStart = new Date(today);
  monthStart.setUTCDate(monthStart.getUTCDate() - MONTH_DAYS);
  const monthStartStr = monthStart.toISOString().slice(0, 10);

  const prefix = `criminal:${chatId}:${userId}:`;
  let cursor: string | undefined = undefined;
  let todayCount = 0;
  let weekCount = 0;
  let monthCount = 0;

  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const values = await Promise.all(
      list.keys.map((k: any) => env.COUNTERS.get(k.name)),
    );
    for (let i = 0; i < list.keys.length; i++) {
      const [_, chat, user, day] = list.keys[i].name.split(':');
      const count = parseInt(values[i] || '0', 10);

      if (day === todayStr) {
        todayCount += count;
      }
      if (day >= weekStartStr) {
        weekCount += count;
      }
      if (day >= monthStartStr) {
        monthCount += count;
      }
    }
  } while (cursor);

  return {
    today: todayCount,
    week: weekCount,
    month: monthCount,
  };
}

// Command handler for criminal code top users
export async function criminalTopUsers(
  env: Env,
  chatId: number,
  count: number = 5,
  period: string = 'today'
): Promise<string | void> {
  // Validate parameters
  const validPeriods = ['today', 'week', 'month'];
  if (!validPeriods.includes(period)) {
    return await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
  }

  const limit = Math.min(Math.max(count, 1), 20); // Limit between 1 and 20

  try {
    let topUsers: UserCriminalStat[];
    try {
      topUsers = await getTopCriminalUsersBySentence(env, chatId, limit, period);
    } catch (sentenceError: any) {
      console.error('criminal sentence top users error', {
        chatId,
        error: sentenceError.message || String(sentenceError)
      });
      topUsers = await getTopCriminalUsers(env, chatId, limit, period);
    }

    if (topUsers.length === 0) {
      return await sendMessage(env, chatId, 'Нет данных о нарушениях УК РФ');
    }

    const periodText = period === 'today' ? 'сегодня' :
      period === 'week' ? 'за неделю' : 'за месяц';

    const lines = [`Топ нарушителей УК РФ ${periodText}:`];
    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i];
      const sentenceText = user.totalYears !== undefined || user.lifeSentences !== undefined
        ? `, напиздел: ${formatSentenceTotalValue({
          totalYears: user.totalYears || 0,
          lifeSentences: user.lifeSentences || 0,
        })}`
        : '';
      lines.push(`${i + 1}. ${user.username}: ${user.count} нарушений${sentenceText}`);
    }

    const text = lines.join('\n');
    return await sendMessage(env, chatId, text);
  } catch (error: any) {
    console.error('criminal top users error', {
      chatId,
      error: error.message || String(error)
    });
    return await sendMessage(env, chatId, 'Ошибка при получении топа нарушителей');
  }
}

function criminalPeriodToDays(period: string): number {
  switch (period) {
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'today':
    default:
      return 1;
  }
}

// Command handler for personal criminal statistics
export async function myCriminalStats(
  env: Env,
  chatId: number,
  userId: number,
  period?: string
): Promise<string | void> {
  try {
    // Use ViolationHandler for enhanced formatting
    const violationHandler = new ViolationHandler(env);
    const formattedStats = await violationHandler.getUserStats(userId.toString(), chatId.toString());
    return await sendMessage(env, chatId, formattedStats);
  } catch (error: any) {
    console.error('my criminal stats error', {
      chatId,
      userId,
      error: error.message || String(error)
    });

    // Fallback to legacy formatting if ViolationHandler fails
    try {
      if (period) {
        // Show stats for specific period
        const validPeriods = ['today', 'week', 'month'];
        if (!validPeriods.includes(period)) {
          return await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
        }

        const stats = await getUserCriminalStats(env, chatId, userId);
        let count: number;
        let periodText: string;

        switch (period) {
          case 'today':
            count = stats.today;
            periodText = 'сегодня';
            break;
          case 'week':
            count = stats.week;
            periodText = 'за неделю';
            break;
          case 'month':
            count = stats.month;
            periodText = 'за месяц';
            break;
          default:
            count = stats.today;
            periodText = 'сегодня';
        }

        if (count === 0) {
          return await sendMessage(env, chatId, `У вас чистая речь ${periodText}!`);
        } else {
          return await sendMessage(env, chatId, `Ваша статистика ${periodText}: ${count} нарушений УК РФ`);
        }
      } else {
        // Show stats for all periods
        const stats = await getUserCriminalStats(env, chatId, userId);

        if (stats.today === 0 && stats.week === 0 && stats.month === 0) {
          return await sendMessage(env, chatId, 'У вас чистая речь!');
        }

        const lines = [
          'Ваша статистика нарушений УК РФ:',
          `Сегодня: ${stats.today}`,
          `За неделю: ${stats.week}`,
          `За месяц: ${stats.month}`
        ];

        const text = lines.join('\n');
        return await sendMessage(env, chatId, text);
      }
    } catch (fallbackError: any) {
      console.error('my criminal stats fallback error', {
        chatId,
        userId,
        error: fallbackError.message || String(fallbackError)
      });
      return await sendMessage(env, chatId, 'Ошибка при получении вашей статистики');
    }
  }
}

// Command handler for criminal code statistics
export async function criminalCodeStats(
  env: Env,
  chatId: number,
  period: string = 'today'
): Promise<string | void> {
  // Validate parameters
  const validPeriods = ['today', 'week', 'month'];
  if (!validPeriods.includes(period)) {
    return await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
  }

  try {
    // Convert period to days for ViolationHandler
    let days: number;
    switch (period) {
      case 'today':
        days = 1;
        break;
      case 'week':
        days = 7;
        break;
      case 'month':
        days = 30;
        break;
      default:
        days = 1;
    }

    // Use ViolationHandler for enhanced formatting
    const violationHandler = new ViolationHandler(env);
    const formattedStats = await violationHandler.getPeriodStats(chatId.toString(), days);
    return await sendMessage(env, chatId, formattedStats);
  } catch (error: any) {
    console.error('criminal code stats error', {
      chatId,
      error: error.message || String(error)
    });

    // Fallback to legacy formatting if ViolationHandler fails
    try {
      const topUsers = await getTopCriminalUsers(env, chatId, 10, period);

      if (topUsers.length === 0) {
        return await sendMessage(env, chatId, 'Нет данных о нарушениях УК РФ');
      }

      const periodText = period === 'today' ? 'сегодня' :
        period === 'week' ? 'за неделю' : 'за месяц';

      const lines = [`Статистика нарушений УК РФ ${periodText}:`];
      const totalViolations = topUsers.reduce((sum, user) => sum + user.count, 0);

      for (let i = 0; i < Math.min(topUsers.length, 10); i++) {
        const user = topUsers[i];
        lines.push(`${i + 1}. ${user.username}: ${user.count}`);
      }

      lines.push(`\nВсего нарушений: ${totalViolations}`);

      const text = lines.join('\n');
      return await sendMessage(env, chatId, text);
    } catch (fallbackError: any) {
      console.error('criminal code stats fallback error', {
        chatId,
        error: fallbackError.message || String(fallbackError)
      });
      return await sendMessage(env, chatId, 'Ошибка при получении статистики УК РФ');
    }
  }
}

// Reset only criminal code counters for a chat
export async function resetCriminalCounters(env: Env, chatId: number) {
  // Reset criminal user counters
  const cPrefix = `criminal:${chatId}:`;
  let cursor: string | undefined = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: cPrefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    for (const key of list.keys) {
      await env.COUNTERS.delete(key.name);
    }
  } while (cursor);

  // Reset criminal violations in database if available
  if (env.DB) {
    try {
      await env.DB.prepare('DELETE FROM criminal_violations WHERE chat_id = ?')
        .bind(chatId)
        .run();
      await env.DB.prepare('DELETE FROM violation_stats WHERE chat_id = ?')
        .bind(chatId)
        .run();
    } catch (e) {
      console.error('criminal reset db error', {
        chat: chatId.toString(36),
        err: (e as Error).message || String(e),
      });
    }
  }
}

// Data retention cleanup
export async function cleanupOldData(
  env: Env,
  rawRetentionDays: number = 7,
  summaryRetentionDays: number = 30
): Promise<{ deletedSummaries: number; deletedViolations: number; cleanedDOs: number }> {
  console.log(`[Cleanup] Starting cleanup: raw=${rawRetentionDays}d, summary=${summaryRetentionDays}d`);
  const result = {
    deletedSummaries: 0,
    deletedViolations: 0,
    cleanedDOs: 0
  };

  if (!env.DB) {
    console.warn('[Cleanup] No DB configured, skipping D1 cleanup');
    return result;
  }

  try {
    // 1. Clean D1 Tables
    // Summaries
    const summaryCutoff = new Date(Date.now() - summaryRetentionDays * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    // Check if period_end is older than cutoff. period_end is usually YYYY-MM-DD
    const sumRes = await env.DB.prepare(
      'DELETE FROM summaries WHERE period_end < ?'
    ).bind(summaryCutoff).run();
    result.deletedSummaries = sumRes.meta.changes || 0;

    // Criminal Violations
    const violRes = await env.DB.prepare(
      "DELETE FROM criminal_violations WHERE created_at < datetime('now', '-' || ? || ' days')"
    ).bind(summaryRetentionDays).run();
    result.deletedViolations = violRes.meta.changes || 0;

    // Cache
    await env.DB.prepare(
      "DELETE FROM criminal_analysis_cache WHERE expires_at < datetime('now')"
    ).run();

    console.log(`[Cleanup] D1 cleaned: summaries=${result.deletedSummaries}, violations=${result.deletedViolations}`);

    // 2. Clean Durable Objects (DayBlockManager)
    // We identify DOs to delete based on 'activity' table which tracks chat-days

    if (env.DAY_BLOCK_MANAGER_DO) {
      const doCutoff = new Date(Date.now() - rawRetentionDays * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);

      // Find days older than retention period that might still have DOs
      // We look at 'activity' table. Note: We DO NOT delete from 'activity' yet, 
      // as we want to keep stats for 90 days (or indefinitely).
      const activityRes = await env.DB.prepare(
        'SELECT chat_id, day FROM activity WHERE day < ?'
      ).bind(doCutoff).all();

      const targets = (activityRes.results as { chat_id: number, day: string }[]) || [];
      console.log(`[Cleanup] Found ${targets.length} potential DO candidates older than ${doCutoff}`);

      // Process in batches
      const pending = [];
      for (const target of targets) {
        const name = `dayblock:${target.chat_id}:${target.day}`;
        const doId = env.DAY_BLOCK_MANAGER_DO.idFromName(name);
        const doStub = env.DAY_BLOCK_MANAGER_DO.get(doId);

        pending.push(
          doStub.fetch('https://do/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          })
            .then(r => r.json())
            .then((d: any) => d.deleted ? 1 : 0)
            .catch(e => {
              console.error(`[Cleanup] Failed to clean DO ${name}:`, e);
              return 0;
            })
        );

        if (pending.length >= 20) {
          const results = await Promise.all(pending);
          result.cleanedDOs += results.reduce((a, b) => a + b, 0);
          pending.length = 0;
        }
      }

      if (pending.length > 0) {
        const results = await Promise.all(pending);
        result.cleanedDOs += results.reduce((a, b) => a + b, 0);
      }
    }

  } catch (error: any) {
    console.error('[Cleanup] Error during cleanup:', error);
    // Don't throw, just log
  }

  return result;
}
