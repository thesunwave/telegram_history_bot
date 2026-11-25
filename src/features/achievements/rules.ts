const DAY = 86400000;
export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + offset * DAY).toISOString().slice(0, 10);
}
export function mondayOf(day: string): string {
  const weekday = new Date(day + 'T00:00:00Z').getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7));
}
export function eligibleDay(now: Date): string {
  return new Date(Math.ceil(now.getTime() / DAY) * DAY).toISOString().slice(0, 10);
}
export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(day);
  return days;
}

export interface Badge { id: string; title: string; description: string }
export interface BadgeProgress { id: string; current: number; target: number; result: string; earned: boolean }

function badge(id: string, title: string, description: string): Badge {
  return { id, title, description };
}

export const GROUP_BADGES = [
  badge('rush-hour', 'Час пик', '30 сообщений за час и новый рекорд последних четырёх недель.'),
  badge('relay-cup', 'Переходящий кубок', 'Три разных единоличных лидера дня за неделю, в каждый из этих дней писали хотя бы трое.'),
  badge('round-table', 'Круглый стол', 'Три дня за неделю с четырьмя авторами или больше и долей лидера до 40%.'),
  badge('podcast', 'Подкастерская', '60 минут голосовых за неделю.'),
  badge('seven-days', 'Без выходных', 'Три разных автора в каждый из семи дней недели.'),
  badge('choir', 'Хор', 'Четыре разных участника прислали голосовые за неделю.'),
];
export const PERSONAL_BADGES = [
  badge('tomorrow', 'До завтра', 'Написать в два дня подряд по UTC.'),
  badge('regular', 'Завсегдатай', 'Писать хотя бы раз в каждую из четырёх полных недель подряд.'),
  badge('calendar', 'Весь календарь', 'Застать все семь дней недели за 42 дня.'),
  badge('columnist', 'Колумнист', 'Написать по 100 слов в три разных дня за 28 дней.'),
  badge('night-shift', 'Ночная смена', 'Написать в 22:00–04:59 UTC в три даты за 28 дней.'),
  badge('three-shifts', 'Три смены', 'Три разных дня и три разных периода UTC за 28 дней: 05–11, 12–16, 17–21 и 22–04.'),
  badge('radio-diary', 'Радиодневник', 'Прислать голосовые в три разных дня за 28 дней.'),
  badge('film', 'Кинохроника', 'Отправить кружочки в три разных дня за семь дней.'),
  badge('dual-air', 'Двойной эфир', 'Отправить и голосовое, и кружочек в каждый из двух дней за 28 дней.'),
  badge('newsstand', 'Киоск прессы', 'Вручную переслать записи минимум из трёх каналов в три разные даты за 28 дней.'),
];

function score(id: string, current: number, target: number, result: string): BadgeProgress {
  return { id, current, target, result, earned: current >= target };
}

export interface PersonalDay {
  day: string; messages: number; words: number; voices: number; videos: number;
}
export interface Bucket { day: string; bucket: string }
export interface ForwardSummary { days: number; channels: number }
export interface GroupDay {
  day: string; authors: number; messages: number; maximum: number;
  leader: number | null; voice_seconds: number; voices: number;
}
export interface Hour { day: string; hour: number; count: number }
export interface WeeklyReport {
  start: string; end: string; messages: number; authors: number; peak: Hour;
  hours: number[]; badges: BadgeProgress[];
}

// Each date contributes at most one distinct bucket. Four possible buckets keep
// the set of reachable combinations bounded at sixteen regardless of the date count.
function distinctShifts(buckets: Bucket[]): number {
  const names = ['night', 'morning', 'noon', 'evening'];
  const byDay = new Map<string, number[]>();
  for (const row of buckets) {
    const index = names.indexOf(row.bucket);
    if (index < 0) continue;
    const bits = byDay.get(row.day) ?? [];
    bits.push(1 << index);
    byDay.set(row.day, bits);
  }
  const reachable = new Set<number>([0]);
  for (const bits of byDay.values()) {
    const previous = [...reachable];
    for (const mask of previous) for (const bit of bits) reachable.add(mask | bit);
  }
  return Math.min(3, Math.max(...[...reachable].map(mask => mask.toString(2).replace(/0/g, '').length)));
}

/** Computes personal progress from verified days already scoped to the enrollment. */
export function personalRules(rows: PersonalDay[], bucketRows: Bucket[], forwards: ForwardSummary,
  start: string, day: string, preview = false): BadgeProgress[] {
  const since = shiftDay(day, -27);
  const lastWeek = shiftDay(day, -6);
  const active = new Set(rows.filter(r => r.messages > 0).map(r => r.day));
  const month = rows.filter(r => r.day >= since);
  const buckets = bucketRows.filter(r => r.day >= since);
  const pair = [...active].sort().find(date => active.has(shiftDay(date, -1)));
  const monday = mondayOf(day);
  const lastMonday = !preview && day === shiftDay(monday, 6) ? monday : shiftDay(monday, -7);
  let weeks = 0;
  for (let week = lastMonday; weeks < 4 && week >= start; week = shiftDay(week, -7)) {
    if (!daysBetween(week, shiftDay(week, 6)).some(date => active.has(date))) break;
    weeks++;
  }
  const dates = new Set([...active].map(date => new Date(date + 'T00:00:00Z').getUTCDay())).size;
  const nights = new Set(buckets.filter(b => b.bucket === 'night').map(b => b.day)).size;
  const shifts = distinctShifts(buckets);
  const words = month.filter(r => r.words >= 100).length;
  const radio = month.filter(r => r.voices > 0).length;
  const film = month.filter(r => r.day >= lastWeek && r.videos > 0).length;
  const dual = month.filter(r => r.voices > 0 && r.videos > 0).length;
  return [
    score('tomorrow', pair ? 2 : Number(active.has(day) || (preview && active.has(shiftDay(day, -1)))),
      2, pair ? shiftDay(pair, -1) + ' — ' + pair : day),
    score('regular', weeks, 4, 'Недель подряд: ' + weeks),
    score('calendar', dates, 7, 'Разных дней недели: ' + dates),
    score('columnist', words, 3, 'Дней со 100 словами: ' + words),
    score('night-shift', nights, 3, 'Ночных дат UTC: ' + nights),
    score('three-shifts', shifts, 3, 'Разных смен: ' + shifts),
    score('radio-diary', radio, 3, 'Дней с голосовыми: ' + radio),
    score('film', film, 3, 'Дней с кружочками: ' + film),
    score('dual-air', dual, 2, 'Дней с обоими форматами: ' + dual),
    score('newsstand', Math.min(forwards.days, forwards.channels), 3,
      'Каналов: ' + forwards.channels + ', дат: ' + forwards.days),
  ];
}

/** Computes group results for exactly one verified week and an optional verified baseline. */
export function weeklyRules(start: string, rows: GroupDay[], hours: Hour[], authors: number,
  voiceAuthors: number, previousPeak: number | null): WeeklyReport {
  const total = rows.reduce((sum, row) => sum + row.messages, 0);
  const peak = [...hours].sort((a, b) => b.count - a.count || a.day.localeCompare(b.day) || a.hour - b.hour)[0]
    ?? { day: start, hour: 0, count: 0 };
  const chart = Array<number>(24).fill(0);
  for (const row of hours) if (row.day === peak.day) chart[row.hour] = row.count;
  const leaders = new Set(rows.filter(r => r.authors >= 3 && r.leader != null).map(r => r.leader)).size;
  const tables = rows.filter(r => r.authors >= 4 && r.maximum * 100 <= r.messages * 40).length;
  const seconds = rows.reduce((sum, r) => sum + r.voice_seconds, 0);
  const voices = rows.reduce((sum, r) => sum + r.voices, 0);
  const full = rows.filter(r => r.authors >= 3).length;
  return {
    start, end: shiftDay(start, 6), messages: total, authors, peak, hours: chart,
    badges: [
      score('rush-hour', previousPeak === null ? 0 : peak.count, Math.max(30, (previousPeak ?? 0) + 1),
        peak.day + ' ' + String(peak.hour).padStart(2, '0') + ':00 UTC · ' + peak.count + ' сообщений, прежний рекорд: ' + (previousPeak ?? '—')),
      score('relay-cup', leaders, 3, 'Разных лидеров: ' + leaders),
      score('round-table', tables, 3, 'Дней за круглым столом: ' + tables),
      score('podcast', seconds, 3600, Math.floor(seconds / 60) + ' мин ' + (seconds % 60) + ' с, записей: ' + voices),
      score('seven-days', full, 7, 'Дней с тремя авторами: ' + full),
      score('choir', voiceAuthors, 4, 'Разных голосов: ' + voiceAuthors),
    ],
  };
}
