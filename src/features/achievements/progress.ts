import type { Env } from '../../core/env';
import { Logger } from '../../core/logger';
import { mondayOf } from './calendar';
import { readPersonalEvidence, readWeeklyProgress } from './evaluate';
import type { Enrollment, GroupState } from './repository';
import { DAILY_PERSONAL_BADGES, GROUP_BADGES, personalRules, type BadgeProgress, type ForwardSummary } from './rules';
import { getConversationProgress } from './social';
import { CONVERSATION_BADGES } from './social-score';

const BADGE_UNITS = {
  'rush-hour': 'message', 'relay-cup': 'leader', 'round-table': 'day', podcast: 'seconds',
  'seven-days': 'day', choir: 'participant', tomorrow: 'day', regular: 'week', calendar: 'weekday',
  columnist: 'day', 'night-shift': 'day', 'three-shifts': 'shift', 'radio-diary': 'day', film: 'day',
  'dual-air': 'day', newsstand: 'day', 'ping-pong': 'message', spark: 'participant',
  connector: 'participant', 'to-be-continued': 'reply',
} as const;
type Unit = typeof BADGE_UNITS[keyof typeof BADGE_UNITS] | 'channel';
type Status = 'provisional' | 'confirmed' | 'live' | 'scheduled' | 'waiting' | 'baseline';
interface Condition { unit: Unit; current: number; target: number; remaining: number }
export interface AchievementProgress {
  status: Status;
  day?: string;
  conditions: Condition[];
  pendingAward: boolean;
  thisWeekActivity?: 'eligible' | 'partial';
}
export type CollectionProgress = Record<string, AchievementProgress>;

function empty(status: Status, day?: string): AchievementProgress {
  return { status, day, conditions: [], pendingAward: false };
}

function unavailable(badges: readonly { id: string }[], status: Status, day?: string): CollectionProgress {
  return Object.fromEntries(badges.map(({ id }) => [id, empty(status, day)]));
}

function condition(unit: Unit, current: number, target: number): Condition {
  return { unit, current, target, remaining: Math.max(0, target - current) };
}

function present(score: BadgeProgress, status: Status, day?: string, forwards?: ForwardSummary): AchievementProgress {
  const unit = BADGE_UNITS[score.id as keyof typeof BADGE_UNITS];
  const conditions = score.id === 'newsstand' && forwards
    ? [condition('channel', forwards.channels, score.target), condition('day', forwards.days, score.target)]
    : [condition(unit, score.current, score.target)];
  return { status, day, conditions, pendingAward: conditions.every(row => row.remaining === 0) };
}

/** Group progress uses the currently eligible UTC week and its confirmed prefix. */
export async function groupProgress(env: Env, chat: number, group: GroupState | null, now = new Date()): Promise<CollectionProgress> {
  if (!group?.enabled) return {};
  const today = now.toISOString().slice(0, 10);
  if (mondayOf(today) < group.start_day) return unavailable(GROUP_BADGES, 'scheduled', group.start_day);
  try {
    const { throughDay, baselineKnown, scores } = await readWeeklyProgress(env, chat, group.start_day, today);
    const result = unavailable(GROUP_BADGES, 'waiting');
    if (throughDay) {
      for (const score of scores) result[score.id] = present(score, throughDay === today ? 'provisional' : 'confirmed', throughDay);
    }
    if (!baselineKnown) result['rush-hour'] = empty('baseline');
    return result;
  } catch {
    Logger.warn('Could not read weekly achievement progress');
    return unavailable(GROUP_BADGES, 'waiting');
  }
}

function savedPersonalProgress(album: Enrollment): CollectionProgress {
  const result = unavailable(DAILY_PERSONAL_BADGES, 'waiting');
  const scores = JSON.parse(album.progress_json) as BadgeProgress[];
  for (const score of scores) {
    if (!Object.hasOwn(result, score.id)) continue;
    // Existing snapshots recorded both forward counts in the result line.
    const match = score.id === 'newsstand' && /^Каналов: (\d+), дат: (\d+)$/.exec(score.result);
    if (score.id === 'newsstand' && !match) continue;
    const forwards = match ? { channels: Number(match[1]), days: Number(match[2]) } : undefined;
    result[score.id] = present(score, 'confirmed', album.last_day ?? undefined, forwards);
  }
  return result;
}

/** Read the owner's active album, falling back to the saved evaluation if today is unverified. */
export async function personalProgress(env: Env, chat: number, owner: number, group: GroupState | null,
  album: Enrollment | null, now = new Date()): Promise<CollectionProgress> {
  if (!group?.enabled || !album?.enabled) return {};
  const today = now.toISOString().slice(0, 10);
  if (today < album.start_day) return unavailable(DAILY_PERSONAL_BADGES, 'scheduled', album.start_day);
  const saved = savedPersonalProgress(album);
  try {
    const { dayVerified, rows, buckets, forwards } = await readPersonalEvidence(env, chat, owner, album.start_day, today, true);
    if (dayVerified) {
      const scores = personalRules(rows, buckets, forwards, album.start_day, today, true);
      const result = Object.fromEntries(scores.map(score => [score.id, present(score, 'provisional', today, forwards)]));
      const monday = mondayOf(today);
      if (rows.some(row => row.day >= monday && row.messages > 0)) {
        result.regular.thisWeekActivity = monday >= album.start_day ? 'eligible' : 'partial';
      }
      return result;
    }
    if (forwards) {
      const score = personalRules([], [], forwards, album.start_day, today, true).find(row => row.id === 'newsstand');
      if (score) saved.newsstand = present(score, 'provisional', today, forwards);
    }
  } catch {
    Logger.warn('Could not read live personal achievement progress');
  }
  return saved;
}

/** Conversation scores use already-verified replies. The caller must verify consent. */
export async function conversationProgress(env: Env, chat: number, owner: number): Promise<CollectionProgress> {
  try {
    const scores = await getConversationProgress(env.DB, chat, owner);
    return Object.fromEntries(scores.map(score => [score.id, present(score, 'live')]));
  } catch {
    Logger.warn('Could not read conversation achievement progress');
    return unavailable(CONVERSATION_BADGES, 'waiting');
  }
}
