import type { AchievementProgress } from './progress';

type Language = 'ru' | 'en';
type Unit = AchievementProgress['conditions'][number]['unit'];

const UNITS: Record<Exclude<Unit, 'seconds'>, readonly [string, string, string, string, string]> = {
  day: ['день', 'дня', 'дней', 'day', 'days'],
  week: ['неделя', 'недели', 'недель', 'week', 'weeks'],
  weekday: ['день недели', 'дня недели', 'дней недели', 'day of the week', 'days of the week'],
  shift: ['смена', 'смены', 'смен', 'time slot', 'time slots'],
  channel: ['канал', 'канала', 'каналов', 'channel', 'channels'],
  message: ['сообщение', 'сообщения', 'сообщений', 'message', 'messages'],
  participant: ['участник', 'участника', 'участников', 'participant', 'participants'],
  leader: ['лидер', 'лидера', 'лидеров', 'leader', 'leaders'],
  reply: ['ответ', 'ответа', 'ответов', 'reply', 'replies'],
};
const MULTIPLE_LABELS = { channel: ['Каналы', 'Channels'], day: ['Даты', 'Dates'] } as const;
const RU_PLURALS = new Intl.PluralRules('ru');
const NUMBERS = { ru: new Intl.NumberFormat('ru'), en: new Intl.NumberFormat('en') };

function clock(seconds: number): string {
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}

function duration(seconds: number, language: Language): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts = [];
  if (minutes) parts.push(minutes + (language === 'ru' ? ' мин' : ' min'));
  if (rest) parts.push(rest + (language === 'ru' ? ' с' : ' s'));
  return parts.join(' ');
}

function quantity(count: number, unit: Unit, language: Language): string {
  if (unit === 'seconds') return duration(count, language);
  const form = RU_PLURALS.select(count);
  const index = language === 'en' ? count === 1 ? 3 : 4 : form === 'one' ? 0 : form === 'few' ? 1 : 2;
  return NUMBERS[language].format(count) + ' ' + UNITS[unit][index];
}

/** Localize counts and their evidence status identically on the web and in the bot. */
export function progressCopy(progress: AchievementProgress, language: Language = 'ru') {
  const ru = language === 'ru';
  const rows = progress.conditions.map(({ unit, current, target, remaining }) => {
    const labels = MULTIPLE_LABELS[unit as keyof typeof MULTIPLE_LABELS];
    const label = progress.conditions.length > 1 && labels ? labels[ru ? 0 : 1] : '';
    const format = unit === 'seconds' ? clock : (value: number) => NUMBERS[language].format(value);
    return {
      label,
      counter: format(Math.min(current, target)) + ' / ' + format(target),
      remaining: remaining ? (ru ? 'До цели — ' : 'Left — ') + quantity(remaining, unit, language)
        : progress.conditions.length > 1 ? (ru ? 'Выполнено' : 'Complete') : '',
    };
  });
  const notes = [];
  if (progress.pendingAward) notes.push(ru ? 'Условия выполнены · ждём подтверждения' : 'Goal reached · awaiting confirmation');
  if (progress.activeThisWeek) notes.push(ru ? 'На этой неделе активность уже есть' : 'Activity recorded this week');
  switch (progress.status) {
    case 'provisional': notes.push(ru ? 'Предварительно · по UTC' : 'Provisional · UTC'); break;
    case 'confirmed':
      if (progress.day) notes.push((ru ? 'Подтверждено по ' : 'Confirmed through ') + progress.day + ' UTC');
      break;
    case 'scheduled': notes.push((ru ? 'Учёт с ' : 'Tracking starts ') + progress.day + ' UTC'); break;
    case 'baseline': notes.push(ru ? 'Ждём данные о рекорде' : 'Waiting for the previous record'); break;
    case 'waiting': notes.push(ru ? 'Ждём данные' : 'Waiting for data'); break;
  }
  return { rows, notes };
}

export function telegramProgress(progress?: AchievementProgress): string[] {
  if (!progress) return [];
  const { rows, notes } = progressCopy(progress);
  return [...rows.map(({ label, counter, remaining }) => [label, counter, remaining].filter(Boolean).join(' · ')), ...notes];
}
