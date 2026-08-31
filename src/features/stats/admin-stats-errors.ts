export class HistoricalStatsNotReady extends Error {
  constructor() { super('Historical statistics are not ready.'); this.name = 'HistoricalStatsNotReady'; }
}

export class AdminUnavailable extends Error {
  constructor() { super('Admin service is temporarily unavailable.'); this.name = 'AdminUnavailable'; }
}

export type LiveProgressUnavailableCode = 'LIVE_PROGRESS_UNKNOWN' | 'LIVE_ANALYSIS_FAILED';

/**
 * The current UTC day cannot yet be served: either its pipeline progress is
 * unknown (no rows, or rows that do not correspond to the day) or a tracked
 * category has a permanent failure. Never exposes internal coverage reasons.
 */
export class LiveProgressUnavailable extends Error {
  readonly code: LiveProgressUnavailableCode;
  readonly day: string;

  constructor(code: LiveProgressUnavailableCode, day: string) {
    super('Statistics for the current UTC day are not available yet.');
    this.name = 'LiveProgressUnavailable';
    this.code = code;
    this.day = day;
  }
}
