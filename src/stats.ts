import { Env, DAY, MONTH_DAYS, WEEK_DAYS } from './env';
import type { KVNamespace } from '@cloudflare/workers-types';
import { sendMessage, sendPhoto } from './telegram';
import { summariseChat } from './summary';

export async function topChat(
  env: Env,
  chatId: number,
  n: number,
  day: string,
) {
  const prefix = `stats:${chatId}:`;
  let cursor: string | undefined = undefined;
  const counts: Record<string, number> = {};
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const values = await Promise.all(
      list.keys.map((k: any) => env.COUNTERS.get(k.name)),
    );
    for (let i = 0; i < list.keys.length; i++) {
      const key = list.keys[i];
      const [_, chat, user, d] = key.name.split(':');
      if (d !== day) continue;
      const c = parseInt(values[i] || '0');
      counts[user] = (counts[user] || 0) + c;
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
  await sendMessage(env, chatId, text);
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
  const aPrefix = `activity:${chatId}:`;
  cursor = undefined;
  do {
    const list: any = await env.COUNTERS.list({ prefix: aPrefix, cursor });
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

interface ChartDataset {
  label: string;
  data: number[];
}

interface ChartConfig {
  type: 'bar';
  data: { labels: string[]; datasets: ChartDataset[] };
  options?: {
    plugins: {
      title: { display: boolean; text: string };
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
      plugins: {
        title: { display: Boolean(title), text: title ?? '' },
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
  period: 'week' | 'month',
) {
  const prefix = `activity:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(
    start.getUTCDate() - (period === 'month' ? MONTH_DAYS : WEEK_DAYS),
  );
  const startStr = start.toISOString().slice(0, 10);
  let dbOk = false;
  if (env.DB) {
    try {
      const res = await env.DB.prepare(
        'SELECT day, count FROM activity WHERE chat_id = ? AND day >= ? ORDER BY day',
      )
        .bind(chatId, startStr)
        .all();
      for (const row of res.results as { day: string; count: number }[]) {
        totals[row.day] = row.count;
      }
      dbOk = true;
    } catch (e) {
      console.error('activity db read error', {
        chat: chatId.toString(36),
        err: (e as any).message || String(e),
      });
    }
  }
  if (!dbOk) {
    do {
      const list: any = await env.COUNTERS.list({ prefix, cursor });
      cursor = !list.list_complete ? list.cursor : undefined;
      const values = await Promise.all(
        list.keys.map((k: any) => env.COUNTERS.get(k.name)),
      );
      for (let i = 0; i < list.keys.length; i++) {
        const [_, , day] = list.keys[i].name.split(':');
        if (day >= startStr) {
          const c = parseInt(values[i] || '0', 10);
          totals[day] = (totals[day] || 0) + c;
        }
      }
    } while (cursor);
  }

  let data: { label: string; value: number }[] = [];
  if (period === 'week') {
    const labels = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY * 1000);
      const key = d.toISOString().slice(0, 10);
      data.push({ label: labels[d.getUTCDay()], value: totals[key] || 0 });
    }
  } else {
    const weeks = [0, 0, 0, 0];
    for (const day in totals) {
      const diff = Math.floor(
        (today.getTime() - new Date(day).getTime()) / (DAY * 1000),
      );
      const idx = 3 - Math.floor(diff / 7);
      if (idx >= 0 && idx < 4) weeks[idx] += totals[day];
    }
    for (let i = 0; i < 4; i++)
      data.push({ label: `W${i + 1}`, value: weeks[i] });
  }

  await sendMessage(env, chatId, formatActivityText(data));
}

export async function activityByUser(
  env: Env,
  chatId: number,
  period: 'week' | 'month',
) {
  const prefix = `stats:${chatId}:`;
  let cursor: string | undefined = undefined;
  const totals: Record<string, number> = {};
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(
    start.getUTCDate() - (period === 'month' ? MONTH_DAYS : WEEK_DAYS),
  );
  const startStr = start.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);
  do {
    const list: any = await env.COUNTERS.list({ prefix, cursor });
    cursor = !list.list_complete ? list.cursor : undefined;
    const values = await Promise.all(
      list.keys.map((k: any) => env.COUNTERS.get(k.name)),
    );
    for (let i = 0; i < list.keys.length; i++) {
      const [_, , user, day] = list.keys[i].name.split(':');
      if (day >= startStr) {
        const c = parseInt(values[i] || '0', 10);
        totals[user] = (totals[user] || 0) + c;
      }
    }
  } while (cursor);

  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const names = await Promise.all(
    sorted.map(([u]) => env.COUNTERS.get(`user:${u}`)),
  );
  const labels = names.map((n, i) => sanitizeLabel(n || `id${sorted[i][0]}`));
  const data = sorted.map(([, c]) => c);
  const title = `${startStr} - ${endStr}`;
  const url = createBarChartUrl(labels, data, 'Messages', title);
  await sendPhoto(env, chatId, url);
}

// Profanity statistics interfaces
export interface UserProfanityStat {
  userId: number;
  username: string;
  count: number;
}

export interface WordProfanityStat {
  word: string;
  count: number;
  censored: string;
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
    const values = await Promise.all(
      list.keys.map((k: any) => env.COUNTERS.get(k.name)),
    );
    
    for (let i = 0; i < list.keys.length; i++) {
      const key = list.keys[i];
      const [_, chat, user, day] = key.name.split(':');
      
      // Filter by period
      if (period === 'today' && day !== startStr) continue;
      if (period !== 'today' && day < startStr) continue;
      
      const count = parseInt(values[i] || '0', 10);
      totals[user] = (totals[user] || 0) + count;
    }
  } while (cursor);

  // Sort and limit results
  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  // Get usernames
  const names = await Promise.all(
    sorted.map(([userId]) => env.COUNTERS.get(`user:${userId}`)),
  );

  return sorted.map(([userId, count], index) => ({
    userId: parseInt(userId, 10),
    username: names[index] || `id${userId}`,
    count,
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
    const values = await Promise.all(
      list.keys.map((k: any) => env.COUNTERS.get(k.name)),
    );
    
    for (let i = 0; i < list.keys.length; i++) {
      const key = list.keys[i];
      const [_, chat, word, day] = key.name.split(':');
      
      // Filter by period
      if (period === 'today' && day !== startStr) continue;
      if (period !== 'today' && day < startStr) continue;
      
      const count = parseInt(values[i] || '0', 10);
      totals[word] = (totals[word] || 0) + count;
    }
  } while (cursor);

  // Sort and limit results
  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  return sorted.map(([word, count]) => ({
    word,
    count,
    censored: censorWord(word),
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
}

// Command handler for profanity top users
export async function profanityTopUsers(
  env: Env,
  chatId: number,
  count: number = 5,
  period: string = 'today'
) {
  // Validate parameters
  const validPeriods = ['today', 'week', 'month'];
  if (!validPeriods.includes(period)) {
    await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
    return;
  }

  const limit = Math.min(Math.max(count, 1), 20); // Limit between 1 and 20
  
  try {
    const topUsers = await getTopProfanityUsers(env, chatId, limit, period);
    
    if (topUsers.length === 0) {
      await sendMessage(env, chatId, 'Нет данных о матерной лексике');
      return;
    }

    const periodText = period === 'today' ? 'сегодня' : 
                     period === 'week' ? 'за неделю' : 'за месяц';
    
    const lines = [`Топ матершинников ${periodText}:`];
    for (let i = 0; i < topUsers.length; i++) {
      const user = topUsers[i];
      lines.push(`${i + 1}. ${user.username}: ${user.count}`);
    }
    
    const text = lines.join('\n');
    await sendMessage(env, chatId, text);
  } catch (error: any) {
    console.error('profanity top users error', {
      chatId,
      error: error.message || String(error)
    });
    await sendMessage(env, chatId, 'Ошибка при получении статистики');
  }
}

// Command handler for profanity words statistics
export async function profanityWordsStats(
  env: Env,
  chatId: number,
  count: number = 10,
  period: string = 'today'
) {
  // Validate parameters
  const validPeriods = ['today', 'week', 'month'];
  if (!validPeriods.includes(period)) {
    await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
    return;
  }

  const limit = Math.min(Math.max(count, 1), 20); // Limit between 1 and 20
  
  try {
    const topWords = await getTopProfanityWords(env, chatId, limit, period);
    
    if (topWords.length === 0) {
      await sendMessage(env, chatId, 'Нет данных о матерных словах');
      return;
    }

    const periodText = period === 'today' ? 'сегодня' : 
                     period === 'week' ? 'за неделю' : 'за месяц';
    
    const lines = [`Топ матерных слов ${periodText}:`];
    for (let i = 0; i < topWords.length; i++) {
      const word = topWords[i];
      lines.push(`${i + 1}. ${word.word}: ${word.count}`);
    }
    
    const text = lines.join('\n');
    await sendMessage(env, chatId, text);
  } catch (error: any) {
    console.error('profanity words stats error', {
      chatId,
      error: error.message || String(error)
    });
    await sendMessage(env, chatId, 'Ошибка при получении статистики слов');
  }
}

// Command handler for personal profanity statistics
export async function myProfanityStats(
  env: Env,
  chatId: number,
  userId: number,
  period?: string
) {
  try {
    if (period) {
      // Show stats for specific period
      const validPeriods = ['today', 'week', 'month'];
      if (!validPeriods.includes(period)) {
        await sendMessage(env, chatId, 'Неверный период. Используйте: today, week, month');
        return;
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
        await sendMessage(env, chatId, `У вас чистая речь ${periodText}!`);
      } else {
        await sendMessage(env, chatId, `Ваша статистика ${periodText}: ${count} матерных слов`);
      }
    } else {
      // Show stats for all periods
      const stats = await getUserProfanityStats(env, chatId, userId);
      
      if (stats.today === 0 && stats.week === 0 && stats.month === 0) {
        await sendMessage(env, chatId, 'У вас чистая речь!');
        return;
      }

      const lines = [
        'Ваша статистика матерной лексики:',
        `Сегодня: ${stats.today}`,
        `За неделю: ${stats.week}`,
        `За месяц: ${stats.month}`
      ];
      
      const text = lines.join('\n');
      await sendMessage(env, chatId, text);
    }
  } catch (error: any) {
    console.error('my profanity stats error', {
      chatId,
      userId,
      error: error.message || String(error)
    });
    await sendMessage(env, chatId, 'Ошибка при получении вашей статистики');
  }
}

// Profanity chart functionality
export async function profanityChart(
  env: Env,
  chatId: number,
  period: 'week' | 'month',
) {
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
    const values = await Promise.all(
      list.keys.map((k: any) => env.COUNTERS.get(k.name)),
    );
    for (let i = 0; i < list.keys.length; i++) {
      const [_, chat, user, day] = list.keys[i].name.split(':');
      if (day >= startStr) {
        const count = parseInt(values[i] || '0', 10);
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
  await sendMessage(env, chatId, textOutput);

  // Try to generate QuickChart image if there's data
  const hasData = data.some(d => d.value > 0);
  if (hasData) {
    try {
      const labels = data.map(d => d.label);
      const values = data.map(d => d.value);
      const chartTitle = `Матерная лексика ${periodText}`;
      const url = createBarChartUrl(labels, values, 'Количество', chartTitle);
      await sendPhoto(env, chatId, url);
    } catch (error: any) {
      console.error('profanity chart generation error', {
        chatId,
        period,
        error: error.message || String(error)
      });
      // Chart generation failure is not critical, text chart was already sent
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
