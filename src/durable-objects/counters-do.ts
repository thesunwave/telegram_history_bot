import type { DurableObjectState } from '@cloudflare/workers-types';
import { Env } from '../core/env';
import { Logger } from '../core/logger';
import { normalizeProfanityWord } from '../features/profanity/local-detector';
import {
  logD1AggregateWriteError,
  writeActivityAggregates,
  writeCategoryProgressResolve,
  writeCriminalAggregates,
  writeProfanityAggregates,
} from '../features/stats/d1-aggregate-writer';
import {
  applyCompletion,
  applyFailure,
  armIntegrityAttempt,
  computeProgressCounts,
  confirmIntegrityAttempt,
  emptyIntegrityState,
  emptyProgressState,
  failIntegrityAttempt,
  isIntegrityClean,
  PIPELINE_PROOF_VERSION,
  PROGRESS_CATEGORIES,
  recoverAmbiguousIntegrityAttempt,
  type CountersDOPipelineSnapshot,
  type CountersDOPipelineSnapshots,
  type CountersDODayProofSnapshot,
  type DurableDayProofMarker,
  type IntegrityState,
  type ProgressCategory,
  type ProgressOutcome,
  type ProgressState,
} from '../features/stats/pipeline-progress';

const STATS_PREFIX = 'stats';
const USER_PREFIX = 'user';
const ACTIVITY_PREFIX = 'activity';
const ACTIVITY_HOUR_PREFIX = 'activity_hour';
const ACTIVITY_TIME_BUCKET_PREFIX = 'activity_time_bucket';
const WORD_STATS_PREFIX = 'word_stats';
const WORD_ACTIVITY_PREFIX = 'word_activity';
const LAST_MESSAGE_PREFIX = 'last_message';
const PROFANITY_USER_PREFIX = 'profanity';
const PROFANITY_WORDS_PREFIX = 'profanity_words';
const PROFANITY_WORD_USERS_PREFIX = 'profanity_word_users';
const CRIMINAL_USER_PREFIX = 'criminal';
const CRIMINAL_ARTICLE_PREFIX = 'criminal_article';
const CRIMINAL_SEVERITY_PREFIX = 'criminal_severity';

function safeErrorClass(error: unknown): 'Error' | 'ThrownString' | 'UnknownError' {
  if (error instanceof Error) return 'Error';
  if (typeof error === 'string') return 'ThrownString';
  return 'UnknownError';
}

function logCounterOperationError(operation: string, error: unknown): void {
  console.error('counter operation error', {
    operation,
    errorClass: safeErrorClass(error),
    errorCode: 'COUNTER_OPERATION_FAILED',
  });
}

/**
 * Signals an aggregate-write failure upward from the sequence-bearing async
 * paths (/profanity, /criminal, /ack) so the route can surface it as a non-2xx
 * response. The D1 error was already logged at the source with a privacy-safe
 * shape; the rethrow only carries a fixed generic marker that never contains
 * D1/SQL details.
 */
class AggregateWriteFailure extends Error {
  constructor() {
    super('d1 aggregate write failed');
    this.name = 'AggregateWriteFailure';
  }
}

function getTimeBucket(hour: number): 'night' | 'morning' | 'noon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'noon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

export interface IncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
  /** Telegram message id; required for idempotent retries and sequence mapping. */
  messageId?: number;
  hour?: number;
  wordCount?: number;
  voiceCount?: number;
  voiceDurationSeconds?: number;
  videoNoteCount?: number;
  videoNoteDurationSeconds?: number;
  ts?: number;
}

export interface ProfanityIncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
  count: number;
  words: Array<{
    word?: string;
    baseForm?: string;
    count: number;
  }>;
  /** Day-local sequence + message identity for progress acknowledgement. */
  sequence?: number;
  messageId?: number;
}

export interface CriminalIncrementPayload {
  chatId: number;
  userId: number;
  username: string;
  day: string;
  violations: Array<{
    article: string;
    severity: number;
    count: number;
  }>;
  totalSeverity: number;
  /** Day-local sequence + message identity for progress acknowledgement. */
  sequence?: number;
  messageId?: number;
}

/** Payload for the `/ack` progress-only endpoint (zero/skipped/failed branches). */
export interface ProgressAckPayload {
  chatId: number;
  day: string;
  category: ProgressCategory;
  messageId?: number;
  sequence?: number;
  outcome: ProgressOutcome;
}

interface BatchIncrementPayload {
  activity?: IncrementPayload[];
  profanity?: ProfanityIncrementPayload[];
  criminal?: CriminalIncrementPayload[];
}

export class CountersDO {
  constructor(private state: DurableObjectState, private env: Env) { }

  // ---------------------------------------------------------------------------
  // Durable storage helpers (fall back to an in-memory map when `storage` is
  // absent, e.g. lightweight test doubles that only stub blockConcurrencyWhile).
  // ---------------------------------------------------------------------------

  private memoryStorage: Map<string, unknown> | null = null;

  private storage(): { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> } {
    const durable = (this.state as unknown as {
      storage?: {
        get?: <T>(key: string) => Promise<T | undefined>;
        put?: (key: string, value: unknown) => Promise<void>;
      };
    }).storage;
    if (durable && typeof durable.get === 'function' && typeof durable.put === 'function') {
      return durable as { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> };
    }
    if (!this.memoryStorage) this.memoryStorage = new Map();
    const map = this.memoryStorage;
    return {
      get: async <T>(key: string): Promise<T | undefined> => map.get(key) as T | undefined,
      put: async (key: string, value: unknown): Promise<void> => {
        map.set(key, value);
      },
    };
  }

  private async storageGetNumber(key: string): Promise<number> {
    const value = await this.storage().get<number>(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private async storageGetNumberArray(key: string): Promise<number[]> {
    const value = await this.storage().get<number[]>(key);
    return Array.isArray(value)
      ? value.filter((n) => typeof n === 'number' && Number.isFinite(n))
      : [];
  }

  // ---------------------------------------------------------------------------
  // Day-local monotonic sequence allocation (serialized by blockConcurrencyWhile)
  // ---------------------------------------------------------------------------

  private seqKey(day: string): string {
    return `seq:${day}`;
  }

  private msgSeqKey(day: string, messageId: number): string {
    return `msgseq:${day}:${messageId}`;
  }

  private progressStateKey(day: string, category: ProgressCategory): string {
    return `progress:${day}:${category}`;
  }

  private integrityStateKey(day: string, category: ProgressCategory): string {
    return `integrity:${day}:${category}`;
  }

  private profanityDoneKey(day: string, messageId: number): string {
    return `profDone:${day}:${messageId}`;
  }

  private criminalDoneKey(day: string, messageId: number): string {
    return `crimDone:${day}:${messageId}`;
  }

  private async loadProgressState(day: string, category: ProgressCategory): Promise<ProgressState> {
    const raw = await this.storage().get<ProgressState>(this.progressStateKey(day, category));
    if (raw && typeof raw === 'object' && typeof raw.completedPrefix === 'number') {
      return {
        completedPrefix: raw.completedPrefix,
        gaps: Array.isArray(raw.gaps) ? raw.gaps : [],
        failed: Array.isArray(raw.failed) ? raw.failed : [],
      };
    }
    return emptyProgressState();
  }

  private async saveProgressState(day: string, category: ProgressCategory, state: ProgressState): Promise<void> {
    await this.storage().put(this.progressStateKey(day, category), state);
  }

  private isSequenceAlreadyResolved(state: ProgressState, sequence: number): boolean {
    if (sequence <= state.completedPrefix) return true;
    if (state.gaps.includes(sequence)) return true;
    if (state.failed.includes(sequence)) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // D1 write integrity state (sticky per chat/day/category poison)
  // ---------------------------------------------------------------------------

  private async loadIntegrityState(day: string, category: ProgressCategory): Promise<IntegrityState> {
    const raw = await this.storage().get<Partial<IntegrityState>>(this.integrityStateKey(day, category));
    if (!raw || typeof raw !== 'object') return emptyIntegrityState();
    const active = typeof raw.activeAttemptSeq === 'number' && Number.isFinite(raw.activeAttemptSeq)
      ? raw.activeAttemptSeq
      : null;
    const poisoned = raw.poisoned === true;
    const firstPoisonedSeq =
      typeof raw.firstPoisonedSeq === 'number' && Number.isFinite(raw.firstPoisonedSeq)
        ? raw.firstPoisonedSeq
        : null;
    const reason =
      raw.reason === 'd1_write_failed' || raw.reason === 'ambiguous_attempt' ? raw.reason : null;
    return { activeAttemptSeq: active, poisoned, firstPoisonedSeq, reason };
  }

  private async saveIntegrityState(day: string, category: ProgressCategory, state: IntegrityState): Promise<void> {
    await this.storage().put(this.integrityStateKey(day, category), state);
  }

  // ---------------------------------------------------------------------------
  // Day proof marker (versioned, explicit provenance)
  // ---------------------------------------------------------------------------

  private dayProofKey(day: string): string {
    return `dayproof:${day}`;
  }

  /**
   * Reads the durable proof marker for a day. A stored marker is only proven
   * when it carries the current fixed version and `initialized: true`; a
   * missing, malformed, or wrong-version marker never qualifies exactness.
   */
  private async loadDayProofMarker(day: string): Promise<DurableDayProofMarker | null> {
    const raw = await this.storage().get<Partial<DurableDayProofMarker>>(this.dayProofKey(day));
    if (!raw || typeof raw !== 'object' || typeof raw.version !== 'number') return null;
    return {
      version: raw.version,
      initialized: raw.initialized === true,
    };
  }

  /**
   * Persists the day proof marker for a newly allocated base sequence BEFORE
   * any D1 integrity arm or batch work. Never erases or downgrades an existing
   * marker; a day without a marker stays unproven.
   */
  private async ensureDayProofMarker(day: string): Promise<void> {
    const existing = await this.loadDayProofMarker(day);
    if (existing && existing.version === PIPELINE_PROOF_VERSION && existing.initialized) {
      return;
    }
    await this.storage().put(this.dayProofKey(day), {
      version: PIPELINE_PROOF_VERSION,
      initialized: true,
    } satisfies DurableDayProofMarker);
  }

  /**
   * Recovers any stale active attempt (a prior request that armed but never
   * confirmed) as sticky ambiguous poison and persists the recovery before new
   * work, so a clean state can never silently follow an unknown outcome.
   */
  private async recoverAndPersistIntegrityState(day: string, category: ProgressCategory): Promise<IntegrityState> {
    const state = await this.loadIntegrityState(day, category);
    const recovered = recoverAmbiguousIntegrityAttempt(state);
    if (recovered !== state) {
      await this.saveIntegrityState(day, category, recovered);
    }
    return recovered;
  }

  /**
   * Arms the base D1 batch integrity attempt for all three category streams at
   * the allocated sequence and persists every armed state before the D1 call.
   * A single base batch mutates D1 progress for all categories, so it is one
   * all-category attempt: any later failure poisons every stream.
   */
  private async armBaseIntegrityAttempt(day: string, sequence: number): Promise<void> {
    for (const category of PROGRESS_CATEGORIES) {
      const state = await this.recoverAndPersistIntegrityState(day, category);
      await this.saveIntegrityState(day, category, armIntegrityAttempt(state, sequence));
    }
  }

  /** Confirms the resolved base batch for every category and persists cleared markers. */
  private async confirmBaseIntegrityAttempt(day: string, sequence: number): Promise<void> {
    for (const category of PROGRESS_CATEGORIES) {
      await this.confirmCategoryIntegrityAttempt(day, category, sequence);
    }
  }

  /** Marks the failed base batch for every category and persists the sticky poison. */
  private async failBaseIntegrityAttempt(day: string, sequence: number): Promise<void> {
    for (const category of PROGRESS_CATEGORIES) {
      await this.failCategoryIntegrityAttempt(day, category, sequence);
    }
  }

  /**
   * Arms one category's D1 attempt at `sequence` and persists it before the D1
   * call. Never arms for sequence-less legacy category calls.
   */
  private async armCategoryIntegrityAttempt(
    day: string,
    category: ProgressCategory,
    sequence: number,
  ): Promise<void> {
    const state = await this.recoverAndPersistIntegrityState(day, category);
    await this.saveIntegrityState(day, category, armIntegrityAttempt(state, sequence));
  }

  /** Confirms one category's matching armed attempt and persists the cleared marker. */
  private async confirmCategoryIntegrityAttempt(
    day: string,
    category: ProgressCategory,
    sequence: number,
  ): Promise<void> {
    const state = await this.loadIntegrityState(day, category);
    await this.saveIntegrityState(day, category, confirmIntegrityAttempt(state, sequence));
  }

  /** Marks one category's matching armed attempt failed and persists the sticky poison. */
  private async failCategoryIntegrityAttempt(
    day: string,
    category: ProgressCategory,
    sequence: number,
  ): Promise<void> {
    const state = await this.loadIntegrityState(day, category);
    await this.saveIntegrityState(day, category, failIntegrityAttempt(state, sequence));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST')
      return new Response('Method not allowed', { status: 405 });

    const url = new URL(request.url);
    const endpoint = url.pathname;

    if (endpoint === '/inc') {
      let payload: IncrementPayload;
      try {
        payload = (await request.json()) as IncrementPayload;
        this.validate(payload);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        const result = await this.state.blockConcurrencyWhile(() => this.incrementCounters(payload));
        return new Response(JSON.stringify({ ok: true, ...result }), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err: unknown) {
        logCounterOperationError('increment', err);
        return new Response('error', { status: 500 });
      }
    } else if (endpoint === '/profanity') {
      let payload: ProfanityIncrementPayload;
      try {
        payload = (await request.json()) as ProfanityIncrementPayload;
        this.validateProfanity(payload);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        await this.state.blockConcurrencyWhile(() => this.incrementProfanityCounters(payload));
      } catch (err: unknown) {
        logCounterOperationError('profanity', err);
        return new Response('error', { status: 500 });
      }
      return new Response('ok');
    } else if (endpoint === '/criminal') {
      let payload: CriminalIncrementPayload;
      try {
        payload = (await request.json()) as CriminalIncrementPayload;
        this.validateCriminal(payload);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        await this.state.blockConcurrencyWhile(() => this.incrementCriminalCounters(payload));
      } catch (err: unknown) {
        logCounterOperationError('criminal', err);
        return new Response('error', { status: 500 });
      }
      return new Response('ok');
    } else if (endpoint === '/ack') {
      let payload: ProgressAckPayload;
      try {
        payload = (await request.json()) as ProgressAckPayload;
        this.validateAck(payload);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        await this.state.blockConcurrencyWhile(() => this.ackProgress(payload));
      } catch (err: unknown) {
        logCounterOperationError('ack', err);
        return new Response('error', { status: 500 });
      }
      return new Response('ok');
    } else if (endpoint === '/pipeline-snapshot') {
      let day: string;
      try {
        day = String((await request.json() as { day?: unknown }).day ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          return new Response('Bad request', { status: 400 });
        }
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        const snapshot = await this.state.blockConcurrencyWhile(() => this.pipelineSnapshot(day));
        return new Response(JSON.stringify(snapshot), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err: unknown) {
        logCounterOperationError('pipeline-snapshot', err);
        return new Response('error', { status: 500 });
      }
    } else if (endpoint === '/pipeline-snapshots') {
      let days: string[];
      try {
        const rawDays = (await request.json() as { days?: unknown }).days;
        days = this.parsePipelineSnapshotDays(rawDays);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      try {
        const snapshots = await this.state.blockConcurrencyWhile(() => this.pipelineSnapshots(days));
        return new Response(JSON.stringify(snapshots), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (err: unknown) {
        logCounterOperationError('pipeline-snapshots', err);
        return new Response('error', { status: 500 });
      }
    } else if (endpoint === '/batch') {
      return await this.processBatchRequest(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private validate(p: IncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day)
      throw new Error('invalid payload');
    if (p.wordCount !== undefined && (!Number.isInteger(p.wordCount) || p.wordCount < 0))
      throw new Error('invalid word count');
    if (p.ts !== undefined && (!Number.isInteger(p.ts) || p.ts < 0))
      throw new Error('invalid timestamp');
    for (const value of [p.voiceCount, p.voiceDurationSeconds, p.videoNoteCount, p.videoNoteDurationSeconds]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0))
        throw new Error('invalid media metric');
    }
  }

  private validateProfanity(p: ProfanityIncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day || p.count == null || !Array.isArray(p.words))
      throw new Error('invalid profanity payload');
    if (!Number.isInteger(p.count) || p.count <= 0)
      throw new Error('invalid profanity count');

    let wordCountTotal = 0;
    for (const word of p.words) {
      const normalizedWord = this.normalizeProfanityCounterWord(word);
      if (!normalizedWord)
        throw new Error('invalid profanity word');
      if (!Number.isInteger(word.count) || word.count <= 0)
        throw new Error('invalid profanity word count');
      wordCountTotal += word.count;
    }
    if (wordCountTotal !== p.count)
      throw new Error('profanity count mismatch');
  }

  private validateCriminal(p: CriminalIncrementPayload) {
    if (p.chatId == null || p.userId == null || !p.day || !Array.isArray(p.violations) || p.totalSeverity == null)
      throw new Error('invalid criminal payload');
  }

  private validateAck(p: ProgressAckPayload) {
    if (p.chatId == null || !p.day || p.category == null || p.outcome == null)
      throw new Error('invalid ack payload');
    if (!['base', 'profanity', 'criminal'].includes(p.category))
      throw new Error('invalid ack category');
    if (!['completed', 'zero', 'skipped', 'failed'].includes(p.outcome))
      throw new Error('invalid ack outcome');
  }

  /**
   * Validates and normalizes the `/pipeline-snapshots` request body: a
   * nonempty array of at most 30 strict YYYY-MM-DD strings, deduplicated while
   * preserving request order. Throws on any invalid shape so the caller returns
   * 400.
   */
  private parsePipelineSnapshotDays(rawDays: unknown): string[] {
    if (!Array.isArray(rawDays) || rawDays.length === 0) {
      throw new Error('invalid days');
    }
    if (rawDays.length > 30) {
      throw new Error('too many days');
    }
    const seen = new Set<string>();
    const days: string[] = [];
    for (const raw of rawDays) {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        throw new Error('invalid day');
      }
      if (!seen.has(raw)) {
        seen.add(raw);
        days.push(raw);
      }
    }
    return days;
  }

  private async incrementCounters({
    chatId,
    userId,
    username,
    day,
    messageId,
    hour,
    wordCount = 0,
    voiceCount = 0,
    voiceDurationSeconds = 0,
    videoNoteCount = 0,
    videoNoteDurationSeconds = 0,
    ts,
  }: IncrementPayload): Promise<{
    userDayCount: number;
    chatDayActivity: number;
    userDayWordCount: number;
    chatDayWords: number;
    day: string;
    sequence: number;
  }> {
    // Day-local monotonic sequence + idempotent retry mapping. A retried
    // (chat, day, messageId) returns its previously allocated sequence and
    // never re-applies KV/D1 mutations (no double accepted count).
    const hasMessageId = Number.isInteger(messageId) && (messageId as number) > 0;
    let sequence: number;
    if (hasMessageId) {
      const existing = await this.storage().get<number>(this.msgSeqKey(day, messageId as number));
      if (typeof existing === 'number' && Number.isFinite(existing) && existing > 0) {
        // Duplicate: read-only reconstruction of the current counters, no writes.
        const statsKey = `${STATS_PREFIX}:${chatId}:${userId}:${day}`;
        const count = parseInt((await this.env.COUNTERS.get(statsKey)) || '0', 10);
        const wordStatsKey = `${WORD_STATS_PREFIX}:${chatId}:${userId}:${day}`;
        const userDayWordCount = parseInt((await this.env.COUNTERS.get(wordStatsKey)) || '0', 10);
        const activityKey = `${ACTIVITY_PREFIX}:${chatId}:${day}`;
        const actCnt = parseInt((await this.env.COUNTERS.get(activityKey)) || '0', 10);
        const wordActivityKey = `${WORD_ACTIVITY_PREFIX}:${chatId}:${day}`;
        const chatDayWords = parseInt((await this.env.COUNTERS.get(wordActivityKey)) || '0', 10);
        return {
          userDayCount: count,
          chatDayActivity: actCnt,
          userDayWordCount,
          chatDayWords,
          day,
          sequence: existing,
        };
      }
    }

    const currentSeq = await this.storageGetNumber(this.seqKey(day));
    sequence = currentSeq + 1;
    // Integrity fence: arm and persist the all-category base D1 attempt BEFORE
    // any acceptance becomes durable (sequence, message->sequence map, proof
    // marker, KV counters, D1 work). A crash after arm but before acceptance
    // leaves an active attempt that the next invocation recovers as sticky
    // ambiguous poison, so a later sequence can never make a missing aggregate
    // look exact.
    if (this.env.DB) {
      await this.armBaseIntegrityAttempt(day, sequence);
    }
    await this.storage().put(this.seqKey(day), sequence);
    // Day proof marker: persisted with the newly allocated base sequence
    // (after the integrity arm, before any D1 batch work), so even a D1 failure
    // leaves durable provenance that this day is live-owned by base acceptance.
    await this.ensureDayProofMarker(day);
    if (hasMessageId) {
      await this.storage().put(this.msgSeqKey(day, messageId as number), sequence);
    }

    const statsKey = `${STATS_PREFIX}:${chatId}:${userId}:${day}`;
    const count = parseInt((await this.env.COUNTERS.get(statsKey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(statsKey, String(count));

    // New optimized key format: stats_v2:chatId:day:userId
    // This allows listing all users for a specific day efficiently
    const statsV2Key = `stats_v2:${chatId}:${day}:${userId}`;
    await this.env.COUNTERS.put(statsV2Key, String(count));

    const wordStatsKey = `${WORD_STATS_PREFIX}:${chatId}:${userId}:${day}`;
    const userDayWordCount =
      parseInt((await this.env.COUNTERS.get(wordStatsKey)) || '0', 10) + wordCount;
    await this.env.COUNTERS.put(wordStatsKey, String(userDayWordCount));

    const wordStatsV2Key = `${WORD_STATS_PREFIX}_v2:${chatId}:${day}:${userId}`;
    await this.env.COUNTERS.put(wordStatsV2Key, String(userDayWordCount));

    await this.incrementMediaMetric(chatId, day, userId, 'voice', voiceCount, voiceDurationSeconds);
    await this.incrementMediaMetric(chatId, day, userId, 'video_note', videoNoteCount, videoNoteDurationSeconds);

    await this.env.COUNTERS.put(`${USER_PREFIX}:${userId}`, username);

    const activityKey = `${ACTIVITY_PREFIX}:${chatId}:${day}`;
    const actCnt = parseInt((await this.env.COUNTERS.get(activityKey)) || '0', 10) + 1;
    await this.env.COUNTERS.put(activityKey, String(actCnt));

    const wordActivityKey = `${WORD_ACTIVITY_PREFIX}:${chatId}:${day}`;
    const chatDayWords =
      parseInt((await this.env.COUNTERS.get(wordActivityKey)) || '0', 10) + wordCount;
    await this.env.COUNTERS.put(wordActivityKey, String(chatDayWords));

    if (hour !== undefined && Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      const activityHourKey = `${ACTIVITY_HOUR_PREFIX}:${chatId}:${day}:${hour.toString().padStart(2, '0')}`;
      const hourCnt = parseInt((await this.env.COUNTERS.get(activityHourKey)) || '0', 10) + 1;
      await this.env.COUNTERS.put(activityHourKey, String(hourCnt));

      const bucket = getTimeBucket(hour);
      const timeBucketKey = `${ACTIVITY_TIME_BUCKET_PREFIX}:${chatId}:${day}:${bucket}:${userId}`;
      const bucketCnt = parseInt((await this.env.COUNTERS.get(timeBucketKey)) || '0', 10) + 1;
      await this.env.COUNTERS.put(timeBucketKey, String(bucketCnt));
    }

    if (ts !== undefined) {
      const lastMessageKey = `${LAST_MESSAGE_PREFIX}:${chatId}:${userId}`;
      const previousTs = parseInt((await this.env.COUNTERS.get(lastMessageKey)) || '0', 10);
      if (ts > previousTs) {
        await this.env.COUNTERS.put(lastMessageKey, String(ts));
      }
    }

    if (this.env.DB) {
      try {
        // One D1 batch total for a normal base message (aggregates + legacy
        // activity upsert share a single transaction). The all-category base
        // attempt was already armed and persisted before the sequence write.
        const validHourForD1 =
          hour !== undefined && Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : undefined;
        await writeActivityAggregates(this.env.DB, {
          chatId,
          userId,
          username,
          day,
          hour: validHourForD1,
          bucket: validHourForD1 !== undefined ? getTimeBucket(validHourForD1) : undefined,
          wordCount,
          voiceCount,
          voiceDurationSeconds,
          videoNoteCount,
          videoNoteDurationSeconds,
          ts,
          sequence,
          completedThroughTs: ts,
        });
        await this.confirmBaseIntegrityAttempt(day, sequence);
      } catch (e: unknown) {
        await this.failBaseIntegrityAttempt(day, sequence);
        logD1AggregateWriteError('activity', chatId, e);
      }
    }

    return {
      userDayCount: count,
      chatDayActivity: actCnt,
      userDayWordCount,
      chatDayWords,
      day,
      sequence,
    };
  }

  private async incrementMediaMetric(
    chatId: number,
    day: string,
    userId: number,
    type: 'voice' | 'video_note',
    countDelta: number,
    durationDelta: number,
  ) {
    if (countDelta <= 0 && durationDelta <= 0) return;

    const countKey = `media_stats_v2:${chatId}:${day}:${userId}:${type}`;
    const nextCount = parseInt((await this.env.COUNTERS.get(countKey)) || '0', 10) + countDelta;
    await this.env.COUNTERS.put(countKey, String(nextCount));

    const durationKey = `media_duration_v2:${chatId}:${day}:${userId}:${type}`;
    const nextDuration =
      parseInt((await this.env.COUNTERS.get(durationKey)) || '0', 10) + durationDelta;
    await this.env.COUNTERS.put(durationKey, String(nextDuration));
  }

  private async incrementProfanityCounters(payload: ProfanityIncrementPayload) {
    const { chatId, userId, username, day, count, sequence, messageId } = payload;
    // Per-category idempotency: duplicate messageId for same chat/day returns without double count.
    const hasMessageId = Number.isInteger(messageId) && (messageId as number) > 0;
    if (hasMessageId) {
      const done = await this.storage().get<number>(this.profanityDoneKey(day, messageId as number));
      if (typeof done === 'number' && Number.isFinite(done)) {
        return;
      }
    }
    const words = this.aggregateProfanityCounterWords(payload.words);

    Logger.debug(this.env, 'Profanity counters update', {
      totalCount: count,
      uniqueWords: words.length,
    });

    const profanityUserKey = `${PROFANITY_USER_PREFIX}:${chatId}:${userId}:${day}`;

    // Update user profanity count in KV
    const currentUserCount = parseInt((await this.env.COUNTERS.get(profanityUserKey)) || '0', 10);
    await this.env.COUNTERS.put(profanityUserKey, String(currentUserCount + count));
    await this.env.COUNTERS.put(`${USER_PREFIX}:${userId}`, username);

    // Update word-specific counts in KV
    for (const word of words) {
      const wordKey = `${PROFANITY_WORDS_PREFIX}:${chatId}:${word.word}:${day}`;
      const currentWordCount = parseInt((await this.env.COUNTERS.get(wordKey)) || '0', 10);
      await this.env.COUNTERS.put(wordKey, String(currentWordCount + word.count));

      const wordUserKey = `${PROFANITY_WORD_USERS_PREFIX}:${chatId}:${word.word}:${day}:${userId}`;
      const currentWordUserCount = parseInt((await this.env.COUNTERS.get(wordUserKey)) || '0', 10);
      await this.env.COUNTERS.put(wordUserKey, String(currentWordUserCount + word.count));
    }

    if (this.env.DB) {
      // Sequence-bearing profanity event: the aggregate batch also acks the
      // category progress. The D1 outcome is integrity-fenced: recover stale
      // attempts, arm before the batch, and only persist the completed
      // ProgressState when the batch confirms (the same batch either recorded
      // both the aggregates and the resolve).
      if (sequence !== undefined) {
        try {
          const progress = await this.prepareProgressResolve(day, 'profanity', sequence, 'completed', 0);
          await this.armCategoryIntegrityAttempt(day, 'profanity', sequence);
          try {
            await writeProfanityAggregates(this.env.DB, {
              chatId,
              userId,
              username,
              day,
              count,
              words,
              progress,
            });
            await this.saveProgressState(day, 'profanity', progress.nextState);
            await this.confirmCategoryIntegrityAttempt(day, 'profanity', sequence);
          } catch (e: unknown) {
            await this.failCategoryIntegrityAttempt(day, 'profanity', sequence);
            logD1AggregateWriteError('profanity', chatId, e);
            // Async caller treats the increment as the profanity completed
            // signal: a failed aggregate write must surface as non-2xx so the
            // terminal ack can classify the outcome as failed.
            throw new AggregateWriteFailure();
          }
        } catch (e: unknown) {
          if (e instanceof AggregateWriteFailure) throw e;
          logD1AggregateWriteError('profanity', chatId, e);
        }
      } else {
        try {
          await writeProfanityAggregates(this.env.DB, {
            chatId,
            userId,
            username,
            day,
            count,
            words,
          });
        } catch (e: unknown) {
          logD1AggregateWriteError('profanity', chatId, e);
        }
      }
    }
    if (hasMessageId) {
      await this.storage().put(this.profanityDoneKey(day, messageId as number), 1);
    }
  }

  private aggregateProfanityCounterWords(
    words: ProfanityIncrementPayload['words'],
  ): Array<{ word: string; count: number }> {
    const counts = new Map<string, number>();
    for (const entry of words) {
      const normalizedWord = this.normalizeProfanityCounterWord(entry);
      if (!normalizedWord) {
        continue;
      }
      counts.set(normalizedWord, (counts.get(normalizedWord) || 0) + entry.count);
    }
    return Array.from(counts.entries()).map(([word, count]) => ({ word, count }));
  }

  private normalizeProfanityCounterWord(
    word: ProfanityIncrementPayload['words'][number],
  ): string | null {
    const rawWord = typeof word?.word === 'string' && word.word.trim()
      ? word.word
      : typeof word?.baseForm === 'string'
        ? word.baseForm
        : '';
    return normalizeProfanityWord(rawWord);
  }

  private async incrementCriminalCounters(payload: CriminalIncrementPayload) {
    const { chatId, userId, username, day, violations, totalSeverity, sequence, messageId } = payload;
    const hasMessageId = Number.isInteger(messageId) && (messageId as number) > 0;
    if (hasMessageId) {
      const done = await this.storage().get<number>(this.criminalDoneKey(day, messageId as number));
      if (typeof done === 'number' && Number.isFinite(done)) {
        return;
      }
    }

    Logger.debug(this.env, 'Criminal counters update', {
      totalSeverity,
      violationCount: violations.length,
    });

    const criminalUserKey = `${CRIMINAL_USER_PREFIX}:${chatId}:${userId}:${day}`;
    const criminalSeverityKey = `${CRIMINAL_SEVERITY_PREFIX}:${chatId}:${userId}:${day}`;

    // Update user criminal violations count in KV
    const currentUserCount = parseInt((await this.env.COUNTERS.get(criminalUserKey)) || '0', 10);
    await this.env.COUNTERS.put(criminalUserKey, String(currentUserCount + violations.length));

    // Update user total severity in KV
    const currentSeverity = parseInt((await this.env.COUNTERS.get(criminalSeverityKey)) || '0', 10);
    await this.env.COUNTERS.put(criminalSeverityKey, String(currentSeverity + totalSeverity));

    // Update article-specific counts in KV
    for (const violation of violations) {
      const articleKey = `${CRIMINAL_ARTICLE_PREFIX}:${chatId}:${violation.article}:${day}`;
      const currentArticleCount = parseInt((await this.env.COUNTERS.get(articleKey)) || '0', 10);
      await this.env.COUNTERS.put(articleKey, String(currentArticleCount + violation.count));
    }

    if (this.env.DB) {
      // Sequence-bearing criminal event: the aggregate batch also acks the
      // category progress. Same fencing as profanity: arm before the batch,
      // persist the completed ProgressState only on confirmed D1 success.
      if (sequence !== undefined) {
        try {
          const progress = await this.prepareProgressResolve(day, 'criminal', sequence, 'completed', 0);
          await this.armCategoryIntegrityAttempt(day, 'criminal', sequence);
          try {
            await writeCriminalAggregates(this.env.DB, {
              chatId,
              userId,
              username,
              day,
              violationCount: violations.length,
              totalSeverity,
              progress,
            });
            await this.saveProgressState(day, 'criminal', progress.nextState);
            await this.confirmCategoryIntegrityAttempt(day, 'criminal', sequence);
          } catch (e: unknown) {
            await this.failCategoryIntegrityAttempt(day, 'criminal', sequence);
            logD1AggregateWriteError('criminal', chatId, e);
            // Async caller treats the increment as the criminal completed
            // signal: a failed aggregate write must surface as non-2xx so the
            // terminal ack can classify the outcome as failed.
            throw new AggregateWriteFailure();
          }
        } catch (e: unknown) {
          if (e instanceof AggregateWriteFailure) throw e;
          logD1AggregateWriteError('criminal', chatId, e);
        }
      } else {
        try {
          await writeCriminalAggregates(this.env.DB, {
            chatId,
            userId,
            username,
            day,
            violationCount: violations.length,
            totalSeverity,
          });
        } catch (e: unknown) {
          logD1AggregateWriteError('criminal', chatId, e);
        }
      }
    }
    if (hasMessageId) {
      await this.storage().put(this.criminalDoneKey(day, messageId as number), 1);
    }
  }

  /**
   * Computes the next durable progress state and the resolve input for a D1
   * progress upsert WITHOUT persisting completion yet. The caller persists
   * `nextState` only after the D1 batch confirms, so a failed D1 write can
   * never be represented as completed by later progress output.
   */
  private async prepareProgressResolve(
    day: string,
    category: ProgressCategory,
    sequence: number,
    outcome: ProgressOutcome,
    completedThroughTs = 0,
  ): Promise<{
    nextState: ProgressState;
    acceptedSeq: number;
    counts: ReturnType<typeof computeProgressCounts>;
    completedThroughTs: number;
  }> {
    const state = await this.loadProgressState(day, category);
    const next = outcome === 'failed'
      ? applyFailure(state, sequence)
      : applyCompletion(state, sequence);
    const acceptedSeq = await this.storageGetNumber(this.seqKey(day));
    const counts = computeProgressCounts(next, acceptedSeq);
    return { nextState: next, acceptedSeq, counts, completedThroughTs };
  }

  /** Progress-only acknowledgement (zero/skipped/failed terminal branches). */
  private async ackProgress(payload: ProgressAckPayload) {
    const { chatId, day, category, sequence, outcome } = payload;
    if (sequence === undefined || !Number.isInteger(sequence)) return;
    const accepted = await this.storageGetNumber(this.seqKey(day));
    if (sequence > accepted) {
      // Future sequence violates pipeline invariant: categories must agree on accepted.
      // Persist an inflated accepted to force invariant failure -> LIVE_PROGRESS_UNKNOWN.
      const state = await this.loadProgressState(day, category);
      const next: typeof state = {
        completedPrefix: state.completedPrefix,
        gaps: state.gaps,
        failed: [...state.failed, sequence].sort((a, b) => a - b),
      };
      const counts = computeProgressCounts(next, sequence);
      if (this.env.DB) {
        try {
          await this.armCategoryIntegrityAttempt(day, category, sequence);
          try {
            await writeCategoryProgressResolve(
              this.env.DB,
              chatId,
              day,
              category,
              sequence,
              counts,
              0,
            );
            await this.saveProgressState(day, category, next);
            await this.confirmCategoryIntegrityAttempt(day, category, sequence);
          } catch (e: unknown) {
            await this.failCategoryIntegrityAttempt(day, category, sequence);
            logD1AggregateWriteError('ack', chatId, e);
            // The ack itself failed to persist: surface as non-2xx so the
            // terminal-state logic never treats this acknowledgement as done.
            throw new AggregateWriteFailure();
          }
        } catch (e: unknown) {
          if (e instanceof AggregateWriteFailure) throw e;
          logD1AggregateWriteError('ack', chatId, e);
        }
      } else {
        await this.saveProgressState(day, category, next);
      }
      return;
    }
    const state = await this.loadProgressState(day, category);
    if (this.isSequenceAlreadyResolved(state, sequence)) {
      return;
    }
    const resolved = await this.prepareProgressResolve(day, category, sequence, outcome, 0);
    if (this.env.DB) {
      try {
        await this.armCategoryIntegrityAttempt(day, category, sequence);
        try {
          await writeCategoryProgressResolve(
            this.env.DB,
            chatId,
            day,
            category,
            resolved.acceptedSeq,
            resolved.counts,
            resolved.completedThroughTs,
          );
          await this.saveProgressState(day, category, resolved.nextState);
          await this.confirmCategoryIntegrityAttempt(day, category, sequence);
        } catch (e: unknown) {
          await this.failCategoryIntegrityAttempt(day, category, sequence);
          logD1AggregateWriteError('ack', chatId, e);
          // The ack itself failed to persist: surface as non-2xx so the
          // terminal-state logic never treats this acknowledgement as done.
          throw new AggregateWriteFailure();
        }
      } catch (e: unknown) {
        if (e instanceof AggregateWriteFailure) throw e;
        logD1AggregateWriteError('ack', chatId, e);
      }
    } else {
      await this.saveProgressState(day, category, resolved.nextState);
    }
  }

  /**
   * Exact per-category counts for one day's serialized stream, mirroring the
   * D1 progress row semantics (see computeProgressCounts): completed is the
   * contiguous prefix, gaps are resolved (not pending), failed is permanent.
   */
  private async computeCategorySnapshot(
    day: string,
    category: ProgressCategory,
    acceptedSeq: number,
  ): Promise<{
    accepted: number;
    completed: number;
    pending: number;
    failed: number;
    clean: boolean;
  }> {
    const integrity = await this.loadIntegrityState(day, category);
    const clean = isIntegrityClean(integrity);
    if (category === 'base') {
      // Base completes synchronously in the same serialized D1 batch that
      // allocated the accepted watermark: the D1 base row always reads
      // accepted+completed with zero pending/failed. The only DO-side
      // uncertainty for base is integrity, captured by the clean flag.
      return {
        accepted: acceptedSeq,
        completed: acceptedSeq,
        pending: 0,
        failed: 0,
        clean,
      };
    }
    const state = await this.loadProgressState(day, category);
    const counts = computeProgressCounts(state, acceptedSeq);
    return {
      accepted: acceptedSeq,
      completed: counts.completedSeq,
      pending: counts.pendingCount,
      failed: counts.failedCount,
      clean,
    };
  }

  /**
   * Serialized internal snapshot for the live-day integrity gate. Recovers and
   * persists any stale active integrity attempt first (its D1 outcome is
   * unknown, so the stream must be reported not clean), then returns the common
   * accepted sequence and exact computed per-category counts. No logging, no
   * PII: only opaque sequences, counts, and the clean flag.
   */
  private async pipelineSnapshot(day: string): Promise<CountersDOPipelineSnapshot> {
    const accepted = await this.storageGetNumber(this.seqKey(day));
    const [base, profanity, criminal] = await Promise.all(
      PROGRESS_CATEGORIES.map(async (category) => {
        await this.recoverAndPersistIntegrityState(day, category);
        return this.computeCategorySnapshot(day, category, accepted);
      }),
    );
    return {
      day,
      accepted,
      categories: { base, profanity, criminal },
    };
  }

  /**
   * Serialized multi-day proof snapshot. Runs entirely under the caller's
   * single `blockConcurrencyWhile` call so no increment/ack can interleave
   * between days. For each requested day (already validated + deduplicated in
   * request order) the stored proof marker is read first: a missing,
   * malformed, or wrong-version marker reports `initialized: false` while still
   * exposing safe zero-only incidental counts — it is never a clean proof and
   * the later reader rejects it. Marked days recover/persist any stale active
   * integrity attempt before every category is snapshot. No logging, no PII.
   */
  private async pipelineSnapshots(days: string[]): Promise<CountersDOPipelineSnapshots> {
    const snapshots: CountersDODayProofSnapshot[] = [];
    for (const day of days) {
      const marker = await this.loadDayProofMarker(day);
      if (!marker || marker.version !== PIPELINE_PROOF_VERSION || !marker.initialized) {
        const accepted = await this.storageGetNumber(this.seqKey(day));
        const zero = { accepted: 0, completed: 0, pending: 0, failed: 0 };
        snapshots.push({
          day,
          version: PIPELINE_PROOF_VERSION,
          initialized: false,
          accepted,
          categories: {
            base: { ...zero, clean: false },
            profanity: { ...zero, clean: false },
            criminal: { ...zero, clean: false },
          },
        });
        continue;
      }
      const single = await this.pipelineSnapshot(day);
      snapshots.push({
        day,
        version: PIPELINE_PROOF_VERSION,
        initialized: true,
        accepted: single.accepted,
        categories: single.categories,
      });
    }
    return { version: PIPELINE_PROOF_VERSION, days: snapshots };
  }

  private async processBatchRequest(request: Request): Promise<Response> {
    let batchData: BatchIncrementPayload;

    try {
      batchData = (await request.json()) as BatchIncrementPayload;
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    try {
      await this.state.blockConcurrencyWhile(async () => {
        // Process activity increments
        if (batchData.activity && Array.isArray(batchData.activity)) {
          for (const payload of batchData.activity) {
            this.validate(payload);
            await this.incrementCounters(payload);
          }
        }

        // Process profanity increments
        if (batchData.profanity && Array.isArray(batchData.profanity)) {
          for (const payload of batchData.profanity) {
            this.validateProfanity(payload);
            await this.incrementProfanityCounters(payload);
          }
        }

        // Process criminal code violations increments
        if (batchData.criminal && Array.isArray(batchData.criminal)) {
          for (const payload of batchData.criminal) {
            this.validateCriminal(payload);
            await this.incrementCriminalCounters(payload);
          }
        }
      });
    } catch (err: unknown) {
      logCounterOperationError('batch', err);
      return new Response('error', { status: 500 });
    }

    return new Response('ok');
  }
}
